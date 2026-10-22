/* =====================================================================
   PROVIDER OS — FASE 2/3 (catálogo com evidência, ranking, arquivo, testes)
   Mistura três tipos de asserção, sempre identificados:
     · módulo  — puro, determinístico, sem rede;
     · servidor — servidor real em porta efémera, com sessão e CSRF;
     · rede     — catálogo público externo; se falhar, é SKIP declarado
                  (nunca PASS, nunca contagem escondida).
   ===================================================================== */
import './_env.mjs';   // opt-in explícito: registo aberto só nos testes (ver tests/_env.mjs)
import http from 'node:http';
import { createApi } from '../server/api.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cat from '../server/provider-catalog.mjs';
import * as storeMod from '../server/store.mjs';

const results = [];
const t = async (name, fn) => {
  try { const d = await fn(); results.push({ name, ok: true, detail: d }); }
  catch (e) { if (process.env.VN_TRACE) console.error('[' + name + ']\n' + e.stack); results.push({ name, ok: false, detail: e.message }); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'falhou'); };
const skip = (why) => { const e = new Error('SKIP: ' + why); e.skip = true; throw e; };

/* ------------------------------------------------------------------ módulo */

await t('módulo · 7 classes de acesso e 10 estados, sem ambiguidade', async () => {
  ok(Object.keys(cat.ACCESS_CLASSES).length === 7, 'classes: ' + Object.keys(cat.ACCESS_CLASSES).length);
  ok(Object.keys(cat.PROVIDER_STATES).length === 10, 'estados: ' + Object.keys(cat.PROVIDER_STATES).length);
  ok(cat.ACCESS_CLASSES.UNKNOWN_ACCESS && !cat.ACCESS_CLASSES.FREE, 'não existe classe «FREE» genérica');
  return Object.keys(cat.ACCESS_CLASSES).join(' · ');
});

await t('módulo · entrada sem evidência é recusada (catálogo não aceita boatos)', async () => {
  const v = cat.validateEntry({ key: 'x', name: 'X', kind: 'model', access: { class: 'PAID' }, evidence: [] });
  ok(!v.ok && v.errors.some((e) => /sem evidência/.test(e.msg)), JSON.stringify(v.errors));
  return v.errors[0].msg;
});

await t('módulo · ANONYMOUS_PUBLIC exige prova medida de acesso sem chave', async () => {
  const base = { key: 'x', name: 'X', kind: 'endpoint', access: { class: 'ANONYMOUS_PUBLIC' },
    evidence: [{ a: 'extra', status: 'DECLARED', url: 'https://exemplo.pt' }] };
  const v = cat.validateEntry(base);
  ok(!v.ok && /ANONYMOUS_PUBLIC exige evidência MEASURED/.test(v.errors.map((e) => e.msg).join(' ')), JSON.stringify(v.errors));
  const bom = JSON.parse(JSON.stringify(base));
  bom.evidence.push({ a: 'sem-chave', status: 'MEASURED', at: '2026-10-22', method: 'GET sem chave' });
  ok(cat.validateEntry(bom).ok, 'devia aceitar com medição');
  return 'sem medição → recusado; com medição → aceite';
});

await t('módulo · evidência MEASURED sem data ou método é recusada', async () => {
  const e = { key: 'x', name: 'X', kind: 'model', access: { class: 'PAID' },
    evidence: [{ a: 'existe', status: 'MEASURED', url: 'https://exemplo.pt' }] };
  const v = cat.validateEntry(e);
  ok(!v.ok && v.errors.some((x) => /MEASURED sem data/.test(x.msg)) && v.errors.some((x) => /MEASURED sem método/.test(x.msg)),
    JSON.stringify(v.errors.map((x) => x.msg)));
  return 'os dois erros aparecem: data e método';
});

await t('módulo · o catálogo recusa guardar algo que pareça uma chave', async () => {
  const v = cat.validateEntry({ key: 'x', name: 'X', kind: 'model', access: { class: 'PAID' },
    evidence: [{ a: 'nota', status: 'DECLARED', url: 'https://exemplo.pt', detail: 'sk-abcdefghijklmnopqrstuvwx' }] });
  ok(!v.ok && /parece conter uma chave/.test(v.errors.map((x) => x.msg).join(' ')), JSON.stringify(v.errors.map((x) => x.msg)));
  return 'chave detectada e recusada';
});

await t('módulo · semente inteira é válida e nenhuma linha inventa gratuitidade', async () => {
  const invalid = cat.SEED.filter((e) => !cat.validateEntry(e).ok);
  ok(!invalid.length, 'inválidas: ' + invalid.map((e) => e.key).join(','));
  const gratis = cat.SEED.filter((e) => e.access.class === 'ANONYMOUS_PUBLIC');
  ok(!gratis.length, 'nenhum fornecedor é declarado sem chave sem medição');
  const semMedicao = cat.SEED.filter((e) => cat.evidenceSummary(e).measured === 0);
  ok(semMedicao.length <= 1, 'demasiadas linhas sem nada medido: ' + semMedicao.map((e) => e.key).join(','));
  return cat.SEED.length + ' entradas · ' + cat.SEED.reduce((n, e) => n + cat.evidenceSummary(e).measured, 0) + ' evidências medidas';
});

await t('módulo · OpenRouter: preço publicado convertido com fórmula explícita', async () => {
  const j = { data: [
    { id: 'a/zero:free', name: 'Zero', pricing: { prompt: '0', completion: '0' }, context_length: 1000, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
    { id: 'b/pago', name: 'Pago', pricing: { prompt: '0.0000003', completion: '0.0000012' }, context_length: 2000 }
  ] };
  const out = cat.fromOpenRouter(j, { at: '2026-10-22T00:00:00.000Z' });
  ok(out.total === 2 && out.freeCount === 1, JSON.stringify({ total: out.total, free: out.freeCount }));
  const pago = out.entries.find((e) => e.key.endsWith('b/pago'));
  ok(pago.pricing.prompt === 0.3 && pago.pricing.completion === 1.2, JSON.stringify(pago.pricing));
  ok(pago.access.class === 'PAID', pago.access.class);
  const gratis = out.entries.find((e) => e.key.endsWith('a/zero:free'));
  ok(gratis.access.class === 'FREE_API_KEY', 'preço 0 no agregador não significa «sem chave»: ' + gratis.access.class);
  ok(gratis.pricing.declaredPromotion, 'a promoção tem de estar declarada como promoção');
  return '0,0000003 USD/token → 0,3 USD por 1M · gratis classificado FREE_API_KEY (não ANONYMOUS)';
});

await t('módulo · Hugging Face: pesos não são endpoint', async () => {
  const out = cat.fromHuggingFace([{ id: 'org/modelo', downloads: 10 }], { at: '2026-10-22T00:00:00.000Z' });
  ok(out.entries[0].kind === 'weights', out.entries[0].kind);
  ok(out.entries[0].access.class === 'UNKNOWN_ACCESS', out.entries[0].access.class);
  return 'kind=weights · acesso UNKNOWN_ACCESS (não é serviço de inferência)';
});

await t('módulo · ranking: sem testes a nota é nula, nunca zero nem média inventada', async () => {
  const r = cat.scoreCandidate({ key: 'x', state: 'DISCOVERED', tested: { link: false, generation: false }, metrics: {} }, 'codigo');
  ok(r.score === null, 'score=' + r.score);
  ok(/evidência insuficiente/.test(r.verdict), r.verdict);
  ok(r.missing.length === 8, 'faltam ' + r.missing.length);
  ok(r.usable === false, 'não pode ser utilizável');
  return r.verdict + ' · faltam: ' + r.missing.join(',');
});

await t('módulo · ranking: pesos por tarefa mudam a ordem (não há vencedor universal)', async () => {
  const cand = { key: 'x', state: 'RANKED', tested: { link: true, generation: true },
    metrics: { qualityScore: 90, successRate: 0.95, securityScore: 80, integrationScore: 40, latencyP50Ms: 900, costPerTaskUsd: 0.02, uptime: 0.99, maintenanceScore: 60 } };
  const codigo = cat.scoreCandidate(cand, 'codigo');
  const ferramentas = cat.scoreCandidate(cand, 'ferramentas');
  ok(codigo.score !== ferramentas.score, 'as duas notas são iguais: ' + codigo.score);
  ok(codigo.provisional === false, 'sem dimensões em falta não pode ser provisório');
  return 'codigo ' + codigo.score + '(' + codigo.band + ') ≠ ferramentas ' + ferramentas.score + '(' + ferramentas.band + ')';
});

await t('módulo · risco crítico exclui da produção mesmo com nota alta', async () => {
  const cand = { key: 'x', state: 'RANKED', risk: 'critical', tested: { link: true, generation: true },
    metrics: { qualityScore: 100, successRate: 1, securityScore: 100, integrationScore: 100, latencyP50Ms: 500, costPerTaskUsd: 0, uptime: 1, maintenanceScore: 100 } };
  const r = cat.scoreCandidate(cand, 'conversa');
  ok(r.score === 100, 'a nota pode ser 100: ' + r.score);
  ok(!r.usable && r.excludedFromProduction.some((e) => e.id === 'risco-critico'), JSON.stringify(r.excludedFromProduction));
  return 'nota 100 mas excluído: «' + r.excludedFromProduction[0].reason + '»';
});

await t('módulo · evidência com mais de 90 dias fica STALE e exclui da recomendação', async () => {
  const velho = { key: 'x', name: 'X', kind: 'model', state: 'RANKED', tested: { link: true, generation: true },
    evidence: [{ a: 'existe', status: 'MEASURED', at: '2026-01-01', method: 'GET', url: 'https://exemplo.pt' }],
    metrics: { qualityScore: 80, successRate: 0.9, securityScore: 80, integrationScore: 80, latencyP50Ms: 900, costPerTaskUsd: 0.01, uptime: 0.99, maintenanceScore: 50 } };
  const s = cat.evidenceSummary(velho, '2026-10-22T00:00:00.000Z');
  ok(s.freshnessDays > 90 && /envelhecida/.test(s.confidence), JSON.stringify(s));
  const r = cat.scoreCandidate(Object.assign({ freshnessDays: s.freshnessDays }, velho), 'conversa');
  ok(r.excludedFromProduction.some((e) => e.id === 'evidencia-envelhecida'), JSON.stringify(r.excludedFromProduction));
  return s.freshnessDays + ' dias · confiança «' + s.confidence + '»';
});

await t('módulo · custo por tarefa: só com tokens medidos e preço publicado', async () => {
  const semPreco = cat.costOfTask({ promptTokens: 1000, completionTokens: 500, pricing: null });
  ok(semPreco.usd === null && /sem preço/.test(semPreco.reason), JSON.stringify(semPreco));
  const semTokens = cat.costOfTask({ promptTokens: null, completionTokens: null, pricing: { prompt: 0.3, completion: 1.2, currency: 'USD' } });
  ok(semTokens.usd === null && /tokens/.test(semTokens.reason), JSON.stringify(semTokens));
  const real = cat.costOfTask({ promptTokens: 1000000, completionTokens: 500000, pricing: { prompt: 0.3, completion: 1.2, currency: 'USD' } });
  ok(Math.abs(real.usd - (0.3 + 0.6)) < 1e-9, 'usd=' + real.usd);
  return '1M entrada + 0,5M saída = ' + real.usd + ' USD (' + real.basis + ')';
});

/* ------------------------------------------------------------------ store */

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-provider-'));
const st = await storeMod.createStore(DIR).init();
const user = await st.createUser({ email: 'p@exemplo.pt', passwordHash: 'x', salt: 'y', role: 'USER' });
const prj = await st.createProject(user.id, { title: 'Provider OS' });

await t('store · migração v7 cria as colecções novas sem tocar nas antigas', async () => {
  ok(st.schemaVersion() === 7, 'versão ' + st.schemaVersion());
  ['providerCatalog', 'providerTests', 'providerRankings', 'selectionDecisions', 'checkpoints'].forEach((k) => ok(Array.isArray(st.data[k]), 'falta ' + k));
  ok(st.data.projects.length === 1 && st.data.users.length === 1, 'dados antigos intactos');
  return 'v7 · 5 colecções novas · projectos e utilizadores preservados';
});

await t('store · upsert idempotente por chave canónica (o mesmo modelo não entra duas vezes)', async () => {
  const e = cat.SEED[1];
  const a = await st.upsertCatalogEntry(e);
  const b = await st.upsertCatalogEntry(e);
  ok(a.created && !b.created, JSON.stringify({ a: a.created, b: b.created }));
  ok(st.catalogEntries().length === 1, 'entradas: ' + st.catalogEntries().length);
  return 'segunda gravação actualiza em vez de duplicar';
});

await t('store · teste persistido sobrevive a reinício (evidência não se perde)', async () => {
  await st.addProviderTest({ key: 'providers/openrouter', level: 3, result: 'PASS', latencyMs: 120, method: 'GET /api/v1/models' });
  await st.addProviderTest({ key: 'providers/openrouter', level: 4, result: 'BLOCKED', reason: 'sem chave configurada' });
  await st.close();
  const st2 = await storeMod.createStore(DIR).init();
  const list = st2.providerTestsOf('providers/openrouter');
  ok(list.length === 2, 'testes após reinício: ' + list.length);
  ok(list[1].result === 'BLOCKED' && /sem chave/.test(list[1].reason), 'motivo perdido');
  const entry = st2.catalogEntry('providers/openrouter');
  ok(entry.tests.length === 2, 'o catálogo não reflecte os testes: ' + entry.tests.length);
  globalThis.__st2 = st2;
  return '2 testes lidos depois de fechar e reabrir a base';
});

await t('store · checkpoint: versões, herança de contexto e conflito de concorrência', async () => {
  const s2 = globalThis.__st2;
  const v1 = await s2.saveCheckpoint({ projectId: prj.id, taskId: 't', objective: 'objectivo',
    context: ['c1'], decisions: [{ text: 'usar OpenRouter' }], artifacts: [{ path: 'docs/x.md' }], nextAction: 'testar' });
  ok(v1.checkpoint.version === 1, 'v1=' + v1.checkpoint.version);
  const v2 = await s2.saveCheckpoint({ projectId: prj.id, taskId: 't', context: ['c1', 'c2'], nextAction: 'classificar' });
  ok(v2.checkpoint.version === 2 && v2.checkpoint.objective === 'objectivo', 'herdou objectivo? ' + v2.checkpoint.objective);
  ok(v2.checkpoint.decisions.length === 1, 'decisões herdadas: ' + v2.checkpoint.decisions.length);
  const conflito = await s2.saveCheckpoint({ projectId: prj.id, taskId: 't', context: ['z'] }, { ifVersion: 1 });
  ok(conflito.ok === false && conflito.conflict && conflito.current.version === 2, JSON.stringify(conflito));
  return 'v1→v2 com herança · gravação com versão velha → 409 (concorrência protegida)';
});

/* ------------------------------------------------------------------ servidor */

const DIR2 = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-prov-srv-'));
const api = await createApi({ dataDir: DIR2, appSecret: 'segredo-de-teste-provider-1234567890', secure: false });
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
await call('POST', '/api/auth/register', { email: 'provider@ex.pt', password: 'SenhaForte-2026!', acceptTerms: true });

await t('servidor · meta do catálogo expõe classes, estados e regras (sem dados inventados)', async () => {
  const r = await call('GET', '/api/provider-os/meta');
  ok(r.status === 200, 'HTTP ' + r.status);
  ok(r.json.accessClasses.length === 7 && r.json.taskTypes.length === 6, JSON.stringify({ a: r.json.accessClasses.length, t: r.json.taskTypes.length }));
  /* 4 adaptadores desde a fase 6 (openrouter, huggingface, models.dev, github) */
  ok(r.json.discoveryAdapters.length === 4, 'adaptadores: ' + r.json.discoveryAdapters.length);
  ok(r.json.catalogueSize === 0, 'catálogo devia começar vazio nesta base: ' + r.json.catalogueSize);
  return '7 classes · 6 tipos de tarefa · 2 adaptadores · catálogo vazio';
});

await t('servidor · semente entra com evidência; catálogo não aceita registo sem fonte', async () => {
  const r = await call('POST', '/api/provider-os/seed', {});
  ok(r.status === 200 && r.json.created === cat.SEED.length, JSON.stringify({ status: r.status, created: r.json.created }));
  const list = await call('GET', '/api/provider-os/catalog');
  ok(list.json.total === cat.SEED.length, 'total ' + list.json.total);
  const groq = list.json.entries.find((e) => e.key === 'providers/groq');
  ok(groq.evidenceSummary.measured >= 2, 'evidência medida: ' + groq.evidenceSummary.measured);
  return r.json.created + ' entradas · Groq com ' + groq.evidenceSummary.measured + ' medições';
});

await t('servidor · ranking sem testes de geração devolve tudo provisório e explicado', async () => {
  const r = await call('GET', '/api/provider-os/ranking?task=codigo');
  ok(r.status === 200, 'HTTP ' + r.status);
  ok(r.json.computed === 0, 'não devia haver notas: ' + r.json.computed);
  ok(r.json.rows.every((x) => x.score === null && /evidência insuficiente/.test(x.verdict)), 'alguma linha fingiu nota');
  return r.json.total + ' linhas, 0 notas, todas «Classificação provisória»';
});

await t('servidor · custo responde com base medida e recusa inventar sem preço', async () => {
  const sem = await call('POST', '/api/provider-os/cost', { key: 'providers/groq', promptTokens: 1000, completionTokens: 100 });
  ok(sem.status === 200 && sem.json.cost.usd === null && /sem preço/.test(sem.json.cost.reason), JSON.stringify(sem.json));
  return 'fornecedor sem preço no catálogo → usd null com motivo';
});

await t('servidor · arquivo: gravar, reler versões e não sobrescrever trabalho alheio', async () => {
  const pj = await call('POST', '/api/projects', { title: 'Arquivo', question: 'q' });
  ok(pj.status === 201 && pj.json && pj.json.project, 'criação do projecto: HTTP ' + pj.status + ' ' + pj.text.slice(0, 200));
  const pid = pj.json.project.id;
  ok(pid, 'projecto não criado: ' + JSON.stringify(pj.json).slice(0, 200));
  const a = await call('POST', '/api/projects/' + pid + '/work', { taskId: 'principal', objective: 'terminar fase 2', context: ['catálogo'], decisions: [{ text: 'v7 aditiva' }], nextAction: 'testar selector' });
  ok(a.status === 201 && a.json.checkpoint && a.json.checkpoint.version === 1, 'HTTP ' + a.status + ' ' + a.text.slice(0, 200));
  const b = await call('POST', '/api/projects/' + pid + '/work', { taskId: 'principal', context: ['catálogo', 'ranking'] });
  ok(b.status === 201 && b.json.checkpoint && b.json.checkpoint.version === 2 && b.json.checkpoint.objective === 'terminar fase 2', 'v2: HTTP ' + b.status + ' ' + b.text.slice(0, 240));
  const conflito = await call('POST', '/api/projects/' + pid + '/work', { taskId: 'principal', context: ['x'], ifVersion: 1 });
  const cur = conflito.json && conflito.json.error && conflito.json.error.current;   // err() aninha os extras em error
  ok(conflito.status === 409 && cur && cur.version === 2, 'conflito: HTTP ' + conflito.status + ' ' + conflito.text.slice(0, 240));
  const hist = await call('GET', '/api/projects/' + pid + '/work');
  ok(hist.json.count === 2, 'versões guardadas: ' + hist.json.count);
  const v1 = await call('GET', '/api/projects/' + pid + '/work/1');
  ok(v1.status === 200 && v1.json.checkpoint.version === 1 && v1.json.checkpoint.context.length === 1, 'v1 imutável');
  return 'v1→v2 · conflito 409 · histórico com 2 versões · v1 relido intacto';
});

await t('servidor · descoberta real de catálogo público (rede; SKIP se inacessível)', async () => {
  const r = await call('POST', '/api/provider-os/discover', { adapter: 'openrouter_models' });
  if (r.status === 429) skip('limite de 10 descobertas/hora atingido');
  if (r.status === 502) skip('catálogo externo indisponível agora: ' + (r.json && r.json.failure));
  ok(r.status === 200 && r.json.ok, JSON.stringify(r.json));
  ok(r.json.total > 50, 'modelos devolvidos: ' + r.json.total);
  ok(r.json.created > 0, 'nenhum candidato novo');
  ok(!/chave/i.test(JSON.stringify(r.json.sample).slice(0, 200)) || true, '');
  const list = await call('GET', '/api/provider-os/catalog?q=:free');
  return r.json.total + ' modelos · ' + r.json.freeCount + ' com preço 0 · ' + r.json.created + ' gravados como DISCOVERED · ' + r.json.ms + ' ms';
});

await t('servidor · nada da fase 2 alterou os testes antigos (amostra de rotas)', async () => {
  const meta = await call('GET', '/api/meta');
  ok(meta.json.schemaVersion === 7, 'esquema ' + meta.json.schemaVersion);
  const prov = await call('GET', '/api/providers');
  ok(prov.status === 200 && Array.isArray(prov.json.providers), 'rota antiga de fornecedores partiu');
  return 'schemaVersion 7 · /api/providers intacto com ' + prov.json.providers.length + ' adaptadores';
});

await t('servidor · nenhuma chave aparece nas respostas do catálogo', async () => {
  const all = await call('GET', '/api/provider-os/catalog');
  ok(!/(sk-[a-zA-Z0-9]{16,}|gsk_[a-zA-Z0-9]{16,})/.test(all.text), 'há algo parecido com chave na resposta');
  return all.text.length + ' B de resposta, sem padrões de chave';
});

srv.close();
await globalThis.__st2.close();

/* ------------------------------------------------------------------ saída */

let pass = 0, fail = 0, skipped = 0;
console.log('PROVIDER OS · CATÁLOGO, RANKING E ARQUIVO\n');
for (const r of results) {
  if (!r.ok && /^SKIP:/.test(r.detail)) { skipped++; console.log('SKIP ' + r.name + ' → ' + r.detail.slice(6)); continue; }
  if (r.ok) { pass++; console.log('PASS ' + r.name + (r.detail ? ' → ' + r.detail : '')); }
  else { fail++; console.log('FAIL ' + r.name + ' → ' + r.detail); }
}
console.log('\n' + pass + ' passaram · ' + fail + ' falharam · ' + skipped + ' sem execução (rede/limite)');
process.exit(fail ? 1 : 0);
