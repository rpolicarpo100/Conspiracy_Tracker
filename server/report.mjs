/* =====================================================================
   RELATÓRIO — 18 secções, geradas só a partir do que está guardado.

   Regra: uma secção sem dados não é inventada. Aparece com `available:false`
   e uma nota a dizer o que falta («Não disponível: …»). O relatório mostra
   sempre as provas contrárias e as fontes inacessíveis, se existirem.
   ===================================================================== */
import { corroboration, suggestedState, STATE_LABEL, entityName } from './evidence.mjs';

const NI = (why) => ({ available: false, note: 'Não disponível: ' + why });

export const SECTION_TITLES = [
  'Pergunta', 'Âmbito', 'Data de referência', 'Metodologia', 'Fontes consultadas',
  'Fontes inacessíveis', 'Entidades', 'Alegações e conclusões', 'Provas favoráveis',
  'Provas contrárias', 'Relações', 'Cronologia', 'Lacunas', 'Limitações',
  'Estado de verificação', 'Modelos e ferramentas', 'Custos', 'Conclusões proporcionais'
];

export function buildReport({ project, evidence, claims, runs, relations, usage }) {
  relations = relations || [];
  evidence = evidence || [];
  claims = claims || [];
  runs = runs || [];
  usage = usage || [];
  const active = evidence.filter((e) => !e.retractedAt);
  const retracted = evidence.filter((e) => e.retractedAt);
  const inaccessible = evidence.filter((e) => e.validationState === 'fonte-inacessivel' || e.retractedAt);
  const claimsWithEvidence = claims.map((c) => {
    const evs = evidence.filter((e) => (c.evidenceIds || []).includes(e.id));
    return { claim: c, factors: corroboration(evs), suggested: suggestedState(evs) };
  });

  const sections = [];

  sections.push({
    n: 1, title: 'Pergunta',
    available: !!project.question,
    content: project.question ? { pergunta: project.question, titulo: project.title } : null,
    note: project.question ? null : 'Não disponível: o projecto não tem pergunta definida'
  });

  const escopoDefinido = !!(project.scope && (project.scope.geo || (project.scope.languages || []).length || (project.scope.period && (project.scope.period.from || project.scope.period.to))));
  sections.push({
    n: 2, title: 'Âmbito',
    available: escopoDefinido,
    note: escopoDefinido ? null : 'Não disponível: o projecto não define geografia, línguas nem período — a investigação não tem fronteira declarada',
    content: {
      geografia: (project.scope && project.scope.geo) || null,
      linguas: (project.scope && project.scope.languages) || [],
      periodo: (project.scope && project.scope.period) || null,
      fontesPrioritarias: project.prioritySources || [],
      fontesExcluidas: project.excludedSources || []
    }
  });

  sections.push({
    n: 3, title: 'Data de referência',
    available: !!project.referenceDate,
    content: project.referenceDate ? { data: project.referenceDate, limite: project.timeLimit || null } : null,
    note: project.referenceDate ? null : 'Não disponível: sem data de referência, os resultados valem para a data de consulta'
  });

  const completedRuns = runs.filter((r) => r.steps && r.steps.length);
  sections.push({
    n: 4, title: 'Metodologia',
    available: completedRuns.length > 0,
    content: completedRuns.length ? {
      perfis: [...new Set(runs.map((r) => r.profile))],
      execucoes: runs.map((r) => ({
        id: r.id, perfil: r.profile, estado: r.status, motivoDeParagem: r.stopReason || null,
        passos: (r.steps || []).map((s) => ({ n: s.n, passo: s.id, estado: s.status, motivo: s.reason || null }))
      })),
      nota: 'os passos ignorados ou não executados estão declarados um a um'
    } : null,
    note: completedRuns.length ? null : 'Não disponível: nenhuma execução de pesquisa registada neste projecto'
  });

  const consulted = runs.flatMap((r) => r.sourcesConsulted || []);
  sections.push({
    n: 5, title: 'Fontes consultadas',
    available: consulted.length > 0,
    content: consulted.length ? {
      total: consulted.length,
      obtidas: consulted.filter((c) => c.ok).length,
      lista: consulted.map((c) => ({ url: c.url, host: c.host, estado: c.status, bytes: c.bytes, hash: c.hash, sinalDeInjecao: c.injection && c.injection.suspicious ? true : false }))
    } : null,
    note: consulted.length ? null : 'Não disponível: nenhuma recolha registada (as provas inseridas à mão aparecem na secção 5 do registo de provas)'
  });

  sections.push({
    n: 6, title: 'Fontes inacessíveis',
    available: true,
    content: {
      total: inaccessible.length,
      lista: inaccessible.map((e) => ({ titulo: e.title, url: e.canonicalUrl || e.originalUrl, motivo: e.retractReason || 'marcada como inacessível', estado: e.validationState })),
      nota: inaccessible.length ? null : 'nenhuma fonte registada como inacessível'
    },
    note: null
  });

  const entities = new Map();
  evidence.forEach((e) => (e.entities || []).forEach((raw) => {
    const n = entityName(raw);
    if (n) entities.set(n, (entities.get(n) || 0) + 1);
  }));
  sections.push({
    n: 7, title: 'Entidades',
    available: entities.size > 0,
    content: entities.size ? { entidades: [...entities.entries()].map(([nome, provas]) => ({ nome, provas })) } : null,
    note: entities.size ? null : 'Não disponível: nenhuma entidade associada a provas (não se inventam entidades a partir da pergunta)'
  });

  sections.push({
    n: 8, title: 'Alegações e conclusões',
    available: claims.length > 0,
    content: claims.length ? {
      lista: claimsWithEvidence.map(({ claim, factors, suggested }) => ({
        id: claim.id, texto: claim.text, tipo: claim.kind, estado: claim.state,
        estadoLegivel: STATE_LABEL[claim.state] || claim.state, sugerido: suggested,
        origensIndependentes: factors.independentOrigins, favoraveis: factors.favourable,
        contrarias: factors.contrary, primarias: factors.primaryFavourable,
        copiasRedundantes: factors.copiesWithoutIndependentValue
      }))
    } : null,
    note: claims.length ? null : 'Não disponível: nenhuma conclusão registada'
  });

  const fav = active.filter((e) => e.stance === 'favoravel');
  const con = active.filter((e) => e.stance === 'contraria');
  const evLine = (e) => ({ id: e.id, titulo: e.title, url: e.canonicalUrl || e.originalUrl || null, tipo: e.sourceType, estado: e.validationState, excerto: e.excerpt, verificada: e.verificationDate || null });
  sections.push({ n: 9, title: 'Provas favoráveis', available: fav.length > 0, content: fav.length ? { total: fav.length, lista: fav.map(evLine) } : null, note: fav.length ? null : 'Nenhuma prova favorável registada' });
  sections.push({ n: 10, title: 'Provas contrárias', available: true, content: { total: con.length, lista: con.map(evLine), nota: con.length ? null : 'nenhuma prova contrária registada — a ausência de contra-prova não é prova de nada' }, note: null });

  const activeRels = relations.filter((r) => !r.retractedAt);
  const relLine = (r) => {
    const evs = evidence.filter((e) => (r.evidenceIds || []).includes(e.id) && !e.retractedAt);
    const origins = new Set(evs.map((e) => e.originKey || e.canonicalUrl));
    return {
      de: r.from, para: r.to, tipo: r.type, direccao: r.direction || 'directed',
      periodo: r.period || { from: null, to: null },
      provas: evs.map((e) => e.id), origensIndependentes: origins.size,
      inferida: !!r.inferred, raciocinio: r.reasoning || null,
      confianca: !evs.length ? 'sem-prova' : origins.size >= 2 ? 'corroborada' : 'uma-so-origem'
    };
  };
  sections.push({
    n: 11, title: 'Relações',
    available: activeRels.length > 0,
    content: activeRels.length ? {
      total: activeRels.length,
      corroboradas: activeRels.map(relLine).filter((r) => r.confianca === 'corroborada').length,
      comUmaSoOrigem: activeRels.map(relLine).filter((r) => r.confianca === 'uma-so-origem').length,
      inferidas: activeRels.filter((r) => r.inferred).length,
      lista: activeRels.map(relLine),
      nota: 'cada relação traz as provas que a nomeiam; uma linha do grafo não é prova por si mesma'
    } : null,
    note: activeRels.length ? null : 'Não disponível: nenhuma relação tipificada registada com prova — co-ocorrência não é relação e não é apresentada como tal'
  });

  const dated = active.filter((e) => e.eventDate || e.publicationDate);
  sections.push({
    n: 12, title: 'Cronologia',
    available: dated.length > 0,
    content: dated.length ? {
      eventos: dated.map((e) => ({ data: e.eventDate || e.publicationDate, tipo: e.eventDate ? 'acontecimento' : 'publicação', titulo: e.title, prova: e.id }))
        .sort((a, b) => String(a.data).localeCompare(String(b.data)))
    } : null,
    note: dated.length ? null : 'Não disponível: nenhuma prova tem data de acontecimento ou publicação'
  });

  const gaps = [];
  claimsWithEvidence.filter((x) => !x.claim.evidenceIds || !x.claim.evidenceIds.length).forEach((x) => gaps.push('conclusão sem provas: ' + x.claim.text));
  claimsWithEvidence.filter((x) => x.factors.independentOrigins === 1).forEach((x) => gaps.push('uma só origem independente: ' + x.claim.text));
  if (!project.completionCriteria || !project.completionCriteria.length) gaps.push('critérios de conclusão não definidos');
  if (!project.referenceDate) gaps.push('data de referência não definida');
  sections.push({ n: 13, title: 'Lacunas', available: true, content: { total: gaps.length, lista: gaps, nota: gaps.length ? null : 'nenhuma lacuna detectada pelas regras actuais' }, note: null });

  const limitations = [];
  active.forEach((e) => { if (e.limitations) limitations.push(e.title + ': ' + e.limitations); });
  retracted.forEach((e) => limitations.push('prova retirada (' + e.title + '): ' + e.retractReason));
  sections.push({ n: 14, title: 'Limitações', available: limitations.length > 0 || true, content: { lista: limitations, nota: 'limitações declaradas por prova e retiradas com motivo' }, note: limitations.length ? null : 'Nenhuma limitação declarada nas provas' });

  sections.push({
    n: 15, title: 'Estado de verificação',
    available: active.length > 0,
    content: active.length ? {
      porEstado: active.reduce((a, e) => { a[e.validationState] = (a[e.validationState] || 0) + 1; return a; }, {}),
      comDataDeVerificacao: active.filter((e) => e.verificationDate).length,
      total: active.length,
      nota: 'verificação automática de acessibilidade ainda não está implementada'
    } : null,
    note: active.length ? null : 'Não disponível: sem provas registadas'
  });

  const models = new Map();
  runs.forEach((r) => (r.steps || []).forEach((s) => {
    if (s.provider || s.model) models.set((s.provider || '?') + '/' + (s.model || '?'), (models.get((s.provider || '?') + '/' + (s.model || '?')) || 0) + 1);
  }));
  sections.push({
    n: 16, title: 'Modelos e ferramentas',
    available: models.size > 0,
    content: models.size ? { modelos: [...models.entries()].map(([k, n]) => ({ modelo: k, passos: n })), promptVersion: (runs.flatMap((r) => r.steps || []).find((s) => s.promptVersion) || {}).promptVersion || null, ferramentas: ['recolha HTTP com guardas', 'registo de provas com hash'] } : null,
    note: models.size ? null : 'Não disponível: nenhum passo de IA executado (sem fornecedor validado)'
  });

  const reported = usage.filter((u) => u.promptTokens != null || u.completionTokens != null);
  sections.push({
    n: 17, title: 'Custos',
    available: reported.length > 0,
    content: reported.length ? {
      chamadas: usage.length, chamadasComTokensReportados: reported.length,
      tokensPrompt: reported.reduce((a, u) => a + (u.promptTokens || 0), 0),
      tokensResposta: reported.reduce((a, u) => a + (u.completionTokens || 0), 0),
      custo: usage.some((u) => u.cost != null) ? usage.reduce((a, u) => a + (u.cost || 0), 0) : 'não reportado pelo fornecedor',
      nota: 'custo não é estimado quando o fornecedor não o reporta'
    } : null,
    note: reported.length ? null : 'Não disponível: nenhuma chamada com contagem de tokens reportada'
  });

  const proportional = claimsWithEvidence.map(({ claim, factors }) => ({
    conclusao: claim.text, estado: claim.state, origensIndependentes: factors.independentOrigins,
    contrapartida: factors.contrary > 0 ? 'existe prova contrária registada' : 'sem prova contrária registada',
    redacao: redacaoProporcional(claim, factors)
  }));
  sections.push({
    n: 18, title: 'Conclusões proporcionais',
    available: proportional.length > 0,
    content: proportional.length ? { lista: proportional, nota: 'cada conclusão é redigida com o estado que as provas sustentam, sem adjectivos de certeza' } : null,
    note: proportional.length ? null : 'Não disponível: nenhuma conclusão registada'
  });

  const anyAvailable = sections.filter((s) => s.available).length;
  return {
    project: { id: project.id, title: project.title, generatedAt: new Date().toISOString() },
    sections,
    summary: {
      sections: sections.length,
      available: anyAvailable,
      unavailable: sections.length - anyAvailable,
      evidence: active.length,
      retracted: retracted.length,
      claims: claims.length,
      runs: runs.length
    }
  };
}

function redacaoProporcional(claim, f) {
  switch (claim.state) {
    case 'confirmada':
      return claim.text + ' — sustentada por ' + f.independentOrigins + ' origens independentes, incluindo prova primária.';
    case 'corroborada-independente':
      return claim.text + ' — corroborada por ' + f.independentOrigins + ' origens independentes.';
    case 'contraditoria':
      return claim.text + ' — há provas a favor e contra (' + f.favourable + '/' + f.contrary + '): não se conclui.';
    case 'alegacao-atribuida':
      return 'Foi afirmado que ' + claim.text.charAt(0).toLowerCase() + claim.text.slice(1) + ' — a atribuição está documentada; o conteúdo não está confirmado.';
    case 'inferencia-suportada':
      return 'Infere-se, a partir das provas registadas, que ' + claim.text.charAt(0).toLowerCase() + claim.text.slice(1) + '.';
    case 'refutada':
      return claim.text + ' — refutada por prova contrária primária.';
    case 'fonte-inacessivel':
      return claim.text + ' — a prova necessária está inacessível: não se conclui.';
    case 'insuficiente':
      return claim.text + ' — provas insuficientes para concluir.';
    default:
      return claim.text + ' — hipótese em teste, sem estado atribuído.';
  }
}

/* Markdown: mesmas secções, mesmas ausências declaradas. */
export function reportToMarkdown(rep) {
  const L = [];
  L.push('# ' + rep.project.title);
  L.push('');
  L.push('_Relatório gerado em ' + rep.project.generatedAt + ' · ' + rep.summary.available + ' de ' + rep.summary.sections +
    ' secções com dados · ' + rep.summary.unavailable + ' sem dados (declaradas)_');
  L.push('');
  rep.sections.forEach((s) => {
    L.push('## ' + s.n + '. ' + s.title);
    if (!s.available) { L.push(''); L.push('**' + (s.note || 'Não disponível') + '**'); L.push(''); return; }
    L.push('');
    if (s.content && s.content.lista && Array.isArray(s.content.lista)) {
      s.content.lista.forEach((x) => L.push('- ' + (typeof x === 'string' ? x : JSON.stringify(x))));
    } else if (s.content && s.content.nota && Object.keys(s.content).length === 2 && s.content.total === 0) {
      L.push(s.content.nota);
    } else {
      L.push('```json');
      L.push(JSON.stringify(s.content, null, 1).slice(0, 4000));
      L.push('```');
    }
    if (s.content && s.content.nota && !(s.content.lista && !s.content.lista.length)) {
      L.push('');
      L.push('_' + s.content.nota + '_');
    }
    L.push('');
  });
  return L.join('\n');
}
