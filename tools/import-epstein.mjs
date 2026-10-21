/* =====================================================================
   IMPORTAÇÃO REAL — DOCUMENTOS JUDICIAIS SOBRE «EPSTEIN FILES»
   ---------------------------------------------------------------------
   O que este script faz, e só isto:

     1. pergunta à API pública do CourtListener (REST v4, acesso anónimo
        documentado) por decisões judiciais que mencionem «Jeffrey Epstein»;
     2. descarrega o PDF de cada decisão com `fetchDocument()` — o mesmo
        caminho que a aplicação usa: guarda SSRF, limites de tamanho, hash
        SHA-256 e extracção de texto;
     3. confere o SHA-1 publicado pelo CourtListener contra o SHA-1 do
        ficheiro que descarregámos (se não coincidir, o documento é
        rejeitado — não se corrige o hash para «bater certo»);
     4. escreve `data/real/10-epstein.js` (o conjunto de dados que a
        aplicação carrega) e `data/real/PROVENIENCIA.json` (o registo do
        que foi obtido, quando, de onde e com que resultado).

   O que este script NÃO faz:
     · não inventa entidades, relações, montantes nem excertos;
     · não escreve texto que não venha da extracção do próprio PDF;
     · não transforma «parte num processo» em indício de crime: as arestas
       criadas são processuais (`litigation_with`, `documented_in`,
       `ruled_on`), com excerto literal e estado `confirmed` apenas quanto
       ao facto processual;
     · não contorna barreiras: se a fonte recusar, o documento fica
       registado como indisponível e a execução continua.

   Uso:
     node tools/import-epstein.mjs                 # execução normal
     node tools/import-epstein.mjs --max=20        # limite de documentos
     node tools/import-epstein.mjs --dry           # não escreve ficheiros
     node tools/import-epstein.mjs --query="..."   # outra pesquisa (registada)
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fetchDocument } from '../server/api.mjs';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = args.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const DRY = args.includes('--dry');
const MAX_DOCS = Number(arg('max', '40'));
const QUERY = arg('query', '"Jeffrey Epstein"');
const TYPES = (arg('types', 'o')).split(',');
const SEARCH = 'https://www.courtlistener.com/api/rest/v4/search/';
const UA = 'ConspiracyTracker/2 (importação de documentos judiciais públicos; contacto no site)';
const OUT_DIR = path.resolve('data/real');
const PAUSE_MS = 1200;
const PAGES = Number(arg('pages', '3'));
/* menção literal ao nome, no texto extraído: é a condição de entrada */
const MENTION = /Jeffrey\s+(?:E\.\s+)?Epstein/gi;   /* cortesia: um pedido por segundo, no máximo */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startedAt = new Date().toISOString();
const log = [];
const limitsHit = [];

function say(msg) { console.log(msg); log.push(msg); }

/* ---------- 1. pesquisa ---------- */
async function search(type, pages) {
  const first = SEARCH + '?q=' + encodeURIComponent(QUERY) + '&type=' + type + '&order_by=score%20desc';
  let url = first, count = null;
  const results = [];
  for (let i = 0; i < pages && url; i++) {
    /* 429 é o limite de utilização do serviço, não uma avaria: espera-se o
       tempo que o servidor indica (ou o dobro do anterior) e tenta-se de novo;
       ao fim de 4 tentativas a execução pára e diz o que ficou por fazer. */
    let res = null, wait = 5000;
    for (let attempt = 1; attempt <= 4; attempt++) {
      res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
      if (res.status !== 429) break;
      const ra = Number(res.headers.get('retry-after') || 0);
      const ms = ra > 0 ? ra * 1000 : wait;
      say('[limite] HTTP 429 na pesquisa (tentativa ' + attempt + '/4): a esperar ' + Math.round(ms / 1000) + ' s');
      await sleep(ms);
      wait *= 2;
    }
    if (!res.ok) {
      limitsHit.push('pesquisa type=' + type + ': HTTP ' + res.status + (res.status === 429 ? ' (limite de utilização do serviço)' : ''));
      say('[limite] pesquisa interrompida: HTTP ' + res.status);
      break;
    }
    const json = await res.json();
    count = json.count;
    results.push(...(json.results || []));
    url = json.next || null;
    if (url) await sleep(PAUSE_MS);
  }
  return { url: first, count, results, retrievedAt: new Date().toISOString() };
}

/* ---------- 2. normalização ---------- */
const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const titleCase = (s) => squash(s).replace(/\b([A-Z])([A-Z]+)\b/g, (m) => m[0] + m.slice(1).toLowerCase());
const slug = (s) => squash(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const COMPANY_HINT = /\b(inc|l\.?l\.?c|corp|corporation|ltd|limited|company|co|bank|trust|group|partners|associates|holdings|llp|lp|plc|gmbh|s\.?a|n\.?v|foundation|institute|center|centre|project|committee|association|council|oversight|university|school|society)\b/i;
const partyType = (name) => (GOV_HINT.test(name) ? 'government' : COMPANY_HINT.test(name) ? 'company' : 'person');

/* «A v. B and C» → partes.
   Regras (aprendidas ao ver os títulos reais, não inventadas):
     · divide apenas em « v. » e em « and »/«&» — a vírgula aparece dentro de
       nomes («Fbi, D.C.»), pelo que dividir por vírgula criava fragmentos falsos;
     · remove descrições de função que vêm depois do nome («… , as State Attorney of …»);
     · descarta fragmentos com menos de 3 caracteres. */
const ROLE_TAIL = /,\s+(?:as\s+|Publisher of\s+|Trustee\s+|Appellant|Appellee|Debtor|Plaintiff|Defendant).*$/i;
function partiesFromCaseName(caseName) {
  const raw = squash(caseName).replace(/^in re:?\s*/i, '');
  const sides = raw.split(/\s+v\.?\s+/i);
  if (sides.length < 2) return { ok: false, parties: [], reason: 'título sem «v.»' };
  const out = [];
  for (const side of sides) {
    side.split(/\s+(?:and|&)\s+/i).forEach((part) => {
      const name = squash(part).replace(ROLE_TAIL, '').replace(/[.,;:]$/, '').trim();
      if (name.length >= 3 && name.length <= 90) out.push(name);
    });
  }
  return { ok: out.length >= 2, parties: out, reason: '' };
}

const GOV_HINT = /^(united states|state of|commonwealth of|city of|county of|department of|u\.s\.|fbi|bureau)/i;

/* ---------- 3. recolha ---------- */
const docs = [];
const rejected = [];
const sources = new Map();   /* URL → registo de fonte observada */

for (const type of TYPES) {
  const found = await search(type, PAGES);
  say('[pesquisa] type=' + type + ' · «' + QUERY + '» → ' + found.count + ' resultados (' + found.results.length + ' nesta página)');
  for (const r of found.results) {
    if (docs.length >= MAX_DOCS) break;
    const opinions = r.opinions || [];
    const snippets = opinions.map((o) => squash(o.snippet || '')).filter(Boolean);
    const op = opinions.find((o) => o.local_path) || opinions[0];
    if (!op || !op.local_path) { rejected.push({ cluster: r.cluster_id, caseName: r.caseName, why: 'sem caminho de PDF publicado' }); continue; }

    const pdfUrl = 'https://storage.courtlistener.com/' + op.local_path;
    await sleep(PAUSE_MS);
    const got = await fetchDocument(pdfUrl);
    const rec = {
      clusterId: r.cluster_id, opinionId: op.id, caseName: squash(r.caseName),
      court: r.court, courtId: r.court_id, jurisdiction: r.court_jurisdiction,
      dateFiled: r.dateFiled, docketNumber: r.docketNumber, absoluteUrl: 'https://www.courtlistener.com' + r.absolute_url,
      pdfUrl, publishedSha1: op.sha1 || null, query: found.url, queriedAt: found.retrievedAt
    };
    if (!got.ok) {
      rec.why = 'recolha falhou: ' + (got.error || 'motivo desconhecido') + (got.status ? ' (HTTP ' + got.status + ')' : '');
      rejected.push(rec);
      say('[falha] ' + rec.caseName + ' → ' + rec.why);
      continue;
    }
    rec.httpStatus = got.status;
    rec.contentType = got.contentType || null;
    rec.bytes = got.bytes;
    rec.sha256 = got.hash;
    rec.textChars = (got.text || '').length;
    /* o texto devolvido pela recolha é limitado (40 000 caracteres): declara-se
       quando o documento é maior, em vez de deixar pensar que se leu tudo. */
    rec.textTruncated = rec.textChars >= 40000;
    rec.method = got.extraction && got.extraction.method;
    rec.pages = got.extraction && got.extraction.pages;
    rec.warnings = (got.extraction && got.extraction.warnings) || [];
    rec.retrievedAt = new Date().toISOString();
    /* verificação cruzada de integridade: o SHA-1 que o CourtListener publica
       tem de ser o SHA-1 do ficheiro que descarregámos. */
    rec.sha1 = got.sha1 || null;
    rec.sha1Check = op.sha1 ? (got.sha1 === op.sha1 ? 'confere' : 'não confere') : 'não publicado';
    if (rec.sha1Check === 'não confere') {
      rec.why = 'SHA-1 do ficheiro descarregado não corresponde ao publicado pelo CourtListener';
      rejected.push(rec);
      say('[rejeitado] ' + rec.caseName + ' → ' + rec.why);
      continue;
    }
    rec.text = got.text || '';
    /* Relevância decidida pelo TEXTO EXTRAÍDO do próprio PDF — não pelo título
       nem pelo excerto do motor de busca (que é o início do documento e não
       prova nada). Sem menção literal, o documento não entra: há homónimos. */
    const all = [...rec.text.matchAll(MENTION)];
    const m = all[0];
    rec.mentionCount = all.length;
    if (!m) {
      rec.why = 'texto extraído não menciona «Jeffrey Epstein» (homónimo ou documento de outro processo)';
      rejected.push(rec);
      say('[rejeitado] ' + rec.caseName + ' → ' + rec.why);
      continue;
    }
    const at = Math.max(0, m.index - 120);
    rec.mention = squash(rec.text.slice(at, at + 320));
    docs.push(rec);
    sources.set('https://www.courtlistener.com', {
      name: 'CourtListener (Free Law Project) — jurisprudência e PACER/RECAP',
      url: 'https://www.courtlistener.com', category: 'tribunais',
      note: 'API REST v4 consultada com acesso anónimo; resultados citados com URL canónico e hash do PDF.'
    });
    say('[ok] ' + rec.caseName + ' · ' + rec.court + ' · ' + rec.dateFiled +
      ' · ' + rec.textChars + ' caracteres · sha1 ' + rec.sha1Check);
  }
}

/* ---------- 4. construção do conjunto de dados ---------- */
const entities = [];
const relations = [];
const seenParty = new Map();

function addParty(name, docId, caseName) {
  const key = slug(name);
  if (!key) return null;
  if (seenParty.has(key)) return seenParty.get(key);
  const id = 'p-' + key;
  const type = partyType(name);
  entities.push({
    id, type, name,
    short: (type === 'company' ? 'Empresa' : 'Pessoa') + ' nomeada em processo judicial',
    ctx: 'Parte nomeada no título do processo «' + caseName + '». O facto documentado é processual: ' +
      'o nome consta do título da decisão. O tipo (' + (type === 'company' ? 'empresa' : 'pessoa') +
      ') foi atribuído por heurística sobre o nome e NÃO está confirmado pelo documento. ' +
      'Ser parte num processo não é indício de conduta ilícita.',
    status: 'confirmed', juris: 'US', date: null, precision: 'unknown',
    aliases: [], tags: ['parte-processual'],
    visual: { kind: 'procedural', src: null, monogram: name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
      credit: 'Representação procedimental gerada localmente — não é fotografia.',
      licence: 'CC0-1.0', source: 'vn-avatar-generator', verified: false },
    facts: ['Nomeado(a) como parte em «' + caseName + '» (título do processo; ver documento).'],
    alleges: [], contradictions: []
  });
  seenParty.set(key, id);
  return id;
}

function addCourt(rec) {
  const key = slug(rec.court);
  const id = 'c-court-' + (rec.courtId ? slug(rec.courtId) : key);
  if (!seenParty.has('court:' + key)) {
    entities.push({
      id, type: 'court', name: rec.court, short: 'Tribunal (EUA)',
      ctx: 'Tribunal identificado pelo CourtListener com o código «' + (rec.courtId || '—') + '» ' +
        '(jurisdição ' + (rec.jurisdiction || '—') + '). Instituição pública dos Estados Unidos.',
      status: 'confirmed', juris: 'US', date: null, precision: 'unknown',
      aliases: [], tags: ['tribunal'], visual: { kind: 'procedural', src: null, monogram: 'TR',
        credit: 'Representação procedimental gerada localmente — não é fotografia.',
        licence: 'CC0-1.0', source: 'vn-avatar-generator', verified: false },
      facts: ['Código do tribunal na base do CourtListener: ' + (rec.courtId || 'não indicado') + '.'],
      alleges: [], contradictions: []
    });
    seenParty.set('court:' + key, id);
  }
  return id;
}

let epsteinId = null;
if (docs.length) {
  epsteinId = 'p-jeffrey-epstein';
  seenParty.set('jeffrey-epstein', epsteinId);
  entities.push({
    id: epsteinId, type: 'person', name: 'Jeffrey Epstein',
    short: 'Nome referido nas decisões importadas',
    ctx: 'Pessoa mencionada em ' + docs.length + ' decisão(ões) judicial(is) importada(s). O que está documentado aqui é ' +
      'apenas isso: o nome consta do texto dessas decisões, com excerto guardado. Não se registam aqui acusações, ' +
      'culpas ou conclusões: as decisões falam por si e estão citadas com URL e hash.',
    status: 'confirmed', juris: 'US', date: '1953', precision: 'year',
    aliases: ['Jeffrey E. Epstein'], tags: ['nomeado-em-decisoes'],
    disambiguation: { birthYear: 1953, jurisdiction: 'US' },
    visual: { kind: 'procedural', src: null, monogram: 'JE',
      credit: 'Representação procedimental gerada localmente — não é fotografia.',
      licence: 'CC0-1.0', source: 'vn-avatar-generator', verified: false },
    facts: ['Nome mencionado no texto de ' + docs.length + ' decisão(ões) judicial(is) descarregada(s) e verificada(s) por hash.'],
    alleges: [], contradictions: []
  });
}

for (const rec of docs) {
  const docId = 'd-cl-' + rec.opinionId;
  const excerpt = squash(rec.text).slice(0, 400);
  entities.push({
    id: docId, type: 'document',
    name: rec.caseName + ' — ' + rec.court + ' (' + rec.dateFiled + ')',
    short: 'Decisão judicial publicada (PDF verificado por hash)',
    ctx: 'Decisão judicial obtida em ' + rec.retrievedAt + ' de ' + rec.pdfUrl +
      '. ' + (rec.pages ? rec.pages + ' página(s); ' : '') + 'método de extracção: ' + (rec.method || '—') +
      '; ' + rec.textChars + ' caracteres extraídos' + (rec.textTruncated ? ' (texto limitado a 40 000: documento maior)' : '') +
      '; «Jeffrey Epstein» aparece ' + rec.mentionCount + ' vez(es) no texto extraído; SHA-256 do ficheiro: ' + rec.sha256 +
      '. SHA-1 publicado pelo CourtListener: ' + rec.sha1Check + '.',
    status: 'confirmed', juris: 'US', date: rec.dateFiled, precision: 'day',
    aliases: [rec.docketNumber].filter(Boolean),
    tags: ['decisao-judicial', rec.courtId || 'tribunal',
      rec.mentionCount >= 3 ? 'tema-principal' : 'mencao-tangencial'],
    visual: { kind: 'procedural', src: null, monogram: 'DOC',
      credit: 'Representação procedimental gerada localmente — não é fotografia.',
      licence: 'CC0-1.0', source: 'vn-avatar-generator', verified: false },
    facts: [
      'Processo: ' + rec.caseName + ' · tribunal: ' + rec.court +
        (rec.docketNumber ? ' · número: ' + rec.docketNumber : '') + ' · data: ' + rec.dateFiled + '.',
      'Página pública: ' + rec.absoluteUrl,
      'Excerto extraído do próprio PDF: «' + excerpt.slice(0, 240) + '…»'
    ],
    alleges: [], contradictions: [],
    source: {
      url: rec.pdfUrl, canonical: rec.absoluteUrl, retrievedAt: rec.retrievedAt,
      sha256: rec.sha256, publishedSha1: rec.publishedSha1, sha1Check: rec.sha1Check,
      bytes: rec.bytes, contentType: rec.contentType, method: rec.method,
      extractionNotes: rec.warnings
    }
  });

  if (epsteinId) {
    relations.push({
      from: epsteinId, to: docId, kind: 'mentioned_in',
      status: 'probable', conf: 4,
      method: 'verificação automática: hash do ficheiro + menção literal (sem revisão humana)',
      reviewPending: true,
      why: 'O nome «Jeffrey Epstein» ocorre literalmente no texto extraído do PDF, cujo hash confere; o excerto em volta foi guardado. A promoção a «confirmado» exige revisor humano identificado.',
      src: docId, loc: 'texto extraído do PDF (excerto em volta da menção)',
      ex: rec.mention, lv: rec.retrievedAt.slice(0, 10)
    });
  }
  const courtId = addCourt(rec);
  relations.push({
    from: courtId, to: docId, kind: 'ruled_on',
    status: 'probable', conf: 5,
    method: 'verificação automática: metadados publicados + texto do documento (sem revisão humana)',
    reviewPending: true,
    why: 'O tribunal e a data constam dos metadados publicados da decisão e do próprio documento, cujo hash confere. Promoção a «confirmado» exige revisor humano.',
    src: docId, loc: 'metadados do documento (tribunal, data, processo)',
    ex: rec.court + ' · ' + rec.dateFiled + ' · ' + rec.caseName,
    lv: rec.retrievedAt.slice(0, 10)
  });

  const parsed = partiesFromCaseName(rec.caseName);
  const parties = parsed.parties;
  const partyIds = parties.map((p) => addParty(p, docId, rec.caseName)).filter(Boolean);
  partyIds.forEach((pid) => {
    relations.push({
      from: pid, to: docId, kind: 'documented_in',
      status: 'probable', conf: 4,
      method: 'verificação automática: título do processo publicado (sem revisão humana)',
      reviewPending: true,
      why: 'O nome consta do título do processo publicado. É um facto processual; não é uma conclusão sobre conduta. Promoção a «confirmado» exige revisor humano.',
      src: docId, loc: 'título do processo (caseName)',
      ex: rec.caseName, lv: rec.retrievedAt.slice(0, 10)
    });
  });
  /* «litigation_with» só entre as partes do MESMO processo e apenas como
     facto processual — nunca como indício de coordenação ou crime. */
  for (let i = 0; i < partyIds.length; i++) {
    for (let j = i + 1; j < partyIds.length; j++) {
      relations.push({
        from: partyIds[i], to: partyIds[j], kind: 'litigation_with', directed: false,
        status: 'probable', conf: 4,
        method: 'verificação automática: mesmo título processual publicado (sem revisão humana)',
        reviewPending: true,
        why: 'Ambas as partes figuram no mesmo título processual. Litigar não é prova de nada além do litígio. Promoção a «confirmado» exige revisor humano.',
        src: docId, loc: 'título do processo (caseName)', ex: rec.caseName,
        lv: rec.retrievedAt.slice(0, 10)
      });
    }
  }
}

/* nenhum id pode repetir-se: um id duplicado é um erro de dados, não um detalhe */
const ids = entities.map((e) => e.id);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dup.length) {
  throw new Error('ids duplicados na importação: ' + [...new Set(dup)].join(', '));
}

/* ---------- 5. escrita ---------- */
const meta = {
  title: 'Epstein files — decisões judiciais publicadas',
  subtitle: 'Dados reais obtidos por importação verificada (CourtListener / Free Law Project)',
  version: '1.0.0',
  fictional: false,
  generated: new Date().toISOString().slice(0, 10),
  licence: 'Documentos: decisões de tribunais dos EUA (domínio público federal). Metadados: CourtListener, verificar termos de utilização.',
  disclaimer: 'Cada documento foi descarregado, tem hash SHA-256 registado e o texto foi extraído do próprio PDF. ' +
    'As relações são processuais (parte, tribunal, documento) e estão assinaladas como tal. ' +
    'Nenhuma relação aqui presente é indício de crime, coordenação ou culpa.',
  custodian: 'Importação automática registada em data/real/PROVENIENCIA.json',
  idPrefix: 'VN-CL'
};

const provenance = {
  generatedAt: new Date().toISOString(),
  importer: 'tools/import-epstein.mjs',
  importerVersion: '1.0.0',
  queries: TYPES.map((t) => ({ type: t, query: QUERY, api: SEARCH, retrievedAt: startedAt })),
  policy: {
    rate: 'um pedido por segundo entre descargas de PDF',
    integrity: 'SHA-1 publicado pelo CourtListener comparado com o SHA-1 do ficheiro descarregado',
    noFabrication: 'nenhum excerto, entidade ou relação é escrito sem documento que o sustente',
    extraction: 'server/pdftext.mjs (ToUnicode) com OCR apenas quando a recolha o decide'
  },
  sources: [...sources.values()],
  documents: docs.map((d) => ({
    caseName: d.caseName, court: d.court, courtId: d.courtId, dateFiled: d.dateFiled,
    docketNumber: d.docketNumber, clusterId: d.clusterId, opinionId: d.opinionId,
    pdfUrl: d.pdfUrl, canonicalUrl: d.absoluteUrl, httpStatus: d.httpStatus,
    contentType: d.contentType, bytes: d.bytes, sha256: d.sha256, publishedSha1: d.publishedSha1,
    sha1Check: d.sha1Check, method: d.method, pages: d.pages, textChars: d.textChars, textTruncated: d.textTruncated, mentionCount: d.mentionCount,
    retrievedAt: d.retrievedAt, warnings: d.warnings, mentionExcerpt: d.mention
  })),
  rejected,
  limitsHit,
  counts: { documents: docs.length, entities: entities.length, relations: relations.length, rejected: rejected.length, queries: TYPES.length }
};

say('\n[resultado] ' + docs.length + ' documentos · ' + entities.length + ' entidades · ' +
  relations.length + ' relações · ' + rejected.length + ' candidatos rejeitados');

if (DRY) {
  say('[dry] nada foi escrito (--dry)');
} else {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const js = [
    '/* =====================================================================',
    '   GERADO POR tools/import-epstein.mjs — NÃO EDITAR À MÃO.',
    '   Dados reais: decisões judiciais descarregadas e verificadas por hash.',
    '   Proveniência completa: data/real/PROVENIENCIA.json',
    '   Gerado em ' + new Date().toISOString(),
    '   ===================================================================== */',
    '(function (g) {',
    "  'use strict';",
    '  const { E, R } = g.VN_KIT;',
    '  const D = g.VN_DATA;',
    '  Object.assign(D.meta, ' + JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ') + ');',
    '',
    '  /* ---- entidades (' + entities.length + ') ---- */',
    ...entities.map((e) => '  E(' + JSON.stringify(e) + ');'),
    '',
    '  /* ---- relações (' + relations.length + ') ---- */',
    ...relations.map((r) => '  R(' + JSON.stringify(r.from) + ', ' + JSON.stringify(r.to) + ', ' +
      JSON.stringify(r.kind) + ', ' + JSON.stringify(Object.assign({}, r, { from: undefined, to: undefined, kind: undefined }))
        .replace(/"from":null,|"to":null,|"kind":null,|"directed":true,/g, '') + ');'),
    '})(typeof window !== \'undefined\' ? window : globalThis);',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, '10-epstein.js'), js);
  fs.writeFileSync(path.join(OUT_DIR, 'PROVENIENCIA.json'), JSON.stringify(provenance, null, 2) + '\n');
  say('[escrito] data/real/10-epstein.js e data/real/PROVENIENCIA.json');
}
