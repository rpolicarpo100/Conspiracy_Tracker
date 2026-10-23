/* =====================================================================
   Regras de evidência e de estado das conclusões — funções puras.

   Princípio central: uma conclusão NUNCA sobe de estado por si. Cada estado
   tem requisitos verificáveis no servidor; se não estiverem satisfeitos, o
   pedido é recusado com as razões. Dez cópias de um comunicado não são dez
   confirmações: a corroboração conta ORIGENS INDEPENDENTES, não ficheiros.
   ===================================================================== */
import crypto from 'node:crypto';
import { ENTITY_TYPES } from './graph.mjs';

/* ============================ TAXONOMIA ÚNICA ============================

   Os nove estados de uma AFIRMAÇÃO (conclusão/alegação), definidos uma só vez
   aqui e usados pelo servidor, pela interface, pelo grafo e pelos relatórios.
   A lista é fechada: o que não está nela é recusado, não reinterpretado.

   O estado diz que TIPO de conhecimento é a afirmação. A FORÇA do apoio não se
   esconde no nome do estado — está nos factores (`corroboration`): origens
   independentes, provas primárias, cópias redundantes, contraprovas. Foi por
   isso que «confirmada» e «corroborada-independente» desapareceram: eram nomes
   a fingir de contador. */
export const STATES = [
  'facto-documentado',       // documento (de preferência primário) sustenta a afirmação; sem contradição activa
  'alegacao-atribuida',      // alguém afirmou; o que está documentado é a atribuição, não o conteúdo
  'inferencia',              // dedução nossa a partir de provas, declarada como inferência
  'hipotese',                // colocada para teste; pode não ter prova nenhuma
  'contraditoria',           // há provas a favor e contra, activas
  'refutada',                // prova contrária primária/documental, explícita
  'nao-verificada',          // não foi possível verificar: não há prova utilizável OU nunca se procurou
  'insuficiente',            // há provas, mas abaixo do limiar para o estado pretendido
  'desactualizada'           // foi documentada, mas a validade caducou ou foi superada
];

/* Estados de uma FONTE (prova/documento). Não são estados de afirmação: uma
   fonte inacessível não torna a afirmação «inacessível» — torna-a não verificada. */
export const SOURCE_VALIDATION_STATES = ['acessivel', 'fonte-inacessivel', 'retirada'];

/* Migração dos nomes antigos. Cada valor antigo passa a UM valor novo, com o
   motivo escrito. Aplicada uma vez pela migração v8 da base; fica aqui para a
   leitura de dados antigos e para o relatório poder dizer de onde veio. */
export const STATE_MIGRATION = {
  'confirmada': { para: 'facto-documentado', motivo: 'o nome antigo confundia tipo com força: a força passou a ser os factores (origens independentes, provas primárias)' },
  'corroborada-independente': { para: 'facto-documentado', motivo: 'duas origens independentes passaram a ser um factor medido, não um estado' },
  'inferencia-suportada': { para: 'inferencia', motivo: 'o suporte é um factor; o tipo é «inferência»' },
  'alegacao-atribuida': { para: 'alegacao-atribuida', motivo: 'mantém-se' },
  'hipotese': { para: 'hipotese', motivo: 'mantém-se' },
  'contraditoria': { para: 'contraditoria', motivo: 'mantém-se' },
  'refutada': { para: 'refutada', motivo: 'mantém-se' },
  'insuficiente': { para: 'insuficiente', motivo: 'mantém-se' },
  'fonte-inacessivel': { para: 'nao-verificada', motivo: '«fonte inacessível» é estado da FONTE; a afirmação fica não verificada' }
};

/** Converte um estado antigo para a taxonomia actual. Devolve {state, migradoDe, motivo}. */
export function migrateState(state) {
  const m = STATE_MIGRATION[state];
  if (!m) return { state, migradoDe: null, motivo: null };
  return { state: m.para, migradoDe: state === m.para ? null : state, motivo: m.motivo };
}

export const STATE_LABEL = {
  'facto-documentado': 'facto documentado',
  'alegacao-atribuida': 'alegação atribuída',
  'inferencia': 'inferência',
  'hipotese': 'hipótese',
  'contraditoria': 'contraditória',
  'refutada': 'refutada',
  'nao-verificada': 'não verificada',
  'insuficiente': 'informação insuficiente',
  'desactualizada': 'desactualizada',
  /* rótulos de leitura para dados antigos que ainda apareçam por migrar */
  'confirmada': 'confirmada (nome antigo)',
  'corroborada-independente': 'corroborada independente (nome antigo)',
  'inferencia-suportada': 'inferência suportada (nome antigo)',
  'fonte-inacessivel': 'fonte inacessível (estado de fonte)'
};

/* Estados que podem ser dados a uma PROVA (inclui os de fonte, porque a prova
   é um documento e um documento pode estar inacessível ou retirado). */
export const EVIDENCE_STATES = STATES.concat(SOURCE_VALIDATION_STATES.filter((x) => x !== 'acessivel'));

export const SOURCE_TYPES = ['primaria', 'secundaria', 'reproducao', 'comunicado', 'base-de-dados', 'documento-oficial'];
export const STANCES = ['favoravel', 'contraria', 'neutra'];
export const EXTRACTION = ['manual', 'http', 'pdf', 'api', 'ocr'];

/* Uma entidade pode vir como texto ou como objecto. Sem desambiguador, não há
   fusão de homónimos — o tipo é validado contra a lista fechada do grafo. */
export function normaliseEntity(x) {
  if (x == null) return null;
  const obj = typeof x === 'string' ? { name: x } : (typeof x === 'object' ? x : null);
  if (!obj) return null;
  const name = norm(obj.name).slice(0, 160);
  if (!name) return null;
  const type = ENTITY_TYPES[obj.type] ? obj.type : 'unknown';
  const out = { name, type };
  if (obj.disambiguator) out.disambiguator = norm(obj.disambiguator).slice(0, 160);
  if (obj.alias) out.alias = norm(obj.alias).slice(0, 160);
  return out;
}
export const entityName = (x) => (typeof x === 'string' ? x : (x && x.name) || '');

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/* URL canónica: sem fragmento, sem parâmetros de campanha, host minúsculo,
   sem barra final e sem 'www.'. Não inventa o que não está lá. */
export function canonicalUrl(raw) {
  const s = norm(raw);
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch { return s; }
  const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
  drop.forEach((k) => u.searchParams.delete(k));
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.protocol = u.protocol.toLowerCase();
  let out = u.toString();
  if (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

/* Impressão digital do excerto: o que se compara ao detectar duplicados. */
export function contentHash(excerpt) {
  const n = norm(excerpt).toLowerCase();
  return crypto.createHash('sha256').update(n, 'utf8').digest('hex');
}

/* Chave de ORIGEM — a regra que impede contar cópias como confirmações.

   Segue a sindicação até à peça original e agrupa pelo DOMÍNIO dessa origem
   final. Consequências, todas conservadoras:
   · uma cópia que declara syndicationOf cai na origem da peça original;
   · dois artigos da mesma redacção contam como UMA origem (mesma fonte de
     informação, ainda que documentos diferentes);
   · sem URL, cai no hash do próprio conteúdo. */
export function originKey(ev) {
  if (!ev) return null;
  const finalUrl = canonicalUrl(ev.syndicationOf || ev.canonicalUrl || ev.originalUrl);
  const h = hostOf(finalUrl);
  if (h) return 'src:' + h;
  return 'hash:' + (ev.contentHash || contentHash(ev.excerpt));
}

/* Duplicado exacto: mesmo conteúdo OU o mesmo URL canónico com o mesmo excerto. */
export function dedupeKey(ev) {
  return (ev.contentHash || contentHash(ev.excerpt)) + '|' + canonicalUrl(ev.canonicalUrl || ev.originalUrl);
}

const usable = (ev) => !ev.retractedAt && ev.validationState !== 'fonte-inacessivel';

/* C2 — ORIGENS INDEPENDENTES, a sério.

   Duas regras, ambas conservadoras:
   1. síndicação (syndicationOf) leva ao host da peça original — já existia;
   2. textos IDÊNTICOS em domínios diferentes são a MESMA peça reproduzida: o
      hash do excerto funde-os numa só origem. Sem isto, o mesmo comunicado
      copiado em cinco jornais contava cinco vezes.
   O resultado nunca é mais generoso do que a realidade: só pode ser menor. */
function originsOf(list) {
  const porHash = new Map();          // contentHash → chave de origem canónica
  const grupos = new Map();           // chave final → { chave, provas, hosts, via }
  list.forEach((ev) => {
    const base = originKey(ev);
    const h = ev.contentHash || contentHash(ev.excerpt);
    const chave = porHash.get(h) || base;
    if (!porHash.has(h)) porHash.set(h, chave);
    const g = grupos.get(chave) || { chave, provas: [], hosts: [], via: {} };
    g.provas.push(ev);
    const host = hostOf(ev.syndicationOf || ev.canonicalUrl || ev.originalUrl);
    if (host && !g.hosts.includes(host)) g.hosts.push(host);
    g.via[chave === base ? 'origem' : 'texto-identico'] = (g.via[chave === base ? 'origem' : 'texto-identico'] || 0) + 1;
    grupos.set(chave, g);
  });
  return grupos;
}

/* Factores de uma conclusão, calculados a partir das provas ligadas a ela. */
export function corroboration(evidence) {
  const list = (evidence || []).filter(usable);
  const grupos = originsOf(list);
  const origins = new Set(grupos.keys());
  const fav = list.filter((e) => e.stance === 'favoravel');
  const con = list.filter((e) => e.stance === 'contraria');
  const favOrigins = new Set(fav.map(originKey));
  const conOrigins = new Set(con.map(originKey));
  const primary = fav.filter((e) => e.sourceType === 'primaria' || e.sourceType === 'documento-oficial');
  /* cópias do mesmo texto: úteis para verificar a redacção, inúteis como confirmação */
  const gruposFav = originsOf(fav);
  const gruposCon = originsOf(con);
  return {
    total: list.length,
    retractedOrInaccessible: (evidence || []).length - list.length,
    favourable: fav.length,
    contrary: con.length,
    origins: [...origins],
    independentOrigins: origins.size,
    favourableOrigins: gruposFav.size,
    contraryOrigins: gruposCon.size,
    primaryFavourable: primary.length,
    copiesWithoutIndependentValue: fav.length - gruposFav.size,
    /* detalhe auditável: que provas ficaram agrupadas na mesma origem e porquê */
    originGroups: [...grupos.values()].map((g) => ({
      origem: g.chave, provas: g.provas.map((p) => p.id), hosts: g.hosts, via: g.via
    }))
  };
}

/* ============================ C3 — PROVENIÊNCIA ============================

   Uma afirmação só é publicável se cada prova que a sustenta tiver o rasto
   completo: excerto literal, localização no documento, hash do documento (ou da
   prova) e a data da recolha. O que falta é listado — nunca preenchido. */
export function provenanceOf(claim, evidenceById) {
  const ids = (claim && claim.evidenceIds) || [];
  const itens = ids.map((id) => {
    const ev = evidenceById instanceof Map ? evidenceById.get(id) : (evidenceById || {})[id];
    if (!ev) return { evidenceId: id, estado: 'em-falta', faltas: ['prova não encontrada'], completo: false };
    const faltas = [];
    if (!ev.excerpt) faltas.push('excerto');
    if (!ev.location) faltas.push('localização (página/parágrafo/ficheiro)');
    if (!ev.contentHash) faltas.push('hash do excerto');
    if (!ev.documentId && !ev.canonicalUrl && !ev.originalUrl && !ev.archiveUrl) faltas.push('documento ou URL');
    if (!ev.collectionDate) faltas.push('data de recolha');
    if (ev.retractedAt) faltas.push('prova retirada: ' + (ev.retractedAt || ''));
    return {
      evidenceId: ev.id, titulo: ev.title, excerto: ev.excerpt, localizacao: ev.location || null,
      documentoId: ev.documentId || null, url: ev.canonicalUrl || ev.originalUrl || null,
      hash: ev.contentHash || null, recolhidoEm: ev.collectionDate || null,
      tipo: ev.sourceType, postura: ev.stance, estado: ev.validationState,
      completo: faltas.length === 0, faltas
    };
  });
  return {
    itens,
    total: itens.length,
    completos: itens.filter((i) => i.completo).length,
    completa: itens.length > 0 && itens.every((i) => i.completo),
    faltas: itens.flatMap((i) => i.faltas.map((f) => (i.titulo || i.evidenceId) + ': ' + f))
  };
}

/* ========================= C5 — DESACTUALIZAÇÃO =========================

   Caducidade dita, não adivinhada: `validityUntil` (fim de validade declarado),
   `supersededBy` (documento que substitui) ou uma data de referência do
   projecto que já passou. Sem marcador explícito, nada é «desactualizado». */
export function isStale(claim, evidence, now) {
  const t = now ? new Date(now).getTime() : Date.now();
  const marcas = [];
  if (claim && claim.supersededBy) marcas.push('substituída por ' + claim.supersededBy);
  if (claim && claim.validityUntil) {
    const v = new Date(claim.validityUntil).getTime();
    if (!isNaN(v) && v < t) marcas.push('validade terminou em ' + claim.validityUntil);
  }
  const lista = (evidence || []).filter(usable);
  if (lista.length && lista.every((e) => {
    const v = e.validityUntil ? new Date(e.validityUntil).getTime() : null;
    return v != null && !isNaN(v) && v < t;
  })) marcas.push('todas as provas caducaram');
  return { stale: marcas.length > 0, marcas };
}

/* ==================== C4 — CONTRAPROVA OBRIGATÓRIA ======================

   Antes de declarar um facto documentado, tem de existir registo de procura
   activa de contraprova: quando, com que método, com que resultado. «Não
   encontrei nada» é um resultado válido e tem de ficar escrito. */
export function contraprovaRegistada(claim) {
  const c = claim && claim.contraprova;
  if (!c) return { ok: false, motivo: 'não há registo de procura de contraprova' };
  if (!c.procuradaEm) return { ok: false, motivo: 'a procura de contraprova não tem data' };
  if (!c.metodo) return { ok: false, motivo: 'a procura de contraprova não declara o método' };
  if (!['encontrada', 'nao-encontrada'].includes(c.resultado)) {
    return { ok: false, motivo: 'resultado da contraprova tem de ser «encontrada» ou «nao-encontrada»' };
  }
  if (c.resultado === 'encontrada' && !(c.evidenceIds || []).length) {
    return { ok: false, motivo: 'diz ter encontrado contraprova mas não indica a prova' };
  }
  return { ok: true, motivo: null };
}

/* Requisitos de cada estado. Devolve {ok, reasons[], factors, pendencias}.

   `ctx` aceita { claim, now } — é o que permite verificar contraprova (C4) e
   caducidade (C5) sem inventar dados que não existam. */
export function evaluate(state, evidence, ctx) {
  const claim = (ctx && ctx.claim) || null;
  const now = ctx && ctx.now;
  const f = corroboration(evidence);
  const reasons = [];
  const pendencias = [];
  let ok = true;
  const need = (cond, msg) => { if (!cond) { ok = false; reasons.push(msg); } };
  const stale = isStale(claim, evidence, now);

  switch (state) {
    case 'facto-documentado': {
      /* duas vias honestas: um documento primário, OU duas origens independentes.
         Em ambos os casos: nada contra activo, nada caducado, e contraprova procurada. */
      need(f.primaryFavourable >= 1 || f.independentOrigins >= 2,
        'exige uma prova primária/documental OU 2 origens independentes (tem '
        + f.primaryFavourable + ' primária(s), ' + f.independentOrigins + ' origem(ns))');
      need(f.contraryOrigins === 0, 'existe prova contrária activa: o estado correcto é «contraditória»');
      need(!stale.stale, 'há marcas de desactualização: ' + stale.marcas.join('; '));
      const cp = contraprovaRegistada(claim);
      need(cp.ok, 'falta a procura de contraprova: ' + cp.motivo);
      if (f.copiesWithoutIndependentValue > 0) {
        pendencias.push(f.copiesWithoutIndependentValue + ' prova(s) favorável(eis) são cópias do mesmo texto e não contam como origens');
      }
      break;
    }
    case 'alegacao-atribuida':
      need(f.favourable >= 1, 'exige pelo menos 1 prova de que a alegação foi feita');
      break;
    case 'inferencia':
      need(f.favourable >= 1, 'exige pelo menos 1 prova que suporte a inferência');
      if (claim && claim.kind && claim.kind !== 'inferencia') {
        pendencias.push('o tipo da afirmação é «' + claim.kind + '»: declarar «inferência» exige mudar o tipo, não só o estado');
      }
      break;
    case 'contraditoria':
      need(f.favourable >= 1 && f.contrary >= 1, 'exige provas a favor E contra');
      break;
    case 'refutada':
      need(f.contrary >= 1, 'exige pelo menos 1 prova contrária');
      need(conPrimary(evidence), 'exige prova contrária primária ou documental');
      break;
    case 'nao-verificada':
      /* é o estado honesto por omissão: não exige nada e nunca é recusado */
      if (f.independentOrigins >= 2 && f.primaryFavourable >= 1 && f.contraryOrigins === 0) {
        pendencias.push('as provas já sustentam «facto-documentado»: declarar «não verificada» subestima o que existe');
      }
      break;
    case 'insuficiente':
      need(f.independentOrigins < 2 || f.primaryFavourable === 0,
        'há provas suficientes para «facto-documentado»: não se declara «insuficiente» o que já está documentado');
      break;
    case 'desactualizada':
      need(stale.stale, 'não há qualquer marca de desactualização (validade, substituição ou caducidade das provas)');
      break;
    case 'hipotese':
      break;                                    // uma hipótese não precisa de prova
    default:
      ok = false; reasons.push('estado desconhecido: ' + state + ' (aceites: ' + STATES.join(', ') + ')');
  }
  return { ok, reasons, pendencias, factors: f, stale };
}

function conPrimary(evidence) {
  return (evidence || []).filter(usable).some(
    (e) => e.stance === 'contraria' && (e.sourceType === 'primaria' || e.sourceType === 'documento-oficial')
  );
}

/* Estado máximo que as provas sustentam (sugestão, nunca aplicada sem confirmação). */
export function suggestedState(evidence, ctx) {
  const f = corroboration(evidence);
  const stale = isStale((ctx && ctx.claim) || null, evidence, ctx && ctx.now);
  if (stale.stale) return 'desactualizada';
  if (f.favourable >= 1 && f.contrary >= 1) return 'contraditoria';
  if ((f.primaryFavourable >= 1 || f.independentOrigins >= 2) && f.contraryOrigins === 0) return 'facto-documentado';
  if (f.favourable >= 1) return 'insuficiente';
  if ((evidence || []).length) return 'nao-verificada';
  return 'hipotese';
}

/* Validação de uma prova nova. Campos em falta são ditos, não inventados. */
export function validateEvidence(input) {
  const errors = [];
  const ev = {
    title: norm(input.title).slice(0, 300),
    author: norm(input.author).slice(0, 200) || null,
    excerpt: norm(input.excerpt).slice(0, 4000),
    originalUrl: norm(input.originalUrl).slice(0, 1500) || null,
    archiveUrl: norm(input.archiveUrl).slice(0, 1500) || null,
    language: (norm(input.language) || 'pt').slice(0, 12),
    location: norm(input.location).slice(0, 300) || null,
    author2: null,
    publicationDate: isoOrNull(input.publicationDate, 'publicationDate', errors),
    eventDate: isoOrNull(input.eventDate, 'eventDate', errors),
    collectionDate: isoOrNull(input.collectionDate, 'collectionDate', errors) || new Date().toISOString(),
    sourceType: input.sourceType || 'secundaria',
    stance: input.stance || 'favoravel',
    extractionMethod: input.extractionMethod || 'manual',
    validationState: input.validationState || 'nao-verificada',
    documentId: norm(input.documentId).slice(0, 80) || null,
    validityUntil: isoOrNull(input.validityUntil, 'validityUntil', errors),
    independence: input.independence || 'desconhecida',
    syndicationOf: norm(input.syndicationOf).slice(0, 1500) || null,
    limitations: norm(input.limitations).slice(0, 1000) || null,
    entities: Array.isArray(input.entities)
      ? input.entities.map(normaliseEntity).filter(Boolean).slice(0, 60) : []
  };
  if (!ev.title) errors.push('title é obrigatório');
  if (!ev.excerpt) errors.push('excerpt é obrigatório: uma prova sem excerto não pode ser verificada');
  if (!SOURCE_TYPES.includes(ev.sourceType)) errors.push('sourceType inválido (use ' + SOURCE_TYPES.join(', ') + ')');
  if (!STANCES.includes(ev.stance)) errors.push('stance inválida (favoravel, contraria, neutra)');
  if (!EXTRACTION.includes(ev.extractionMethod)) errors.push('extractionMethod inválido');
  if (!EVIDENCE_STATES.includes(ev.validationState)) errors.push('validationState inválido (use ' + EVIDENCE_STATES.join(', ') + ')');
  if (!['independente', 'dependente', 'desconhecida'].includes(ev.independence)) errors.push('independence inválido');
  if (!ev.originalUrl && !ev.archiveUrl && ev.extractionMethod !== 'manual') {
    errors.push('prova sem URL: indique originalUrl/archiveUrl ou use extractionMethod «manual» com location');
  }
  if (ev.originalUrl && !/^https?:\/\//i.test(ev.originalUrl)) errors.push('originalUrl tem de ser http(s)');
  if (ev.syndicationOf && !/^https?:\/\//i.test(ev.syndicationOf)) errors.push('syndicationOf tem de ser http(s)');
  ev.contentHash = contentHash(ev.excerpt);
  ev.canonicalUrl = canonicalUrl(ev.originalUrl);
  ev.originKey = originKey(ev);
  return { ok: errors.length === 0, errors, evidence: ev };
}

function isoOrNull(v, field, errors) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) { errors.push(field + ' não é uma data válida'); return null; }
  return d.toISOString();
}

