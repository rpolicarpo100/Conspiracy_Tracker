/* =====================================================================
   VN · MODELO DE DADOS
   Camada independente da biblioteca visual. Não conhece Cytoscape.
   Fornece: normalização, índices, validação e utilitários temporais.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});

  const PRECISION = {
    day:   { label: 'Data exacta', short: 'exacta', solid: true },
    month: { label: 'Mês (dia não confirmado)', short: 'mês', solid: false },
    year:  { label: 'Ano estimado', short: 'ano', solid: false },
    unknown: { label: 'Data desconhecida', short: 'desconhecida', solid: false }
  };

  function timeOf(d) {
    if (!d) return null;
    const s = String(d);
    const m = s.match(/^(-?\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
    if (!m) return null;
    const y = +m[1];
    const mo = m[2] ? +m[2] : (String(m[2] || '').length ? +m[2] : 7);
    const da = m[3] ? +m[3] : 15;
    return Date.UTC(y, (m[2] ? mo : 7) - 1, m[3] ? da : 15);
  }
  const yearOf = (d) => (d && /^\d{4}/.test(String(d)) ? +String(d).slice(0, 4) : null);

  function normalize(raw) {
    const types = raw.entityTypes || {};
    const relTypes = raw.relationTypes || {};
    const verification = raw.verification || {};
    const families = raw.relationFamilies || {};

    const entities = raw.entities.map((e) => Object.assign({}, e, {
      typeLabel: (types[e.type] || {}).label || e.type,
      typeColor: (types[e.type] || {}).color || '#94a3b8',
      statusLabel: (verification[e.status] || {}).label || e.status,
      statusColor: (verification[e.status] || {}).color || '#94a3b8',
      year: yearOf(e.date),
      t: timeOf(e.date),
      precisionLabel: (PRECISION[e.precision] || PRECISION.unknown).label
    }));

    const byId = new Map(entities.map((e) => [e.id, e]));

    const relations = raw.relations.map((r) => {
      const rt = relTypes[r.kind] || { label: r.kind, family: 'documental' };
      const fam = families[rt.family] || { label: rt.family, color: '#94a3b8' };
      const st = verification[r.status] || { label: r.status, color: '#94a3b8', weight: 0 };
      return Object.assign({}, r, {
        kindLabel: rt.label,
        family: rt.family,
        familyLabel: fam.label,
        familyColor: fam.color,
        statusLabel: st.label,
        statusColor: st.color,
        statusWeight: st.weight,
        fromName: (byId.get(r.from) || {}).name || r.from,
        toName: (byId.get(r.to) || {}).name || r.to,
        fromType: (byId.get(r.from) || {}).type || 'unknown',
        toType: (byId.get(r.to) || {}).type || 'unknown',
        tStart: timeOf(r.start),
        tEnd: timeOf(r.end),
        yStart: yearOf(r.start),
        yEnd: yearOf(r.end),
        hasDates: !!(r.start || r.end),
        startPrecisionLabel: (PRECISION[r.startPrec] || PRECISION.unknown).label
      });
    });
    const relById = new Map(relations.map((r) => [r.id, r]));

    // índices de adjacência (dirigidos e não dirigidos)
    const adj = new Map(), radj = new Map(), neighbors = new Map();
    entities.forEach((e) => { adj.set(e.id, []); radj.set(e.id, []); neighbors.set(e.id, []); });
    relations.forEach((r) => {
      if (!adj.has(r.from) || !adj.has(r.to)) return;
      adj.get(r.from).push(r);
      radj.get(r.to).push(r);
      neighbors.get(r.from).push(r);
      neighbors.get(r.to).push(r);
    });

    const docs = entities.filter((e) => e.type === 'document');
    const docSet = new Set(docs.map((d) => d.id));

    // agregados por entidade
    const stats = new Map();
    entities.forEach((e) => {
      const rels = neighbors.get(e.id) || [];
      const byStatus = {};
      rels.forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
      const money = { in: 0, out: 0 };
      rels.forEach((r) => {
        if (typeof r.amount === 'number' && r.currency === 'EUR') {
          if (r.to === e.id) money.in += r.amount; else if (r.from === e.id) money.out += r.amount;
        }
      });
      const sources = new Set();
      rels.forEach((r) => { if (r.src && docSet.has(r.src)) sources.add(r.src); });
      const docsLinked = new Set();
      rels.forEach((r) => {
        if (docSet.has(r.to)) docsLinked.add(r.to);
        if (docSet.has(r.from)) docsLinked.add(r.from);
      });
      stats.set(e.id, {
        degree: rels.length,
        confirmed: byStatus.confirmed || 0,
        probable: byStatus.probable || 0,
        alleged: byStatus.alleged || 0,
        unverified: byStatus.unverified || 0,
        contradicted: byStatus.contradicted || 0,
        byStatus: byStatus,
        moneyIn: money.in,
        moneyOut: money.out,
        sources: sources,
        documents: docsLinked
      });
    });

    const validation = validate({ entities, relations, byId, relById, docSet });

    return {
      meta: raw.meta, entityTypes: types, relationTypes: relTypes,
      relationFamilies: families, verification, precisionTypes: PRECISION,
      entities, relations, byId, relById, adj, radj, neighbors,
      stats, docSet, validation,
      counts: countBy(entities, (e) => e.type),
      relCounts: countBy(relations, (r) => r.kind),
      statusCounts: countBy(relations, (r) => r.status),
      yearRange: yearRange(entities, relations),
      timeline: timelineDomain(entities, relations),
      issuedAt: raw.meta && raw.meta.generated
    };
  }

  function countBy(arr, f) {
    const o = {};
    arr.forEach((x) => { const k = f(x); o[k] = (o[k] || 0) + 1; });
    return o;
  }

  function yearRange(entities, relations) {
    const ys = [];
    entities.forEach((e) => { if (e.year) ys.push(e.year); });
    relations.forEach((r) => { if (r.yStart) ys.push(r.yStart); if (r.yEnd) ys.push(r.yEnd); });
    const now = new Date().getUTCFullYear();
    ys.push(now);
    return { min: Math.min.apply(null, ys), max: Math.max.apply(null, ys) };
  }

  /* Domínio da cronologia: usa datas de relações, documentos, acontecimentos e
     transacções. Datas de nascimento/fundação muito antigas não distorcem a régua;
     limites de contratos futuros são truncados em actual+2. */
  function timelineDomain(entities, relations) {
    const now = new Date().getUTCFullYear();
    // O domínio é definido pelas RELAÇÕES datadas (o que o grafo pode mostrar);
    // datas antigas de fundação/nascimento não esticam a régua.
    const ys = [];
    relations.forEach((r) => {
      if (r.yStart && r.yStart >= 1900) ys.push(r.yStart);
      if (r.yEnd && r.yEnd >= 1900) ys.push(Math.min(r.yEnd, now + 2));
    });
    if (!ys.length) {
      entities.forEach((e) => {
        if (!e.year || e.year < 1900) return;
        if (['document', 'event', 'transaction'].includes(e.type)) ys.push(Math.min(e.year, now + 2));
      });
    }
    if (!ys.length) return { min: 1990, max: now, offRange: 0 };
    const sorted = ys.slice().sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
    let min = q(0.02), max = Math.max(q(0.98), now);
    // se a cauda alarga demasiado a régua, usar o intervalo que contém a grande maioria
    // e declarar quantas relações ficam fora (nunca esconder: contam-se e podem ser mostradas)
    if (max - min > 40) { min = Math.max(q(0.05), q(0.02)); }
    const offRange = relations.filter((r) => {
      if (!r.yStart && !r.yEnd) return false;
      const s0 = r.yStart != null ? r.yStart : -Infinity;
      const e0 = r.yEnd != null ? r.yEnd : Infinity;
      return !(s0 <= max && e0 >= min);
    }).length;
    return { min: min, max: max, offRange: offRange, fullMin: Math.min.apply(null, ys), fullMax: Math.max.apply(null, ys.concat([now])) };
  }

  /* Regras de integridade do modelo — expostas na UI em "Qualidade dos dados". */
  function validate(m) {
    const issues = [];
    const ids = new Set();
    m.entities.forEach((e) => {
      if (ids.has(e.id)) issues.push({ level: 'error', msg: 'Identificador duplicado: ' + e.id, ref: e.id });
      ids.add(e.id);
      if (!e.name) issues.push({ level: 'error', msg: 'Entidade sem nome: ' + e.id, ref: e.id });
      if (!m.entityTypes ? false : false) {}
      if (!e.visual) issues.push({ level: 'warn', msg: 'Entidade sem representação visual: ' + e.name, ref: e.id });
      else if (e.visual.kind === 'image' && !e.visual.licence)
        issues.push({ level: 'error', msg: 'Imagem sem licença declarada: ' + e.name, ref: e.id });
      else if (e.visual.kind === 'image' && !e.visual.credit)
        issues.push({ level: 'error', msg: 'Imagem sem crédito/atribuição: ' + e.name, ref: e.id });
    });
    m.relations.forEach((r) => {
      if (!m.byId.has(r.from) || !m.byId.has(r.to))
        issues.push({ level: 'error', msg: 'Relação ' + r.id + ' referencia entidade inexistente', ref: r.id });
      if (r.from === r.to) issues.push({ level: 'warn', msg: 'Auto-relação: ' + r.id, ref: r.id });
      if (!r.src && r.status === 'confirmed')
        issues.push({ level: 'error', msg: 'Relação confirmada sem fonte documental: ' + r.id, ref: r.id });
      if (r.src && !m.docSet.has(r.src)) {
        const s0 = m.byId.get(r.src);
        if (!s0 || !['transaction', 'event'].includes(s0.type))
          issues.push({ level: 'warn', msg: 'Fonte não é um nó de documento nem registo de operação: ' + r.id, ref: r.id });
      }
      if ((r.status === 'probable' || r.status === 'alleged' || r.status === 'unverified') && !r.why)
        issues.push({ level: 'warn', msg: 'Relação ' + r.id + ' (' + r.status + ') sem justificação de confiança', ref: r.id });
      if (!r.ex && r.status !== 'unverified')
        issues.push({ level: 'warn', msg: 'Relação ' + r.id + ' sem excerto de suporte', ref: r.id });
      if (r.tStart && r.tEnd && r.tStart > r.tEnd)
        issues.push({ level: 'error', msg: 'Intervalo de datas invertido: ' + r.id, ref: r.id });
    });
    // homónimos: nomes iguais ou demasiado próximos
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim();
    const seen = new Map();
    m.entities.forEach((e) => {
      const k = norm(e.name);
      if (seen.has(k)) issues.push({ level: 'error', msg: 'Possível homónimo não resolvido: ' + e.name, ref: e.id });
      seen.set(k, e.id);
    });
    return {
      errors: issues.filter((i) => i.level === 'error'),
      warnings: issues.filter((i) => i.level === 'warn'),
      all: issues
    };
  }

  /* Uma relação é considerada válida num período se os seus limites o intersectam.
     Datas desconhecidas NÃO são projectadas silenciosamente: ficam marcadas. */
  function relationValidAt(r, fromT, toT) {
    if (fromT == null && toT == null) return { ok: true, certainty: 'all' };
    if (!r.tStart && !r.tEnd) return { ok: true, certainty: 'unknown' };
    const s = r.tStart != null ? r.tStart : -Infinity;
    const e = r.tEnd != null ? r.tEnd : Infinity;
    const f = fromT != null ? fromT : -Infinity;
    const t = toT != null ? toT : Infinity;
    const ok = s <= t && e >= f;
    return { ok: ok, certainty: (r.tStart && r.tEnd) ? 'closed' : (r.tStart ? 'open-start' : 'open-end') };
  }

  VN.model = { normalize, timeOf, yearOf, PRECISION, relationValidAt, countBy };
})(typeof window !== 'undefined' ? window : globalThis);
