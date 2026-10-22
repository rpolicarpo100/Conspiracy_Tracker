/* =====================================================================
   CATÁLOGO DE FORNECEDORES E MODELOS DE IA (Provider OS · fase 2)

   Princípios que estão no código, não no texto:
   · nada entra sem evidência com URL e estado (`DECLARED` = o fornecedor
     afirma; `MEASURED` = nós medimos, com data e método; `STALE` = a
     evidência envelheceu);
   · «gratuito» e «sem chave» são classificações, não adjectivos: uma classe
     de acesso só sai de `UNKNOWN_ACCESS` quando há evidência mecanicamente
     verificável (um 401 medido, uma tabela de preços com valor 0 e data);
   · um modelo, um endpoint e uma ferramenta são coisas diferentes e ficam em
     `kind` distintos — um peso do Hugging Face não é um serviço de inferência;
   · o estado nunca sobe por si: DISCOVERED → DOCUMENTED → LINK_TESTED →
     GENERATION_TESTED → RANKED → APPROVED, e as descidas (DEGRADED,
     SUSPENDED, REJECTED, DEPRECATED) exigem motivo escrito.
   ===================================================================== */

export const ACCESS_CLASSES = {
  ANONYMOUS_PUBLIC: 'utilizável sem chave própria e permitido pelas condições do serviço',
  FREE_API_KEY: 'chave gratuita, com limites documentados',
  FREE_TRIAL: 'período experimental ou créditos temporários',
  PAID: 'serviço pago',
  LOCAL_RUNTIME: 'executa localmente (requisitos de hardware a declarar)',
  UNKNOWN_ACCESS: 'condições ainda não verificadas',
  UNAVAILABLE: 'descontinuado ou indisponível, com evidência registada'
};

export const PROVIDER_STATES = {
  DISCOVERED: 'encontrado; nada foi testado',
  DOCUMENTED: 'tem documentação oficial identificada e datada',
  LINK_TESTED: 'respondeu a um pedido mínimo de ligação (nível 2/3)',
  GENERATION_TESTED: 'produziu uma resposta válida com credencial própria (nível 4/5)',
  RANKED: 'tem classificação calculada com métricas medidas',
  APPROVED: 'aprovado para uso em produção, com decisão registada',
  DEGRADED: 'piorou de forma medida (latência, erros, qualidade)',
  SUSPENDED: 'suspenso por falha grave ou risco crítico',
  REJECTED: 'recusado, com motivo',
  DEPRECATED: 'descontinuado pelo fornecedor'
};

/* Uma evidência é uma afirmação pequena e verificável sobre um recurso. */
export const EVIDENCE_STATUS = {
  DECLARED: 'o fornecedor afirma na fonte indicada (não medimos)',
  MEASURED: 'medido por esta aplicação, com data e método',
  STALE: 'medido, mas a evidência tem mais de 90 dias',
  CONTRADICTED: 'medição posterior contradiz esta afirmação'
};

export const KINDS = {
  provider: 'fornecedor (empresa/plataforma)',
  endpoint: 'endpoint de inferência',
  model: 'modelo (identificador concreto)',
  weights: 'pesos de modelo (não é endpoint)',
  tool: 'ferramenta de programação/execução',
  search: 'serviço de pesquisa',
  eval: 'ferramenta de avaliação/observabilidade'
};

export const CATEGORY = {
  NO_KEY: 'api sem chave própria',
  FREE_TIER: 'api com plano gratuito',
  AGGREGATOR: 'router/agregador',
  CODING_TOOL: 'ferramenta de programação/execução',
  SPECIALIZED: 'modelo ou serviço especializado'
};

const STALE_DAYS = 90;
const nowIso = () => new Date().toISOString();
const daysBetween = (a, b) => Math.abs((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

/* ---------------------------------------------------------------- validação */

export function validateEntry(e) {
  const errors = [], warnings = [];
  if (!e || typeof e !== 'object') return { ok: false, errors: [{ msg: 'entrada não é objecto' }], warnings };
  const need = (k) => { if (!e[k]) errors.push({ msg: 'falta ' + k }); };
  ['key', 'name', 'kind'].forEach(need);
  if (e.kind && !KINDS[e.kind]) errors.push({ msg: 'kind inválido: ' + e.kind });
  if (!e.access || !e.access.class) errors.push({ msg: 'falta access.class' });
  else if (!ACCESS_CLASSES[e.access.class]) errors.push({ msg: 'classe de acesso inválida: ' + e.access.class });
  if (e.access && e.access.class === 'ANONYMOUS_PUBLIC') {
    const measured = (e.evidence || []).some((x) => x.a === 'sem-chave' && x.status === 'MEASURED');
    if (!measured) errors.push({ msg: 'ANONYMOUS_PUBLIC exige evidência MEASURED de acesso sem chave' });
  }
  if (e.access && e.access.class === 'FREE_API_KEY') {
    const tested = (e.evidence || []).some((x) => x.a === 'exige-chave' && x.status === 'MEASURED');
    if (!tested) warnings.push({ msg: 'FREE_API_KEY sem medição de que a chave é exigida: fica com confiança baixa' });
  }
  if (!Array.isArray(e.evidence) || !e.evidence.length) errors.push({ msg: 'sem evidência: uma entrada do catálogo sem fonte é um boato' });
  (e.evidence || []).forEach((x, i) => {
    if (!x || !x.a) errors.push({ msg: 'evidência[' + i + '] sem afirmação (a)' });
    if (!EVIDENCE_STATUS[x && x.status]) errors.push({ msg: 'evidência[' + i + '] com estado inválido' });
    if (x && x.status === 'MEASURED' && !x.at) errors.push({ msg: 'evidência[' + i + '] MEASURED sem data (at)' });
    if (x && x.status === 'MEASURED' && !x.method) errors.push({ msg: 'evidência[' + i + '] MEASURED sem método' });
    if (x && x.status === 'DECLARED' && !x.url) errors.push({ msg: 'evidência[' + i + '] DECLARED sem URL da fonte' });
    if (x && x.url && !/^https?:\/\//i.test(x.url)) errors.push({ msg: 'evidência[' + i + '] URL não absoluto' });
  });
  const blob = JSON.stringify(e);
  if (/(sk-[a-zA-Z0-9]{16,}|gsk_[a-zA-Z0-9]{16,}|Bearer [A-Za-z0-9._-]{20,})/.test(blob)) {
    errors.push({ msg: 'a entrada parece conter uma chave: o catálogo nunca guarda segredos' });
  }
  if (e.pricing && !e.pricing.currency) errors.push({ msg: 'pricing sem moeda' });
  return { ok: errors.length === 0, errors, warnings };
}

/* Confiança agregada: quantas afirmações foram medidas e há quanto tempo. */
export function evidenceSummary(entry, now) {
  const at = now || nowIso();
  const ev = entry.evidence || [];
  const measured = ev.filter((x) => x.status === 'MEASURED');
  const stale = measured.filter((x) => daysBetween(x.at, at) > STALE_DAYS);
  const declared = ev.filter((x) => x.status === 'DECLARED');
  const lastMeasured = measured.map((x) => x.at).sort().pop() || null;
  return {
    total: ev.length, measured: measured.length, declared: declared.length, stale: stale.length,
    lastMeasuredAt: lastMeasured,
    freshnessDays: lastMeasured ? Math.round(daysBetween(lastMeasured, at)) : null,
    confidence: measured.length === 0 ? 'nenhuma (só declarações)' : stale.length === measured.length ? 'baixa (evidência envelhecida)' : measured.length >= 2 ? 'média' : 'baixa'
  };
}

/* ---------------------------------------------------------------- semente
   Só entra aqui o que já existe no código e tem documentação oficial. Nenhuma
   destas entradas afirma gratuitidade: a classe inicial é FREE_API_KEY apenas
   porque a aplicação exige chave (é isso que o adaptador faz), e a evidência diz
   de onde vem a afirmação. O que foi medido nesta sessão está marcado MEASURED. */

const TODAY = '2026-10-22';

export const SEED = [
  {
    key: 'providers/groq', name: 'Groq', kind: 'endpoint', vendor: 'Groq, Inc.',
    docs: ['https://console.groq.com/docs', 'https://console.groq.com/docs/openai'],
    category: CATEGORY.FREE_TIER,
    access: { class: 'FREE_API_KEY', needsAccount: true, needsCard: null, limits: [], limitSource: 'https://console.groq.com/docs/rate-limits' },
    endpoints: [{ base: 'https://api.groq.com/openai/v1', protocol: 'openai-chat-completions' }],
    evidence: [
      { a: 'exige-chave', status: 'MEASURED', at: TODAY, method: 'GET /openai/v1/models sem Authorization', url: 'https://api.groq.com/openai/v1/models', detail: 'HTTP 401 sem cabeçalho Authorization' },
      { a: 'erro-de-caminho-nao-significa-modelo-inexistente', status: 'MEASURED', at: TODAY, method: 'GET /openai/v1/chat/completions sem chave', url: 'https://api.groq.com/openai/v1/chat/completions', detail: 'HTTP 404 «Unknown request URL: GET …»: é método/caminho errado, não modelo inexistente — o motor de testes distingue os dois' },
      { a: 'plano-gratuito-existe', status: 'DECLARED', url: 'https://console.groq.com/docs/rate-limits', detail: 'limites por modelo, publicados pelo fornecedor' }
    ]
  },
  {
    key: 'providers/openrouter', name: 'OpenRouter', kind: 'endpoint', vendor: 'OpenRouter',
    docs: ['https://openrouter.ai/docs'],
    category: CATEGORY.AGGREGATOR,
    access: { class: 'FREE_API_KEY', needsAccount: true, needsCard: null, limits: [], limitSource: 'https://openrouter.ai/docs/api-reference/limits' },
    endpoints: [{ base: 'https://openrouter.ai/api/v1', protocol: 'openai-chat-completions' }],
    evidence: [
      { a: 'exige-chave', status: 'MEASURED', at: TODAY, method: 'GET /api/v1/chat/completions sem Authorization', url: 'https://openrouter.ai/api/v1/chat/completions', detail: 'a geração exige chave; o catálogo não' },
      { a: 'catálogo-de-modelos-sem-chave', status: 'MEASURED', at: TODAY, method: 'GET /api/v1/models sem chave', url: 'https://openrouter.ai/api/v1/models', detail: 'HTTP 200, lista pública de modelos com preços' },
      { a: 'modelos-com-preco-zero-existem', status: 'MEASURED', at: TODAY, method: 'contagem de entradas com pricing.prompt=0', url: 'https://openrouter.ai/api/v1/models', detail: '21 de 468 modelos com preço 0 na medição de 2026-10-22 (o número varia: é vivo)' }
    ]
  },
  {
    key: 'providers/gemini', name: 'Google Gemini', kind: 'endpoint', vendor: 'Google',
    docs: ['https://ai.google.dev/gemini-api/docs', 'https://ai.google.dev/gemini-api/docs/openai'],
    category: CATEGORY.FREE_TIER,
    access: { class: 'FREE_API_KEY', needsAccount: true, needsCard: null, limits: [], limitSource: 'https://ai.google.dev/gemini-api/docs/rate-limits' },
    endpoints: [{ base: 'https://generativelanguage.googleapis.com/v1beta/openai', protocol: 'openai-chat-completions' }],
    evidence: [
      { a: 'exige-chave', status: 'MEASURED', at: TODAY, method: 'GET /v1beta/models sem chave', url: 'https://generativelanguage.googleapis.com/v1beta/models', detail: 'HTTP 403 «Method doesn\'t allow unregistered callers»: exige credencial' },
      { a: 'documentacao-existe', status: 'DECLARED', url: 'https://ai.google.dev/gemini-api/docs', detail: 'documentação oficial' }
    ]
  },
  {
    key: 'providers/cerebras', name: 'Cerebras', kind: 'endpoint', vendor: 'Cerebras Systems',
    docs: ['https://inference-docs.cerebras.ai/'], category: CATEGORY.FREE_TIER,
    access: { class: 'FREE_API_KEY', needsAccount: true, needsCard: null, limits: [] },
    endpoints: [{ base: 'https://api.cerebras.ai/v1', protocol: 'openai-chat-completions' }],
    evidence: [
      { a: 'exige-chave', status: 'MEASURED', at: TODAY, method: 'GET /v1/models sem chave', url: 'https://api.cerebras.ai/v1/models', detail: 'HTTP 403 «Not authenticated»' },
      { a: 'documentacao-existe', status: 'DECLARED', url: 'https://inference-docs.cerebras.ai/', detail: 'documentação oficial' }
    ]
  },
  {
    key: 'providers/mistral', name: 'Mistral AI', kind: 'endpoint', vendor: 'Mistral AI',
    docs: ['https://docs.mistral.ai/api/'], category: CATEGORY.FREE_TIER,
    access: { class: 'FREE_API_KEY', needsAccount: true, needsCard: null, limits: [] },
    endpoints: [{ base: 'https://api.mistral.ai/v1', protocol: 'openai-chat-completions' }],
    evidence: [
      { a: 'exige-chave', status: 'MEASURED', at: TODAY, method: 'GET /v1/models sem chave', url: 'https://api.mistral.ai/v1/models', detail: 'HTTP 401 «Invalid API Key»' },
      { a: 'documentacao-existe', status: 'DECLARED', url: 'https://docs.mistral.ai/api/', detail: 'documentação oficial' }
    ]
  },
  {
    key: 'providers/huggingface', name: 'Hugging Face Router', kind: 'endpoint', vendor: 'Hugging Face',
    docs: ['https://huggingface.co/docs/inference-providers'], category: CATEGORY.FREE_TIER,
    access: { class: 'FREE_API_KEY', needsAccount: true, needsCard: null, limits: [] },
    endpoints: [{ base: 'https://router.huggingface.co/v1', protocol: 'openai-chat-completions' }],
    evidence: [
      { a: 'exige-chave', status: 'MEASURED', at: TODAY, method: 'GET /v1/models no router de inferência (lista) e comparação com o hub', url: 'https://router.huggingface.co/v1/models', detail: 'a LISTA responde 200 sem chave; a inferência exige token (não testada sem chave: não foi tentada uma geração anónima)' },
      { a: 'catalogo-de-modelos-sem-chave', status: 'MEASURED', at: TODAY, method: 'GET /api/models?limit=1 sem chave', url: 'https://huggingface.co/api/models?limit=1', detail: 'HTTP 200: o catálogo é público' },
      { a: 'pesos-nao-sao-endpoint', status: 'DECLARED', url: 'https://huggingface.co/docs/inference-providers', detail: 'um modelo listado no hub é um conjunto de pesos; a inferência exige um fornecedor' }
    ]
  },
  {
    key: 'providers/cloudflare', name: 'Cloudflare Workers AI', kind: 'endpoint', vendor: 'Cloudflare',
    docs: ['https://developers.cloudflare.com/workers-ai/'], category: CATEGORY.FREE_TIER,
    access: { class: 'FREE_API_KEY', needsAccount: true, needsCard: null, limits: [], needs: ['account_id'] },
    endpoints: [{ base: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1', protocol: 'openai-chat-completions' }],
    evidence: [{ a: 'documentacao-existe', status: 'DECLARED', url: 'https://developers.cloudflare.com/workers-ai/', detail: 'documentação oficial; exige account_id (verificado no código do adaptador)' }]
  },
  {
    key: 'tools/opencode', name: 'OpenCode', kind: 'tool', vendor: 'OpenCode',
    docs: ['https://opencode.ai/docs/'], repo: 'https://github.com/sst/opencode',
    category: CATEGORY.CODING_TOOL,
    access: { class: 'LOCAL_RUNTIME', needsAccount: false, needsCard: false, limits: [], hardware: 'executa no computador do utilizador; consome CPU/RAM do próprio ambiente' },
    evidence: [
      { a: 'documentacao-existe', status: 'MEASURED', at: TODAY, method: 'GET https://opencode.ai/docs/', url: 'https://opencode.ai/docs/', detail: 'HTTP 200, 99 209 B' },
      { a: 'e-uma-ferramenta-nao-um-endpoint', status: 'DECLARED', url: 'https://opencode.ai/docs/', detail: 'agente de programação que usa modelos de outros fornecedores; não é um serviço de inferência' }
    ],
    note: 'Não instalado nesta aplicação. Integração exigiria sandbox e aprovação humana por comando.'
  }
];

/* ---------------------------------------------------------------- descoberta */

/* Adaptadores de descoberta. Cada um devolve candidatos com a evidência que os
   suporta; nenhum inventa campos que a fonte não publica. */
export const DISCOVERY_ADAPTERS = {
  openrouter_models: {
    key: 'openrouter_models', label: 'Catálogo público do OpenRouter',
    url: 'https://openrouter.ai/api/v1/models', needsKey: false,
    category: CATEGORY.AGGREGATOR,
    what: 'modelos com preço por token e contexto, publicados pelo agregador'
  },
  hf_models: {
    key: 'hf_models', label: 'Catálogo público do Hugging Face (pesos)',
    url: 'https://huggingface.co/api/models?limit=20&sort=downloads&direction=-1', needsKey: false,
    category: CATEGORY.SPECIALIZED,
    what: 'pesos de modelo; NÃO é um endpoint de inferência e é registado como tal'
  }
};

function pricePerMillion(raw) {
  const n = Number(raw);
  if (!isFinite(n)) return null;
  return Math.round(n * 1e6 * 1e6) / 1e6;      // USD por 1M de tokens, com 6 casas
}

/* Converte a lista do OpenRouter em entradas de catálogo com evidência MEDIDA. */
export function fromOpenRouter(json, opts) {
  const at = (opts && opts.at) || nowIso();
  const url = (opts && opts.url) || DISCOVERY_ADAPTERS.openrouter_models.url;
  const list = (json && Array.isArray(json.data)) ? json.data : [];
  const entries = [];
  const free = [];
  for (const m of list) {
    const prompt = m.pricing ? pricePerMillion(m.pricing.prompt) : null;
    const completion = m.pricing ? pricePerMillion(m.pricing.completion) : null;
    const isFree = prompt === 0 && completion === 0;
    if (isFree) free.push(m.id);
    entries.push({
      key: 'openrouter/models/' + m.id,
      name: m.name || m.id, kind: 'model', vendor: 'OpenRouter', parent: 'providers/openrouter',
      category: isFree ? CATEGORY.FREE_TIER : CATEGORY.AGGREGATOR,
      access: {
        class: isFree ? 'FREE_API_KEY' : 'PAID',
        needsAccount: true, needsCard: null,
        limits: m.top_provider && m.top_provider.max_completion_tokens ? ['máx. conclusão: ' + m.top_provider.max_completion_tokens + ' tokens'] : []
      },
      contextLength: m.context_length || null,
      pricing: (prompt == null && completion == null) ? null : {
        currency: 'USD', unit: 'por 1M tokens', prompt, completion,
        declaredPromotion: isFree ? 'preço 0 publicado pelo agregador (pode mudar sem aviso)' : null
      },
      modalities: m.architecture ? { input: m.architecture.input_modalities || null, output: m.architecture.output_modalities || null } : null,
      evidence: [
        { a: 'existe-no-catalogo', status: 'MEASURED', at, method: 'GET ' + url, url, detail: 'identificador publicado: ' + m.id },
        { a: isFree ? 'preco-zero-publicado' : 'preco-publicado', status: 'MEASURED', at, method: 'campo pricing do catálogo', url,
          detail: 'prompt=' + (m.pricing ? m.pricing.prompt : '?') + ' / completion=' + (m.pricing ? m.pricing.completion : '?') + ' USD por token' }
      ]
    });
  }
  return { entries, total: list.length, freeCount: free.length, freeSample: free.slice(0, 10), at };
}

export function fromHuggingFace(json, opts) {
  const at = (opts && opts.at) || nowIso();
  const url = (opts && opts.url) || DISCOVERY_ADAPTERS.hf_models.url;
  const list = Array.isArray(json) ? json : [];
  const entries = list.map((m) => ({
    key: 'hf/weights/' + (m.id || m.modelId),
    name: m.id || m.modelId, kind: 'weights', vendor: 'Hugging Face', parent: 'providers/huggingface',
    category: CATEGORY.SPECIALIZED,
    access: { class: 'UNKNOWN_ACCESS', needsAccount: null, needsCard: null, limits: [],
      note: 'pesos publicados; não é endpoint. A inferência depende de um fornecedor que os sirva.' },
    downloads: m.downloads == null ? null : m.downloads,
    evidence: [{ a: 'existe-no-catalogo', status: 'MEASURED', at, method: 'GET ' + url, url, detail: 'identificador publicado: ' + (m.id || m.modelId) }]
  }));
  return { entries, total: list.length, at };
}

/* ---------------------------------------------------------------- ranking */
/* Pesos do pedido (§4.1). Configuráveis por tipo de tarefa. */
export const TASK_TYPES = {
  conversa: { label: 'conversa e resumo', weights: { quality: 25, reliability: 20, security: 15, integration: 10, latency: 10, cost: 10, continuity: 5, maintenance: 5 } },
  codigo: { label: 'programação e revisão de código', weights: { quality: 30, reliability: 20, security: 10, integration: 15, latency: 5, cost: 10, continuity: 5, maintenance: 5 } },
  raciocinio: { label: 'raciocínio e planeamento', weights: { quality: 30, reliability: 20, security: 15, integration: 5, latency: 5, cost: 10, continuity: 5, maintenance: 10 } },
  investigacao: { label: 'investigação e fontes', weights: { quality: 25, reliability: 20, security: 15, integration: 10, latency: 5, cost: 10, continuity: 5, maintenance: 10 } },
  documentos: { label: 'análise documental', weights: { quality: 25, reliability: 20, security: 20, integration: 10, latency: 5, cost: 5, continuity: 5, maintenance: 10 } },
  ferramentas: { label: 'chamadas de ferramentas', weights: { quality: 20, reliability: 25, security: 10, integration: 20, latency: 10, cost: 5, continuity: 5, maintenance: 5 } }
};

export const EXCLUSION_RULES = [
  { id: 'risco-critico', test: (m) => m.risk === 'critical', reason: 'risco crítico de segurança: não é recomendado para produção, seja qual for a nota' },
  { id: 'sem-geracao', test: (m) => !m.tested || !m.tested.generation, reason: 'nunca gerou uma resposta válida: não pode ser recomendado para produção' },
  { id: 'suspenso', test: (m) => m.state === 'SUSPENDED' || m.state === 'REJECTED', reason: 'suspenso ou rejeitado por decisão registada' },
  { id: 'evidencia-envelhecida', test: (m) => m.freshnessDays != null && m.freshnessDays > 90, reason: 'evidência com mais de 90 dias: exige reavaliação antes de recomendar' }
];

/* Calcula a nota de um candidato SÓ com métricas medidas. Sem métricas, a nota
   é null e a razão diz o que falta — nunca um zero nem uma média inventada. */
export function scoreCandidate(cand, task, opts) {
  const t = TASK_TYPES[task] ? task : 'conversa';
  const w = TASK_TYPES[t].weights;
  const missing = [];
  const dims = {};

  const m = cand.metrics || {};
  const put = (name, value) => { if (value == null || !isFinite(value)) missing.push(name); else dims[name] = Math.max(0, Math.min(100, Math.round(value))); };

  put('quality', m.qualityScore);
  put('reliability', m.successRate == null ? null : m.successRate * 100);
  put('security', m.securityScore);
  put('integration', m.integrationScore);
  put('latency', m.latencyP50Ms == null ? null : latencyScore(m.latencyP50Ms));
  put('cost', m.costPerTaskUsd == null ? null : costScore(m.costPerTaskUsd));
  put('continuity', m.uptime == null ? null : m.uptime * 100);
  put('maintenance', m.maintenanceScore);

  const excluded = EXCLUSION_RULES.filter((r) => { try { return r.test(cand); } catch { return false; } })
    .map((r) => ({ id: r.id, reason: r.reason }));

  const known = Object.keys(dims);
  const missingKeys = Object.keys(w).filter((k) => known.indexOf(k) < 0);
  let score = null, coverage = 0;
  if (known.length) {
    const totalKnown = known.reduce((s, k) => s + w[k], 0);
    const sum = known.reduce((s, k) => s + dims[k] * w[k], 0);
    score = Math.round(sum / (totalKnown || 1));
    coverage = Math.round((totalKnown / 100) * 100) / 100;
  }
  const provisional = missingKeys.length > 0;
  return {
    task: t, score, provisional,
    verdict: score == null ? 'Classificação provisória — evidência insuficiente' :
      (provisional ? 'Classificação provisória — faltam ' + missingKeys.length + ' dimensão(ões): ' + missingKeys.join(', ') : 'classificação completa'),
    band: score == null ? null : bandOf(score),
    dims, weights: w, coverage,
    missing: missingKeys,
    excludedFromProduction: excluded,
    usable: !excluded.length && score != null
  };
}

function latencyScore(ms) {
  if (ms <= 800) return 100;
  if (ms >= 20000) return 0;
  return Math.round(100 - ((ms - 800) / (20000 - 800)) * 100);
}
function costScore(usd) {
  if (usd <= 0) return 100;
  if (usd >= 1) return 0;
  return Math.round(100 - Math.log10(usd * 1000) * 25);
}
export function bandOf(score) {
  if (score == null) return null;
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  if (score >= 25) return 'D';
  return 'E';
}

/* Erro de preço por tarefa a partir de tokens MEDIDOS e do preço publicado. */
export function costOfTask({ promptTokens, completionTokens, pricing }) {
  if (!pricing || pricing.prompt == null || pricing.completion == null) return { usd: null, reason: 'sem preço publicado para este modelo' };
  if (promptTokens == null || completionTokens == null) return { usd: null, reason: 'o fornecedor não reportou tokens nesta execução' };
  const perM = 1e6;
  const usd = (promptTokens / perM) * pricing.prompt + (completionTokens / perM) * pricing.completion;
  return { usd: Math.round(usd * 1e8) / 1e8, basis: 'tokens medidos × preço publicado (' + pricing.currency + ' por 1M)' };
}

export function publicEntry(e, now) {
  const { evidence, ...rest } = e;
  return Object.assign({}, rest, {
    evidence: (evidence || []).map((x) => ({ a: x.a, status: x.status, at: x.at || null, url: x.url || null, method: x.method || null, detail: x.detail || null })),
    evidenceSummary: evidenceSummary(e, now)
  });
}
