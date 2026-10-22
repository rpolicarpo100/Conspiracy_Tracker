/* Persistência durável em Postgres — teste contra uma base REAL.

   Não há simulação de base de dados. Se DATABASE_URL não estiver definida, a
   suite declara SKIP e diz porquê (não conta como sucesso). Se estiver
   definida, o teste:

     1. cria o esquema e grava um documento numa instância nova;
     2. mata o processo do servidor e arranca outro com um DATA_DIR DIFERENTE
        e vazio — é o equivalente a um deploy que apaga o disco;
     3. verifica que os dados (utilizador, projecto) continuam lá, servidos
        pela base e não pelo ficheiro;
     4. confirma que /ready diz durableBetweenDeploys:true apenas porque a
        base confirmou a escrita;
     5. exercita conflito de versão (duas instâncias a escrever) e a cópia de
        segurança com restauro.

   Cada execução usa um prefixo de dados próprio e apaga o que criou no fim
   (não deixa lixo na base do utilizador). */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createPgStore } from '../server/pg.mjs';

const R = [];
const t = async (name, fn) => { try { R.push({ name, ok: true, detail: await fn() }); } catch (e) { R.push({ name, ok: false, detail: e.message }); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const URL_DB = process.env.DATABASE_URL || '';
if (!URL_DB) {
  console.log('SKIP persistência: DATABASE_URL não está definida — sem base real não se testa durabilidade.');
  console.log('     O que fica por provar: que os dados sobrevivem a um deploy. /ready declara durableBetweenDeploys:false.');
  process.exit(0);
}

const RUN = 'teste' + crypto.randomBytes(3).toString('hex');
const DATA_A = '/tmp/vn-pg-a-' + RUN;
const DATA_B = '/tmp/vn-pg-b-' + RUN;
fs.mkdirSync(DATA_A, { recursive: true }); fs.mkdirSync(DATA_B, { recursive: true });

function startServer(dir, port) {
  const child = spawn(process.execPath, ['tools/serve.mjs'], {
    cwd: process.cwd(),
    env: Object.assign({}, process.env, {
      PORT: String(port), DATA_DIR: dir, DATABASE_URL: URL_DB,
      APP_SECRET: 'segredo-de-teste-persistencia-1234', REGISTER_OPEN: 'true',
      REGISTER_MAX: '200', LOGIN_MAX_ATTEMPTS: '100'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  return { child, log: () => log, stop: () => new Promise((r) => { child.on('close', r); child.kill('SIGTERM'); }) };
}

function client(base) {
  const jar = new Map();
  const st = { csrf: null };
  async function call(p, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (jar.size) headers.cookie = [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
    if (opts.csrf !== false && st.csrf && opts.method && opts.method !== 'GET') headers['x-csrf-token'] = st.csrf;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + p, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) {
      const [pair] = c.split(';'); const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      if (!v || /Max-Age=0/i.test(c)) jar.delete(k); else jar.set(k, v);
    }
    const txt = await res.text();
    let json = null; try { json = JSON.parse(txt); } catch { /* não é JSON */ }
    return { status: res.status, json, text: txt };
  }
  return { call, st, async login(e, p2) { const r = await call('/api/auth/login', { method: 'POST', body: { email: e, password: p2 } }); if (r.json && r.json.csrf) st.csrf = r.json.csrf; return r; } };
}

const PORT_A = 8450 + Math.floor(Math.random() * 60);
const A = startServer(DATA_A, PORT_A);
await sleep(2200);
const cA = client('http://127.0.0.1:' + PORT_A);

const email = RUN + '@persistencia.test';
const PASSWORD = 'PersistenciaForte-1';
let projectoId = null;

await t('a base aceita o esquema e a primeira gravação', async () => {
  const ready = await cA.call('/ready');
  if (ready.status !== 200) throw new Error('/ready: HTTP ' + ready.status + ' ' + ready.text.slice(0, 200));
  const p = ready.json.checks.persistence;
  if (!p.postgres.configured) throw new Error('a base não foi reconhecida como configurada');
  if (!p.postgres.ready) throw new Error('a base não confirmou o esquema: ' + JSON.stringify(p.postgres).slice(0, 200));
  return 'modo ' + p.mode + ' · versão ' + p.postgres.version + ' · durabilidade ' + p.durableBetweenDeploys;
});

await t('registo com REGISTER_OPEN=true grava utilizador na base', async () => {
  const r = await cA.call('/api/auth/register', { method: 'POST', body: { email, password: PASSWORD, acceptTerms: true } });
  if (r.status !== 201) throw new Error('HTTP ' + r.status + ' ' + r.text.slice(0, 160));
  cA.st.csrf = r.json.csrf;
  return 'utilizador ' + r.json.user.id + ' · papel ' + r.json.user.role;
});

await t('projecto criado pela API está na base (não só no ficheiro)', async () => {
  const r = await cA.call('/api/projects', { method: 'POST', body: { title: RUN + ' projecto durável', question: 'sobrevive a um deploy?' } });
  if (r.status !== 201 && r.status !== 200) throw new Error('HTTP ' + r.status + ' ' + r.text.slice(0, 160));
  projectoId = (r.json.project && r.json.project.id) || r.json.id;
  const pg = createPgStore(URL_DB, {});
  await pg.init();
  const doc = await pg.load();
  const achado = (doc.doc.projects || []).find((x) => x.id === projectoId);
  const user = (doc.doc.users || []).find((x) => x.email === email);
  await pg.close();
  if (!achado) throw new Error('o projecto não está no documento da base');
  if (!user) throw new Error('o utilizador não está no documento da base');
  return 'projecto e utilizador presentes no jsonb (versão ' + doc.version + ')';
});

/* ------- o teste que interessa: outra máquina, disco vazio ------- */
let B = null;
const PORT_B = PORT_A + 90;
await t('depois de «deploy» (processo morto, disco novo) os dados continuam lá', async () => {
  await A.stop();
  await sleep(400);
  if (fs.existsSync(path.join(DATA_B, 'db.json'))) throw new Error('o disco novo não estava vazio: o teste não provaria nada');
  B = startServer(DATA_B, PORT_B);
  await sleep(2500);
  const cB = client('http://127.0.0.1:' + PORT_B);
  const login = await cB.login(email, PASSWORD);
  if (login.status !== 200) throw new Error('login na instância nova: HTTP ' + login.status + ' (os dados não sobreviveram)');
  const lista = await cB.call('/api/projects');
  if (lista.status !== 200) throw new Error('lista de projectos: HTTP ' + lista.status);
  if (!(lista.json.projects || []).some((p) => p.id === projectoId)) {
    throw new Error('o projecto não apareceu na instância nova (' + (lista.json.projects || []).length + ' projectos)');
  }
  const ready = await cB.call('/ready');
  if (!ready.json.checks.persistence.durableBetweenDeploys) throw new Error('/ready não declara durabilidade');
  return 'sessão recriada a partir da base · projecto visível · DATA_DIR novo e vazio';
});

await t('a versão da base avança e o conflito de duas instâncias é recusado', async () => {
  const pg1 = createPgStore(URL_DB, {});
  await pg1.init();
  const lido = await pg1.load();
  /* uma segunda «instância» grava primeiro */
  const pg2 = createPgStore(URL_DB, {});
  await pg2.init();
  const lido2 = await pg2.load();
  await pg2.save(lido2.doc, lido2.version, 'instancia-b');
  let recusou = false, codigo = null;
  try { await pg1.save(lido.doc, lido.version, 'instancia-a'); } catch (e) { recusou = true; codigo = e.code || e.message; }
  const depois = await pg1.load();
  await pg1.close(); await pg2.close();
  if (!recusou) throw new Error('duas gravações sobre a mesma versão foram aceites');
  return 'versão ' + lido.version + ' → ' + lido2.version + ' → ' + depois.version + ' · conflito recusado com ' + codigo;
});

await t('a cópia de segurança guarda o documento e o restauro devolve-o', async () => {
  const pg = createPgStore(URL_DB, {});
  await pg.init();
  const antes = await pg.load();
  const snap = await pg.snapshot();
  if (!snap) throw new Error('não criou cópia');
  const marcas = await pg.snapshots();
  const rest = await pg.restoreSnapshot(marcas[0].id);
  const depois = await pg.load();
  await pg.close();
  if (!rest) throw new Error('restauro devolveu nada');
  if (depois.version <= antes.version) throw new Error('a versão não avançou no restauro');
  const mesmos = JSON.stringify((depois.doc.projects || []).map((p) => p.id).sort()) === JSON.stringify((antes.doc.projects || []).map((p) => p.id).sort());
  if (!mesmos) throw new Error('o restauro alterou os projectos');
  return 'cópia da versão ' + snap.version + ' · restaurada como versão ' + rest.newVersion + ' · projectos idênticos';
});

await t('a auditoria fica em tabela append-only, independente do documento', async () => {
  const pg = createPgStore(URL_DB, {});
  await pg.init();
  const cauda = await pg.auditTail(50);
  await pg.close();
  const tipos = new Set(cauda.map((e) => e.type));
  if (!cauda.length) throw new Error('nenhum evento na tabela vn_audit');
  if (!tipos.has('user_registered')) throw new Error('falta o evento de registo: ' + [...tipos].join(','));
  return cauda.length + ' eventos na cauda · tipos: ' + [...tipos].slice(0, 6).join(', ');
});

/* ------- limpeza: não deixar lixo na base do utilizador ------- */
await t('limpeza: os dados de teste são retirados da base', async () => {
  if (B) await B.stop();
  const pg = createPgStore(URL_DB, {});
  await pg.init();
  const doc = await pg.load();
  const limpo = JSON.parse(JSON.stringify(doc.doc));
  limpo.users = (limpo.users || []).filter((u) => !String(u.email).endsWith('@persistencia.test'));
  const ids = new Set(limpo.users.map((u) => u.id));
  limpo.projects = (limpo.projects || []).filter((p) => ids.has(p.userId) || !String(p.title || '').includes('projecto durável'));
  limpo.sessions = (limpo.sessions || []).filter((x) => ids.has(x.userId));
  limpo.audit = (limpo.audit || []).filter((e) => !String(e.type || '').startsWith('teste') && !/persistencia/.test(JSON.stringify(e)).toString());
  await pg.save(limpo, doc.version, 'limpeza-do-teste');
  await pg.close();
  return 'documento limpo (mantidas as tabelas; os dados de teste saíram)';
});

const ok = R.filter((r) => r.ok).length;
for (const r of R) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + r.detail);
console.log('\n' + ok + '/' + R.length + ' passaram (base real: ' + (new URL(URL_DB)).hostname.split('.')[0] + '…)');
process.exit(ok === R.length ? 0 : 1);
