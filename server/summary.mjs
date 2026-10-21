/* =====================================================================
   RESUMO DA INVESTIGAÇÃO — descarregável em MD, JSON, CSV e PDF.

   Regras que este módulo não quebra:
   · só usa o que está registado; o que não existe aparece como «Não disponível»;
   · cada conclusão mostra o estado atribuído E o estado que as provas sustentam,
     e sinaliza quando o primeiro está acima do segundo;
   · as contagens de origens independentes usam a regra do registo de provas
     (cópias do mesmo texto contam uma vez);
   · o resumo não é prova: diz isso no topo, no pé e no JSON (`avisos`).
   ===================================================================== */
import { corroboration, suggestedState, STATE_LABEL } from './evidence.mjs';
import { renderPdf } from './pdf.mjs';

const RANK = {
  hipotese: 0, insuficiente: 1, 'fonte-inacessivel': 1, 'alegacao-atribuida': 2,
  'inferencia-suportada': 2, contraditoria: 3, refutada: 3,
  'corroborada-independente': 3, confirmada: 4
};
const label = (s) => STATE_LABEL[s] || s;
const d10 = (v) => (v ? String(v).slice(0, 10) : null);

export function buildSummary({ project, evidence, claims, relations, runs, memory, usage, agentRuns }) {
  evidence = evidence || []; claims = claims || []; relations = relations || [];
  runs = runs || []; memory = memory || []; usage = usage || []; agentRuns = agentRuns || [];
  const active = evidence.filter((e) => !e.retractedAt);
  const retracted = evidence.filter((e) => e.retractedAt);

  const conclusoes = claims.map((c) => {
    const evs = evidence.filter((e) => (c.evidenceIds || []).includes(e.id));
    const f = corroboration(evs);
    const sug = suggestedState(evs);
    return {
      id: c.id, texto: c.text, estado: c.state, estadoSugerido: sug,
      acimaDoSustentado: (RANK[c.state] || 0) > (RANK[sug] || 0),
      provas: evs.length,
      origensIndependentes: f.independentOrigins,
      favoraveis: f.favourable, contrarias: f.contrary,
      copiasSemValorIndependente: f.copiesWithoutIndependentValue,
      ultimaActualizacao: c.updatedAt || c.createdAt || null
    };
  });

  const porEstado = {};
  conclusoes.forEach((c) => { porEstado[c.estado] = (porEstado[c.estado] || 0) + 1; });

  const origens = new Set(active.map((e) => e.originKey).filter(Boolean));
  const inacessiveis = active.filter((e) => e.validationState === 'fonte-inacessivel' ||
    (e.access && e.access.status === 'inacessivel'));
  const naoVerificadas = active.filter((e) => !e.access);

  const fontes = active.map((e) => ({
    id: e.id, titulo: e.title, tipo: e.sourceType, posicao: e.stance,
    origem: e.originKey || null, url: e.canonicalUrl || null,
    dataPublicacao: d10(e.publicationDate), dataAcontecimento: d10(e.eventDate),
    estado: e.validationState, acesso: e.access ? e.access.status : 'nao-verificado',
    verificadaEm: e.access ? e.access.checkedAt : null,
    excerto: (e.excerpt || '').slice(0, 300), limitacoes: e.limitations || null
  }));

  const relacoes = relations.filter((r) => !r.retractedAt).map((r) => {
    const evs = active.filter((e) => (r.evidenceIds || []).includes(e.id));
    const f = corroboration(evs);
    return {
      id: r.id, de: r.from, para: r.to, tipo: r.type, direccao: r.direction,
      periodo: r.period || null, provas: evs.length, origensIndependentes: f.independentOrigins,
      inferida: !!r.inferred, raciocinio: r.reasoning || null
    };
  });

  const decisoes = memory.filter((n) => !n.archivedAt && n.kind === 'decisao')
    .map((n) => ({ id: n.id, titulo: n.title, motivo: n.reason, data: d10(n.createdAt) }));
  const lacunas = memory.filter((n) => !n.archivedAt && n.kind === 'lacuna')
    .map((n) => ({ id: n.id, titulo: n.title, corpo: n.body, data: d10(n.createdAt) }));

  const execucoes = runs.map((r) => ({
    id: r.id, perfil: r.profile, estado: r.status,
    passosConcluidos: (r.steps || []).filter((s) => s.status === 'concluido').length,
    passosTotais: (r.steps || []).length,
    fontesConsultadas: (r.sourcesConsulted || []).length,
    motivoDeParagem: r.stopReason || null,
    iniciadaEm: r.startedAt || null
  }));

  /* custos: separa o que foi medido do que não foi reportado — nunca estima em silêncio */
  const comCusto = usage.filter((u) => u.cost != null);
  const semCusto = usage.filter((u) => u.cost == null);
  const custos = {
    chamadas: usage.length,
    custoRegistado: comCusto.reduce((a, u) => a + Number(u.cost || 0), 0),
    moeda: 'valor reportado pelo fornecedor (sem conversão)',
    chamadasSemCustoReportado: semCusto.length,
    nota: semCusto.length ? 'há chamadas cujo custo o fornecedor não reportou: o total real é igual ou superior ao registado' : null
  };

  /* próximos passos derivados do estado real, não de uma lista decorativa */
  const proximos = [];
  if (!project.question) proximos.push('definir a pergunta de investigação');
  if (!project.referenceDate) proximos.push('fixar a data de referência');
  if (!active.length) proximos.push('registar a primeira prova');
  const acima = conclusoes.filter((c) => c.acimaDoSustentado);
  if (acima.length) proximos.push('rever ' + acima.length + ' conclusão(ões) cujo estado está acima do que as provas sustentam');
  if (naoVerificadas.length) proximos.push('verificar o acesso e a data de ' + naoVerificadas.length + ' prova(s) sem verificação registada');
  if (inacessiveis.length) proximos.push('tratar ' + inacessiveis.length + ' fonte(s) inacessível(eis): arquivar ou substituir');
  const semContra = conclusoes.filter((c) => c.contrarias === 0 && c.provas > 0);
  if (semContra.length) proximos.push('procurar contra-provas para ' + semContra.length + ' conclusão(ões) sem qualquer prova contrária');
  if (!decisoes.length) proximos.push('registar na memória as decisões de âmbito já tomadas');

  return {
    schema: 'meridiano-resumo/1',
    geradoEm: new Date().toISOString(),
    avisos: [
      'um resumo não é prova: cada afirmação aponta a prova registada que a sustenta',
      'os estados indicam o que as provas sustentam, não uma verdade absoluta',
      'o que não está registado aparece como «Não disponível» em vez de ser preenchido',
      'cópias do mesmo texto contam como uma só origem independente'
    ],
    projecto: {
      id: project.id, titulo: project.title, pergunta: project.question || null,
      objetivo: project.objective || null, estado: project.status || null,
      dataReferencia: d10(project.referenceDate), ambito: project.scope || null,
      criteriosDeConclusao: project.completionCriteria || [],
      hipoteses: project.hypotheses || [], subperguntas: project.subquestions || [],
      fontesPrioritarias: project.prioritySources || [], fontesExcluidas: project.excludedSources || []
    },
    estado: {
      conclusoes: conclusoes.length, porEstado,
      provasActivas: active.length, provasRetiradas: retracted.length,
      origensIndependentes: origens.size,
      provasNaoVerificadas: naoVerificadas.length,
      fontesInacessiveis: inacessiveis.length,
      relacoes: relacoes.length, relacoesInferidas: relacoes.filter((r) => r.inferida).length,
      execucoes: execucoes.length,
      entradasDeMemoria: memory.filter((n) => !n.archivedAt).length,
      agentesExecutados: agentRuns.filter((r) => r.status === 'concluido').length
    },
    conclusoes, fontes, relacoes, decisoes, lacunas, execucoes, custos,
    proximosPassos: proximos.length ? proximos : ['nenhuma lacuna detectada automaticamente: a revisão humana continua a ser necessária']
  };
}

/* ---------------- Markdown ---------------- */

export function summaryToMarkdown(s) {
  const L = [];
  L.push('# Resumo da investigação — ' + s.projecto.titulo);
  L.push('');
  L.push('_Gerado em ' + s.geradoEm.slice(0, 16).replace('T', ' ') + ' UTC a partir dos dados registados no serviço._');
  L.push('');
  s.avisos.forEach((a) => L.push('> ' + a));
  L.push('');
  L.push('## 1. Pergunta e âmbito');
  L.push('');
  L.push('- **Pergunta:** ' + (s.projecto.pergunta || '_Não disponível: o projecto não tem pergunta definida_'));
  L.push('- **Objectivo:** ' + (s.projecto.objetivo || '_Não disponível_'));
  L.push('- **Data de referência:** ' + (s.projecto.dataReferencia || '_Não disponível_'));
  const sc = s.projecto.ambito || {};
  L.push('- **Âmbito:** ' + [(sc.geo || null), ((sc.languages || []).join(', ') || null),
    (sc.period && (sc.period.from || sc.period.to) ? sc.period.from + ' a ' + sc.period.to : null)].filter(Boolean).join(' · ') || '_Não disponível_');
  L.push('');
  L.push('## 2. Estado em números');
  L.push('');
  L.push('| indicador | valor |');
  L.push('| --- | --- |');
  L.push('| conclusões | ' + s.estado.conclusoes + ' |');
  Object.keys(s.estado.porEstado).forEach((k) => L.push('| · ' + label(k) + ' | ' + s.estado.porEstado[k] + ' |'));
  L.push('| provas activas | ' + s.estado.provasActivas + ' |');
  L.push('| provas retiradas | ' + s.estado.provasRetiradas + ' |');
  L.push('| origens independentes | ' + s.estado.origensIndependentes + ' |');
  L.push('| provas sem verificação de acesso | ' + s.estado.provasNaoVerificadas + ' |');
  L.push('| fontes inacessíveis | ' + s.estado.fontesInacessiveis + ' |');
  L.push('| relações registadas (inferidas) | ' + s.estado.relacoes + ' (' + s.estado.relacoesInferidas + ') |');
  L.push('| execuções de pesquisa | ' + s.estado.execucoes + ' |');
  L.push('| entradas de memória | ' + s.estado.entradasDeMemoria + ' |');
  L.push('');
  L.push('## 3. Conclusões e o que as sustenta');
  L.push('');
  if (!s.conclusoes.length) L.push('_Não disponível: nenhuma conclusão registada._');
  s.conclusoes.forEach((c, i) => {
    L.push('### ' + (i + 1) + '. ' + c.texto);
    L.push('');
    L.push('- **estado atribuído:** ' + label(c.estado) + (c.acimaDoSustentado ? ' ⚠️ **acima do que as provas sustentam** (' + label(c.estadoSugerido) + ')' : ''));
    L.push('- **provas:** ' + c.provas + ' · **origens independentes:** ' + c.origensIndependentes +
      ' · favoráveis ' + c.favoraveis + ' · contrárias ' + c.contrarias +
      (c.copiasSemValorIndependente ? ' · cópias sem valor independente ' + c.copiasSemValorIndependente : ''));
    L.push('');
  });
  L.push('## 4. Provas registadas');
  L.push('');
  if (!s.fontes.length) L.push('_Não disponível: nenhuma prova registada._');
  s.fontes.forEach((f) => {
    L.push('- **' + f.titulo + '** — ' + f.tipo + ' · posição ' + f.posicao + ' · estado ' + label(f.estado) +
      ' · origem `' + (f.origem || 'sem origem') + '`' + (f.dataPublicacao ? ' · publicado ' + f.dataPublicacao : ' · sem data'));
    L.push('  - acesso: ' + f.acesso + (f.verificadaEm ? ' (verificado em ' + f.verificadaEm.slice(0, 10) + ')' : ' (nunca verificado)'));
    if (f.url) L.push('  - ' + f.url);
    if (f.excerto) L.push('  - excerto: «' + f.excerto + '»');
    if (f.limitacoes) L.push('  - limitações: ' + f.limitacoes);
  });
  L.push('');
  L.push('## 5. Relações e cronologia');
  L.push('');
  if (!s.relacoes.length) L.push('_Não disponível: nenhuma relação registada._');
  s.relacoes.forEach((r) => {
    L.push('- ' + r.de + ' → ' + r.para + ' · ' + r.tipo + (r.periodo && (r.periodo.from || r.periodo.to) ?
      ' · ' + (r.periodo.from || '?') + ' a ' + (r.periodo.to || '?') : ' · sem período') +
      ' · ' + r.provas + ' prova(s) · ' + r.origensIndependentes + ' origem(ns)' + (r.inferida ? ' · **inferida**' : ''));
    if (r.inferida && r.raciocinio) L.push('  - raciocínio declarado: ' + r.raciocinio);
  });
  L.push('');
  L.push('## 6. Decisões registadas (memória)');
  L.push('');
  if (!s.decisoes.length) L.push('_Não disponível: nenhuma decisão registada na memória do projecto._');
  s.decisoes.forEach((d) => L.push('- **' + d.titulo + '** (' + (d.data || 'sem data') + ') — ' + (d.motivo || 'sem motivo registado')));
  L.push('');
  L.push('## 7. Lacunas declaradas');
  L.push('');
  if (!s.lacunas.length) L.push('_Não disponível: nenhuma lacuna registada._');
  s.lacunas.forEach((l) => L.push('- **' + l.titulo + '** — ' + l.corpo));
  L.push('');
  L.push('## 8. Limitações');
  L.push('');
  const lims = s.fontes.filter((f) => f.limitacoes).map((f) => 'prova «' + f.titulo + '»: ' + f.limitacoes);
  if (s.estado.fontesInacessiveis) lims.push(s.estado.fontesInacessiveis + ' fonte(s) inacessível(eis) no momento da verificação');
  if (s.estado.provasNaoVerificadas) lims.push(s.estado.provasNaoVerificadas + ' prova(s) sem verificação de acesso registada');
  if (!lims.length) lims.push('não há limitações registadas — o que não é o mesmo que não haver limitações');
  lims.forEach((l) => L.push('- ' + l));
  L.push('');
  L.push('## 9. Ferramentas, modelos e custos');
  L.push('');
  if (!s.execucoes.length) L.push('_Não disponível: nenhuma execução de pesquisa registada._');
  s.execucoes.forEach((e) => L.push('- ' + e.id + ' · perfil ' + e.perfil + ' · ' + e.estado + ' · ' +
    e.passosConcluidos + '/' + e.passosTotais + ' passos · ' + e.fontesConsultadas + ' fontes' +
    (e.motivoDeParagem ? ' · parou: ' + e.motivoDeParagem : '')));
  L.push('');
  L.push('- chamadas registadas: ' + s.custos.chamadas + ' · custo reportado: ' + s.custos.custoRegistado +
    ' (' + s.custos.moeda + ')' + (s.custos.nota ? ' · ' + s.custos.nota : ''));
  L.push('');
  L.push('## 10. Próximos passos');
  L.push('');
  s.proximosPassos.forEach((p) => L.push('- ' + p));
  L.push('');
  return L.join('\n');
}

/* ---------------- CSV (Excel pt-PT: «;» + BOM) ---------------- */

const csvCell = (v) => {
  const s = String(v == null ? '' : v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function summaryToCsv(s) {
  const rows = [['seccao', 'item', 'valor', 'estado', 'origem', 'data']];
  rows.push(['projecto', 'titulo', s.projecto.titulo, '', '', '']);
  rows.push(['projecto', 'pergunta', s.projecto.pergunta || 'Não disponível', '', '', '']);
  rows.push(['projecto', 'data de referência', s.projecto.dataReferencia || 'Não disponível', '', '', '']);
  Object.keys(s.estado.porEstado).forEach((k) => rows.push(['estado', 'conclusões: ' + label(k), s.estado.porEstado[k], k, '', '']));
  rows.push(['estado', 'provas activas', s.estado.provasActivas, '', '', '']);
  rows.push(['estado', 'origens independentes', s.estado.origensIndependentes, '', '', '']);
  rows.push(['estado', 'fontes inacessíveis', s.estado.fontesInacessiveis, '', '', '']);
  s.conclusoes.forEach((c) => rows.push(['conclusão', c.texto, 'provas: ' + c.provas + ' · origens: ' + c.origensIndependentes,
    c.estado + (c.acimaDoSustentado ? ' (acima do sustentado: ' + c.estadoSugerido + ')' : ''), '', '']));
  s.fontes.forEach((f) => rows.push(['prova', f.titulo, f.excerto, f.estado + ' / acesso: ' + f.acesso, f.origem || '', f.dataPublicacao || '']));
  s.relacoes.forEach((r) => rows.push(['relação', r.de + ' → ' + r.para, r.tipo + (r.inferida ? ' (inferida)' : ''),
    r.provas + ' prova(s)', '', (r.periodo && (r.periodo.from || r.periodo.to)) ? (r.periodo.from || '?') + ' a ' + (r.periodo.to || '?') : '']));
  s.decisoes.forEach((d) => rows.push(['decisão', d.titulo, d.motivo || '', '', '', d.data || '']));
  s.lacunas.forEach((l) => rows.push(['lacuna', l.titulo, l.corpo, '', '', l.data || '']));
  s.proximosPassos.forEach((p) => rows.push(['próximo passo', p, '', '', '', '']));
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

/* ---------------- PDF (blocos para o escritor mínimo) ---------------- */

export function summaryToBlocks(s) {
  const b = [];
  b.push({ type: 'p', text: s.projecto.pergunta ? 'Pergunta: ' + s.projecto.pergunta : 'Pergunta: Não disponível' });
  b.push({ type: 'small', text: 'Gerado em ' + s.geradoEm.slice(0, 16).replace('T', ' ') + ' UTC · dados do próprio projecto · ' +
    s.avisos.length + ' avisos de leitura (ver primeira secção)' });
  b.push({ type: 'spacer', size: 4 });
  b.push({ type: 'h2', text: 'Estado em números' });
  b.push({ type: 'kv', label: 'Conclusões', text: String(s.estado.conclusoes) + ' · ' +
    Object.keys(s.estado.porEstado).map((k) => label(k) + ': ' + s.estado.porEstado[k]).join(' · ') || '0' });
  b.push({ type: 'kv', label: 'Provas', text: s.estado.provasActivas + ' activas · ' + s.estado.provasRetiradas + ' retiradas · ' +
    s.estado.origensIndependentes + ' origens independentes · ' + s.estado.provasNaoVerificadas + ' sem verificação' });
  b.push({ type: 'kv', label: 'Fontes inacessíveis', text: String(s.estado.fontesInacessiveis) });
  b.push({ type: 'kv', label: 'Relações', text: s.estado.relacoes + ' (' + s.estado.relacoesInferidas + ' inferidas)' });
  b.push({ type: 'kv', label: 'Execuções', text: String(s.estado.execucoes) });
  b.push({ type: 'kv', label: 'Memória', text: s.estado.entradasDeMemoria + ' entradas' });

  b.push({ type: 'h2', text: 'Conclusões e o que as sustenta' });
  if (!s.conclusoes.length) b.push({ type: 'p', text: 'Não disponível: nenhuma conclusão registada.' });
  s.conclusoes.forEach((c, i) => {
    b.push({ type: 'p', text: (i + 1) + '. ' + c.texto });
    b.push({ type: 'small', text: 'estado: ' + label(c.estado) + (c.acimaDoSustentado ? ' (ACIMA do sustentado: ' + label(c.estadoSugerido) + ')' : '') +
      ' · provas: ' + c.provas + ' · origens independentes: ' + c.origensIndependentes + ' · contrárias: ' + c.contrarias });
    b.push({ type: 'spacer', size: 3 });
  });

  b.push({ type: 'h2', text: 'Provas registadas' });
  if (!s.fontes.length) b.push({ type: 'p', text: 'Não disponível: nenhuma prova registada.' });
  s.fontes.forEach((f) => {
    b.push({ type: 'li', text: f.titulo + ' — ' + f.tipo + ' · ' + label(f.estado) + ' · acesso: ' + f.acesso +
      (f.dataPublicacao ? ' · ' + f.dataPublicacao : ' · sem data') });
    if (f.url) b.push({ type: 'small', text: '    ' + f.url });
  });

  b.push({ type: 'h2', text: 'Relações registadas' });
  if (!s.relacoes.length) b.push({ type: 'p', text: 'Não disponível: nenhuma relação registada.' });
  s.relacoes.forEach((r) => b.push({ type: 'li', text: r.de + ' -> ' + r.para + ' · ' + r.tipo +
    (r.inferida ? ' (inferida)' : '') + ' · ' + r.provas + ' prova(s) · ' + r.origensIndependentes + ' origem(ns)' }));

  b.push({ type: 'h2', text: 'Decisões e lacunas (memória)' });
  if (!s.decisoes.length && !s.lacunas.length) b.push({ type: 'p', text: 'Não disponível: memória do projecto vazia.' });
  s.decisoes.forEach((d) => b.push({ type: 'li', text: 'decisão: ' + d.titulo + ' — ' + (d.motivo || 'sem motivo') }));
  s.lacunas.forEach((l) => b.push({ type: 'li', text: 'lacuna: ' + l.titulo + ' — ' + l.corpo }));

  b.push({ type: 'h2', text: 'Custos e ferramentas' });
  s.execucoes.forEach((e) => b.push({ type: 'li', text: e.id + ' · ' + e.perfil + ' · ' + e.estado + ' · ' +
    e.passosConcluidos + '/' + e.passosTotais + ' passos' + (e.motivoDeParagem ? ' · parou: ' + e.motivoDeParagem : '') }));
  b.push({ type: 'small', text: 'chamadas: ' + s.custos.chamadas + ' · custo reportado: ' + s.custos.custoRegistado +
    (s.custos.nota ? ' · ' + s.custos.nota : '') });

  b.push({ type: 'h2', text: 'Próximos passos' });
  s.proximosPassos.forEach((p) => b.push({ type: 'li', text: p }));

  b.push({ type: 'h2', text: 'Avisos de leitura' });
  s.avisos.forEach((a) => b.push({ type: 'li', text: a }));
  return b;
}

export function summaryToPdf(s) {
  return renderPdf({
    title: 'Resumo da investigação',
    subtitle: (s.projecto.titulo || '') + ' · ' + s.geradoEm.slice(0, 10),
    blocks: summaryToBlocks(s)
  });
}

export function summaryFilename(project, ext) {
  const base = 'meridiano-resumo-' + String(project.id).replace(/[^a-zA-Z0-9-_]/g, '');
  return base + '.' + ext;
}
