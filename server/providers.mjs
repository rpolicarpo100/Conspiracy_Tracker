/* =====================================================================
   AI PROVIDER ROUTER
   Um adaptador comum (OpenAI Chat Completions) para vários fornecedores.
   Regras:
   · nenhuma capacidade é presumida — testa-se o modelo antes de o usar;
   · sem chave configurada o estado é «não configurado», não «a funcionar»;
   · as chaves nunca saem do servidor (só máscara);
   · a utilização e o custo só são apresentados quando o fornecedor os
     reporta; caso contrário aparecem como «não reportado»;
   · URLs de fornecedor são validadas contra SSRF (nada de endereços privados).
   ===================================================================== */
/* mesma regra anti-SSRF usada pelo agente de recolha (reimplementada aqui para não
   arrastar o módulo do agente, que carrega o ledger do navegador) */
function isPrivateHost(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (h === '::1' || h.startsWith('fd') || h.startsWith('fe80') || h === '[::1]') return true;
  return false;
}
export { isPrivateHost };

export const PROVIDERS = {
  gemini: {
    label: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelsHint: ['gemini-2.0-flash', 'gemini-1.5-flash'], authStyle: 'bearer',
    docs: 'https://ai.google.dev/gemini-api/docs/openai', freeTier: 'sim (com limites)',
    keyUrl: 'https://aistudio.google.com/apikey', envVar: 'AI_KEY_GEMINI',
    probe: { url: 'https://generativelanguage.googleapis.com/v1beta/models', verificado: '403 sem chave em 2026-10-22 (endpoint existe)' }
  },
  groq: {
    label: 'Groq', base: 'https://api.groq.com/openai/v1',
    modelsHint: ['llama-3.3-70b-versatile', 'openai/gpt-oss-20b'], authStyle: 'bearer',
    docs: 'https://console.groq.com/docs/openai', freeTier: 'sim (com limites)',
    keyUrl: 'https://console.groq.com/keys', envVar: 'AI_KEY_GROQ',
    probe: { url: 'https://api.groq.com/openai/v1/models', verificado: '401 sem chave em 2026-10-22 (endpoint existe)' }
  },
  openrouter: {
    label: 'OpenRouter', base: 'https://openrouter.ai/api/v1',
    modelsHint: ['openai/gpt-4o-mini', 'google/gemini-2.0-flash-001'], authStyle: 'bearer',
    docs: 'https://openrouter.ai/docs/quickstart', freeTier: 'modelos gratuitos e pagos',
    keyUrl: 'https://openrouter.ai/keys', envVar: 'AI_KEY_OPENROUTER',
    gratis: 'modelos com sufixo :free — 17 disponíveis na lista pública em 2026-10-22',
    probe: { url: 'https://openrouter.ai/api/v1/models', verificado: '200 em 2026-10-22 (468 modelos, 17 :free)' }
  },
  cerebras: {
    label: 'Cerebras', base: 'https://api.cerebras.ai/v1',
    modelsHint: ['llama-3.3-70b', 'llama3.1-8b'], authStyle: 'bearer',
    docs: 'https://inference-docs.cerebras.ai/', freeTier: 'sim (com limites)',
    keyUrl: 'https://cloud.cerebras.ai (API keys)', envVar: 'AI_KEY_CEREBRAS',
    probe: { url: 'https://api.cerebras.ai/v1/models', verificado: '403 sem chave em 2026-10-22 (endpoint existe)' }
  },
  mistral: {
    label: 'Mistral AI', base: 'https://api.mistral.ai/v1',
    modelsHint: ['mistral-large-latest', 'mistral-small-latest'], authStyle: 'bearer',
    docs: 'https://docs.mistral.ai/api/', freeTier: 'experimental',
    keyUrl: 'https://console.mistral.ai/api-keys', envVar: 'AI_KEY_MISTRAL',
    probe: { url: 'https://api.mistral.ai/v1/models', verificado: '401 sem chave em 2026-10-22 (endpoint existe)' }
  },
  huggingface: {
    label: 'Hugging Face Router', base: 'https://router.huggingface.co/v1',
    modelsHint: ['meta-llama/Llama-3.3-70B-Instruct'], authStyle: 'bearer',
    docs: 'https://huggingface.co/docs/inference-providers', freeTier: 'créditos limitados',
    keyUrl: 'https://huggingface.co/settings/tokens', envVar: 'AI_KEY_HUGGINGFACE',
    probe: { url: 'https://router.huggingface.co/v1/models', verificado: '200 em 2026-10-22 (lista pública de modelos)' }
  },
  cloudflare: {
    label: 'Cloudflare Workers AI', base: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
    modelsHint: ['@cf/meta/llama-3.1-8b-instruct'], authStyle: 'bearer', needs: ['account_id'],
    docs: 'https://developers.cloudflare.com/workers-ai/', freeTier: 'sim (neurons/dia)',
    keyUrl: 'https://dash.cloudflare.com/profile/api-tokens', envVar: 'AI_KEY_CLOUDFLARE'
  },
  /* ---------- acrescentados na fase 11, todos verificados por sonda real ----------
     Cada entrada diz onde se obtém a chave (keyUrl), qual é a variável de ambiente
     que o operador pode preencher no Render (envVar) e qual é o nível gratuito tal
     como o fornecedor o anuncia. O que não foi possível verificar por HTTP está
     declarado como tal — não se inventa «gratuito». */
  github: {
    label: 'GitHub Models', base: 'https://models.github.ai/inference',
    modelsHint: ['openai/gpt-4o-mini', 'meta/Llama-3.3-70B-Instruct'],
    authStyle: 'bearer', docs: 'https://docs.github.com/en/github-models',
    freeTier: 'sim — incluído no GitHub com limites de pedidos por minuto/dia',
    keyUrl: 'https://github.com/settings/tokens (PAT com scope models:read)', envVar: 'AI_KEY_GITHUB',
    probe: { url: 'https://models.github.ai/inference/models', verificado: '200 em 2026-10-22' }
  },
  nvidia: {
    label: 'NVIDIA NIM (build.nvidia.com)', base: 'https://integrate.api.nvidia.com/v1',
    modelsHint: ['meta/llama-3.3-70b-instruct', 'mistralai/mistral-large-2-instruct'],
    authStyle: 'bearer', docs: 'https://docs.api.nvidia.com/nim/',
    freeTier: 'sim — créditos gratuitos de desenvolvedor',
    keyUrl: 'https://build.nvidia.com (conta gratuita → API key)', envVar: 'AI_KEY_NVIDIA',
    probe: { url: 'https://integrate.api.nvidia.com/v1/models', verificado: '200 em 2026-10-22 (lista pública de modelos)' }
  },
  sambanova: {
    label: 'SambaNova Cloud', base: 'https://api.sambanova.ai/v1',
    modelsHint: ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-V3.1'],
    authStyle: 'bearer', docs: 'https://docs.sambanova.ai/',
    freeTier: 'sim — nível gratuito com limites',
    keyUrl: 'https://cloud.sambanova.ai (API key)', envVar: 'AI_KEY_SAMBANOVA',
    probe: { url: 'https://api.sambanova.ai/v1/models', verificado: '200 em 2026-10-22 (lista pública de modelos)' }
  },
  cohere: {
    label: 'Cohere', base: 'https://api.cohere.com/compatibility/v1',
    modelsHint: ['command-r-plus-08-2024', 'command-r7b-12-2024'],
    authStyle: 'bearer', docs: 'https://docs.cohere.com/docs/compatibility-api',
    freeTier: 'trial gratuito (limitado no tempo e no volume)',
    keyUrl: 'https://dashboard.cohere.com/api-keys', envVar: 'AI_KEY_COHERE',
    probe: { url: 'https://api.cohere.com/v1/models', verificado: '401 sem chave em 2026-10-22 (endpoint existe)' }
  },
  /* Sem chave: é o que permite a aplicação ter IA sem o utilizador criar conta
     em lado nenhum. Serviço comunitário — sem SLA, com limites, e com um aviso de
     privacidade explícito na interface e em docs/PRIVACIDADE.md. */
  pollinations: {
    label: 'Pollinations (sem chave)', base: 'https://text.pollinations.ai/openai',
    modelsHint: ['openai', 'openai-fast'], authStyle: 'none',
    docs: 'https://github.com/pollinations/pollinations',
    freeTier: 'sim — sem chave; serviço comunitário, sem garantia de disponibilidade',
    keyUrl: null, envVar: null, keyless: true,
    privacidade: 'os pedidos passam por um serviço público de terceiros: não enviar dados pessoais nem provas privadas',
    probe: { url: 'https://text.pollinations.ai/openai', verificado: 'POST completou em 2026-10-22 (HTTP 200, resposta real)' }
  },
  custom: {
    label: 'Compatível com OpenAI (personalizado)', base: '', modelsHint: [], authStyle: 'bearer',
    docs: null, freeTier: 'desconhecido'
  }
};

const DEFAULT_TIMEOUT = 20000;
const breaker = new Map();      // chave -> { fails, openedAt }

export function breakerState(key) {
  const b = breaker.get(key);
  if (!b || !b.openedAt) return { open: false, fails: b ? b.fails : 0 };
  if (Date.now() - b.openedAt > 60000) { breaker.set(key, { fails: 0, openedAt: null }); return { open: false, fails: 0 }; }
  return { open: true, fails: b.fails, retryInMs: 60000 - (Date.now() - b.openedAt) };
}

function recordFailure(key) {
  const b = breaker.get(key) || { fails: 0, openedAt: null };
  b.fails++;
  if (b.fails >= 3) b.openedAt = Date.now();
  breaker.set(key, b);
}
function recordSuccess(key) { breaker.set(key, { fails: 0, openedAt: null }); }

export function validateBaseUrl(base) {
  const errors = [];
  if (!base) return ['URL base ausente'];
  let u = null;
  try { u = new URL(base); } catch { return ['URL inválida']; }
  if (!/^https:$/.test(u.protocol)) errors.push('o fornecedor tem de usar https');
  if (isPrivateHost(u.hostname)) errors.push('endereço privado/local proibido (SSRF)');
  return errors;
}

export function resolveProvider(name, cfg) {
  cfg = cfg || {};
  const spec = PROVIDERS[name];
  if (!spec) return { error: 'fornecedor desconhecido: ' + name };
  let base = (cfg && cfg.base) || spec.base;
  if (spec.needs && spec.needs.indexOf('account_id') >= 0) {
    const acc = cfg && cfg.accountId;
    if (base.indexOf('{account_id}') >= 0) {
      if (!acc) return { error: 'este fornecedor exige o account_id' };
      base = base.replace('{account_id}', encodeURIComponent(acc));
    }
  }
  let errors = validateBaseUrl(base);
  // apenas para testes automatizados: permite um servidor local http
  if (cfg.allowInsecure === true) errors = errors.filter((e) => !/^(o fornecedor tem de usar https|endereço privado)/.test(e));
  // impedir duplicação de caminho: /v1 + /chat/completions, nunca /v1/chat/completions/chat/completions
  let clean = base.replace(/\/+$/, '');
  clean = clean.replace(/\/(chat\/completions)$/, '');
  return { spec, base: clean, errors };
}

export function urlFor(base, path) {
  const b = base.replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(b) && path === '/chat/completions') return b;
  return b + path;
}

/* Lista de modelos do fornecedor (GET /models). Serve para não ficar preso a um
   nome de modelo que mudou: os catálogos dos fornecedores mudam sem aviso e um
   nome fixo no código transforma-se, mais cedo ou mais tarde, num erro de
   utilizador por causa de um erro nosso. Só envia a chave; nenhum conteúdo. */
export async function listModels({ provider, base, apiKey, timeoutMs, fetchImpl, accountId }) {
  const r = resolveProvider(provider, { base, accountId });
  if (r.error) return { ok: false, error: r.error };
  const semChave = !!(r.spec && (r.spec.keyless === true || r.spec.authStyle === 'none'));
  if (!apiKey && !semChave) return { ok: false, error: 'sem chave configurada para ' + provider };
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = 'Bearer ' + apiKey;
  const resp = await httpJson(urlFor(r.base, '/models'), { method: 'GET', headers, timeoutMs: timeoutMs || 8000, fetchImpl });
  if (!resp.ok) return { ok: false, status: resp.status, error: resp.error || ('HTTP ' + resp.status), text: (resp.text || '').slice(0, 300) };
  const bruto = resp.json && Array.isArray(resp.json.data) ? resp.json.data
    : (Array.isArray(resp.json) ? resp.json : []);
  const models = bruto.map((m) => (typeof m === 'string' ? m : (m && (m.id || m.name)))).filter(Boolean);
  return { ok: models.length > 0, models: models, source: 'GET /models', at: new Date().toISOString() };
}

async function httpJson(url, { method, headers, body, timeoutMs, fetchImpl }) {
  const f = fetchImpl || fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || DEFAULT_TIMEOUT);
  const t0 = Date.now();
  try {
    const res = await f(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* resposta não JSON */ }
    return { status: res.status, ok: res.ok, json, text: text.slice(0, 2000), ms: Date.now() - t0, headers: res.headers };
  } catch (e) {
    return { status: 0, ok: false, error: e.name === 'AbortError' ? 'timeout após ' + (timeoutMs || DEFAULT_TIMEOUT) + ' ms' : String(e.message || e), ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

/* Validação real: lista de modelos + uma chamada mínima de geração.
   Não marca nada como operacional sem ambas as respostas. */
export async function validateProvider({ provider, base, apiKey, model, accountId, timeoutMs, fetchImpl, allowInsecure }) {
  const r = resolveProvider(provider, { base, accountId, allowInsecure });
  if (r.error) return { ok: false, stage: 'config', error: r.error };
  if (r.errors && r.errors.length) return { ok: false, stage: 'config', error: r.errors.join('; ') };
  if (!apiKey) return { ok: false, stage: 'credentials', error: 'sem chave: não é possível validar' };
  const headers = { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' };
  const out = { provider, base: r.base, models: [], model: model || null, checks: [] };

  const list = await httpJson(urlFor(r.base, '/models'), { method: 'GET', headers, timeoutMs, fetchImpl });
  if (list.status === 401 || list.status === 403) {
    return Object.assign(out, { ok: false, stage: 'auth', error: 'credencial recusada (HTTP ' + list.status + ')', latencyMs: list.ms });
  }
  const ids = (list.json && (list.json.data || []).map((m) => m.id)) || null;
  out.checks.push({ step: 'lista de modelos', status: list.status, latencyMs: list.ms, count: ids ? ids.length : null, note: ids ? null : 'fornecedor não expõe /models' });
  if (ids) out.models = ids.slice(0, 200);
  if (model && ids && ids.indexOf(model) < 0) {
    return Object.assign(out, { ok: false, stage: 'model', error: 'modelo «' + model + '» não existe na conta; disponíveis: ' + ids.slice(0, 5).join(', ') });
  }
  if (!model) return Object.assign(out, { ok: false, stage: 'model', error: 'é necessário indicar o modelo a validar' });

  const chat = await httpJson(urlFor(r.base, '/chat/completions'), {
    method: 'POST', headers, timeoutMs: timeoutMs || DEFAULT_TIMEOUT, fetchImpl,
    body: { model, messages: [{ role: 'user', content: 'Responda apenas: ok' }], max_tokens: 8, temperature: 0 }
  });
  out.checks.push({ step: 'geração mínima', status: chat.status, latencyMs: chat.ms });
  if (!chat.ok) {
    const err = (chat.json && chat.json.error && (chat.json.error.message || chat.json.error)) || chat.error || ('HTTP ' + chat.status);
    return Object.assign(out, { ok: false, stage: 'generation', error: String(err).slice(0, 300), latencyMs: chat.ms });
  }
  const usage = (chat.json && chat.json.usage) || {};
  out.usageReported = usage.total_tokens != null;
  out.usage = { promptTokens: usage.prompt_tokens != null ? usage.prompt_tokens : null, completionTokens: usage.completion_tokens != null ? usage.completion_tokens : null };
  out.sample = chat.json && chat.json.choices && chat.json.choices[0] && (chat.json.choices[0].message || {}).content;
  out.ok = true; out.latencyMs = chat.ms;
  return out;
}

/* Execução com timeout, retry limitado, fallback explícito e circuit breaker. */
/* ---- cortesia com o fornecedor SEM CHAVE ----
   O serviço público responde «Free limit reached: 1 reply every 30 seconds per IP».
   Sem isto, dois agentes em paralelo colidiam e a execução parava com «falha-de-ia».
   Aqui os pedidos sem chave são serializados (uma fila) e, se o fornecedor pedir
   espera, espera-se o tempo que ele indicou — no máximo 35 s, uma única vez.
   Isto não é uma promessa de qualidade: é só não abusar de um serviço alheio. */
let filaSemChave = Promise.resolve();
let ultimoSemChave = 0;
const ESPACO_SEM_CHAVE_MS = 1200;

function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }
function comFila(fn) {
  const proximo = filaSemChave.then(fn, fn);
  filaSemChave = proximo.then(() => {}, () => {});
  return proximo;
}
function esperaPedidaPeloFornecedor(texto) {
  const t = String(texto || '');
  const m = t.match(/retry after\s*(\d+)\s*s/i) || t.match(/try again in\s*(\d+)\s*s/i);
  if (m) return Math.min(35000, Number(m[1]) * 1000 + 500);
  if (/free limit reached/i.test(t)) return 31000;      // regra declarada: 1 por 30 s
  return 0;
}

export async function complete({ provider, base, apiKey, model, messages, timeoutMs, accountId, fetchImpl, retries, allowInsecure }) {
  const key = provider + ':' + (model || '');
  const b = breakerState(key);
  if (b.open) return { ok: false, error: 'circuit breaker aberto para ' + key + ' (nova tentativa em ' + Math.ceil(b.retryInMs / 1000) + ' s)', circuitOpen: true };
  const r = resolveProvider(provider, { base, accountId, allowInsecure });
  if (r.error) return { ok: false, error: r.error };
  if (r.errors && r.errors.length) return { ok: false, error: r.errors.join('; ') };
  /* fornecedores sem chave (ex.: Pollinations): o pedido é anónimo por desenho.
     Para os outros, uma chave em falta é erro declarado — nunca se envia um
     cabeçalho vazio a fingir de credencial. */
  const semChave = !!(r.spec && (r.spec.keyless === true || r.spec.authStyle === 'none'));
  if (!apiKey && !semChave) return { ok: false, error: 'sem chave configurada para ' + provider };
  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = 'Bearer ' + apiKey;
  const attempts = Math.max(1, Math.min(3, retries == null ? 2 : retries));
  const pedir = () => httpJson(urlFor(r.base, '/chat/completions'), {
    method: 'POST', headers, timeoutMs, fetchImpl, body: { model, messages, temperature: 0.2 }
  });
  const umPedido = async () => {
    if (semChave) {
      if (Date.now() - ultimoSemChave < ESPACO_SEM_CHAVE_MS) await esperar(ESPACO_SEM_CHAVE_MS);
      ultimoSemChave = Date.now();
      return pedir();
    }
    return pedir();
  };
  const correr = async () => {
    let last = null;
    let esperouMs = 0;
    for (let i = 0; i < attempts; i++) {
      const res = await umPedido();
      last = res;
      if (res.ok) { recordSuccess(key); const u = (res.json && res.json.usage) || {};
        return { ok: true, text: (res.json.choices && res.json.choices[0] && res.json.choices[0].message || {}).content,
          latencyMs: res.ms, esperouMs, usage: { promptTokens: u.prompt_tokens != null ? u.prompt_tokens : null, completionTokens: u.completion_tokens != null ? u.completion_tokens : null }, raw: res.json }; }
      if (res.status === 401 || res.status === 403) break;         // repetir com a mesma chave é inútil
      if (res.status === 400) break;                               // erro de pedido: repetir não ajuda
      /* limite de pedidos: se o fornecedor sem chave disser quanto esperar, espera-se UMA vez */
      if (res.status === 429 && semChave && i === 0) {
        const ms = esperaPedidaPeloFornecedor((res.json && JSON.stringify(res.json)) || res.text);
        if (ms > 0) { await esperar(ms); esperouMs += ms; ultimoSemChave = Date.now(); continue; }
      }
    }
    return { last, esperouMs };
  };
  const feito = semChave ? await comFila(correr) : await correr();
  if (feito.ok) return feito;
  recordFailure(key);
  const last = feito.last || {};
  const msg = (last.json && last.json.error && (last.json.error.message || last.json.error)) || last.error || ('HTTP ' + last.status);
  return { ok: false, error: String(msg).slice(0, 300), status: last.status, latencyMs: last.ms, esperouMs: feito.esperouMs || 0 };
}

export function registryPublic() {
  return Object.keys(PROVIDERS).map((id) => ({
    id, label: PROVIDERS[id].label, base: PROVIDERS[id].base, needs: PROVIDERS[id].needs || [],
    docs: PROVIDERS[id].docs, freeTier: PROVIDERS[id].freeTier, modelsHint: PROVIDERS[id].modelsHint,
    keyUrl: PROVIDERS[id].keyUrl || null, envVar: PROVIDERS[id].envVar || null,
    keyless: !!PROVIDERS[id].keyless, probe: PROVIDERS[id].probe || null,
    adapter: 'openai-chat-completions'
  }));
}
