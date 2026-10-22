/* =====================================================================
   SSRN E SONDAS «SEM CHAVE» (fase 11)

   Camadas:
     · módulo SSRN  — identificador, mapeamento Crossref, JATS, bloqueio;
     · módulo sonda — catálogo público ≠ geração aberta (a distinção central);
     · servidor     — rotas reais /api/ssrn/:id e /api/ssrn/:id/import
                      (a parte de rede é SKIP declarado quando não há internet).

   Nada aqui contorna bloqueios: a suite prova que o módulo NÃO tenta.
   ===================================================================== */
import './_env.mjs';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../server/api.mjs';
import { extrairIdSSRN, lerMetadadosSSRN, sondarBloqueioSSRN, SSRN } from '../server/ssrn.mjs';
import { probeSemChave, probeGeracaoSemChave, KEYLESS_VERDICTS } from '../server/discovery.mjs';

const R = [];
const t = async (name, fn) => {
  try { const d = await fn(); R.push({ ok: true, name, detail: d }); }
  catch (e) { R.push({ ok: false, name, detail: e.message, skip: e.skip }); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'falhou'); };
const skip = (why) => { const e = new Error('SKIP: ' + why); e.skip = true; throw e; };
const jsonRes = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { 'content-type': 'application/json' } });
const htmlRes = (txt, status) => new Response(txt, { status: status || 200, headers: { 'content-type': 'text/html' } });

/* ---------------------------------------------------- 1. identificador */

await t('identificador · aceita as quatro formas reais e recusa o resto', async () => {
  const casos = ['4461514', 'ssrn.4461514', '10.2139/ssrn.4461514',
    'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4461514',
    'https://doi.org/10.2139/ssrn.4461514'];
  casos.forEach((c) => ok(extrairIdSSRN(c).ok && extrairIdSSRN(c).id === '4461514', 'falhou: ' + c));
  ['', 'abc', 'https://example.com/artigo', '10.2139/ssrn'].forEach((c) => {
    const r = extrairIdSSRN(c);
    ok(!r.ok && /identificador SSRN/.test(r.reason), 'aceitou lixo: ' + JSON.stringify(c));
  });
  return casos.length + ' formas aceites · 4 recusadas com motivo';
});

await t('identificador · não inventa id a partir de um número demasiado curto', async () => {
  ok(!extrairIdSSRN('123').ok, 'aceitou 123');
  ok(extrairIdSSRN('3247331').id === '3247331', 'não aceitou 7 dígitos');
  return 'exige 4–9 dígitos';
});

/* ---------------------------------------------------- 2. metadados */

const CROSSREF = {
  status: 'ok',
  message: {
    title: ['Dark Money and Voter Learning'],
    author: [
      { given: 'Keith E.', family: 'Schnakenberg', affiliation: [{ name: 'Washington University in St. Louis' }] },
      { given: 'Collin', family: 'Schumock' }
    ],
    abstract: '<jats:title>Abstract</jats:title><jats:p>We provide a model of dark money in elections.</jats:p>',
    created: { 'date-parts': [[2023, 5, 31]] },
    publisher: 'Elsevier BV',
    type: 'posted-content',
    URL: 'https://doi.org/10.2139/ssrn.4461514',
    resource: { primary: { URL: 'https://www.ssrn.com/abstract=4461514' } }
  }
};

await t('metadados · mapeia título, autores, filiação, data, DOI e resumo sem HTML', async () => {
  let pedido = null;
  const fake = async (url) => { pedido = url; return jsonRes(CROSSREF); };
  const m = await lerMetadadosSSRN('4461514', { fetchImpl: fake, mailto: 'operador@example.org' });
  ok(m.ok, 'falhou: ' + m.reason);
  ok(m.titulo === 'Dark Money and Voter Learning', 'título: ' + m.titulo);
  ok(m.autores.length === 2 && m.autores[0].nome === 'Keith E. Schnakenberg', 'autores: ' + JSON.stringify(m.autores));
  ok(/Washington University/.test(m.autores[0].afiliacao), 'sem filiação');
  ok(m.data === '2023-5-31', 'data: ' + m.data);
  ok(m.doi === '10.2139/ssrn.4461514' && m.doiUrl === 'https://doi.org/10.2139/ssrn.4461514', 'doi: ' + m.doi);
  ok(m.resumo === 'We provide a model of dark money in elections.', 'resumo com HTML: ' + m.resumo);
  ok(/crossref/i.test(pedido) && /mailto=/.test(pedido), 'pedido sem identificação: ' + pedido);
  return m.autores.length + ' autores · data ' + m.data + ' · pedido identificado';
});

await t('metadados · declara SEMPRE que o texto completo não está disponível', async () => {
  const m = await lerMetadadosSSRN('4461514', { fetchImpl: async () => jsonRes(CROSSREF) });
  ok(m.textoCompleto && m.textoCompleto.disponivel === false, 'disponivel: ' + JSON.stringify(m.textoCompleto));
  ok(/403/.test(m.textoCompleto.motivo), 'motivo sem o código HTTP: ' + m.textoCompleto.motivo);
  ok(m.textoCompleto.alternativas.length >= 2, 'sem alternativas declaradas');
  ok(/resumo do autor/i.test(m.resumoFonte || ''), 'resumo apresentado como se fosse o artigo: ' + m.resumoFonte);
  return 'texto completo: não · alternativas: ' + m.textoCompleto.alternativas.length;
});

await t('metadados · 404 do Crossref é «não depositado», não é avaria do nosso código', async () => {
  const m = await lerMetadadosSSRN('999999999', { fetchImpl: async () => jsonRes({}, 404) });
  ok(!m.ok && m.status === 404, JSON.stringify(m));
  ok(/não tem metadados/.test(m.reason), 'razão: ' + m.reason);
  return 'HTTP 404 → razão explícita';
});

await t('metadados · 429 do Crossref é limite externo, dito como tal', async () => {
  const m = await lerMetadadosSSRN('4461514', { fetchImpl: async () => jsonRes({}, 429) });
  ok(!m.ok && /429/.test(m.reason), 'razão: ' + m.reason);
  return 'HTTP 429 declarado';
});

/* ---------------------------------------------------- 3. bloqueio */

await t('bloqueio · reconhece o desafio anti-robô e NÃO tenta resolvê-lo', async () => {
  let cabecalhos = null;
  const fake = async (url, opts) => { cabecalhos = opts.headers; return htmlRes('<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>', 403); };
  const r = await sondarBloqueioSSRN('4461514', { fetchImpl: fake });
  ok(r.ok && r.bloqueado === true, JSON.stringify(r));
  ok(r.desafio === true, 'não marcou desafio');
  ok(/não se resolve nem se contorna/.test(r.conclusao), 'conclusão: ' + r.conclusao);
  ok(!cabecalhos['user-agent'] && !cabecalhos.authorization, 'enviou cabeçalhos de disfarce: ' + JSON.stringify(cabecalhos));
  return 'desafio detectado · sem disfarce de utilizador';
});

await t('bloqueio · «Content Blocked» também conta como bloqueio', async () => {
  const r = await sondarBloqueioSSRN('1', { fetchImpl: async () => htmlRes('<title>Content Blocked</title>', 403) });
  ok(r.bloqueado === true && /bloqueada/.test(r.conclusao), JSON.stringify(r));
  return r.conclusao;
});

await t('bloqueio · 200 é relatado como 200, sem prometer acesso permanente', async () => {
  const r = await sondarBloqueioSSRN('1', { fetchImpl: async () => htmlRes('<html><body>paper</body></html>', 200) });
  ok(r.bloqueado === false && /neste pedido/.test(r.conclusao), r.conclusao);
  return r.conclusao;
});

/* ---------------------------------------------------- 4. sondas sem chave */

await t('sonda · 200 em /models classifica «sem-chave», 401 «exige-chave», 500 não conclui', async () => {
  const sem = await probeSemChave({ id: 'a', base: 'https://exemplo.invalid/v1' },
    { fetchImpl: async () => jsonRes({ data: [{ id: 'm1' }, { id: 'm2' }] }) });
  ok(sem.verdict === KEYLESS_VERDICTS.semChave && sem.modelsCount === 2, JSON.stringify(sem));
  ok(sem.firstModel === 'm1', 'primeiro modelo: ' + sem.firstModel);
  const com = await probeSemChave({ id: 'b', base: 'https://exemplo.invalid/v1' }, { fetchImpl: async () => jsonRes({ error: 'no key' }, 401) });
  ok(com.verdict === KEYLESS_VERDICTS.exigeChave, JSON.stringify(com));
  const erro = await probeSemChave({ id: 'c', base: 'https://exemplo.invalid/v1' }, { fetchImpl: async () => jsonRes({}, 500) });
  ok(erro.verdict === KEYLESS_VERDICTS.indeterminado, JSON.stringify(erro));
  return 'sem-chave / exige-chave / indeterminado';
});

await t('sonda · recusa http:// e endereços privados (SSRF), sem pedido nenhum', async () => {
  let pediu = 0;
  const fake = async () => { pediu++; return jsonRes({}); };
  const a = await probeSemChave({ id: 'x', base: 'http://exemplo.com/v1' }, { fetchImpl: fake });
  const b = await probeSemChave({ id: 'y', base: 'https://127.0.0.1:8080/v1' }, { fetchImpl: fake });
  const c = await probeSemChave({ id: 'z', base: 'https://10.0.0.5/v1' }, { fetchImpl: fake });
  ok(a.verdict === KEYLESS_VERDICTS.indeterminado && /só https/.test(a.porque), JSON.stringify(a));
  ok(b.verdict === KEYLESS_VERDICTS.indeterminado && /privado/.test(b.porque), JSON.stringify(b));
  ok(c.verdict === KEYLESS_VERDICTS.indeterminado && /privado/.test(c.porque), JSON.stringify(c));
  ok(pediu === 0, 'fez ' + pediu + ' pedido(s) a endereços proibidos');
  return '0 pedidos a endereços proibidos';
});

await t('sonda · catálogo público NÃO é geração aberta: 401 na geração vence o 200 do catálogo', async () => {
  const catalogo = await probeSemChave({ id: 'z', base: 'https://exemplo.invalid/v1' }, { fetchImpl: async () => jsonRes({ data: [{ id: 'gpt-4o-mini' }] }) });
  ok(catalogo.verdict === KEYLESS_VERDICTS.semChave, 'catálogo: ' + catalogo.verdict);
  const geracao = await probeGeracaoSemChave({ id: 'z', base: 'https://exemplo.invalid/v1', firstModel: 'gpt-4o-mini' },
    { fetchImpl: async () => jsonRes({ error: { message: 'No API key was sent' } }, 401) });
  ok(geracao.verdict === KEYLESS_VERDICTS.exigeChave, 'geração: ' + geracao.verdict);
  ok(geracao.model === 'gpt-4o-mini', 'modelo usado: ' + geracao.model);
  return 'catálogo ' + catalogo.verdict + ' → geração ' + geracao.verdict;
});

await t('sonda · geração 200 com choices conta como «gera-sem-chave»; 402/429 não', async () => {
  const bom = await probeGeracaoSemChave({ id: 'p', base: 'https://exemplo.invalid/openai', firstModel: 'openai' },
    { fetchImpl: async () => jsonRes({ choices: [{ message: { content: 'oi' } }] }) });
  ok(bom.verdict === KEYLESS_VERDICTS.geraSemChave, JSON.stringify(bom));
  const pago = await probeGeracaoSemChave({ id: 'q', base: 'https://exemplo.invalid/v1', firstModel: 'm' }, { fetchImpl: async () => jsonRes({}, 402) });
  ok(pago.verdict === KEYLESS_VERDICTS.exigeChave && /402/.test(pago.porque), JSON.stringify(pago));
  const limite = await probeGeracaoSemChave({ id: 'r', base: 'https://exemplo.invalid/v1', firstModel: 'm' }, { fetchImpl: async () => jsonRes({}, 429) });
  ok(limite.verdict === KEYLESS_VERDICTS.indeterminado, JSON.stringify(limite));
  return '200 → gera · 402 → exige · 429 → indeterminado';
});

/* ---------------------------------------------------- 5. servidor */

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-ssrn-'));
const api = await createApi({ dataDir: DIR, appSecret: 'segredo-de-teste-ssrn-1234567890', secure: false });
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

await t('servidor · /api/ssrn/:id exige sessão', async () => {
  const r = await call('GET', '/api/ssrn/4461514');
  ok(r.status === 401, 'HTTP ' + r.status);
  return '401 sem sessão';
});

const reg = await call('POST', '/api/auth/register', { email: 'ssrn' + Date.now() + '@ex.pt', password: 'SuiteForte-2026', acceptTerms: true });
ok(reg.status === 201, 'registo: HTTP ' + reg.status);

await t('servidor · identificador inválido é recusado antes de qualquer pedido externo', async () => {
  const r = await call('GET', '/api/ssrn/nao-e-um-id');
  ok(r.status === 400, 'HTTP ' + r.status);
  ok(/identificador SSRN/.test(r.json.error.message), r.text.slice(0, 120));
  return '400 com motivo';
});

await t('servidor · leitura real de um registo SSRN (rede; SKIP se falhar)', async () => {
  let r;
  try { r = await call('GET', '/api/ssrn/4461514?sonda=1'); } catch (e) { skip('rede: ' + e.message); }
  if (r.status === 502) skip('Crossref inacessível: ' + (r.json && r.json.error && r.json.error.message));
  ok(r.status === 200, 'HTTP ' + r.status + ' ' + r.text.slice(0, 160));
  ok(r.json.ssrn && /Dark Money/.test(r.json.ssrn.titulo || ''), 'título: ' + (r.json.ssrn && r.json.ssrn.titulo));
  ok(r.json.ssrn.autores.length === 3, 'autores: ' + r.json.ssrn.autores.length);
  ok(r.json.ssrn.textoCompleto.disponivel === false, 'disse que tinha texto completo');
  ok(r.json.sonda && r.json.sonda.bloqueado === true, 'sonda não detectou bloqueio: ' + JSON.stringify(r.json.sonda));
  return r.json.ssrn.titulo + ' · ' + r.json.ssrn.autores.length + ' autores · texto completo inacessível · sonda HTTP ' + r.json.sonda.status;
});

await t('servidor · importação cria fonte DISCOVERED e recusa duplicado (409)', async () => {
  let a;
  try { a = await call('POST', '/api/ssrn/4461514/import', { category: 'universidades' }); } catch (e) { skip('rede: ' + e.message); }
  if (a.status === 502) skip('Crossref inacessível');
  ok(a.status === 201 || a.status === 409, 'HTTP ' + a.status + ' ' + a.text.slice(0, 160));
  if (a.status === 201) {
    ok(a.json.source.state === 'DISCOVERED', 'estado: ' + a.json.source.state);
    ok(a.json.source.discoveredVia.adapter === 'ssrn-crossref', 'adaptador: ' + JSON.stringify(a.json.source.discoveredVia));
    ok(/Texto completo NÃO acessível/.test(a.json.source.notes), 'nota não declara o bloqueio: ' + a.json.source.notes);
  }
  const b = await call('POST', '/api/ssrn/4461514/import', { category: 'universidades' });
  ok(b.status === 409, 'segunda importação: HTTP ' + b.status);
  return 'fonte DISCOVERED · duplicado 409';
});

await t('servidor · importação exige token CSRF', async () => {
  const guardado = csrf; csrf = '';
  const r = await call('POST', '/api/ssrn/4461514/import', { category: 'universidades' });
  csrf = guardado;
  ok(r.status === 403, 'HTTP ' + r.status);
  return '403 sem CSRF';
});

srv.close();
fs.rmSync(DIR, { recursive: true, force: true });

let pass = 0, fail = 0, skipped = 0;
console.log('SSRN E SONDAS «SEM CHAVE» (FASE 11)\n');
R.forEach((r) => {
  if (!r.ok && r.skip) { skipped++; console.log('SKIP ' + r.name + ' → ' + r.detail.slice(6)); return; }
  if (r.ok) { pass++; console.log('PASS ' + r.name + (r.detail ? ' → ' + r.detail : '')); }
  else { fail++; console.log('FAIL ' + r.name + ' → ' + r.detail); }
});
console.log('\n' + pass + ' passaram · ' + fail + ' falharam · ' + skipped + ' sem execução (rede)');
process.exit(fail ? 1 : 0);
