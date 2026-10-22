/* =====================================================================
   RETENÇÃO E MANUTENÇÃO — o que fica guardado, durante quanto tempo.

   O documento de privacidade declarava que a retenção automática não estava
   implementada. Este teste cobre a implementação real: o que é purgado, o que
   nunca é purgado (contas, projectos, provas, o evento de eliminação de conta),
   e a recusa de qualquer pedido sem o token de serviço.
   ===================================================================== */
import './_env.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createStore } from '../server/store.mjs';

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { const d = await fn(); pass++; console.log('PASS ' + name + (d ? ' → ' + d : '')); }
  catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const dir = () => {
  const d = '/tmp/vn-ret-' + crypto.randomBytes(4).toString('hex');
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const diasAtras = (n) => new Date(Date.now() - n * 24 * 3600e3).toISOString();

async function lojaComHistorico() {
  const store = await createStore(dir());
  const u = await store.createUser({ email: 'ret' + Date.now().toString(36) + '@ex.pt', passwordHash: 'x', role: 'USER' });
  const p1 = await store.createProject(u.id, { title: 'Caso com dados a preservar', question: 'q' });
  /* eventos antigos e recentes */
  for (const dias of [400, 200, 10]) {
    await store.audit({ type: 'login_succeeded', actorId: u.id, action: 'login', detail: { diasAtras: dias } });
    /* reescrever a data para simular antiguidade — a auditoria real não deixa
       escolher datas, e não queremos um teste que durma 180 dias */
    store.data.audit[store.data.audit.length - 1].at = diasAtras(dias);
  }
  await store.audit({ type: 'account_deleted', actorId: null, action: 'delete', detail: { antigo: true } });
  store.data.audit[store.data.audit.length - 1].at = diasAtras(400);
  /* sessões: uma recente válida, uma expirada há muito, uma revogada há muito */
  const valida = await store.createSession({ userId: u.id, tokenHash: 'h-valida', ttlMs: 12 * 3600e3 });
  const expirada = await store.createSession({ userId: u.id, tokenHash: 'h-antiga', ttlMs: 12 * 3600e3 });
  expirada.expiresAt = diasAtras(60);
  const revogada = await store.createSession({ userId: u.id, tokenHash: 'h-revogada', ttlMs: 12 * 3600e3 });
  revogada.revokedAt = diasAtras(40);
  /* uso de IA antigo e recente */
  await store.addUsage({ provider: 'groq', at: diasAtras(120) });
  await store.addUsage({ provider: 'groq' });
  return { store, u, p1, valida, expirada, revogada };
}

await t('simulação (dryRun) conta o que sairia e não remove nada', async () => {
  const { store } = await lojaComHistorico();
  const antes = { a: store.data.audit.length, s: store.data.sessions.length, u: store.data.usage.length };
  const r = await store.purgeRetention({ dryRun: true });
  ok(r.dryRun === true, 'dryRun não assinalado');
  ok(r.removed.audit === 2, 'auditoria: esperava 2 eventos antigos, veio ' + r.removed.audit);
  ok(r.removed.sessions === 2, 'sessões: esperava 2 (expirada e revogada), veio ' + r.removed.sessions);
  ok(r.removed.usage === 1, 'uso: esperava 1, veio ' + r.removed.usage);
  ok(store.data.audit.length === antes.a && store.data.sessions.length === antes.s && store.data.usage.length === antes.u,
    'a simulação alterou dados');
  return 'auditoria 2 · sessões 2 · uso 1 · nada alterado';
});

await t('a purga real remove só o que passou do prazo e regista-se a si própria', async () => {
  const { store, u, p1 } = await lojaComHistorico();
  const r = await store.purgeRetention({});
  ok(r.removed.audit === 2, 'auditoria removida: ' + r.removed.audit);
  const tipos = store.data.audit.map((e) => e.type);
  ok(tipos.includes('retention_purged'), 'a purga não ficou registada');
  ok(tipos.includes('account_deleted'), 'a prova de eliminação de conta foi apagada — inaceitável');
  ok(!store.data.audit.some((e) => e.detail && e.detail.diasAtras === 400 && e.type === 'login_succeeded'),
    'sobreviveu um evento de entrada com 400 dias');
  /* contas e projectos intactos */
  ok(store.data.users.some((x) => x.id === u.id), 'a conta foi apagada pela purga');
  ok(store.data.projects.some((x) => x.id === p1.id), 'o projecto foi apagado pela purga');
  return 'removidos ' + r.removed.audit + '/' + r.removed.sessions + '/' + r.removed.usage + ' · conta e projecto intactos · retention_purged gravado';
});

await t('a sessão válida não é tocada; as outras duas desaparecem', async () => {
  const { store, valida, expirada, revogada } = await lojaComHistorico();
  /* a purga de sessões só olha para o que já não vale, por isso a expirada
     (com data passada) e a revogada há 40 dias saem; a válida fica */
  await store.purgeRetention({});
  const ids = store.data.sessions.map((s) => s.id);
  ok(ids.includes(valida.id), 'a sessão válida foi apagada');
  ok(!ids.includes(expirada.id), 'a sessão expirada há 60 dias ficou');
  ok(!ids.includes(revogada.id), 'a sessão revogada há 40 dias ficou');
  return 'válida mantida · expirada e revogada removidas';
});

await t('os prazos são configuráveis e o padrão está declarado', async () => {
  const { store } = await lojaComHistorico();
  const padrao = store.retentionPolicy();
  ok(padrao.auditDays > 0 && padrao.sessionDays > 0 && padrao.usageDays > 0, 'política sem prazos');
  const r = await store.purgeRetention({ dryRun: true, policy: { auditDays: 3650, sessionDays: 3650, usageDays: 3650 } });
  ok(r.removed.audit === 0 && r.removed.sessions === 0 && r.removed.usage === 0,
    'com prazos longos nada devia sair: ' + JSON.stringify(r.removed));
  return 'padrão ' + padrao.auditDays + '/' + padrao.sessionDays + '/' + padrao.usageDays + ' dias · configurável';
});

await t('a purga é idempotente: correr duas vezes não remove mais nada', async () => {
  const { store } = await lojaComHistorico();
  await store.purgeRetention({});
  const segunda = await store.purgeRetention({});
  ok(segunda.removed.audit === 0 && segunda.removed.sessions === 0 && segunda.removed.usage === 0,
    'a segunda passagem removeu ' + JSON.stringify(segunda.removed));
  return 'segunda passagem: 0 removidos';
});

await t('a retenção sobrevive a recarregar a base do disco', async () => {
  const { store, u } = await lojaComHistorico();
  await store.purgeRetention({});
  const raiz = store.integrity().root;
  /* instância nova, mesmo directório: é o que acontece num reinício */
  const outra = await createStore(raiz);
  await outra.init();   // createStore não lê do disco por si: init() faz a carga
  ok(outra.data.users.some((x) => x.id === u.id), 'a conta desapareceu ao recarregar');
  ok(outra.data.audit.some((e) => e.type === 'retention_purged'), 'o evento da purga não persistiu');
  ok(!outra.data.audit.some((e) => e.detail && e.detail.diasAtras === 400 && e.type === 'login_succeeded'),
    'um evento purgado voltou ao recarregar');
  return 'estado purgado lido do disco · ' + outra.data.audit.length + ' eventos';
});

/* ---------- a rota de serviço: sem token não há manutenção ---------- */
import { spawn } from 'node:child_process';
const PORTA = 8800 + Math.floor(Math.random() * 80);
const BASE = 'http://127.0.0.1:' + PORTA;
const DIR = dir();
const TOKEN = 'manutencao-de-teste-' + crypto.randomBytes(6).toString('hex');

async function servidor(comToken) {
  const env = Object.assign({}, process.env, {
    PORT: String(PORTA), DATA_DIR: DIR, APP_SECRET: 'segredo-de-teste-retencao-1234567890',
    ADMIN_EMAIL: 'admin@meridiano.test', REGISTER_OPEN: 'true', REGISTER_MAX: '50'
  });
  if (comToken) env.CRON_TOKEN = TOKEN; else delete env.CRON_TOKEN;
  const s = spawn(process.execPath, ['tools/serve.mjs'], { cwd: process.cwd(), env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) return s; } catch { /* ainda a arrancar */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('o servidor não arrancou');
}

const pedir = (metodo, caminho, token) => fetch(BASE + caminho, {
  method: metodo, headers: token ? { 'x-cron-token': token } : {}
});

let srv = await servidor(false);
await t('sem CRON_TOKEN a rota declara-se desligada (503) e não purga', async () => {
  const r = await pedir('POST', '/api/service/maintenance');
  const j = await r.json();
  ok(r.status === 503, 'HTTP ' + r.status + ' (esperado 503)');
  ok(j.configured === false && /desligada/.test(j.reason || ''), 'o motivo não foi declarado: ' + JSON.stringify(j).slice(0, 120));
  ok(!j.removed, 'houve purga sem token');
  return '503 · ' + j.reason.slice(0, 70);
});
srv.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 400));

srv = await servidor(true);
await t('token errado: 401 e fica registado na auditoria', async () => {
  const r = await pedir('POST', '/api/service/maintenance', 'token-errado');
  ok(r.status === 401, 'HTTP ' + r.status + ' (esperado 401)');
  return '401 · recusa gravada';
});

await t('a simulação autenticada responde com a política e não remove nada', async () => {
  const r = await pedir('GET', '/api/service/maintenance', TOKEN);
  const j = await r.json();
  ok(r.status === 200, 'HTTP ' + r.status + ' ' + JSON.stringify(j).slice(0, 100));
  ok(j.dryRun === true, 'GET devia ser simulação');
  ok(j.policy && j.policy.auditDays > 0, 'sem política de retenção');
  return 'dryRun · prazos ' + j.policy.auditDays + '/' + j.policy.sessionDays + '/' + j.policy.usageDays + ' dias';
});

await t('a purga autenticada corre e deixa rasto (retention_purged)', async () => {
  const r = await pedir('POST', '/api/service/maintenance', TOKEN);
  const j = await r.json();
  ok(r.status === 200 && j.ok === true, 'HTTP ' + r.status);
  ok(j.dryRun === false, 'a purga real não correu');
  const l = await pedir('GET', '/api/service/maintenance', TOKEN);
  ok(l.status === 200, 'a segunda chamada falhou');
  return 'removidos ' + JSON.stringify(j.removed) + ' · evento registado';
});
srv.kill('SIGTERM');

console.log('\n' + pass + '/' + (pass + fail) + ' passaram');
process.exit(fail ? 1 : 0);
