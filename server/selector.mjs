/* =====================================================================
   SELECTOR AUTOMÁTICO DE IA — fase 4

   Duas responsabilidades, separadas de propósito:

   1. `selectProvider` — decide QUEM, em 13 passos explícitos, e escreve a
      justificação, a alternativa e o que faria mudar a decisão. Não escolhe
      nada quando a evidência não chega: devolve o motivo e a lista do que falta.

   2. `planFallback` / `runWithFallback` — o que fazer quando o escolhido falha:
      distinguir falha transitória de permanente, esperar com backoff + jitter
      (determinístico quando se passa `seed`, para poder ser testado), e NUNCA
      repetir um efeito externo que pode já ter sido aplicado.

   Nada aqui fala com a rede: quem chama injecta `call`/`sleep`. É o que permite
   testar as regras de dinheiro e de repetição sem gastar um cêntimo.
   ===================================================================== */

import { TASK_TYPES, EXCLUSION_RULES, scoreCandidate } from './provider-catalog.mjs';
import { classifyFailure } from './provider-tests.mjs';

/* ---------- 13 passos (a ordem é a do pedido e não é decorativa) ---------- */
export const SELECTION_STEPS = [
  { id: 1, key: 'tarefa', name: 'classificar a tarefa e os pesos',
    why: 'a mesma candidata vale notas diferentes consoante a tarefa; sem tarefa não há ranking' },
  { id: 2, key: 'restricoes', name: 'aplicar restrições duras (privacidade, região, execução local)',
    why: 'uma restrição dura elimina, não penaliza: não se compensa com qualidade' },
  { id: 3, key: 'fixacao', name: 'honrar o modelo fixado por quem pediu',
    why: 'quem fixou um modelo tem uma razão (contrato, reprodução); trocá-lo em silêncio é desonesto' },
  { id: 4, key: 'exclusoes', name: 'excluir risco crítico, sem geração, suspenso e evidência velha',
    why: 'há falhas que uma nota alta não apaga' },
  { id: 5, key: 'evidencia', name: 'exigir cobertura de evidência suficiente (≥ 40 % dos pesos)',
    why: 'com uma dimensão medida entre oito, o número é ruído lido como ranking' },
  { id: 6, key: 'classificacao', name: 'ordenar pela nota da tarefa',
    why: 'só métricas medidas entram no cálculo' },
  { id: 7, key: 'orcamento', name: 'respeitar o orçamento por tarefa',
    why: 'custo desconhecido não é custo zero: fica assinalado, não eliminado' },
  { id: 8, key: 'latencia', name: 'respeitar a latência máxima',
    why: 'um p50 medido, não uma promessa comercial' },
  { id: 9, key: 'capacidades', name: 'verificar as capacidades exigidas',
    why: 'só conta o que foi testado (nível 5); o que é «declarado» não serve de prova' },
  { id: 10, key: 'disponibilidade', name: 'verificar chave e estado operacional',
    why: 'um fornecedor sem credencial não executa, por muito boa que seja a nota' },
  { id: 11, key: 'desempate', name: 'desempatar de forma determinística',
    why: 'empate resolvido por ordem de ficheiro não é decisão, é acidente' },
  { id: 12, key: 'alternativa', name: 'nomear a alternativa e dizer por que não venceu',
    why: 'uma escolha sem alternativa é uma imposição' },
  { id: 13, key: 'registo', name: 'registar a decisão, a validade e o que a faria mudar',
    why: 'uma decisão sem prazo de reavaliação envelhece em silêncio' }
];

const norm = (s) => String(s == null ? '' : s).toLowerCase();

/* ---------- 1. selecção em 13 passos ---------- */
export function selectProvider(input) {
  const o = input || {};
  const now = o.now ? new Date(o.now) : new Date();
  const candidates = (o.candidates || []).slice();
  const c = o.constraints || {};
  const steps = [];
  const rejected = [];
  const note = (n, detail) => steps.push(Object.assign({ step: n }, detail));
  const drop = (list, stage, reasonOf) => {
    const keep = [];
    for (const cand of list) {
      const reason = reasonOf(cand);
      if (reason) rejected.push({ key: cand.key, name: cand.name || null, stage, reason });
      else keep.push(cand);
    }
    return keep;
  };

  /* 1 — tarefa */
  let task = o.task;
  let taskNote = null;
  if (!TASK_TYPES[task]) { taskNote = 'tarefa «' + (o.task || '') + '» desconhecida: usada «conversa»'; task = 'conversa'; }
  const weights = TASK_TYPES[task].weights;
  note(1, { ok: true, task, taskLabel: TASK_TYPES[task].label, weights, note: taskNote });
  if (!candidates.length) {
    return { ok: true, task, taskLabel: TASK_TYPES[task].label, taskNote, chosen: null, pinnedKey: null,
      alternatives: [], rejected: [], steps, justification: ['não há candidatas: o catálogo está vazio'],
      whatWouldChangeIt: ['descobrir e testar fornecedores (níveis 1–4)'], confidence: null,
      noChoiceReason: 'catálogo vazio: não há candidatas a avaliar' };
  }

  /* 2 — restrições duras */
  let pool = candidates;
  if (c.dataSensitive === true) {
    pool = drop(pool, 'restricao-privacidade', (x) => {
      const p = x.privacy || {};
      if (p.trainsOnData === true) return 'declara usar os dados para treino e a tarefa tem dados sensíveis';
      if (p.retentionDays != null && p.retentionDays > 30) return 'retém dados ' + p.retentionDays + ' dias (limite 30 para dados sensíveis)';
      return null;
    });
  }
  if (c.region) {
    pool = drop(pool, 'restricao-regiao', (x) => {
      if (!x.region) return null;                       // desconhecida: não se inventa a geografia
      return norm(x.region) === norm(c.region) ? null : 'opera em «' + x.region + '», exigido «' + c.region + '»';
    });
  }
  if (c.localOnly === true) pool = drop(pool, 'restricao-local', (x) => (x.kind === 'local-runtime' || x.kind === 'tool' ? null : 'não corre localmente'));
  note(2, { ok: true, kept: pool.length, removed: candidates.length - pool.length,
    regionNote: c.region ? 'região desconhecida não é tratada como região errada' : null });

  /* 3 — modelo fixado */
  const pinnedKey = c.pinnedKey ? String(c.pinnedKey) : null;
  let pinned = null;
  if (pinnedKey) {
    pinned = candidates.find((x) => x.key === pinnedKey) || null;
    note(3, { ok: !!pinned, pinnedKey,
      model: c.pinnedModel || null,
      note: pinned ? 'o pedido fixa este fornecedor' : 'fixado um fornecedor que não está no catálogo' });
    if (!pinned) {
      return { ok: true, task, taskLabel: TASK_TYPES[task].label, taskNote, chosen: null, pinnedKey,
        alternatives: [], rejected, steps,
        justification: ['não foi escolhido nenhum fornecedor: foi fixado «' + pinnedKey + '», que não existe no catálogo'],
        whatWouldChangeIt: ['registar «' + pinnedKey + '» no catálogo ou remover a fixação'],
        confidence: null,
        noChoiceReason: 'fixado «' + pinnedKey + '», que não está no catálogo — não se substitui sem autorização' };
    }
  } else {
    note(3, { ok: true, pinnedKey: null, note: 'nenhum modelo fixado: a escolha é do selector' });
  }

  /* 4 — exclusões */
  const before4 = pool.length;
  pool = drop(pool, 'exclusao', (x) => {
    const sc = scoreOf(x);
    return sc.excludedFromProduction.length ? sc.excludedFromProduction.map((e) => e.reason).join('; ') : null;
  });
  note(4, { ok: true, kept: pool.length, removed: before4 - pool.length });

  /* 5 — cobertura de evidência */
  const before5 = pool.length;
  pool = drop(pool, 'evidencia', (x) => {
    const sc = scoreOf(x);
    return sc.coveragePct >= 40 ? null : 'só ' + sc.coveragePct + ' % dos pesos medidos (mínimo 40 %): ' + (sc.missing.join(', ') || 'sem dimensões');
  });
  note(5, { ok: true, kept: pool.length, removed: before5 - pool.length, minimum: '40%' });

  /* 6 — classificação */
  pool = pool.map((x) => Object.assign({}, x, { _score: scoreOf(x) }))
    .sort((a, b) => (b._score.score || 0) - (a._score.score || 0));
  note(6, { ok: true, order: pool.map((x) => ({ key: x.key, score: x._score.score, band: x._score.band })) });

  /* 7 — orçamento */
  const before7 = pool.length;
  const unknownCost = [];
  pool = pool.filter((x) => {
    if (c.maxCostUsd == null) return true;
    const usd = x.metrics && x.metrics.costPerTaskUsd;
    if (usd == null) { unknownCost.push(x.key); return true; }   // desconhecido fica, assinalado
    if (usd <= c.maxCostUsd) return true;
    rejected.push({ key: x.key, name: x.name || null, stage: 'orcamento', reason: 'custo medido ' + usd + ' USD acima do máximo ' + c.maxCostUsd + ' USD' });
    return false;
  });
  note(7, { ok: true, kept: pool.length, removed: before7 - pool.length, maxCostUsd: c.maxCostUsd == null ? null : c.maxCostUsd,
    unknownCost: unknownCost.length ? unknownCost : null,
    note: unknownCost.length ? 'custo desconhecido não é tratado como gratuito' : null });

  /* 8 — latência */
  const before8 = pool.length;
  pool = drop(pool, 'latencia', (x) => {
    if (c.maxLatencyMs == null) return null;
    const ms = x.metrics && x.metrics.latencyP50Ms;
    if (ms == null) return null;                                  // não medida: fica, assinalada
    return ms <= c.maxLatencyMs ? null : 'p50 de ' + ms + ' ms acima do máximo ' + c.maxLatencyMs + ' ms';
  });
  note(8, { ok: true, kept: pool.length, removed: before8 - pool.length, maxLatencyMs: c.maxLatencyMs == null ? null : c.maxLatencyMs });

  /* 9 — capacidades */
  const before9 = pool.length;
  const need = (c.requireCapabilities || []).map(norm).filter(Boolean);
  pool = drop(pool, 'capacidades', (x) => {
    if (!need.length) return null;
    const tested = (x.capabilities && x.capabilities.tested) || {};
    const falta = need.filter((n) => tested[n] !== 'PASS');
    return falta.length ? 'sem prova de: ' + falta.join(', ') + ' (declarado não é testado)' : null;
  });
  note(9, { ok: true, kept: pool.length, removed: before9 - pool.length, required: need });

  /* 10 — disponibilidade */
  const before10 = pool.length;
  pool = drop(pool, 'disponibilidade', (x) => {
    if (x.state === 'SUSPENDED' || x.state === 'REJECTED' || x.state === 'UNAVAILABLE') return 'estado ' + x.state;
    const cred = x.credentials || {};
    if (cred.present === false) return 'sem credencial guardada: não há como executar';
    return null;
  });
  note(10, { ok: true, kept: pool.length, removed: before10 - pool.length });

  /* 11 — desempate determinístico */
  pool = pool.slice().sort((a, b) => {
    const s = (b._score.score || 0) - (a._score.score || 0);
    if (s) return s;
    const ra = (a.metrics && a.metrics.successRate) || 0, rb = (b.metrics && b.metrics.successRate) || 0;
    if (rb !== ra) return rb - ra;                                // mais fiável primeiro
    const ca = (a.metrics && a.metrics.costPerTaskUsd); const cb = (b.metrics && b.metrics.costPerTaskUsd);
    if (ca != null && cb != null && ca !== cb) return ca - cb;    // mais barato
    return String(a.key).localeCompare(String(b.key));            // último critério: nome, estável
  });
  note(11, { ok: true, criteria: ['nota da tarefa', 'taxa de sucesso', 'custo medido', 'chave (ordem estável)'] });

  /* escolha */
  let chosen = null, conflict = null;
  if (pinned) {
    const inPool = pool.find((x) => x.key === pinned.key);
    if (inPool) chosen = inPool;
    else {
      const why = rejected.filter((r) => r.key === pinned.key);
      conflict = 'o fornecedor fixado não passou os passos anteriores: ' + (why.map((r) => r.stage + ' — ' + r.reason).join('; ') || 'eliminado');
    }
  } else chosen = pool[0] || null;

  /* 12 — alternativa */
  const others = pool.filter((x) => !chosen || x.key !== chosen.key)
    .sort((a, b) => (b._score.score || 0) - (a._score.score || 0));
  const alternates = others.slice(0, 3).map((x) => ({
    key: x.key, name: x.name || null, score: x._score.score, band: x._score.band,
    whyNot: chosen ? whyNot(chosen, x) : 'não há escolha principal'
  }));
  note(12, { ok: true, alternatives: alternates.length });

  /* 13 — validade da decisão */
  const validade = chosen ? validityOf(chosen, now) : null;
  note(13, { ok: true, validityDays: validade ? validade.days : null, recheckAt: validade ? validade.recheckAt : null });

  function finish(extra) {
    const out = Object.assign({
      ok: true, task, taskLabel: TASK_TYPES[task].label, taskNote,
      chosen: null, pinnedKey, alternatives: [], rejected, steps,
      justification: [], whatWouldChangeIt: [], confidence: null,
      noChoiceReason: null
    }, extra || {});
    if (out.chosen === null && !out.noChoiceReason) out.noChoiceReason = out.reason || 'nenhuma candidata passou todos os passos';
    if (out.chosen && conflict) { out.conflict = conflict; out.chosen = null; out.noChoiceReason = conflict; }
    return out;
  }

  const base = { task, taskLabel: TASK_TYPES[task].label, taskNote, pinnedKey, rejected, steps };
  if (!chosen) {
    return finish(Object.assign({}, base, {
      alternatives: alternates, noChoiceReason: conflict || 'nenhuma candidata passou todos os passos: ' + (rejected.length ? rejected.length + ' eliminadas' : 'catálogo vazio'),
      justification: ['não foi escolhido nenhum fornecedor — ' + (rejected.length ? rejected.length + ' candidatas eliminadas com motivo registado' : 'sem candidatas')],
      whatWouldChangeIt: ['um teste de geração com PASS e cobertura ≥ 40 % num destes fornecedores']
    }));
  }

  const sc = chosen._score;
  const just = [];
  just.push('tarefa «' + TASK_TYPES[task].label + '»: pesos ' + Object.entries(weights).map(([k, v]) => k + ' ' + v).join(' · '));
  just.push('nota ' + sc.score + '/100 (faixa ' + sc.band + ') medida em ' + sc.coveragePct + ' % dos pesos' + (sc.missing.length ? '; faltam ' + sc.missing.join(', ') : ''));
  if (chosen.metrics && chosen.metrics.successRate != null) just.push('fiabilidade medida: ' + Math.round(chosen.metrics.successRate * 100) + ' % de execuções válidas');
  if (chosen.metrics && chosen.metrics.latencyP50Ms != null) just.push('latência p50 medida: ' + chosen.metrics.latencyP50Ms + ' ms');
  if (chosen.metrics && chosen.metrics.costPerTaskUsd != null) just.push('custo medido por tarefa: ' + chosen.metrics.costPerTaskUsd + ' USD');
  else just.push('custo por tarefa não medido — a escolha não se apoia em custo');
  just.push(rejected.length + ' candidata(s) eliminada(s) antes desta escolha; ' + alternates.length + ' alternativa(s) registada(s)');

  const change = [];
  if (sc.missing.length) change.push('medição de ' + sc.missing.join(', ') + ' mudaria a nota e talvez a ordem');
  change.push('um FAIL no nível 4 (geração) deste fornecedor passa-o para exclusão imediata');
  change.push('evidência com mais de 90 dias obriga a reavaliar antes de recomendar');
  if (validade) change.push('reavaliação marcada para ' + validade.recheckAt + ' (' + validade.days + ' dias)');

  return finish(Object.assign({}, base, {
    chosen: {
      key: chosen.key, name: chosen.name || null, kind: chosen.kind || null, state: chosen.state || null,
      score: sc.score, band: sc.band, coveragePct: sc.coveragePct, missing: sc.missing,
      model: (c.pinnedModel || null) || (chosen.defaultModel || null),
      modelNote: (c.pinnedModel || null) ? 'modelo fixado pelo pedido' : ((chosen.defaultModel || null) ? 'modelo por omissão do catálogo' : 'modelo não definido: tem de ser indicado antes de executar')
    },
    alternatives: alternates,
    justification: just,
    whatWouldChangeIt: change,
    confidence: sc.coveragePct >= 70 ? 'alta' : (sc.coveragePct >= 40 ? 'média' : 'baixa'),
    validade,
    pinned: !!pinned
  }));

  function scoreOf(x) {
    return scoreCandidate({
      key: x.key, name: x.name, kind: x.kind, state: x.state,
      risk: x.risk || null, tested: x.tested || { link: false, generation: false },
      freshnessDays: x.freshnessDays == null ? null : x.freshnessDays,
      metrics: x.metrics || {}
    }, task);
  }

  function whyNot(a, b) {
    const dif = (b._score.score || 0) - (a._score.score || 0);
    const parts = [];
    if (dif) parts.push('nota ' + b._score.score + ' contra ' + a._score.score);
    const ma = a.metrics || {}, mb = b.metrics || {};
    if (ma.successRate != null && mb.successRate != null && ma.successRate !== mb.successRate) {
      parts.push('fiabilidade ' + Math.round(mb.successRate * 100) + ' % contra ' + Math.round(ma.successRate * 100) + ' %');
    }
    if (ma.costPerTaskUsd != null && mb.costPerTaskUsd != null && ma.costPerTaskUsd !== mb.costPerTaskUsd) {
      parts.push('custo ' + mb.costPerTaskUsd + ' contra ' + ma.costPerTaskUsd + ' USD');
    }
    if (b._score.coveragePct !== a._score.coveragePct) parts.push('cobertura de evidência ' + b._score.coveragePct + ' % contra ' + a._score.coveragePct + ' %');
    return parts.length ? parts.join('; ') : 'empate técnico: perdeu no desempate por chave (ordem estável, não por acaso)';
  }

  function validityOf(x, at) {
    const days = x.freshnessDays == null ? 30 : Math.max(1, 90 - x.freshnessDays);
    return { days, recheckAt: new Date(at.getTime() + days * 86400000).toISOString().slice(0, 10) };
  }
}

/* ---------- 2. fallback: backoff + jitter, sem repetir efeitos ---------- */

/* PRNG determinístico (mulberry32): o jitter é aleatório em produção, mas
   reprodutível nos testes — sem isto, «jitter» seria uma desculpa. */
export function rng(seed) {
  let a = (Number(seed) >>> 0) || 0x9e3779b9;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FALLBACK_DEFAULTS = {
  baseMs: 500, capMs: 8000, maxAttemptsPerProvider: 2, jitter: 'full',
  maxTotalAttempts: 8, budgetUsd: 0.05
};

/* Plano puro: calcula esperas e tentativas SEM chamar nada (e portanto sem gastar nada). */
export function planFallback(opts) {
  /* `undefined` NÃO é um valor: se um campo não for indicado, vale a política por
     omissão. (Sem isto, `{maxTotalAttempts: undefined}` desligava o tecto e o
     plano vinha vazio — bug apanhado pelo teste da rota HTTP.) */
  const limpo = {};
  for (const [k, v] of Object.entries(opts || {})) if (v !== undefined) limpo[k] = v;
  const o = Object.assign({}, FALLBACK_DEFAULTS, limpo);
  const order = (o.order || []).map(String);
  if (!order.length) return { ok: false, reason: 'sem candidatos na ordem de fallback', plan: [] };
  const r = rng(o.seed == null ? Date.now() : o.seed);
  const plan = [];
  let total = 0;
  for (let i = 0; i < order.length && total < o.maxTotalAttempts; i++) {
    for (let k = 1; k <= o.maxAttemptsPerProvider && total < o.maxTotalAttempts; k++) {
      const exp = Math.min(o.capMs, o.baseMs * Math.pow(2, k - 2));
      /* a PRIMEIRA tentativa de cada fornecedor não espera (não se faz o
         utilizador aguardar antes de tentar); as repetições esperam com
         backoff exponencial entre 0 e exp (jitter completo) */
      const espera = Math.max(1, exp);
      const delay = k === 1 ? 0
        : o.jitter === 'none' ? espera
          : o.jitter === 'equal' ? Math.round(espera / 2 + r() * (espera / 2))
            : Math.round(r() * espera);
      plan.push({ providerKey: order[i], attempt: k, delayMs: delay, maxDelayMs: exp, kind: k === 1 ? 'primeira' : 'repeticao' });
      total++;
    }
  }
  return {
    ok: true, plan, seeded: o.seed != null,
    policy: { baseMs: o.baseMs, capMs: o.capMs, jitter: o.jitter, maxAttemptsPerProvider: o.maxAttemptsPerProvider,
      maxTotalAttempts: o.maxTotalAttempts, budgetUsd: o.budgetUsd },
    note: 'o plano não faz pedidos: só diz quanto se esperaria antes de cada tentativa'
  };
}

/* Classificação do desfecho. `externallyApplied` significa: o efeito externo
   PODE ter acontecido (ex.: o pedido chegou e a resposta perdeu-se). Nesse caso
   não se repete nada — repete-se um pagamento, não uma leitura. */
export function classifyOutcome(err) {
  const e = err || {};
  if (e.externallyApplied === true) {
    return { class: 'indeterminado', retryable: false, mustNotRepeat: true, diagnosis: 'efeito-externo-possivel',
      hint: 'o efeito pode já estar aplicado: confirmar no fornecedor antes de qualquer nova tentativa' };
  }
  const d = classifyFailure({ status: e.status || 0, body: e.body || '', error: e.message || '', endpoint: e.endpoint || '' });
  if (!d.retryable) {
    return { class: 'permanente', retryable: false, mustNotRepeat: false, diagnosis: d.diagnosis, hint: d.hint };
  }
  return { class: 'transitorio', retryable: true, mustNotRepeat: false, diagnosis: d.diagnosis, hint: d.hint };
}

/* Executor com política. Tudo injectado: `call(providerKey, attempt)` e `sleep(ms)`.
   `call` devolve { ok:true, costUsd?, effectApplied? } ou lança erro com status/body. */
export async function runWithFallback(opts) {
  /* a política é fundida UMA vez: passar `undefined` para o plano desligava os
     limites por omissão (bug apanhado por estes mesmos testes: o plano vinha vazio) */
  const o = Object.assign({}, FALLBACK_DEFAULTS, opts || {});
  const planOut = planFallback({
    order: o.order, baseMs: o.baseMs, capMs: o.capMs, jitter: o.jitter,
    maxAttemptsPerProvider: o.maxAttemptsPerProvider, maxTotalAttempts: o.maxTotalAttempts,
    budgetUsd: o.budgetUsd, seed: o.seed
  });
  if (!planOut.ok) return { status: 'SEM-CANDIDATOS', reason: planOut.reason, attempts: [], spentUsd: 0, plan: [] };
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxCost = planOut.policy.budgetUsd;
  const attempts = [];
  let spent = 0;

  for (let i = 0; i < planOut.plan.length; i++) {
    const step = planOut.plan[i];
    if (step.delayMs) await sleep(step.delayMs);
    let res;
    const t0 = Date.now();
    try {
      res = await o.call(step.providerKey, step.attempt);
    } catch (err) {
      const c = classifyOutcome(err);
      attempts.push({ providerKey: step.providerKey, attempt: step.attempt, delayMs: step.delayMs,
        outcome: 'falhou', class: c.class, diagnosis: c.diagnosis, hint: c.hint, ms: Date.now() - t0 });
      if (spent + (Number(err && err.costUsd) || 0) > maxCost) {
        return { status: 'ORCAMENTO', reason: 'orçamento de ' + maxCost + ' USD excedido — paragem', attempts, spentUsd: spent, plan: planOut.plan };
      }
      if (c.class === 'indeterminado') {
        return { status: 'INDETERMINADO', reason: c.hint, attempts, spentUsd: spent, plan: planOut.plan,
          mustCheckBeforeRetry: true };
      }
      if (c.class === 'permanente') {
        /* salta as tentativas restantes DESTE fornecedor, vai para o próximo */
        while (i + 1 < planOut.plan.length && planOut.plan[i + 1].providerKey === step.providerKey) i++;
      }
      continue;
    }
    const cost = Number(res && res.costUsd) || 0;
    spent += cost;
    attempts.push({ providerKey: step.providerKey, attempt: step.attempt, delayMs: step.delayMs,
      outcome: 'sucesso', class: null, costUsd: cost, ms: Date.now() - t0,
      effectApplied: !!(res && res.effectApplied) });
    if (spent > maxCost) {
      return { status: 'ORCAMENTO', reason: 'a execução excedeu ' + maxCost + ' USD: paragem imediata', attempts, spentUsd: spent, plan: planOut.plan, result: res && res.result };
    }
    return { status: 'PASS', chosenKey: step.providerKey, attempts, spentUsd: spent, plan: planOut.plan, result: res && res.result };
  }
  return { status: 'FALHOU', reason: 'todas as tentativas do plano falharam', attempts, spentUsd: spent, plan: planOut.plan };
}
