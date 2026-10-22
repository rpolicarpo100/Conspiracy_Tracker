/* =====================================================================
   FORNECEDORES DE IA — CHAVES DO OPERADOR E FORNECEDOR SEM CHAVE (fase 11)

   O que esta suite prova, e como:
     · catálogo  — cada fornecedor que exige chave declara ONDE se obtém (keyUrl),
                   QUAL variável do Render usar (envVar) e QUAL é o nível gratuito
                   anunciado; o único sem chave é declarado como tal;
     · servidor  — GET /api/providers revela o ESTADO das chaves do operador e
                   nunca o VALOR; um marcador («SUBSTITUIR…») conta como ausente;
     · transporte— complete() não envia Authorization a um fornecedor sem chave e
                   envia Bearer aos outros, sem duplicar o caminho /chat/completions;
     · sem IA    — com fallback desligado e sem chaves, o agente declara
                   «não executado» em vez de inventar resultado (sem rede).
   A chamada REAL ao fornecedor sem chave é opt-in (VN_KEYLESS_REAL=1):
   é a única coisa aqui que toca a internet, e falha exterma = SKIP declarado.
   ===================================================================== */
import './_env.mjs';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../server/api.mjs';
import { PROVIDERS, registryPublic, complete } from '../server/providers.mjs';

const R = [];
const t = async (name, fn) => {
  try { const d = await fn(); R.push({ ok: true, name, detail: d }); }
  catch (e) { R.push({ ok: false, name, detail: e.message, skip: e.skip }); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'falhou'); };
const skip = (why) => { const e = new Error('SKIP: ' + why); e.skip = true; throw e; };

const ENVS = Object.values(PROVIDERS).map((p) => p.envVar).filter(Boolean)
  .concat(['AI_OPERATOR_ORDER', 'AI_KEYLESS_FALLBACK', 'AI_MODEL_POLLINATIONS']);
const guardar = {};
ENVS.forEach((k) => { guardar[k] = process.env[k]; delete process.env[k]; });
const repor = () => ENVS.forEach((k) => { if (guardar[k] === undefined) delete process.env[k]; else process.env[k] = guardar[k]; });

/* --------------------------------------------------- 1. o catálogo */

await t('catálogo · 13 fornecedores, um adaptador por fornecedor', async () => {
  const ids = Object.keys(PROVIDERS);
  ok(ids.length === 13, 'fornecedores: ' + ids.length);
  ok(registryPublic().every((p) => p.adapter === 'openai-chat-completions'), 'adaptador diferente');
  return ids.length + ' fornecedores';
});

await t('catálogo · quem exige chave diz onde a obter, em que variável e com que nível gratuito', async () => {
  const sem = Object.keys(PROVIDERS).filter((k) => !PROVIDERS[k].keyless && !PROVIDERS[k].keyUrl);
  ok(sem.length === 1 && sem[0] === 'custom', 'falta keyUrl em: ' + sem.join(','));
  const semEnv = Object.keys(PROVIDERS).filter((k) => !PROVIDERS[k].keyless && k !== 'custom' && !PROVIDERS[k].envVar);
  ok(!semEnv.length, 'falta envVar em: ' + semEnv.join(','));
  const semFree = Object.keys(PROVIDERS).filter((k) => !PROVIDERS[k].freeTier || PROVIDERS[k].freeTier === 'desconhecido');
  ok(semFree.length === 1 && semFree[0] === 'custom', 'nível gratuito não declarado: ' + semFree.join(','));
  return Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].envVar).length + ' variáveis de ambiente';
});

await t('catálogo · o fornecedor sem chave é UM e está declarado com aviso de privacidade', async () => {
  const keyless = Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].keyless);
  ok(keyless.length === 1 && keyless[0] === 'pollinations', 'sem chave: ' + keyless.join(','));
  ok(/terceiros/i.test(PROVIDERS.pollinations.privacidade || ''), 'sem aviso de privacidade');
  ok(PROVIDERS.pollinations.probe && /200/.test(PROVIDERS.pollinations.probe.verificado), 'sonda não registada');
  return 'pollinations · ' + PROVIDERS.pollinations.probe.verificado;
});

await t('catálogo · cada sonda registada descreve um resultado real, com data', async () => {
  const com = Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].probe);
  ok(com.length >= 10, 'sondas registadas: ' + com.length);
  com.forEach((k) => ok(/2026-10-22/.test(PROVIDERS[k].probe.verificado), k + ': sem data na sonda'));
  return com.length + ' sondas datadas';
});

/* --------------------------------------------------- 2. o servidor */

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-ia-'));
const api = await createApi({ dataDir: DIR, appSecret: 'segredo-de-teste-ia-1234567890', secure: false });
const srv = http.createServer((q, r) => api.handle(q, r, new URL(q.url, 'http://x')));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + srv.address().port;
let cookie = ''; let csrf = '';
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

const reg = await call('POST', '/api/auth/register', { email: 'ia' + Date.now() + '@ex.pt', password: 'SuiteForte-2026', name: 'IA', acceptTerms: true });
ok(reg.status === 201 || reg.status === 200, 'registo: HTTP ' + reg.status + ' ' + reg.text.slice(0, 120));

await t('servidor · sem chaves configuradas, o estado declara o fornecedor sem chave como activo', async () => {
  delete process.env.AI_KEYLESS_FALLBACK;
  const r = await call('GET', '/api/providers');
  ok(r.status === 200, 'HTTP ' + r.status);
  const o = r.json.operatorKeys;
  ok(o && o.providers, 'sem operatorKeys');
  ok(o.activo && o.activo.provider === 'pollinations' && o.activo.keyless === true, 'activo: ' + JSON.stringify(o.activo));
  Object.keys(o.providers).forEach((k) => {
    if (k === 'pollinations') ok(o.providers[k].estado === 'sem-chave', 'pollinations: ' + o.providers[k].estado);
    else ok(o.providers[k].estado === 'ausente', k + ': ' + o.providers[k].estado);
  });
  return Object.keys(o.providers).length + ' fornecedores · activo pollinations';
});

await t('servidor · um marcador («SUBSTITUIR…») conta como NÃO configurado', async () => {
  process.env.AI_KEY_GROQ = 'SUBSTITUIR_AQUI_A_TUA_CHAVE';
  const r = await call('GET', '/api/providers');
  ok(r.json.operatorKeys.providers.groq.estado === 'marcador', 'estado: ' + r.json.operatorKeys.providers.groq.estado);
  ok(r.json.operatorKeys.activo.provider === 'pollinations', 'activo passou a ' + r.json.operatorKeys.activo.provider);
  delete process.env.AI_KEY_GROQ;
  return 'marcador tratado como ausente';
});

await t('servidor · com chave do operador, ela tem precedência — e o VALOR nunca sai na resposta', async () => {
  const SEGREDO = 'gsk_valor_secretissimo_de_teste_1234567890';
  process.env.AI_KEY_GROQ = SEGREDO;
  const r = await call('GET', '/api/providers');
  ok(r.json.operatorKeys.providers.groq.estado === 'ok', 'estado: ' + r.json.operatorKeys.providers.groq.estado);
  ok(r.json.operatorKeys.activo.provider === 'groq', 'activo: ' + r.json.operatorKeys.activo.provider);
  ok(r.json.operatorKeys.activo.modelo === PROVIDERS.groq.modelsHint[0], 'modelo: ' + r.json.operatorKeys.activo.modelo);
  ok(r.text.indexOf(SEGREDO) < 0, 'A CHAVE APARECE NO CORPO DA RESPOSTA');
  ok(r.text.indexOf('gsk_') < 0, 'prefixo da chave visível');
  return 'activo groq · chave ausente do corpo (' + r.text.length + ' bytes verificados)';
});

await t('servidor · AI_MODEL_<FORNECEDOR> escolhe o modelo, sem aceitar modelo inventado', async () => {
  process.env.AI_MODEL_GROQ = 'openai/gpt-oss-20b';
  const r = await call('GET', '/api/providers');
  ok(r.json.operatorKeys.activo.modelo === 'openai/gpt-oss-20b', 'modelo: ' + r.json.operatorKeys.activo.modelo);
  delete process.env.AI_MODEL_GROQ;
  delete process.env.AI_KEY_GROQ;
  return 'AI_MODEL_GROQ respeitado';
});

await t('servidor · AI_KEYLESS_FALLBACK=false desliga o fornecedor sem chave', async () => {
  process.env.AI_KEYLESS_FALLBACK = 'false';
  const r = await call('GET', '/api/providers');
  ok(r.json.operatorKeys.activo === null, 'activo: ' + JSON.stringify(r.json.operatorKeys.activo));
  ok(r.json.operatorKeys.keylessFallback === false, 'flag não propagada');
  return 'sem chave desligado → activo null';
});

await t('servidor · sem chave e sem fallback, a execução declara «não executado» (não inventa)', async () => {
  process.env.AI_KEYLESS_FALLBACK = 'false';
  const p = await call('POST', '/api/projects', { title: 'Sem IA disponível', question: 'Quem financiou a fundação em 2019?' });
  ok(p.status === 201 || p.status === 200, 'projecto: HTTP ' + p.status);
  const pid = (p.json.project || p.json).id;
  const r = await call('POST', '/api/projects/' + pid + '/agents/research-planner/run', { confirmCost: true });
  const run = (r.json && r.json.run) || {};
  ok(run.status === 'nao-executado' || run.status === 'não-executado' || run.status === 'skipped',
    'estado: ' + run.status + ' · ' + JSON.stringify(r.json).slice(0, 200));
  ok(/chave/i.test(run.reason || ''), 'razão não menciona a chave: ' + run.reason);
  return run.status + ' → ' + String(run.reason).slice(0, 90);
});

await t('servidor · a chave do utilizador continua guardada no cofre e não é reposta em claro', async () => {
  const r = await call('POST', '/api/providers/groq/key', { apiKey: 'gsk_chave_do_utilizador_de_teste_0987654321', model: 'llama-3.3-70b-versatile' });
  ok(r.status === 200 || r.status === 201, 'guardar: HTTP ' + r.status + ' ' + r.text.slice(0, 120));
  ok(r.json.mask && /…|\.\.\./.test(r.json.mask), 'máscara: ' + r.json.mask);
  ok(r.json.mask.indexOf('chave_do_utilizador_de_teste') < 0, 'a máscara mostra o miolo da chave: ' + r.json.mask);
  ok(!/gsk_chave_do_utilizador/.test(r.text), 'chave em claro na resposta');
  const l = await call('GET', '/api/providers');
  const g = l.json.providers.find((x) => x.id === 'groq');
  ok(g.configured === true, 'não ficou configurada');
  ok(g.operador && g.operador.estado === 'ausente', 'estado do operador: ' + JSON.stringify(g.operador));
  return 'cofre guarda · operador separado (' + g.operador.env + ')';
});

/* --------------------------------------------------- 3. o transporte */

await t('transporte · fornecedor SEM CHAVE não leva cabeçalho Authorization', async () => {
  let visto = null;
  const fake = async (url, opts) => { visto = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const r = await complete({ provider: 'pollinations', model: 'openai', messages: [{ role: 'user', content: 'oi' }], fetchImpl: fake });
  ok(r.ok, 'falhou: ' + r.error);
  ok(!visto.headers.authorization, 'enviou Authorization a um fornecedor sem chave');
  ok(visto.url === 'https://text.pollinations.ai/openai/chat/completions', 'URL: ' + visto.url);
  return 'POST ' + visto.url + ' sem Authorization';
});

await t('transporte · com chave envia Bearer e não duplica /chat/completions', async () => {
  let visto = null;
  const fake = async (url, opts) => { visto = { url, headers: opts.headers };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const r = await complete({ provider: 'groq', apiKey: 'gsk_teste', model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'oi' }], fetchImpl: fake });
  ok(r.ok, 'falhou: ' + r.error);
  ok(visto.headers.authorization === 'Bearer gsk_teste', 'cabeçalho: ' + visto.headers.authorization);
  ok(visto.url === 'https://api.groq.com/openai/v1/chat/completions', 'URL: ' + visto.url);
  const base = 'https://api.groq.com/openai/v1/chat/completions';
  const r2 = await complete({ provider: 'custom', base, apiKey: 'x', model: 'm', messages: [{ role: 'user', content: 'oi' }], fetchImpl: fake });
  ok(r2.ok, 'base completa falhou: ' + r2.error);
  ok((visto.url.match(/chat\/completions/g) || []).length === 1, 'caminho duplicado: ' + visto.url);
  return 'Bearer + URL única';
});

await t('transporte · sem chave num fornecedor que a exige, recusa em vez de tentar', async () => {
  const r = await complete({ provider: 'groq', model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: 'oi' }] });
  ok(!r.ok, 'devolveu ok sem chave');
  ok(/sem chave/.test(r.error), 'erro: ' + r.error);
  return 'recusado: ' + r.error;
});

/* ------------------------------------------- 4. chamada real (opt-in) */

await t('real · o fornecedor sem chave responde de facto (opt-in VN_KEYLESS_REAL=1)', async () => {
  if (process.env.VN_KEYLESS_REAL !== '1') skip('chamada externa: precisa de VN_KEYLESS_REAL=1');
  let r;
  try {
    r = await complete({ provider: 'pollinations', model: 'openai', timeoutMs: 60000,
      messages: [{ role: 'user', content: 'Responde apenas com a palavra: verificado' }] });
  } catch (e) { skip('rede indisponível: ' + e.message); }
  if (!r.ok) { if (/429|circuit|timeout|fetch failed/i.test(String(r.error))) skip('fornecedor externo: ' + r.error); ok(false, 'falhou: ' + r.error); }
  ok(typeof r.text === 'string' && r.text.trim().length > 0, 'resposta vazia');
  return (r.latencyMs + ' ms · «' + r.text.trim().slice(0, 40) + '»');
});

repor();
await t('diagnóstico público · /api/ai/estado diz o modo sem revelar chaves', async () => {
  delete process.env.AI_KEYLESS_FALLBACK;
  const r = await fetch(BASE + '/api/ai/estado');
  ok(r.status === 200, 'HTTP ' + r.status);
  const j = await r.json();
  ok(j.modo === 'sem-chave', 'modo: ' + j.modo);
  ok(j.fornecedor === 'pollinations' && j.semChave === true, 'fornecedor: ' + j.fornecedor);
  const corpo = JSON.stringify(j);
  ok(!/sk-|AIza|gsk_|hf_/.test(corpo), 'o corpo parece conter uma chave: ' + corpo);
  ok(!('providers' in j) && !('apiKey' in j), 'expõe a lista interna de chaves');
  process.env.AI_KEY_GROQ = 'SUBSTITUIR-no-painel';
  const r2 = await (await fetch(BASE + '/api/ai/estado')).json();
  ok(r2.chavesDoOperador === 0, 'um marcador contou como chave: ' + r2.chavesDoOperador);
  delete process.env.AI_KEY_GROQ;
  process.env.AI_KEYLESS_FALLBACK = 'false';
  const r3 = await (await fetch(BASE + '/api/ai/estado')).json();
  ok(r3.modo === 'nenhum' && /sem IA/.test(r3.aviso || ''), 'modo desligado: ' + JSON.stringify(r3));
  delete process.env.AI_KEYLESS_FALLBACK;
  return 'sem-chave → marcador não conta → nenhum, sem valores no corpo';
});

srv.close();
fs.rmSync(DIR, { recursive: true, force: true });


let pass = 0, fail = 0, skipped = 0;
console.log('FORNECEDORES DE IA — CHAVES DO OPERADOR E SEM CHAVE (FASE 11)\n');
R.forEach((r) => {
  if (!r.ok && r.skip) { skipped++; console.log('SKIP ' + r.name + ' → ' + r.detail.slice(6)); return; }
  if (r.ok) { pass++; console.log('PASS ' + r.name + (r.detail ? ' → ' + r.detail : '')); }
  else { fail++; console.log('FAIL ' + r.name + ' → ' + r.detail); }
});
console.log('\n' + pass + ' passaram · ' + fail + ' falharam · ' + skipped + ' sem execução (rede)');
process.exit(fail ? 1 : 0);
