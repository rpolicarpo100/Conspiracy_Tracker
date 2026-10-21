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
import { PROVIDERS, registryPublic, validateProvider, complete, breakerState, isPrivateHost } from './providers.mjs';
import { runResearch, profileOf, PROFILES, STEPS, PROMPT_VERSION, promptFor, parseAiJson } from './research.mjs';
import { buildReport, reportToMarkdown, SECTION_TITLES } from './report.mjs';
import { buildGraph, validateRelation, ENTITY_TYPES, RELATION_TYPES, periodWindow, relationInWindow } from './graph.mjs';
import { graphToSvg, graphToDot, graphExportPayload } from './graph-export.mjs';
import { checkAccess, accessSuggestion, ACCESS_STATE_LABEL, ACCESS_METHOD, MAX_REDIRECTS } from './access.mjs';
import { AGENTS, agentById, executeAgent, AGENT_PROMPT_VERSION, quotaState, QUOTAS } from './agents.mjs';
import {
  STATES, STATE_LABEL, validateEvidence, evaluate, corroboration, suggestedState, dedupeKey
} from './evidence.mjs';

const MAX_BODY = 512 * 1024;
const APP_VERSION = '2.0.0-fase3c';

function json(res, code, obj, extraHeaders) {
  const headers = Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }, extraHeaders || {});
  res.writeHead(code, headers);
  res.end(JSON.stringify(obj));
}

/* exportações: ficheiro com aviso de proveniência nos cabeçalhos */
function jsonOrFile(res, code, body, type, filename) {
  res.writeHead(code, {
    'content-type': type,
    'content-disposition': 'attachment; filename="' + filename + '"',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
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
  /* Campos do objecto de investigação aceites do cliente, com limites e sem
     inventar valores por omissão falsos (o que não vem fica vazio, não «confirmado»). */
  const strList = (v, max) => (Array.isArray(v) ? v.map((x) => String(x).trim().slice(0, 300)).filter(Boolean).slice(0, max) : undefined);
  function projectFields(body, partial) {
    const out = {};
    const str = (k, max) => { if (body[k] !== undefined) out[k] = String(body[k]).slice(0, max); };
    str('title', 200); str('question', 2000); str('objective', 2000); str('description', 4000);
    str('referenceDate', 40); str('timeLimit', 120);
    ['keywords', 'entities', 'excludedSources', 'prioritySources', 'subquestions',
      'completionCriteria', 'languages'].forEach((k) => { const v = strList(body[k], 100); if (v) out[k] = v; });
    if (Array.isArray(body.hypotheses)) {
      out.hypotheses = body.hypotheses.slice(0, 50).map((h, i) => ({
        id: (h && h.id) || 'h' + (i + 1),
        text: String((h && h.text) || h || '').slice(0, 1000),
        status: ['a-testar', 'suportada', 'refutada', 'inconclusiva'].includes(h && h.status) ? h.status : 'a-testar',
        /* uma hipótese nasce fraca: o estado forte só existe nas alegações, com provas
           ligadas e validadas pelo servidor. O cliente não pode promovê-la por aqui. */
        state: ['hipotese', 'insuficiente', 'alegacao-atribuida'].includes(h && h.state) ? h.state : 'hipotese'
      })).filter((h) => h.text);
    }
    if (body.budget && typeof body.budget === 'object') {
      const b = body.budget;
      out.budget = {
        maxCalls: Math.max(0, Math.min(10000, Number(b.maxCalls) || 0)),
        maxDocuments: Math.max(0, Math.min(10000, Number(b.maxDocuments) || 0)),
        maxMinutes: Math.max(0, Math.min(10000, Number(b.maxMinutes) || 0)),
        maxCost: Math.max(0, Math.min(100000, Number(b.maxCost) || 0))
      };
    }
    if (body.scope && typeof body.scope === 'object') {
      const sc = body.scope;
      out.scope = {
        geo: String(sc.geo || '').slice(0, 200),
        languages: strList(sc.languages, 20) || [],
        period: { from: (sc.period && sc.period.from) || null, to: (sc.period && sc.period.to) || null }
      };
    }
    if (!partial) {
      out.title = out.title || 'Sem título';
      ['question', 'objective', 'description'].forEach((k) => { if (out[k] === undefined) out[k] = ''; });
    }
    return out;
  }

  /* Caminho mais curto no grafo (BFS). Devolve cada passo com as provas de cada aresta:
     um caminho NÃO é prova de coordenação — junta-se a explicação no resultado. */
  function shortestPath(g, fromKey, toKey) {
    const adj = new Map();
    g.edges.forEach((e) => {
      if (!adj.has(e.from)) adj.set(e.from, []);
      if (!adj.has(e.to)) adj.set(e.to, []);
      adj.get(e.from).push({ to: e.to, edge: e });
      adj.get(e.to).push({ to: e.from, edge: e });
    });
    if (!adj.has(fromKey) || !adj.has(toKey)) return { found: false, reason: 'uma das entidades não existe no grafo' };
    const prev = new Map([[fromKey, null]]);
    const queue = [fromKey];
    while (queue.length) {
      const cur = queue.shift();
      if (cur === toKey) break;
      (adj.get(cur) || []).forEach((n) => {
        if (!prev.has(n.to)) { prev.set(n.to, { from: cur, edge: n.edge }); queue.push(n.to); }
      });
    }
    if (!prev.has(toKey)) return { found: false, reason: 'nenhum caminho registado entre as duas entidades' };
    const passos = [];
    let cur = toKey;
    while (prev.get(cur)) {
      const step = prev.get(cur);
      passos.unshift({ de: step.edge.fromName, para: step.edge.toName, id: step.edge.id, tipo: step.edge.label,
        confianca: step.edge.confidence, provas: step.edge.evidenceIds, inferida: step.edge.inferred });
      cur = step.from;
    }
    return {
      found: true, passos, saltos: passos.length,
      aviso: 'um caminho é uma sequência de relações registadas, não prova de coordenação, intenção ou controlo comum; cada passo traz as suas provas e a sua confiança'
    };
  }

  /* Cronologia a partir de provas e relações: cada evento aponta a sua prova. */
  function timelineOf(store, pid, win) {
    const evs = store.evidenceOf(pid).filter((e) => !e.retractedAt);
    const eventos = evs.filter((e) => e.eventDate || e.publicationDate).map((e) => ({
      data: e.eventDate || e.publicationDate,
      tipo: e.eventDate ? 'acontecimento' : 'publicação',
      titulo: e.title, prova: e.id, posicao: e.stance, estado: e.validationState
    })).sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const rels = store.relationsOf(pid).filter((r) => !r.retractedAt && r.period && (r.period.from || r.period.to)).map((r) => ({
      data: r.period.from || r.period.to,
      tipo: 'relação',
      titulo: r.from + ' → ' + r.to,
      relacao: r.id,
      ate: r.period.to || null
    }));
    const todos = eventos.concat(rels).sort((a, b) => String(a.data).localeCompare(String(b.data)));
    if (!win || !win.applied) return { eventos: todos, total: todos.length, filter: { applied: false },
      nota: todos.length ? null : 'sem datas registadas: nada a ordenar (não se inventam datas)' };
    const dentro = [], fora = [];
    todos.forEach((e) => (relationInWindow({ from: e.data, to: e.data }, win) === false ? fora : dentro).push(e));
    return {
      eventos: dentro, total: dentro.length,
      filter: { applied: true, from: win.from, to: win.to, excludedByPeriod: fora.length },
      nota: dentro.length ? null : 'nenhum evento datado dentro do período pedido (não se inventam datas)'
    };
  }

  /* Recolha de documentos para o motor: mesma disciplina do agente local
     (sem hosts privados, limite de tamanho e de tempo, hash do conteúdo). */
  async function fetchDoc(url) {
    let u = null;
    try { u = new URL(String(url)); } catch { return { ok: false, error: 'URL inválida' }; }
    if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'só http(s)' };
    if (isPrivateHost(u.hostname)) return { ok: false, error: 'endereço privado/local proibido (SSRF)' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(u.toString(), { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'Meridiano/2 (+investigacao; contacto no site)' } });
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 2 * 1024 * 1024) return { ok: false, status: res.status, error: 'documento maior do que 2 MB' };
      const raw = Buffer.from(buf).toString('utf8');
      const text = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40000);
      return { ok: res.ok, status: res.status, text, bytes: buf.byteLength, hash: crypto.createHash('sha256').update(buf).digest('hex'), error: res.ok ? null : 'HTTP ' + res.status };
    } catch (e) {
      return { ok: false, error: String(e.message || e).slice(0, 160) };
    } finally { clearTimeout(timer); }
  }

  /* Executor de IA do utilizador: só com credencial VALIDADA e cofre activo.
     Sem isso devolve erro explícito — o motor pára e diz porquê. */
  function aiRunner(user) {
    const cred = store.credentialsOf(user.id).find((c) => c.status === 'operational') || null;
    if (!cred) return null;
    if (!vault.enabled) return null;
    let apiKey = null;
    try { apiKey = vault.open(cred.keyCipher); } catch { return null; }
    return async function ai({ step, project, candidates }) {
      const messages = promptFor(step.id, project, candidates);
      const r = await complete({
        provider: cred.provider, base: (cred.meta && cred.meta.base) || undefined, apiKey,
        model: cred.model, accountId: (cred.meta && cred.meta.accountId) || undefined,
        messages, timeoutMs: 30000
      });
      await store.addUsage({
        userId: user.id, provider: cred.provider, model: cred.model, kind: 'research:' + step.id,
        ok: !!r.ok, promptTokens: r.usage ? r.usage.promptTokens : null,
        completionTokens: r.usage ? r.usage.completionTokens : null, cost: null,
        latencyMs: r.latencyMs != null ? r.latencyMs : null
      });
      if (!r.ok) return { ok: false, error: 'fornecedor recusou: ' + String(r.error).slice(0, 160) };
      const parsed = parseAiJson(r.text);
      return {
        ok: true, provider: cred.provider, model: cred.model, latencyMs: r.latencyMs,
        usage: r.usage, expectsJson: true, parsed: parsed.ok ? parsed.parsed : null,
        note: parsed.ok ? null : parsed.reason
      };
    };
  }

  /* Executor genérico para os agentes de IA: mesmo cofre, mesma credencial validada. */
  function agentAiRunner(user) {
    const cred = store.credentialsOf(user.id).find((c) => c.status === 'operational') || null;
    if (!cred || !vault.enabled) return null;
    let apiKey = null;
    try { apiKey = vault.open(cred.keyCipher); } catch { return null; }
    return async function ai({ messages, timeoutMs }) {
      const r = await complete({
        provider: cred.provider, base: (cred.meta && cred.meta.base) || undefined, apiKey,
        model: cred.model, accountId: (cred.meta && cred.meta.accountId) || undefined,
        messages, timeoutMs: timeoutMs || 30000
      });
      await store.addUsage({
        userId: user.id, provider: cred.provider, model: cred.model, kind: 'agent',
        ok: !!r.ok, promptTokens: r.usage ? r.usage.promptTokens : null,
        completionTokens: r.usage ? r.usage.completionTokens : null, cost: null,
        latencyMs: r.latencyMs != null ? r.latencyMs : null
      });
      if (!r.ok) return { ok: false, error: r.error };
      const parsed = parseAiJson(r.text);
      return { ok: true, provider: cred.provider, model: cred.model, parsed: parsed.ok ? parsed.parsed : null, note: parsed.ok ? null : parsed.reason };
    };
  }

  /* projecto do utilizador (ou null): nunca confiar num id vindo do cliente */
  /* limite simples por utilizador: a verificação de acesso faz pedidos de rede
     a endereços escolhidos pelo utilizador, por isso não pode ser ilimitada */
  function makeLimiter(maxPerHour) {
    const hits = new Map();
    return {
      allowed(userId, n) {
        const now = Date.now();
        const list = (hits.get(userId) || []).filter((t) => now - t < 3600 * 1000);
        hits.set(userId, list);
        return list.length + (n || 1) <= maxPerHour;
      },
      hit(userId) {
        const now = Date.now();
        const list = (hits.get(userId) || []).filter((t) => now - t < 3600 * 1000);
        list.push(now); hits.set(userId, list);
      },
      used(userId) { return (hits.get(userId) || []).filter((t) => Date.now() - t < 3600 * 1000).length; },
      maxPerHour
    };
  }
  const accessLimiter = makeLimiter(60);

  function projectFor(a, pid) { return store.projectByIdFor(pid, a.user.id); }
  function claimFor(a, cid) {
    const c = store.claimById(cid);
    if (!c) return null;
    return projectFor(a, c.projectId) ? c : null;
  }
  function evidenceFor(a, eid) {
    const e = store.evidenceById(eid);
    if (!e) return null;
    return projectFor(a, e.projectId) ? e : null;
  }
  function requireAdmin(a, res) {
    if (!a || a.user.role !== 'ADMIN') { err(res, 403, 'operação restrita a administradores'); return false; }
    return true;
  }

  /* contradições: arestas com prova contrária e conclusões em conflito */
  function contradicoesOf(pid, g) {
    const evById = new Map(store.evidenceOf(pid).map((e) => [e.id, e]));
    const out = g.edges.filter((e) => e.confidence.level === 'contraditoria').map((e) => ({
      tipo: 'relacao', id: e.id, descricao: e.fromName + ' → ' + e.toName + ' (' + e.label + ')',
      provas: e.evidenceIds.map((id) => {
        const ev = evById.get(id);
        return ev ? { id, titulo: ev.title, posicao: ev.stance } : { id };
      })
    }));
    store.claimsOf(pid).forEach((c) => {
      const evs = store.evidenceOf(pid).filter((e) => (c.evidenceIds || []).includes(e.id) && !e.retractedAt);
      const fav = evs.filter((e) => e.stance === 'favoravel');
      const con = evs.filter((e) => e.stance === 'contraria');
      if (fav.length && con.length) {
        out.push({
          tipo: 'conclusao', id: c.id, descricao: c.text, estado: c.state,
          provas: fav.map((e) => ({ id: e.id, titulo: e.title, posicao: 'favoravel' }))
            .concat(con.map((e) => ({ id: e.id, titulo: e.title, posicao: 'contraria' })))
        });
      }
    });
    return out;
  }

  /* grafo do projecto, opcionalmente recortado por período declarado */
  function projectGraph(prj, pid, win) {
    return buildGraph({
      project: prj, evidence: store.evidenceOf(pid), relations: store.relationsOf(pid),
      claims: store.claimsOf(pid), window: win
    });
  }

  /* janela temporal vinda da query. Nomes explícitos (periodFrom/periodTo, ou
     desde/ate) para nunca colidir com «from»/«to», que no grafo são ids de
     entidades para o cálculo de caminho. Inválida é recusada, não ignorada. */
  function windowFrom(url) {
    const g = (k, alt) => url.searchParams.get(k) != null ? url.searchParams.get(k) : url.searchParams.get(alt);
    return periodWindow({ from: g('periodFrom', 'desde'), to: g('periodTo', 'ate') });
  }

  /* Verificação de acesso: um GET por prova, sem conteúdo guardado. */
  async function runAccessCheck(ev, a) {
    const target = ev.canonicalUrl || ev.originalUrl || null;
    const r = await checkAccess(target, { timeoutMs: 10000 });
    const suggestion = accessSuggestion(r);
    const check = {
      status: r.status, stateLabel: r.stateLabel, httpStatus: r.httpStatus, contentType: r.contentType,
      bytes: r.bytes, truncated: r.truncated, ms: r.ms, checkedAt: r.checkedAt, finalUrl: r.finalUrl,
      reason: r.reason, redirects: r.redirects, method: r.method, limitations: r.limitations
    };
    const updated = await store.updateEvidence(ev.id, { access: check, accessSuggestion: suggestion },
      a ? a.user.id : null, 'acesso verificado');
    return { evidence: updated, check, suggestion };
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
          ok: true, version: APP_VERSION, schemaVersion: store.schemaVersion(),
          migrations: store.migrations().map((m) => ({ to: m.to, at: m.at, changes: m.changes })),
          states: STATES.map((id) => ({ id, label: STATE_LABEL[id] })),
          research: { steps: STEPS.length, profiles: Object.keys(PROFILES), promptVersion: PROMPT_VERSION, reportSections: SECTION_TITLES.length },
          agents: { total: AGENTS.length, promptVersion: AGENT_PROMPT_VERSION, local: AGENTS.filter((x) => x.kind === 'local').length, ai: AGENTS.filter((x) => x.kind === 'ai').length },
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
          },
          accessChecks: {
            states: ACCESS_STATE_LABEL, method: ACCESS_METHOD, maxRedirects: MAX_REDIRECTS,
            limits: { porUtilizadorPorHora: 60, porPedido: 10 },
            policy: 'verifica uma página por prova, sem contornar paywalls/registos/CAPTCHAs, sem guardar conteúdo e sem alterar estados de validação'
          },
          quotas: { agentes: QUOTAS, exportacao: 'JSON/SVG/DOT no servidor; PNG gerado no browser a partir do desenho' }
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
        const prj = await store.createProject(a.user.id, projectFields(body));
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
          const updated = await store.updateProject(id, a.user.id, projectFields(body, true));
          await store.audit({ type: 'project_updated', actorId: a.user.id, subjectId: id, action: 'update_project', detail: { fields: Object.keys(body) } });
          return json(res, 200, { ok: true, project: updated });
        }
        if (method === 'DELETE') {
          await store.deleteProject(id, a.user.id);
          await store.audit({ type: 'project_deleted', actorId: a.user.id, subjectId: id, action: 'delete_project' });
          return json(res, 200, { ok: true });
        }
      }

      /* ---------- ciclo de vida do projecto ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/(duplicate|archive|resume|cancel|checkpoints)$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const parts = p.split('/');
        const pid = parts[3], action = parts[4];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        if (action === 'checkpoints') {
          const body = await readBody(req);
          const cp = await store.addCheckpoint(pid, a.user.id, body.label, a.user.id);
          await store.audit({ type: 'project_checkpoint', actorId: a.user.id, subjectId: pid, action: 'checkpoint', detail: { label: cp.label } });
          return json(res, 201, { ok: true, checkpoint: cp });
        }
        if (action === 'duplicate') {
          const copy = await store.duplicateProject(pid, a.user.id);
          await store.audit({ type: 'project_created', actorId: a.user.id, subjectId: copy.id, action: 'duplicate_project', detail: { from: pid } });
          return json(res, 201, { ok: true, project: copy });
        }
        const status = { archive: 'archived', resume: 'active', cancel: 'cancelled' }[action];
        const updated = await store.setProjectStatus(pid, a.user.id, status);
        await store.audit({ type: 'project_status', actorId: a.user.id, subjectId: pid, action, detail: { status } });
        return json(res, 200, { ok: true, project: updated });
      }

      /* ---------- registo de provas ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/evidence$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const list = store.evidenceOf(pid);
        return json(res, 200, { ok: true, count: list.length, evidence: list });
      }
      if (p.match(/^\/api\/projects\/[^/]+\/evidence$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const body = await readBody(req);
        const v = validateEvidence(body);
        if (!v.ok) return err(res, 400, 'prova inválida: ' + v.errors.join('; '), { errors: v.errors });
        const ev = v.evidence;
        ev.dedupeKey = dedupeKey(ev);
        ev.createdBy = a.user.id;
        /* duplicado exacto: devolve o que existe em vez de inflacionar a contagem */
        const dup = store.evidenceByDedupe(pid, ev.dedupeKey);
        if (dup) {
          return json(res, 200, {
            ok: true, duplicate: true, evidence: dup,
            note: 'já existia uma prova com o mesmo conteúdo e URL: não foi duplicada (contaria como duas origens sem o ser)'
          });
        }
        const saved = await store.addEvidence(pid, ev);
        await store.audit({ type: 'evidence_added', actorId: a.user.id, subjectId: saved.id,
          action: 'add_evidence', detail: { projectId: pid, sourceType: ev.sourceType, stance: ev.stance, origin: ev.originKey } });
        await store.count('evidence_added');
        return json(res, 201, { ok: true, evidence: saved, origin: ev.originKey });
      }
      if (p.match(/^\/api\/evidence\/[^/]+$/) && (method === 'PATCH' || method === 'DELETE')) {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const eid = p.split('/')[3];
        const ev = evidenceFor(a, eid);
        if (!ev) return err(res, 404, 'prova não encontrada');
        const body = await readBody(req);
        if (method === 'DELETE') {
          /* Não se apaga prova: retira-se com motivo, e fica registado. */
          const reason = String(body.reason || '').trim();
          if (reason.length < 5) return err(res, 400, 'retirar uma prova exige um motivo escrito (mínimo 5 caracteres)');
          const out = await store.retractEvidence(eid, reason, a.user.id);
          await store.audit({ type: 'evidence_retracted', actorId: a.user.id, subjectId: eid, action: 'retract_evidence',
            reason, detail: { projectId: ev.projectId } });
          return json(res, 200, { ok: true, evidence: out,
            note: 'a prova foi retirada, não apagada: o histórico e as alegações associadas mantêm-se auditáveis' });
        }
        const patch = {};
        if (body.validationState !== undefined) {
          if (!STATES.includes(body.validationState)) return err(res, 400, 'validationState inválido', { allowed: STATES });
          patch.validationState = body.validationState;
        }
        if (body.limitations !== undefined) patch.limitations = String(body.limitations).slice(0, 1000);
        if (body.verificationDate !== undefined) {
          const d = new Date(body.verificationDate);
          if (isNaN(d.getTime())) return err(res, 400, 'verificationDate inválida');
          patch.verificationDate = d.toISOString();
        }
        if (body.stance !== undefined) patch.stance = body.stance;
        if (body.archiveUrl !== undefined) patch.archiveUrl = String(body.archiveUrl).slice(0, 1500);
        if (!Object.keys(patch).length) return err(res, 400, 'nada para actualizar');
        const out = await store.updateEvidence(eid, patch, a.user.id, 'actualizada');
        await store.audit({ type: 'evidence_updated', actorId: a.user.id, subjectId: eid, action: 'update_evidence',
          detail: { fields: Object.keys(patch) } });
        return json(res, 200, { ok: true, evidence: out });
      }

      /* ---------- verificação de acesso às fontes (uma página, a pedido) ----------
         Não contorna barreiras, não guarda conteúdo, não muda estados sozinho. */
      if (p.match(/^\/api\/evidence\/[^/]+\/check-access$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const eid = p.split('/')[3];
        const ev = evidenceFor(a, eid);
        if (!ev) return err(res, 404, 'prova não encontrada');
        if (ev.retractedAt) return err(res, 409, 'a prova está retirada: não se verifica o acesso de prova retirada');
        if (!accessLimiter.allowed(a.user.id)) return err(res, 429, 'demasiadas verificações de acesso nesta hora');
        accessLimiter.hit(a.user.id);
        const out = await runAccessCheck(ev, a);
        await store.audit({ type: 'evidence_access_checked', actorId: a.user.id, subjectId: eid, action: 'check_access',
          ip: ipOf(req), detail: { projectId: ev.projectId, status: out.check.status, httpStatus: out.check.httpStatus } });
        await store.count('access_checks');
        return json(res, 200, { ok: true, evidence: out.evidence, check: out.check, suggestion: out.suggestion });
      }
      if (p.match(/^\/api\/projects\/[^/]+\/check-access$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const body = await readBody(req);
        const limit = Math.max(1, Math.min(10, Number(body.limit) || 5));
        const all = store.evidenceOf(pid).filter((e) => !e.retractedAt);
        let pool = all;
        if (Array.isArray(body.evidenceIds) && body.evidenceIds.length) {
          const want = new Set(body.evidenceIds.map(String));
          pool = all.filter((e) => want.has(e.id));
        }
        /* só se verifica o que tem endereço: inventar um endereço é pior do que não verificar */
        const withoutUrl = pool.filter((e) => !(e.canonicalUrl || e.originalUrl)).length;
        pool = pool.filter((e) => e.canonicalUrl || e.originalUrl).slice(0, limit);
        if (!pool.length) return err(res, 400, 'nenhuma prova com URL para verificar', { withoutUrl });
        if (!accessLimiter.allowed(a.user.id, pool.length)) return err(res, 429, 'demasiadas verificações de acesso nesta hora', { requested: pool.length });
        const results = [];
        for (const ev of pool) {
          accessLimiter.hit(a.user.id);
          const out = await runAccessCheck(ev, a);
          results.push({ id: ev.id, title: ev.title, check: out.check, suggestion: out.suggestion });
          await store.audit({ type: 'evidence_access_checked', actorId: a.user.id, subjectId: ev.id, action: 'check_access',
            ip: ipOf(req), detail: { projectId: pid, bulk: true, status: out.check.status, httpStatus: out.check.httpStatus } });
        }
        await store.count('access_checks_bulk');
        const counts = results.reduce((acc, r) => { acc[r.check.status] = (acc[r.check.status] || 0) + 1; return acc; }, {});
        return json(res, 200, {
          ok: true, checked: results.length, counts, results,
          skipped: { withoutUrl, remainingInProject: Math.max(0, all.filter((e) => e.canonicalUrl || e.originalUrl).length - results.length) },
          note: 'verificação de estado, não de conteúdo: o resultado não altera o estado de validação de nenhuma prova'
        });
      }

      /* ---------- alegações e conclusões ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/claims$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const claims = store.claimsOf(pid).map((c) => {
          const evs = store.evidenceOf(pid).filter((e) => (c.evidenceIds || []).includes(e.id));
          return Object.assign({}, c, { factors: corroboration(evs), suggested: suggestedState(evs) });
        });
        return json(res, 200, { ok: true, claims });
      }
      if (p.match(/^\/api\/projects\/[^/]+\/claims$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const body = await readBody(req);
        const text = String(body.text || '').trim();
        if (text.length < 8) return err(res, 400, 'a alegação precisa de texto (mínimo 8 caracteres)');
        const kind = ['facto', 'alegacao', 'hipotese', 'inferencia'].includes(body.kind) ? body.kind : 'facto';
        const state = STATES.includes(body.state) ? body.state : 'hipotese';
        if (!['hipotese', 'insuficiente', 'alegacao-atribuida'].includes(state)) {
          return err(res, 409, 'uma alegação nova começa como hipótese/insuficiente/alegação atribuída; o estado forte é atribuído depois de reunir provas e é validado pelo servidor');
        }
        const claim = await store.createClaim(pid, {
          text: text.slice(0, 2000), kind, state,
          confidence: ['baixa', 'media', 'alta'].includes(body.confidence) ? body.confidence : null,
          reasoning: String(body.reasoning || '').slice(0, 4000), createdBy: a.user.id
        });
        await store.audit({ type: 'claim_created', actorId: a.user.id, subjectId: claim.id, action: 'create_claim',
          detail: { projectId: pid, kind, state } });
        return json(res, 201, { ok: true, claim });
      }
      if (p.match(/^\/api\/claims\/[^/]+$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const c = claimFor(a, p.split('/')[3]);
        if (!c) return err(res, 404, 'alegação não encontrada');
        const evs = store.evidenceOf(c.projectId).filter((e) => (c.evidenceIds || []).includes(e.id));
        return json(res, 200, { ok: true, claim: c, evidence: evs, factors: corroboration(evs), suggested: suggestedState(evs) });
      }
      if (p.match(/^\/api\/claims\/[^/]+$/) && method === 'PATCH') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const c = claimFor(a, p.split('/')[3]);
        if (!c) return err(res, 404, 'alegação não encontrada');
        const body = await readBody(req);
        const evs = store.evidenceOf(c.projectId).filter((e) => (c.evidenceIds || []).includes(e.id));
        const patch = {};
        if (body.evidenceId !== undefined) {
          const ev = evidenceFor(a, body.evidenceId);
          if (!ev || ev.projectId !== c.projectId) return err(res, 404, 'prova não encontrada neste projecto');
          const on = body.link !== false;
          const linked = await store.linkEvidence(c.id, ev.id, on);
          await store.audit({ type: 'claim_evidence_link', actorId: a.user.id, subjectId: c.id, action: on ? 'link' : 'unlink',
            detail: { evidenceId: ev.id } });
          const evs2 = store.evidenceOf(c.projectId).filter((e) => (linked.evidenceIds || []).includes(e.id));
          return json(res, 200, { ok: true, claim: linked, factors: corroboration(evs2), suggested: suggestedState(evs2) });
        }
        if (body.state !== undefined) {
          if (!STATES.includes(body.state)) return err(res, 400, 'estado inválido', { allowed: STATES, labels: STATE_LABEL });
          const verdict = evaluate(body.state, evs);
          /* O servidor recusa estados que as provas não sustentam. A interface pode
             pedir, mas não pode declarar «confirmada» o que está por provar. */
          if (!verdict.ok) {
            return err(res, 409, 'estado recusado: as provas não sustentam «' + body.state + '»', {
              reasons: verdict.reasons, factors: verdict.factors, suggested: suggestedState(evs)
            });
          }
          patch.state = body.state;
        }
        if (body.confidence !== undefined) patch.confidence = ['baixa', 'media', 'alta', null].includes(body.confidence) ? body.confidence : c.confidence;
        if (body.reasoning !== undefined) patch.reasoning = String(body.reasoning).slice(0, 4000);
        if (body.text !== undefined) patch.text = String(body.text).slice(0, 2000);
        if (!Object.keys(patch).length) return err(res, 400, 'nada para actualizar');
        const updated = await store.updateClaim(c.id, patch, a.user.id, body.state ? 'estado alterado' : 'actualizada');
        await store.audit({ type: 'claim_updated', actorId: a.user.id, subjectId: c.id, action: 'update_claim',
          detail: { from: c.history[c.history.length - 1].from, to: updated.state, fields: Object.keys(patch) } });
        return json(res, 200, { ok: true, claim: updated, factors: corroboration(evs), suggested: suggestedState(evs) });
      }

      /* ---------- agentes ---------- */
      if (p === '/api/agents' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        return json(res, 200, {
          ok: true, promptVersion: AGENT_PROMPT_VERSION,
          agents: AGENTS.map((ag) => ({ id: ag.id, name: ag.name, phase: ag.phase, kind: ag.kind,
            contract: ag.contract, criteria: ag.criteria, limits: ag.limits })),
          note: 'nenhum agente escreve conclusões: os agentes locais só analisam, os de IA devolvem propostas'
        });
      }
      if (p.match(/^\/api\/projects\/[^/]+\/agent-runs$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const quotas = {};
        AGENTS.forEach((ag) => { quotas[ag.id] = quotaState({ runs: store.data.agentRuns || [], userId: a.user.id, projectId: pid, agentId: ag.id }); });
        return json(res, 200, { ok: true, runs: store.agentRunsOf(pid), agents: AGENTS.map((ag) => ag.id), quotas, quotaRules: QUOTAS });
      }
      if (p.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/run$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const parts = p.split('/');
        const pid = parts[3], agentId = parts[5];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        if (!agentById(agentId)) return err(res, 404, 'agente desconhecido', { known: AGENTS.map((x) => x.id) });
        const ctx = {
          project: prj, evidence: store.evidenceOf(pid), claims: store.claimsOf(pid),
          relations: store.relationsOf(pid), runs: store.runsOf(pid)
        };
        const quota = quotaState({ runs: store.data.agentRuns || [], userId: a.user.id, projectId: pid, agentId });
        if (!quota.allowed) {
          await store.audit({ type: 'agent_run_blocked', actorId: a.user.id, subjectId: agentId, action: 'run_agent',
            detail: { projectId: pid, reason: quota.reason, used: quota.used } });
          return err(res, 429, quota.reason, { quota });
        }
        const ai = agentAiRunner(a.user);
        const out = await executeAgent({ store }, agentId, ctx, { ai });
        const saved = await store.addAgentRun(pid, out.run, a.user.id);
        await store.audit({
          type: 'agent_run', actorId: a.user.id, subjectId: saved.id, action: agentId,
          detail: { projectId: pid, status: saved.status, kind: saved.kind,
            findings: saved.findings ? saved.findings.length : null, reason: saved.reason || null }
        });
        await store.count('agent_runs');
        const quotaAfter = quotaState({ runs: store.data.agentRuns || [], userId: a.user.id, projectId: pid, agentId });
        return json(res, 201, { ok: true, run: saved, aiUsed: !!ai, quota: quotaAfter });
      }

      /* ---------- grafo a partir de provas ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/graph$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        const w = windowFrom(url);
        if (!w.ok) return err(res, 400, 'filtro temporal inválido: ' + w.error);
        const g = projectGraph(prj, pid, w.window);
        return json(res, 200, {
          ok: true, graph: g,
          entityTypes: ENTITY_TYPES, relationTypes: RELATION_TYPES,
          contradicoes: contradicoesOf(pid, g),
          caminho: (url.searchParams.get('from') && url.searchParams.get('to'))
            ? shortestPath(g, url.searchParams.get('from'), url.searchParams.get('to')) : null,
          timeline: timelineOf(store, pid, w.window),
          filter: g.filter,
          access: { method: ACCESS_METHOD, maxRedirects: MAX_REDIRECTS, states: ACCESS_STATE_LABEL }
        });
      }

      /* ---------- exportação do grafo (JSON / SVG / DOT) ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/graph\/export$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        const format = String(url.searchParams.get('format') || 'json').toLowerCase();
        if (!['json', 'svg', 'dot'].includes(format)) return err(res, 400, 'formato inválido', { allowed: ['json', 'svg', 'dot'] });
        const w = windowFrom(url);
        if (!w.ok) return err(res, 400, 'filtro temporal inválido: ' + w.error);
        const g = projectGraph(prj, pid, w.window);
        const base = 'meridiano-' + String(prj.id).replace(/[^a-zA-Z0-9-_]/g, '') + '-grafo' +
          (w.window.applied ? '-' + (w.window.from || 'inicio') + '_' + (w.window.to || 'fim') : '');
        let body, type, filename;
        if (format === 'svg') { body = graphToSvg(g, { width: 1100, height: 720 }); type = 'image/svg+xml; charset=utf-8'; filename = base + '.svg'; }
        else if (format === 'dot') { body = graphToDot(g); type = 'text/vnd.graphviz; charset=utf-8'; filename = base + '.dot'; }
        else {
          body = JSON.stringify(graphExportPayload(g, { format: 'json', generatedBy: a.user.id }), null, 2);
          type = 'application/json; charset=utf-8'; filename = base + '.json';
        }
        await store.audit({
          type: 'graph_exported', actorId: a.user.id, subjectId: pid, action: 'export_graph',
          detail: { projectId: pid, format, nodes: g.stats.nodes, edges: g.stats.edges,
            from: w.window.from, to: w.window.to, bytes: Buffer.byteLength(body) }
        });
        await store.count('graph_exports');
        return jsonOrFile(res, 200, body, type, filename);
      }

      if (p.match(/^\/api\/projects\/[^/]+\/relations$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const body = await readBody(req);
        const byId = new Map(store.evidenceOf(pid).map((e) => [e.id, e]));
        const v = validateRelation(body, (id) => {
          const e = byId.get(id);
          return e && !e.retractedAt ? e : null;
        });
        if (!v.ok) return err(res, 400, 'relação recusada: ' + v.errors.join('; '), { errors: v.errors });
        const rel = await store.addRelation(pid, v.relation, a.user.id);
        await store.audit({
          type: 'relation_created', actorId: a.user.id, subjectId: rel.id,
          action: 'create_relation', detail: { projectId: pid, type: rel.type, inferred: rel.inferred, evidence: rel.evidenceIds.length }
        });
        await store.count('relations_created');
        return json(res, 201, { ok: true, relation: rel });
      }
      if (p.match(/^\/api\/relations\/[^/]+$/) && (method === 'PATCH' || method === 'DELETE')) {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const rid = p.split('/')[3];
        const rel = store.relationById(rid);
        if (!rel || !projectFor(a, rel.projectId)) return err(res, 404, 'relação não encontrada');
        const body = await readBody(req);
        if (method === 'DELETE') {
          const reason = String(body.reason || '').trim();
          if (reason.length < 5) return err(res, 400, 'retirar uma relação exige motivo escrito (mínimo 5 caracteres)');
          const out = await store.retractRelation(rid, reason, a.user.id);
          await store.audit({ type: 'relation_retracted', actorId: a.user.id, subjectId: rid, action: 'retract_relation', reason });
          return json(res, 200, { ok: true, relation: out, note: 'retirada, não apagada: o histórico mantém-se' });
        }
        const patch = {};
        if (body.period !== undefined) patch.period = { from: body.period.from || null, to: body.period.to || null };
        if (body.validationState !== undefined) patch.validationState = String(body.validationState).slice(0, 40);
        if (body.limitations !== undefined) patch.limitations = String(body.limitations).slice(0, 1000);
        if (body.reasoning !== undefined) { patch.reasoning = String(body.reasoning).slice(0, 2000); patch.inferred = true; }
        if (body.evidenceIds !== undefined) {
          const byId = new Map(store.evidenceOf(rel.projectId).map((e) => [e.id, e]));
          const ids = (Array.isArray(body.evidenceIds) ? body.evidenceIds : []).map(String);
          const missing = ids.filter((id) => !byId.get(id) || byId.get(id).retractedAt);
          if (!ids.length) return err(res, 400, 'uma relação não pode ficar sem prova: indique pelo menos um evidenceId');
          if (missing.length) return err(res, 400, 'prova inexistente ou retirada: ' + missing.join(', '));
          patch.evidenceIds = ids.slice(0, 50);
        }
        if (!Object.keys(patch).length) return err(res, 400, 'nada para actualizar');
        const out = await store.updateRelation(rid, patch, a.user.id);
        await store.audit({ type: 'relation_updated', actorId: a.user.id, subjectId: rid, action: 'update_relation', detail: { fields: Object.keys(patch) } });
        return json(res, 200, { ok: true, relation: out });
      }

      /* ---------- motor de pesquisa: execuções ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/runs$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        return json(res, 200, { ok: true, runs: store.runsOf(pid), profiles: Object.keys(PROFILES), steps: STEPS.map((s) => ({ n: s.n, id: s.id, title: s.title, kind: s.kind })) });
      }
      if (p.match(/^\/api\/projects\/[^/]+\/runs$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const pid = p.split('/')[3];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        const body = await readBody(req);
        const profile = PROFILES[body.profile] ? body.profile : 'normal';
        const urls = (Array.isArray(body.urls) ? body.urls : []).slice(0, 25)
          .map((u) => String(u).trim()).filter((u) => /^https?:\/\//i.test(u));
        const run = await store.createRun(pid, {
          profile, userId: a.user.id, status: 'running',
          candidates: { urls }, budget: profileOf(profile),
          aiAvailable: !!aiRunner(a.user), vaultReady: vault.enabled
        });
        const ai = aiRunner(a.user);
        const out = await runResearch({ store, ai, fetchDoc }, run.id, { ai });
        await store.audit({
          type: 'research_run', actorId: a.user.id, subjectId: run.id, action: 'run',
          detail: { projectId: pid, profile, status: out.run && out.run.status, stopReason: out.run && out.run.stopReason, urls: urls.length }
        });
        await store.count('research_runs');
        return json(res, 201, { ok: true, run: out.run, aiUsed: !!ai, vaultReady: vault.enabled });
      }
      if (p.match(/^\/api\/runs\/[^/]+$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const rid = p.split('/')[3];
        const run = store.runById(rid);
        if (!run || !projectFor(a, run.projectId)) return err(res, 404, 'execução não encontrada');
        return json(res, 200, { ok: true, run });
      }
      if (p.match(/^\/api\/runs\/[^/]+\/(resume|cancel)$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const parts = p.split('/');
        const rid = parts[3], action = parts[4];
        const run = store.runById(rid);
        if (!run || !projectFor(a, run.projectId)) return err(res, 404, 'execução não encontrada');
        if (action === 'cancel') {
          if (!['pending', 'running'].includes(run.status)) return err(res, 409, 'execução já terminada (' + run.status + '): não há nada para cancelar');
          const updated = await store.updateRun(rid, { status: 'cancelled', stopReason: 'cancelado-pelo-utilizador', finishedAt: new Date().toISOString() });
          await store.audit({ type: 'research_run', actorId: a.user.id, subjectId: rid, action: 'cancel', detail: { status: updated.status } });
          return json(res, 200, { ok: true, run: updated });
        }
        if (run.status === 'aguarda-revisao-humana') return err(res, 409, 'execução já concluída: nada para retomar');
        if (run.status === 'cancelled') return err(res, 409, 'execução cancelada: crie uma nova');
        await store.updateRun(rid, { status: 'running' });
        const ai = aiRunner(a.user);
        const out = await runResearch({ store, ai, fetchDoc }, rid, { ai });
        await store.audit({ type: 'research_run', actorId: a.user.id, subjectId: rid, action: 'resume', detail: { status: out.run && out.run.status } });
        return json(res, 200, { ok: true, run: out.run });
      }

      /* ---------- relatório de 18 secções ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/report$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        const rep = buildReport({
          project: prj, evidence: store.evidenceOf(pid), claims: store.claimsOf(pid),
          runs: store.runsOf(pid), relations: store.relationsOf(pid),
          usage: store.data.usage.filter((u) => u.userId === a.user.id)
        });
        if (String(url.searchParams.get('format') || 'json') === 'md') {
          const md = reportToMarkdown(rep);
          res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(md);
        }
        return json(res, 200, Object.assign({ ok: true }, rep, { sectionTitles: SECTION_TITLES }));
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
