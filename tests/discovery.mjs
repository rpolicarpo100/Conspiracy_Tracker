/* =====================================================================
   DESCOBERTA CONTÍNUA — CATEGORIAS A–E E OS 9 CAMPOS DE ACESSO (fase 6)

   Camadas:
     · módulo  — regras de categoria, validação dos 9 campos, cobertura,
                 parsers dos dois adaptadores novos e a fusão que impede uma
                 descoberta de apagar uma medição;
     · servidor — rotas reais: descoberta (rede, SKIP se falhar), categorias,
                 filtros do catálogo e o invariante «descobrir não despromove»;
     · honestidade — o que a fonte não publica fica UNKNOWN e é contado.
   ===================================================================== */
import './_env.mjs';   // opt-in explícito: registo aberto só nos testes (ver tests/_env.mjs)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../server/api.mjs';
import {
  ACCESS_DETAIL_FIELDS, DISCOVERY_CATEGORY_LABELS, ADAPTERS,
  categoryOf, categorySummary, accessDetailCoverage, validateAccessDetails,
  fromModelsDev, fromGitHubSearch, mergeDiscovered
} from '../server/discovery.mjs';

const R = [];
const t = async (name, fn) => {
  try { const d = await fn(); R.push({ ok: true, name, detail: d }); }
  catch (e) { R.push({ ok: false, name, detail: e.message, skip: e.skip }); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'falhou'); };
const skip = (why) => { const e = new Error('SKIP: ' + why); e.skip = true; throw e; };

/* ------------------------------------------------------ 1. os 9 campos */

await t('são exactamente 9 campos de acesso, com rótulo legível', async () => {
  const f = Object.keys(ACCESS_DETAIL_FIELDS);
  ok(f.length === 9, 'campos: ' + f.length);
  ['conta', 'cartao', 'limites', 'concorrencia', 'geografia', 'usoComercial', 'privacidade', 'hardware', 'confirmadoEm']
    .forEach((x) => ok(f.includes(x), 'falta ' + x));
  ok(Object.values(ACCESS_DETAIL_FIELDS).every((v) => v.length > 10), 'rótulo curto demais');
  return f.join(' · ');
});

await t('valor sem fonte é RECUSADO (não se escreve «grátis» sem dizer quem o disse)', async () => {
  const semUrl = validateAccessDetails({ accessDetails: { cartao: { status: 'DECLARED', value: 'não é preciso' } } });
  ok(!semUrl.ok && /DECLARED sem URL/.test(semUrl.errors[0].msg), JSON.stringify(semUrl.errors));
  const semMetodo = validateAccessDetails({ accessDetails: { limites: { status: 'MEASURED', value: '60 rpm', at: '2026-10-22' } } });
  ok(!semMetodo.ok && /MEASURED sem método/.test(semMetodo.errors[0].msg), JSON.stringify(semMetodo.errors));
  const vazio = validateAccessDetails({ accessDetails: { privacidade: { status: 'DECLARED', value: '   ', url: 'https://x.pt' } } });
  ok(!vazio.ok && /valor vazio/.test(vazio.errors[0].msg), JSON.stringify(vazio.errors));
  const campoMau = validateAccessDetails({ accessDetails: { salarioDoCEO: { status: 'UNKNOWN' } } });
  ok(!campoMau.ok && /campo de acesso desconhecido/.test(campoMau.errors[0].msg), JSON.stringify(campoMau.errors));
  const bom = validateAccessDetails({ accessDetails: {
    limites: { status: 'MEASURED', value: '60 rpm', at: '2026-10-22', method: 'GET /rate-limits' },
    cartao: { status: 'UNKNOWN' }
  } });
  ok(bom.ok, JSON.stringify(bom.errors));
  return '4 recusas (sem URL, sem método, valor vazio, campo inventado) · 1 aceitação';
});

await t('UNKNOWN é o valor por omissão e nunca é disfarçado de resposta', async () => {
  const cov = accessDetailCoverage({});
  ok(cov.known === 0 && cov.pct === 0 && cov.unknown.length === 9, JSON.stringify(cov));
  const parcial = accessDetailCoverage({ accessDetails: {
    limites: { status: 'MEASURED', value: '60 rpm', at: 'x', method: 'y' },
    cartao: { status: 'DECLARED', value: 'não', url: 'https://x.pt' }
  } });
  ok(parcial.known === 2 && parcial.pct === 22, JSON.stringify(parcial));
  ok(parcial.unknown.includes('privacidade') && parcial.unknown.includes('concorrencia'), 'faltas mal calculadas');
  return 'vazio: 0/9 (0 %) · 2 campos com prova: 2/9 (22 %) com 7 faltas nomeadas';
});

/* ------------------------------------------------------ 2. categorias A–E */

await t('a mesma entrada cai sempre na mesma categoria (regra, não escolha manual)', async () => {
  const casos = [
    [{ kind: 'endpoint', access: { class: 'ANONYMOUS_PUBLIC' } }, 'A'],
    [{ kind: 'endpoint', access: { class: 'FREE_API_KEY' }, category: 'api com plano gratuito' }, 'B'],
    [{ kind: 'endpoint', access: { class: 'FREE_API_KEY' }, category: 'router/agregador' }, 'C'],
    [{ kind: 'tool', access: { class: 'UNKNOWN_ACCESS' } }, 'D'],
    [{ kind: 'model', access: { class: 'PAID' } }, 'E'],
    [{ kind: 'weights', access: { class: 'UNKNOWN_ACCESS' } }, 'E']
  ];
  casos.forEach(([e, esperado]) => ok(categoryOf(e) === esperado, JSON.stringify(e) + ' → ' + categoryOf(e) + ' (esperado ' + esperado + ')'));
  const seedLike = [
    { key: 'providers/groq', kind: 'endpoint', access: { class: 'FREE_API_KEY' }, category: 'api com plano gratuito' },
    { key: 'providers/openrouter', kind: 'endpoint', access: { class: 'FREE_API_KEY' }, category: 'router/agregador' },
    { key: 'tools/opencode', kind: 'tool', access: { class: 'LOCAL_RUNTIME' } }
  ];
  const sum = categorySummary(seedLike);
  ok(sum.categories.find((c) => c.id === 'B').total === 1, 'B: ' + JSON.stringify(sum.categories.find((c) => c.id === 'B')));
  ok(sum.categories.find((c) => c.id === 'C').total === 1, 'C errado');
  ok(sum.categories.find((c) => c.id === 'D').total === 1, 'D errado');
  ok(sum.totals.entries === 3, 'total ' + sum.totals.entries);
  return '6 regras verificadas · semente: B=1 C=1 D=1 · 5 rótulos: ' + Object.values(DISCOVERY_CATEGORY_LABELS).length;
});

/* ------------------------------------------------------ 3. parsers */

const MD = {
  openrouter: { id: 'openrouter', env: ['OPENROUTER_API_KEY'], api: 'https://openrouter.ai/api/v1', name: 'OpenRouter', doc: 'https://openrouter.ai/models',
    models: {
      'x/barato': { id: 'x/barato', cost: { input: 0.1, output: 0.2 }, limit: { context: 32000, output: 1000 }, open_weights: false },
      'x/gratis': { id: 'x/gratis', cost: { input: 0, output: 0 }, limit: { context: 8000, output: 500 }, open_weights: true }
    } },
  localito: { id: 'localito', env: [], api: null, name: 'Localito', doc: 'https://localito.example/docs',
    models: { m1: { id: 'm1', cost: { input: 0, output: 0 }, limit: { context: 16000 }, open_weights: true } } },
  semdados: { id: 'semdados', name: 'Sem Dados', models: {} }
};

await t('models.dev: um registo por fornecedor, com preço, contexto e o que fica UNKNOWN', async () => {
  const out = fromModelsDev(MD, { at: '2026-10-22T10:00:00Z', url: 'https://models.dev/api.json' });
  ok(out.entries.length === 3, 'entradas: ' + out.entries.length);
  ok(out.modelsTotal === 3, 'modelos contados: ' + out.modelsTotal);
  const or = out.entries.find((e) => e.key === 'providers/openrouter');
  ok(or.access.class === 'FREE_TRIAL', 'classe: ' + or.access.class);
  ok(or.contextLength === 32000, 'contexto: ' + or.contextLength);
  /* o preço de referência é o do modelo PAGO mais barato: um modelo grátis no
     catálogo não torna a tarefa gratuita. A existência de preço 0 aparece na
     classe (FREE_TRIAL) e na evidência, não no preço usado para custear. */
  ok(or.pricing.prompt === 0.1 && or.pricing.completion === 0.2, 'preço de referência: ' + JSON.stringify(or.pricing));
  ok(or.access.class === 'FREE_TRIAL', 'havendo modelo a preço 0, a classe devia assinalá-lo: ' + or.access.class);
  const cov = accessDetailCoverage(or);
  ok(cov.known === 3 && cov.unknown.length === 6, 'cobertura: ' + JSON.stringify(cov));
  ok(cov.unknown.includes('privacidade') && cov.unknown.includes('geografia'), 'campos em falta mal listados');
  const prova = or.accessDetails.limites;
  ok(prova.status === 'MEASURED' && prova.at && prova.method, 'limites sem prova: ' + JSON.stringify(prova));
  ok(validateAccessDetails(or).ok, JSON.stringify(validateAccessDetails(or).errors));
  return '3 fornecedores · ' + out.modelsTotal + ' modelos contados · preço e contexto MEDIDOS · 6 campos UNKNOWN';
});

await t('models.dev: fornecedor sem modelos não inventa classe nem limites', async () => {
  const out = fromModelsDev(MD, { at: '2026-10-22T10:00:00Z' });
  const vazio = out.entries.find((e) => e.key === 'providers/semdados');
  ok(vazio.access.class === 'UNKNOWN_ACCESS', 'classe: ' + vazio.access.class);
  ok(vazio.contextLength === null && vazio.pricing === null, 'inventou limites/preço');
  ok(vazio.accessDetails.limites.status === 'UNKNOWN', 'limites: ' + JSON.stringify(vazio.accessDetails.limites));
  return 'sem modelos → UNKNOWN_ACCESS · sem limites · sem preço';
});

const GH = { total_count: 7261, items: [
  { full_name: 'anomalyco/opencode', html_url: 'https://github.com/anomalyco/opencode', owner: { login: 'anomalyco' },
    stargazers_count: 220019, forks_count: 19000, license: { spdx_id: 'MIT' }, pushed_at: '2026-10-22T05:00:00Z',
    archived: false, open_issues_count: 1200, language: 'TypeScript', description: 'agente de programação' },
  { full_name: 'velho/archived-tool', html_url: 'https://github.com/velho/archived-tool', owner: { login: 'velho' },
    stargazers_count: 900, forks_count: 30, license: { spdx_id: 'NOASSERTION' }, pushed_at: '2024-01-01T00:00:00Z',
    archived: true, open_issues_count: 5, language: 'Go', description: null }
] };

await t('GitHub: licença, estrelas, último push e «arquivado» como sinal de manutenção', async () => {
  const out = fromGitHubSearch(GH, { at: '2026-10-22T10:00:00Z' });
  ok(out.entries.length === 2 && out.archived === 1, 'arquivados: ' + out.archived);
  const ativo = out.entries[0], velho = out.entries[1];
  ok(ativo.kind === 'tool' && categoryOf(ativo) === 'D', 'categoria: ' + categoryOf(ativo));
  ok(ativo.maintenanceSignal === 'activo', ativo.maintenanceSignal);
  ok(velho.maintenanceSignal === 'arquivado', velho.maintenanceSignal);
  ok(velho.evidence.some((x) => x.a === 'repositorio-arquivado'), 'não registou o arquivo como facto');
  ok(ativo.access.class === 'UNKNOWN_ACCESS', 'repositório não é serviço: ' + ativo.access.class);
  ok(ativo.accessDetails.usoComercial.status === 'DECLARED' && /MIT/.test(ativo.accessDetails.usoComercial.value), 'licença: ' + JSON.stringify(ativo.accessDetails.usoComercial));
  ok(velho.accessDetails.usoComercial.status === 'DECLARED' && /NOASSERTION/.test(velho.accessDetails.usoComercial.value), 'NOASSERTION devia ficar declarado e ambíguo');
  ok(validateAccessDetails(ativo).ok, JSON.stringify(validateAccessDetails(ativo).errors));
  return 'activo vs arquivado distinguidos · licença declarada · classe UNKNOWN (repo ≠ serviço)';
});

/* ------------------------------------------------------ 4. fusão */

await t('descobrir NÃO apaga o que foi medido: estado, classe e evidência preservados', async () => {
  const existente = {
    key: 'providers/openrouter', name: 'OpenRouter', kind: 'endpoint', state: 'LINK_TESTED',
    access: { class: 'FREE_API_KEY', note: 'medido' },
    evidence: [{ a: 'exige-chave', status: 'MEASURED', at: '2026-10-22', method: 'GET /models sem chave', detail: 'HTTP 401' }],
    accessDetails: { conta: { status: 'MEASURED', value: 'sim (401 sem chave)', at: '2026-10-22', method: 'GET' } }
  };
  const novo = {
    key: 'providers/openrouter', name: 'OpenRouter (models.dev)', kind: 'endpoint', state: 'DISCOVERED',
    access: { class: 'FREE_TRIAL', note: 'catálogo externo' },
    evidence: [{ a: 'existe-no-catalogo', status: 'MEASURED', at: '2026-10-22', method: 'GET models.dev', detail: 'fornecedor com 300 modelos' }],
    accessDetails: { conta: { status: 'UNKNOWN' }, limites: { status: 'MEASURED', value: '128k', at: '2026-10-22', method: 'models.dev' } }
  };
  const m = mergeDiscovered(existente, novo);
  ok(m.state === 'LINK_TESTED', 'estado desceu para ' + m.state);
  ok(m.access.class === 'FREE_API_KEY', 'classe substituída por ' + m.access.class);
  ok(m.evidence.length === 2, 'evidência a mais/a menos: ' + m.evidence.length);
  ok(m.evidence.some((x) => x.a === 'exige-chave'), 'perdeu a prova de 401');
  ok(m.accessDetails.conta.status === 'MEASURED', 'campo medido substituído por UNKNOWN');
  ok(m.accessDetails.limites.status === 'MEASURED', 'campo novo não entrou');
  ok(/fusão/.test(m.mergeNote), 'sem nota de fusão');
  const virgem = mergeDiscovered(null, novo);
  ok(virgem.state === 'DISCOVERED', 'entrada nova: ' + virgem.state);
  return 'estado LINK_TESTED mantido · 2 evidências · campo medido preservado, campo novo acrescentado';
});

/* ------------------------------------------------------ 5. servidor */

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-disc-'));
const api = await createApi({ dataDir: DIR, appSecret: 'segredo-de-teste-discovery-1234', secure: false, exposeStore: true });
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
await call('POST', '/api/auth/register', { email: 'disc@ex.pt', password: 'SenhaForte-2026!', acceptTerms: true });
await call('POST', '/api/provider-os/seed', {});

await t('servidor · o mapa A–E parte da semente real (sem dados inventados)', async () => {
  const r = await call('GET', '/api/provider-os/discovery/categories');
  ok(r.status === 200, 'HTTP ' + r.status);
  ok(r.json.totals.entries === 8, 'entradas: ' + r.json.totals.entries);
  const porId = Object.fromEntries(r.json.categories.map((c) => [c.id, c.total]));
  ok(porId.C >= 1 && porId.B >= 5 && porId.D >= 1, 'distribuição: ' + JSON.stringify(porId));
  ok(Object.keys(r.json.fields).length === 9, 'campos: ' + Object.keys(r.json.fields).length);
  ok(r.json.fields.privacidade.unknown === 8, 'privacidade devia ser desconhecida em todas: ' + JSON.stringify(r.json.fields.privacidade));
  return 'A–E: ' + Object.entries(porId).map(([k, v]) => k + '=' + v).join(' ') + ' · privacidade: 0 medidas (8 desconhecidas)';
});

await t('servidor · filtro por categoria e por campo em falta no catálogo', async () => {
  const c = await call('GET', '/api/provider-os/catalog?category=D');
  ok(c.status === 200 && c.json.entries.length === 1, 'categoria D: ' + c.json.entries.length);
  ok(c.json.entries[0].discoveryCategory === 'D', 'sem categoria na resposta');
  const m = await call('GET', '/api/provider-os/catalog?missing=privacidade');
  ok(m.json.total === 8, 'filtro por campo em falta: ' + m.json.total);
  const nada = await call('GET', '/api/provider-os/catalog?missing=campoQueNaoExiste');
  ok(nada.status === 400 && /campo de acesso desconhecido/.test(nada.text), 'filtro inválido: HTTP ' + nada.status);
  return 'D → 1 ferramenta · «falta privacidade» → 8 · filtro inválido → 400 com a lista de campos';
});

await t('servidor · descoberta real no GitHub (categoria D) e nada é promovido', async () => {
  const antes = api.__test.store.catalogEntries().map((e) => e.key + ':' + e.state).join('|');
  const r = await call('POST', '/api/provider-os/discover', { adapter: 'github_coding_agents', pageSize: 20, limit: 20 });
  if (r.status === 502) skip('serviço externo: ' + (r.json && r.json.failure));
  ok(r.status === 200, 'HTTP ' + r.status + ' ' + r.text.slice(0, 160));
  if (r.json.sourcesEmpty) skip('fonte externa devolveu zero registos (índice/limite do GitHub, não o nosso código): ' + r.json.note.slice(0, 90));
  ok(r.json.created + r.json.updated >= 1, 'nada gravado: ' + JSON.stringify({ c: r.json.created, u: r.json.updated, rej: r.json.rejected }));
  ok(r.json.categories && r.json.categories.D >= 1, 'categorias: ' + JSON.stringify(r.json.categories));
  /* nenhuma entrada que já existia pode mudar de estado por causa de uma descoberta */
  const estadosAntes = new Map(antes.split('|').filter(Boolean).map((x) => [x.split(':')[0], x.split(':')[1]]));
  const mudaram = api.__test.store.catalogEntries()
    .filter((e) => estadosAntes.has(e.key) && estadosAntes.get(e.key) !== e.state)
    .map((e) => e.key + ': ' + estadosAntes.get(e.key) + ' → ' + e.state);
  ok(mudaram.length === 0, 'a descoberta mudou estados: ' + mudaram.join(', '));
  ok(r.json.updated > 0 || r.json.created > 0, 'nada foi gravado nem actualizado');
  const arquivados = api.__test.store.catalogEntries().filter((e) => e.maintenanceSignal === 'arquivado').length;
  return r.json.created + ' criadas · ' + r.json.updated + ' actualizadas · ' + r.json.total + ' no total · ' +
    arquivados + ' arquivadas detectadas · 0 promoções de estado';
});

await t('servidor · descoberta do models.dev (preços e limites) sem tocar na semente medida', async () => {
  const or = api.__test.store.catalogEntry('providers/openrouter');
  const estadoAntes = or.state, classeAntes = or.access.class, evAntes = or.evidence.length;
  const r = await call('POST', '/api/provider-os/discover', { adapter: 'models_dev', limit: 40 });
  if (r.status === 502) skip('serviço externo: ' + (r.json && r.json.failure));
  ok(r.status === 200, 'HTTP ' + r.status);
  ok(r.json.extra && r.json.extra.modelsTotal > 1000, 'sem contagem de modelos: ' + JSON.stringify(r.json.extra));
  const depois = api.__test.store.catalogEntry('providers/openrouter');
  ok(depois.state === estadoAntes, 'estado mudou: ' + estadoAntes + ' → ' + depois.state);
  ok(depois.access.class === classeAntes, 'classe mudou: ' + classeAntes + ' → ' + depois.access.class);
  ok(depois.evidence.length >= evAntes, 'perdeu evidência: ' + evAntes + ' → ' + depois.evidence.length);
  return r.json.created + ' criadas · ' + r.json.extra.modelsTotal + ' modelos contados · OpenRouter mantém ' +
    depois.state + '/' + depois.access.class + ' e ' + depois.evidence.length + ' evidências';
});

await t('servidor · sem CSRF a descoberta não corre', async () => {
  const guardado = csrf; csrf = '';
  const r = await call('POST', '/api/provider-os/discover', { adapter: 'hf_models' });
  csrf = guardado;
  ok(r.status === 403, 'HTTP ' + r.status);
  return '403 sem token CSRF';
});

srv.close();
let pass = 0, fail = 0, skipped = 0;
console.log('DESCOBERTA CONTÍNUA — CATEGORIAS A–E (FASE 6)\n');
R.forEach((r) => {
  if (!r.ok && r.skip) { skipped++; console.log('SKIP ' + r.name + ' → ' + r.detail.slice(6)); return; }
  if (r.ok) { pass++; console.log('PASS ' + r.name + (r.detail ? ' → ' + r.detail : '')); }
  else { fail++; console.log('FAIL ' + r.name + ' → ' + r.detail); }
});
console.log('\n' + pass + ' passaram · ' + fail + ' falharam · ' + skipped + ' sem execução (rede)');
process.exit(fail ? 1 : 0);
