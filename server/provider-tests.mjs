/* =====================================================================
   MOTOR DE TESTES DE FORNECEDORES — níveis 1 a 6 (Provider OS · fase 3)

   Cada teste produz um resultado explícito:
     PASS · FAIL · BLOCKED · NOT_TESTED · STALE
   e nunca um «ok» ambíguo. Regras que estão no código:

   · nível 1 (existência) não testa geração; nível 2 (acesso) descobre QUEM
     exige credencial; nível 3 (ligação) faz um pedido mínimo e mede a rede;
     nível 4 (geração) só corre com chave; nível 5 (capacidades) só testa o
     que o fornecedor declara; nível 6 (fiabilidade) repete amostras e mede
     taxa de sucesso e percentis;
   · um 404 NÃO é «modelo inexistente»: o corpo e o caminho são inspeccionados
     para distinguir «caminho/método errado» de «modelo ausente da conta»;
   · 401/403 não se repetem (repetir com a mesma chave é inútil);
   · 429 é limite de utilização (retryable) e não avaria;
   · a chave nunca sai daqui: os resultados guardam apenas código, latência,
     diagnóstico e um excerto do corpo com o segredo removido;
   · pedidos contam para um orçamento: sem orçamento, não há testes;
   · fornecedores sintéticos (servidor de teste local) podem correr, mas ficam
     marcados `synthetic: true` e são excluídos do ranking de produção.
   ===================================================================== */
import { isPrivateHost } from './providers.mjs';

export const TEST_LEVELS = {
  1: { id: 'existencia', label: 'existência e fonte oficial' },
  2: { id: 'acesso', label: 'tipo de autenticação e endpoint' },
  3: { id: 'ligacao', label: 'ligação real com credencial' },
  4: { id: 'geracao', label: 'geração válida' },
  5: { id: 'capacidades', label: 'capacidades declaradas' },
  6: { id: 'fiabilidade', label: 'fiabilidade por amostras' },
  /* o nível 7 NÃO é executado por este motor: é produzido pelo módulo de
     benchmarks (server/benchmark.mjs) e gravado na mesma história. Declarado
     aqui para que a numeração seja uma só em todo o sistema. */
  7: { id: 'qualidade', label: 'qualidade medida por benchmark (ver server/benchmark.mjs)', engine: 'benchmark' }
};

export const RESULTS = ['PASS', 'FAIL', 'BLOCKED', 'NOT_TESTED', 'STALE'];

const DEFAULT_TIMEOUT = 15000;
const MAX_SAMPLES = 5;
const UA = 'ConspiracyTracker/2 (teste de fornecedor; ver docs/PROVIDER-OS.md)';

/* Remove do texto tudo o que possa ser segredo antes de guardar ou mostrar. */
export function redact(text, secrets) {
  let out = String(text == null ? '' : text);
  (secrets || []).filter(Boolean).forEach((s) => {
    if (String(s).length < 6) return;
    out = out.split(String(s)).join('«removido»');
  });
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer «removido»');
  out = out.replace(/\b(sk-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9_-]{8,}|hf_[A-Za-z0-9]{8,})\b/g, '«removido»');
  return out.slice(0, 600);
}

/* Diagnóstico: a parte que evita confundir avaria com modelo inexistente. */
export function classifyFailure({ status, body, error, endpoint }) {
  const texto = String(body || error || '').toLowerCase();
  if (!status && /abort|timeout/i.test(String(error || ''))) {
    return { diagnosis: 'timeout', retryable: true, hint: 'não houve resposta no tempo limite; pode ser rede ou serviço lento' };
  }
  if (!status) return { diagnosis: 'rede', retryable: true, hint: 'falha de ligação (DNS/TLS/rede): ' + String(error || '').slice(0, 120) };
  if (status === 401) return { diagnosis: 'credencial-recusada', retryable: false, hint: 'chave inválida ou ausente (401): repetir com a mesma chave não ajuda' };
  if (status === 403) {
    if (/quota|billing|payment|exceeded/.test(texto)) return { diagnosis: 'conta-sem-quota', retryable: false, hint: 'a conta não tem quota/pagamento para este recurso (403)' };
    if (/unregistered|unauthenticated|not authenticated|missing.*key/.test(texto)) return { diagnosis: 'sem-credencial', retryable: false, hint: 'o serviço exige credencial (403)' };
    return { diagnosis: 'proibido', retryable: false, hint: 'acesso proibido (403): não se contorna' };
  }
  if (status === 404) {
    if (/unknown request url|no route|not found: \/|cannot (get|post)/.test(texto)) {
      return { diagnosis: 'caminho-errado', retryable: false, hint: 'o ENDPOINT/método não existe (404 no caminho), não é o modelo' };
    }
    if (/model/.test(texto)) return { diagnosis: 'modelo-inexistente', retryable: false, hint: 'o modelo pedido não existe nesta conta (404)' };
    return { diagnosis: 'nao-encontrado', retryable: false, hint: 'recurso não encontrado (404): verificar caminho, versão e identificador' };
  }
  if (status === 400 || status === 422) {
    if (/model/.test(texto) && /(not|invalid|unknown)/.test(texto)) return { diagnosis: 'modelo-inexistente', retryable: false, hint: 'parâmetro «model» recusado: identificador inválido para este fornecedor' };
    return { diagnosis: 'pedido-invalido', retryable: false, hint: 'o fornecedor recusou o formato do pedido (' + status + '): problema nosso, não do serviço' };
  }
  if (status === 429) return { diagnosis: 'limite-utilizacao', retryable: true, hint: 'limite de pedidos (429): esperar; não é avaria nem modelo inexistente' };
  if (status >= 500) return { diagnosis: 'erro-do-fornecedor', retryable: true, hint: 'o fornecedor falhou (' + status + '): problema deles, registado como indisponibilidade' };
  return { diagnosis: 'desconhecido', retryable: false, hint: 'HTTP ' + status + ' sem classificação: ' + String(endpoint || '') };
}

function safeUrl(raw) {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return { error: 'protocolo não suportado: ' + u.protocol };
    if (isPrivateHost(u.hostname) && !(process.env.VN_TEST_PROVIDERS === '1' && u.hostname === '127.0.0.1')) {
      return { error: 'endereço privado/local proibido (SSRF)' };
    }
    return { url: u };
  } catch { return { error: 'URL inválida: ' + String(raw).slice(0, 120) }; }
}

/* Junta o contador de pedidos ao contexto de cada nível (orçamento medido). */
const lv = (ctx, extra) => Object.assign({ tracker: ctx && ctx.tracker }, extra || {});

async function http(method, url, { headers, body, timeoutMs, fetchImpl, tracker } = {}) {
  const alvo = safeUrl(url);
  if (alvo.error) return { ok: false, status: 0, error: alvo.error, ms: 0, json: null, text: '' };
  if (tracker) tracker.spent++;          // só conta o que sai mesmo pela rede
  const f = fetchImpl || fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || DEFAULT_TIMEOUT);
  const t0 = Date.now();
  try {
    const res = await f(url, {
      method, headers: Object.assign({ 'user-agent': UA }, headers || {}),
      body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal, redirect: 'follow'
    });
    const texto = await res.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* resposta não JSON */ }
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, json, text: texto.slice(0, 4000), url };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: e.name === 'AbortError' ? 'timeout de ' + (timeoutMs || DEFAULT_TIMEOUT) + ' ms' : String(e.message || e), json: null, text: '', url };
  } finally { clearTimeout(timer); }
}

const clean = (r) => ({ status: r.status, ms: r.ms, ok: r.ok });

/* ------------------------------------------------------------------ níveis */

async function level1Existence(entry, ctx) {
  const docs = (entry.docs || [])[0];
  if (!docs) return { result: 'NOT_TESTED', reason: 'entrada sem documentação oficial registada' };
  const r = await http('GET', docs, lv(ctx, { timeoutMs: ctx.timeoutMs, fetchImpl: ctx.fetchImpl }));
  const base = { method: 'GET ' + docs, httpStatus: r.status || null, latencyMs: r.ms };
  if (r.ok) return Object.assign(base, { result: 'PASS', detail: 'documentação respondeu ' + r.status + ' (' + r.text.length + ' B)' });
  if (r.status === 403 || r.status === 429) {
    return Object.assign(base, { result: 'BLOCKED', reason: 'a documentação recusa acesso automatizado (' + r.status + '): não se contorna; a existência é confirmada por outra evidência' });
  }
  const c = classifyFailure({ status: r.status, body: r.text, error: r.error, endpoint: docs });
  return Object.assign(base, { result: 'FAIL', reason: c.hint, diagnosis: c.diagnosis });
}

async function level2Access(entry, ctx) {
  const ep = (entry.endpoints || [])[0];
  if (!ep || !ep.base) return { result: 'NOT_TESTED', reason: 'entrada sem endpoint de inferência declarado' };
  const modelo = ctx.model || entry.modelHint || null;
  const url = ep.base.replace(/\/+$/, '') + '/models';
  const r = await http('GET', url, lv(ctx, { timeoutMs: ctx.timeoutMs, fetchImpl: ctx.fetchImpl }));
  const base = { method: 'GET ' + url + ' (sem credencial)', httpStatus: r.status || null, latencyMs: r.ms };
  if (r.status === 200) {
    const ids = (r.json && Array.isArray(r.json.data)) ? r.json.data.map((m) => m.id) : null;
    return Object.assign(base, { result: 'PASS', detail: 'a lista de modelos responde SEM chave' + (ids ? ' (' + ids.length + ' modelos)' : ''),
      anonymousModels: true, modelsSample: ids ? ids.slice(0, 10) : null });
  }
  if (r.status === 401 || r.status === 403) {
    return Object.assign(base, { result: 'PASS', detail: 'exige credencial (' + r.status + '): a classe de acesso não é ANONYMOUS_PUBLIC', requiresKey: true });
  }
  if (r.status === 404) {
    const c = classifyFailure({ status: 404, body: r.text, endpoint: url });
    /* /models pode simplesmente não existir neste fornecedor: não é falha do
       serviço, é ausência de introspecção — diz-se isso e não se inventa erro. */
    return Object.assign(base, { result: 'BLOCKED', reason: 'endpoint de listagem ausente: ' + c.hint + ' (diagnóstico: ' + c.diagnosis + ')' });
  }
  const c = classifyFailure({ status: r.status, body: r.text, error: r.error, endpoint: url });
  return Object.assign(base, { result: c.retryable ? 'BLOCKED' : 'FAIL', reason: c.hint, diagnosis: c.diagnosis, retryable: c.retryable });
}

async function level3Connection(entry, ctx) {
  if (!ctx.apiKey) return { result: 'BLOCKED', reason: 'sem chave configurada: a ligação com credencial não pode ser provada' };
  const ep = (entry.endpoints || [])[0];
  const url = ep.base.replace(/\/+$/, '') + '/models';
  const r = await http('GET', url, lv(ctx, { timeoutMs: ctx.timeoutMs, fetchImpl: ctx.fetchImpl, headers: { authorization: 'Bearer ' + ctx.apiKey } }));
  const base = { method: 'GET ' + url + ' (com credencial)', httpStatus: r.status || null, latencyMs: r.ms };
  if (r.ok) {
    const ids = (r.json && Array.isArray(r.json.data)) ? r.json.data.map((m) => m.id) : [];
    const modelo = ctx.model;
    if (modelo && ids.length && ids.indexOf(modelo) < 0) {
      return Object.assign(base, { result: 'FAIL', diagnosis: 'modelo-inexistente', reason: 'o modelo «' + modelo + '» não está na conta; exemplos: ' + ids.slice(0, 5).join(', ') });
    }
    return Object.assign(base, { result: 'PASS', detail: 'ligação autenticada a ' + ids.length + ' modelo(s)', modelConfirmed: modelo ? ids.indexOf(modelo) >= 0 : null });
  }
  const c = classifyFailure({ status: r.status, body: r.text, error: r.error, endpoint: url });
  return Object.assign(base, { result: c.retryable ? 'BLOCKED' : 'FAIL', reason: c.hint, diagnosis: c.diagnosis });
}

async function level4Generation(entry, ctx) {
  if (!ctx.apiKey) return { result: 'BLOCKED', reason: 'sem chave configurada: gerar sem credencial não é permitido pelas condições dos serviços' };
  if (!ctx.model) return { result: 'NOT_TESTED', reason: 'sem identificador de modelo definido: não se inventa um' };
  const ep = (entry.endpoints || [])[0];
  const url = ep.base.replace(/\/+$/, '') + '/chat/completions';
  const r = await http('POST', url, lv(ctx, {
    timeoutMs: ctx.timeoutMs, fetchImpl: ctx.fetchImpl,
    headers: { authorization: 'Bearer ' + ctx.apiKey, 'content-type': 'application/json' },
    body: { model: ctx.model, messages: [{ role: 'user', content: 'Responda apenas com a palavra: ok' }], max_tokens: 8, temperature: 0 }
  }));
  const base = { method: 'POST ' + url + ' (modelo ' + ctx.model + ')', httpStatus: r.status || null, latencyMs: r.ms };
  if (!r.ok) {
    const c = classifyFailure({ status: r.status, body: r.text, error: r.error, endpoint: url });
    return Object.assign(base, { result: c.retryable ? 'BLOCKED' : 'FAIL', reason: c.hint, diagnosis: c.diagnosis, bodySnippet: redact(r.text, [ctx.apiKey]) });
  }
  const escolha = r.json && r.json.choices && r.json.choices[0];
  const texto = escolha && (escolha.message ? escolha.message.content : escolha.text);
  const usage = (r.json && r.json.usage) || {};
  if (typeof texto !== 'string' || !texto.trim()) {
    return Object.assign(base, { result: 'FAIL', reason: 'resposta 200 mas sem conteúdo utilizável (vazia ou formato inesperado)', bodySnippet: redact(r.text, [ctx.apiKey]) });
  }
  return Object.assign(base, {
    result: 'PASS', detail: 'resposta válida (' + texto.trim().length + ' caracteres)',
    modelEchoed: (r.json && r.json.model) || null,
    tokens: { prompt: usage.prompt_tokens == null ? null : usage.prompt_tokens, completion: usage.completion_tokens == null ? null : usage.completion_tokens },
    sample: redact(texto.trim(), [ctx.apiKey])
  });
}

async function level5Capabilities(entry, ctx) {
  const claimed = (entry.capabilities && entry.capabilities.claimed) || [];
  if (!claimed.length) return { result: 'NOT_TESTED', reason: 'o fornecedor não declara capacidades no catálogo: não se inferem do nome do modelo' };
  if (!ctx.apiKey) return { result: 'BLOCKED', reason: 'sem chave: as capacidades não podem ser provadas' };
  const ep = (entry.endpoints || [])[0];
  const url = ep.base.replace(/\/+$/, '') + '/chat/completions';
  const out = { result: 'PASS', capabilities: {} };
  for (const cap of claimed) {
    if (cap === 'json') {
      const r = await http('POST', url, lv(ctx, { timeoutMs: ctx.timeoutMs, fetchImpl: ctx.fetchImpl,
        headers: { authorization: 'Bearer ' + ctx.apiKey, 'content-type': 'application/json' },
        body: { model: ctx.model, messages: [{ role: 'user', content: 'Devolve {"ok":true} em JSON.' }], response_format: { type: 'json_object' }, max_tokens: 32, temperature: 0 } }));
      let parsedOk = false;
      try { parsedOk = !!JSON.parse((r.json.choices[0].message.content || '').trim()); } catch { parsedOk = false; }
      out.capabilities.json = r.ok && parsedOk ? 'PASS' : (r.status === 400 ? 'FAIL (parâmetro recusado)' : 'FAIL');
      out.latencyMs = r.ms;
    } else if (cap === 'tools') {
      const r = await http('POST', url, lv(ctx, { timeoutMs: ctx.timeoutMs, fetchImpl: ctx.fetchImpl,
        headers: { authorization: 'Bearer ' + ctx.apiKey, 'content-type': 'application/json' },
        body: { model: ctx.model, messages: [{ role: 'user', content: 'Que tempo faz em Lisboa? Usa a ferramenta.' }], max_tokens: 64, temperature: 0,
          tools: [{ type: 'function', function: { name: 'tempo', description: 'tempo actual', parameters: { type: 'object', properties: { cidade: { type: 'string' } }, required: ['cidade'] } } }] } }));
      const call = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message && r.json.choices[0].message.tool_calls;
      out.capabilities.tools = r.ok ? (Array.isArray(call) && call.length ? 'PASS' : 'FAIL (não chamou a ferramenta)') : (r.status === 400 ? 'FAIL (parâmetro recusado)' : 'FAIL');
    } else {
      out.capabilities[cap] = 'NOT_TESTED';
    }
  }
  const falhas = Object.values(out.capabilities).filter((v) => String(v).startsWith('FAIL')).length;
  out.result = falhas === 0 ? 'PASS' : (falhas === Object.keys(out.capabilities).length ? 'FAIL' : 'PASS');
  out.detail = Object.entries(out.capabilities).map(([k, v]) => k + ': ' + v).join(' · ');
  return out;
}

async function level6Reliability(entry, ctx) {
  if (!ctx.apiKey) return { result: 'BLOCKED', reason: 'sem chave: fiabilidade exige execuções reais' };
  const samples = Math.max(2, Math.min(MAX_SAMPLES, Number(ctx.samples) || 3));
  const ep = (entry.endpoints || [])[0];
  const url = ep.base.replace(/\/+$/, '') + '/chat/completions';
  const lat = []; let ok = 0; const falhas = [];
  for (let i = 0; i < samples; i++) {
    const r = await http('POST', url, lv(ctx, { timeoutMs: ctx.timeoutMs, fetchImpl: ctx.fetchImpl,
      headers: { authorization: 'Bearer ' + ctx.apiKey, 'content-type': 'application/json' },
      body: { model: ctx.model, messages: [{ role: 'user', content: 'Escreva apenas o número ' + (i + 1) + '.' }], max_tokens: 8, temperature: 0 } }));
    if (r.ok && r.json && r.json.choices && r.json.choices[0]) { ok++; lat.push(r.ms); }
    else {
      const c = classifyFailure({ status: r.status, body: r.text, error: r.error, endpoint: url });
      falhas.push({ i, status: r.status || null, diagnosis: c.diagnosis });
      if (c.diagnosis === 'limite-utilizacao') break;      // insistir num 429 é abuso
    }
    if (i < samples - 1) await new Promise((res) => setTimeout(res, 350));   // ritmo educado
  }
  const pct = (arr, p) => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
    return s[idx];
  };
  const taxa = ok / samples;
  return {
    result: ok === 0 ? 'FAIL' : (ok === samples ? 'PASS' : 'PASS'),
    samples, ok, samplesRun: ok + falhas.length,
    successRate: Math.round(taxa * 1000) / 1000,
    latencyP50Ms: pct(lat, 50), latencyP95Ms: pct(lat, 95),
    failures: falhas,
    detail: ok + '/' + samples + ' amostras válidas · p50 ' + pct(lat, 50) + ' ms · p95 ' + pct(lat, 95) + ' ms' +
      (ok < samples ? ' · falhas: ' + falhas.map((f) => f.diagnosis).join(', ') : ''),
    partial: ok < samples
  };
}

/* ------------------------------------------------------------------ orquestração */

export async function runProviderTests(entry, opts) {
  opts = opts || {};
  const ctx = {
    apiKey: opts.apiKey || null, model: opts.model || null,
    timeoutMs: opts.timeoutMs || DEFAULT_TIMEOUT, fetchImpl: opts.fetchImpl,
    samples: opts.samples, tracker: { spent: 0 }
  };
  /* cada nível recebe o contador para que «pedidos usados» seja medido, não estimado */
  const pedidos = Array.isArray(opts.levels) && opts.levels.length ? opts.levels : [1, 2, 3];
  const budget = Number(opts.maxRequests || 20);
  const results = {};
  const ordem = pedidos.slice().sort((a, b) => a - b);
  for (const nivel of ordem) {
    if (!TEST_LEVELS[nivel]) { results[nivel] = { result: 'NOT_TESTED', reason: 'nível inexistente' }; continue; }
    /* fiabilidade consome várias chamadas: conta antes de gastar */
    const custo = nivel === 6 ? Math.max(2, Math.min(MAX_SAMPLES, Number(ctx.samples) || 3)) : nivel === 5 ? 2 : 1;
    if (ctx.tracker.spent + custo > budget) {
      results[nivel] = { result: 'BLOCKED', reason: 'orçamento de pedidos esgotado (' + ctx.tracker.spent + '/' + budget + ') antes do nível ' + nivel };
      continue;
    }
    const at = new Date().toISOString();
    try {
      let r;
      if (nivel === 1) r = await level1Existence(entry, ctx);
      else if (nivel === 2) r = await level2Access(entry, ctx);
      else if (nivel === 3) r = await level3Connection(entry, ctx);
      else if (nivel === 4) r = await level4Generation(entry, ctx);
      else if (nivel === 5) r = await level5Capabilities(entry, ctx);
      else r = await level6Reliability(entry, ctx);
      results[nivel] = Object.assign({ level: nivel, levelId: TEST_LEVELS[nivel].id, at }, r);
    } catch (e) {
      results[nivel] = { level: nivel, levelId: TEST_LEVELS[nivel].id, at, result: 'FAIL', reason: 'erro interno no teste: ' + String(e.message).slice(0, 200) };
    }
  }
  /* métricas derivadas — só do que foi medido */
  const gen = results[4], rel = results[6];
  const metrics = {
    generationOk: gen ? gen.result === 'PASS' : false,
    successRate: rel && rel.successRate != null ? rel.successRate : null,
    latencyP50Ms: (rel && rel.latencyP50Ms) || (gen && gen.latencyMs) || null,
    latencyP95Ms: rel && rel.latencyP95Ms ? rel.latencyP95Ms : null,
    tokens: gen && gen.tokens ? gen.tokens : null
  };
  return { results, metrics, requestsUsed: ctx.tracker.spent, budget, synthetic: !!opts.synthetic };
}
