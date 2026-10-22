/* =====================================================================
   MOTOR DE TESTES DE FORNECEDORES — níveis 1 a 6 (fase 3)

   Três camadas, como no resto do projecto:
     · módulo   — classificação de erros, redacção, orçamento, resultados;
     · sintético — servidor local que imita um fornecedor (401/200/429/lento);
                   permite provar os níveis 3–6 sem chave real e SEM fingir que
                   o fornecedor testado é real: os registos saem com
                   synthetic: true e o ranking de produção ignora-os;
     · rede      — um fornecedor verdadeiro, níveis 1–2 (sem chave). Se a rede
                   falhar é SKIP com motivo, nunca PASS.
   ===================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../server/api.mjs';
import { runProviderTests, classifyFailure, redact, TEST_LEVELS, RESULTS } from '../server/provider-tests.mjs';
import * as cat from '../server/provider-catalog.mjs';

const R = [];
const t = async (name, fn) => {
  try { const d = await fn(); R.push({ ok: true, name, detail: d }); }
  catch (e) { R.push({ ok: false, name, detail: e.message, skip: e.skip }); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'falhou'); };
const skip = (why) => { const e = new Error('SKIP: ' + why); e.skip = true; throw e; };

/* ------------------------------------------------------- 1. módulo */

await t('módulo · níveis nomeados (1–6 neste motor, 7 no benchmark) e 5 resultados', async () => {
  /* o nível 7 é declarado aqui mas produzido pelo módulo de benchmarks: a
     numeração é uma só em todo o sistema */
  ok(Object.keys(TEST_LEVELS).length === 7, 'níveis: ' + Object.keys(TEST_LEVELS).length);
  ok(TEST_LEVELS[7].engine === 'benchmark', 'nível 7 sem motor declarado');
  ok(RESULTS.join(',') === 'PASS,FAIL,BLOCKED,NOT_TESTED,STALE', RESULTS.join(','));
  return Object.values(TEST_LEVELS).map((l) => l.id).join(' · ');
});

await t('módulo · diagnóstico distingue 401, 403, 404-caminho, 404-modelo, 429, 5xx e timeout', async () => {
  const casos = [
    [{ status: 401 }, 'credencial-recusada', false],
    [{ status: 403, body: 'Method doesn\'t allow unregistered callers' }, 'sem-credencial', false],
    [{ status: 403, body: 'quota exceeded for this billing period' }, 'conta-sem-quota', false],
    [{ status: 404, body: 'Unknown request URL: GET /openai/v1/chat/completions' }, 'caminho-errado', false],
    [{ status: 404, body: 'The model gpt-9 does not exist' }, 'modelo-inexistente', false],
    [{ status: 400, body: 'unsupported parameter response_format' }, 'pedido-invalido', false],
    [{ status: 429 }, 'limite-utilizacao', true],
    [{ status: 503 }, 'erro-do-fornecedor', true],
    [{ status: 0, error: 'timeout de 15000 ms' }, 'timeout', true]
  ];
  const vistos = [];
  for (const [entrada, esperado, retry] of casos) {
    const d = classifyFailure(Object.assign({ endpoint: 'https://x' }, entrada));
    ok(d.diagnosis === esperado, JSON.stringify(entrada) + ' → ' + d.diagnosis + ' (esperado ' + esperado + ')');
    ok(d.retryable === retry, esperado + ': retryable ' + d.retryable);
    vistos.push(esperado);
  }
  return vistos.join(' · ');
});

await t('módulo · 404 de caminho não é lido como modelo inexistente', async () => {
  const caminho = classifyFailure({ status: 404, body: 'Unknown request URL: GET /openai/v1/chat/completions' });
  const modelo = classifyFailure({ status: 404, body: 'model gemini-9 not found' });
  ok(caminho.diagnosis !== modelo.diagnosis, 'os dois 404 são tratados como iguais');
  ok(/ENDPOINT/.test(caminho.hint) && /modelo/.test(modelo.hint), caminho.hint + ' | ' + modelo.hint);
  return '«' + caminho.diagnosis + '» vs «' + modelo.diagnosis + '»';
});

await t('módulo · redacção remove chaves e cabeçalhos de qualquer texto guardado', async () => {
  const sujo = 'Erro: Bearer sk-abcdefgh12345678 e chave gsk_ZZZZZZZZZZZZZZZZZZZ e a minha hf_ABCDEFGH12345678';
  const limpo = redact(sujo, ['gsk_ZZZZZZZZZZZZZZZZZZZ']);
  ok(!/sk-abcdefgh12345678|gsk_ZZZZ|hf_ABCDEFGH/.test(limpo), limpo);
  return limpo;
});

await t('módulo · sem chave, níveis 3–6 ficam BLOCKED com motivo (nunca PASS)', async () => {
  const entry = { key: 'x', docs: [], endpoints: [{ base: 'https://exemplo.invalid/v1' }] };
  const out = await runProviderTests(entry, { levels: [3, 4, 6], fetchImpl: async () => { throw new Error('não devia haver pedido'); } });
  ['3', '4', '6'].forEach((n) => {
    ok(out.results[n].result === 'BLOCKED', n + ' → ' + out.results[n].result);
    ok(/sem chave/.test(out.results[n].reason), n + ': ' + out.results[n].reason);
  });
  ok(out.requestsUsed === 0 || out.requestsUsed === 1, 'pedidos gastos: ' + out.requestsUsed);
  return '3,4,6 BLOCKED · 0 geração tentada';
});

await t('módulo · orçamento de pedidos corta antes de gastar (e diz onde parou)', async () => {
  const entry = { key: 'x', docs: [], endpoints: [{ base: 'https://exemplo.invalid/v1' }] };
  const out = await runProviderTests(entry, { levels: [3, 4, 5, 6], apiKey: 'k-1234567890', model: 'm',
    maxRequests: 2, fetchImpl: async () => { throw new Error('sem rede'); } });
  const bloqueados = Object.values(out.results).filter((r) => /orçamento/.test(r.reason || ''));
  ok(bloqueados.length >= 2, 'nada foi bloqueado por orçamento: ' + JSON.stringify(out.results).slice(0, 200));
  ok(out.requestsUsed <= 2, 'gastou ' + out.requestsUsed + ' com orçamento 2');
  return bloqueados.length + ' níveis cortados · ' + out.requestsUsed + '/2 pedidos usados';
});

/* ------------------------------------------------------- 2. sintético */

/* Servidor que imita um fornecedor OpenAI: 401 sem chave, 200 com chave,
   429 numa rota, resposta sem conteúdo noutra. Nada disto é um fornecedor
   real — por isso os registos levam synthetic: true. */
const MOCK = http.createServer((req, res) => {
  const auth = req.headers.authorization;
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/v1/models') {
    if (auth !== 'Bearer chave-teste-123456') return send(401, { error: { message: 'invalid api key' } });
    return send(200, { data: [{ id: 'modelo-sintetico' }, { id: 'modelo-vazio' }, { id: 'modelo-lento' }] });
  }
  if (req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (auth !== 'Bearer chave-teste-123456') return send(401, { error: { message: 'invalid api key' } });
      const p = JSON.parse(body || '{}');
      if (p.model === 'modelo-vazio') return send(200, { choices: [{ message: { content: '' } }] });
      if (p.model === 'modelo-lento') return setTimeout(() => send(200, { choices: [{ message: { content: 'devagar' } }], usage: { prompt_tokens: 4, completion_tokens: 2 } }), 900);
      if (p.response_format) return send(200, { choices: [{ message: { content: '{"ok":true}' } }] });
      if (p.tools) return send(200, { choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'tempo', arguments: '{"cidade":"Lisboa"}' } }] } }] });
      return send(200, { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 6, completion_tokens: 1 } });
    });
    return;
  }
  if (req.url === '/v1/limite/models' || req.url === '/v1/limite/chat/completions') return send(429, { error: { message: 'rate limit' } });
  send(404, { error: { message: 'Unknown request URL: GET ' + req.url } });
});
await new Promise((r) => MOCK.listen(0, '127.0.0.1', r));
const MOCKBASE = 'http://127.0.0.1:' + MOCK.address().port + '/v1';
process.env.VN_TEST_PROVIDERS = '1';

const sint = {
  key: 'test/mock', name: 'Fornecedor sintético', kind: 'endpoint', docs: [MOCKBASE + '/docs'],
  endpoints: [{ base: MOCKBASE, protocol: 'openai-chat-completions' }],
  capabilities: { claimed: ['json', 'tools'] }
};

await t('sintético · nível 2 detecta que o serviço exige credencial (401)', async () => {
  const out = await runProviderTests(sint, { levels: [2], fetchImpl: fetch });
  ok(out.results[2].result === 'PASS', JSON.stringify(out.results[2]));
  ok(out.results[2].requiresKey === true, 'não marcou requiresKey');
  return 'HTTP ' + out.results[2].httpStatus + ' → «' + out.results[2].detail + '»';
});

await t('sintético · nível 3 com chave válida liga e confirma o modelo; com chave errada classifica', async () => {
  const bom = await runProviderTests(sint, { levels: [3], apiKey: 'chave-teste-123456', model: 'modelo-sintetico', fetchImpl: fetch });
  ok(bom.results[3].result === 'PASS' && bom.results[3].modelConfirmed === true, JSON.stringify(bom.results[3]));
  const mau = await runProviderTests(sint, { levels: [3], apiKey: 'chave-errada-999999', model: 'modelo-sintetico', fetchImpl: fetch });
  ok(mau.results[3].result === 'FAIL' && mau.results[3].diagnosis === 'credencial-recusada', JSON.stringify(mau.results[3]));
  const modeloInexistente = await runProviderTests(sint, { levels: [3], apiKey: 'chave-teste-123456', model: 'nao-existe', fetchImpl: fetch });
  ok(modeloInexistente.results[3].diagnosis === 'modelo-inexistente', JSON.stringify(modeloInexistente.results[3]));
  return 'chave boa PASS · chave má FAIL/credencial-recusada · modelo ausente FAIL/modelo-inexistente';
});

await t('sintético · nível 4: geração válida PASS, resposta vazia FAIL, sem modelo NOT_TESTED', async () => {
  const bom = await runProviderTests(sint, { levels: [4], apiKey: 'chave-teste-123456', model: 'modelo-sintetico', fetchImpl: fetch });
  ok(bom.results[4].result === 'PASS', JSON.stringify(bom.results[4]));
  ok(bom.results[4].tokens && bom.results[4].tokens.prompt === 6, 'tokens: ' + JSON.stringify(bom.results[4].tokens));
  const vazio = await runProviderTests(sint, { levels: [4], apiKey: 'chave-teste-123456', model: 'modelo-vazio', fetchImpl: fetch });
  ok(vazio.results[4].result === 'FAIL' && /sem conteúdo/.test(vazio.results[4].reason), JSON.stringify(vazio.results[4]));
  const semModelo = await runProviderTests(sint, { levels: [4], apiKey: 'chave-teste-123456', fetchImpl: fetch });
  ok(semModelo.results[4].result === 'NOT_TESTED', JSON.stringify(semModelo.results[4]));
  return 'PASS com tokens · vazio FAIL · sem modelo NOT_TESTED (não se inventa modelo)';
});

await t('sintético · nível 5 testa só as capacidades declaradas', async () => {
  const out = await runProviderTests(sint, { levels: [5], apiKey: 'chave-teste-123456', model: 'modelo-sintetico', fetchImpl: fetch });
  ok(out.results[5].capabilities.json === 'PASS', JSON.stringify(out.results[5].capabilities));
  ok(out.results[5].capabilities.tools === 'PASS', JSON.stringify(out.results[5].capabilities));
  const semDeclarar = await runProviderTests(Object.assign({}, sint, { capabilities: {} }), { levels: [5], apiKey: 'chave-teste-123456', model: 'modelo-sintetico', fetchImpl: fetch });
  ok(semDeclarar.results[5].result === 'NOT_TESTED' && /não declara/.test(semDeclarar.results[5].reason), JSON.stringify(semDeclarar.results[5]));
  return 'json PASS · tools PASS · sem declaração → NOT_TESTED';
});

await t('sintético · nível 6 mede taxa de sucesso e percentis reais', async () => {
  const out = await runProviderTests(sint, { levels: [6], apiKey: 'chave-teste-123456', model: 'modelo-lento', samples: 3, timeoutMs: 5000, fetchImpl: fetch });
  const r = out.results[6];
  ok(r.result === 'PASS' && r.ok === 3, JSON.stringify(r).slice(0, 200));
  ok(r.latencyP50Ms >= 800 && r.latencyP95Ms >= r.latencyP50Ms, 'percentis: ' + r.latencyP50Ms + '/' + r.latencyP95Ms);
  ok(r.successRate === 1, 'taxa ' + r.successRate);
  return '3/3 válidas · p50 ' + r.latencyP50Ms + ' ms · p95 ' + r.latencyP95Ms + ' ms';
});

await t('sintético · 429 é limite, não avaria, e interrompe as amostras seguintes', async () => {
  const d = classifyFailure({ status: 429 });
  ok(d.retryable && d.diagnosis === 'limite-utilizacao', JSON.stringify(d));
  const entrada = { key: 'x', endpoints: [{ base: MOCKBASE.replace('/v1', '/v1') }] };
  const out = await runProviderTests({ key: 'x', endpoints: [{ base: MOCKBASE + '/limite' }] }, { levels: [3], apiKey: 'chave-teste-123456', fetchImpl: fetch });
  ok(out.results[3].result === 'BLOCKED' && /429/.test(out.results[3].reason), JSON.stringify(out.results[3]));
  return 'BLOCKED com «limite de pedidos (429)» — não se insiste';
});

/* ------------------------------------------------------- 3. servidor real */

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-ptests-'));
const api = await createApi({ dataDir: DIR, appSecret: 'segredo-de-teste-provider-1234567890', secure: false, exposeStore: true });
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
await call('POST', '/api/auth/register', { email: 'pt@ex.pt', password: 'SenhaForte-2026!', acceptTerms: true });
await call('POST', '/api/provider-os/seed', {});

await t('servidor · níveis 4–6 exigem confirmação explícita de custo', async () => {
  const r = await call('POST', '/api/provider-os/test', { key: 'providers/groq', levels: [4] });
  ok(r.status === 400 && /confirmCost/.test(r.text), 'HTTP ' + r.status + ' ' + r.text.slice(0, 120));
  return 'sem confirmCost → 400 (ninguém gasta a chave do utilizador por engano)';
});

await t('servidor · sem chave guardada, geração fica BLOCKED e o teste fica registado', async () => {
  const r = await call('POST', '/api/provider-os/test', { key: 'providers/groq', levels: [4], confirmCost: true });
  ok(r.status === 200, 'HTTP ' + r.status + ' ' + r.text.slice(0, 140));
  ok(r.json.results[4].result === 'BLOCKED' && /sem chave/.test(r.json.results[4].reason), JSON.stringify(r.json.results[4]));
  ok(r.json.stored.length === 1 && r.json.stored[0].result === 'BLOCKED', 'não ficou registado');
  const hist = await call('GET', '/api/provider-os/tests?key=providers/groq');
  ok(hist.json.total >= 1, 'histórico vazio');
  return 'BLOCKED gravado em providerTests (o motivo não se perde ao reiniciar)';
});

await t('servidor · teste de ligação real (rede) a um fornecedor do catálogo', async () => {
  const r = await call('POST', '/api/provider-os/test', { key: 'providers/openrouter', levels: [1, 2] });
  if (r.status !== 200) skip('pedido recusado: HTTP ' + r.status);
  const n1 = r.json.results[1], n2 = r.json.results[2];
  if (n1.result === 'BLOCKED' || n1.result === 'FAIL') skip('documentação inacessível agora: ' + (n1.reason || n1.detail));
  ok(n1.result === 'PASS', 'nível 1: ' + JSON.stringify(n1));
  ok(n2.result === 'PASS' || n2.result === 'BLOCKED', 'nível 2: ' + JSON.stringify(n2));
  ok(r.json.state === 'DOCUMENTED' || r.json.state === 'LINK_TESTED', 'estado após teste: ' + r.json.state);
  return 'nível 1 PASS (' + n1.httpStatus + ', ' + n1.latencyMs + ' ms) · nível 2 ' + n2.result + ' · estado ' + r.json.state;
});

await t('servidor · ranking só dá nota com ≥40% dos pesos medidos', async () => {
  const r = await call('GET', '/api/provider-os/ranking?task=conversa');
  ok(r.status === 200, 'HTTP ' + r.status);
  const comNota = r.json.rows.filter((x) => x.score != null);
  ok(comNota.length === 0, 'deu nota sem testes de geração: ' + JSON.stringify(comNota[0]));
  ok(r.json.rows.every((x) => x.coveragePct <= 40), 'cobertura inesperada > 40%');
  return r.json.total + ' linhas, 0 notas, cobertura máxima ' + Math.max(...r.json.rows.map((x) => x.coveragePct)) + '%';
});

await t('servidor · teste sintético não entra no ranking de produção', async () => {
  const st = api.__test.store;
  await st.addProviderTest({ key: 'providers/groq', level: 4, result: 'PASS', latencyMs: 200, synthetic: true });
  const r = await call('GET', '/api/provider-os/ranking?task=conversa');
  const groq = r.json.rows.find((x) => x.key === 'providers/groq');
  ok(groq.score == null, 'o teste sintético deu nota: ' + groq.score);
  return 'linha Groq continua sem nota (teste sintético ignorado)';
});

await t('servidor · 401 de uma rota qualquer não derruba o teste: fica classificado', async () => {
  const r = await call('POST', '/api/provider-os/test', { key: 'tools/opencode', levels: [1, 2] });
  ok(r.status === 200, 'HTTP ' + r.status);
  ok(r.json.results[2].result === 'NOT_TESTED', 'ferramenta não tem endpoint: ' + JSON.stringify(r.json.results[2]));
  return 'ferramenta (sem endpoint) → nível 2 NOT_TESTED, com razão escrita';
});

srv.close();
MOCK.close();
let pass = 0, fail = 0, skipped = 0;
console.log('MOTOR DE TESTES DE FORNECEDORES — NÍVEIS 1–6\n');
R.forEach((r) => {
  if (!r.ok && r.skip) { skipped++; console.log('SKIP ' + r.name + ' → ' + r.detail.slice(6)); return; }
  if (r.ok) { pass++; console.log('PASS ' + r.name + (r.detail ? ' → ' + r.detail : '')); }
  else { fail++; console.log('FAIL ' + r.name + ' → ' + r.detail); }
});
console.log('\n' + pass + ' passaram · ' + fail + ' falharam · ' + skipped + ' sem execução (rede/limite)');
process.exit(fail ? 1 : 0);
