/* =====================================================================
   GRAFO A PARTIR DE PROVAS — regras do servidor.

   Duas proibições que o código impõe:
   1) uma linha nunca é prova: só existe aresta se houver pelo menos uma
      prova registada que a nomeie, e cada aresta devolve os ids dessas provas;
   2) co-ocorrência não é relação: dois nomes que aparecem no mesmo documento
      produzem CANDIDATOS marcados como «não é relação», nunca arestas.

   Homónimos: nomes iguais só são fundidos quando o desambiguador coincide
   (registo, LEI, data de nascimento). Sem desambiguador, o nó é marcado com
   risco de homonímia em vez de se presumir que é a mesma pessoa/empresa.
   ===================================================================== */
import crypto from 'node:crypto';

export const ENTITY_TYPES = {
  person: { label: 'Pessoa', color: '#38bdf8' },
  company: { label: 'Empresa', color: '#818cf8' },
  foundation: { label: 'Fundação', color: '#c084fc' },
  organization: { label: 'Organização', color: '#fbbf24' },
  government: { label: 'Estado / organismo', color: '#2dd4bf' },
  religious: { label: 'Instituição religiosa', color: '#e879f9' },
  court: { label: 'Tribunal / justiça', color: '#f59e0b' },
  media: { label: 'Órgão de comunicação', color: '#f472b6' },
  document: { label: 'Documento', color: '#94a3b8' },
  event: { label: 'Acontecimento', color: '#a3e635' },
  transaction: { label: 'Transacção', color: '#fda4af' },
  asset: { label: 'Bem / activo', color: '#facc15' },
  address: { label: 'Endereço', color: '#a78bfa' },
  account: { label: 'Conta / veículo', color: '#22d3ee' },
  contract: { label: 'Contrato', color: '#fb923c' },
  unknown: { label: 'Tipo por determinar', color: '#64748b' }
};

export const RELATION_TYPES = {
  shareholder_of: { label: 'Participação accionista em', family: 'propriedade', directed: true },
  subsidiary_of: { label: 'É subsidiária de', family: 'propriedade', directed: true },
  owns: { label: 'Detém', family: 'propriedade', directed: true },
  beneficial_owner_of: { label: 'Beneficiário efectivo de', family: 'propriedade', directed: true },
  nominee_for: { label: 'Actua como nomeada de', family: 'propriedade', directed: true },
  held_position: { label: 'Ocupou cargo em', family: 'governança', directed: true },
  board_member: { label: 'Membro de órgão social de', family: 'governança', directed: true },
  appointed: { label: 'Nomeou', family: 'governança', directed: true },
  audited_by: { label: 'Foi auditada por', family: 'governança', directed: true },
  financed: { label: 'Financiou', family: 'financeiro', directed: true },
  lent_to: { label: 'Concedeu empréstimo a', family: 'financeiro', directed: true },
  paid_amount_to: { label: 'Pagou montante a', family: 'financeiro', directed: true },
  donated_to: { label: 'Doou a', family: 'financeiro', directed: true },
  transacted_with: { label: 'Transaccionou com', family: 'financeiro', directed: false },
  contracted_with: { label: 'Contratou com', family: 'contratual', directed: false },
  public_contract_with: { label: 'Contrato público com', family: 'contratual', directed: false },
  represented: { label: 'Representou', family: 'contratual', directed: true },
  litigated_against: { label: 'Litigou contra', family: 'judicial', directed: false },
  investigated_by: { label: 'Foi investigada por', family: 'judicial', directed: true },
  convicted_by: { label: 'Foi condenada por', family: 'judicial', directed: true },
  member_of: { label: 'Membro de', family: 'afiliação', directed: true },
  attended: { label: 'Participou em', family: 'afiliação', directed: true },
  mentioned_in: { label: 'Mencionada em', family: 'documental', directed: true },
  owns_asset: { label: 'É titular de', family: 'propriedade', directed: true }
};

const norm = (s) => String(s == null ? '' : s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

/* Chave do nó: desambiguador quando existe; nome normalizado quando não existe. */
export function entityKey(name, disambiguator) {
  const n = norm(name);
  return disambiguator ? 'id:' + norm(disambiguator) : 'name:' + n;
}

export function validateRelation(input, evidenceById) {
  const errors = [];
  const rel = {
    from: String(input.from || '').trim().slice(0, 200),
    to: String(input.to || '').trim().slice(0, 200),
    /* os desambiguadores viajam com a relação: sem eles a aresta ligaria nós
       diferentes dos que as provas descrevem (e homónimos ficariam ligados) */
    fromDisambiguator: input.fromDisambiguator ? String(input.fromDisambiguator).trim().slice(0, 160) : null,
    toDisambiguator: input.toDisambiguator ? String(input.toDisambiguator).trim().slice(0, 160) : null,
    fromType: ENTITY_TYPES[input.fromType] ? input.fromType : (input.fromType ? 'unknown' : null),
    toType: ENTITY_TYPES[input.toType] ? input.toType : (input.toType ? 'unknown' : null),
    type: String(input.type || '').trim(),
    direction: input.direction === 'mutual' ? 'mutual' : 'directed',
    period: {
      from: input.period && input.period.from ? String(input.period.from).slice(0, 40) : null,
      to: input.period && input.period.to ? String(input.period.to).slice(0, 40) : null
    },
    evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds.slice(0, 50).map(String) : [],
    inferred: input.inferred === true,
    reasoning: String(input.reasoning || '').slice(0, 2000) || null,
    limitations: String(input.limitations || '').slice(0, 1000) || null
  };
  if (!rel.from) errors.push('from é obrigatório');
  if (!rel.to) errors.push('to é obrigatório');
  if (norm(rel.from) === norm(rel.to)) errors.push('uma entidade não pode ser relacionada consigo própria');
  if (!RELATION_TYPES[rel.type]) errors.push('tipo de relação desconhecido (use um de: ' + Object.keys(RELATION_TYPES).join(', ') + ')');
  if (RELATION_TYPES[rel.type] && RELATION_TYPES[rel.type].directed === false && rel.direction !== 'mutual') {
    rel.direction = 'mutual';        // relações simétricas não fingem direcção
  }
  if (!rel.evidenceIds.length) errors.push('uma relação sem prova registada não entra no grafo: indique pelo menos um evidenceId');
  rel.evidenceIds.forEach((id) => {
    if (!evidenceById(id)) errors.push('prova inexistente ou retirada: ' + id);
  });
  if (rel.inferred && !rel.reasoning) errors.push('relação inferida exige o raciocínio por escrito (reasoning)');
  if (!rel.inferred && rel.reasoning) rel.inferred = true;   // declarar raciocínio = assumir inferência
  return { ok: errors.length === 0, errors, relation: rel };
}

/* Factores de confiança de uma aresta: sempre justificados, nunca um número mágico. */
export function edgeConfidence(rels, evidenceList) {
  const usable = evidenceList.filter((e) => !e.retractedAt && e.validationState !== 'fonte-inacessivel');
  const origins = new Set(usable.map((e) => e.originKey || e.canonicalUrl || e.id));
  const contrary = usable.filter((e) => e.stance === 'contraria');
  if (!usable.length) return { level: 'sem-prova', rationale: 'nenhuma prova acessível ligada a esta relação' };
  if (contrary.length) return { level: 'contraditoria', rationale: 'há prova contrária ligada (' + contrary.length + ')' };
  if (usable.length > origins.size) {
    return { level: 'corroborada', rationale: origins.size + ' origem(ns) independente(s) e ' + (usable.length - origins.size) + ' cópia(s) da mesma origem' };
  }
  if (origins.size >= 2) return { level: 'corroborada', rationale: origins.size + ' origens independentes' };
  return { level: 'uma-so-origem', rationale: 'uma só origem: não sustenta conclusão, só a existência documentada da relação' };
}

/* Janela temporal declarada pelo utilizador. Regra de honestidade: uma relação
   sem período não pode ser excluída por data — fica incluída e é contada à
   parte, para que o filtro nunca pareça ter verificado o que não verificou. */
const realDate = (v) => {
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(v)) return false;
  if (v.length === 4) return true;
  const [y, m] = v.slice(0, 7).split('-').map(Number);
  if (m < 1 || m > 12) return false;
  if (v.length === 7) return true;
  const d = Number(v.slice(8, 10));
  return d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
};
export function periodWindow(spec) {
  const rawFrom = spec && spec.from != null ? String(spec.from).trim() : '';
  const rawTo = spec && spec.to != null ? String(spec.to).trim() : '';
  if (rawFrom.length > 10 || rawTo.length > 10) return { ok: false, error: 'datas do filtro devem ser AAAA, AAAA-MM ou AAAA-MM-DD' };
  const from = rawFrom || null;
  const to = rawTo || null;
  if ((from && !realDate(from)) || (to && !realDate(to))) {
    return { ok: false, error: 'datas do filtro devem ser AAAA, AAAA-MM ou AAAA-MM-DD' };
  }
  if (from && to && from > to) return { ok: false, error: 'o início do período é posterior ao fim' };
  return { ok: true, window: { from, to, applied: !!(from || to) } };
}

const dayOf = (v) => {
  const s = String(v == null ? '' : v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const lastDayOfMonth = (yyyyMm) => {
  const [y, m] = yyyyMm.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
/* limites da janela em dias, com precisão parcial expandida (AAAA → 1 Jan / 31 Dez) */
const lowerBound = (v) => {
  if (!v) return null;
  if (/^\d{4}$/.test(v)) return v + '-01-01';
  if (/^\d{4}-\d{2}$/.test(v)) return v + '-01';
  return dayOf(v);
};
const upperBound = (v) => {
  if (!v) return null;
  if (/^\d{4}$/.test(v)) return v + '-12-31';
  if (/^\d{4}-\d{2}$/.test(v)) return lastDayOfMonth(v);
  return dayOf(v);
};

/* Sobreposição entre o período da relação e a janela pedida.
   Período aberto de um lado («desde 2019», «até 2021») conta como sobreposição
   até ao limite do lado declarado — nunca se inventa o lado em falta. */
export function relationInWindow(period, win) {
  if (!win || !win.applied) return true;
  const pFrom = lowerBound(period && period.from);
  const pTo = upperBound(period && period.to);
  if (!pFrom && !pTo) return null;                       // sem período: indeterminado
  /* Um lado em falta NÃO é o fim do período: «desde 2019» continua aberto.
     Inventar um fim excluiria relações que podem estar dentro da janela, o que
     seria uma afirmação que as provas não fazem. */
  const a = pFrom || '0000-00-00';
  const b = pTo || '9999-12-31';
  const wf = lowerBound(win.from), wt = upperBound(win.to);
  if (wf && b < wf) return false;
  if (wt && a > wt) return false;
  return true;
}

/* ---------------- fusão de homónimos com identificador ----------------

   O grafo nunca funde dois nomes iguais por parecerem a mesma pessoa. Pode,
   porém, aceitar uma declaração EXPLÍCITA do utilizador de que duas entradas
   são a mesma entidade, desde que traga o identificador que o prova (NIPC,
   LEI, número de registo) e o motivo. A ligação é reversível e auditada. */

export function validateEntityLink(input) {
  const errors = [];
  const from = { name: String((input.from && input.from.name) || input.fromName || '').trim().slice(0, 200),
    disambiguator: String((input.from && input.from.disambiguator) || input.fromDisambiguator || '').trim().slice(0, 160) || null };
  const to = { name: String((input.to && input.to.name) || input.toName || '').trim().slice(0, 200),
    disambiguator: String((input.to && input.to.disambiguator) || input.toDisambiguator || '').trim().slice(0, 160) || null };
  const identifier = String(input.identifier || '').trim().slice(0, 120);
  const identifierType = String(input.identifierType || '').trim().slice(0, 40) || null;
  const reason = String(input.reason || '').trim().slice(0, 1000);
  if (!from.name || !to.name) errors.push('indique as duas entradas (from e to)');
  if (from.name && to.name && entityKey(from.name, from.disambiguator) === entityKey(to.name, to.disambiguator)) {
    errors.push('as duas entradas são já a mesma: nada a fundir');
  }
  if (identifier.length < 4) errors.push('fundir nomes exige o identificador que o prova (mínimo 4 caracteres): sem identificador, homónimos não se juntam');
  if (reason.length < 10) errors.push('fundir entidades exige o motivo escrito (mínimo 10 caracteres)');
  return { ok: errors.length === 0, errors, link: { from, to, identifier, identifierType, reason } };
}

const linkMap = (links) => {
  const m = new Map();
  const info = new Map();
  (links || []).filter((l) => !l.retractedAt).forEach((l) => {
    /* o identificador declarado é o desambiguador canónico: se a entidade de
       referência não trouxer identificador próprio, o da ligação passa a ser o
       dela. Assim uma prova que só diz «Ana Silva» fica no mesmo nó que
       «A. Silva» — porque foi declarado que ambas são NIPC 500000000. */
    const canonicalDisamb = (l.to && l.to.disambiguator) || l.identifier;
    const canonicalKey = entityKey(l.to && l.to.name, canonicalDisamb);
    const fromKey = entityKey(l.from && l.from.name, l.from && l.from.disambiguator);
    const toKey = entityKey(l.to && l.to.name, l.to && l.to.disambiguator);
    const target = { key: canonicalKey, name: l.to && l.to.name, disambiguator: canonicalDisamb, identifier: l.identifier };
    if (fromKey !== canonicalKey) m.set(fromKey, target);
    if (toKey !== canonicalKey) m.set(toKey, target);
    info.set(canonicalKey, target);
  });
  return { map: m, info };
};

export function buildGraph({ project, evidence, relations, claims, window: win, entityLinks }) {
  evidence = evidence || [];
  relations = relations || [];
  const active = evidence.filter((e) => !e.retractedAt);
  const filter = { applied: !!(win && win.applied), from: (win && win.from) || null, to: (win && win.to) || null,
    relationsIncluded: 0, relationsExcludedByPeriod: 0, relationsWithoutPeriod: 0, relationsOpenPeriod: 0,
    note: 'relações sem período declarado não podem ser excluídas por data: são contadas à parte e ficam incluídas' };
  if (filter.applied) {
    relations = relations.filter((r) => {
      if (r.retractedAt) return true;                    // retiradas são filtradas adiante
      const p = r.period || {};
      if ((p.from || p.to) && !(p.from && p.to)) filter.relationsOpenPeriod++;
      const inWin = relationInWindow(r.period, win);
      if (inWin === null) { filter.relationsWithoutPeriod++; filter.relationsIncluded++; return true; }
      if (!inWin) { filter.relationsExcludedByPeriod++; return false; }
      filter.relationsIncluded++; return true;
    });
  } else {
    filter.relationsIncluded = relations.filter((r) => !r.retractedAt).length;
  }
  const byId = new Map(evidence.map((e) => [e.id, e]));

  /* nós: só entidades que aparecem em provas registadas.
     As ligações declaradas (com identificador) resolvem-se antes de criar o nó. */
  const linkInfo = linkMap(entityLinks);
  const links = linkInfo.map;
  const resolve = (name, disambiguator) => {
    let key = entityKey(name, disambiguator);
    let hops = 0;
    let target = links.get(key);
    while (target && hops < 10) { key = target.key; target = links.get(key); hops++; }
    return key;
  };
  const nodes = new Map();
  const addNode = (name, meta) => {
    const key = resolve(name, meta && meta.disambiguator);
    let n = nodes.get(key);
    if (!n) {
      n = {
        id: key, name: String(name).trim().slice(0, 200),
        type: (meta && meta.type) || 'unknown', typeLabel: (ENTITY_TYPES[(meta && meta.type) || 'unknown'] || ENTITY_TYPES.unknown).label,
        color: (ENTITY_TYPES[(meta && meta.type) || 'unknown'] || ENTITY_TYPES.unknown).color,
        disambiguator: (meta && meta.disambiguator) || null,
        evidenceIds: [], aliases: [], namesSeen: []
      };
      nodes.set(key, n);
    }
    if (meta && meta.type && n.type === 'unknown') { n.type = meta.type; n.typeLabel = ENTITY_TYPES[meta.type].label; n.color = ENTITY_TYPES[meta.type].color; }
    /* o identificador declarado passa a ser o desambiguador do nó */
    if (!n.disambiguator) {
      const info = linkInfo.info.get(key);
      if (info && info.disambiguator) { n.disambiguator = info.disambiguator; n.disambiguatorSource = 'ligação declarada com identificador'; }
    }
    if (meta && meta.alias && n.aliases.indexOf(meta.alias) < 0) n.aliases.push(meta.alias);
    if (entityKey(name, meta && meta.disambiguator) !== key && norm(name) !== norm(n.name) && n.aliases.indexOf(String(name)) < 0) n.aliases.push(String(name));
    if (n.namesSeen.indexOf(String(name)) < 0) n.namesSeen.push(String(name));
    return n;
  };

  active.forEach((e) => {
    (e.entities || []).forEach((raw) => {
      const ent = typeof raw === 'string' ? { name: raw } : (raw || {});
      if (!ent.name) return;
      const n = addNode(ent.name, { type: ent.type, disambiguator: ent.disambiguator, alias: ent.alias });
      if (n.evidenceIds.indexOf(e.id) < 0) n.evidenceIds.push(e.id);
    });
  });

  /* arestas: apenas relações com prova */
  const edges = [];
  relations.filter((r) => !r.retractedAt).forEach((r) => {
    const evs = (r.evidenceIds || []).map((id) => byId.get(id)).filter((x) => x && !x.retractedAt);
    const fromKey = resolve(r.from, r.fromDisambiguator);
    const toKey = resolve(r.to, r.toDisambiguator);
    /* addNode é idempotente e regista aliases: chamá-lo sempre faz com que um
       nome alternativo usado só numa relação fique visível no nó fundido */
    addNode(r.from, { type: r.fromType || 'unknown', disambiguator: r.fromDisambiguator });
    addNode(r.to, { type: r.toType || 'unknown', disambiguator: r.toDisambiguator });
    const conf = edgeConfidence(r, evs);
    const type = RELATION_TYPES[r.type] || { label: r.type, family: 'outra', directed: true };
    edges.push({
      id: r.id, from: fromKey, to: toKey, fromName: r.from, toName: r.to,
      type: r.type, label: type.label, family: type.family,
      direction: r.direction || (type.directed === false ? 'mutual' : 'directed'),
      period: r.period || { from: null, to: null },
      evidenceIds: evs.map((e) => e.id),
      evidenceCount: evs.length,
      origins: [...new Set(evs.map((e) => e.originKey || e.canonicalUrl))],
      confidence: conf,
      inferred: !!r.inferred,
      reasoning: r.reasoning || null,
      limitations: r.limitations || null,
      validationState: r.validationState || (conf.level === 'contraditoria' ? 'contraditoria' : conf.level === 'corroborada' ? 'confirmada' : 'insuficiente'),
      lastChecked: r.lastChecked || null,
      style: r.inferred ? 'tracejada' : 'solida'
    });
  });

  /* candidatos: co-ocorrência no mesmo documento — NÃO são relações */
  const pairs = new Map();
  active.forEach((e) => {
    /* as chaves usam o mesmo critério dos nós (com desambiguador, quando existe) */
    const ents = (e.entities || []).map((x) => (typeof x === 'string' ? { name: x } : (x || {})))
      .filter((x) => x.name)
      .map((x) => ({ key: resolve(x.name, x.disambiguator), name: x.name }));
    for (let i = 0; i < ents.length; i++) {
      for (let j = i + 1; j < ents.length; j++) {
        const a = ents[i].key, b = ents[j].key;
        if (a === b) continue;
        const k = [a, b].sort().join('~');
        const p = pairs.get(k) || { a, b, names: [ents[i].name, ents[j].name], evidenceIds: [] };
        if (p.evidenceIds.indexOf(e.id) < 0) p.evidenceIds.push(e.id);
        pairs.set(k, p);
      }
    }
  });
  const existing = new Set(edges.map((e) => [e.from, e.to].sort().join('~')));
  const candidates = [...pairs.values()].filter((p) => !existing.has([p.a, p.b].sort().join('~')))
    .map((p) => ({
      from: p.a, to: p.b, fromName: p.names[0], toName: p.names[1],
      evidenceCount: p.evidenceIds.length, evidenceIds: p.evidenceIds,
      kind: 'co-ocorrencia', notARelation: true,
      note: 'aparecem no mesmo documento; isso não prova relação, direcção, nem intenção'
    }));

  const nodeList = [...nodes.values()].map((n) => Object.assign(n, {
    degree: edges.filter((e) => e.from === n.id || e.to === n.id).length,
    homonymRisk: !n.disambiguator && (n.namesSeen.length > 1 ? true : false)
  }));

  const activeLinks = (entityLinks || []).filter((l) => !l.retractedAt);
  return {
    project: { id: project.id, title: project.title },
    filter,
    entityLinks: activeLinks.map((l) => ({
      id: l.id, from: l.from, to: l.to, identifier: l.identifier, identifierType: l.identifierType || null,
      reason: l.reason, createdAt: l.createdAt,
      note: 'ligação declarada pelo utilizador com identificador; reversível e auditada'
    })),
    nodes: nodeList,
    edges,
    candidates,
    legend: {
      entityTypes: ENTITY_TYPES,
      relationFamilies: [...new Set(Object.values(RELATION_TYPES).map((r) => r.family))],
      edgeStyles: { solida: 'relação com prova registada', tracejada: 'relação inferida (não é prova)' },
      warnings: [
        'uma linha não é prova: abra a aresta para ver as provas',
        'co-ocorrência não é relação',
        'nomes sem desambiguador podem ser homónimos: não são fundidos sem identificador'
      ]
    },
    stats: {
      nodes: nodeList.length,
      edges: edges.length,
      edgesWithSingleOrigin: edges.filter((e) => e.confidence.level === 'uma-so-origem').length,
      edgesCorroborated: edges.filter((e) => e.confidence.level === 'corroborada').length,
      edgesContradictory: edges.filter((e) => e.confidence.level === 'contraditoria').length,
      inferred: edges.filter((e) => e.inferred).length,
      candidates: candidates.length,
      entitiesWithoutDisambiguator: nodeList.filter((n) => !n.disambiguator).length,
      mergedByLink: nodeList.filter((n) => (n.aliases || []).length).length,
      evidenceUsed: new Set(edges.flatMap((e) => e.evidenceIds)).size,
      evidenceTotal: active.length,
      claims: (claims || []).length
    }
  };
}

