/* =====================================================================
   VN · MOTOR DE PESQUISA
   Sintaxe: termos, "frases exactas", -exclusão, e filtros por campo:
     tipo:pessoa  estado:alegado  ano:2016-2020  fonte:<nome|id>
     familia:financeira  rel:<tipo>  id:<identificador>  etiqueta:<tag>
   Comportamento: AND por omissão; se não houver resultados, alarga (OR)
   e diz explicitamente que alargou. Nunca funde entidades homónimas:
   correspondências aproximadas são assinaladas, com o termo que falhou e
   a semelhança medida.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});

  const FIELD_ALIASES = {
    tipo: 'type', type: 'type',
    estado: 'status', verif: 'status', verificação: 'status',
    ano: 'year', year: 'year', ano_ini: 'yearFrom', de: 'yearFrom', ate: 'yearTo', até: 'yearTo',
    fonte: 'source', source: 'source', doc: 'source',
    familia: 'family', family: 'family',
    rel: 'rel', relação: 'rel', relacao: 'rel',
    id: 'id',
    etiqueta: 'tag', tag: 'tag',
    lugar: 'juris', juris: 'juris', país: 'juris', pais: 'juris'
  };

  const STATUS_PT = {
    confirmado: 'confirmed', provavel: 'probable', 'provável': 'probable', alegado: 'alleged',
    'nao-verificado': 'unverified', 'não-verificado': 'unverified', verificado: 'confirmed',
    contraditado: 'contradicted', refutado: 'contradicted'
  };
  const TYPE_PT = {
    pessoa: 'person', pessoas: 'person', empresa: 'company', empresas: 'company',
    fundacao: 'foundation', 'fundação': 'foundation', fundacoes: 'foundation',
    organizacao: 'organization', 'organização': 'organization',
    estado: 'government', governo: 'government', publico: 'government', 'público': 'government',
    igreja: 'religious', religioso: 'religious', diocese: 'religious',
    tribunal: 'court', justica: 'court', 'justiça': 'court',
    documento: 'document', documentos: 'document',
    acontecimento: 'event', evento: 'event', acontecimentos: 'event',
    transacao: 'transaction', 'transacção': 'transaction', transaccoes: 'transaction'
  };

  /* ---------------- parser ---------------- */
  function parse(q) {
    const raw = String(q || '').trim();
    const tokens = [];
    const phrases = [];
    const filters = { type: new Set(), status: new Set(), family: new Set(), rel: new Set(), tag: new Set(), juris: new Set() };
    let yearFrom = null, yearTo = null, idQuery = null;
    const sourceTexts = [];
    const negatives = [];

    // frases exactas
    let rest = raw.replace(/"([^"]{2,})"/g, (m, p1) => {
      phrases.push(VN.index.tokenize(p1).tokens.map((t) => t.t).join(' '));
      return ' ';
    });

    rest.split(/\s+/).filter(Boolean).forEach((tok) => {
      const fm = tok.match(/^([a-zA-ZÀ-ÿ_]+):(.+)$/);
      if (fm && FIELD_ALIASES[fm[1].toLowerCase()]) {
        const key = FIELD_ALIASES[fm[1].toLowerCase()];
        const val = fm[2];
        if (key === 'type') TYPE_PT[val.toLowerCase()] ? filters.type.add(TYPE_PT[val.toLowerCase()]) : filters.type.add(val.toLowerCase());
        else if (key === 'status') filters.status.add(STATUS_PT[val.toLowerCase()] || val.toLowerCase());
        else if (key === 'family') filters.family.add(val.toLowerCase());
        else if (key === 'rel') filters.rel.add(val.toLowerCase());
        else if (key === 'tag') filters.tag.add(val.toLowerCase());
        else if (key === 'juris') filters.juris.add(val.toUpperCase());
        else if (key === 'id') idQuery = val.toLowerCase();
        else if (key === 'source') sourceTexts.push(val.toLowerCase());
        else if (key === 'year' || key === 'yearFrom' || key === 'yearTo') {
          const range = val.match(/^(\d{4})\s*[-–]\s*(\d{4})$/);
          if (range) { yearFrom = +range[1]; yearTo = +range[2]; }
          else if (/^\d{4}$/.test(val)) {
            if (key === 'yearTo') yearTo = +val;
            else if (key === 'yearFrom') yearFrom = +val;
            else { yearFrom = +val; yearTo = +val; }
          }
        }
        return;
      }
      if (tok.startsWith('-') && tok.length > 2) { negatives.push(VN.index.strip(tok.slice(1))); return; }
      const norm = VN.index.strip(tok);
      if (norm) tokens.push(norm);
    });

    return {
      raw: raw, terms: Array.from(new Set(tokens)), phrases: phrases, negatives: negatives,
      filters: filters, yearFrom: yearFrom, yearTo: yearTo, idQuery: idQuery, sourceTexts: sourceTexts,
      hasStructured: !!(filters.type.size || filters.status.size || filters.family.size || filters.rel.size ||
        filters.tag.size || filters.juris.size || yearFrom != null || yearTo != null || idQuery || sourceTexts.length),
      isEmpty: !tokens.length && !phrases.length && !filters.type.size && !filters.status.size &&
        !filters.family.size && !filters.rel.size && !filters.tag.size && !filters.juris.size &&
        yearFrom == null && yearTo == null && !idQuery && !sourceTexts.length
    };
  }

  /* ---------------- correspondência de um termo ---------------- */
  function expandTerm(idx, term, opts) {
    const out = [];
    if (idx.postings.has(term)) out.push({ token: term, kind: 'exact', factor: 1 });
    else {
      // plural/singular
      const alt = term.endsWith('s') ? term.slice(0, -1) : term + 's';
      if (idx.postings.has(alt)) out.push({ token: alt, kind: 'flexao', factor: 0.92 });
    }
    if (!out.length && opts.fuzzy !== false) {
      idx.fuzzy(term, 4).forEach((c) => out.push({ token: c.token, kind: 'aproximado', factor: 0.55 + 0.45 * c.sim, sim: c.sim, edit: c.edit }));
    }
    (idx.synonymsOf(term) || []).forEach((syn) => {
      if (idx.postings.has(syn) && !out.some((o) => o.token === syn)) out.push({ token: syn, kind: 'sinonimo', factor: 0.5 });
    });
    return out;
  }

  /* ---------------- filtros estruturais ---------------- */
  function passesFilters(doc, parsed, model) {
    const e = doc.entity || null, r = doc.relation || null;
    const f = parsed.filters;
    if (parsed.idQuery && String(doc.ref).toLowerCase().indexOf(parsed.idQuery) < 0) return false;
    if (parsed.yearFrom != null || parsed.yearTo != null) {
      const y = doc.year;
      if (y == null) return false;                        // filtro temporal explícito exclui sem data
      if (parsed.yearFrom != null && y < parsed.yearFrom) return false;
      if (parsed.yearTo != null && y > parsed.yearTo) return false;
    }
    if (parsed.sourceTexts.length) {
      const srcId = r ? r.src : null;
      const srcEntity = srcId ? model.byId.get(srcId) : null;
      const hay = [srcId, srcEntity ? srcEntity.name : '', srcEntity ? (srcEntity.aliases || []).join(' ') : '',
        r ? (r.loc || '') : '', doc.kind === 'entity' && srcEntity ? 'sim' : ''].join(' ').toLowerCase();
      if (!parsed.sourceTexts.every((s) => hay.indexOf(s) >= 0)) return false;
    }
    if (f.type.size) {
      if (!e) {
        // relações: filtro de tipo aplica-se aos extremos
        const from = model.byId.get(r.from), to = model.byId.get(r.to);
        const ok = (from && f.type.has(from.type)) || (to && f.type.has(to.type));
        if (!ok) return false;
      } else if (!f.type.has(e.type)) return false;
    }
    if (f.status.size) {
      const st = e ? e.status : r.status;
      if (!f.status.has(st)) return false;
    }
    if (f.family.size) {
      if (!r || !f.family.has(String(r.family).toLowerCase())) return false;
    }
    if (f.rel.size) {
      if (!r) return false;
      const hay = (r.kind + ' ' + (r.kindLabel || '')).toLowerCase();
      if (!Array.from(f.rel).every((x) => hay.indexOf(x) >= 0)) return false;
    }
    if (f.tag.size) {
      const tags = e ? (e.tags || []).join(' ').toLowerCase() : '';
      if (!Array.from(f.tag).every((x) => tags.indexOf(x) >= 0)) return false;
    }
    if (f.juris.size) {
      const j = e ? String(e.juris || '').toUpperCase() : '';
      if (!f.juris.has(j)) return false;
    }
    return true;
  }

  /* ---------------- pontuação ---------------- */
  function scoreDoc(idx, docIndex, doc, expansions, opts) {
    const why = [];
    let score = 0;
    const matchedFields = new Map();
    let allFound = true;
    const matchedTerms = [];

    expansions.forEach((exp) => {
      let best = null;
      exp.variants.forEach((v) => {
        const m = idx.postings.get(v.token);
        const p = m && m.get(docIndex);
        if (!p) return;
        const weight = Array.from(p.fields).reduce((sum, fkey) => {
          const spec = doc._fieldSpec.find((s) => s.key === fkey);
          return sum + (spec ? spec.weight : 1);
        }, 0);
        const local = idx.idf(v.token) * (1 + Math.log(p.tf)) * weight * v.factor;
        if (!best || local > best.local) best = { local: local, variant: v, posting: p };
      });
      if (!best) {
        if (exp.required) allFound = false;
        return;
      }
      score += best.local;
      matchedTerms.push({ term: exp.term, token: best.variant.token, kind: best.variant.kind, sim: best.variant.sim || null });
      best.posting.fields.forEach((fk) => matchedFields.set(fk, (matchedFields.get(fk) || 0) + 1));
    });

    // frases exactas
    let phraseBonus = 0, phraseHits = 0;
    (opts.phrases || []).forEach((ph) => {
      if (!ph) return;
      const parts = ph.split(' ');
      const n = doc._tokens;
      for (let i = 0; i + parts.length <= n.length; i++) {
        let ok = true;
        for (let k = 0; k < parts.length; k++) if (n[i + k].t !== parts[k]) { ok = false; break; }
        if (ok) { phraseBonus += 26 + parts.length * 4; phraseHits++; why.push('frase exacta: «' + ph + '»'); break; }
      }
    });
    if (opts.requirePhrase && phraseBonus === 0) score = -1;

    // nome exacto / prefixo (só entidades)
    if (doc.kind === 'entity') {
      const nameNorm = VN.index.strip(doc.name);
      const q = opts.normalisedQuery || '';
      if (q && nameNorm === q) { score += 220; why.push('nome exacto'); }
      else if (q && nameNorm.startsWith(q)) { score += 110; why.push('nome começa por'); }
      else if (q && nameNorm.indexOf(q) >= 0) { score += 60; why.push('nome contém'); }
      // bónus de relevância: entidade bem documentada é mais útil como resultado
      const st = opts.model.stats.get(doc.ref);
      if (st) score += Math.min(18, st.degree * 0.8);
      if (doc.entity.status === 'confirmed') score += 4;
    } else {
      // relações com excerto e fonte valem mais: são prova, não pista
      if (doc.relation.src) score += 10;
      if (doc.relation.ex) score += 8;
      if (doc.relation.status === 'confirmed') score += 4;
    }

    score += phraseBonus;

    // explicação legível
    const fieldNames = { name: 'nome', aliases: 'alias', id: 'identificador', short: 'descrição', tags: 'etiqueta', ctx: 'contexto', facts: 'factos', alleges: 'alegações', contradictions: 'contra-provas', juris: 'jurisdição', label: 'tipo de relação', ex: 'excerto', names: 'entidades', why: 'justificação', loc: 'localização' };
    matchedTerms.forEach((mt) => {
      if (mt.kind === 'aproximado') why.push('aproximado: «' + mt.term + '» → ' + mt.token + ' (' + Math.round((mt.sim || 0) * 100) + '% de semelhança)');
      else if (mt.kind === 'sinonimo') why.push('sinónimo: ' + mt.term + ' ≈ ' + mt.token);
      else if (mt.kind === 'flexao') why.push('variação: ' + mt.term + ' → ' + mt.token);
    });
    const fk = Array.from(matchedFields.keys()).map((k) => fieldNames[k] || k);
    if (fk.length) why.unshift('encontrado em: ' + Array.from(new Set(fk)).join(', '));

    // negativos
    const negHit = (opts.negatives || []).some((n) => {
      const m = idx.postings.get(n);
      return m && m.has(docIndex);
    });
    if (negHit) return null;

    return { score: score, why: why, allFound: allFound, phraseHits: phraseHits, fields: matchedFields, matchedTerms: matchedTerms };
  }

  /* ---------------- excertos ---------------- */
  function snippet(doc, matchedTerms, opts) {
    const order = doc.kind === 'entity'
      ? ['ctx', 'facts', 'alleges', 'contradictions', 'short', 'tags', 'aliases', 'name']
      : ['ex', 'why', 'loc', 'names', 'label'];
    const tokensByField = doc._fields;
    // preferir o campo com correspondência
    const preferred = order.filter((k) => tokensByField[k]);
    const tokensWanted = new Set();
    (matchedTerms || []).forEach((mt) => { tokensWanted.add(mt.token); });
    let chosen = null, bestHits = -1;
    preferred.forEach((k) => {
      let hits = 0;
      (tokensByField[k].tokens || []).forEach((t) => { if (tokensWanted.has(t.t)) hits++; });
      if (hits > bestHits) { bestHits = hits; chosen = k; }
    });
    if (!chosen) chosen = preferred[0];
    if (!chosen) return null;
    const f = tokensByField[chosen];
    const text = f.text;
    const max = opts && opts.maxLen ? opts.maxLen : 190;
    if (text.length <= max) return { field: chosen, html: highlight(text, f.tokens, tokensWanted, 0, text.length), truncated: false };
    // janela à volta da primeira correspondência
    const first = (f.tokens || []).find((t) => tokensWanted.has(t.t));
    const center = first ? first.start : 0;
    let start = Math.max(0, center - Math.floor(max * 0.35));
    let end = Math.min(text.length, start + max);
    start = Math.max(0, Math.min(start, text.length - max));
    const pre = start > 0 ? '…' : '';
    const post = end < text.length ? '…' : '';
    return { field: chosen, html: pre + highlight(text, f.tokens, tokensWanted, start, end) + post, truncated: true };
  }

  function highlight(text, tokens, wanted, start, end) {
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const marks = (tokens || []).filter((t) => wanted.has(t.t) && t.start >= start && t.end <= end).sort((a, b) => a.start - b.start);
    let out = '', cursor = start;
    marks.forEach((m) => {
      if (m.start < cursor) return;
      out += esc(text.slice(cursor, m.start)) + '<mark>' + esc(text.slice(m.start, m.end)) + '</mark>';
      cursor = m.end;
    });
    out += esc(text.slice(cursor, end));
    return out;
  }

  /* ---------------- pesquisa principal ---------------- */
  function run(idx, query, opts) {
    opts = opts || {};
    const nowFn = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    const t0 = nowFn();
    const parsed = parse(query);
    if (parsed.isEmpty && !opts.allowEmpty) {
      return { parsed: parsed, results: [], counts: { entities: 0, relations: 0 }, total: 0, expanded: false, negatives: [], suggestions: [], ms: 0 };
    }
    const model = idx.model;

    // expansões por termo
    const expansions = parsed.terms.map((term) => ({ term: term, required: true, variants: expandTerm(idx, term, opts) }));
    const notFound = expansions.filter((e) => !e.variants.length).map((e) => e.term);

    const collect = (expList, requireAll) => {
      const scores = new Map();
      let candidateDocs = null;
      expList.forEach((exp) => {
        const docsFound = new Set();
        exp.variants.forEach((v) => {
          const m = idx.postings.get(v.token);
          if (m) m.forEach((_p, di) => docsFound.add(di));
        });
        if (candidateDocs === null) candidateDocs = docsFound;
        else if (requireAll) candidateDocs = new Set(Array.from(candidateDocs).filter((d) => docsFound.has(d)));
        else docsFound.forEach((d) => candidateDocs.add(d));
      });
      if (candidateDocs === null) candidateDocs = new Set(idx.docs.map((_d, i) => i));
      candidateDocs.forEach((di) => {
        const doc = idx.docs[di];
        if (!passesFilters(doc, parsed, model)) return;
        const s = scoreDoc(idx, di, doc, expList, {
          phrases: parsed.phrases, negatives: parsed.negatives, model: model,
          normalisedQuery: VN.index.strip(parsed.raw)
        });
        if (!s) return;
        if (requireAll && !s.allFound && expList.length > 1) return;
        scores.set(di, s);
      });
      return scores;
    };

    let scores;
    if (parsed.terms.length) {
      scores = collect(expansions, true);
    } else if (parsed.phrases.length) {
      // pergunta só com frase(s): candidatos a partir do primeiro termo da frase,
      // e exigir a frase completa no documento
      const phraseExp = [];
      parsed.phrases.forEach((ph) => {
        const first = ph.split(' ')[0];
        if (first) phraseExp.push({ term: first, required: false, variants: expandTerm(idx, first, opts) });
      });
      scores = new Map();
      idx.docs.forEach((doc, di) => {
        if (!passesFilters(doc, parsed, model)) return;
        const s = scoreDoc(idx, di, doc, phraseExp, { phrases: parsed.phrases, negatives: parsed.negatives, model: model, normalisedQuery: '' });
        if (s && s.score > 0 && s.phraseHits >= parsed.phrases.length) scores.set(di, s);
      });
    } else {
      scores = new Map();
    }
    let expanded = false;
    if (!scores.size && parsed.terms.length > 1) {
      scores = collect(expansions, false);
      expanded = true;
    }
    if (!scores.size && parsed.hasStructured && !parsed.terms.length && !parsed.phrases.length) {
      // apenas filtros estruturais: devolver tudo o que passa
      idx.docs.forEach((doc, di) => {
        if (!passesFilters(doc, parsed, model)) return;
        const s = scoreDoc(idx, di, doc, [], { phrases: [], negatives: parsed.negatives, model: model });
        if (s) scores.set(di, s);
      });
    }

    // ordenar
    const arr = Array.from(scores.entries()).map(([di, s]) => {
      const doc = idx.docs[di];
      return {
        kind: doc.kind, ref: doc.ref,
        score: Math.round(s.score * 10) / 10,
        why: s.why, fields: Array.from(s.fields.keys()),
        entity: doc.entity || null, relation: doc.relation || null,
        snippet: snippet(doc, s.matchedTerms, opts),
        fuzzy: s.matchedTerms.some((mt) => mt.kind === 'aproximado'),
        matchedTerms: s.matchedTerms
      };
    }).sort((a, b) => b.score - a.score);

    let filtered = arr;
    if (opts.kinds && opts.kinds.length) filtered = arr.filter((r) => opts.kinds.indexOf(r.kind) >= 0);
    if (opts.minScore != null) filtered = filtered.filter((r) => r.score >= opts.minScore);
    const limit = opts.limit || 200;
    const results = filtered.slice(0, limit);
    const counts = {
      entities: filtered.filter((r) => r.kind === 'entity').length,
      relations: filtered.filter((r) => r.kind === 'relation').length
    };

    // sugestões
    const suggestions = notFound.map((t) => ({ term: t, suggestion: idx.suggest(t) })).filter((s) => s.suggestion);

    const ms = Math.round(nowFn() - t0);
    return {
      parsed: parsed, results: results, counts: counts, total: filtered.length,
      expanded: expanded, notFound: notFound, suggestions: suggestions, ms: ms,
      totalsAll: { entities: arr.filter((r) => r.kind === 'entity').length, relations: arr.filter((r) => r.kind === 'relation').length },
      searched: {
        documents: idx.docs.length, tokens: idx.postings.size,
        queries: parsed.terms.concat(parsed.phrases.map((p) => '"' + p + '"'))
      }
    };
  }

  /* ---------------- ligações entre resultados ---------------- */
  /* Devolve relações directas, vizinhos comuns e distância mínima entre as
     entidades encontradas. Ligações registadas — não inferidas. */
  function connections(model, ids, opts) {
    opts = opts || {};
    const ents = (ids || []).filter((id) => model.byId.has(id));
    const direct = [];
    const seen = new Set();
    for (let i = 0; i < ents.length; i++) {
      for (let j = i + 1; j < ents.length; j++) {
        (model.neighbors.get(ents[i]) || []).forEach((r) => {
          const other = r.from === ents[i] ? r.to : r.from;
          if (other !== ents[j]) return;
          if (seen.has(r.id)) return;
          seen.add(r.id);
          direct.push(r);
        });
      }
    }
    const shared = new Map();
    const counts = new Map(ents.map((id) => [id, new Set((model.neighbors.get(id) || []).map((r) => (r.from === id ? r.to : r.from)))]));
    ents.forEach((a) => {
      ents.forEach((b) => {
        if (a >= b) return;
        counts.get(a).forEach((n) => {
          if (n === b || counts.get(b).has(n)) {
            if (n === a || n === b) return;
            shared.set(n, (shared.get(n) || 0) + 1);
          }
        });
      });
    });
    const sharedList = Array.from(shared.entries())
      .map(([id, n]) => ({ entity: model.byId.get(id), count: n }))
      .filter((x) => x.entity)
      .sort((x, y) => y.count - x.count).slice(0, opts.limit || 10);

    // distância mínima (BFS) entre os dois primeiros resultados
    let distance = null;
    if (ents.length >= 2) {
      const a = ents[0], b = ents[1];
      const q = [[a, 0]];
      const vis = new Set([a]);
      while (q.length) {
        const [cur, d] = q.shift();
        if (cur === b) { distance = d; break; }
        if (d >= (opts.maxDepth || 4)) continue;
        (model.neighbors.get(cur) || []).forEach((r) => {
          const nx = r.from === cur ? r.to : r.from;
          if (!vis.has(nx)) { vis.add(nx); q.push([nx, d + 1]); }
        });
      }
    }
    return { direct: direct, shared: sharedList, distance: distance, entities: ents };
  }

  /* ---------------- fachas para a página de resultados ---------------- */
  function facets(results, model) {
    const f = { types: {}, statuses: {}, years: {}, families: {} };
    results.forEach((r) => {
      const e = r.entity, rel = r.relation;
      if (e) {
        f.types[e.type] = (f.types[e.type] || 0) + 1;
        f.statuses[e.status] = (f.statuses[e.status] || 0) + 1;
        if (e.year) f.years[e.year] = (f.years[e.year] || 0) + 1;
      } else if (rel) {
        f.statuses[rel.status] = (f.statuses[rel.status] || 0) + 1;
        f.families[rel.family] = (f.families[rel.family] || 0) + 1;
        if (rel.yStart) f.years[rel.yStart] = (f.years[rel.yStart] || 0) + 1;
      }
    });
    return f;
  }

  /* compatibilidade com a API anterior (query.search) */
  function simple(idx, q, limit) {
    const r = run(idx, q, { limit: limit || 30 });
    return r.results.filter((x) => x.kind === 'entity').map((x) => ({ entity: x.entity, score: x.score, why: x.why.join('; '), result: x }));
  }

  VN.search = { parse, run, connections, facets, simple, expandTerm, snippet, highlight, STATUS_PT, TYPE_PT };
})(typeof window !== 'undefined' ? window : globalThis);
