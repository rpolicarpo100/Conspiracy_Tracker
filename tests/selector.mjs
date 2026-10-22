/* =====================================================================
   SELECTOR AUTOMÁTICO E FALLBACK (fase 4)

   Duas camadas:
     · módulo  — as regras de decisão e a política de repetição, com dados
                 controlados (nada de rede, nada de dinheiro);
     · servidor — as rotas reais: `/select`, `/decisions`, `/fallback/plan`,
                 incluindo o caso honesto de catálogo sem prova (não escolhe).
   ===================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../server/api.mjs';
import { selectProvider, planFallback, runWithFallback, classifyOutcome, SELECTION_STEPS, FALLBACK_DEFAULTS, rng } from '../server/selector.mjs';

const R = [];
const t = async (name, fn) => {
  try { const d = await fn(); R.push({ ok: true, name, detail: d }); }
  catch (e) { R.push({ ok: false, name, detail: e.message, skip: e.skip }); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'falhou'); };

/* candidatos completos: tudo medido. `gen:false` = sem nível 4. */
const C = (over) => Object.assign({
  key: 'providers/x', name: 'Fornecedor X', kind: 'model', state: 'RANKED',
  risk: 'low', tested: { link: true, generation: true }, freshnessDays: 3,
  credentials: { present: true }, capabilities: { declared: [], tested: {} },
  region: 'US', privacy: { trainsOnData: false, retentionDays: 0 }, defaultModel: 'm-1',
  metrics: { qualityScore: 80, successRate: 0.96, securityScore: 70, integrationScore: 60,
    latencyP50Ms: 1200, costPerTaskUsd: 0.01, uptime: 0.99, maintenanceScore: 60 }
}, over || {});

const A = C({ key: 'providers/a', name: 'Alfa', metrics: Object.assign(C().metrics, { qualityScore: 80 }) });
const B = C({ key: 'providers/b', name: 'Beta', metrics: Object.assign(C().metrics, { qualityScore: 88, costPerTaskUsd: 0.02 }) });

/* ------------------------------------------------------ 1. selecção */

await t('os 13 passos existem, na ordem do pedido, cada um com razão escrita', async () => {
  ok(SELECTION_STEPS.length === 13, 'passos: ' + SELECTION_STEPS.length);
  SELECTION_STEPS.forEach((s, i) => { ok(s.id === i + 1, 'ordem quebrada em ' + s.key); ok(s.why && s.why.length > 20, 'sem razão: ' + s.key); });
  const r = selectProvider({ task: 'codigo', candidates: [A, B] });
  ok(r.steps.length === 13, 'decisão executou ' + r.steps.length + ' passos');
  return SELECTION_STEPS.map((s) => s.id + '.' + s.key).join(' · ');
});

await t('escolhe a melhor nota da tarefa e diz porquê, com alternativa e razão da derrota', async () => {
  const r = selectProvider({ task: 'codigo', candidates: [A, B] });
  ok(r.chosen && r.chosen.key === 'providers/b', 'escolheu ' + (r.chosen && r.chosen.key));
  ok(r.chosen.score > 0 && r.chosen.band, 'sem nota/faixa');
  ok(r.alternatives.length === 1 && r.alternatives[0].key === 'providers/a', 'alternativa errada');
  ok(/nota/.test(r.alternatives[0].whyNot), 'sem razão da derrota: ' + r.alternatives[0].whyNot);
  ok(r.justification.join(' ').includes('fiabilidade medida'), 'justificação sem fiabilidade');
  ok(r.whatWouldChangeIt.length >= 2, 'não diz o que a faria mudar');
  return r.chosen.key + ' ' + r.chosen.score + '/' + r.chosen.band + ' · alternativa ' + r.alternatives[0].key +
    ' («' + r.alternatives[0].whyNot + '»)';
});

await t('a mesma candidata muda de nota com a tarefa (não há vencedor universal)', async () => {
  const codigo = selectProvider({ task: 'codigo', candidates: [A] }).chosen.score;
  const ferramentas = selectProvider({ task: 'ferramentas', candidates: [A] }).chosen.score;
  ok(codigo !== ferramentas, 'notas iguais: ' + codigo + ' / ' + ferramentas);
  return 'código ' + codigo + ' · ferramentas ' + ferramentas;
});

await t('restrição dura elimina em vez de penalizar (dados sensíveis e região)', async () => {
  const treina = C({ key: 'providers/t', privacy: { trainsOnData: true, retentionDays: 0 } });
  const longo = C({ key: 'providers/l', privacy: { trainsOnData: false, retentionDays: 365 } });
  const outroPais = C({ key: 'providers/f', region: 'FR' });
  const semRegiao = C({ key: 'providers/u', region: null });
  const r = selectProvider({ task: 'conversa', candidates: [treina, longo, outroPais, semRegiao],
    constraints: { dataSensitive: true, region: 'PT' } });
  const stages = r.rejected.map((x) => x.key + ':' + x.stage).sort();
  ok(stages.includes('providers/t:restricao-privacidade'), 'treino não eliminado: ' + stages.join(','));
  ok(stages.includes('providers/l:restricao-privacidade'), 'retenção longa não eliminada');
  ok(stages.includes('providers/f:restricao-regiao'), 'região errada não eliminada');
  ok(!stages.some((s) => s.startsWith('providers/u:')), 'região DESCONHECIDA foi tratada como errada');
  return stages.length + ' eliminações duras · região desconhecida não é inventada («providers/u» sobrevive)';
});

await t('modelo fixado é respeitado; se não passar os passos, há conflito declarado (não substituição silenciosa)', async () => {
  const r = selectProvider({ task: 'conversa', candidates: [A, B], constraints: { pinnedKey: 'providers/a' } });
  ok(r.chosen.key === 'providers/a' && r.pinned === true, 'ignorou a fixação: ' + r.chosen.key);
  ok(r.chosen.model === 'm-1', 'modelo: ' + r.chosen.model);
  const semGeracao = C({ key: 'providers/z', tested: { link: true, generation: false } });
  const r2 = selectProvider({ task: 'conversa', candidates: [A, semGeracao], constraints: { pinnedKey: 'providers/z' } });
  ok(r2.chosen === null && /não passou/.test(r2.noChoiceReason), JSON.stringify(r2.noChoiceReason));
  ok(/sem-geracao|gerou/.test(r2.noChoiceReason), 'sem motivo concreto: ' + r2.noChoiceReason);
  const r3 = selectProvider({ task: 'conversa', candidates: [A], constraints: { pinnedKey: 'providers/nao-existe' } });
  ok(r3.chosen === null && /não está no catálogo/.test(r3.noChoiceReason), 'fixação desconhecida não foi declarada');
  return 'fixado e válido → escolhido · fixado inválido → conflito com motivo · inexistente → recusa';
});

await t('sem prova suficiente não escolhe nada — e diz exactamente o que falta', async () => {
  const semGeracao = C({ key: 'providers/n', tested: { link: true, generation: false } });
  const r = selectProvider({ task: 'conversa', candidates: [semGeracao] });
  ok(r.chosen === null, 'escolheu sem teste de geração');
  ok(/nenhuma candidata/.test(r.noChoiceReason), r.noChoiceReason);
  ok(r.rejected[0].stage === 'exclusao' && /gerou/.test(r.rejected[0].reason), JSON.stringify(r.rejected[0]));
  const vazio = selectProvider({ task: 'conversa', candidates: [] });
  ok(vazio.chosen === null && /catálogo vazio/.test(vazio.noChoiceReason), 'catálogo vazio não declarado');
  return 'sem nível 4 → recusa com motivo · catálogo vazio → recusa com motivo';
});

await t('cobertura de evidência: uma dimensão entre oito não decide nada', async () => {
  const parcial = C({ key: 'providers/p', metrics: { successRate: 0.99 } });
  const r = selectProvider({ task: 'conversa', candidates: [parcial] });
  ok(r.chosen === null, 'escolheu com 20 % de cobertura');
  ok(/evidencia/.test(r.rejected[0].stage) && /40 %/.test(r.rejected[0].reason), JSON.stringify(r.rejected[0]));
  return 'eliminada em «evidencia»: ' + r.rejected[0].reason;
});

await t('orçamento e latência: eliminam quando medidos, avisam quando desconhecidos', async () => {
  const caro = C({ key: 'providers/caro', metrics: Object.assign(C().metrics, { costPerTaskUsd: 0.5 }) });
  const lento = C({ key: 'providers/lento', metrics: Object.assign(C().metrics, { latencyP50Ms: 9000 }) });
  const desconhecido = C({ key: 'providers/?', metrics: Object.assign(C().metrics, { costPerTaskUsd: null }) });
  const r = selectProvider({ task: 'conversa', candidates: [caro, lento, desconhecido],
    constraints: { maxCostUsd: 0.1, maxLatencyMs: 3000 } });
  const st = r.rejected.map((x) => x.key + ':' + x.stage);
  ok(st.includes('providers/caro:orcamento'), 'caro não eliminado: ' + st.join(','));
  ok(st.includes('providers/lento:latencia'), 'lento não eliminado');
  ok(!st.some((s) => s.startsWith('providers/?:')), 'custo desconhecido foi eliminado como se fosse caro');
  const passo7 = r.steps.find((s) => s.step === 7);
  ok(passo7.unknownCost && passo7.unknownCost.length === 1, 'não assinalou custo desconhecido');
  ok(/não é tratado como gratuito/.test(passo7.note), 'nota do custo: ' + passo7.note);
  return 'caro e lento eliminados · custo desconhecido fica com aviso («' + passo7.note + '»)';
});

await t('capacidades: só conta o que foi testado (declarado não é prova)', async () => {
  const declara = C({ key: 'providers/d', capabilities: { declared: ['tools'], tested: {} } });
  const testa = C({ key: 'providers/t5', capabilities: { declared: ['tools'], tested: { tools: 'PASS' } } });
  const r = selectProvider({ task: 'ferramentas', candidates: [declara, testa], constraints: { requireCapabilities: ['tools'] } });
  ok(r.chosen.key === 'providers/t5', 'escolheu ' + r.chosen.key);
  ok(r.rejected[0].key === 'providers/d' && /declarado não é testado/.test(r.rejected[0].reason), JSON.stringify(r.rejected[0]));
  return 'declarado eliminado · testado escolhido';
});

await t('sem credencial não executa: elimina no passo de disponibilidade', async () => {
  const semChave = C({ key: 'providers/sk', credentials: { present: false } });
  const r = selectProvider({ task: 'conversa', candidates: [semChave, A] });
  ok(r.chosen.key === 'providers/a', 'escolheu ' + r.chosen.key);
  ok(r.rejected.some((x) => x.key === 'providers/sk' && x.stage === 'disponibilidade'), 'não eliminou por credencial');
  return 'sem credencial → «' + r.rejected[0].reason + '»';
});

await t('desempate é determinístico: empate total resolve-se por chave, não por acaso', async () => {
  const iguais = [C({ key: 'providers/beta' }), C({ key: 'providers/alfa' })];
  const r1 = selectProvider({ task: 'conversa', candidates: iguais });
  const r2 = selectProvider({ task: 'conversa', candidates: iguais.slice().reverse() });
  ok(r1.chosen.key === r2.chosen.key, 'ordem do array mudou a escolha: ' + r1.chosen.key + ' vs ' + r2.chosen.key);
  ok(r1.chosen.key === 'providers/alfa', 'critério não é a chave: ' + r1.chosen.key);
  ok(/empate técnico/.test(r1.alternatives[0].whyNot), 'sem explicação do empate: ' + r1.alternatives[0].whyNot);
  return 'empate → ' + r1.chosen.key + ' nas duas ordens';
});

await t('a decisão traz prazo de reavaliação calculado a partir da idade da evidência', async () => {
  const r = selectProvider({ task: 'conversa', candidates: [C({ key: 'providers/velho', freshnessDays: 60 })] });
  ok(r.validade && r.validade.days === 30, 'validade: ' + JSON.stringify(r.validade));
  ok(/^\d{4}-\d{2}-\d{2}$/.test(r.validade.recheckAt), 'data: ' + r.validade.recheckAt);
  ok(r.whatWouldChangeIt.some((x) => x.includes(r.validade.recheckAt)), 'prazo não aparece no que a faria mudar');
  return r.validade.days + ' dias → reavaliar em ' + r.validade.recheckAt;
});

/* ------------------------------------------------------ 2. fallback */

await t('plano de fallback: determinístico com semente, sem repetir antes da primeira tentativa', async () => {
  const p1 = planFallback({ order: ['a', 'b'], seed: 42, baseMs: 500, maxAttemptsPerProvider: 3 });
  const p2 = planFallback({ order: ['a', 'b'], seed: 42, baseMs: 500, maxAttemptsPerProvider: 3 });
  ok(JSON.stringify(p1.plan) === JSON.stringify(p2.plan), 'a mesma semente deu planos diferentes');
  const primeiras = p1.plan.filter((x) => x.attempt === 1);
  ok(primeiras.every((x) => x.delayMs === 0), 'esperou antes da primeira tentativa: ' + JSON.stringify(primeiras));
  const repeticoes = p1.plan.filter((x) => x.attempt > 1);
  ok(repeticoes.every((x) => x.delayMs <= x.maxDelayMs), 'jitter saiu do intervalo');
  ok(new Set(repeticoes.map((x) => x.delayMs)).size > 1, 'sem jitter: todas as esperas iguais');
  const p3 = planFallback({ order: ['a'], seed: 7, baseMs: 500, maxAttemptsPerProvider: 3, jitter: 'none' });
  const esperas = p3.plan.filter((x) => x.attempt > 1).map((x) => x.delayMs);
  ok(esperas[0] === 500 && esperas[1] === 1000, 'backoff não duplica: ' + esperas.join(','));
  return 'semente 42 → ' + p1.plan.map((x) => x.providerKey + '#' + x.attempt + ':' + x.delayMs + 'ms').join(' ') +
    ' · sem jitter: ' + esperas.join(' → ') + ' ms';
});

await t('limite superior do plano: nunca mais do que maxTotalAttempts pedidos', async () => {
  const p = planFallback({ order: ['a', 'b', 'c', 'd'], maxAttemptsPerProvider: 3, maxTotalAttempts: 5 });
  ok(p.plan.length === 5, 'plano com ' + p.plan.length + ' tentativas');
  const vazio = planFallback({ order: [] });
  ok(vazio.ok === false && /sem candidatos/.test(vazio.reason), 'sem candidatos não declarado');
  return '4 fornecedores × 3 tentativas cortados em ' + p.plan.length + ' (tecto da política)';
});

await t('429 é transitório e repete; 401 é permanente e salta para o seguinte', async () => {
  const calls429 = [];
  const r1 = await runWithFallback({ order: ['a', 'b'], baseMs: 10, sleep: async () => {},
    call: async (k, att) => { calls429.push(k + '#' + att); if (k === 'a') { const e = new Error('muitos pedidos'); e.status = 429; throw e; } return { ok: true, costUsd: 0.001 }; } });
  ok(r1.status === 'PASS' && r1.chosenKey === 'b', 'resultado: ' + r1.status);
  ok(calls429.includes('a#2'), 'não repetiu o 429: ' + calls429.join(','));
  const calls401 = [];
  const r2 = await runWithFallback({ order: ['a', 'b'], baseMs: 10, sleep: async () => {},
    call: async (k, att) => { calls401.push(k + '#' + att); if (k === 'a') { const e = new Error('chave inválida'); e.status = 401; throw e; } return { ok: true }; } });
  ok(!calls401.includes('a#2'), 'insistiu com credencial recusada: ' + calls401.join(','));
  ok(r2.status === 'PASS' && r2.chosenKey === 'b', 'não passou ao seguinte');
  return '429 → ' + calls429.join(' ') + ' · 401 → ' + calls401.join(' ') + ' (não insiste)';
});

await t('efeito externo possível trava tudo: não se repete um pagamento', async () => {
  const c = classifyOutcome({ message: 'timeout depois de enviar', externallyApplied: true });
  ok(c.class === 'indeterminado' && c.mustNotRepeat === true && c.retryable === false, JSON.stringify(c));
  const calls = [];
  const r = await runWithFallback({ order: ['a', 'b'], baseMs: 5, sleep: async () => {},
    call: async (k) => { calls.push(k); const e = new Error('timeout'); e.externallyApplied = true; throw e; } });
  ok(r.status === 'INDETERMINADO' && calls.length === 1, 'repetiu: ' + calls.join(','));
  ok(r.mustCheckBeforeRetry === true, 'não exigiu confirmação');
  return '1 tentativa e paragem: «' + r.reason + '»';
});

await t('orçamento do fallback pára a execução no momento em que é excedido', async () => {
  const r = await runWithFallback({ order: ['a', 'b'], baseMs: 5, sleep: async () => {}, budgetUsd: 0.01,
    call: async () => ({ ok: true, costUsd: 0.02 }) });
  ok(r.status === 'ORCAMENTO', 'status ' + r.status);
  ok(/0.01/.test(r.reason), 'motivo sem valor: ' + r.reason);
  const r2 = await runWithFallback({ order: [], call: async () => ({ ok: true }) });
  ok(r2.status === 'SEM-CANDIDATOS', 'sem candidatos: ' + r2.status);
  return 'gastou ' + r.spentUsd + ' USD e parou (limite 0.01)';
});

await t('o PRNG do jitter é reprodutível e distribui (não devolve sempre o mesmo)', async () => {
  const a = rng(1), b = rng(1), c = rng(2);
  const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
  ok(JSON.stringify(seqA) === JSON.stringify(seqB), 'mesma semente, sequências diferentes');
  ok(JSON.stringify(seqA) !== JSON.stringify([c(), c(), c()]), 'sementes diferentes, mesma sequência');
  ok(seqA.every((x) => x >= 0 && x < 1), 'valores fora de [0,1)');
  return seqA.map((x) => x.toFixed(3)).join(' · ') + ' (semente 1)';
});

/* ------------------------------------------------------ 3. servidor */

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-selector-'));
const api = await createApi({ dataDir: DIR, appSecret: 'segredo-de-teste-selector-123456', secure: false, exposeStore: true });
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
await call('POST', '/api/auth/register', { email: 'sel@ex.pt', password: 'SenhaForte-2026!', acceptTerms: true });

await t('servidor · sem catálogo, o selector recusa escolher em vez de inventar', async () => {
  const r = await call('POST', '/api/provider-os/select', { task: 'conversa' });
  ok(r.status === 409, 'HTTP ' + r.status);
  ok(/catálogo vazio/.test(r.text), r.text.slice(0, 140));
  return 'HTTP 409 com motivo («carregue a semente e teste pelo menos um fornecedor»)';
});

await call('POST', '/api/provider-os/seed', {});

await t('servidor · com semente mas sem teste de geração, também não escolhe (e fica registado)', async () => {
  const r = await call('POST', '/api/provider-os/select', { task: 'conversa' });
  ok(r.status === 200, 'HTTP ' + r.status);
  ok(r.json.chosen === null, 'escolheu sem geração: ' + JSON.stringify(r.json.chosen));
  ok(r.json.rejected.length === 8, 'eliminadas: ' + r.json.rejected.length);
  ok(r.json.decisionId && /^sel_|^sel-/.test(r.json.decisionId), 'sem id de decisão: ' + r.json.decisionId);
  const hist = await call('GET', '/api/provider-os/decisions');
  ok(hist.json.total >= 1 && hist.json.decisions[0].chosenKey === null, 'histórico não guardou a recusa');
  return '8 candidatas eliminadas com motivo · decisão ' + r.json.decisionId + ' guardada';
});

await t('servidor · candidatos explícitos: escolhe, grava alternativa e audita', async () => {
  const r = await call('POST', '/api/provider-os/select', {
    task: 'codigo', candidates: [A, B], constraints: { maxCostUsd: 0.05 }
  });
  ok(r.status === 200 && r.json.chosen && r.json.chosen.key === 'providers/b', JSON.stringify(r.json.chosen));
  ok(r.json.alternatives.length === 1 && r.json.alternatives[0].key === 'providers/a', 'sem alternativa');
  const hist = await call('GET', '/api/provider-os/decisions');
  const d = hist.json.decisions[0];
  ok(d.chosenKey === 'providers/b' && d.alternatives.length === 1 && d.why.length >= 3, 'histórico incompleto: ' + JSON.stringify(d).slice(0, 200));
  const audits = api.__test.store.auditOf ? api.__test.store.auditOf() : null;
  ok(!audits || audits.some((x) => x.type === 'provider_selected'), 'sem auditoria');
  return d.chosenKey + ' ' + d.score + '/' + d.confidence + ' · confiança e alternativas no histórico';
});

await t('servidor · plano de fallback é calculado sem fazer pedidos nem gastar', async () => {
  const r = await call('POST', '/api/provider-os/fallback/plan', { order: ['providers/a', 'providers/b'], seed: 9, baseMs: 300, maxAttemptsPerProvider: 2 });
  ok(r.status === 200 && r.json.plan.length === 4, JSON.stringify(r.json).slice(0, 200));
  ok(r.json.simulated === true, 'não marcou como simulado');
  ok(r.json.spentUsd === undefined && /nenhum pedido/.test(r.json.note), 'plano não declara custo zero: ' + r.json.note);
  return r.json.plan.map((x) => x.providerKey.split('/')[1] + '#' + x.attempt + ':' + x.delayMs + 'ms').join(' ') + ' · 0 pedidos';
});

await t('servidor · plano sem ordem explícita usa a decisão do selector (e não falha com catálogo sem prova)', async () => {
  const r = await call('POST', '/api/provider-os/fallback/plan', { task: 'conversa', seed: 3 });
  ok(r.status === 200, 'HTTP ' + r.status);
  ok(r.json.ok === false && Array.isArray(r.json.plan) && r.json.plan.length === 0, 'plano inesperado: ' + JSON.stringify(r.json).slice(0, 160));
  return 'sem escolha possível → plano vazio com motivo, em vez de uma ordem inventada';
});

await t('servidor · meta do selector expõe os 13 passos e a política por omissão', async () => {
  const r = await call('GET', '/api/provider-os/selector/meta');
  ok(r.status === 200 && r.json.steps.length === 13, 'passos: ' + (r.json && r.json.steps && r.json.steps.length));
  ok(r.json.defaults.maxTotalAttempts === 8 && r.json.defaults.jitter === 'full', 'política: ' + JSON.stringify(r.json.defaults));
  return '13 passos · tentativas totais ' + r.json.defaults.maxTotalAttempts + ' · jitter ' + r.json.defaults.jitter;
});

srv.close();
let pass = 0, fail = 0, skipped = 0;
console.log('SELECTOR AUTOMÁTICO E FALLBACK — FASE 4\n');
R.forEach((r) => {
  if (!r.ok && r.skip) { skipped++; console.log('SKIP ' + r.name + ' → ' + r.detail); return; }
  if (r.ok) { pass++; console.log('PASS ' + r.name + (r.detail ? ' → ' + r.detail : '')); }
  else { fail++; console.log('FAIL ' + r.name + ' → ' + r.detail); }
});
console.log('\n' + pass + ' passaram · ' + fail + ' falharam · ' + skipped + ' sem execução');
process.exit(fail ? 1 : 0);
