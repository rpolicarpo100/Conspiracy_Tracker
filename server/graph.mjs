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

export function buildGraph({ project, evidence, relations, claims }) {
  evidence = evidence || [];
  relations = relations || [];
  const active = evidence.filter((e) => !e.retractedAt);
  const byId = new Map(evidence.map((e) => [e.id, e]));

  /* nós: só entidades que aparecem em provas registadas */
  const nodes = new Map();
  const addNode = (name, meta) => {
    const key = entityKey(name, meta && meta.disambiguator);
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
    if (meta && meta.alias && n.aliases.indexOf(meta.alias) < 0) n.aliases.push(meta.alias);
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
    const fromKey = entityKey(r.from, r.fromDisambiguator);
    const toKey = entityKey(r.to, r.toDisambiguator);
    if (!nodes.has(fromKey)) addNode(r.from, { type: r.fromType || 'unknown', disambiguator: r.fromDisambiguator });
    if (!nodes.has(toKey)) addNode(r.to, { type: r.toType || 'unknown', disambiguator: r.toDisambiguator });
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
      .map((x) => ({ key: entityKey(x.name, x.disambiguator), name: x.name }));
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

  return {
    project: { id: project.id, title: project.title },
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
      evidenceUsed: new Set(edges.flatMap((e) => e.evidenceIds)).size,
      evidenceTotal: active.length,
      claims: (claims || []).length
    }
  };
}

export function newRelationId() { return 'rel-' + crypto.randomBytes(8).toString('base64url'); }
