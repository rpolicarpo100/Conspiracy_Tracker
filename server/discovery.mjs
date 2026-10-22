/* =====================================================================
   DESCOBERTA CONTÍNUA — fase 6

   Três peças:

   1. `ACCESS_DETAIL_FIELDS` — os 9 campos que o pedido exige por fornecedor
      (conta, cartão, limites, concorrência, geografia, uso comercial,
      privacidade, hardware e data de confirmação). Cada campo é
      `MEASURED` / `DECLARED` / `UNKNOWN`. Um valor sem fonte é RECUSADO: não
      há forma de escrever «grátis» sem dizer quem o disse e quando.

   2. `categoryOf` — as 5 categorias de descoberta (A–E) derivadas por regra
      explícita, não escolhidas à mão em cada entrada.

   3. Adaptadores de descoberta reais e sem chave: `models_dev` (232
      fornecedores, 9 143 modelos com limites e preço por token) e
      `github_coding_agents` (ferramentas/agentes: licença, estrelas, último
      push, arquivado). Nenhum deles «descobre» o que a fonte não diz: o que a
      fonte não publica fica UNKNOWN, e é isso que a interface mostra.
   ===================================================================== */

import { CATEGORY, DISCOVERY_ADAPTERS, fromOpenRouter, fromHuggingFace } from './provider-catalog.mjs';
import { isPrivateHost } from './providers.mjs';

/* ------------------------------------------------------------------ campos */

export const ACCESS_DETAIL_FIELDS = {
  conta: 'é preciso criar conta?',
  cartao: 'é preciso cartão de crédito?',
  limites: 'limites publicados (pedidos/min, tokens/min, contexto, quota diária)',
  concorrencia: 'quantas chamadas em paralelo são permitidas',
  geografia: 'onde os dados são processados / restrições por país',
  usoComercial: 'o uso comercial é permitido nos termos?',
  privacidade: 'treina com os dados? quanto tempo retém?',
  hardware: 'corre localmente? que requisitos?',
  confirmadoEm: 'data da última confirmação (medição ou leitura da fonte)'
};

const UNKNOWN = { status: 'UNKNOWN' };
const norm = (s) => String(s == null ? '' : s).toLowerCase().trim();

/** Campo de detalhe: devolve cópia segura (nunca deixa passar valor sem fonte). */
export function accessDetail(entry, field) {
  const d = (entry && entry.accessDetails && entry.accessDetails[field]) || null;
  if (!d || d.status === 'UNKNOWN' || d.value == null) return UNKNOWN;
  return d;
}

/** Cobertura dos 9 campos: quantos têm prova, quantos são declaração, quantos faltam. */
export function accessDetailCoverage(entry) {
  const out = { measured: [], declared: [], unknown: [] };
  for (const f of Object.keys(ACCESS_DETAIL_FIELDS)) {
    const d = accessDetail(entry, f);
    if (d.status === 'MEASURED') out.measured.push(f);
    else if (d.status === 'DECLARED') out.declared.push(f);
    else out.unknown.push(f);
  }
  const total = Object.keys(ACCESS_DETAIL_FIELDS).length;
  return {
    total, known: out.measured.length + out.declared.length,
    measured: out.measured, declared: out.declared, unknown: out.unknown,
    pct: Math.round(((out.measured.length + out.declared.length) / total) * 100)
  };
}

/** Validação: um valor tem de trazer fonte e data; o resto não pode fingir. */
export function validateAccessDetails(entry) {
  const errors = [], warnings = [];
  const details = (entry && entry.accessDetails) || {};
  for (const [field, d] of Object.entries(details)) {
    if (!ACCESS_DETAIL_FIELDS[field]) { errors.push({ msg: 'campo de acesso desconhecido: ' + field }); continue; }
    if (!d || d.status === 'UNKNOWN') continue;
    if (!['MEASURED', 'DECLARED', 'STALE', 'CONTRADICTED'].includes(d.status)) {
      errors.push({ msg: field + ': estado inválido «' + d.status + '»' }); continue;
    }
    if (d.value == null || String(d.value).trim() === '') errors.push({ msg: field + ': valor vazio com estado ' + d.status });
    if (d.status === 'MEASURED' && !d.at) errors.push({ msg: field + ': MEASURED sem data' });
    if (d.status === 'MEASURED' && !d.method) errors.push({ msg: field + ': MEASURED sem método' });
    if (d.status === 'DECLARED' && !d.url) errors.push({ msg: field + ': DECLARED sem URL da fonte' });
    if (d.url && !/^https?:\/\//i.test(d.url)) errors.push({ msg: field + ': URL não absoluto' });
  }
  /* coerência útil: se o regulador proíbe uso comercial e a entrada diz «sim», aviso */
  const uso = accessDetail(entry, 'usoComercial');
  if (uso.status !== 'UNKNOWN' && /proibid|não permitido|nao permitido/i.test(norm(uso.value)) && (entry.access && entry.access.class === 'FREE_API_KEY')) {
    warnings.push({ msg: 'uso comercial restringido mas a entrada está classificada como utilizável com chave: confirmar antes de recomendar' });
  }
  return { ok: errors.length === 0, errors, warnings };
}

/* ------------------------------------------------------------- categorias */
/* A — sem chave · B — plano gratuito · C — routers · D — ferramentas · E — especializados */

export const DISCOVERY_CATEGORY_LABELS = {
  A: 'sem chave (acesso anónimo)',
  B: 'plano gratuito / chave gratuita',
  C: 'router / agregador',
  D: 'ferramenta de programação ou agente',
  E: 'modelo ou serviço especializado'
};

export function categoryOf(entry) {
  if (!entry) return 'E';
  const cls = (entry.access && entry.access.class) || 'UNKNOWN_ACCESS';
  if (entry.kind === 'tool' || entry.kind === 'eval' || entry.category === CATEGORY.CODING_TOOL) return 'D';
  if (cls === 'ANONYMOUS_PUBLIC') return 'A';
  if (cls === 'FREE_API_KEY' || cls === 'FREE_TRIAL') {
    /* um agregador com chave continua a ser um router (C), não «plano gratuito» */
    return entry.category === CATEGORY.AGGREGATOR ? 'C' : 'B';
  }
  if (entry.category === CATEGORY.AGGREGATOR) return 'C';
  return 'E';
}

/* ------------------------------------------------------------- adaptadores */

const GITHUB_TOPICS = ['coding-agent', 'coding-assistant'];
export const GITHUB_QUERY = GITHUB_TOPICS.map((t) => 'topic:' + t).join('+');

/* models.dev → um registo por fornecedor (não 9 143 modelos: um catálogo não é um arquivo). */
export function fromModelsDev(json, opts) {
  const at = (opts && opts.at) || new Date().toISOString();
  const url = (opts && opts.url) || DISCOVERY_ADAPTERS.models_dev.url;
  const providers = json && typeof json === 'object' ? Object.values(json) : [];
  const entries = [];
  let modelos = 0, comPreco = 0, comLimite = 0;
  for (const p of providers) {
    if (!p || !p.id) continue;
    const models = p.models && typeof p.models === 'object' ? Object.values(p.models) : [];
    modelos += models.length;
    const custos = models.map((m) => (m && m.cost) || null).filter(Boolean);
    const livres = models.filter((m) => m && m.cost && Number(m.cost.input) === 0 && Number(m.cost.output) === 0);
    const limites = models.map((m) => (m && m.limit && m.limit.context) || null).filter((x) => x);
    const ctxMax = limites.length ? Math.max(...limites) : null;
    const openWeights = models.filter((m) => m && m.open_weights).length;
    if (custos.length) comPreco++;
    if (limites.length) comLimite++;
    const ev = [
      { a: 'existe-no-catalogo', status: 'MEASURED', at, method: 'GET ' + url + ' (campo id do fornecedor)', url,
        detail: 'fornecedor «' + p.id + '» com ' + models.length + ' modelo(s) listado(s)' }
    ];
    if (ctxMax) ev.push({ a: 'limite-de-contexto-publicado', status: 'MEASURED', at,
      method: 'campo limit.context do maior modelo', url, detail: 'contexto máximo publicado: ' + ctxMax + ' tokens' });
    if (custos.length) ev.push({ a: 'preco-por-token-publicado', status: 'MEASURED', at,
      method: 'campo cost (USD por 1M tokens)', url,
      detail: custos.length + ' modelo(s) com preço; ' + livres.length + ' com preço 0 publicado' });
    if (p.env && p.env.length) ev.push({ a: 'credencial-por-variavel-de-ambiente', status: 'DECLARED', url,
      detail: 'o catálogo indica a(s) variável(is): ' + p.env.join(', ') + ' — indica que a API pede chave, não que é gratuita' });

    /* preço: usa-se o modelo mais barato com custo publicado (base conservadora) */
    let pricing = null;
    const comCusto = models.filter((m) => m && m.cost && (Number(m.cost.input) > 0 || Number(m.cost.output) > 0));
    if (comCusto.length) {
      const barato = comCusto.slice().sort((a, b) => (Number(a.cost.input) + Number(a.cost.output)) - (Number(b.cost.input) + Number(b.cost.output)))[0];
      pricing = { currency: 'USD', unit: 'por 1M tokens', prompt: Number(barato.cost.input) || 0, completion: Number(barato.cost.output) || 0,
        note: 'modelo mais barato do catálogo: ' + barato.id };
    }
    entries.push({
      key: 'providers/' + String(p.id).toLowerCase().replace(/[^a-z0-9._-]/g, '-'),
      name: p.name || p.id, kind: 'endpoint', vendor: p.name || p.id,
      category: livreSuficiente(livres.length, models.length) ? CATEGORY.FREE_TIER : CATEGORY.SPECIALIZED,
      access: {
        class: livreSuficiente(livres.length, models.length) ? 'FREE_TRIAL' : 'UNKNOWN_ACCESS',
        needsAccount: null, needsCard: null,
        limits: ctxMax ? ['contexto máximo publicado: ' + ctxMax + ' tokens'] : [],
        note: 'models.dev publica preços e limites; NÃO publica plano gratuito nem requisitos de cartão'
      },
      endpoints: p.api ? [{ base: p.api, protocol: 'openai-chat-completions' }] : [],
      docs: p.doc ? [p.doc] : [],
      contextLength: ctxMax,
      pricing,
      modelsCount: models.length,
      accessDetails: {
        conta: p.env && p.env.length
          ? { status: 'DECLARED', value: 'pede chave por variável de ambiente (' + p.env.join(', ') + ')', url }
          : UNKNOWN,
        cartao: UNKNOWN,
        limites: ctxMax
          ? { status: 'MEASURED', value: ctxMax + ' tokens de contexto (máximo publicado)', url, at, method: 'campo limit.context' }
          : UNKNOWN,
        concorrencia: UNKNOWN,
        geografia: UNKNOWN,
        usoComercial: UNKNOWN,
        privacidade: UNKNOWN,
        hardware: openWeights && openWeights === models.length && models.length > 0
          ? { status: 'DECLARED', value: 'todos os modelos listados têm pesos abertos (open_weights=true)', url }
          : UNKNOWN,
        confirmadoEm: { status: 'MEASURED', value: at.slice(0, 10), url, at, method: 'data da leitura do catálogo' }
      },
      evidence: ev
    });
  }
  return {
    entries, total: providers.length, modelsTotal: modelos,
    providersWithPrice: comPreco, providersWithLimit: comLimite, at,
    note: 'um fornecedor por entrada: ' + modelos + ' modelos foram contados, não gravados um a um'
  };
}

/* Limiar declarado (não mágico): pelo menos um modelo a preço 0 publicado. */
function livreSuficiente(livres, total) {
  return total > 0 && livres > 0;
}

/* GitHub search → ferramentas e agentes de programação (categoria D).
   Só se registam factos da API: licença, estrelas, último push, arquivado. */
export function fromGitHubSearch(json, opts) {
  const at = (opts && opts.at) || new Date().toISOString();
  const base = (opts && opts.url) || DISCOVERY_ADAPTERS.github_coding_agents.url;
  const query = (opts && opts.query) || GITHUB_QUERY;
  /* Se o chamador já indica o URL exacto que consultou, é esse que fica na
     evidência. Reconstruí-lo aqui colava um segundo «?» e, pior, escrevia
     `sort=stars` num pedido que deixou de o ter (o GitHub devolvia 0
     resultados com esse parâmetro — ver nota em server/api.mjs). */
  const url = (opts && opts.url) ? opts.url : base + '?q=' + query;
  const items = (json && Array.isArray(json.items)) ? json.items : [];
  const entries = items.map((r) => {
    const lic = (r.license && (r.license.spdx_id || r.license.name)) || null;
    const diasSemPush = r.pushed_at ? Math.round((new Date(at) - new Date(r.pushed_at)) / 86400000) : null;
    const ev = [
      { a: 'existe-no-github', status: 'MEASURED', at, method: 'GET api.github.com/search/repositories?q=' + query, url: r.html_url,
        detail: (r.full_name || r.name) + ' · ' + (r.stargazers_count || 0) + ' estrelas · licença ' + (lic || 'não declarada') },
      { a: 'ultimo-push', status: 'MEASURED', at, method: 'campo pushed_at da API do GitHub', url: r.html_url,
        detail: 'último push em ' + String(r.pushed_at || '').slice(0, 10) + (diasSemPush == null ? '' : ' (' + diasSemPush + ' dias antes desta leitura)') }
    ];
    if (r.archived) ev.push({ a: 'repositorio-arquivado', status: 'MEASURED', at, method: 'campo archived=true da API do GitHub', url: r.html_url,
      detail: 'repositório arquivado: não recebe manutenção — não deve ser recomendado para trabalho novo' });
    return {
      key: 'tools/' + String(r.full_name || r.name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
      name: r.full_name || r.name, kind: 'tool', vendor: (r.owner && r.owner.login) || null,
      category: CATEGORY.CODING_TOOL,
      access: { class: 'UNKNOWN_ACCESS', needsAccount: null, needsCard: null, limits: [],
        note: 'é um repositório, não um serviço: a classe de acesso à API (se existir) tem de ser medida à parte' },
      docs: r.html_url ? [r.html_url] : [],
      repo: { url: r.html_url || null, stars: r.stargazers_count == null ? null : r.stargazers_count,
        forks: r.forks_count == null ? null : r.forks_count, licence: lic,
        pushedAt: r.pushed_at || null, archived: !!r.archived, openIssues: r.open_issues_count == null ? null : r.open_issues_count,
        language: r.language || null, description: r.description || null },
      maintenanceSignal: r.archived ? 'arquivado' : (diasSemPush != null && diasSemPush > 365 ? 'sem push há mais de um ano' : (diasSemPush != null && diasSemPush > 90 ? 'sem push há mais de 90 dias' : 'activo')),
      accessDetails: {
        conta: UNKNOWN, cartao: UNKNOWN, limites: UNKNOWN, concorrencia: UNKNOWN, geografia: UNKNOWN,
        usoComercial: lic
          ? { status: 'DECLARED', value: 'licença ' + lic + ' (ler os termos: licença permissiva não é parecer jurídico)', url: r.html_url }
          : UNKNOWN,
        privacidade: UNKNOWN,
        hardware: UNKNOWN,
        confirmadoEm: { status: 'MEASURED', value: at.slice(0, 10), url: r.html_url || url, at, method: 'data da leitura da API do GitHub' }
      },
      evidence: ev
    };
  });
  return { entries, total: (json && json.total_count) || items.length, at, query,
    archived: items.filter((r) => r.archived).length };
}

/** Adaptadores disponíveis para `/api/provider-os/discover` (todos sem chave). */
export const ADAPTERS = {
  openrouter_models: {
    key: 'openrouter_models', label: 'OpenRouter (catálogo público)', url: DISCOVERY_ADAPTERS.openrouter_models.url,
    needsKey: false, categories: ['C', 'E'], maxBytes: 12e6,
    parse: (json, o) => fromOpenRouter(json, Object.assign({ url: DISCOVERY_ADAPTERS.openrouter_models.url }, o))
  },
  hf_models: {
    key: 'hf_models', label: 'Hugging Face (pesos mais descarregados)', url: DISCOVERY_ADAPTERS.hf_models.url,
    needsKey: false, categories: ['E'], maxBytes: 4e6,
    parse: (json, o) => fromHuggingFace(json, Object.assign({ url: DISCOVERY_ADAPTERS.hf_models.url }, o))
  },
  models_dev: {
    key: 'models_dev', label: 'models.dev (preços e limites por fornecedor)', url: DISCOVERY_ADAPTERS.models_dev.url,
    needsKey: false, categories: ['B', 'C', 'E'], maxBytes: 12e6,
    parse: (json, o) => fromModelsDev(json, Object.assign({ url: DISCOVERY_ADAPTERS.models_dev.url }, o))
  },
  github_coding_agents: {
    key: 'github_coding_agents', label: 'GitHub (ferramentas e agentes de programação)', url: DISCOVERY_ADAPTERS.github_coding_agents.url,
    needsKey: false, categories: ['D'], maxBytes: 4e6,
    parse: (json, o) => fromGitHubSearch(json, Object.assign({}, o))
  }
};

/* --------------------------------------------------------------- fusão

   Uma descoberta NUNCA apaga o que já foi medido. Se a entrada já existe:
   · o estado mais avançado fica (descobrir não promove nem despromove);
   · a classe de acesso medida fica (o catálogo externo não a substitui);
   · evidência nova é acrescentada, evidência antiga mantida (dedupe por a+detail);
   · campos de acesso UNKNOWN passam a ter valor; os que já tinham prova ficam.
   Isto evita o acidente clássico: a semente de `providers/openrouter` (com 401
   medido) ser substituída por uma linha de catálogo de terceiros. */

const STATE_ORDER = ['DISCOVERED', 'DOCUMENTED', 'LINK_TESTED', 'GENERATION_TESTED', 'RANKED', 'APPROVED'];

export function mergeDiscovered(existing, incoming) {
  if (!existing) return Object.assign({}, incoming, { state: incoming.state || 'DISCOVERED' });
  const merged = Object.assign({}, incoming, existing);         // a base é o que já existia
  const rankE = STATE_ORDER.indexOf(existing.state), rankI = STATE_ORDER.indexOf(incoming.state || 'DISCOVERED');
  merged.state = existing.state && (rankE >= 0 ? rankE >= rankI : true) ? existing.state : (incoming.state || 'DISCOVERED');
  merged.access = Object.assign({}, incoming.access, existing.access);
  const tinhaMedido = (existing.evidence || []).some((x) => x.status === 'MEASURED');
  if (tinhaMedido && incoming.access && !(existing.access && existing.access.class === 'UNKNOWN_ACCESS')) {
    merged.access.class = existing.access.class;
  }
  const chave = (x) => (x.a || '') + '|' + (x.detail || '') + '|' + (x.at || '');
  const vistos = new Set((existing.evidence || []).map(chave));
  merged.evidence = (existing.evidence || []).concat((incoming.evidence || []).filter((x) => !vistos.has(chave(x))));
  const detalhes = Object.assign({}, incoming.accessDetails);
  for (const [f, d] of Object.entries(existing.accessDetails || {})) {
    const antigo = d && d.status !== 'UNKNOWN' && d.value != null;
    if (antigo) detalhes[f] = d;                                 // prova antiga ganha a campo vazio
  }
  merged.accessDetails = detalhes;
  merged.mergeNote = 'fusão com entrada existente: estado «' + merged.state + '» mantido, evidência antiga preservada';
  return merged;
}

/** Resumo por categoria A–E: quantas entradas, quantas com prova em cada área. */
export function categorySummary(entries) {
  const out = {};
  for (const id of Object.keys(DISCOVERY_CATEGORY_LABELS)) out[id] = { id, label: DISCOVERY_CATEGORY_LABELS[id], total: 0, measured: 0, keys: [] };
  for (const e of entries || []) {
    const c = categoryOf(e);
    const s = out[c] || (out[c] = { id: c, label: c, total: 0, measured: 0, keys: [] });
    s.total++;
    s.keys.push(e.key);
    const cov = accessDetailCoverage(e);
    if (cov.measured.length >= 2) s.measured++;
  }
  const all = Object.values(out);
  return {
    categories: all,
    totals: { entries: (entries || []).length, measured: all.reduce((n, c) => n + c.measured, 0) },
    note: 'as categorias são derivadas por regra (access.class + kind + category), não escolhidas à mão em cada entrada'
  };
}

/* =====================================================================
   SONDAGEM «SEM CHAVE» (fase 11) — descobre, por medição, que APIs de IA
   respondem SEM credencial. Não substitui o juízo humano nem infere
   gratuitidade: um 200 sem Authorization prova apenas «não pediu chave
   neste pedido GET /models». Um 401/403 prova que pede.

   Regras rígidas:
     · só https e só endereços públicos (isPrivateHost de providers.mjs);
     · GET /models, sem Authorization, sem cookies, um pedido por endpoint;
     · 8 s de limite, resposta máxima lida 256 KB;
     · nunca se contorna CAPTCHA, paywall ou aviso legal.
   ===================================================================== */
export const KEYLESS_VERDICTS = {
  semChave: 'sem-chave', geraSemChave: 'gera-sem-chave',
  exigeChave: 'exige-chave', indeterminado: 'indeterminado'
};

export async function probeSemChave(candidato, opts) {
  const o = opts || {};
  const fetchImpl = o.fetchImpl || fetch;
  const base = String((candidato && candidato.base) || '').replace(/\/+$/, '');
  const out = { id: candidato && candidato.id, base, at: new Date().toISOString(), verdict: KEYLESS_VERDICTS.indeterminado };
  if (!base) return Object.assign(out, { porque: 'sem URL base' });
  let u = null;
  try { u = new URL(base); } catch { return Object.assign(out, { porque: 'URL inválida' }); }
  if (u.protocol !== 'https:') return Object.assign(out, { porque: 'só https' });
  if (isPrivateHost(u.hostname)) return Object.assign(out, { porque: 'endereço privado/local proibido (SSRF)' });
  const url = base + '/models';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 8000);
  const t0 = Date.now();
  try {
    const res = await fetchImpl(url, { method: 'GET', signal: ctrl.signal, headers: { accept: 'application/json' } });
    const txt = (await res.text()).slice(0, 262144);
    let json = null; try { json = JSON.parse(txt); } catch { /* não JSON */ }
    const lista = json ? (Array.isArray(json) ? json : Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : []) : [];
    const modelos = json ? (Array.isArray(json) ? json.length : Array.isArray(json.data) ? json.data.length : Array.isArray(json.models) ? json.models.length : null) : null;
    out.firstModel = lista.length ? (typeof lista[0] === 'string' ? lista[0] : lista[0].id || lista[0].name || null) : null;
    out.status = res.status; out.ms = Date.now() - t0; out.modelsCount = modelos;
    if (res.status === 401 || res.status === 403) {
      out.verdict = KEYLESS_VERDICTS.exigeChave;
      out.porque = 'HTTP ' + res.status + ' sem Authorization: a API pede credencial';
    } else if (res.ok && json) {
      out.verdict = KEYLESS_VERDICTS.semChave;
      out.porque = 'HTTP 200 sem Authorization e sem cookies';
    } else {
      out.verdict = KEYLESS_VERDICTS.indeterminado;
      out.porque = 'HTTP ' + res.status + (json ? ' (JSON)' : ' (sem JSON): não se conclui nada');
    }
  } catch (e) {
    out.ms = Date.now() - t0;
    out.verdict = KEYLESS_VERDICTS.indeterminado;
    out.porque = 'sem resposta: ' + String(e.message || e).slice(0, 120);
  } finally { clearTimeout(timer); }
  return out;
}

/* Segunda etapa: um catálogo público de modelos NÃO prova que a geração seja
   aberta. Só um pedido mínimo de geração prova. Custa 1 token ao fornecedor;
   por isso é opt-in (--confirmar) e limitado a max_tokens:1. */
export async function probeGeracaoSemChave(candidato, opts) {
  const o = opts || {};
  const fetchImpl = o.fetchImpl || fetch;
  const base = String((candidato && candidato.base) || '').replace(/\/+$/, '');
  const model = o.model || candidato.firstModel || null;
  const out = { id: candidato && candidato.id, base, model, at: new Date().toISOString(), verdict: KEYLESS_VERDICTS.indeterminado };
  if (!base || !model) return Object.assign(out, { porque: base ? 'sem nome de modelo para testar' : 'sem URL base' });
  let u = null;
  try { u = new URL(base); } catch { return Object.assign(out, { porque: 'URL inválida' }); }
  if (u.protocol !== 'https:') return Object.assign(out, { porque: 'só https' });
  if (isPrivateHost(u.hostname)) return Object.assign(out, { porque: 'endereço privado/local proibido (SSRF)' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 20000);
  const t0 = Date.now();
  try {
    const res = await fetchImpl(base + '/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'oi' }], max_tokens: 1 })
    });
    const txt = (await res.text()).slice(0, 4096);
    out.status = res.status; out.ms = Date.now() - t0;
    let json = null; try { json = JSON.parse(txt); } catch { /* não JSON */ }
    out.excerpt = txt.slice(0, 160);
    if (res.ok && json && json.choices) {
      out.verdict = KEYLESS_VERDICTS.geraSemChave;
      out.porque = 'HTTP 200 com max_tokens:1 e sem Authorization';
    } else if (res.status === 401 || res.status === 403) {
      out.verdict = KEYLESS_VERDICTS.exigeChave;
      out.porque = 'HTTP ' + res.status + ' sem Authorization: a geração exige credencial';
    } else if (res.status === 402) {
      out.verdict = KEYLESS_VERDICTS.exigeChave;
      out.porque = 'HTTP 402: exige pagamento/créditos';
    } else {
      out.verdict = KEYLESS_VERDICTS.indeterminado;
      out.porque = 'HTTP ' + res.status + ': não se conclui que seja aberto' + (res.status === 429 ? ' (limite de pedidos)' : '');
    }
  } catch (e) {
    out.ms = Date.now() - t0;
    out.porque = 'sem resposta: ' + String(e.message || e).slice(0, 120);
  } finally { clearTimeout(timer); }
  return out;
}
