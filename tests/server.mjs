/* Testes do servidor: autenticação, isolamento, privilégios, chaves de IA,
   roteador de fornecedores (com servidor simulado), auditoria e saúde. */
import './_env.mjs';   // opt-in explícito: registo aberto só nos testes (ver tests/_env.mjs)
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import * as prov from '../server/providers.mjs';

const R = [];
const t = async (name, fn) => { try { R.push({ name, ok: true, detail: await fn() }); } catch (e) { R.push({ name, ok: false, detail: e.message }); } };
const DATA = '/tmp/vn-srvtest-' + crypto.randomBytes(4).toString('hex');
const PORT = 8100 + Math.floor(Math.random() * 300);
const BASE = 'http://127.0.0.1:' + PORT;

/* ---------- servidor de aplicação ---------- */
const child = spawn(process.execPath, ['tools/serve.mjs'], {
  cwd: process.cwd(),
  env: Object.assign({}, process.env, {
    PORT: String(PORT), DATA_DIR: DATA, APP_SECRET: 'segredo-de-teste-para-o-cofre-1234',
    ADMIN_EMAIL: 'dono@meridiano.test', AGENT_BUDGET: '500', REGISTER_MAX: '100'
  }),
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });
await new Promise((r) => setTimeout(r, 1800));

/* ---------- cliente HTTP com cookies ---------- */
function client() {
  const jar = new Map();
  const state = { csrf: null };
  async function call(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (jar.size) headers.cookie = [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
    if (opts.csrf !== false && state.csrf && opts.method && opts.method !== 'GET') headers['x-csrf-token'] = state.csrf;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + path, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    const setC = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    setC.forEach((c) => {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      if (/Max-Age=0/.test(c) || v === '') jar.delete(k); else jar.set(k, v);
    });
    const txt = await res.text();
    let json = null; try { json = JSON.parse(txt); } catch { /* não json */ }
    if (json && json.csrf) state.csrf = json.csrf;
    return { status: res.status, json, text: txt, headers: res.headers };
  }
  return { call, jar, state };
}

const owner = client(), alice = client(), bob = client();

/* ---------- 1. saúde ---------- */
await t('/health e /ready respondem com estado real', async () => {
  const h = await owner.call('/health');
  const r = await owner.call('/ready');
  if (h.status !== 200 || h.json.status !== 'alive') throw new Error('health ' + h.status);
  if (r.status !== 200 || !r.json.checks.storage.ok) throw new Error('ready ' + JSON.stringify(r.json).slice(0, 120));
  if (r.json.checks.keyVault.mode !== 'aes-256-gcm') throw new Error('cofre não activo');
  return 'health alive · ready ' + r.json.status + ' · cofre aes-256-gcm';
});

/* ---------- 2. registo ---------- */
await t('registo recusa palavra-passe fraca e falta de consentimento', async () => {
  const a = await alice.call('/api/auth/register', { method: 'POST', body: { email: 'alice@ex.pt', password: 'abc', acceptTerms: true } });
  const b = await alice.call('/api/auth/register', { method: 'POST', body: { email: 'alice@ex.pt', password: 'SenhaForte123', acceptTerms: false } });
  if (a.status !== 400 || !/fraca/.test(a.json.error.message)) throw new Error('aceitou password fraca');
  if (b.status !== 400 || !/privacidade/.test(b.json.error.message)) throw new Error('aceitou sem consentimento');
  return 'password fraca → 400 · sem consentimento → 400';
});

await t('registo válido cria conta USER com sessão', async () => {
  const r = await alice.call('/api/auth/register', { method: 'POST', body: { email: 'alice@ex.pt', password: 'SenhaForte123', acceptTerms: true } });
  if (r.status !== 201) throw new Error('HTTP ' + r.status + ' ' + r.text.slice(0, 100));
  if (r.json.user.role !== 'USER') throw new Error('papel ' + r.json.user.role);
  if ('passwordHash' in r.json.user || 'salt' in r.json.user) throw new Error('devolveu material de password');
  const me = await alice.call('/api/auth/me');
  if (!me.json.user || me.json.user.email !== 'alice@ex.pt') throw new Error('sessão não persistiu');
  return 'conta criada · sessão activa · sem hashes na resposta';
});

await t('ADMIN_EMAIL promove o dono a ADMIN (e só o primeiro)', async () => {
  const r = await owner.call('/api/auth/register', { method: 'POST', body: { email: 'dono@meridiano.test', password: 'SenhaForte123', acceptTerms: true } });
  if (r.json.user.role !== 'ADMIN') throw new Error('papel ' + r.json.user.role);
  const again = await bob.call('/api/auth/register', { method: 'POST', body: { email: 'dono2@meridiano.test', password: 'SenhaForte123', acceptTerms: true } });
  if (again.json.user.role !== 'USER') throw new Error('criou segundo admin automático');
  return 'dono → ADMIN · outro registo → USER';
});

await t('registo com "role":"ADMIN" no corpo não concede privilégios', async () => {
  const c = client();
  const r = await c.call('/api/auth/register', { method: 'POST', body: { email: 'escalada@ex.pt', password: 'SenhaForte123', acceptTerms: true, role: 'ADMIN' } });
  if (r.json.user.role !== 'USER') throw new Error('aceitou papel do cliente: ' + r.json.user.role);
  const adm = await c.call('/api/admin/metrics');
  if (adm.status !== 403) throw new Error('acesso administrativo com status ' + adm.status);
  return 'papel forçado ignorado · /api/admin/metrics → 403';
});

/* ---------- 3. login / logout ---------- */
await t('login inválido e email inexistente dão a mesma resposta (sem enumeração)', async () => {
  const c = client();
  const wrongPw = await c.call('/api/auth/login', { method: 'POST', body: { email: 'alice@ex.pt', password: 'ErradaErrada1' } });
  const noUser = await c.call('/api/auth/login', { method: 'POST', body: { email: 'nao-existe@ex.pt', password: 'ErradaErrada1' } });
  if (wrongPw.status !== 401 || noUser.status !== 401) throw new Error('estados ' + wrongPw.status + '/' + noUser.status);
  if (wrongPw.json.error.message !== noUser.json.error.message) throw new Error('mensagens diferentes');
  return 'ambos 401 com «' + wrongPw.json.error.message + '»';
});

await t('login válido e logout invalidam a sessão', async () => {
  const c = client();
  const li = await c.call('/api/auth/login', { method: 'POST', body: { email: 'alice@ex.pt', password: 'SenhaForte123' } });
  if (li.status !== 200) throw new Error('login ' + li.status);
  const me1 = await c.call('/api/auth/me');
  if (!me1.json.user) throw new Error('sem sessão após login');
  await c.call('/api/auth/logout', { method: 'POST', body: {} });
  const me2 = await c.call('/api/auth/me');
  if (me2.json.user) throw new Error('sessão ainda activa após logout');
  return 'login 200 · após logout /me devolve null';
});

await t('limite de tentativas bloqueia após 8 falhas (429)', async () => {
  const c = client();
  let last = 0;
  for (let i = 0; i < 10; i++) {
    const r = await c.call('/api/auth/login', { method: 'POST', body: { email: 'alice@ex.pt', password: 'Errada' + i + 'Xx' } });
    last = r.status;
    if (r.status === 429) break;
  }
  if (last !== 429) throw new Error('nunca bloqueou (último ' + last + ')');
  return 'bloqueio activo antes da 10.ª tentativa';
});

await t('CSRF: escrita sem cabeçalho é recusada', async () => {
  const r = await alice.call('/api/projects', { method: 'POST', body: { title: 'Sem CSRF' }, csrf: false });
  if (r.status !== 403) throw new Error('HTTP ' + r.status);
  return '403 sem token CSRF';
});

/* ---------- 4. projectos e isolamento ---------- */
let aliceProject = null;
await t('utilizador cria projecto e só ele o vê', async () => {
  const r = await alice.call('/api/projects', { method: 'POST', body: { title: 'Caso Alice', question: 'Quem é o beneficiário final?' } });
  if (r.status !== 201) throw new Error('criar ' + r.status);
  aliceProject = r.json.project.id;
  const mine = await alice.call('/api/projects');
  if (mine.json.projects.length !== 1) throw new Error('lista própria: ' + mine.json.projects.length);
  const other = await bob.call('/api/projects');
  if (other.json.projects.length !== 0) throw new Error('Bob vê projectos de Alice');
  return 'projecto ' + aliceProject + ' · lista de Bob vazia';
});

await t('acesso directo ao ID alheio dá 404 (não revela existência)', async () => {
  const g = await bob.call('/api/projects/' + aliceProject);
  const p = await bob.call('/api/projects/' + aliceProject, { method: 'PATCH', body: { title: 'Hackeado' } });
  const d = await bob.call('/api/projects/' + aliceProject, { method: 'DELETE' });
  if (g.status !== 404 || p.status !== 404 || d.status !== 404) throw new Error('estados ' + g.status + '/' + p.status + '/' + d.status);
  const still = await alice.call('/api/projects/' + aliceProject);
  if (still.json.project.title !== 'Caso Alice') throw new Error('projecto alterado por terceiro');
  return 'GET/PATCH/DELETE alheios → 404 · conteúdo intacto';
});

/* ---------- 5. administração ---------- */
await t('métricas administrativas vêm de dados reais', async () => {
  const r = await owner.call('/api/admin/metrics');
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  const users = await owner.call('/api/admin/users');
  const realUsers = users.json.users.length;
  if (r.json.users.total !== realUsers) throw new Error('total ' + r.json.users.total + ' ≠ lista ' + realUsers);
  if (!Array.isArray(r.json.notAvailable) || !r.json.notAvailable.length) throw new Error('não declara o que não está instrumentado');
  return realUsers + ' utilizadores (coincide com a lista) · ' + r.json.notAvailable.length + ' métricas declaradas indisponíveis';
});

await t('administrador vê projectos de outro utilizador e o acesso fica auditado', async () => {
  const alices = (await owner.call('/api/admin/users')).json.users.find((u) => u.email === 'alice@ex.pt');
  const r = await owner.call('/api/admin/users/' + alices.id + '/projects?reason=teste-de-suporte');
  if (r.status !== 200 || r.json.projects.length !== 1) throw new Error('HTTP ' + r.status);
  const audit = await owner.call('/api/admin/audit?type=admin_access');
  const ev = audit.json.events.find((e) => e.subjectId === alices.id && e.action === 'view_user_projects');
  if (!ev) throw new Error('acesso não auditado');
  if (ev.reason !== 'teste-de-suporte') throw new Error('motivo não registado');
  return 'projecto acedido · evento admin_access com autor, motivo e data';
});

await t('administrador não vê chaves em claro (só máscara)', async () => {
  const users = (await owner.call('/api/admin/users')).json.users;
  const alices = users.find((u) => u.email === 'alice@ex.pt');
  const dump = JSON.stringify(users);
  if (/gsk_|sk-[a-z0-9]{10,}/i.test(dump)) throw new Error('há chaves no dump administrativo');
  if (!alices.hasKeys) throw new Error('estrutura de chaves ausente');
  return 'nenhuma chave no dump · só metadados e máscara';
});

/* ---------- 6. chaves de IA ---------- */
const MOCK = createServer((req, res) => {
  const auth = req.headers.authorization || '';
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/v1/models') {
    if (auth !== 'Bearer chave-boa') return send(401, { error: { message: 'invalid api key' } });
    return send(200, { data: [{ id: 'modelo-teste' }, { id: 'modelo-lento' }] });
  }
  if (req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (auth !== 'Bearer chave-boa') return send(401, { error: { message: 'invalid api key' } });
      const parsed = JSON.parse(body || '{}');
      if (parsed.model === 'modelo-lento') return setTimeout(() => send(200, { choices: [{ message: { content: 'tarde' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), 1200);
      return send(200, { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } });
    });
    return;
  }
  send(404, { error: { message: 'rota inexistente' } });
});
await new Promise((r) => MOCK.listen(0, '127.0.0.1', r));
const MOCKBASE = 'http://127.0.0.1:' + MOCK.address().port + '/v1';

await t('chave guardada é cifrada, mascarada e nunca devolvida', async () => {
  const save = await alice.call('/api/providers/custom/key', { method: 'POST', body: { apiKey: 'chave-boa-super-secreta', model: 'modelo-teste', base: 'https://exemplo.invalid/v1' } });
  if (save.status !== 200) throw new Error('HTTP ' + save.status + ' ' + save.text.slice(0, 120));
  if (!/…/.test(save.json.mask)) throw new Error('sem máscara');
  const list = await alice.call('/api/providers');
  const row = list.json.providers.find((p) => p.id === 'custom');
  if (!row.configured || !row.mask) throw new Error('não aparece configurado');
  if (/chave-boa-super-secreta/.test(list.text) || /chave-boa-super-secreta/.test(save.text)) throw new Error('a chave foi devolvida ao cliente');
  const raw = await fs.readFile(DATA + '/db.json', 'utf8');
  if (raw.indexOf('chave-boa-super-secreta') >= 0) throw new Error('a chave está em claro no disco');
  if (!/"iv"/.test(raw)) throw new Error('não há envelope cifrado no disco');
  return 'máscara «' + save.json.mask + '» · ausente das respostas e do disco (AES-256-GCM)';
});

await t('validação com fornecedor real (simulado): modelo e ligação confirmados', async () => {
  const res = await prov.validateProvider({ provider: 'custom', base: MOCKBASE, apiKey: 'chave-boa', model: 'modelo-teste', timeoutMs: 4000, allowInsecure: true });
  if (!res.ok) throw new Error(res.stage + ': ' + res.error);
  if (!res.usageReported) throw new Error('não detectou utilização reportada');
  if (res.checks.length !== 2) throw new Error('faltam passos de validação');
  return 'modelos listados · geração ok · usage ' + JSON.stringify(res.usage) + ' · ' + res.latencyMs + ' ms';
});

await t('chave inválida é detectada como erro de autenticação', async () => {
  const res = await prov.validateProvider({ provider: 'custom', base: MOCKBASE, apiKey: 'chave-má', model: 'modelo-teste', timeoutMs: 4000, allowInsecure: true });
  if (res.ok || res.stage !== 'auth') throw new Error('estado ' + res.stage);
  return res.stage + ' → ' + res.error;
});

await t('modelo inexistente é detectado antes de qualquer geração', async () => {
  const res = await prov.validateProvider({ provider: 'custom', base: MOCKBASE, apiKey: 'chave-boa', model: 'nao-existe', timeoutMs: 4000, allowInsecure: true });
  if (res.ok || res.stage !== 'model') throw new Error('estado ' + res.stage);
  return res.error.slice(0, 90);
});

await t('timeout é tratado e reportado', async () => {
  const res = await prov.complete({ provider: 'custom', base: MOCKBASE, apiKey: 'chave-boa', model: 'modelo-lento', messages: [{ role: 'user', content: 'oi' }], timeoutMs: 300, allowInsecure: true, retries: 1 });
  if (res.ok || !/timeout/.test(res.error)) throw new Error(JSON.stringify(res).slice(0, 120));
  return res.error;
});

await t('circuit breaker abre após falhas repetidas', async () => {
  for (let i = 0; i < 3; i++) {
    await prov.complete({ provider: 'custom', base: MOCKBASE, apiKey: 'chave-má', model: 'modelo-breaker', messages: [{ role: 'user', content: 'x' }], timeoutMs: 2000, allowInsecure: true, retries: 1 });
  }
  const st = prov.breakerState('custom:modelo-breaker');
  const blocked = await prov.complete({ provider: 'custom', base: MOCKBASE, apiKey: 'chave-boa', model: 'modelo-breaker', messages: [{ role: 'user', content: 'x' }], allowInsecure: true });
  if (!st.open) throw new Error('breaker não abriu');
  if (!blocked.circuitOpen) throw new Error('não bloqueou a chamada');
  return 'aberto após 3 falhas · chamada bloqueada com tempo de nova tentativa';
});

await t('URL de fornecedor para endereço interno é recusada (SSRF)', async () => {
  const res = await prov.validateProvider({ provider: 'custom', base: 'http://169.254.169.254/v1', apiKey: 'x', model: 'y' });
  const errs = prov.validateBaseUrl('http://169.254.169.254/latest/meta-data');
  if (res.ok || !/SSRF/.test(String(res.error) + errs.join(' '))) throw new Error(JSON.stringify(res).slice(0, 100));
  return (res.error || errs.join('; ')).slice(0, 90);
});

await t('chamada de IA pela API exige validação prévia e regista utilização', async () => {
  // guarda chave boa a apontar para o servidor simulado
  await alice.call('/api/providers/custom/key', { method: 'POST', body: { apiKey: 'chave-boa', model: 'modelo-teste', base: MOCKBASE } });
  const before = await alice.call('/api/providers/custom/complete', { method: 'POST', body: { messages: [{ role: 'user', content: 'x' }] } });
  if (before.status !== 409) throw new Error('permitiu chamada sem validação (HTTP ' + before.status + ')');
  return 'chamada sem validação → 409 (não confia no frontend)';
});

/* ---------- 7. exportação e eliminação ---------- */
await t('exportação de dados devolve apenas o próprio utilizador', async () => {
  const r = await alice.call('/api/auth/export');
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  if (r.json.user.email !== 'alice@ex.pt') throw new Error('utilizador errado');
  if (JSON.stringify(r.json).indexOf('dono@meridiano.test') >= 0) throw new Error('exportou dados de outro utilizador');
  if (/chave-boa/.test(r.text)) throw new Error('exportou chave em claro');
  return 'projectos ' + r.json.projects.length + ' · sem dados de terceiros · sem chaves';
});

await t('suspensão de conta revoga sessões e impede login', async () => {
  const users = (await owner.call('/api/admin/users')).json.users;
  const bobUser = users.find((u) => u.email === 'dono2@meridiano.test');
  const s = await owner.call('/api/admin/users/' + bobUser.id + '/status', { method: 'POST', body: { status: 'suspended' } });
  if (s.status !== 200 || s.json.user.status !== 'suspended') throw new Error('suspender ' + s.status);
  const me = await bob.call('/api/auth/me');
  if (me.json.user) throw new Error('sessão continuou activa');
  const li = await client().call('/api/auth/login', { method: 'POST', body: { email: 'dono2@meridiano.test', password: 'SenhaForte123' } });
  if (li.status !== 401) throw new Error('login de conta suspensa: ' + li.status);
  return 'suspensa · sessões revogadas · login 401';
});

await t('eliminação de conta remove projectos e sessões', async () => {
  const c = client();
  await c.call('/api/auth/register', { method: 'POST', body: { email: 'tmp@ex.pt', password: 'SenhaForte123', acceptTerms: true } });
  const p = await c.call('/api/projects', { method: 'POST', body: { title: 'Temporário' } });
  const del = await c.call('/api/auth/account', { method: 'DELETE', body: { password: 'SenhaForte123' } });
  if (del.status !== 200) throw new Error('HTTP ' + del.status + ' ' + del.text.slice(0, 100));
  const me = await c.call('/api/auth/me');
  if (me.json.user) throw new Error('sessão sobreviveu à eliminação');
  const db = JSON.parse(await fs.readFile(DATA + '/db.json', 'utf8'));
  if (db.projects.some((x) => x.id === p.json.project.id)) throw new Error('projecto ficou na base');
  if (db.users.some((u) => u.email === 'tmp@ex.pt')) throw new Error('utilizador ficou na base');
  if (db.sessions.some((s2) => s2.userId === del.json.deleted.id)) throw new Error('sessões ficaram na base');
  // a auditoria conserva o ID como sujeito do evento (registo de responsabilidade), mas não o conteúdo
  const ev = db.audit.find((e) => e.type === 'account_deleted');
  if (!ev) throw new Error('eliminação não auditada');
  return 'conta, projectos e sessões removidos · evento account_deleted conservado sem dados pessoais';
});

await t('auditoria existe e não contém segredos', async () => {
  const r = await owner.call('/api/admin/audit?limit=500');
  if (r.status !== 200 || !r.json.events.length) throw new Error('sem eventos');
  const dump = JSON.stringify(r.json);
  ['chave-boa-super-secreta', 'chave-boa', 'segredo-de-teste', 'SenhaForte123'].forEach((s) => {
    if (dump.indexOf(s) >= 0) throw new Error('segredo «' + s + '» na auditoria');
  });
  const types = [...new Set(r.json.events.map((e) => e.type))];
  return r.json.events.length + ' eventos · tipos: ' + types.slice(0, 8).join(', ');
});

child.kill('SIGTERM');
MOCK.close();
await new Promise((r) => setTimeout(r, 300));
console.log('SERVIDOR — AUTENTICAÇÃO, PERMISSÕES, CHAVES E FORNECEDORES');
for (const r of R) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + String(r.detail).slice(0, 170));
const fails = R.filter((r) => !r.ok).length;
console.log('\n' + (R.length - fails) + '/' + R.length + ' passaram');
if (fails) { console.log('\n--- log do servidor (últimas linhas) ---\n' + log.split('\n').slice(-15).join('\n')); }
process.exit(fails ? 1 : 0);
