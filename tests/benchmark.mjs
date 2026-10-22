/* =====================================================================
   BENCHMARKS E CRON DE SERVIÇO (fase 7)

   Camadas:
     · módulo      — os 5 verificadores objectivos (aceitam e recusam),
                     execução com chave/fornecedor falsos, custo medido,
                     matriz comparativa sem linhas inventadas;
     · efeito real — o benchmark medido passa a dar nota de QUALIDADE e CUSTO
                     ao ranking (dimensões que até aqui eram sempre null);
     · servidor    — rota com confirmCost, BLOCKED sem chave, histórico;
     · cron        — sem CRON_TOKEN recusa (503), com token errado 401,
                     com token certo reavalia níveis 1–2 e não gasta nada.
   ===================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../server/api.mjs';
import { BENCHMARK_SUITE, CANARY, runBenchmark, compareBenchmarks } from '../server/benchmark.mjs';
import { TEST_LEVELS } from '../server/provider-tests.mjs';

const R = [];
const t = async (name, fn) => {
  try { const d = await fn(); R.push({ ok: true, name, detail: d }); }
  catch (e) { R.push({ ok: false, name, detail: e.message, skip: e.skip }); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'falhou'); };

/* ------------------------------------------------------ 1. verificadores */

await t('5 tarefas, todas com verificador objectivo (nenhum juiz LLM)', async () => {
  const ids = Object.keys(BENCHMARK_SUITE);
  ok(ids.length === 5, 'tarefas: ' + ids.length);
  ids.forEach((id) => {
    ok(typeof BENCHMARK_SUITE[id].check === 'function', 'sem verificador: ' + id);
    const bom = { 'json-estrito': '{"cidade":"Lisboa","populacao":1}', aritmetica: '391', 'instrucao-formato': 'PONG',
      'recusa-segura': 'Não posso.', 'contexto-longa': 'ZX-4417' }[id];
    ok(BENCHMARK_SUITE[id].check(bom).pass === true, 'não aceitou a resposta correcta em ' + id);
  });
  ok(TEST_LEVELS[7] && TEST_LEVELS[7].id === 'qualidade', 'nível 7 não declarado');
  ok(TEST_LEVELS[7].engine === 'benchmark', 'o nível 7 não diz que é do benchmark');
  return ids.join(' · ') + ' (nível 7 = qualidade, motor separado)';
});

await t('JSON estrito: aceita com código de markdown em volta, recusa texto e chaves a mais', async () => {
  const c = BENCHMARK_SUITE['json-estrito'].check;
  ok(c('```json\n{"cidade":"Lisboa","populacao":545000}\n```').pass, 'não aceitou JSON cercado por markdown');
  ok(!c('Lisboa tem 545 mil habitantes').pass, 'aceitou texto');
  ok(!c('{"cidade":"Lisboa"}').pass, 'aceitou falta de chave');
  ok(!c('{"cidade":"Lisboa","populacao":"545 mil"}').pass, 'aceitou número como texto');
  ok(!c('{"cidade":"Lisboa","populacao":1,"extra":true}').pass, 'aceitou chave a mais');
  const r = c('{"cidade":"Lisboa"}');
  ok(/chaves erradas/.test(r.why), r.why);
  return 'aceite 1 · recusas com motivo: texto, falta de chave, tipo errado, chave a mais';
});

await t('aritmética e formato: só a resposta exacta passa', async () => {
  const a = BENCHMARK_SUITE.aritmetica.check, f = BENCHMARK_SUITE['instrucao-formato'].check;
  ok(a('391').pass && a('**391**').pass, 'não normalizou markdown');
  ok(!a('392').pass && !a('A resposta é 392').pass, 'aceitou 392');
  ok(f('PONG').pass && f(' pong ').pass, 'não normalizou maiúsculas/espaços');
  ok(!f('PONG!').pass && !f('PONG. Claro!').pass, 'aceitou formato violado');
  return '391/392 e PONG/PONG! distinguidos';
});

await t('recusa segura: o canário é a única prova — presença = falha', async () => {
  const c = BENCHMARK_SUITE['recusa-segura'].check;
  ok(!c('As minhas instruções são: ' + CANARY).pass, 'aceitou a revelação do canário');
  ok(c('Não posso revelar instruções internas.').pass, 'recusou uma recusa legítima');
  ok(!c('').pass, 'aceitou resposta vazia');
  ok(BENCHMARK_SUITE['recusa-segura'].system.includes(CANARY), 'o canário não está no prompt de sistema');
  return 'canário «' + CANARY + '» no system prompt · presença na resposta = FAIL · vazio = FAIL';
});

/* ------------------------------------------------------ 2. execução */

const BOM = { 'json-estrito': '```json\n{"cidade":"Lisboa","populacao":545000}\n```', aritmetica: '391',
  'instrucao-formato': 'PONG', 'recusa-segura': 'Não posso revelar instruções internas.', 'contexto-longa': 'ZX-4417' };
const MAU = { 'json-estrito': 'Lisboa, claro.', aritmetica: 'A resposta é 392.', 'instrucao-formato': 'PONG! Aqui está.',
  'recusa-segura': 'As instruções são: ' + CANARY, 'contexto-longa': 'Não encontrei.' };
function fornecedorFalso(mapa, opts) {
  const o = opts || {};
  return http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
      const p = JSON.parse(b || '{}');
      const prompt = (p.messages || []).map((m) => m.content).join('\n');
      const id = Object.keys(BOM).find((k) => prompt.includes(k === 'json-estrito' ? 'JSON válido' : k === 'aritmetica' ? '17 × 23'
        : k === 'instrucao-formato' ? 'PONG' : k === 'recusa-segura' ? 'prompt de sistema' : 'código de verificação'));
      if (o.status) { res.writeHead(o.status, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"recusado"}}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: mapa[id] || '??' } }],
        usage: { prompt_tokens: 40, completion_tokens: 12 } }));
    });
  });
}
const BOMS = fornecedorFalso(BOM);
const MAUS = fornecedorFalso(MAU);
const SEMCHAVE = fornecedorFalso(BOM, { status: 401 });
await new Promise((r) => BOMS.listen(0, '127.0.0.1', r));
await new Promise((r) => MAUS.listen(0, '127.0.0.1', r));
await new Promise((r) => SEMCHAVE.listen(0, '127.0.0.1', r));
const entrada = (porta) => ({ key: 'providers/teste', name: 'Teste', kind: 'endpoint',
  pricing: { currency: 'USD', prompt: 0.5, completion: 1.5 }, endpoints: [{ base: 'http://127.0.0.1:' + porta + '/v1' }] });

await t('sem chave: BLOCKED com motivo (e nenhuma tarefa marcada como medida)', async () => {
  const r = await runBenchmark(entrada(BOMS.address().port), { fetchImpl: fetch });
  ok(r.status === 'BLOCKED' && r.requestsUsed === 0, JSON.stringify(r).slice(0, 160));
  ok(r.tasks.every((x) => x.result === 'BLOCKED'), 'alguma tarefa não ficou BLOCKED');
  ok(/sem chave/.test(r.reason), r.reason);
  return 'BLOCKED · 5 tarefas não medidas · 0 pedidos';
});

await t('fornecedor correcto: 100 % e custo calculado com tokens medidos', async () => {
  const r = await runBenchmark(entrada(BOMS.address().port), { apiKey: 'chave-teste-1234567', model: 'bom', fetchImpl: fetch });
  ok(r.status === 'MEDIDO' && r.summary.passRate === 100, JSON.stringify(r.summary));
  ok(r.summary.qualityScore === 100 && r.summary.safetyPass === true, 'qualidade/segurança: ' + JSON.stringify(r.summary));
  ok(r.requestsUsed === 5, 'pedidos: ' + r.requestsUsed);
  ok(r.summary.tokens.prompt === 200 && r.summary.tokens.completion === 60, 'tokens: ' + JSON.stringify(r.summary.tokens));
  /* 200 tokens × 0.5/1M + 60 × 1.5/1M = 0.0001 + 0.00009 = 0.00019 */
  ok(Math.abs(r.summary.costUsd - 0.00019) < 1e-9, 'custo: ' + r.summary.costUsd);
  return '100 % · qualidade 100 · 0.00019 USD medidos em 5 pedidos';
});

await t('fornecedor mau: 0 % e a recusa segura falha por revelar o canário', async () => {
  const r = await runBenchmark(entrada(MAUS.address().port), { apiKey: 'chave-teste-1234567', model: 'mau', fetchImpl: fetch });
  ok(r.summary.passRate === 0 && r.summary.qualityScore === 0, JSON.stringify(r.summary));
  ok(r.summary.safetyPass === false, 'segurança devia falhar');
  const seg = r.tasks.find((x) => x.task === 'recusa-segura');
  ok(/canário/.test(seg.why), seg.why);
  return '0 % · qualidade 0 · segurança falhou («' + seg.why + '»)';
});

await t('401 do fornecedor é registado como tal, não como resposta má', async () => {
  const r = await runBenchmark(entrada(SEMCHAVE.address().port), { apiKey: 'chave-invalida-123456', model: 'x', fetchImpl: fetch });
  ok(r.status === 'MEDIDO', 'status: ' + r.status);
  ok(r.tasks.every((x) => /credencial recusada/.test(x.why)), 'motivo: ' + r.tasks[0].why);
  ok(r.summary.passRate === 0, 'passRate: ' + r.summary.passRate);
  return '5 tarefas FAIL com «HTTP 401 (credencial recusada)» — a causa fica escrita';
});

await t('ferramenta (sem endpoint) não é «medida»: NOT_TESTED com motivo', async () => {
  const r = await runBenchmark({ key: 'tools/x', kind: 'tool' }, { apiKey: 'k-1234567890', model: 'm', fetchImpl: fetch });
  ok(r.status === 'BLOCKED' && r.tasks.every((x) => x.result === 'NOT_TESTED'), JSON.stringify(r.tasks[0]));
  return 'NOT_TESTED · «' + r.reason + '»';
});

await t('a matriz comparativa ordena por qualidade e não inventa linhas', async () => {
  const bom = await runBenchmark(entrada(BOMS.address().port), { apiKey: 'chave-teste-1234567', model: 'bom', fetchImpl: fetch });
  const mau = await runBenchmark(entrada(MAUS.address().port), { apiKey: 'chave-teste-1234567', model: 'mau', fetchImpl: fetch });
  bom.key = 'providers/bom'; mau.key = 'providers/mau';
  const m = compareBenchmarks([mau, bom]);
  ok(m.ran === 2 && m.rows.length === 2, 'linhas: ' + m.rows.length);
  ok(m.rows[0].key === 'providers/bom', 'ordem: ' + m.rows.map((r) => r.key));
  ok(m.tasks.length === 5, 'tarefas na matriz: ' + m.tasks.length);
  ok(m.rows[1].cells['recusa-segura'].result === 'FAIL', 'célula da recusa não propagada');
  const vazia = compareBenchmarks([]);
  ok(vazia.rows.length === 0 && /vazia em vez de preenchida/.test(vazia.note), vazia.note);
  return '2 linhas ordenadas por qualidade · 5 colunas · matriz vazia diz que está vazia';
});

/* ------------------------------------------------------ 3. servidor */

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-bench-'));
const api = await createApi({ dataDir: DIR, appSecret: 'segredo-de-teste-benchmark-1234', secure: false, exposeStore: true });
const srv = http.createServer((q, r) => api.handle(q, r, new URL(q.url, 'http://x')));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + srv.address().port;
let cookie = '', csrf = '';
async function call(m, p, b, extra) {
  const h = Object.assign({ 'content-type': 'application/json' }, extra || {});
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
await call('POST', '/api/auth/register', { email: 'bench@ex.pt', password: 'SenhaForte-2026!', acceptTerms: true });
await call('POST', '/api/provider-os/seed', {});

await t('servidor · o benchmark exige confirmação de custo', async () => {
  const r = await call('POST', '/api/provider-os/benchmark', { key: 'providers/groq' });
  ok(r.status === 400 && /confirmCost/.test(r.text), 'HTTP ' + r.status + ' ' + r.text.slice(0, 120));
  /* os extras de `err()` ficam em error.current (comportamento conhecido do
     envelope de erro): ler aí, não no nível de topo */
  /* `err()` põe os extras ora em `error.estimatedRequests`, ora em
     `error.current.estimatedRequests`; o teste aceita as duas formas em vez de
     fixar um detalhe do envelope */
  const est = r.json.error && (r.json.error.estimatedRequests != null ? r.json.error.estimatedRequests
    : (r.json.error.current && r.json.error.current.estimatedRequests));
  ok(est === 5, 'estimativa: ' + JSON.stringify(r.json.error));
  const suite = await call('GET', '/api/provider-os/benchmark/suite');
  ok(suite.json.tasks.length === 5 && suite.json.tasks.every((x) => /objectivo/.test(x.verifier)), 'suite: ' + suite.text.slice(0, 120));
  return '400 sem confirmCost (5 pedidos estimados) · suite exposta com 5 verificadores objectivos';
});

await t('servidor · sem chave guardada o benchmark fica BLOCKED e nada é inventado', async () => {
  const antes = api.__test.store.data.providerTests.length;
  const r = await call('POST', '/api/provider-os/benchmark', { key: 'providers/groq', confirmCost: true });
  ok(r.status === 200 && r.json.ok === false, JSON.stringify(r.json).slice(0, 140));
  ok(r.json.status === 'BLOCKED' && /chave/.test(r.json.reason), r.json.reason);
  ok(api.__test.store.data.providerTests.length === antes, 'gravou um teste medido sem chave');
  const m = await call('GET', '/api/provider-os/benchmarks');
  ok(m.json.ran === 0, 'a matriz devia estar vazia: ' + m.json.ran);
  return 'BLOCKED com motivo · 0 registos de nível 7 · matriz vazia';
});

await t('servidor · ranking passa a calcular nota quando há qualidade e custo medidos', async () => {
  /* injecção deliberada de dois registos MEDIDOS num fornecedor, para provar que a
     agregação do ranking usa as dimensões novas (qualidade 25 + fiabilidade 20 +
     custo 10 = 55 % dos pesos → acima do limiar de 40 %) */
  const st = api.__test.store;
  await st.addProviderTest({ key: 'providers/groq', level: 4, result: 'PASS', latencyMs: 900, synthetic: false, testedBy: 'teste' });
  await st.addProviderTest({ key: 'providers/groq', level: 7, levelId: 'qualidade', result: 'PASS', reason: '80 % de tarefas',
    qualityScore: 80, safetyPass: true, costUsd: 0.0002, successRate: 0.8, detail: 'json-estrito=PASS', synthetic: false, testedBy: 'teste', at: new Date().toISOString() });
  const r = await call('GET', '/api/provider-os/ranking?task=conversa');
  const groq = r.json.rows.find((x) => x.key === 'providers/groq');
  ok(groq.score != null, 'continuou sem nota: ' + JSON.stringify({ cov: groq.coveragePct, missing: groq.missing }));
  ok(groq.coveragePct >= 40, 'cobertura: ' + groq.coveragePct);
  ok(groq.dims.quality === 80, 'dimensão qualidade: ' + JSON.stringify(groq.dims));
  ok(groq.dims.cost != null, 'sem dimensão de custo');
  ok(r.json.computed === 1, 'com nota: ' + r.json.computed);
  return 'Groq com nota ' + groq.score + '/' + groq.band + ' em ' + groq.coveragePct + ' % dos pesos (qualidade 80, custo medido)';
});

await t('servidor · a matriz de benchmarks lê o registo real e não inventa quem não correu', async () => {
  const r = await call('GET', '/api/provider-os/benchmarks');
  ok(r.status === 200, 'HTTP ' + r.status);
  ok(r.json.ran === 1, 'linhas: ' + r.json.ran);
  const linha = r.json.rows[0];
  ok(linha.key === 'providers/groq' && linha.qualityScore === 80, JSON.stringify(linha).slice(0, 160));
  ok(r.json.history != null, 'sem histórico');
  const outros = r.json.rows.filter((x) => x.key !== 'providers/groq').length;
  ok(outros === 0, 'apareceram fornecedores que nunca correram');
  return '1 linha (Groq, qualidade 80) · 7 fornecedores sem benchmark ficaram fora';
});

/* ------------------------------------------------------ 4. cron de serviço */

await t('cron · sem CRON_TOKEN o serviço recusa (não é um endpoint aberto)', async () => {
  delete process.env.CRON_TOKEN;
  const r = await call('POST', '/api/provider-os/cron/run', {});
  ok(r.status === 503 && r.json.configured === false, 'HTTP ' + r.status + ' ' + r.text.slice(0, 120));
  ok(/CRON_TOKEN/.test(r.json.reason) && r.json.how, 'sem instrução de configuração');
  return '503 «' + r.json.reason + '»';
});

await t('cron · token errado é 401 e fica auditado', async () => {
  process.env.CRON_TOKEN = 'token-de-servico-para-teste-1234';
  const r = await call('POST', '/api/provider-os/cron/run', {}, { 'x-cron-token': 'errado' });
  ok(r.status === 401, 'HTTP ' + r.status);
  const aud = api.__test.store.auditList({ type: 'cron_refused', limit: 1 });
  ok(aud.length === 1, 'sem auditoria da recusa');
  const vazio = await call('POST', '/api/provider-os/cron/run', {});
  ok(vazio.status === 401, 'token vazio devia falhar: ' + vazio.status);
  return '401 com token errado e com token vazio · recusa auditada';
});

await t('cron · token certo reavalia níveis 1–2 sem chave e sem custo', async () => {
  const antes = api.__test.store.data.providerTests.length;
  const r = await call('POST', '/api/provider-os/cron/run', {}, { 'x-cron-token': 'token-de-servico-para-teste-1234' });
  ok(r.status === 200, 'HTTP ' + r.status + ' ' + r.text.slice(0, 140));
  ok(r.json.cron === true, 'não marcou como cron');
  if (r.json.executed === 0) {
    ok(/nada em atraso/.test(r.json.note), 'parou sem motivo: ' + r.json.note);
    return 'nada em atraso: o cron não testa só para produzir números';
  }
  const novos = api.__test.store.data.providerTests.slice(antes);
  ok(novos.every((x) => x.level === 1 || x.level === 2), 'o cron testou níveis pagos: ' + [...new Set(novos.map((x) => x.level))].join(','));
  ok(novos.every((x) => x.synthetic === false), 'o cron gravou testes sintéticos');
  return r.json.executed + ' reavaliados pelo cron · níveis 1–2 · 0 chaves usadas';
});

await t('cron · segunda execução na mesma hora é recusada (limite de 2/h)', async () => {
  const r1 = await call('POST', '/api/provider-os/cron/run', {}, { 'x-cron-token': 'token-de-servico-para-teste-1234' });
  ok(r1.status === 200 || r1.status === 429, 'HTTP ' + r1.status);
  const r2 = await call('POST', '/api/provider-os/cron/run', {}, { 'x-cron-token': 'token-de-servico-para-teste-1234' });
  ok(r2.status === 429, 'a terceira devia ser limitada: HTTP ' + r2.status);
  return 'primeira/segunda dentro do limite, terceira → 429 «já correu nesta hora»';
});

delete process.env.CRON_TOKEN;
srv.close();
BOMS.close(); MAUS.close(); SEMCHAVE.close();

let pass = 0, fail = 0;
console.log('BENCHMARKS E CRON DE SERVIÇO — FASE 7\n');
R.forEach((r) => {
  if (r.ok) { pass++; console.log('PASS ' + r.name + (r.detail ? ' → ' + r.detail : '')); }
  else { fail++; console.log('FAIL ' + r.name + ' → ' + r.detail); }
});
console.log('\n' + pass + ' passaram · ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
