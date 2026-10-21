/* =====================================================================
   TESTES DO REGISTO DE FONTES (fase 3G)

   Duas partes, separadas de propósito:

   A. Determinística (sempre corre): normalização de URLs, deduplicação,
      rejeição de endereços privados, máquina de estados, classificação com
      evidência insuficiente, risco que limita a nota, cobertura, persistência
      e migração da base.

   B. Real (rede): descoberta com o adaptador do CourtListener e verificação
      técnica de uma fonte verdadeira. Se não houver rede, diz «SKIP» e o
      resultado global não finge que passou; se a API responder com 429,
      também não se inventa sucesso.
   ===================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../server/api.mjs';
import { createStore } from '../server/store.mjs';
import {
  parseUrl, canonicalUrl, dedupeKey, domainOf, stateFromCheck, rateSource,
  coverageFrom, SOURCE_STATES, SOURCE_CATEGORIES, JURISDICTIONS, ADAPTERS, bandOf
} from '../server/sources.mjs';

const R = [];
let skipped = 0;
const ok = (c, m) => { if (!c) throw new Error(m); return true; };
const t = async (name, fn) => {
  const t0 = Date.now();
  try { const d = await fn(); R.push({ name, status: 'PASS', detail: d, ms: Date.now() - t0 }); }
  catch (e) {
    if (String(e.message).startsWith('SKIP')) { skipped++; R.push({ name, status: 'SKIP', detail: e.message.slice(5), ms: Date.now() - t0 }); }
    else R.push({ name, status: 'FAIL', detail: e.message, ms: Date.now() - t0 });
  }
};
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'vn-fontes-' + (p || '') + '-'));

/* ======================= A. determinístico ======================= */

await t('URL canónico: sem fragmento, sem parâmetros de rastreio, query ordenada', async () => {
  const c = canonicalUrl('https://WWW.Example.gov/path/?utm_source=x&b=2&a=1#frag');
  ok(c === 'https://www.example.gov/path/?a=1&b=2', 'canónico inesperado: ' + c);
  ok(canonicalUrl('ftp://example.gov/x') === null, 'aceitou ftp');
  ok(canonicalUrl('nao-e-url') === null, 'aceitou lixo');
  return c;
});

await t('deduplicação: www, maiúsculas, rastreio e barra final caem na mesma chave', async () => {
  const a = dedupeKey('https://www.example.gov/path/?utm_campaign=z&a=1');
  const b = dedupeKey('HTTPS://EXAMPLE.GOV/path?a=1');
  const c = dedupeKey('http://example.gov/path/?a=1&utm_medium=q');
  ok(a === b && b === c, 'chaves diferentes: ' + [a, b, c].join(' | '));
  const d = dedupeKey('https://example.gov/outro-caminho?a=1');
  ok(d !== a, 'caminhos diferentes colapsaram na mesma chave');
  return a;
});

await t('endereços privados e credenciais embutidas são recusados', async () => {
  for (const bad of ['http://127.0.0.1/x', 'http://localhost:8080/', 'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/', 'http://192.168.1.1/', 'http://[::1]/', 'https://user:pass@example.gov/']) {
    const r = parseUrl(bad);
    ok(!r.ok, 'aceitou ' + bad);
  }
  ok(parseUrl('https://www.courtlistener.com/').ok, 'recusou um URL público válido');
  return '7 endereços proibidos recusados';
});

await t('estado a partir da observação: distingue bloqueio, restrição, falha e sucesso', async () => {
  const cases = [
    [{ ok: true, status: 200, ms: 120 }, 'TECHNICAL_TESTING'],
    [{ ok: false, status: 401, reason: 'autenticação' }, 'RESTRICTED'],
    [{ ok: false, status: 403, reason: 'acesso negado' }, 'RESTRICTED'],
    [{ ok: false, status: 404, reason: 'não encontrado' }, 'TEMPORARILY_UNAVAILABLE'],
    [{ ok: false, status: 503, reason: 'serviço indisponível' }, 'TEMPORARILY_UNAVAILABLE'],
    [{ ok: false, status: 0, reason: 'fetch failed' }, 'TEMPORARILY_UNAVAILABLE'],
    [{ blocked: true, reason: 'endereço privado/local proibido (SSRF)' }, 'REJECTED']
  ];
  const got = cases.map(([c, want]) => {
    const r = stateFromCheck(c);
    ok(r.state === want, 'HTTP ' + c.status + ' → ' + r.state + ' (esperado ' + want + ')');
    ok(r.why && r.why.length > 5, 'sem motivo escrito');
    return want;
  });
  return [...new Set(got)].join(', ');
});

await t('classificação: sem evidência não há nota (nem sequer «B»)', async () => {
  const r = rateSource({ meta: {}, checks: {} });
  ok(r.provisional === true, 'não se declarou provisória');
  ok(r.score === null && r.band === null, 'atribuiu nota sem evidência: ' + r.score + ' ' + r.band);
  ok(/Classificação provisória — evidência insuficiente/.test(r.verdict || ''), 'sem aviso explícito: ' + r.verdict);
  ok(r.missing.length >= 4, 'não listou o que falta: ' + JSON.stringify(r.missing));
  ok(r.riskScore === 0, 'risco inesperado: ' + r.riskScore);
  return 'provisória · falta: ' + r.missing.join('; ');
});

await t('classificação: risco elevado limita a nota global (média não esconde risco)', async () => {
  const meta = { institution: 'Tribunal X', authors: true, methodology: true, corrections: true, dates: true, independence: 80, usefulness: 80, sample: { checked: 30, errors: 1 } };
  const checksBase = { officialDomain: true, tls: true, httpStatus: 200, ms: 100, accessScore: 90, checkedAt: new Date().toISOString(), lastPublishedDays: 10 };
  const bom = rateSource({ meta, checks: Object.assign({}, checksBase) });
  ok(bom.provisional === false, 'devia ter evidência suficiente: ' + JSON.stringify(bom.missing));
  ok(bom.band && ['A', 'B'].includes(bom.band), 'nota inesperada para fonte sólida: ' + bom.band);
  const risco = rateSource({ meta, checks: Object.assign({}, checksBase, { tls: false, redirectsToOtherDomain: true, malformed: true }) });
  ok(risco.riskScore >= 60, 'risco não somou: ' + risco.riskScore);
  ok(risco.score <= 55, 'risco elevado não limitou a nota: ' + risco.score);
  ok(/risco/i.test(risco.cappedBy || ''), 'não explicou o limite: ' + risco.cappedBy);
  return 'sólida ' + bom.score + '/' + bom.band + ' · com risco ' + risco.riskScore + ' → ' + risco.score + ' (' + risco.cappedBy + ')';
});

await t('classificação: amostra pequena é declarada; sem amostra não passa de B', async () => {
  const meta = { institution: 'X', authors: true, methodology: true, corrections: true, dates: true, independence: 90, usefulness: 90 };
  const base = { officialDomain: true, tls: true, httpStatus: 200, ms: 90, accessScore: 95, checkedAt: new Date().toISOString(), lastPublishedDays: 5 };
  const sem = rateSource({ meta, checks: Object.assign({}, base) });
  ok(sem.provisional, 'sem amostra devia ser provisória');
  ok(sem.band === null, 'sem amostra deu nota definitiva: ' + sem.band);
  const pequena = rateSource({ meta: Object.assign({}, meta, { sample: { checked: 3, errors: 0 } }), checks: Object.assign({}, base) });
  ok(pequena.score <= 70, 'amostra pequena não limitou: ' + pequena.score);
  ok(/amostra pequena/.test(JSON.stringify(pequena.dims.factual.missing)), 'não avisou da amostra pequena');
  return 'sem amostra: provisória · amostra de 3: ' + pequena.score + ' (limite declarado)';
});

await t('faixas A–E coerentes e sem sobreposição', async () => {
  const pontos = [100, 85, 84, 70, 69, 50, 49, 25, 24, 0];
  const esperado = ['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D', 'E', 'E'];
  pontos.forEach((p, i) => ok(bandOf(p).band === esperado[i], p + ' → ' + bandOf(p).band));
  return '10 pontos verificados';
});

await t('cobertura: país com fontes registadas não é país coberto', async () => {
  const cov = coverageFrom([
    { jurisdiction: 'PT', category: 'tribunais', state: 'DISCOVERED' },
    { jurisdiction: 'PT', category: 'tribunais', state: 'DISCOVERED' },
    { jurisdiction: 'US', category: 'tribunais', state: 'APPROVED' },
    { jurisdiction: 'US', category: 'registos_comerciais', state: 'RESTRICTED' }
  ]);
  ok(cov.totals.sources === 4, 'total errado');
  ok(cov.totals.countriesWithSources === 2, 'países com fontes: ' + cov.totals.countriesWithSources);
  ok(cov.totals.countriesWithApproved === 1, 'países com fontes aprovadas: ' + cov.totals.countriesWithApproved);
  ok(cov.gaps.countries.includes('PT'), 'Portugal (só descobertas) devia contar como lacuna');
  ok(!cov.gaps.countries.includes('US'), 'EUA não deviam estar em lacuna');
  ok(/não fontes validadas/.test(cov.note), 'sem nota metodológica');
  return cov.totals.countriesWithSources + ' países com fontes · ' + cov.totals.countriesWithApproved + ' com fontes aprovadas · ' + cov.gaps.countries.length + ' lacunas';
});

await t('catálogo: 30 categorias, 12 estados e jurisdições com região', async () => {
  ok(Object.keys(SOURCE_CATEGORIES).length === 30, 'categorias: ' + Object.keys(SOURCE_CATEGORIES).length);
  ok(Object.keys(SOURCE_STATES).length === 12, 'estados: ' + Object.keys(SOURCE_STATES).length);
  ok(JURISDICTIONS.every((j) => j.code && j.name && j.region && j.languages.length), 'jurisdição incompleta');
  const regioes = new Set(JURISDICTIONS.map((j) => j.region));
  ok(regioes.size >= 7, 'regiões cobertas no catálogo: ' + regioes.size);
  return Object.keys(SOURCE_CATEGORIES).length + ' categorias · ' + Object.keys(SOURCE_STATES).length + ' estados · ' +
    JURISDICTIONS.length + ' jurisdições em ' + regioes.size + ' regiões';
});

/* ======================= B. servidor HTTP ======================= */

const DIR = tmp('api');
const api = await createApi({ dataDir: DIR, appSecret: 'segredo-de-teste-fontes-1234567890', secure: false });
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

await call('POST', '/api/auth/register', { email: 'fontes@ex.pt', password: 'SenhaForte-2026!', acceptTerms: true });

await t('exigir sessão: o registo de fontes não é público', async () => {
  const savedCookie = cookie, savedCsrf = csrf;
  cookie = ''; csrf = '';
  const r = await call('GET', '/api/sources');
  cookie = savedCookie; csrf = savedCsrf;
  ok(r.status === 401, 'sem sessão devia dar 401, deu ' + r.status);
  return 'HTTP 401 sem sessão';
});

await t('submissão manual: URL inválida recusada, categoria desconhecida recusada', async () => {
  const bad = await call('POST', '/api/sources', { url: 'http://127.0.0.1/x', category: 'tribunais' });
  ok(bad.status === 400, 'aceitou endereço privado: ' + bad.status);
  const cat = await call('POST', '/api/sources', { url: 'https://www.courtlistener.com/', category: 'inventada' });
  ok(cat.status === 400, 'aceitou categoria inventada: ' + cat.status);
  return 'HTTP 400 nos dois casos, com motivo';
});

await t('fonte registada entra como DISCOVERED e o duplicado é recusado com 409', async () => {
  const a = await call('POST', '/api/sources', {
    url: 'https://www.courtlistener.com/api/rest/v4/search/', name: 'CourtListener — pesquisa',
    category: 'tribunais', jurisdiction: 'US', institution: 'Free Law Project'
  });
  ok(a.status === 201, 'criação: HTTP ' + a.status + ' ' + a.text.slice(0, 120));
  ok(a.json.source.state === 'DISCOVERED', 'estado inicial: ' + a.json.source.state);
  const b = await call('POST', '/api/sources', {
    url: 'https://courtlistener.com/api/rest/v4/search?utm_source=x', name: 'outro nome', category: 'tribunais'
  });
  ok(b.status === 409, 'duplicado não recusado: ' + b.status);
  ok(b.json.existing && b.json.existing.id === a.json.source.id, 'não apontou para a fonte existente');
  return '201 e depois 409 (mesmo URL canónico, nomes diferentes)';
});

const SID = (await call('GET', '/api/sources')).json.items[0].id;

await t('verificação técnica real da fonte registada (HTTP observado e datado)', async () => {
  const r = await call('POST', '/api/sources/' + SID + '/check', {});
  ok(r.status === 200, 'verificação falhou: HTTP ' + r.status + ' ' + r.text.slice(0, 160));
  ok(r.json.check && typeof r.json.check.httpStatus === 'number', 'sem HTTP observado');
  ok(r.json.check.at, 'sem data da observação');
  ok(r.json.source.lastCheckAt === r.json.check.at, 'a fonte não guardou a data da verificação');
  return 'HTTP ' + r.json.check.httpStatus + ' · ' + r.json.check.ms + ' ms · estado ' + r.json.source.state + ' · ' + r.json.interpretation;
});

await t('classificação sem evidência fica provisória e não autoriza aprovação', async () => {
  const r = await call('POST', '/api/sources/' + SID + '/rate', { meta: {} });
  ok(r.status === 200, 'classificação: HTTP ' + r.status);
  ok(r.json.rating.provisional === true, 'não ficou provisória');
  ok(r.json.rating.score === null, 'atribuiu nota: ' + r.json.rating.score);
  ok(/provisória/i.test(r.json.nota || ''), 'sem aviso na resposta');
  const d = await call('POST', '/api/sources/' + SID + '/decision', { decision: 'approve', reason: 'parece boa e é oficial' });
  ok(d.status === 409, 'aprovou uma fonte com classificação provisória: ' + d.status);
  return 'provisória (' + r.json.rating.missing.length + ' critérios em falta) e aprovação recusada com 409';
});

await t('decisão exige motivo escrito; rejeitar funciona e fica auditado', async () => {
  const sem = await call('POST', '/api/sources/' + SID + '/decision', { decision: 'reject', reason: 'curto' });
  ok(sem.status === 400, 'aceitou motivo com 5 caracteres: ' + sem.status);
  const sim = await call('POST', '/api/sources/' + SID + '/decision', { decision: 'reject', reason: 'fonte fora do âmbito desta investigação: duplicada noutro registo' });
  ok(sim.status === 200, 'rejeição: HTTP ' + sim.status);
  ok(sim.json.source.state === 'REJECTED', 'estado: ' + sim.json.source.state);
  const det = await call('GET', '/api/sources/' + SID);
  ok(det.json.decisions.length === 1 && /duplicada/.test(det.json.decisions[0].reason), 'decisão não guardada com motivo');
  const audit = api.store.auditList({ type: 'source_decision', limit: 5 });
  ok(audit.length >= 1, 'sem registo de auditoria');
  return 'REJECTED com motivo guardado e auditoria «source_decision»';
});

await t('aprovação com evidência suficiente passa (e é o único caminho)', async () => {
  const meta = { institution: 'Free Law Project', authors: true, methodology: true, corrections: true, dates: true,
    independence: 85, usefulness: 90, sample: { checked: 25, errors: 0 }, lastPublishedDays: 2 };
  const r = await call('POST', '/api/sources/' + SID + '/rate', { meta });
  ok(r.status === 200 && r.json.rating.provisional === false, 'não atingiu evidência suficiente: ' + JSON.stringify(r.json.rating.missing));
  const d = await call('POST', '/api/sources/' + SID + '/decision', { decision: 'approve', reason: 'fonte primária de jurisprudência com API documentada e amostra verificada' });
  ok(d.status === 200, 'aprovação: HTTP ' + d.status + ' ' + d.text.slice(0, 120));
  ok(d.json.source.state === 'APPROVED', 'estado: ' + d.json.source.state);
  return 'nota ' + r.json.rating.score + '/' + r.json.rating.band + ' · aprovada com motivo';
});

await t('histórico de classificações preservado (não se apaga a nota anterior)', async () => {
  const r = await call('GET', '/api/sources/' + SID);
  ok(r.json.ratings.length === 2, 'classificações guardadas: ' + r.json.ratings.length);
  ok(r.json.ratings[0].provisional === true && r.json.ratings[1].provisional === false, 'ordem ou conteúdo errados');
  return r.json.ratings.length + ' classificações datadas, das quais ' + r.json.ratings.filter((x) => x.provisional).length + ' provisória(s)';
});

await t('cobertura e lacunas calculadas a partir do que está registado', async () => {
  const r = await call('GET', '/api/coverage');
  ok(r.status === 200, 'HTTP ' + r.status);
  ok(r.json.totals.sources === 1, 'fontes contadas: ' + r.json.totals.sources);
  ok(r.json.totals.countriesWithApproved === 1, 'países aprovados: ' + r.json.totals.countriesWithApproved);
  ok(r.json.gaps.categories.length >= 25, 'lacunas de categoria: ' + r.json.gaps.categories.length);
  return r.json.totals.sources + ' fonte · ' + r.json.totals.countriesWithApproved + ' país aprovado · ' +
    r.json.gaps.categories.length + ' categorias sem qualquer fonte';
});

/* ======================= C. descoberta real ======================= */

await t('descoberta real pelo CourtListener (API pública, sem chave)', async () => {
  const r = await call('POST', '/api/discovery/run', { adapter: 'courtlistener_courts', pageSize: 20 });
  if (r.status === 502) {
    const msg = (r.json && r.json.error) || r.text.slice(0, 120);
    if (/429|limite/i.test(msg)) throw new Error('SKIP limite de utilização da API pública: ' + msg);
    throw new Error('SKIP sem rede ou API indisponível: ' + msg);
  }
  ok(r.status === 200, 'HTTP ' + r.status + ' ' + r.text.slice(0, 160));
  ok(r.json.found >= 4, 'resultados encontrados: ' + r.json.found);
  ok(r.json.created + r.json.duplicates === r.json.candidates, 'contas não fecham: ' + JSON.stringify({ cand: r.json.candidates, c: r.json.created, d: r.json.duplicates }));
  ok(r.json.query.includes('courtlistener.com'), 'a consulta não está registada');
  const after = await call('GET', '/api/sources?limit=500');
  ok(after.json.stats.DISCOVERED >= r.json.created, 'as fontes descobertas não ficaram como DISCOVERED');
  return r.json.found + ' candidatos · ' + r.json.created + ' novas · ' + r.json.duplicates + ' duplicadas · em ' + r.json.durationMs + ' ms';
});

await t('a execução de descoberta fica no histórico com a consulta exacta', async () => {
  const r = await call('GET', '/api/discovery/runs');
  ok(r.status === 200 && r.json.runs.length >= 1, 'sem histórico');
  const run = r.json.runs[0];
  /* se a execução falhou por limite da API pública, isto não é uma falha do
     nosso código: fica registado como não executado, com o motivo. */
  if (run.status === 'failed' && /429|limite/i.test(run.error || '')) throw new Error('SKIP a API pública limitou os pedidos: ' + run.error);
  ok(run.query && run.status === 'completed', 'execução sem consulta ou não concluída: ' + JSON.stringify({ s: run.status, q: run.query }));
  ok(typeof run.created === 'number' && typeof run.duplicates === 'number', 'sem contagens');
  return run.status + ' · ' + run.found + ' encontrados · ' + run.created + ' criados · consulta registada';
});

await t('modo de teste não grava nada', async () => {
  const before = (await call('GET', '/api/sources?limit=500')).json.total;
  const r = await call('POST', '/api/discovery/run', { adapter: 'courtlistener_courts', pageSize: 10, dryRun: true });
  if (r.status === 502) throw new Error('SKIP limite/sem rede');
  ok(r.status === 200, 'HTTP ' + r.status);
  const after = (await call('GET', '/api/sources?limit=500')).json.total;
  ok(after === before, 'o modo de teste gravou: ' + before + '→' + after);
  ok(/nada foi gravado/i.test(r.json.nota || ''), 'sem aviso de modo de teste');
  return 'dry-run: ' + r.json.created + ' candidatos previstos, catálogo intacto (' + before + ')';
});

await t('persistência e migração: reiniciar mantém fontes e histórico', async () => {
  const before = (await call('GET', '/api/sources?limit=500')).json;
  await api.close();
  const store2 = await createStore(DIR).init();
  const after = store2.sources();
  ok(after.length === before.total, 'fontes após reinício: ' + after.length + ' (antes ' + before.total + ')');
  ok(store2.discoveryRuns().length >= 1, 'histórico de descoberta perdido');
  ok(store2.schemaVersion() === 6, 'versão do esquema: ' + store2.schemaVersion());
  const mig = store2.migrations().map((m) => m.to);
  ok(mig.includes(6), 'migração 6 não registada: ' + mig.join(','));
  ok(store2.ratingsOf(SID).length === 2, 'classificações perdidas');
  await store2.close();
  return after.length + ' fontes · esquema v' + store2.schemaVersion() + ' · migrações ' + mig.join('→');
});

srv.close();

console.log('REGISTO DE FONTES — DESCOBERTA, VERIFICAÇÃO E CLASSIFICAÇÃO');
for (const r of R) console.log(r.status + ' ' + r.name + ' → ' + String(r.detail).slice(0, 220));
const pass = R.filter((r) => r.status === 'PASS').length;
const fail = R.filter((r) => r.status === 'FAIL').length;
console.log('\n' + pass + ' passaram · ' + fail + ' falharam · ' + skipped + ' sem execução (rede/limite)');
if (fail) process.exitCode = 1;
