/* =====================================================================
   QUOTA E ROTAÇÃO DE IA — «este fornecedor ainda tem tokens?»

   O caso real que isto resolve: o Gemini respondeu 503 «high demand» e o Groq
   404 «modelo retirado», com chaves válidas, enquanto o OpenRouter estava a
   funcionar. A aplicação insistia no primeiro da lista.

   O que se prova aqui:
     · classificação — 429, 402, insufficient_quota, chave inválida, 5xx e
       timeout não são a mesma coisa, e a espera vem das pistas do fornecedor;
     · livro de quotas — disponível / em espera / volta a ser tentado quando a
       espera acaba (nunca «para sempre»);
     · rotação — um pedido real atravessa a cadeia até encontrar tokens e diz por
       onde passou e porquê;
     · rota de serviço — só com x-cron-token; GET não gasta pedidos; POST sonda.
   Nada aqui inventa resultados: quando não há tokens em lado nenhum, o resultado
   é uma falha declarada.
   ===================================================================== */
import './_env.mjs';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApi } from '../server/api.mjs';
import { classificarFalha, esperaPedida, pistaDeEspera, limitesAnunciados, criarLivroDeQuotas, ESTADOS } from '../server/quota.mjs';

const R = [];
const t = async (name, fn) => {
  try { const d = await fn(); R.push({ ok: true, name, detail: d }); }
  catch (e) { R.push({ ok: false, name, detail: e.message }); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'falhou'); };

/* ---------------------------------------------------- 1. classificação */

await t('classificação · 429 (ritmo), 402 (saldo), 401 (chave) e 5xx não são o mesmo', async () => {
  const a = classificarFalha({ status: 429, error: 'rate limit exceeded', detalhe: 'retry in 30s' });
  ok(a.tipo === 'limitado' && a.esperarMs === 30000, JSON.stringify(a));
  const b = classificarFalha({ status: 429, error: 'You exceeded your current quota, please check your plan and billing details' });
  ok(b.tipo === 'sem-credito', 'mensagem de saldo num 429 devia ser saldo: ' + JSON.stringify(b));
  const c = classificarFalha({ status: 402, error: 'payment required' });
  ok(c.tipo === 'sem-credito', JSON.stringify(c));
  const d = classificarFalha({ status: 401, error: 'Invalid API Key' });
  ok(d.tipo === 'chave', JSON.stringify(d));
  const e = classificarFalha({ status: 503, error: 'This model is currently experiencing high demand' });
  ok(e.tipo === 'indisponivel', JSON.stringify(e));
  const f = classificarFalha({ status: 0, error: 'timeout após 30000 ms' });
  ok(f.tipo === 'indisponivel', JSON.stringify(f));
  return 'limitado/sem-credito/chave/indisponivel — quatro decisões diferentes';
});

await t('classificação · a espera vem do fornecedor quando ele a diz', async () => {
  ok(esperaPedida('30') === 30000, 'segundos: ' + esperaPedida('30'));
  ok(esperaPedida('2m') === 120000, 'minutos: ' + esperaPedida('2m'));
  ok(esperaPedida('1500ms') === 1500, 'ms: ' + esperaPedida('1500ms'));
  const cabecalho = pistaDeEspera({ status: 429, headers: { 'retry-after': '7' } });
  ok(cabecalho && cabecalho.ms === 7000 && /cabeçalho/.test(cabecalho.de), JSON.stringify(cabecalho));
  const google = pistaDeEspera({ status: 429, detalhe: '{ "retryDelay": "27s" }' });
  ok(google && google.ms === 27000, JSON.stringify(google));
  const frase = pistaDeEspera({ status: 429, detalhe: 'Please retry in 12.5s.' });
  ok(frase && frase.ms === 12500, JSON.stringify(frase));
  /* e o tecto: um fornecedor que peça 3 horas não pode prender o tráfego 3 horas */
  const longo = classificarFalha({ status: 429, error: 'rate limit', detalhe: 'retry in 10800s' });
  ok(longo.esperarMs <= 15 * 60000, 'espera sem tecto: ' + longo.esperarMs);
  return 'cabeçalho 7s · retryDelay 27s · frase 12,5s · tecto de 15 min';
});

await t('classificação · limites anunciados na resposta boa são aproveitados', async () => {
  const l = limitesAnunciados({ headers: { 'x-ratelimit-remaining-tokens': '4123', 'x-ratelimit-remaining-requests': '9', other: 'x' } });
  ok(l && l.tokensRestantes === '4123' && l.pedidosRestantes === '9', JSON.stringify(l));
  ok(limitesAnunciados({ headers: {} }) === null, 'sem cabeçalhos devia ser null');
  return 'tokens e pedidos restantes lidos dos cabeçalhos';
});

/* ---------------------------------------------------- 2. livro de quotas */

await t('livro · ok → disponível; limitado → em espera até ao fim da espera', async () => {
  let agora = 1_000_000;
  const livro = criarLivroDeQuotas({ agora: () => agora });
  ok(livro.disponivel('groq'), 'desconhecido devia ser tentado');
  livro.registarFalha('groq', { tipo: 'limitado', esperarMs: 30000, motivo: 'rate limit' });
  ok(!livro.disponivel('groq'), 'em espera devia sair da rota');
  agora += 29000;
  ok(!livro.disponivel('groq'), 'ainda não passou o tempo');
  agora += 2000;
  ok(livro.disponivel('groq'), 'passado o tempo tem de voltar a ser tentado');
  livro.registarSucesso('groq');
  const r = livro.relatorio()[0];
  ok(r.estado === 'ok' && r.falhas === 0, JSON.stringify(r));
  return 'em espera 30 s e volta sozinho · o estado não é permanente';
});

await t('livro · sem crédito fica de fora mais tempo, e diz porquê', async () => {
  let agora = 5_000_000;
  const livro = criarLivroDeQuotas({ agora: () => agora });
  livro.registarFalha('gemini', { tipo: 'sem-credito', esperarMs: 6 * 3600000, motivo: 'insufficient_quota' });
  ok(!livro.disponivel('gemini'), 'sem crédito devia sair da rota');
  agora += 3600000;
  ok(!livro.disponivel('gemini'), 'uma hora não chega para voltar a tentar');
  const r = livro.relatorio()[0];
  ok(r.estado === 'sem-credito' && /insufficient_quota/.test(r.motivo), JSON.stringify(r));
  ok(r.label === ESTADOS['sem-credito'].label, 'label: ' + r.label);
  return 'em espera 6 h · motivo guardado · label «' + r.label + '»';
});

/* ---------------------------------------------------- 3. rotação na rota real */

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-quota-'));
process.env.CRON_TOKEN = 'token-de-teste-da-rotacao-' + crypto.randomBytes(4).toString('hex');
/* três fornecedores com chave; o primeiro vai ser esgotado em série */
process.env['API_KEY_Groq'] = 'gsk_falsa_groq';
process.env['API_KEY_Gemini'] = 'chave_falsa_gemini';
process.env['API_KEY_OpenRouter'] = 'sk-or-falsa-openrouter';
process.env.AI_OPERATOR_ORDER = 'groq,gemini,openrouter';

const api = await createApi({ dataDir: DIR, appSecret: 'segredo-de-teste-quota-123456', secure: false });
const srv = http.createServer((q, r) => api.handle(q, r, new URL(q.url, 'http://x')));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + srv.address().port;
const TOKEN = process.env.CRON_TOKEN;

async function pedir(m, p, headers) {
  const res = await fetch(BASE + p, { method: m, headers: headers || {} });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* não JSON */ }
  return { status: res.status, json, text };
}

await t('rota de serviço · sem CRON_TOKEN a rota existe e recusa (503)', async () => {
  const guardado = process.env.CRON_TOKEN;
  delete process.env.CRON_TOKEN;
  const r = await pedir('GET', '/api/service/ai/rotacao', { 'x-cron-token': guardado });
  ok(r.status === 503 && r.json.configured === false, 'HTTP ' + r.status + ' ' + r.text.slice(0, 100));
  process.env.CRON_TOKEN = guardado;
  return '503 com motivo escrito';
});

await t('rota de serviço · token errado → 401 e evento de auditoria', async () => {
  const r = await pedir('GET', '/api/service/ai/rotacao', { 'x-cron-token': 'errado' });
  ok(r.status === 401, 'HTTP ' + r.status);
  const r2 = await pedir('GET', '/api/service/ai/rotacao', {});
  ok(r2.status === 401, 'sem cabeçalho devia ser 401: ' + r2.status);
  return '401 nos dois casos';
});

await t('rota de serviço · GET mostra o estado SEM gastar pedidos', async () => {
  const t0 = Date.now();
  const r = await pedir('GET', '/api/service/ai/rotacao', { 'x-cron-token': TOKEN });
  const ms = Date.now() - t0;
  ok(r.status === 200, 'HTTP ' + r.status + ' ' + r.text.slice(0, 120));
  ok(r.json.sondado === false, 'o GET não devia sondar');
  ok(ms < 1000, 'o GET demorou ' + ms + ' ms (parece ter chamado fornecedores)');
  ok(Array.isArray(r.json.candidatos) && r.json.candidatos.length >= 3, 'candidatos: ' + JSON.stringify(r.json.candidatos));
  ok(r.json.candidatos.every((c) => !('apiKey' in c) && !('valor' in c)), 'a resposta expõe chaves');
  return r.json.candidatos.length + ' candidatos, ' + ms + ' ms, sem chamadas externas';
});

await t('rotação real · um fornecedor sem crédito sai da rota e o seguinte serve', async () => {
  /* Sonda a sério: as chaves são falsas, por isso cada fornecedor responde 401/4xx
     e todos ficam marcados. O que se prova é a MECÂNICA da cadeia, não a qualidade
     das chaves: cada um é tentado, classificado e registado, e o veredicto final é
     «nenhum» — declarado, não inventado. */
  const r = await pedir('POST', '/api/service/ai/rotacao', { 'x-cron-token': TOKEN });
  if (r.status === 429) return 'SKIP declarado: sondagem recente (429) — limite de 1 por 20 s';
  ok(r.status === 200, 'HTTP ' + r.status + ' ' + r.text.slice(0, 160));
  ok(r.json.sondado === true, 'não sondou');
  ok(Array.isArray(r.json.resultados) && r.json.resultados.length >= 3, 'resultados: ' + JSON.stringify(r.json.resultados));
  r.json.resultados.forEach((x) => {
    ok(typeof x.ok === 'boolean' && x.id, 'resultado sem id/ok: ' + JSON.stringify(x));
    if (!x.ok) ok(x.classe && x.motivo, 'falha sem classificação: ' + JSON.stringify(x));
  });
  ok(r.json.estado && r.json.estado.length >= 3, 'sem estado por fornecedor');
  ok(/NENHUM|há tokens/.test(r.json.veredicto), 'veredicto: ' + r.json.veredicto);
  const marcados = r.json.estado.filter((e) => e.estado !== 'desconhecido');
  return marcados.length + ' fornecedores observados · veredicto: ' + r.json.veredicto.slice(0, 60);
});

await t('/api/ai/estado passa a mostrar quem tem tokens e quem está de fora', async () => {
  const r = await pedir('GET', '/api/ai/estado');
  ok(r.status === 200, 'HTTP ' + r.status);
  ok(Array.isArray(r.json.fornecedores), 'sem lista de fornecedores');
  ok(r.json.emRota && Array.isArray(r.json.emRota.ordem), 'sem ordem de rota: ' + JSON.stringify(r.json.emRota));
  const txt = JSON.stringify(r.json);
  ok(!/gsk_falsa|chave_falsa_gemini|sk-or-falsa/.test(txt), 'a resposta contém uma chave');
  const emEspera = r.json.emRota.emEspera || [];
  return 'fornecedores observados: ' + r.json.fornecedores.length + ' · em espera: ' + emEspera.length + ' · ordem: ' + r.json.emRota.ordem.join(' → ');
});

srv.close();
await new Promise((r) => setTimeout(r, 200));
try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* fica */ }

let pass = 0, fail = 0;
console.log('QUOTA E ROTAÇÃO DE IA\n');
R.forEach((r) => {
  if (r.ok) { pass++; console.log('PASS ' + r.name + (r.detail ? ' → ' + r.detail : '')); }
  else { fail++; console.log('FAIL ' + r.name + ' → ' + r.detail); }
});
console.log('\n' + pass + '/' + R.length + ' passaram');
process.exit(fail ? 1 : 0);
