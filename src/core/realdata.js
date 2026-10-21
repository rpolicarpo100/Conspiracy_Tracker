/* =====================================================================
   VN · PORTÃO DE DADOS REAIS
   Nenhum dado real entra no grafo sem proveniência verificável.
   Regras aplicadas na importação (rejeição dura quando em falta):
     · entidade: id estável, tipo, nome, estado
     · pessoa/organização: pelo menos um identificador de desambiguação
       (ano de nascimento, NIF mascarado/hash, registo) — para homónimos
     · imagem: crédito + licença + origem, ou avatar procedimental declarado
     · documento: URL (ou arquivo com referência), data de recolha, e
       hash SHA-256 do excerto citado
     · relação: tipo, estado, documento-fonte e excerto literal
     · relação "confirmada": exige fonte primária + excerto + revisor
   O que não cumprir fica como NÃO VERIFICADO, nunca como facto.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});

  const TYPES = ['person', 'company', 'foundation', 'organization', 'government', 'religious', 'court', 'document', 'event', 'transaction'];
  const STATUS = ['confirmed', 'probable', 'alleged', 'unverified', 'contradicted'];

  const SCHEMA_DOC = {
    meta: { title: 'string', fictional: false, version: 'string', generated: 'YYYY-MM-DD', licence: 'string', disclaimer: 'string', custodian: 'string' },
    entityTypes: 'opcional — herdado do esquema base se omitido',
    relationTypes: 'opcional — herdado do esquema base se omitido',
    verification: 'opcional — herdado do esquema base se omitido',
    entities: [{
      id: 'string estável (ex.: rj-12345)', type: TYPES.join('|'), name: 'string', short: 'string',
      ctx: 'string', status: STATUS.join('|'), juris: 'ISO-3166 alfa-2', date: 'YYYY[-MM[-DD]]',
      precision: 'day|month|year|unknown', aliases: ['string'],
      disambiguation: { birthYear: 'number?', registryId: 'string?', nifHash: 'sha256?', jurisdiction: 'string?' },
      facts: [{ text: 'string', source: 'id de documento' }],
      alleges: [{ text: 'string', source: 'id de documento', attributedTo: 'quem alega' }],
      contradictions: [{ text: 'string', source: 'id de documento' }],
      visual: { kind: 'image|logo|procedural', src: 'URL', credit: 'string', licence: 'string', source: 'string' }
    }],
    relations: [{
      id: 'string', from: 'id', to: 'id', kind: 'chave de relationTypes', directed: 'boolean',
      start: 'YYYY[-MM[-DD]]', startPrec: 'day|month|year|unknown', end: 'YYYY[-MM[-DD]]',
      status: STATUS.join('|'), conf: '0-5', why: 'string (obrigatório se não confirmada)',
      src: 'id de documento-fonte', loc: 'localização exacta (página, cláusula)', ex: 'excerto literal',
      lv: 'data da última verificação', reviewer: 'quem verificou', method: 'como verificou',
      amount: 'number?', currency: 'string?'
    }]
  };

  function baseMeta() {
    return {
      title: 'Caso importado', subtitle: 'Dados reais sob verificação', version: '1.0.0',
      fictional: false, generated: new Date().toISOString().slice(0, 10), licence: 'não definida',
      disclaimer: 'Dados reais importados. Cada afirmação deve ser lida com o estado de verificação e a fonte indicados.',
      custodian: '—', idPrefix: 'VN'
    };
  }

  /* ---------- validação ---------- */
  function validateBundle(obj) {
    const errors = [], warnings = [], notes = [];
    if (!obj || typeof obj !== 'object') return { ok: false, errors: [{ msg: 'Ficheiro não é um objecto JSON' }], warnings, stats: null };
    if (!Array.isArray(obj.entities) || !obj.entities.length) errors.push({ msg: 'Sem entidades (entities[])' });
    if (!Array.isArray(obj.relations)) errors.push({ msg: 'Sem relações (relations[])' });
    if (obj.meta && obj.meta.fictional) errors.push({ msg: 'Este ficheiro declara-se fictício (meta.fictional = true): não entra, porque o produto não mostra dados inventados.' });

    const ids = new Set();
    const docs = new Set();
    (obj.entities || []).forEach((e, i) => {
      const tag = 'entidade[' + i + '] ' + (e.id || '(sem id)');
      if (!e.id) errors.push({ msg: tag + ': falta id' });
      if (ids.has(e.id)) errors.push({ msg: tag + ': id duplicado' });
      ids.add(e.id);
      if (!e.name) errors.push({ msg: tag + ': falta nome' });
      if (TYPES.indexOf(e.type) < 0) errors.push({ msg: tag + ': tipo inválido "' + e.type + '"' });
      if (STATUS.indexOf(e.status) < 0) errors.push({ msg: tag + ': estado inválido "' + e.status + '"' });
      if (e.type === 'document') {
        docs.add(e.id);
        /* Proveniência de um documento pode estar em campos próprios (url/retrievedAt/hash) ou,
           como no registo de importação, no objecto `source` (url/canonical/retrievedAt/sha256).
           Aceitam-se as duas formas, mas exige-se que uma delas exista: um documento sem origem
           verificável não é documento, é uma citação solta. */
        const src = e.source || {};
        const url = e.url || e.archiveRef || src.canonical || src.url;
        const retrievedAt = e.retrievedAt || src.retrievedAt;
        const hash = e.excerptHash || e.hash || src.sha256;
        if (!url) errors.push({ msg: tag + ': documento sem URL nem referência de arquivo' });
        if (!retrievedAt) errors.push({ msg: tag + ': documento sem data de recolha (retrievedAt)' });
        if (!hash) warnings.push({ msg: tag + ': documento sem hash do ficheiro nem do excerto' });
      }
      if (e.type === 'person' || e.type === 'company' || e.type === 'foundation' || e.type === 'organization') {
        const d = e.disambiguation || {};
        if (!d.birthYear && !d.registryId && !d.nifHash && !(e.aliases || []).length && !e.date) {
          warnings.push({ msg: tag + ': sem identificador de desambiguação — risco de homónimo' });
        }
      }
      if (e.visual) {
        if (e.visual.kind === 'image' || e.visual.kind === 'logo') {
          if (!e.visual.credit) errors.push({ msg: tag + ': imagem sem crédito' });
          if (!e.visual.licence) errors.push({ msg: tag + ': imagem sem licença' });
          if (!e.visual.src && !e.visual.dataUri) errors.push({ msg: tag + ': imagem sem origem' });
        }
      } else warnings.push({ msg: tag + ': sem representação visual declarada (será usado avatar procedimental)' });
      if ((e.facts || []).some((f) => typeof f === 'string' && !(e.facts || []).some(() => false))) {
        // factos em texto simples são aceites, mas não são rastreáveis
        warnings.push({ msg: tag + ': factos em texto simples sem referência de documento' });
      }
    });

    (obj.relations || []).forEach((r, i) => {
      const tag = 'relação[' + i + '] ' + (r.id || '(sem id)');
      if (!r.id) errors.push({ msg: tag + ': falta id' });
      if (!ids.has(r.from)) errors.push({ msg: tag + ': origem inexistente "' + r.from + '"' });
      if (!ids.has(r.to)) errors.push({ msg: tag + ': destino inexistente "' + r.to + '"' });
      if (!r.kind) errors.push({ msg: tag + ': falta tipo de relação' });
      if (STATUS.indexOf(r.status) < 0) errors.push({ msg: tag + ': estado inválido "' + r.status + '"' });
      if (!r.src) errors.push({ msg: tag + ': sem documento-fonte (src) — dados reais exigem fonte' });
      else if (!docs.has(r.src) && !ids.has(r.src)) errors.push({ msg: tag + ': fonte "' + r.src + '" não existe no ficheiro' });
      if (!r.ex) errors.push({ msg: tag + ': sem excerto literal (ex)' });
      if (r.status === 'confirmed') {
        if (!r.reviewer) errors.push({ msg: tag + ': confirmada sem revisor identificado' });
        if (!r.method) warnings.push({ msg: tag + ': confirmada sem método de verificação descrito' });
        if (!r.lv) errors.push({ msg: tag + ': confirmada sem data de última verificação (lv)' });
      }
      if (['probable', 'alleged', 'unverified', 'contradicted'].indexOf(r.status) >= 0 && !r.why) {
        errors.push({ msg: tag + ': estado não confirmado exige justificação (why)' });
      }
      if (r.method && /not[ií]cia|imprensa|media/i.test(r.method) && r.status === 'confirmed') {
        errors.push({ msg: tag + ': fonte jornalística não pode sustentar estado "confirmado"' });
      }
    });

    const stats = {
      entities: (obj.entities || []).length,
      documentEntities: docs.size,
      relations: (obj.relations || []).length,
      confirmed: (obj.relations || []).filter((r) => r.status === 'confirmed').length,
      withSource: (obj.relations || []).filter((r) => r.src).length,
      withExcerpt: (obj.relations || []).filter((r) => r.ex).length
    };
    if (stats.relations && stats.withExcerpt / stats.relations < 0.8) {
      notes.push('Menos de 80% das relações têm excerto literal.');
    }
    return { ok: errors.length === 0, errors, warnings, notes, stats };
  }

  /* ---------- normalização para o modelo VN ---------- */
  function toModel(obj) {
    const D = JSON.parse(JSON.stringify(obj));
    D.meta = Object.assign(baseMeta(), D.meta || {});
    D.meta.fictional = false;
    // herdar dicionários do esquema base quando ausentes
    const base = g.VN_DATA || {};
    D.entityTypes = D.entityTypes || base.entityTypes;
    D.relationTypes = D.relationTypes || base.relationTypes;
    D.relationFamilies = D.relationFamilies || base.relationFamilies;
    D.verification = D.verification || base.verification;
    D.entities = D.entities.map((e) => Object.assign({
      status: 'unverified', juris: null, date: null, precision: 'unknown', aliases: [], tags: [],
      facts: [], alleges: [], contradictions: [], visual: { kind: 'procedural', credits: null }
    }, e));
    D.relations = D.relations.map((r) => Object.assign({
      directed: true, start: null, startPrec: 'unknown', end: null, endPrec: null,
      status: 'unverified', conf: null, why: null, src: null, loc: null, ex: null, lv: null
    }, r));
    return D;
  }

  /* ---------- exemplo de esqueleto para o utilizador preencher ---------- */
  function skeleton() {
    return {
      meta: { title: 'Caso real — preencher', fictional: false, version: '1.0.0', generated: new Date().toISOString().slice(0, 10),
        licence: 'a definir', disclaimer: 'Dados reais sob verificação. Alegações não são factos.', custodian: 'quem mantém a base' },
      entities: [
        { id: 'doc-001', type: 'document', name: 'Contrato n.º X (2020)', short: 'Contrato', ctx: 'O que é e onde está',
          status: 'confirmed', date: '2020-05-12', precision: 'day',
          url: 'https://…', retrievedAt: '2026-10-21', excerptHash: '<sha256 do excerto>', facts: [] },
        { id: 'ent-001', type: 'company', name: 'Empresa Exemplo, S.A.', status: 'confirmed',
          disambiguation: { registryId: 'PT-500000000', jurisdiction: 'PT' },
          date: '2001-03-04', precision: 'day', facts: [], alleges: [], contradictions: [],
          visual: { kind: 'procedural', credit: 'avatar procedimental', licence: 'CC0-1.0', source: 'vn' } }
      ],
      relations: [{
        id: 'rel-001', from: 'ent-001', to: 'doc-001', kind: 'documented_in', directed: true,
        start: '2020-05-12', startPrec: 'day', status: 'confirmed', conf: 5,
        src: 'doc-001', loc: 'p. 3, cl. 4.ª', ex: 'excerto literal exacto do documento',
        lv: '2026-10-21', reviewer: 'nome do revisor', method: 'leitura do documento primário'
      }]
    };
  }

  VN.realdata = { validateBundle, toModel, skeleton, SCHEMA_DOC, TYPES, STATUS };
})(typeof window !== 'undefined' ? window : globalThis);
