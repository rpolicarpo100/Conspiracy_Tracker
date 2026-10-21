/* ============================================================================
   VN — REDE DE INVESTIGAÇÃO VISUAL
   ESQUEMA E FERRAMENTAS DE DADOS (E, R, AV) — sem dados dentro.

   O conjunto de dados que a aplicação carrega é REAL e vive em
   data/real/10-epstein.js (gerado por tools/import-epstein.mjs a partir de
   decisões judiciais descarregadas, com hash e proveniência registada em
   data/real/PROVENIENCIA.json). O caso fictício «Meridiano» foi removido na
   fase 3G: nada nesta aplicação é inventado.
   ---------------------------------------------------------------------------
   Esquema (versão 1.0) — ver docs/SCHEMA.md
   entity:  id, type, name, short, ctx, status, juris, date, precision,
            aliases[], tags[], facts[], alleges[], contradictions[],
            visual{kind,src,monogram,credit,licence,source,verified}
   relation: id, from, to, kind, label, directed, start, startPrec, end,
             status, conf, why, src, loc, ex, lv, amount, currency
   ==========================================================================*/
(function (g) {
  'use strict';
  const D = {
    meta: {
      /* Alterado na fase 3G: este ficheiro já não traz um caso fictício. Os dados
         vêm de `data/real/10-epstein.js`, gerado por tools/import-epstein.mjs a
         partir de decisões judiciais reais descarregadas e verificadas por hash.
         Proveniência: data/real/PROVENIENCIA.json. */
      title: 'Epstein files — decisões judiciais publicadas',
      subtitle: 'Dados reais obtidos por importação verificada (CourtListener / Free Law Project)',
      version: '2.0.0',
      fictional: false,
      generated: '2026-10-21',
      licence: 'Decisões de tribunais dos EUA (domínio público federal); metadados do CourtListener',
      disclaimer:
        'Todos os documentos desta base foram descarregados de uma fonte pública identificada, ' +
        'têm hash SHA-256 registado e o texto foi extraído do próprio PDF. As relações são ' +
        'processuais (parte, tribunal, documento) e dizem apenas isso. Ser parte num processo, ' +
        'ser mencionado numa decisão ou litigar contra alguém NÃO é indício de crime, coordenação ' +
        'ou culpa. Nenhuma imagem de pessoas é utilizada: as representações visuais são avatares ' +
        'procedimentais gerados localmente.',
      custodian: 'Importação automática — ver data/real/PROVENIENCIA.json',
      idPrefix: 'VN-CL'
    },

    entityTypes: {
      person:       { label: 'Pessoa',            plural: 'Pessoas',            color: '#38bdf8', glyph: 'person' },
      company:      { label: 'Empresa',           plural: 'Empresas',           color: '#818cf8', glyph: 'building' },
      foundation:   { label: 'Fundação',          plural: 'Fundações',          color: '#c084fc', glyph: 'foundation' },
      organization: { label: 'Organização',       plural: 'Organizações',       color: '#fbbf24', glyph: 'group' },
      government:   { label: 'Estado / organismo',plural: 'Estado e organismos',color: '#2dd4bf', glyph: 'state' },
      religious:    { label: 'Instituição religiosa', plural: 'Instituições religiosas', color: '#e879f9', glyph: 'church' },
      court:        { label: 'Tribunal / justiça',plural: 'Tribunais e justiça',color: '#f59e0b', glyph: 'court' },
      document:     { label: 'Documento',         plural: 'Documentos',         color: '#94a3b8', glyph: 'page' },
      event:        { label: 'Acontecimento',     plural: 'Acontecimentos',     color: '#a3e635', glyph: 'event' },
      transaction:  { label: 'Transacção',        plural: 'Transacções',        color: '#fda4af', glyph: 'money' }
    },

    relationFamilies: {
      ownership:   { label: 'Propriedade e controlo', color: '#818cf8' },
      governance:  { label: 'Governança e mandato',   color: '#38bdf8' },
      financial:   { label: 'Fluxos financeiros',     color: '#fda4af' },
      contractual: { label: 'Contratos e procedimentos', color: '#2dd4bf' },
      legal:       { label: 'Judicial e regulatório', color: '#f59e0b' },
      affiliation: { label: 'Afiliação e reuniões',   color: '#fbbf24' },
      documental:  { label: 'Documental',             color: '#94a3b8' }
    },

    /* kind -> etiqueta direccional, família, inverso (quando aplicável) */
    relationTypes: {
      shareholder_of:        { label: 'Participação accionista em', family: 'ownership' },
      subsidiary_of:         { label: 'É subsidiária de', family: 'ownership' },
      owns:                  { label: 'Detém', family: 'ownership' },
      beneficial_owner_of:   { label: 'Beneficiário efectivo de', family: 'ownership' },
      nominee_for:           { label: 'Actua como nomeada de', family: 'ownership' },
      held_position:         { label: 'Ocupou cargo em', family: 'governance' },
      board_member:          { label: 'Membro de órgão social de', family: 'governance' },
      appointed:             { label: 'Nomeou', family: 'governance' },
      advised_by:            { label: 'Foi assessorada por', family: 'governance' },
      audited_by:            { label: 'Foi auditada por', family: 'governance' },
      financed:              { label: 'Financiou', family: 'financial' },
      received_financing_from:{ label: 'Recebeu financiamento de', family: 'financial' },
      lent_to:               { label: 'Concedeu empréstimo a', family: 'financial' },
      paid_amount_to:        { label: 'Pagou montante a', family: 'financial' },
      transacted_with:       { label: 'Transaccionou com', family: 'financial' },
      donated_to:            { label: 'Doou a', family: 'financial' },
      contract_with:         { label: 'Celebrou contrato com', family: 'contractual' },
      tendered_for:          { label: 'Concorreu a procedimento de', family: 'contractual' },
      supplied:              { label: 'Forneceu bens ou serviços a', family: 'contractual' },
      regulated_by:          { label: 'É regulada por', family: 'legal' },
      investigated_by:       { label: 'Foi investigada por', family: 'legal' },
      litigation_with:       { label: 'Está envolvida em processo com', family: 'legal' },
      sanctioned_by:         { label: 'Foi sancionada por', family: 'legal' },
      ruled_on:              { label: 'Pronunciou-se sobre', family: 'legal' },
      charged_by:            { label: 'Foi acusada por', family: 'legal' },
      member_of:             { label: 'É membro de', family: 'affiliation' },
      documented_meeting:    { label: 'Reunião documentada com', family: 'affiliation' },
      family_of:             { label: 'Relação familiar documentada com', family: 'affiliation' },
      lobbied:               { label: 'Exerceu lobbying sobre', family: 'affiliation' },
      participated_in:       { label: 'Participou em', family: 'affiliation' },
      mentioned_in:          { label: 'É mencionada em', family: 'documental' },
      documented_in:         { label: 'Está documentada em', family: 'documental' },
      authored:              { label: 'É autora de', family: 'documental' }
    },

    verification: {
      confirmed:    { label: 'Confirmado', short: 'C', weight: 4, color: '#34d399', desc: 'Relação sustentada por fonte primária identificada e excerto verificável.' },
      probable:     { label: 'Provável',   short: 'P', weight: 3, color: '#60a5fa', desc: 'Fonte fiável, mas indirecta ou incompleta; requer confirmação documental.' },
      alleged:      { label: 'Alegado',    short: 'A', weight: 2, color: '#fbbf24', desc: 'Atribuído a uma parte (acusação, notícia, alegação); não confirmado.' },
      unverified:   { label: 'Não verificado', short: 'N', weight: 1, color: '#94a3b8', desc: 'Referência sem fonte localizada ou aguardando verificação.' },
      contradicted: { label: 'Contraditado', short: 'X', weight: 0, color: '#fb7185', desc: 'Existe prova documental que contradiz total ou parcialmente a relação.' }
    },

    entities: [],
    relations: []
  };

  const E = (o) => { D.entities.push(o); };
  const R = (from, to, kind, o) => {
    D.relations.push(Object.assign({
      id: 'r-' + String(D.relations.length + 1).padStart(3, '0'),
      from: from, to: to, kind: kind, directed: true,
      start: null, startPrec: 'unknown', end: null, endPrec: null,
      status: 'confirmed', conf: null, why: null,
      src: null, loc: null, ex: null, lv: '2025-09-30',
      amount: null, currency: null
    }, o || {}));
  };
  const AV = (monogram, extra) => Object.assign({
    kind: 'procedural', src: null, monogram: monogram,
    credit: 'Representação procedimental gerada localmente — não é fotografia.',
    licence: 'CC0-1.0', source: 'vn-avatar-generator', verified: false
  }, extra || {});

  g.VN_DATA = D;
  g.VN_KIT = { E: E, R: R, AV: AV };
})(typeof window !== 'undefined' ? window : globalThis);
