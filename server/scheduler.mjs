/* =====================================================================
   REAVALIAÇÃO ADAPTATIVA — fase 5

   Duas ideias que não se podem confundir:

   1. REAVALIAÇÃO (testa de facto o fornecedor, níveis 1–2, sem chave e sem
      custo): decide QUANDO cada entrada volta a ser testada, com intervalos
      adaptativos — quem passa seguido é testado menos; quem falha por motivo
      transitório volta mais cedo; quem falhou por motivo PERMANENTE não é
      testado automaticamente outra vez (insistir num 401 é ruído e, em alguns
      serviços, risco de bloqueio).

   2. HEALTH CHECK (só diz «responde / não responde»): prova de vida barata.
      Não é teste de qualidade, não atribui nota, não promove estado e não
      entra no ranking. Esta separação está no código e nos testes.

   O calendário é DERIVADO do histórico imutável (`providerTests`) e da idade da
   evidência: a mesma história dá sempre o mesmo plano. Não há estado escondido
   num temporizador que ninguém consegue auditar.
   ===================================================================== */

export const REEVAL_POLICY = {
  baseDays: 7,            // primeiro intervalo depois de um PASS
  maxDays: 90,            // tecto (o mesmo prazo em que a evidência fica STALE)
  minDays: 1,             // nunca menos de um dia entre reavaliações automáticas
  transientBackoffDays: [1, 3, 7],  // 1.ª, 2.ª e 3.ª repetição após falha transitória
  maxTransientRetries: 3, // depois disto, só manualmente
  staleDays: 90,          // evidência com mais de 90 dias obriga a reavaliar
  maxPerRun: 6,           // tecto de entradas por execução
  healthWindowDays: 7     // janela usada para o veredicto de saúde
};

const DAY = 86400000;
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const iso = (d) => new Date(d).toISOString();
const dayOf = (d) => iso(d).slice(0, 10);

/* Classificação do último resultado, para decidir o intervalo. */
function classifyLast(lastTest) {
  if (!lastTest) return { kind: 'nunca-testado' };
  const r = lastTest.result;
  if (r === 'PASS') return { kind: 'pass' };
  if (r === 'BLOCKED') return { kind: 'bloqueado', why: lastTest.reason || 'sem credencial' };
  if (r === 'NOT_TESTED') return { kind: 'nao-testado', why: lastTest.reason || 'sem alvo de teste' };
  if (r === 'FAIL' || r === 'STALE') {
    const d = String(lastTest.diagnosis || '');
    /* erros que não mudam sozinhos: repetir é gastar tempo a receber o mesmo «não» */
    const permanente = ['credencial-recusada', 'sem-credencial', 'conta-sem-quota', 'caminho-errado',
      'modelo-inexistente', 'pedido-invalido', 'proibido', 'nao-encontrado'].includes(d);
    return { kind: permanente ? 'falha-permanente' : 'falha-transitoria', diagnosis: d || null };
  }
  return { kind: 'desconhecido' };
}

/* Quantas vezes seguidas o mesmo diagnóstico se repetiu (para o backoff). */
function streakOf(tests, predicate) {
  let n = 0;
  for (let i = tests.length - 1; i >= 0; i--) { if (predicate(tests[i])) n++; else break; }
  return n;
}

/**
 * Estado de reavaliação de UMA entrada. Função pura: `tests` e `now` entram,
 * decisão sai. `nextDueAt` é um ISO; `due` diz se já passou.
 */
export function reevaluationState(entry, tests, opts) {
  const o = opts || {};
  const policy = Object.assign({}, REEVAL_POLICY, o.policy || {});
  const now = o.now ? new Date(o.now) : new Date();
  const list = (tests || []).filter((t) => !t.synthetic);
  const last = list.length ? list[list.length - 1] : null;
  const cls = classifyLast(last);
  const base = { key: entry.key, name: entry.name || null, lastTestAt: last ? last.at : null, kind: cls.kind };

  /* evidência envelhecida manda sobre o resto: é o prazo que o próprio sistema prometeu */
  const medido = (entry.evidence || []).filter((e) => e.status === 'MEASURED' && e.at);
  const maisAntigo = medido.length ? Math.min(...medido.map((e) => new Date(e.at).getTime())) : null;
  const idadeEv = maisAntigo == null ? null : Math.floor((now.getTime() - maisAntigo) / DAY);
  const stale = idadeEv != null && idadeEv > policy.staleDays;

  if (!last) {
    /* prioridade: evidência velha manda; a seguir quem nunca foi testado (não se
       sabe nada), depois uma falha transitória conhecida, por fim a rotina */
    return Object.assign(base, {
      due: true, nextDueAt: iso(now), daysLeft: 0, priority: stale ? 90 : 50, stale,
      reason: (stale ? 'evidência medida há ' + idadeEv + ' dias (limite ' + policy.staleDays + ') e ' : '') +
        'nunca foi testado: é o primeiro teste, não uma reavaliação',
      action: 'testar níveis 1–2 (sem chave)'
    });
  }

  const lastAt = new Date(last.at);
  if (cls.kind === 'falha-permanente') {
    return Object.assign(base, {
      due: false, nextDueAt: null, daysLeft: null, priority: 0,
      reason: 'falha permanente («' + (cls.diagnosis || 'diagnóstico registado') + '»): não se repete automaticamente — ' +
        'a causa só muda com uma acção humana (chave nova, quota renovada, caminho corrigido)',
      action: 'manual'
    });
  }
  if (cls.kind === 'bloqueado' || cls.kind === 'nao-testado') {
    return Object.assign(base, {
      due: false, nextDueAt: null, daysLeft: null, priority: 10,
      reason: 'bloqueado por falta de pré-requisito (' + (cls.why || 'sem chave') + '): não é falha do fornecedor',
      action: 'fornecer credencial ou alvo'
    });
  }

  let intervalDays;
  let reason;
  if (cls.kind === 'pass') {
    const passaSeguidos = streakOf(list, (t) => t.result === 'PASS');
    intervalDays = Math.min(policy.maxDays, policy.baseDays * Math.pow(2, Math.max(0, passaSeguidos - 1)));
    reason = passaSeguidos + ' PASS seguido(s): intervalo alargado para ' + intervalDays + ' dias ' +
      '(base ' + policy.baseDays + ' × 2^' + Math.max(0, passaSeguidos - 1) + ', tecto ' + policy.maxDays + ')';
  } else {
    const falhas = streakOf(list, (t) => t.result === 'FAIL' || t.result === 'STALE');
    if (falhas > policy.maxTransientRetries) {
      return Object.assign(base, {
        due: false, nextDueAt: null, daysLeft: null, priority: 5,
        reason: 'já falhou ' + falhas + ' vezes seguidas por motivo transitório: parou de repetir sozinho ' +
          '(limite ' + policy.maxTransientRetries + ') — precisa de decisão humana',
        action: 'manual'
      });
    }
    intervalDays = policy.transientBackoffDays[Math.min(policy.transientBackoffDays.length - 1, Math.max(0, falhas - 1))];
    reason = 'falha transitória («' + (cls.diagnosis || 'sem diagnóstico') + '»): nova tentativa em ' + intervalDays + ' dia(s)';
  }

  if (stale) {
    intervalDays = 0;
    reason = 'evidência medida há ' + idadeEv + ' dias (limite ' + policy.staleDays + '): reavaliar já — ' + reason;
  }

  const nextDue = addDays(lastAt, intervalDays);
  const daysLeft = Math.max(0, Math.ceil((nextDue.getTime() - now.getTime()) / DAY));
  return Object.assign(base, {
    due: nextDue.getTime() <= now.getTime(),
    nextDueAt: iso(nextDue), nextDueDay: dayOf(nextDue), daysLeft,
    intervalDays, evidenceAgeDays: idadeEv, stale,
    priority: stale ? 90 : (cls.kind === 'falha-transitoria' ? 40 : 20),
    reason, action: 'testar níveis 1–2 (sem chave)'
  });
}

/**
 * Plano de reavaliação para o catálogo inteiro: o que está em atraso, por que
 * ordem, e o que fica de fora (com motivo). `limit` e `budget` são respeitados
 * ANTES de qualquer pedido.
 */
export function planReevaluation(input) {
  const o = input || {};
  const policy = Object.assign({}, REEVAL_POLICY, o.policy || {});
  const now = o.now ? new Date(o.now) : new Date();
  const lim = Math.max(0, Math.min(Number(o.limit || policy.maxPerRun), 20));
  const states = (o.entries || []).map((e) => reevaluationState(e, o.testsOf ? o.testsOf(e.key) : [], { now, policy }));
  const due = states.filter((s) => s.due).sort((a, b) => (b.priority - a.priority) || String(a.key).localeCompare(String(b.key)));
  const run = due.slice(0, lim);
  const notRun = due.slice(lim).map((s) => ({ key: s.key, reason: 'fora do lote desta execução (limite ' + lim + ')' }));
  return {
    ok: true, at: iso(now), policy,
    counts: {
      total: states.length, due: due.length, willRun: run.length, later: notRun.length,
      notDue: states.filter((s) => !s.due).length,
      manual: states.filter((s) => s.action === 'manual').length
    },
    queue: run.map((s, i) => Object.assign({ position: i + 1 }, s)),
    later: notRun,
    notDue: states.filter((s) => !s.due).map((s) => ({ key: s.key, nextDueAt: s.nextDueAt, reason: s.reason })),
    all: states,
    note: 'a fila é derivada do histórico de testes: a mesma história dá sempre a mesma fila; nenhum pedido foi feito'
  };
}

/* ---------- saúde ≠ qualidade ---------- */

/**
 * Veredicto de saúde a partir de uma série de sondas (registos de auditoria
 * `provider_health`). Deliberadamente NÃO recebe testes nem notas: se recebesse,
 * alguém poderia ligá-las e a separação deixaria de existir.
 */
export function healthVerdict(probes, opts) {
  const o = opts || {};
  const policy = Object.assign({}, REEVAL_POLICY, o.policy || {});
  const now = o.now ? new Date(o.now) : new Date();
  const list = (probes || []).filter((p) => now.getTime() - new Date(p.at).getTime() <= policy.healthWindowDays * DAY);
  if (!list.length) {
    return { status: 'SEM-DADOS', probes: 0, lastAt: null, consecutiveFailures: 0,
      note: 'nunca foi sondado nesta janela: ausência de notícia não é boa notícia' };
  }
  const sorted = list.slice().sort((a, b) => new Date(a.at) - new Date(b.at));
  const last = sorted[sorted.length - 1];
  let failures = 0;
  for (let i = sorted.length - 1; i >= 0; i--) { if (sorted[i].ok) break; failures++; }
  const status = !last.ok ? (failures >= 3 ? 'INDISPONIVEL' : 'DEGRADADO')
    : (failures > 0 ? 'DEGRADADO' : 'OPERACIONAL');
  return {
    status, probes: sorted.length, lastAt: last.at, lastHttpStatus: last.httpStatus == null ? null : last.httpStatus,
    lastLatencyMs: last.latencyMs == null ? null : last.latencyMs,
    consecutiveFailures: failures,
    note: status === 'INDISPONIVEL'
      ? 'falhou as últimas ' + failures + ' sondas: é aviso operacional, não uma nota — a classificação continua a exigir teste de qualidade'
      : 'prova de vida apenas: HEALTH CHECK NÃO É TESTE DE QUALIDADE e não altera a classificação'
  };
}

/**
 * Executa a fila com tudo injectado (`runTest`) — assim o mesmo código corre em
 * produção e em teste, e o teste não faz pedidos a ninguém.
 */
export async function runReevaluation(plan, opts) {
  const o = opts || {};
  const resultados = [];
  let pedidos = 0;
  const budget = Number(o.maxRequests == null ? 8 : o.maxRequests);
  for (const item of (plan.queue || [])) {
    if (pedidos >= budget) {
      resultados.push({ key: item.key, status: 'NAO-EXECUTADO', reason: 'orçamento de pedidos do lote esgotado (' + budget + ')' });
      continue;
    }
    if (o.stopWhen || (o.stop && o.stop.aborted)) {
      resultados.push({ key: item.key, status: 'NAO-EXECUTADO', reason: 'paragem pedida pelo utilizador' });
      continue;
    }
    try {
      const r = await o.runTest(item.key);
      pedidos += Number(r && r.requestsUsed) || 0;
      const nivel = r && r.results ? Object.values(r.results)[0] : null;
      resultados.push({
        key: item.key, status: 'EXECUTADO',
        result: nivel ? nivel.result : null,
        reason: nivel ? (nivel.reason || nivel.detail || null) : null,
        latencyMs: nivel && nivel.latencyMs != null ? nivel.latencyMs : null,
        requestsUsed: Number(r && r.requestsUsed) || 0
      });
    } catch (e) {
      resultados.push({ key: item.key, status: 'ERRO-INTERNO', reason: String(e && e.message || e).slice(0, 200) });
    }
  }
  return {
    ok: true, executed: resultados.filter((r) => r.status === 'EXECUTADO').length,
    skipped: resultados.filter((r) => r.status !== 'EXECUTADO').length,
    requestsUsed: pedidos, budget, results: resultados,
    note: 'cada resultado fica em providerTests (histórico imutável); o calendário seguinte recalcula-se a partir dele'
  };
}
