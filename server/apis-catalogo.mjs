/* =====================================================================
   CATÁLOGO DE APIs SEM CHAVE — máquina de estados com prova (FASE E1/E2)

   O problema que isto resolve: até aqui o catálogo era um relatório de sonda
   (`docs/APIS-sem-chave.json`) com veredictos derivados, sem estado explícito
   por API, sem histórico e sem forma de dizer «esta entrou em uso». Um endpoint
   que responde 200 no catálogo de modelos não é uma API utilizável, e um
   relatório guardado não é uma decisão tomada.

   Regras (todas verificáveis por `validateTransition`):
   · seis estados fechados: descoberto → em-analise → validado → em-uso
     → degradado → descontinuado;
   · cada transição tem data, autor, motivo e, quando aplicável, PROVA;
   · `validado` exige uma prova de geração com pedido, resposta e latência —
     uma lista de modelos pública não valida nada;
   · `em-uso` exige estar validado, a prova de geração existente e uma
     CONFIRMAÇÃO explícita: validar não põe nada em uso;
   · `degradado` exige motivo e observação de falha; `descontinuado` exige motivo;
   · tudo é reversível: o histórico guarda cada passo e a reversão é uma
     transição como as outras, não um apagamento.
   ===================================================================== */

export const CATALOG_VERSION = 'c1';

/* Os seis estados, com o significado em português e o que os distingue. */
export const API_STATES = [
  { id: 'descoberto', ordem: 1, label: 'descoberto', meaning: 'apareceu numa sonda ou foi indicada por alguém; nada foi provado' },
  { id: 'em-analise', ordem: 2, label: 'em análise', meaning: 'foi sondada e há resultados brutos; ainda não há validação feita na aplicação' },
  { id: 'validado', ordem: 3, label: 'validado', meaning: 'existe prova de geração registada (pedido, resposta, latência) feita na aplicação' },
  { id: 'em-uso', ordem: 4, label: 'em uso', meaning: 'validado E confirmado por uma pessoa como fornecedor que a aplicação pode usar' },
  { id: 'degradado', ordem: 5, label: 'degradado', meaning: 'já foi validado mas falhou depois; pode voltar a em-uso se nova prova o sustentar' },
  { id: 'descontinuado', ordem: 6, label: 'descontinuado', meaning: 'deixou de ser considerado; só volta por análise explícita' }
];
export const STATE_IDS = API_STATES.map((s) => s.id);
export const stateById = (id) => API_STATES.find((s) => s.id === id) || null;

/* Transições permitidas. A lista é fechada: o que não está aqui é recusado,
   mesmo que pareça razoável. `descontinuado` só volta para `em-analise` — um
   fornecedor descontinuado nunca salta para `em-uso`. */
export const TRANSITIONS = {
  'descoberto': ['em-analise', 'descontinuado'],
  'em-analise': ['validado', 'descoberto', 'descontinuado'],
  'validado': ['em-uso', 'em-analise', 'degradado', 'descontinuado'],
  'em-uso': ['degradado', 'validado', 'descontinuado'],
  'degradado': ['em-uso', 'em-analise', 'descontinuado'],
  'descontinuado': ['em-analise']
};

/* O que cada transição exige. Diz-se aqui, num sítio só, e o teste lê daqui. */
export const TRANSITION_RULES = {
  'em-analise': { exige: ['motivo'], prova: null },
  'validado': { exige: ['motivo', 'prova'], prova: 'geracao' },
  'em-uso': { exige: ['motivo', 'confirmacao'], prova: 'geracao' },
  'degradado': { exige: ['motivo', 'falha'], prova: null },
  'descontinuado': { exige: ['motivo'], prova: null },
  'descoberto': { exige: ['motivo'], prova: null }
};

const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 300);

/* Uma prova de geração tem de ter tudo o que se afirma: pedido, resposta,
   latência e data. Sem qualquer destes campos não é prova, é impressão. */
export function validateProof(p) {
  const erros = [];
  if (!p || typeof p !== 'object') return { ok: false, erros: ['prova ausente'] };
  if (p.tipo !== 'geracao') erros.push('tipo de prova tem de ser «geracao»');
  if (!p.em || isNaN(Date.parse(p.em))) erros.push('prova sem data válida');
  if (!p.pedido || typeof p.pedido !== 'object') erros.push('prova sem pedido');
  else {
    if (!p.pedido.metodo) erros.push('pedido sem método');
    if (!p.pedido.url) erros.push('pedido sem URL');
    if (!/^https:\/\//.test(String(p.pedido.url))) erros.push('pedido tem de ser https');
    if (p.pedido.maxTokens == null) erros.push('pedido sem tecto de tokens (maxTokens)');
  }
  if (!p.resposta || typeof p.resposta !== 'object') erros.push('prova sem resposta');
  else {
    if (p.resposta.status == null) erros.push('resposta sem código HTTP');
    if (!p.resposta.excerto && !p.resposta.hash) erros.push('resposta sem excerto nem hash');
  }
  if (!Number.isInteger(p.latenciaMs) || p.latenciaMs < 0) erros.push('prova sem latência medida (ms)');
  if (p.ok !== true) erros.push('a prova não confirma geração (ok tem de ser true)');
  return { ok: erros.length === 0, erros };
}

/* Uma validação feita na aplicação produz esta prova, a partir do resultado
   real da sonda. `origem` distingue a sonda real de um ensaio com sonda
   substituída: nunca se apresenta um ensaio como medição de produção. */
export function proofFromProbe(probe, extra) {
  const o = extra || {};
  const p = probe || {};
  const base = String(p.base || '').replace(/\/+$/, '');
  return {
    tipo: 'geracao',
    em: p.at || new Date().toISOString(),
    origem: o.origem || 'sonda',
    ok: p.verdict === 'gera-sem-chave',
    pedido: { metodo: 'POST', url: base + '/chat/completions', modelo: p.model || null, maxTokens: 1, autorizacao: 'nenhuma' },
    resposta: {
      status: p.status == null ? null : p.status,
      excerto: p.excerpt ? String(p.excerpt).slice(0, 300) : null,
      porque: p.porque ? String(p.porque).slice(0, 200) : null
    },
    latenciaMs: Number.isInteger(p.ms) ? p.ms : null,
    por: o.por || null
  };
}

const novaEntrada = (base, extra) => Object.assign({
  id: base.id, nome: extra && extra.nome ? texto(extra.nome, 120) : base.id,
  base: base.base || null,
  estado: 'descoberto',
  historico: [], provas: [],
  criadoEm: new Date().toISOString(), actualizadoEm: new Date().toISOString()
}, extra && extra.campos ? extra.campos : {});

/* Importa um relatório de sonda: nada entra em `validado` nem em `em-uso` só
   por ter sido sondado. Se a sonda trouxe uma geração real, fica registada
   como prova EXTERNA e a entrada vai a `em-analise` — falta a validação feita
   na aplicação, que é a operação de primeira classe da fase E2. */
export function fromScan(report, opts) {
  const o = opts || {};
  const em = o.em || new Date().toISOString();
  const por = o.por || null;
  const out = [];
  const resultados = (report && Array.isArray(report.resultados)) ? report.resultados : [];
  const geracao = (report && report.geracao && Array.isArray(report.geracao.resultados)) ? report.geracao.resultados : [];
  const porId = new Map(geracao.map((g) => [g.id, g]));
  resultados.forEach((r) => {
    const e = novaEntrada(r);
    const g = porId.get(r.id);
    if (g) {
      const prova = proofFromProbe(g, { origem: 'varrimento-externo', por });
      e.provas.push(prova);
      if (prova.ok) {
        e.estado = 'em-analise';
        e.historico.push({ de: 'descoberto', para: 'em-analise', em, por,
          motivo: 'prova de geração do varrimento externo; falta a validação feita na aplicação', provaEm: prova.em });
      }
    }
    out.push(e);
  });
  return out;
}

/* Junta o que já existe (com histórico) com o que a sonda trouxe: entradas
   existentes mantêm estado e histórico; só se acrescentam as novas. */
export function mergeScan(existentes, report, opts) {
  const actuais = Array.isArray(existentes) ? existentes.slice() : [];
  const porId = new Map(actuais.map((e) => [e.id, e]));
  let novas = 0; let actualizadas = 0;
  fromScan(report, opts).forEach((e) => {
    const tinha = porId.get(e.id);
    if (!tinha) { actuais.push(e); porId.set(e.id, e); novas++; return; }
    /* a entrada existente ganha as provas externas que ainda não tinha, mas o
       estado decidido por uma pessoa NÃO é reescrito por uma sonda */
    const chaves = new Set((tinha.provas || []).map((p) => (p.em || '') + '|' + (p.origem || '')));
    let mexeu = false;
    e.provas.forEach((p) => {
      const k = (p.em || '') + '|' + (p.origem || '');
      if (!chaves.has(k)) { tinha.provas = (tinha.provas || []).concat([p]); chaves.add(k); mexeu = true; }
    });
    if (mexeu) { tinha.actualizadoEm = new Date().toISOString(); actualizadas++; }
  });
  return { entradas: actuais, novas, actualizadas };
}

/* ---------------- a transição ---------------- */

export function validateTransition(entrada, para, ctx) {
  const erros = [];
  if (!entrada || typeof entrada !== 'object') return { ok: false, erros: ['entrada ausente'] };
  const de = entrada.estado || 'descoberto';
  if (!stateById(de)) erros.push('estado actual desconhecido: ' + de);
  if (!stateById(para)) return { ok: false, erros: ['estado de destino desconhecido: ' + para] };
  const permitidas = TRANSITIONS[de] || [];
  if (!permitidas.includes(para)) {
    return { ok: false, erros: ['transição não permitida: ' + de + ' → ' + para +
      ' (permitidas: ' + (permitidas.length ? permitidas.join(', ') : 'nenhuma') + ')'] };
  }
  const regra = TRANSITION_RULES[para] || { exige: ['motivo'], prova: null };
  const c = ctx || {};
  if (regra.exige.includes('motivo') && !texto(c.motivo)) erros.push('a transição exige um motivo escrito');
  if (regra.exige.includes('confirmacao') && c.confirmar !== true) {
    erros.push('entrar em uso exige confirmação explícita (confirmar: true): validar não põe nada em uso');
  }
  if (regra.exige.includes('falha')) {
    if (!c.falha || !texto(c.falha.motivo)) erros.push('degradar exige a falha observada (falha.motivo)');
    else if (!c.falha.em || isNaN(Date.parse(c.falha.em))) erros.push('a falha observada precisa de data');
  }
  if (regra.prova === 'geracao') {
    const p = c.prova || (regra.exige.includes('confirmacao')
      ? (entrada.provas || []).slice().reverse().find((x) => x.tipo === 'geracao' && x.ok === true)
      : null);
    if (!p) erros.push('esta transição exige uma prova de geração');
    else {
      const v = validateProof(p);
      if (!v.ok) v.erros.forEach((e) => erros.push('prova inválida: ' + e));
    }
  }
  /* uma entrada em uso tem de dizer para que passo serve: «em uso» sem uso é
     uma etiqueta, não um estado */
  if (para === 'em-uso' && !texto(c.usaEm, 200)) erros.push('entrar em uso exige dizer em que passo é usada (usaEm)');
  return { ok: erros.length === 0, erros };
}

export function applyTransition(entrada, para, ctx) {
  const c = ctx || {};
  const v = validateTransition(entrada, para, c);
  if (!v.ok) return { ok: false, erros: v.erros, entrada };
  const em = c.em || new Date().toISOString();
  const de = entrada.estado || 'descoberto';
  const prova = c.prova || (para === 'em-uso'
    ? (entrada.provas || []).slice().reverse().find((x) => x.tipo === 'geracao' && x.ok === true) || null
    : null);
  const passo = {
    de, para, em, por: c.por || null, motivo: texto(c.motivo),
    confirmacao: c.confirmar === true ? true : undefined,
    usaEm: texto(c.usaEm, 200) || undefined,
    falha: c.falha ? { motivo: texto(c.falha.motivo), em: c.falha.em } : undefined,
    provaEm: prova ? prova.em : undefined
  };
  Object.keys(passo).forEach((k) => { if (passo[k] === undefined) delete passo[k]; });
  const nova = Object.assign({}, entrada, {
    estado: para, actualizadoEm: em,
    historico: (entrada.historico || []).concat([passo]),
    provas: prova && !(entrada.provas || []).some((p) => p.em === prova.em && p.tipo === prova.tipo)
      ? (entrada.provas || []).concat([prova]) : (entrada.provas || []).slice()
  });
  return { ok: true, entrada: nova, passo };
}

/* Reverter = aplicar a transição inversa à última que entrou, com motivo
   próprio. Não se apaga histórico: acrescenta-se o passo de volta. Se o estado
   anterior não for alcançável pelas regras, diz-se — não se força. */
export function revertLast(entrada, ctx) {
  const c = ctx || {};
  const hist = (entrada && entrada.historico) || [];
  const ultimo = hist[hist.length - 1];
  if (!ultimo) return { ok: false, erros: ['não há transição para reverter: a entrada ainda está no estado inicial'] };
  const para = ultimo.de;
  const motivo = texto(c.motivo) || 'reversão de «' + ultimo.para + '» para «' + para + '»';
  /* Voltar a «validado» continua a exigir prova de geração — e a prova é a que
     já está registada na entrada. Não se inventa nem se dispensa a regra. */
  const provaExistente = para === 'validado'
    ? (entrada.provas || []).slice().reverse().find((x) => x.tipo === 'geracao' && x.ok === true) || null
    : null;
  const r = applyTransition(entrada, para, Object.assign({}, c, { motivo, confirmar: false, prova: provaExistente }));
  if (!r.ok) return { ok: false, erros: r.erros, entrada };
  return { ok: true, entrada: r.entrada, passo: r.passo, revertido: { de: ultimo.para, para } };
}

export function summary(entradas) {
  const lista = Array.isArray(entradas) ? entradas : [];
  const porEstado = {};
  STATE_IDS.forEach((s) => { porEstado[s] = 0; });
  lista.forEach((e) => { porEstado[e.estado] = (porEstado[e.estado] || 0) + 1; });
  return {
    total: lista.length, porEstado,
    validados: lista.filter((e) => e.estado === 'validado' || e.estado === 'em-uso').length,
    emUso: lista.filter((e) => e.estado === 'em-uso').length,
    comProvaDeGeracao: lista.filter((e) => (e.provas || []).some((p) => p.tipo === 'geracao' && p.ok === true)).length
  };
}

/* O que a interface mostra: estado, datas, últimas provas e o último passo do
   histórico. Nada de campos internos que ninguém saberia interpretar. */
export function toPublic(e, opts) {
  const o = opts || {};
  const maxProvas = o.maxProvas == null ? 3 : o.maxProvas;
  return {
    id: e.id, nome: e.nome, base: e.base, estado: e.estado,
    estadoLabel: (stateById(e.estado) || {}).label || e.estado,
    significado: (stateById(e.estado) || {}).meaning || null,
    actualizadoEm: e.actualizadoEm || null,
    provas: (e.provas || []).slice(-maxProvas).map((p) => ({
      tipo: p.tipo, em: p.em, origem: p.origem || null, ok: !!p.ok,
      status: p.resposta ? p.resposta.status : null, latenciaMs: p.latenciaMs == null ? null : p.latenciaMs,
      pedido: p.pedido ? p.pedido.url : null, excerto: p.resposta ? p.resposta.excerto : null
    })),
    ultimoPasso: (e.historico || []).length ? e.historico[e.historico.length - 1] : null,
    passos: (e.historico || []).length
  };
}
