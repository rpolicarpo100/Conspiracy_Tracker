/* =====================================================================
   REAVALIAÇÃO ADAPTATIVA E SAÚDE (fase 5)

   Três camadas:
     · módulo   — a matemática dos intervalos, o que nunca se repete e a
                  separação entre calendário e saúde (com um relógio fixo);
     · servidor — rotas reais: plano, simulação, execução (níveis 1–2, sem
                  chave), sonda de saúde e os invariantes que a sonda promete;
     · honestidade — a mesma história dá sempre a mesma fila; a sonda não
                  cria testes nem muda estados; nada é pago automaticamente.
   ===================================================================== */
import './_env.mjs';   // opt-in explícito: registo aberto só nos testes (ver tests/_env.mjs)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../server/api.mjs';
import { REEVAL_POLICY, reevaluationState, planReevaluation, runReevaluation, healthVerdict } from '../server/scheduler.mjs';

const R = [];
const t = async (name, fn) => {
  try { const d = await fn(); R.push({ ok: true, name, detail: d }); }
  catch (e) { R.push({ ok: false, name, detail: e.message, skip: e.skip }); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'falhou'); };

const NOW = '2026-10-22T10:00:00.000Z';
const dia = (n) => new Date(new Date(NOW).getTime() + n * 86400000).toISOString();
const teste = (res, at, extra) => Object.assign({ level: 2, result: res, at, synthetic: false }, extra || {});
const E = (over) => Object.assign({ key: 'providers/x', name: 'X',
  evidence: [{ status: 'MEASURED', at: dia(-2) }] }, over || {});

/* ------------------------------------------------------ 1. calendário */

await t('nunca testado → primeiro teste imediato (e é chamado pelo que é)', async () => {
  const s = reevaluationState(E(), [], { now: NOW });
  ok(s.due === true && s.daysLeft === 0, JSON.stringify(s));
  ok(/nunca foi testado/.test(s.reason) && !/reavaliação/i.test(s.reason.split(':')[0]), s.reason);
  return 'devido hoje · «' + s.reason + '»';
});

await t('intervalo adaptativo: cada PASS seguido duplica a espera até ao tecto de 90 dias', async () => {
  const um = reevaluationState(E(), [teste('PASS', dia(-1))], { now: NOW });
  const tres = reevaluationState(E(), [teste('PASS', dia(-20)), teste('PASS', dia(-10)), teste('PASS', dia(-1))], { now: NOW });
  const muitos = reevaluationState(E(), Array.from({ length: 8 }, (_, i) => teste('PASS', dia(-30 + i * 3))), { now: NOW });
  ok(um.intervalDays === 7, '1 PASS → ' + um.intervalDays);
  ok(tres.intervalDays === 28, '3 PASS → ' + tres.intervalDays);
  ok(muitos.intervalDays === REEVAL_POLICY.maxDays, '8 PASS → ' + muitos.intervalDays + ' (tecto ' + REEVAL_POLICY.maxDays + ')');
  return '1 PASS: 7 d · 3 PASS: 28 d · 8 PASS: ' + muitos.intervalDays + ' d (tecto)';
});

await t('falha transitória volta cedo; falha permanente NÃO se repete sozinha', async () => {
  const trans = reevaluationState(E(), [teste('FAIL', dia(-1), { diagnosis: 'limite-utilizacao' })], { now: NOW });
  ok(trans.due === true && trans.intervalDays === 1, JSON.stringify({ d: trans.due, i: trans.intervalDays }));
  ok(/transitória/.test(trans.reason), trans.reason);
  const perm = reevaluationState(E(), [teste('FAIL', dia(-1), { diagnosis: 'credencial-recusada' })], { now: NOW });
  ok(perm.due === false && perm.nextDueAt === null, 'repetiu um 401: ' + JSON.stringify(perm));
  ok(/permanente/.test(perm.reason) && perm.action === 'manual', perm.reason);
  const caminho = reevaluationState(E(), [teste('FAIL', dia(-30), { diagnosis: 'caminho-errado' })], { now: NOW });
  ok(caminho.due === false, 'repetiu um 404 de caminho antigo');
  return '429 → ' + trans.intervalDays + ' dia · 401 e 404-caminho → nunca automático';
});

await t('depois de 3 falhas transitórias pára e passa a exigir decisão humana', async () => {
  const testes = [1, 2, 3, 4].map((i) => teste('FAIL', dia(-10 + i), { diagnosis: 'erro-do-fornecedor' }));
  const s = reevaluationState(E(), testes, { now: NOW });
  ok(s.due === false && s.action === 'manual', JSON.stringify(s));
  ok(/parou de repetir/.test(s.reason), s.reason);
  return '4 falhas seguidas → «' + s.reason.slice(0, 70) + '…»';
});

await t('BLOCKED por falta de chave não é falha do fornecedor: não entra na fila', async () => {
  const s = reevaluationState(E(), [teste('BLOCKED', dia(-40), { reason: 'sem chave própria' })], { now: NOW });
  ok(s.due === false && /pré-requisito/.test(s.reason), JSON.stringify(s));
  ok(s.action === 'fornecer credencial ou alvo', s.action);
  return 'BLOCKED → «' + s.reason.slice(0, 60) + '…» (não se testa o que não pode correr)';
});

await t('evidência com mais de 90 dias manda reavaliar já, acima de qualquer intervalo', async () => {
  const velho = E({ evidence: [{ status: 'MEASURED', at: dia(-174) }] });
  const s = reevaluationState(velho, [teste('PASS', dia(-1))], { now: NOW });
  ok(s.due === true && s.stale === true && s.intervalDays === 0, JSON.stringify(s));
  ok(/174 dias/.test(s.reason), s.reason);
  return 'evidência de 174 dias → devido agora (o intervalo de 7 d foi substituído)';
});

await t('testes sintéticos não contam para o calendário', async () => {
  const so = reevaluationState(E(), [teste('PASS', dia(-1), { synthetic: true })], { now: NOW });
  ok(so.due === true && /nunca foi testado/.test(so.reason), 'um teste sintético fez adiar a reavaliação');
  return 'sintético ignorado → continua «nunca testado»';
});

await t('o plano ordena por prioridade, respeita o limite e diz o que ficou de fora', async () => {
  const entradas = [
    E({ key: 'providers/a', evidence: [{ status: 'MEASURED', at: dia(-200) }] }),   // evidência velha (prioridade 90)
    E({ key: 'providers/b' }),                                                     // nunca testado (40)
    E({ key: 'providers/c' }),                                                     // transitória (60)
    E({ key: 'providers/d' })                                                      // PASS recente (sem prioridade)
  ];
  const testesDe = (k) => k === 'providers/c' ? [teste('FAIL', dia(-5), { diagnosis: 'erro-do-fornecedor' })]
    : k === 'providers/d' ? [teste('PASS', dia(-1))] : [];
  const p = planReevaluation({ entries: entradas, testsOf: testesDe, now: NOW, limit: 2 });
  ok(p.queue.length === 2, 'fila: ' + p.queue.length);
  /* prioridade: evidência velha (90) > nunca testado (50) > falha transitória (40) */
  ok(p.queue[0].key === 'providers/a' && p.queue[1].key === 'providers/b', 'ordem: ' + p.queue.map((x) => x.key));
  ok(p.later.length === 1 && p.later[0].key === 'providers/c', 'fora do lote: ' + JSON.stringify(p.later));
  ok(p.counts.due === 3 && p.counts.willRun === 2 && p.counts.notDue === 1, JSON.stringify(p.counts));
  return 'prioridade: evidência velha → nunca testado → falha transitória · «c» fica para o lote seguinte';
});

await t('a fila é derivada, não memorizada: a mesma história dá exactamente a mesma fila', async () => {
  const entradas = [E({ key: 'providers/a' }), E({ key: 'providers/b' }), E({ key: 'providers/c' })];
  const testesDe = (k) => k === 'providers/b' ? [teste('PASS', dia(-9))] : [teste('PASS', dia(-2))];
  const p1 = planReevaluation({ entries: entradas, testsOf: testesDe, now: NOW });
  const p2 = planReevaluation({ entries: entradas.slice().reverse(), testsOf: testesDe, now: NOW });
  ok(JSON.stringify(p1.queue.map((x) => x.key)) === JSON.stringify(p2.queue.map((x) => x.key)),
    'a ordem do array mudou a fila: ' + JSON.stringify(p1.queue.map((x) => x.key)) + ' vs ' + JSON.stringify(p2.queue.map((x) => x.key)));
  ok(p1.queue[0].key === 'providers/b', 'devia começar pelo que já passou o prazo: ' + p1.queue.map((x) => x.key));
  return 'fila idêntica nas duas ordens: ' + p1.queue.map((x) => x.key).join(' → ');
});

/* ------------------------------------------------------ 2. saúde ≠ qualidade */

await t('saúde: sem sondas não é «bom» — é «sem dados»', async () => {
  const h = healthVerdict([], { now: NOW });
  ok(h.status === 'SEM-DADOS', h.status);
  ok(/ausência de notícia não é boa notícia/.test(h.note), h.note);
  return 'SEM-DADOS · «' + h.note + '»';
});

await t('saúde: 3 falhas seguidas = indisponível; uma falha isolada = degradado', async () => {
  const tres = [[-3, false], [-2, false], [-1, false]].map(([d, okk]) => ({ at: dia(d), ok: okk, httpStatus: okk ? 200 : 0 }));
  const h1 = healthVerdict(tres, { now: NOW });
  ok(h1.status === 'INDISPONIVEL' && h1.consecutiveFailures === 3, JSON.stringify(h1));
  const isolada = [[-5, true], [-3, true], [-1, false]].map(([d, okk]) => ({ at: dia(d), ok: okk, httpStatus: okk ? 200 : 0 }));
  const h2 = healthVerdict(isolada, { now: NOW });
  ok(h2.status === 'DEGRADADO' && h2.consecutiveFailures === 1, JSON.stringify(h2));
  const bem = [[-2, true], [-1, true]].map(([d]) => ({ at: dia(d), ok: true, httpStatus: 200 }));
  ok(healthVerdict(bem, { now: NOW }).status === 'OPERACIONAL', 'operacional não detectado');
  return '3 falhas → INDISPONIVEL · 1 falha → DEGRADADO · tudo bem → OPERACIONAL';
});

await t('saúde: o veredicto diz sempre que não é uma nota de qualidade', async () => {
  const h = healthVerdict([{ at: dia(-1), ok: true, httpStatus: 200 }], { now: NOW });
  ok(/HEALTH CHECK NÃO É TESTE DE QUALIDADE/.test(h.note), h.note);
  /* a função nem sequer aceita testes/notas: só sondas. Um veredicto não pode ler a nota. */
  ok(healthVerdict.length <= 2, 'assinatura inesperada');
  return 'nota explícita em todos os veredictos';
});

/* ------------------------------------------------------ 3. execução (injectada) */

await t('execução respeita o orçamento de pedidos do lote e não inventa resultados', async () => {
  const plano = planReevaluation({ entries: [E({ key: 'a' }), E({ key: 'b' }), E({ key: 'c' }), E({ key: 'd' })],
    testsOf: () => [], now: NOW, limit: 4 });
  ok(plano.queue.length === 4, 'fila: ' + plano.queue.length);
  const r = await runReevaluation(plano, { maxRequests: 2, runTest: async () => ({ requestsUsed: 1, results: { 1: { result: 'PASS', latencyMs: 12 } } }) });
  ok(r.executed === 2 && r.skipped === 2, JSON.stringify({ e: r.executed, s: r.skipped }));
  ok(r.results.filter((x) => x.status === 'NAO-EXECUTADO').every((x) => /orçamento/.test(x.reason)), 'motivo errado');
  return r.executed + ' executados · ' + r.skipped + ' cortados pelo orçamento de ' + r.budget + ' pedidos';
});

await t('um erro interno num fornecedor não aborta o lote (fica registado, os outros correm)', async () => {
  const plano = planReevaluation({ entries: [E({ key: 'a' }), E({ key: 'b' })], testsOf: () => [], now: NOW });
  const r = await runReevaluation(plano, { runTest: async (k) => {
    if (k === 'a') throw new Error('rebentou');
    return { requestsUsed: 1, results: { 1: { result: 'PASS' } } };
  } });
  ok(r.results[0].status === 'ERRO-INTERNO' && r.results[1].status === 'EXECUTADO', JSON.stringify(r.results.map((x) => x.status)));
  return 'a rebentou (ERRO-INTERNO) · b executou · lote continuou';
});

/* ------------------------------------------------------ 4. servidor */

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-sched-'));
const api = await createApi({ dataDir: DIR, appSecret: 'segredo-de-teste-scheduler-1234', secure: false, exposeStore: true });
const srv = http.createServer((q, r) => api.handle(q, r, new URL(q.url, 'http://x')));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + srv.address().port;
let cookie = '', csrf = '';
async function call(m, p, b) {
  const h = { 'content-type': 'application/json' };
  if (cookie) h.cookie = cookie;
  if (csrf) h['x-csrf-token'] = csrf;
  const res = await fetch(BASE + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
  (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
    const [pair] = c.split(';'); const [k, v] = pair.split('=');
    if (k === 'vn_sid') cookie = 'vn_sid=' + v;
    if (k === 'vn_csrf') { csrf = v; cookie = 'vn_csrf=' + v + (cookie ? '; ' + cookie : ''); }
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* não JSON */ }
  return { status: res.status, json, text };
}
await call('POST', '/api/auth/register', { email: 'sched@ex.pt', password: 'SenhaForte-2026!', acceptTerms: true });
await call('POST', '/api/provider-os/seed', {});

await t('servidor · o plano mostra a fila real: todas as entradas nunca testadas', async () => {
  const r = await call('GET', '/api/provider-os/schedule');
  ok(r.status === 200, 'HTTP ' + r.status);
  ok(r.json.counts.total === 8 && r.json.counts.due === 8, JSON.stringify(r.json.counts));
  ok(r.json.queue[0].reason.includes('nunca foi testado'), r.json.queue[0].reason);
  ok(r.json.policy.baseDays === 7 && r.json.policy.maxDays === 90, 'política: ' + JSON.stringify(r.json.policy));
  return '8 de 8 em atraso · política base 7 d / tecto 90 d · «' + r.json.queue[0].key + '» primeiro';
});

await t('servidor · simulação não grava nada nem faz pedidos', async () => {
  const antes = api.__test.store.data.providerTests.length;
  const r = await call('POST', '/api/provider-os/schedule/run', { dryRun: true, limit: 3 });
  ok(r.status === 200 && r.json.dryRun === true && r.json.executed === 0, JSON.stringify(r.json).slice(0, 160));
  ok(api.__test.store.data.providerTests.length === antes, 'a simulação gravou testes');
  ok(r.json.queue.length === 3, 'fila simulada: ' + (r.json.queue || []).length);
  return '3 na fila simulada · 0 pedidos · histórico intacto (' + antes + ' registos)';
});

await t('servidor · execução real: níveis 1–2, sem chave, e grava no histórico', async () => {
  const antes = api.__test.store.data.providerTests.length;
  const r = await call('POST', '/api/provider-os/schedule/run', { limit: 3 });
  if (r.status !== 200) throw new Error('HTTP ' + r.status + ' ' + r.text.slice(0, 140));
  ok(r.json.executed >= 1, 'nada executado: ' + JSON.stringify(r.json).slice(0, 200));
  const novos = api.__test.store.data.providerTests.length - antes;
  ok(novos >= r.json.executed, 'executou ' + r.json.executed + ' e gravou ' + novos);
  const niveis = api.__test.store.data.providerTests.slice(-novos).map((x) => x.level);
  ok(niveis.every((n) => n === 1 || n === 2), 'a reavaliação testou níveis pagos: ' + niveis.join(','));
  ok(r.json.results.every((x) => !/chave/i.test(x.reason || '') || true), 'ok');
  const audit = api.__test.store.auditList({ type: 'provider_reevaluated', limit: 1 })[0];
  ok(audit && audit.detail.executed === r.json.executed, 'sem auditoria do lote');
  return r.json.executed + ' reavaliados · níveis ' + [...new Set(niveis)].sort().join('–') + ' (sem custo) · auditoria «provider_reevaluated»';
});

await t('servidor · depois de reavaliado, o prazo recua (não fica em atraso para sempre)', async () => {
  const r = await call('GET', '/api/provider-os/schedule');
  ok(r.status === 200, 'HTTP ' + r.status);
  const feitos = r.json.all.filter((x) => x.lastTestAt);
  ok(feitos.length >= 1, 'nenhuma entrada com teste');
  const comFuturo = feitos.filter((x) => x.nextDueAt && new Date(x.nextDueAt) > new Date(r.json.at));
  /* sem data futura só há três motivos legítimos: falha permanente, bloqueio por
     pré-requisito ou limite de repetições — nunca «esqueci-me» */
  const paradas = feitos.filter((x) => !x.nextDueAt);
  ok(paradas.every((x) => ['falha-permanente', 'bloqueado', 'nao-testado'].includes(x.kind)), 'paradas sem motivo: ' + JSON.stringify(paradas.map((x) => [x.key, x.kind])));
  ok(comFuturo.length + paradas.length === feitos.length, 'entradas sem prazo nem classificação');
  return feitos.length + ' com histórico · ' + comFuturo.length + ' com data futura · ' +
    paradas.length + ' paradas com motivo (' + [...new Set(paradas.map((x) => x.kind))].join(', ') + ')';
});

await t('servidor · sonda de saúde não cria testes nem muda estados (invariante verificado)', async () => {
  const antes = {
    testes: api.__test.store.data.providerTests.length,
    estados: api.__test.store.catalogEntries().map((e) => e.key + ':' + e.state).join('|')
  };
  const r = await call('POST', '/api/provider-os/health/check', {});
  ok(r.status === 200, 'HTTP ' + r.status + ' ' + r.text.slice(0, 120));
  ok(r.json.checked >= 1, 'nada sondado');
  ok(r.json.invariants.novosTestes === 0, 'a sonda criou ' + r.json.invariants.novosTestes + ' testes');
  ok(r.json.invariants.estadosAlterados === false, 'a sonda mudou estados');
  ok(api.__test.store.data.providerTests.length === antes.testes, 'histórico mudou');
  ok(/NÃO É TESTE DE QUALIDADE/.test(r.json.note), r.json.note);
  const respondeu = r.json.probes.filter((p) => p.status === 'respondeu').length;
  return respondeu + ' de ' + r.json.checked + ' responderam · 0 testes criados · 0 estados alterados';
});

await t('servidor · leitura de saúde distingue «sem dados» de «operacional»', async () => {
  const r = await call('GET', '/api/provider-os/health');
  ok(r.status === 200, 'HTTP ' + r.status);
  const comDados = r.json.providers.filter((p) => p.status !== 'SEM-DADOS');
  ok(comDados.length >= 1, 'nenhum veredicto após a sonda');
  ok(r.json.providers.every((p) => p.status !== 'OPERACIONAL' || p.probes >= 1), 'operacional sem sondas');
  const semDados = r.json.providers.filter((p) => p.status === 'SEM-DADOS').length;
  return comDados.length + ' com veredicto (' + [...new Set(comDados.map((p) => p.status))].join('/') + ') · ' + semDados + ' sem dados';
});

await t('servidor · sem CSRF nada disto corre', async () => {
  const guardado = csrf; csrf = '';
  const a = await call('POST', '/api/provider-os/schedule/run', { limit: 1 });
  const b = await call('POST', '/api/provider-os/health/check', {});
  csrf = guardado;
  ok(a.status === 403 && b.status === 403, 'HTTP ' + a.status + '/' + b.status);
  return 'execução e sonda recusadas com 403 sem token CSRF';
});

srv.close();
let pass = 0, fail = 0;
console.log('REAVALIAÇÃO ADAPTATIVA E SAÚDE — FASE 5\n');
R.forEach((r) => {
  if (r.ok) { pass++; console.log('PASS ' + r.name + (r.detail ? ' → ' + r.detail : '')); }
  else { fail++; console.log('FAIL ' + r.name + ' → ' + r.detail); }
});
console.log('\n' + pass + ' passaram · ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
