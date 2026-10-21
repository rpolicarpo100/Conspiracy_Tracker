/* =====================================================================
   API DO SERVIDOR
   Todas as permissões são verificadas AQUI, nunca no frontend.
   Convenções: respostas {ok:true, ...} ou {error:{code,message}};
   nada devolve chaves, hashes ou tokens de outros utilizadores.
   ===================================================================== */
import crypto from 'node:crypto';
import { createStore } from './store.mjs';
import { createAuth, hashPassword, verifyPassword, passwordProblems, sha256, newToken, publicUser, parseCookies } from './auth.mjs';
import { keyVault } from './crypto-keys.mjs';
import { PROVIDERS, registryPublic, validateProvider, complete, breakerState } from './providers.mjs';

const MAX_BODY = 512 * 1024;
const APP_VERSION = '2.0.0-fase1';

function json(res, code, obj, extraHeaders) {
  const headers = Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }, extraHeaders || {});
  res.writeHead(code, headers);
  res.end(JSON.stringify(obj));
}

function err(res, code, message, extra) {
  json(res, code, { error: { code, message: message, ...(extra || {}) } });
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw Object.assign(new Error('corpo demasiado grande'), { status: 413 });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
}

const emailRe = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const ipOf = (req) => ((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'desconhecido');

export async function createApi(opts) {
  opts = opts || {};
  const store = await createStore(opts.dataDir).init();
  const vault = keyVault(opts.appSecret || process.env.APP_SECRET);
  const auth = createAuth(store, {
    secure: opts.secure !== false,
    adminEmail: opts.adminEmail || process.env.ADMIN_EMAIL
  });
  const counters = store.counters;

  /* ---------- helpers de autorização ---------- */
  async function requireUser(req, res) {
    const a = await auth.currentUser(req);
    if (!a) { err(res, 401, 'sessão inválida ou expirada'); return null; }
    return a;
  }
  function requireCsrf(req, res, a) {
    if (!auth.csrfOk(req, a)) { err(res, 403, 'token CSRF ausente ou inválido'); return false; }
    return true;
  }
  function requireAdmin(a, res) {
    if (!a || a.user.role !== 'ADMIN') { err(res, 403, 'operação restrita a administradores'); return false; }
    return true;
  }

  const api = { store, vault, auth, version: APP_VERSION };

  /* ============================ ROTAS ============================ */
  api.handle = async function handle(req, res, url) {
    const p = url.pathname;
    const method = req.method;
    const now = () => new Date().toISOString();

    try {
      /* ---------- saúde ---------- */
      if (p === '/health') {
        return json(res, 200, {
          ok: true, status: 'alive', version: APP_VERSION, uptimeSeconds: Math.round(process.uptime()),
          now: now(), commit: process.env.RENDER_GIT_COMMIT || null
        });
      }
      if (p === '/ready') {
        const checks = {
          storage: { ok: !!store.data, writable: true },
          keyVault: { ok: vault.enabled, mode: vault.enabled ? 'aes-256-gcm' : 'desactivado', reason: vault.reason },
          persistence: {
            ok: !!opts.dataDir || !!process.env.DATA_DIR,
            durableBetweenDeploys: !!(opts.dataDir || process.env.DATA_DIR) && !process.env.RENDER,
            note: 'no plano gratuito do Render o disco é efémero: os dados não sobrevivem a um deploy'
          }
        };
        const ready = checks.storage.ok;
        return json(res, ready ? 200 : 503, { ok: ready, status: ready ? 'ready' : 'degraded', checks, version: APP_VERSION, now: now() });
      }

      /* ---------- meta ---------- */
      if (p === '/api/meta') {
        return json(res, 200, {
          ok: true, version: APP_VERSION,
          providers: registryPublic(),
          keyVault: { enabled: vault.enabled, reason: vault.reason },
          registration: {
            open: true,
            firstAdminEmailConfigured: !!auth.adminEmail,
            passwordPolicy: ['pelo menos 10 caracteres', 'uma minúscula', 'uma maiúscula', 'um dígito']
          },
          privacy: {
            adminAccess: 'os administradores podem consultar projectos e execuções para suporte, segurança e operação; cada acesso fica registado na auditoria',
            storage: 'os dados são guardados no servidor da aplicação; no plano gratuito do Render o disco é efémero'
          }
        });
      }

      /* ---------- registo ---------- */
      if (p === '/api/auth/register' && method === 'POST') {
        const ip = ipOf(req);
        if (auth.registerLimiter.blocked(ip)) return err(res, 429, 'demasiados registos a partir deste endereço');
        auth.registerLimiter.hit(ip);
        const body = await readBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        if (!emailRe.test(email)) return err(res, 400, 'email inválido');
        const problems = passwordProblems(body.password);
        if (problems.length) return err(res, 400, 'palavra-passe fraca: ' + problems.join(', '));
        if (body.acceptTerms !== true) return err(res, 400, 'é necessário aceitar a política de privacidade');
        if (store.userByEmail(email)) return err(res, 409, 'não foi possível criar a conta com estes dados');
        const role = (auth.adminEmail && email === auth.adminEmail && !store.data.users.some((u) => u.role === 'ADMIN')) ? 'ADMIN' : 'USER';
        const { salt, hash } = hashPassword(body.password);
        const user = await store.createUser({ email, passwordHash: hash, salt, role, termsAcceptedAt: now() });
        await store.audit({ type: 'user_registered', actorId: user.id, subjectId: user.id, ip, action: 'register', detail: { role } });
        await store.count('users_registered');
        const s = await auth.issueSession(user, { ip, ua: req.headers['user-agent'] });
        await store.audit({ type: 'session_created', actorId: user.id, ip, action: 'login_after_register' });
        return json(res, 201, { ok: true, user: publicUser(user), csrf: s.csrf }, { 'set-cookie': auth.cookiesFor(s.token, s.csrf) });
      }

      /* ---------- login ---------- */
      if (p === '/api/auth/login' && method === 'POST') {
        const ip = ipOf(req);
        const body = await readBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        const key = ip + '|' + (email || 'sem-email');
        if (auth.loginLimiter.blocked(key) || auth.loginLimiter.blocked(ip)) {
          await store.audit({ type: 'login_blocked', ip, action: 'login', detail: { email } });
          return err(res, 429, 'demasiadas tentativas; tente novamente mais tarde');
        }
        auth.loginLimiter.hit(key);
        const user = store.userByEmail(email);
        const ok = user && user.status === 'active' && verifyPassword(body.password, user.salt, user.passwordHash);
        if (!ok) {
          await store.audit({ type: 'login_failed', ip, action: 'login', subjectId: user ? user.id : null, detail: { email } });
          return err(res, 401, 'credenciais inválidas');
        }
        auth.loginLimiter.reset(key);
        await store.updateUser(user.id, { lastLoginAt: now() });
        const s = await auth.issueSession(user, { ip, ua: req.headers['user-agent'] });
        await store.audit({ type: 'login_succeeded', actorId: user.id, subjectId: user.id, ip, action: 'login' });
        await store.count('logins');
        return json(res, 200, { ok: true, user: publicUser(user), csrf: s.csrf }, { 'set-cookie': auth.cookiesFor(s.token, s.csrf) });
      }

      /* ---------- sessão actual ---------- */
      if (p === '/api/auth/me' && method === 'GET') {
        const a = await auth.currentUser(req);
        if (!a) return json(res, 200, { ok: true, user: null });
        return json(res, 200, { ok: true, user: publicUser(a.user), csrf: a.csrf, session: { id: a.session.id, createdAt: a.session.createdAt, expiresAt: a.session.expiresAt, ip: a.session.ip } });
      }

      /* ---------- logout ---------- */
      if (p === '/api/auth/logout' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        await store.revokeSession(a.session.id, a.user.id);
        await store.audit({ type: 'logout', actorId: a.user.id, ip: ipOf(req), action: 'logout' });
        const cleared = auth.cookiesFor('', '').map((c) => c.replace(/Max-Age=\d+/, 'Max-Age=0'));
        return json(res, 200, { ok: true }, { 'set-cookie': cleared });
      }

      if (p === '/api/auth/logout-all' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        await store.revokeAllSessions(a.user.id);
        await store.audit({ type: 'logout_all', actorId: a.user.id, ip: ipOf(req), action: 'logout_all' });
        return json(res, 200, { ok: true, revoked: store.sessionsOf(a.user.id).length });
      }

      if (p === '/api/auth/sessions' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        return json(res, 200, {
          ok: true,
          sessions: store.sessionsOf(a.user.id).map((s) => ({
            id: s.id, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt,
            revoked: !!s.revokedAt, current: s.id === a.session.id, ip: s.ip, ua: s.ua
          }))
        });
      }

      if (p.match(/^\/api\/auth\/sessions\/[^/]+$/) && method === 'DELETE') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const id = p.split('/').pop();
        const done = await store.revokeSession(id, a.user.id);
        if (!done) return err(res, 404, 'sessão não encontrada');
        await store.audit({ type: 'session_revoked', actorId: a.user.id, subjectId: id, action: 'revoke_session' });
        return json(res, 200, { ok: true });
      }

      /* ---------- palavra-passe ---------- */
      if (p === '/api/auth/password' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        if (!verifyPassword(body.current, a.user.salt, a.user.passwordHash)) return err(res, 401, 'palavra-passe actual incorrecta');
        const problems = passwordProblems(body.next);
        if (problems.length) return err(res, 400, 'palavra-passe fraca: ' + problems.join(', '));
        const { salt, hash } = hashPassword(body.next);
        await store.updateUser(a.user.id, { salt, passwordHash: hash });
        await store.revokeAllSessions(a.user.id, a.session.id);
        await store.audit({ type: 'password_changed', actorId: a.user.id, ip: ipOf(req), action: 'change_password', detail: { otherSessionsRevoked: true } });
        return json(res, 200, { ok: true, otherSessionsRevoked: true });
      }

      /* ---------- exportação e eliminação dos próprios dados ---------- */
      if (p === '/api/auth/export' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        await store.audit({ type: 'data_exported', actorId: a.user.id, subjectId: a.user.id, ip: ipOf(req), action: 'export_own_data' });
        return json(res, 200, {
          ok: true,
          exportedAt: now(),
          user: publicUser(a.user),
          projects: store.projectsOf(a.user.id),
          providers: store.credentialsOf(a.user.id).map((c) => ({ provider: c.provider, mask: c.keyMask, model: c.model, status: c.status, updatedAt: c.updatedAt })),
          usage: store.data.usage.filter((u) => u.userId === a.user.id),
          audit: store.auditList({ actorId: a.user.id })
        });
      }

      if (p === '/api/auth/account' && method === 'DELETE') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        if (!verifyPassword(body.password, a.user.salt, a.user.passwordHash)) return err(res, 401, 'palavra-passe incorrecta');
        const snapshot = { id: a.user.id, email: a.user.email, projects: store.projectsOf(a.user.id).length };
        await store.deleteUser(a.user.id);
        await store.audit({ type: 'account_deleted', actorId: snapshot.id, subjectId: snapshot.id, ip: ipOf(req), action: 'delete_account', detail: snapshot });
        return json(res, 200, { ok: true, deleted: snapshot });
      }

      /* ---------- projectos (isolamento por dono) ---------- */
      if (p === '/api/projects' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        return json(res, 200, { ok: true, projects: store.projectsOf(a.user.id).map(summaryProject) });
      }
      if (p === '/api/projects' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        const prj = await store.createProject(a.user.id, {
          title: String(body.title || 'Sem título').slice(0, 200),
          question: String(body.question || '').slice(0, 2000),
          objective: String(body.objective || '').slice(0, 2000),
          description: String(body.description || '').slice(0, 4000),
          scope: body.scope || undefined,
          keywords: Array.isArray(body.keywords) ? body.keywords.slice(0, 50) : []
        });
        await store.audit({ type: 'project_created', actorId: a.user.id, subjectId: prj.id, action: 'create_project' });
        await store.count('projects_created');
        return json(res, 201, { ok: true, project: prj });
      }
      if (p.match(/^\/api\/projects\/[^/]+$/)) {
        const id = p.split('/').pop();
        const a = await requireUser(req, res); if (!a) return;
        const prj = store.projectByIdFor(id, a.user.id);
        if (!prj) return err(res, 404, 'projecto não encontrado');   // 404 e não 403: não revela existência
        if (method === 'GET') return json(res, 200, { ok: true, project: prj });
        if (!requireCsrf(req, res, a)) return;
        if (method === 'PATCH') {
          const body = await readBody(req);
          const updated = await store.updateProject(id, a.user.id, body);
          await store.audit({ type: 'project_updated', actorId: a.user.id, subjectId: id, action: 'update_project', detail: { fields: Object.keys(body) } });
          return json(res, 200, { ok: true, project: updated });
        }
        if (method === 'DELETE') {
          await store.deleteProject(id, a.user.id);
          await store.audit({ type: 'project_deleted', actorId: a.user.id, subjectId: id, action: 'delete_project' });
          return json(res, 200, { ok: true });
        }
      }

      /* ---------- fornecedores de IA ---------- */
      if (p === '/api/providers' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const mine = store.credentialsOf(a.user.id);
        return json(res, 200, {
          ok: true,
          keyVault: { enabled: vault.enabled, reason: vault.reason },
          providers: registryPublic().map((pr) => {
            const c = mine.filter((x) => x.provider === pr.id)[0] || null;
            const br = breakerState(pr.id + ':' + ((c && c.model) || ''));
            return Object.assign({}, pr, {
              configured: !!c,
              mask: c ? c.keyMask : null,
              model: c ? c.model : null,
              status: c ? c.status : 'not_configured',
              lastError: c ? c.lastError : null,
              lastValidatedAt: c ? c.lastValidatedAt : null,
              breakerOpen: br.open
            });
          })
        });
      }

      if (p.match(/^\/api\/providers\/[^/]+\/key$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const provider = p.split('/')[3];
        if (!PROVIDERS[provider]) return err(res, 400, 'fornecedor desconhecido');
        if (!vault.enabled) return err(res, 503, 'cofre de chaves desactivado: ' + vault.reason, { needsEnv: 'APP_SECRET' });
        const body = await readBody(req);
        const key = String(body.apiKey || '').trim();
        if (!key) return err(res, 400, 'chave vazia');
        const sealed = vault.seal(key);
        const c = await store.upsertCredential({
          userId: a.user.id, provider, keyCipher: sealed, keyMask: vault.mask(key),
          model: String(body.model || '').slice(0, 120) || null,
          meta: { accountId: body.accountId ? String(body.accountId).slice(0, 80) : null, base: body.base ? String(body.base).slice(0, 200) : null }
        });
        await store.audit({ type: 'credential_saved', actorId: a.user.id, subjectId: c.id, action: 'save_key', detail: { provider, mask: c.keyMask } });
        return json(res, 200, { ok: true, provider, mask: c.keyMask, status: 'unverified', note: 'chave cifrada em repouso; utilize «testar» para validar' });
      }

      if (p.match(/^\/api\/providers\/[^/]+\/key$/) && method === 'DELETE') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const provider = p.split('/')[3];
        const done = await store.deleteCredential(a.user.id, provider);
        await store.audit({ type: 'credential_deleted', actorId: a.user.id, action: 'delete_key', detail: { provider } });
        return done ? json(res, 200, { ok: true }) : err(res, 404, 'sem chave guardada para este fornecedor');
      }

      if (p.match(/^\/api\/providers\/[^/]+\/test$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const provider = p.split('/')[3];
        const c = store.credentialFor(a.user.id, provider);
        if (!c) return err(res, 400, 'sem chave configurada para ' + provider);
        const body = await readBody(req);
        let apiKey = null;
        try { apiKey = vault.open(c.keyCipher); } catch { return err(res, 500, 'não foi possível ler a chave guardada'); }
        const t0 = Date.now();
        const result = await validateProvider({
          provider, base: (body.base || (c.meta && c.meta.base) || undefined), apiKey,
          model: body.model || c.model, accountId: (c.meta && c.meta.accountId) || undefined,
          timeoutMs: 20000
        });
        await store.setCredentialStatus(c.id, result.ok ? 'operational' : 'error', result.ok ? null : result.error);
        await store.audit({
          type: 'provider_tested', actorId: a.user.id, subjectId: c.id, ip: ipOf(req), action: 'test_provider',
          detail: { provider, ok: !!result.ok, stage: result.stage || null, status: result.checks && result.checks[0] ? result.checks[0].status : null, ms: Date.now() - t0 }
        });
        await store.addUsage({ userId: a.user.id, provider, kind: 'validation', ok: !!result.ok, promptTokens: result.usage ? result.usage.promptTokens : null, completionTokens: result.usage ? result.usage.completionTokens : null, cost: null });
        return json(res, 200, { ok: true, validation: redactValidation(result) });
      }

      if (p.match(/^\/api\/providers\/[^/]+\/complete$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const provider = p.split('/')[3];
        const c = store.credentialFor(a.user.id, provider);
        if (!c) return err(res, 400, 'sem chave configurada para ' + provider);
        if (c.status !== 'operational') return err(res, 409, 'fornecedor não validado: execute primeiro o teste de ligação');
        const body = await readBody(req);
        const msgs = Array.isArray(body.messages) ? body.messages.slice(0, 20).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 8000) })) : null;
        if (!msgs || !msgs.length) return err(res, 400, 'messages ausente');
        let apiKey = null;
        try { apiKey = vault.open(c.keyCipher); } catch { return err(res, 500, 'não foi possível ler a chave guardada'); }
        const r = await complete({
          provider, base: (c.meta && c.meta.base) || undefined, apiKey, model: c.model,
          accountId: (c.meta && c.meta.accountId) || undefined, messages: msgs, timeoutMs: 30000
        });
        await store.addUsage({
          userId: a.user.id, provider, model: c.model, kind: 'completion', ok: !!r.ok,
          promptTokens: r.usage ? r.usage.promptTokens : null,
          completionTokens: r.usage ? r.usage.completionTokens : null, cost: null,
          latencyMs: r.latencyMs != null ? r.latencyMs : null
        });
        await store.audit({ type: 'ai_call', actorId: a.user.id, action: 'complete', detail: { provider, model: c.model, ok: !!r.ok, circuitOpen: !!r.circuitOpen } });
        await store.count(r.ok ? 'ai_calls_ok' : 'ai_calls_failed');
        if (!r.ok) return err(res, 502, r.error || 'falha do fornecedor', { circuitOpen: !!r.circuitOpen });
        return json(res, 200, { ok: true, text: r.text, usage: r.usage, latencyMs: r.latencyMs, reported: !!r.usage && r.usage.promptTokens != null });
      }

      /* ---------- administração ---------- */
      if (p === '/api/admin/metrics' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireAdmin(a, res)) return;
        const users = store.data.users;
        const sessions = store.data.sessions;
        const projects = store.data.projects;
        const usage = store.usageSummary();
        const counts = store.counters();
        const audit = store.auditList({ limit: 5000 });
        return json(res, 200, {
          ok: true,
          generatedAt: now(),
          users: {
            total: users.length,
            admins: users.filter((u) => u.role === 'ADMIN').length,
            suspended: users.filter((u) => u.status !== 'active').length,
            activeSessions: sessions.filter((s) => !s.revokedAt && new Date(s.expiresAt) > new Date()).length
          },
          projects: {
            total: projects.length,
            byStatus: projects.reduce((o, x) => { o[x.status] = (o[x.status] || 0) + 1; return o; }, {})
          },
          ai: {
            byProvider: usage,
            totalCalls: Object.values(usage).reduce((n, x) => n + x.calls, 0),
            costNote: 'os custos só aparecem quando o fornecedor os reporta; caso contrário: valor desconhecido'
          },
          counters: counts,
          security: {
            loginFailures: audit.filter((e) => e.type === 'login_failed').length,
            blockedAttempts: audit.filter((e) => e.type === 'login_blocked').length,
            adminAccesses: audit.filter((e) => e.type === 'admin_access').length
          },
          notAvailable: [
            'documentos processados (ainda sem ingestão documental)',
            'relações propostas/verificadas (motor de investigação não implementado nesta fase)',
            'armazenamento em disco (não medido no plano gratuito)'
          ]
        });
      }

      if (p === '/api/admin/users' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireAdmin(a, res)) return;
        await store.audit({ type: 'admin_access', actorId: a.user.id, ip: ipOf(req), action: 'list_users' });
        return json(res, 200, {
          ok: true,
          users: store.data.users.map((u) => Object.assign(publicUser(u), {
            projects: store.projectsOf(u.id).length,
            hasKeys: store.credentialsOf(u.id).map((c) => ({ provider: c.provider, mask: c.keyMask, status: c.status }))
          }))
        });
      }

      if (p.match(/^\/api\/admin\/users\/[^/]+\/projects$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireAdmin(a, res)) return;
        const uid = p.split('/')[4];
        const target = store.userById(uid);
        if (!target) return err(res, 404, 'utilizador não encontrado');
        await store.audit({
          type: 'admin_access', actorId: a.user.id, subjectId: uid, ip: ipOf(req),
          action: 'view_user_projects', reason: String(url.searchParams.get('reason') || 'não indicado').slice(0, 200)
        });
        return json(res, 200, { ok: true, user: publicUser(target), projects: store.projectsOf(uid) });
      }

      if (p.match(/^\/api\/admin\/users\/[^/]+\/status$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireAdmin(a, res)) return;
        if (!requireCsrf(req, res, a)) return;
        const uid = p.split('/')[4];
        const body = await readBody(req);
        const target = store.userById(uid);
        if (!target) return err(res, 404, 'utilizador não encontrado');
        if (target.id === a.user.id) return err(res, 400, 'não pode suspender a própria conta');
        const status = body.status === 'active' ? 'active' : 'suspended';
        await store.updateUser(uid, { status });
        if (status === 'suspended') await store.revokeAllSessions(uid);
        await store.audit({ type: 'admin_user_status', actorId: a.user.id, subjectId: uid, ip: ipOf(req), action: 'set_status', detail: { status } });
        return json(res, 200, { ok: true, user: publicUser(store.userById(uid)) });
      }

      if (p === '/api/admin/audit' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireAdmin(a, res)) return;
        const limit = Math.min(500, Number(url.searchParams.get('limit') || 100));
        return json(res, 200, { ok: true, events: store.auditList({ type: url.searchParams.get('type') || null, limit }) });
      }

      return err(res, 404, 'rota não encontrada');
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[api] erro:', e.message);
      return err(res, status, status >= 500 ? 'erro interno' : e.message);
    }
  };

  function summaryProject(p) {
    return {
      id: p.id, title: p.title, question: p.question, status: p.status,
      createdAt: p.createdAt, updatedAt: p.updatedAt, archivedAt: p.archivedAt,
      counters: { documents: (p.documents || []).length, evidence: (p.evidence || []).length, relations: (p.relations || []).length }
    };
  }

  function redactValidation(v) {
    return {
      ok: v.ok, stage: v.stage || null, error: v.error || null, provider: v.provider,
      model: v.model, latencyMs: v.latencyMs != null ? v.latencyMs : null,
      checks: v.checks || [], modelsCount: v.models ? v.models.length : 0,
      modelsSample: (v.models || []).slice(0, 8),
      usage: v.usage || null, sample: v.sample ? String(v.sample).slice(0, 120) : null
    };
  }

  api.close = async () => { await store.persist(); };
  return api;
}
