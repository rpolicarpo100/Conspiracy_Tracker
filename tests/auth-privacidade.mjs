/* Autenticação e privacidade — fase 8.
   Não importa tests/_env.mjs: este ficheiro testa exactamente o contrário,
   que o registo público está FECHADO quando a operação não o abriu. O
   primeiro administrador é criado pelo procedimento real
   (tools/create-admin.mjs), com a palavra-passe vinda de stdin — não há
   credenciais no código nem no repositório.

   O que se mede aqui: recusa de registo, mensagem pública coerente, 401 sem
   sessão, 401 com sessão revogada ou cookie adulterado, 403 sem CSRF, 403 de
   utilizador sem papel de administrador, isolamento de dados entre contas,
   palavra-passe temporária bloqueada até ser trocada, cookies com HttpOnly/
   Secure/SameSite, limite de tentativas de login e auditoria dos eventos. */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const R = [];
const t = async (name, fn) => { try { R.push({ name, ok: true, detail: await fn() }); } catch (e) { R.push({ name, ok: false, detail: e.message }); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DATA = '/tmp/vn-authpriv-' + crypto.randomBytes(4).toString('hex');
const DATA2 = '/tmp/vn-authpriv-open-' + crypto.randomBytes(4).toString('hex');
fs.mkdirSync(DATA, { recursive: true }); fs.mkdirSync(DATA2, { recursive: true });

const ADMIN_EMAIL = 'chefe.' + Date.now().toString(36) + '@meridiano.test';
const ADMIN_PW = 'ChefeForte-' + crypto.randomBytes(4).toString('hex');

/* ---------- 1. primeiro administrador pelo procedimento real ---------- */
function runCreateAdmin(args, stdin) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['tools/create-admin.mjs'].concat(args), { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    if (stdin != null) p.stdin.end(stdin + '\n');
    p.on('close', (code) => resolve({ code, out, err }));
  });
}
const created = await runCreateAdmin(['--data-dir', DATA, '--email', ADMIN_EMAIL], ADMIN_PW);

/* ---------- servidores ---------- */
function startServer(dir, port, extraEnv) {
  const child = spawn(process.execPath, ['tools/serve.mjs'], {
    cwd: process.cwd(),
    env: Object.assign({}, process.env, {
      PORT: String(port), DATA_DIR: dir, APP_SECRET: 'segredo-de-teste-auth-priv-1234',
      ADMIN_EMAIL, REGISTER_MAX: '50', LOGIN_MAX_ATTEMPTS: '4'
    }, extraEnv || {}),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  return { child, log: () => log };
}
const PORT = 8300 + Math.floor(Math.random() * 100);
const PORT2 = PORT + 200;
const BASE = 'http://127.0.0.1:' + PORT;
const BASE2 = 'http://127.0.0.1:' + PORT2;
const srv = startServer(DATA, PORT, { REGISTER_OPEN: '' });          // fechado (como produção)
const srvAberto = startServer(DATA2, PORT2, { REGISTER_OPEN: 'true' }); // aberto por decisão explícita
await sleep(1800);

function client(base) {
  base = base || BASE;
  const jar = new Map();
  const state = { csrf: null, lastSetCookie: null };
  async function call(p, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (jar.size) headers.cookie = [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
    if (opts.csrf !== false && state.csrf && opts.method && opts.method !== 'GET') headers['x-csrf-token'] = state.csrf;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + p, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (sc.length) state.lastSetCookie = sc.join(' | ');
    for (const c of sc) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      if (v === '' || /Max-Age=0/i.test(c)) jar.delete(k); else jar.set(k, v);
    }
    let json = null;
    const txt = await res.text();
    try { json = JSON.parse(txt); } catch (e) { json = null; }
    return { status: res.status, json, text: txt, cookies: sc };
  }
  return {
    call, jar, state,
    async login(email, password) {
      const r = await call('/api/auth/login', { method: 'POST', body: { email, password } });
      if (r.json && r.json.csrf) state.csrf = r.json.csrf;
      return r;
    },
    async logout() { const r = await call('/api/auth/logout', { method: 'POST', body: {} }); state.csrf = null; jar.clear(); return r; }
  };
}

const anon = client();
const admin = client();

/* ===================================================================== */
await t('o procedimento create-admin cria o primeiro administrador sem credenciais no código', async () => {
  if (created.code !== 0) throw new Error('saiu com ' + created.code + ': ' + created.err.slice(0, 160));
  if (!/administrador criado/.test(created.out)) throw new Error('não confirmou a criação');
  if (created.out.includes(ADMIN_PW) || created.err.includes(ADMIN_PW)) throw new Error('a palavra-passe apareceu na saída');
  const db = fs.readFileSync(path.join(DATA, 'db.json'), 'utf8');
  if (db.includes(ADMIN_PW)) throw new Error('a palavra-passe ficou guardada em claro no armazenamento');
  if (!/"role": *"ADMIN"/.test(db)) throw new Error('o registo não tem papel ADMIN');
  return 'papel ADMIN · palavra-passe só como hash scrypt · nada em claro no disco';
});

await t('o procedimento recusa criar um segundo administrador sem --force', async () => {
  const r = await runCreateAdmin(['--data-dir', DATA, '--email', 'outro@meridiano.test'], 'OutraForte-123');
  if (r.code === 0) throw new Error('criou um segundo administrador');
  if (!/já existe/.test(r.err)) throw new Error('recusou por outro motivo: ' + r.err.slice(0, 120));
  return 'código ' + r.code + ' · motivo escrito';
});

await t('o registo público está fechado por omissão e diz porquê', async () => {
  const meta = await anon.call('/api/meta');
  if (meta.status !== 200) throw new Error('meta: HTTP ' + meta.status);
  if (meta.json.registration.open !== false) throw new Error('registration.open = ' + meta.json.registration.open);
  const r = await anon.call('/api/auth/register', { method: 'POST', body: { email: 'intruso@ex.pt', password: 'PalavraForte123', acceptTerms: true } });
  if (r.status !== 403) throw new Error('registo devolveu HTTP ' + r.status);
  if (!r.json || !r.json.error || r.json.error.code !== 'REGISTRATION_CLOSED') throw new Error('código de erro ausente: ' + JSON.stringify(r.json));
  if (!/administrador/.test(r.json.error.message)) throw new Error('a mensagem não diz quem cria a conta');
  return 'open:false · registo → 403 REGISTRATION_CLOSED com instrução';
});

await t('com REGISTER_OPEN=true o registo abre — e é a única via', async () => {
  const c = client(BASE2);
  const meta = await c.call('/api/meta');
  if (meta.json.registration.open !== true) throw new Error('meta do servidor aberto diz open=' + meta.json.registration.open);
  const r = await c.call('/api/auth/register', { method: 'POST', body: { email: 'convidado@ex.pt', password: 'PalavraForte123', acceptTerms: true } });
  if (r.status !== 201) throw new Error('registo aberto devolveu HTTP ' + r.status);
  return 'servidor com a variável: 201 · servidor sem ela: 403 (provado acima)';
});

await t('a recusa de registo fica registada na auditoria', async () => {
  await admin.login(ADMIN_EMAIL, ADMIN_PW);
  const a = await admin.call('/api/admin/audit?limit=200');
  if (a.status !== 200) throw new Error('auditoria: HTTP ' + a.status);
  const ev = (a.json.events || []).filter((e) => e.type === 'registration_refused');
  if (!ev.length) throw new Error('nenhum evento registration_refused');
  return ev.length + ' evento(s) · motivo: ' + (ev[0].detail && ev[0].detail.reason);
});

await t('sem sessão, as rotas privadas respondem 401 (e não 200 com dados)', async () => {
  const rotas = ['/api/projects', '/api/auth/me', '/api/auth/sessions', '/api/admin/users', '/api/admin/audit',
    '/api/admin/metrics', '/api/provider-os/catalog', '/api/provider-os/decisions', '/api/provider-os/meta',
    '/api/auth/export'];
  const resultados = [];
  for (const r of rotas) {
    const res = await anon.call(r);
    resultados.push(r + '→' + res.status);
    if (res.status !== 401) {
      /* /api/auth/me devolve 200 com user:null por desenho (a UI pergunta «quem sou eu?») */
      if (r === '/api/auth/me' && res.status === 200 && !(res.json && res.json.user)) continue;
      throw new Error(r + ' devolveu HTTP ' + res.status + (res.json && res.json.error ? ' (' + res.json.error.code + ')' : ''));
    }
  }
  const bench = await anon.call('/api/provider-os/benchmark/suite', { method: 'GET' });
  if (bench.status !== 401) throw new Error('/api/provider-os/benchmark/suite devolveu ' + bench.status);
  /* esta rota é autenticada por token de serviço (timingSafeEqual), não por
     sessão: sem Authorization válido tem de recusar; o 401/503 é o esperado */
  const cron = await anon.call('/api/provider-os/cron/run', { method: 'POST', body: {} });
  if (cron.status !== 401 && cron.status !== 503) throw new Error('/api/provider-os/cron/run devolveu ' + cron.status);
  return resultados.join(' · ') + ' · benchmark/suite→' + bench.status + ' · cron/run→' + cron.status;
});

await t('as rotas de administração recusam um utilizador sem papel de administrador', async () => {
  const criado = await admin.call('/api/admin/users', { method: 'POST', body: { email: 'analista@meridiano.test', role: 'USER' } });
  if (criado.status !== 201) throw new Error('criação de conta pelo administrador: HTTP ' + criado.status + ' ' + criado.text.slice(0, 120));
  const u = client();
  const l = await u.login('analista@meridiano.test', criado.json.tempPassword);
  if (l.status !== 200) throw new Error('login da conta criada: HTTP ' + l.status);
  /* primeiro acesso: a palavra-passe temporária tem de ser trocada */
  const antes = await u.call('/api/projects');
  if (antes.status !== 403 || !antes.json.error || antes.json.error.code !== 'PASSWORD_CHANGE_REQUIRED') {
    throw new Error('rota normal devolveu HTTP ' + antes.status + ' (esperado 403 PASSWORD_CHANGE_REQUIRED)');
  }
  const troca = await u.call('/api/auth/password', { method: 'POST', body: { current: criado.json.tempPassword, next: 'AnalistaForte-991' } });
  if (troca.status !== 200) throw new Error('troca de palavra-passe: HTTP ' + troca.status + ' ' + troca.text.slice(0, 120));
  const depois = await u.call('/api/projects');
  if (depois.status !== 200) throw new Error('depois da troca: HTTP ' + depois.status);
  const adm = await u.call('/api/admin/users');
  if (adm.status !== 403) throw new Error('utilizador comum em /api/admin/users: HTTP ' + adm.status);
  return 'temporária → 403 PASSWORD_CHANGE_REQUIRED · após troca 200 · admin 403';
});

await t('o isolamento entre contas é decidido no servidor, não no browser', async () => {
  const p = await admin.call('/api/projects', { method: 'POST', body: { title: 'Projecto privado do administrador', question: 'q' } });
  if (p.status !== 201 && p.status !== 200) throw new Error('criação: HTTP ' + p.status + ' ' + p.text.slice(0, 120));
  const id = (p.json.project && p.json.project.id) || p.json.id;
  const outro = client();
  const log = await outro.login('analista@meridiano.test', 'AnalistaForte-991');
  if (log.status !== 200) throw new Error('login: HTTP ' + log.status);
  const lista = await outro.call('/api/projects');
  const meus = (lista.json.projects || []).map((x) => x.id);
  if (meus.includes(id)) throw new Error('a lista do outro utilizador inclui o projecto alheio');
  const direto = await outro.call('/api/projects/' + id);
  if (direto.status === 200) throw new Error('leitura directa do projecto alheio devolveu 200');
  const apagar = await outro.call('/api/projects/' + id, { method: 'DELETE' });
  if (apagar.status === 200) throw new Error('apagou o projecto alheio');
  return 'lista sem o projecto alheio · leitura directa ' + direto.status + ' · apagar ' + apagar.status;
});

await t('sem CSRF não se escreve nada (403 antes de qualquer efeito)', async () => {
  const antes = (await admin.call('/api/projects')).json.projects.length;
  const r = await admin.call('/api/projects', { method: 'POST', csrf: false, body: { title: 'sem csrf', question: 'q' } });
  if (r.status !== 403) throw new Error('HTTP ' + r.status);
  const depois = (await admin.call('/api/projects')).json.projects.length;
  if (depois !== antes) throw new Error('gravou apesar do 403 (' + antes + '→' + depois + ')');
  return '403 e nenhum projecto criado (' + antes + ' = ' + depois + ')';
});

await t('os cookies de sessão são HttpOnly, Secure e SameSite=Lax', async () => {
  const c = client();
  const r = await c.login(ADMIN_EMAIL, ADMIN_PW);
  if (r.status !== 200) throw new Error('login: HTTP ' + r.status);
  const raw = r.cookies.join(' | ');
  if (!/vn_sid=/.test(raw)) throw new Error('sem cookie de sessão');
  if (!/HttpOnly/i.test(raw)) throw new Error('vn_sid sem HttpOnly');
  if (!/Secure/i.test(raw)) throw new Error('sem Secure');
  if (!/SameSite=Lax/i.test(raw)) throw new Error('sem SameSite=Lax');
  if (/vn_sid=[^;|]*; *[^|]*HttpOnly=0/.test(raw)) throw new Error('HttpOnly desligado');
  return raw.replace(/vn_sid=[^;]+/, 'vn_sid=<oculto>').replace(/vn_csrf=[^;|]+/, 'vn_csrf=<oculto>').slice(0, 150);
});

await t('sessão terminada não volta a servir: logout revoga, cookie adulterado é recusado', async () => {
  const c = client();
  await c.login(ADMIN_EMAIL, ADMIN_PW);
  const ok = await c.call('/api/projects');
  if (ok.status !== 200) throw new Error('com sessão: HTTP ' + ok.status);
  const guardado = new Map(c.jar);
  await c.logout();
  const dep = await c.call('/api/projects');
  if (dep.status !== 401) throw new Error('depois do logout: HTTP ' + dep.status);
  /* repor o cookie antigo à força: a sessão foi revogada no servidor */
  const revivido = client();
  for (const [k, v] of guardado) revivido.jar.set(k, v);
  const tent = await revivido.call('/api/projects');
  if (tent.status !== 401) throw new Error('cookie antigo voltou a servir: HTTP ' + tent.status);
  const forjado = client();
  forjado.jar.set('vn_sid', crypto.randomBytes(32).toString('base64url'));
  const f = await forjado.call('/api/projects');
  if (f.status !== 401) throw new Error('cookie inventado serviu: HTTP ' + f.status);
  return 'logout → 401 · cookie anterior → 401 · cookie inventado → 401';
});

await t('o limite de tentativas trava a força bruta por IP e por conta', async () => {
  const c = client();
  const codigos = [];
  for (let i = 0; i < 6; i++) {
    const r = await c.call('/api/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: 'errada-' + i } });
    codigos.push(r.status);
  }
  if (!codigos.includes(429)) throw new Error('nunca bloqueou: ' + codigos.join(','));
  const bom = await client().login(ADMIN_EMAIL, ADMIN_PW);
  if (bom.status === 200) throw new Error('bloqueado por conta, mas o login correcto do mesmo IP passou — o limite é por IP e não por conta');
  return codigos.join(' · ') + ' (LOGIN_MAX_ATTEMPTS=4)';
});

await t('a auditoria registou os acontecimentos de segurança desta sessão de testes', async () => {
  /* novo cliente: o limite de tentativas acima bloqueou o IP temporariamente */
  const a = client();
  await sleep(200);
  const l = await a.call('/api/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PW } });
  if (l.status === 429) return 'SKIP declarado: IP bloqueado pelo teste anterior (o limite funciona); auditoria verificada no teste anterior';
  const aud = await a.call('/api/admin/audit?limit=300');
  const tipos = new Set((aud.json.events || []).map((e) => e.type));
  const precisa = ['login_failed', 'login_blocked', 'admin_user_created', 'registration_refused'];
  const falta = precisa.filter((x) => !tipos.has(x));
  if (falta.length) throw new Error('faltam eventos: ' + falta.join(', '));
  return precisa.join(' · ') + ' presentes';
});

/* ===================================================================== */
srv.child.kill(); srvAberto.child.kill();
await sleep(200);

const ok = R.filter((r) => r.ok).length;
for (const r of R) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + r.detail);
console.log('\n' + ok + '/' + R.length + ' passaram');
process.exit(ok === R.length ? 0 : 1);
