/* =====================================================================
   VN · CONSULTAS
   Pesquisa, filtros, caminhos, ligações comuns, séries temporais.
   Tudo devolve dados simples — nenhuma dependência visual.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const { relationValidAt, timeOf } = VN.model;

  const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

  /* ---------- Pesquisa global com pontuação ---------- */
  function search(model, q, opts) {
    opts = opts || {};
    if (VN.index && VN.search && model) {
      if (!model._searchIndex) model._searchIndex = VN.index.build(model);
      return VN.search.simple(model._searchIndex, q, opts.limit || 30);
    }
    const nq = norm(q);
    if (!nq) return [];
    const lim = opts.limit || 30;
    const out = [];
    model.entities.forEach((e) => {
      const name = norm(e.name);
      const aliases = (e.aliases || []).map(norm);
      const tags = (e.tags || []).map(norm);
      const short = norm(e.short);
      let score = 0, why = '';
      if (name === nq) { score = 1000; why = 'nome exacto'; }
      else if (aliases.indexOf(nq) >= 0) { score = 900; why = 'alias exacto'; }
      else if (name.startsWith(nq)) { score = 800; why = 'nome começa por'; }
      else if (name.indexOf(nq) >= 0) { score = 650; why = 'nome contém'; }
      else if (aliases.some((a) => a.indexOf(nq) >= 0)) { score = 550; why = 'alias contém'; }
      else if (short.indexOf(nq) >= 0) { score = 380; why = 'descrição'; }
      else if (tags.some((t) => t.indexOf(nq) >= 0)) { score = 300; why = 'etiqueta'; }
      else if (norm(e.id) === nq) { score = 950; why = 'identificador'; }
      else {
        const ctx = norm((e.ctx || '') + ' ' + (e.facts || []).join(' '));
        if (ctx.indexOf(nq) >= 0) { score = 180; why = 'contexto'; }
      }
      if (score) {
        const st = model.stats.get(e.id) || { degree: 0 };
        out.push({ entity: e, score: score + Math.min(60, st.degree * 2), why: why });
      }
    });
    return out.sort((a, b) => b.score - a.score).slice(0, lim);
  }

  /* ---------- Filtros → conjuntos visíveis ----------
     Não remove do modelo: devolve máscaras para que o grafo possa
     manter contexto (nós esbatidos) em vez de "desaparecer" evidência. */
  function applyFilters(model, f) {
    const tFrom = f.yearFrom != null ? Date.UTC(f.yearFrom, 0, 1) : null;
    const tTo = f.yearTo != null ? Date.UTC(f.yearTo + 1, 0, 1) - 1 : null;
    const typeAllow = f.types && f.types.size ? f.types : null;
    const famAllow = f.families && f.families.size ? f.families : null;
    const statusAllow = f.statuses && f.statuses.size ? f.statuses : null;
    const srcAllow = f.sources && f.sources.size ? f.sources : null;
    const q = norm(f.text || '');

    const visibleEdges = new Set();
    const edgeTemporal = new Map();
    model.relations.forEach((r) => {
      if (typeAllow && (!typeAllow.has(r.fromType) || !typeAllow.has(r.toType))) return;
      if (famAllow && !famAllow.has(r.family)) return;
      if (f.kinds && f.kinds.size && !f.kinds.has(r.kind)) return;
      if (statusAllow && !statusAllow.has(r.status)) return;
      if (srcAllow && !(r.src && srcAllow.has(r.src))) return;
      if (q && norm([r.kindLabel, r.ex, r.fromName, r.toName].join(' ')).indexOf(q) < 0) return;
      const tv = relationValidAt(r, tFrom, tTo);
      if (!tv.ok) return;
      edgeTemporal.set(r.id, tv.certainty);
      visibleEdges.add(r.id);
    });

    // nós: visíveis se pertencem ao tipo permitido e têm pelo menos uma aresta visível
    // (ou se são âncoras fixadas pelo utilizador)
    const touched = new Set();
    model.relations.forEach((r) => {
      if (!visibleEdges.has(r.id)) return;
      touched.add(r.from); touched.add(r.to);
    });
    const visibleNodes = new Set();
    model.entities.forEach((e) => {
      if (typeAllow && !typeAllow.has(e.type)) return;
      if (!touched.has(e.id)) return;
      if (f.docsOnly) {
        const st = model.stats.get(e.id);
        if (!st || st.documents.size === 0) return;
      }
      visibleNodes.add(e.id);
    });
    (f.pinned || []).forEach((id) => { if (model.byId.has(id)) visibleNodes.add(id); });
    return { nodes: visibleNodes, edges: visibleEdges, temporal: edgeTemporal };
  }

  /* ---------- Caminhos documentados ----------
     Enumera caminhos simples até maxSteps, com orçamento de exploração.
     Cada caminho recebe uma nota de *qualidade de evidência*, nunca de
     "culpa" ou "coordenação". */
  function findPaths(model, fromId, toId, opts) {
    opts = opts || {};
    const maxSteps = Math.min(6, Math.max(1, opts.maxSteps || 4));
    const limit = opts.limit || 12;
    const budget = opts.budget || 60000;
    const allowed = opts.allowedEdges || null;   // Set de ids de relação (filtros activos)
    const both = opts.direction === 'both';
    if (!model.byId.has(fromId) || !model.byId.has(toId)) return { paths: [], explored: 0, truncated: false };

    const paths = [];
    let explored = 0, truncated = false;
    const stack = [{ node: fromId, nodes: [fromId], rels: [], visited: new Set([fromId]) }];

    while (stack.length) {
      if (explored >= budget) { truncated = true; break; }
      const cur = stack.pop();
      explored++;
      if (cur.rels.length >= maxSteps) continue;
      const incident = model.neighbors.get(cur.node) || [];
      for (const r of incident) {
        if (allowed && !allowed.has(r.id)) continue;
        // respeitar direcção se o utilizador pediu caminho dirigido
        let next;
        if (r.from === cur.node) next = r.to;
        else if (both || r.to === cur.node) next = r.from;
        else continue;
        if (next === cur.node) continue;
        const nextNode = model.byId.get(next);
        if (!nextNode) continue;
        if (opts.types && opts.types.size && !opts.types.has(nextNode.type)) continue;
        if (cur.visited.has(next)) continue;
        const rels = cur.rels.concat([r]);
        const nodes = cur.nodes.concat([next]);
        if (next === toId) {
          paths.push(scorePath(model, nodes, rels, fromId, toId));
          if (paths.length >= limit * 4) { truncated = true; }
        } else {
          const vis = new Set(cur.visited); vis.add(next);
          stack.push({ node: next, nodes: nodes, rels: rels, visited: vis });
        }
      }
      if (truncated && paths.length >= limit) break;
    }

    paths.sort((a, b) => b.score - a.score || a.hops - b.hops);
    // desduplicar por assinatura de relações
    const seen = new Set();
    const uniq = paths.filter((p) => {
      const k = p.rels.map((r) => r.id).join('>');
      if (seen.has(k)) return false; seen.add(k); return true;
    });
    return { paths: uniq.slice(0, limit), explored: explored, truncated: truncated, totalFound: uniq.length };
  }

  function scorePath(model, nodes, rels, fromId, toId) {
    const weightOf = (r) => (r.statusWeight != null ? r.statusWeight : 0);
    const minStatus = rels.reduce((m, r) => (weightOf(r) < weightOf(m) ? r : m), rels[0]);
    const counts = {};
    rels.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const confs = rels.map((r) => (typeof r.conf === 'number' ? r.conf : 3));
    const avgConf = confs.reduce((a, b) => a + b, 0) / confs.length;
    const sourced = rels.filter((r) => r.src).length;
    const documented = rels.filter((r) => r.ex).length;
    // qualidade = elo mais fraco (peso), confiança média, cobertura documental, penalização por passos
    const score = (weightOf(minStatus) * 22) + (avgConf * 10) + (sourced / rels.length) * 12 +
      (documented / rels.length) * 8 - (rels.length - 1) * 7;
    const dates = rels.map((r) => r.start).filter(Boolean).sort();
    return {
      nodes: nodes, rels: rels, hops: rels.length,
      score: Math.round(score * 10) / 10,
      minStatus: minStatus.status,
      weakest: minStatus,
      counts: counts,
      avgConf: Math.round(avgConf * 10) / 10,
      sourcedRatio: sourced / rels.length,
      hasUndated: rels.some((r) => !r.hasDates),
      hasUnverified: rels.some((r) => r.status === 'unverified'),
      hasAlleged: rels.some((r) => r.status === 'alleged'),
      hasContradicted: rels.some((r) => r.status === 'contradicted'),
      chronological: isChronological(rels),
      firstDate: dates[0] || null,
      lastDate: dates[dates.length - 1] || null
    };
  }

  function isChronological(rels) {
    const ts = rels.map((r) => r.tStart).filter((t) => t != null);
    for (let i = 1; i < ts.length; i++) if (ts[i] < ts[i - 1]) return false;
    return ts.length >= 2;
  }

  /* ---------- Ligações comuns ---------- */
  function commonNeighbors(model, a, b, opts) {
    opts = opts || {};
    const na = new Map();
    (model.neighbors.get(a) || []).forEach((r) => {
      const other = r.from === a ? r.to : r.from;
      if (!na.has(other)) na.set(other, []);
      na.get(other).push(r);
    });
    const nb = new Map();
    (model.neighbors.get(b) || []).forEach((r) => {
      const other = r.from === b ? r.to : r.from;
      if (!nb.has(other)) nb.set(other, []);
      nb.get(other).push(r);
    });
    const out = [];
    na.forEach((ra, id) => {
      if (!nb.has(id) || id === a || id === b) return;
      const e = model.byId.get(id);
      const rels = ra.concat(nb.get(id));
      const direct = false;
      out.push({
        entity: e, relsA: ra, relsB: nb.get(id), rels: rels, direct: direct,
        weight: rels.length,
        strongest: rels.reduce((m, r) => (r.statusWeight > m.statusWeight ? r : m), rels[0]),
        score: rels.reduce((s, r) => s + r.statusWeight, 0) / rels.length
      });
    });
    out.sort((x, y) => y.score - x.score || y.weight - x.weight);
    return out.slice(0, opts.limit || 25);
  }

  /* ---------- Série temporal ---------- */
  function timelineSeries(model, opts) {
    opts = opts || {};
    const min = opts.min != null ? opts.min : model.timeline.min;
    const max = opts.max != null ? opts.max : model.timeline.max;
    const years = [];
    for (let y = min; y <= max; y++) years.push(y);
    const buckets = years.map((y) => ({
      year: y,
      relations: 0, relationsExact: 0, documents: 0, events: 0, transactions: 0, persons: 0
    }));
    const idx = (y) => (y >= min && y <= max ? y - min : -1);
    model.relations.forEach((r) => {
      if (!r.yStart) return;
      const i = idx(r.yStart);
      if (i < 0) return;
      buckets[i].relations++;
      if (r.startPrec === 'day') buckets[i].relationsExact++;
    });
    model.entities.forEach((e) => {
      if (!e.year) return;
      const i = idx(e.year);
      if (i < 0) return;
      if (e.type === 'document') buckets[i].documents++;
      else if (e.type === 'event') buckets[i].events++;
      else if (e.type === 'transaction') buckets[i].transactions++;
      // pessoas/fundações: a data é biográfica e não é marcada na régua
    });
    return { years: years, buckets: buckets };
  }

  /* ---------- Agregações para dashboard ---------- */
  function overview(model) {
    const money = { total: 0, flows: [] };
    model.relations.forEach((r) => {
      if (typeof r.amount === 'number' && r.currency === 'EUR') {
        money.total += r.amount;
        money.flows.push(r);
      }
    });
    const byType = {};
    Object.keys(model.entityTypes).forEach((t) => { byType[t] = 0; });
    model.entities.forEach((e) => { byType[e.type] = (byType[e.type] || 0) + 1; });
    const undocumented = model.relations.filter((r) => !r.src).length;
    const top = model.entities.map((e) => ({ entity: e, stats: model.stats.get(e.id) }))
      .sort((a, b) => b.stats.degree - a.stats.degree).slice(0, 8);
    return {
      byType: byType, money: money, undocumented: undocumented, top: top,
      relations: model.relations.length, entities: model.entities.length,
      confirmed: model.statusCounts.confirmed || 0,
      unverified: (model.statusCounts.unverified || 0) + (model.statusCounts.alleged || 0) +
        (model.statusCounts.contradicted || 0),
      sources: model.docSet.size,
      timeline: model.timeline
    };
  }

  VN.query = { search, applyFilters, findPaths, scorePath, commonNeighbors, timelineSeries, overview, norm };
})(typeof window !== 'undefined' ? window : globalThis);
