/* =====================================================================
   Regras de evidência e de estado das conclusões — funções puras.

   Princípio central: uma conclusão NUNCA sobe de estado por si. Cada estado
   tem requisitos verificáveis no servidor; se não estiverem satisfeitos, o
   pedido é recusado com as razões. Dez cópias de um comunicado não são dez
   confirmações: a corroboração conta ORIGENS INDEPENDENTES, não ficheiros.
   ===================================================================== */
import crypto from 'node:crypto';

/* Os nove estados permitidos para uma conclusão/alegação. */
export const STATES = [
  'confirmada',              // fontes independentes + pelo menos uma primária, sem contradição aberta
  'corroborada-independente',// duas ou mais origens independentes, sem contradição aberta
  'alegacao-atribuida',      // alguém afirma; a atribuição é o que está provado, não o conteúdo
  'inferencia-suportada',    // dedução a partir de provas, declarada como inferência
  'hipotese',                // colocada para teste; pode não ter prova nenhuma
  'contraditoria',           // há provas a favor e contra
  'insuficiente',            // provas existentes mas abaixo do limiar
  'refutada',                // prova contrária primária e explícita
  'fonte-inacessivel'        // a única prova possível não está acessível
];

export const STATE_LABEL = {
  'confirmada': 'confirmada',
  'corroborada-independente': 'corroborada independente',
  'alegacao-atribuida': 'alegação atribuída',
  'inferencia-suportada': 'inferência suportada',
  'hipotese': 'hipótese',
  'contraditoria': 'contraditória',
  'insuficiente': 'insuficiente',
  'refutada': 'refutada',
  'fonte-inacessivel': 'fonte inacessível'
};

export const SOURCE_TYPES = ['primaria', 'secundaria', 'reproducao', 'comunicado', 'base-de-dados', 'documento-oficial'];
export const STANCES = ['favoravel', 'contraria', 'neutra'];
export const EXTRACTION = ['manual', 'http', 'pdf', 'api', 'ocr'];
export const CLAIM_KINDS = ['facto', 'alegacao', 'hipotese', 'inferencia'];

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

/* Chave de ORIGEM: cópias/sindicadas da mesma peça contam como uma origem. */
export function originKey(ev) {
  if (!ev) return null;
  if (ev.syndicationOf) return 'sind:' + (canonicalUrl(ev.syndicationOf) || norm(ev.syndicationOf));
  const c = canonicalUrl(ev.canonicalUrl || ev.originalUrl);
  const h = hostOf(c);
  if (h) return 'host:' + h;
  return 'hash:' + (ev.contentHash || contentHash(ev.excerpt));
}

/* Duplicado exacto: mesmo conteúdo OU o mesmo URL canónico com o mesmo excerto. */
export function dedupeKey(ev) {
  return (ev.contentHash || contentHash(ev.excerpt)) + '|' + canonicalUrl(ev.canonicalUrl || ev.originalUrl);
}

const usable = (ev) => !ev.retractedAt && ev.validationState !== 'fonte-inacessivel';

/* Factores de uma conclusão, calculados a partir das provas ligadas a ela. */
export function corroboration(evidence) {
  const list = (evidence || []).filter(usable);
  const origins = new Set(list.map(originKey).filter(Boolean));
  const fav = list.filter((e) => e.stance === 'favoravel');
  const con = list.filter((e) => e.stance === 'contraria');
  const favOrigins = new Set(fav.map(originKey));
  const conOrigins = new Set(con.map(originKey));
  const primary = fav.filter((e) => e.sourceType === 'primaria' || e.sourceType === 'documento-oficial');
  return {
    total: list.length,
    retractedOrInaccessible: (evidence || []).length - list.length,
    favourable: fav.length,
    contrary: con.length,
    origins: [...origins],
    independentOrigins: origins.size,
    favourableOrigins: favOrigins.size,
    contraryOrigins: conOrigins.size,
    primaryFavourable: primary.length,
    // cópias do mesmo texto: úteis para verificar redacção, inúteis como confirmação
    copiesWithoutIndependentValue: fav.length - favOrigins.size
  };
}

/* Requisitos de cada estado. Devolve {ok, reasons[], factors}. */
export function evaluate(state, evidence) {
  const f = corroboration(evidence);
  const reasons = [];
  let ok = true;
  const need = (cond, msg) => { if (!cond) { ok = false; reasons.push(msg); } };

  switch (state) {
    case 'confirmada':
      need(f.independentOrigins >= 2, 'exige pelo menos 2 origens independentes (tem ' + f.independentOrigins + ')');
      need(f.primaryFavourable >= 1, 'exige pelo menos 1 prova primária favorável');
      need(f.contraryOrigins === 0, 'existe prova contrária activa: o estado correcto é «contraditória»');
      break;
    case 'corroborada-independente':
      need(f.independentOrigins >= 2, 'exige pelo menos 2 origens independentes (tem ' + f.independentOrigins + ')');
      need(f.contraryOrigins === 0, 'existe prova contrária activa: o estado correcto é «contraditória»');
      break;
    case 'alegacao-atribuida':
      need(f.favourable >= 1, 'exige pelo menos 1 prova de que a alegação foi feita');
      break;
    case 'inferencia-suportada':
      need(f.favourable >= 1, 'exige pelo menos 1 prova que suporte a inferência');
      break;
    case 'contraditoria':
      need(f.favourable >= 1 && f.contrary >= 1, 'exige provas a favor E contra');
      break;
    case 'refutada':
      need(f.contrary >= 1, 'exige pelo menos 1 prova contrária');
      need(conPrimary(evidence), 'exige prova contrária primária ou documental');
      break;
    case 'fonte-inacessivel':
      need((evidence || []).some((e) => e.validationState === 'fonte-inacessivel' || e.retractedAt),
        'exige uma prova marcada como inacessível ou retirada');
      break;
    case 'hipotese':
      break;                                    // uma hipótese não precisa de prova
    case 'insuficiente':
      need(f.independentOrigins < 2 || f.primaryFavourable === 0,
        'há provas suficientes para um estado mais forte: não se declara «insuficiente» o que já está corroborado');
      break;
    default:
      ok = false; reasons.push('estado desconhecido: ' + state);
  }
  return { ok, reasons, factors: f };
}

function conPrimary(evidence) {
  return (evidence || []).filter(usable).some(
    (e) => e.stance === 'contraria' && (e.sourceType === 'primaria' || e.sourceType === 'documento-oficial')
  );
}

/* Estado máximo que as provas sustentam (sugestão, nunca aplicada sem confirmação). */
export function suggestedState(evidence) {
  const f = corroboration(evidence);
  if (f.favourable >= 1 && f.contrary >= 1) return 'contraditoria';
  if (f.independentOrigins >= 2 && f.primaryFavourable >= 1 && f.contraryOrigins === 0) return 'confirmada';
  if (f.independentOrigins >= 2 && f.contraryOrigins === 0) return 'corroborada-independente';
  if (f.favourable >= 1) return 'insuficiente';
  if ((evidence || []).length && f.independentOrigins === 0) return 'fonte-inacessivel';
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
    validationState: input.validationState || 'insuficiente',
    independence: input.independence || 'desconhecida',
    syndicationOf: norm(input.syndicationOf).slice(0, 1500) || null,
    limitations: norm(input.limitations).slice(0, 1000) || null,
    entities: Array.isArray(input.entities) ? input.entities.map((x) => norm(x).slice(0, 120)).filter(Boolean).slice(0, 60) : []
  };
  if (!ev.title) errors.push('title é obrigatório');
  if (!ev.excerpt) errors.push('excerpt é obrigatório: uma prova sem excerto não pode ser verificada');
  if (!SOURCE_TYPES.includes(ev.sourceType)) errors.push('sourceType inválido (use ' + SOURCE_TYPES.join(', ') + ')');
  if (!STANCES.includes(ev.stance)) errors.push('stance inválida (favoravel, contraria, neutra)');
  if (!EXTRACTION.includes(ev.extractionMethod)) errors.push('extractionMethod inválido');
  if (!STATES.includes(ev.validationState)) errors.push('validationState inválido');
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

export function newEvidenceId() { return 'ev-' + crypto.randomBytes(8).toString('base64url'); }
export function newClaimId() { return 'cl-' + crypto.randomBytes(8).toString('base64url'); }
