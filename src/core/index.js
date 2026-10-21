/* =====================================================================
   VN · ÍNDICE DE PESQUISA
   Indexação invertida com posições: permite relevância (tf-idf),
   frases exactas, excertos com contexto e correspondência aproximada
   (erros ortográficos) sem nunca fundir entidades.
   Construído uma vez por modelo; independente da biblioteca visual.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});

  /* ---------- normalização ---------- */
  const strip = (s) => String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')      // remove acentos
    .replace(/[«»""'']/g, ' ')
    .replace(/[^a-z0-9%,.\-\s]/g, ' ')
    .replace(/[.,;:](?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const STOP = new Set(('a o e de da do das dos em no na nos nas por para com sem que se um uma uns umas os as ao aos ' +
    'é são foi ser estar esta este estas estes mais menos como onde qual quais sobre entre até após ante ' +
    'the of and to in on for with').split(' '));

  /* Sinónimos conservadores, apenas dentro do mesmo sentido documental.
     Nunca ligam pessoas nem entidades — só termos. */
  const SYNONYMS = {
    accionista: ['acionista', 'accionistas', 'participacao', 'shareholder'],
    accionistas: ['acionistas', 'participacao'],
    participacao: ['accionista', 'quota', 'capital'],
    financiou: ['financiamento', 'financiar', 'emprestimo', 'lent'],
    financiamento: ['financiou', 'emprestimo', 'credito'],
    emprestimo: ['financiamento', 'credito'],
    contrato: ['contratual', 'contratos', 'adjudicacao'],
    contratos: ['contrato', 'contratual'],
    tribunal: ['judicial', 'justica', 'court'],
    judicial: ['tribunal', 'justica'],
    sentenca: ['decisao', 'julgamento', 'acordao'],
    acusacao: ['arguido', 'acusado', 'imputacao'],
    arguido: ['acusado', 'acusacao'],
    fundacao: ['foundation', 'eclesiastica'],
    diocese: ['bispo', 'eclesiastica'],
    bispo: ['diocese'],
    camara: ['municipio', 'municipal', 'autarquia'],
    municipio: ['camara', 'municipal'],
    governo: ['estado', 'publico', 'ministerio'],
    offshore: ['luxemburgo', 'fiduciaria', 'veiculo'],
    beneficiario: ['efectivo', 'efetivo', 'be'],
    lobbie: ['lobbying', 'influencia', 'reuniao'],
    lobby: ['lobbying', 'influencia'],
    energia: ['energetico', 'electricidade'],
    autoestrada: ['concessao', 'infraestrutura', 'estrada']
  };

  /* ---------- tokenização com posições e deslocamentos ---------- */
  function tokenize(text) {
    const orig = String(text == null ? '' : text);
    // mapa de caracteres normalizados para posições originais
    const norm = [];
    const map = [];
    for (let i = 0; i < orig.length; i++) {
      const ch = orig[i];
      const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      for (let k = 0; k < base.length; k++) {
        if (/[a-z0-9%]/.test(base[k])) { norm.push(base[k]); map.push(i); }
        else { norm.push(' '); map.push(i); }
      }
    }
    const s = norm.join('').replace(/\s+/g, ' ');
    const out = [];
    let pos = 0;
    const re = /[a-z0-9%]+/g;
    let m;
    while ((m = re.exec(s))) {
      const tok = m[0];
      // posição original aproximada
      const start = map[m.index] != null ? map[m.index] : 0;
      const end = map[m.index + tok.length - 1] != null ? map[m.index + tok.length - 1] + 1 : orig.length;
      if (tok.length >= 3 && !STOP.has(tok)) out.push({ t: tok, pos: pos++, start: start, end: end });
      else if (/^\d{4}$/.test(tok)) out.push({ t: tok, pos: pos++, start: start, end: end });
    }
    return { tokens: out, original: orig, normalised: s };
  }

  /* ---------- similaridade para erros ortográficos ---------- */
  function trigrams(t) {
    const s = '##' + t + '##';
    const set = new Set();
    for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3));
    return set;
  }
  function dice(a, b) {
    if (a === b) return 1;
    if (Math.abs(a.length - b.length) > 3) return 0;
    const A = trigrams(a), B = trigrams(b);
    let inter = 0;
    A.forEach((x) => { if (B.has(x)) inter++; });
    return (2 * inter) / (A.size + B.size);
  }
  function editDistance(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 2) return 99;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      const t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  /* ---------- pesos por campo ---------- */
  const ENTITY_FIELDS = [
    { key: 'name', weight: 12 },
    { key: 'aliases', weight: 9 },
    { key: 'id', weight: 7 },
    { key: 'short', weight: 4.5 },
    { key: 'tags', weight: 3.5 },
    { key: 'ctx', weight: 2.4 },
    { key: 'facts', weight: 2.2 },
    { key: 'alleges', weight: 2.2 },
    { key: 'contradictions', weight: 2.2 },
    { key: 'juris', weight: 1.6 }
  ];
  const RELATION_FIELDS = [
    { key: 'label', weight: 6 },
    { key: 'ex', weight: 5 },
    { key: 'names', weight: 4 },
    { key: 'why', weight: 2.5 },
    { key: 'loc', weight: 1.8 },
    { key: 'id', weight: 1.5 }
  ];

  function fieldText(doc, key) {
    const v = doc[key];
    if (v == null) return '';
    if (Array.isArray(v)) return v.join(' · ');
    return String(v);
  }

  function build(model, opts) {
    opts = opts || {};
    const docs = [];          // documentos indexados
    const postings = new Map(); // token -> Map(docIndex -> { tf, fields:Set, pos:[] })
    const dict = new Map();     // token -> df (para fuzzy)

    function addDoc(doc, fieldSpec) {
      const idx = docs.length;
      const fields = {};
      const tokensAll = [];
      fieldSpec.forEach((f) => {
        const text = fieldText(doc, f.key);
        if (!text) return;
        const { tokens, original } = tokenize(text);
        fields[f.key] = { text: original, weight: f.weight, tokens: tokens };
        tokens.forEach((tk) => tokensAll.push(Object.assign({ field: f.key }, tk)));
      });
      doc._fieldSpec = fieldSpec;
      doc._fields = fields;
      doc._tokens = tokensAll;
      docs.push(doc);
      const seen = new Set();
      tokensAll.forEach((tk) => {
        let m = postings.get(tk.t);
        if (!m) { m = new Map(); postings.set(tk.t, m); }
        let p = m.get(idx);
        if (!p) { p = { tf: 0, fields: new Set(), pos: [] }; m.set(idx, p); }
        p.tf += 1;
        p.fields.add(tk.field);
        p.pos.push(tk.pos);
        if (!seen.has(tk.t)) { seen.add(tk.t); dict.set(tk.t, (dict.get(tk.t) || 0) + 1); }
      });
    }

    (model.entities || []).forEach((e) => {
      addDoc({
        kind: 'entity', ref: e.id, entity: e,
        name: e.name, aliases: (e.aliases || []).join(' · '), id: e.id, short: e.short || '',
        tags: (e.tags || []).join(' · '), ctx: e.ctx || '',
        facts: (e.facts || []).join(' · '), alleges: (e.alleges || []).join(' · '),
        contradictions: (e.contradictions || []).join(' · '), juris: e.juris || '',
        type: e.type, status: e.status, year: e.year || null, precision: e.precision || null
      }, ENTITY_FIELDS);
    });

    (model.relations || []).forEach((r) => {
      addDoc({
        kind: 'relation', ref: r.id, relation: r,
        label: r.kindLabel + ' ' + r.familyLabel, ex: r.ex || '',
        names: r.fromName + ' ' + r.toName, why: r.why || '', loc: r.loc || '', id: r.id,
        type: r.family, status: r.status, year: r.yStart || null,
        from: r.from, to: r.to, source: r.src || null
      }, RELATION_FIELDS);
    });

    const N = Math.max(1, docs.length);
    const idf = (t) => {
      const df = dict.get(t) || 0;
      return df ? Math.log(1 + N / df) : 0;
    };

    return {
      model: model, docs: docs, postings: postings, dict: dict, N: N, idf: idf,
      tokensEquals: postings.size,
      builtAt: new Date().toISOString(),
      /* candidatos aproximados para um termo não encontrado */
      fuzzy(term, limit) {
        limit = limit || 6;
        const cands = [];
        if (term.length < 4) return cands;
        postings.forEach((_m, t) => {
          if (t[0] !== term[0] && t.length > 3) return;      // exige mesma inicial: menos falsos positivos
          const d = dice(term, t);
          if (d >= 0.62) cands.push({ token: t, sim: d, edit: editDistance(term, t), df: dict.get(t) || 0 });
        });
        cands.sort((a, b) => b.sim - a.sim || a.edit - b.edit || b.df - a.df);
        return cands.slice(0, limit);
      },
      suggest(term) {
        const c = this.fuzzy(term, 4);
        if (c.length) return c[0].token;
        // recurso: mistura semelhança de trigramas e distância de edição normalizada.
        // Só é proposta uma sugestão — nunca é aplicada sem o utilizador aceitar.
        if (term.length < 6) return null;
        let best = null;
        postings.forEach((_m, t) => {
          if (t[0] !== term[0]) return;
          if (Math.abs(t.length - term.length) > 3) return;
          const sim = Math.max(dice(term, t), 1 - editDistance(term, t) / Math.max(term.length, t.length));
          if (sim >= 0.55 && (!best || sim > best.sim || (sim === best.sim && (dict.get(t) || 0) > best.df))) {
            best = { token: t, sim: sim, df: dict.get(t) || 0 };
          }
        });
        return best ? best.token : null;
      },
      synonymsOf(token) {
        const s = SYNONYMS[token] || [];
        // plural simples
        const alt = token.endsWith('s') ? token.slice(0, -1) : token + 's';
        return Array.from(new Set(s.concat([alt]).filter((x) => x !== token)));
      },
      stats() {
        return { documents: docs.length, tokens: postings.size, vocabulary: dict.size, entities: (model.entities || []).length, relations: (model.relations || []).length };
      }
    };
  }

  VN.index = { build, tokenize, strip, dice, editDistance, STOP, SYNONYMS, ENTITY_FIELDS, RELATION_FIELDS };
})(typeof window !== 'undefined' ? window : globalThis);
