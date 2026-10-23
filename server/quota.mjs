/* =====================================================================
   QUOTA DE IA — saber quando um fornecedor deixou de ter tokens e passar ao
   seguinte sem que o utilizador veja um erro que não é dele

   O que isto resolve, em concreto: o Gemini respondeu «high demand» (503) e o
   Groq respondeu «modelo retirado» (404) com uma chave perfeitamente válida.
   Nos dois casos a aplicação ficou a olhar para um fornecedor que não podia
   servir, quando havia outros dois configurados e a funcionar.

   Vocabulário (um estado por fornecedor, nunca inventado):
     · ok          — respondeu há pouco;
     · limitado    — recusou por ritmo (429). Volta a tentar-se quando ele disse
                     (Retry-After, retryDelay) ou, se não disse, ao fim de um
                     tempo curto e declarado;
     · sem-credito — recusou por falta de saldo/quota do plano (402,
                     insufficient_quota, «credit balance is too low»). Não se
                     insiste: sem saldo não é o tempo que resolve;
     · chave        — a credencial foi recusada (401/403 de credencial). Não se
                     insiste e diz-se que é a chave;
     · indisponivel — o fornecedor está em baixo (5xx/timeout). Tenta-se outra vez
                     dentro de pouco tempo, mas não a cada pedido.

   Regra que não se quebra: o estado é sempre uma OBSERVAÇÃO com data e motivo,
   nunca uma suposição. Sem observação, o fornecedor é «desconhecido» e é tentado.
   ===================================================================== */

export const ESTADOS = {
  ok: { label: 'a responder', tentarDeNovo: false },
  limitado: { label: 'limite de ritmo', tentarDeNovo: true },
  'sem-credito': { label: 'sem crédito/quota', tentarDeNovo: false },
  chave: { label: 'chave recusada', tentarDeNovo: false },
  indisponivel: { label: 'fornecedor indisponível', tentarDeNovo: true },
  desconhecido: { label: 'ainda não observado', tentarDeNovo: true }
};

/* por quanto tempo se evita um fornecedor, quando ele não diz */
const ESPERA_PADRAO_MS = { limitado: 60_000, 'sem-credito': 6 * 3600_000, chave: 3600_000, indisponivel: 2 * 60_000 };
const ESPERA_MAXIMA_MS = { limitado: 15 * 60_000, 'sem-credito': 24 * 3600_000, chave: 24 * 3600_000, indisponivel: 15 * 60_000 };

const PADROES = [
  /* falta de saldo / quota do plano — não adianta esperar */
  { tipo: 'sem-credito', re: /insufficient[_ ]quota|quota exceeded|exceeded your current quota|out of credits|credit balance is too low|billing|payment required|余额不足|no credits/i },
  /* ritmo — esperar resolve */
  { tipo: 'limitado', re: /rate limit|too many requests|resource[_ ]exhausted|requests per (minute|day)|tokens per minute|ritmo|limite de pedidos/i },
  /* credencial */
  { tipo: 'chave', re: /invalid api key|incorrect api key|unauthor|forbidden|permission denied|api[_ ]key[_ ]invalid|credencial/i },
  /* fornecedor em baixo */
  { tipo: 'indisponivel', re: /high demand|unavailable|overloaded|timeout|temporarily|try again later|econnreset|socket hang up/i }
];

/* Lê uma indicação de espera em ms. Aceita segundos, «30s», «2m», ISO e ms. */
export function esperaPedida(valor) {
  if (valor == null) return null;
  if (typeof valor === 'number' && isFinite(valor)) return valor > 1e12 ? valor - Date.now() : valor * 1000;
  const t = String(valor).trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t) * 1000;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/i);
  if (m) {
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    return Math.round(n * (u === 'ms' ? 1 : u === 's' ? 1000 : u === 'm' ? 60000 : 3600000));
  }
  const d = Date.parse(t);
  if (!isNaN(d)) return Math.max(0, d - Date.now());
  return null;
}

/* Pistas de espera: cabeçalhos (quando existirem) e o corpo, que é onde o Google
   escreve «Please retry in 27.5s» e o «retryDelay»: "27s". */
export function pistaDeEspera(resposta) {
  const h = (resposta && resposta.headers) || {};
  const ler = (k) => (h && typeof h.get === 'function' ? h.get(k) : h[k]);
  const cabecalhos = ['retry-after', 'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens', 'x-ratelimit-reset'];
  for (const c of cabecalhos) {
    const ms = esperaPedida(ler(c));
    if (ms != null && ms > 0) return { ms, de: 'cabeçalho ' + c };
  }
  const corpo = String((resposta && (resposta.detalhe || resposta.text)) || '');
  const m = corpo.match(/retry(?:Delay)?["'\s:]+(\d+(?:\.\d+)?)\s*s/i) || corpo.match(/retry in (\d+(?:\.\d+)?)\s*s/i);
  if (m) return { ms: Math.round(Number(m[1]) * 1000), de: 'mensagem do fornecedor' };
  return null;
}

/**
 * Classifica uma resposta falhada.
 * @returns {{tipo:string, esperarMs:number|null, motivo:string, de:string|null}}
 */
export function classificarFalha(resposta) {
  const r = resposta || {};
  const status = Number(r.status || 0);
  const texto = String(r.error || '') + ' ' + String(r.detalhe || '');
  const pista = pistaDeEspera(r);
  let tipo = null;
  let de = pista ? pista.de : null;

  for (const p of PADROES) {
    if (p.re.test(texto)) { tipo = p.tipo; break; }
  }
  if (!tipo) {
    if (status === 402) tipo = 'sem-credito';
    else if (status === 429) tipo = 'limitado';
    else if (status === 401 || status === 403) tipo = 'chave';
    else if (status >= 500) tipo = 'indisponivel';
    else if (status === 0) tipo = 'indisponivel';       // rede/timeout
    else tipo = 'indisponivel';
  }
  /* um 402/429 com mensagem de saldo é saldo, não ritmo */
  if (tipo === 'limitado' && /insufficient[_ ]quota|credit balance|billing/i.test(texto)) tipo = 'sem-credito';
  const esperarMs = tipo === 'limitado'
    ? Math.min(pista ? pista.ms : ESPERA_PADRAO_MS.limitado, ESPERA_MAXIMA_MS.limitado)
    : (tipo === 'indisponivel' ? Math.min(pista ? pista.ms : ESPERA_PADRAO_MS.indisponivel, ESPERA_MAXIMA_MS.indisponivel) : ESPERA_PADRAO_MS[tipo]);
  return { tipo, esperarMs: esperarMs == null ? null : esperarMs, motivo: String(r.error || ('HTTP ' + status)).slice(0, 200), de };
}

/* Limites anunciados pelo fornecedor na resposta boa (quando ele os anuncia) */
export function limitesAnunciados(resposta) {
  const h = (resposta && resposta.headers) || {};
  const ler = (k) => (h && typeof h.get === 'function' ? h.get(k) : h[k]);
  const out = {};
  const mapa = {
    pedidosRestantes: 'x-ratelimit-remaining-requests',
    tokensRestantes: 'x-ratelimit-remaining-tokens',
    pedidosLimite: 'x-ratelimit-limit-requests',
    tokensLimite: 'x-ratelimit-limit-tokens',
    reporPedidos: 'x-ratelimit-reset-requests',
    reporTokens: 'x-ratelimit-reset-tokens'
  };
  for (const [k, cab] of Object.entries(mapa)) {
    const v = ler(cab);
    if (v != null && String(v).trim() !== '') out[k] = String(v).trim();
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Livro de estado dos fornecedores. Em memória do processo (é observação
 * operacional, não dado de utilizador) com um relógio injectável para testes.
 */
export function criarLivroDeQuotas({ agora } = {}) {
  const relogio = agora || (() => Date.now());
  const livro = new Map();

  function ler(id) {
    return livro.get(id) || { id, estado: 'desconhecido', motivo: null, desde: null, ate: null, falhas: 0, sucessos: 0, limites: null };
  }

  function registarSucesso(id, limites) {
    const a = relogio();
    const anterior = ler(id);
    livro.set(id, {
      id, estado: 'ok', motivo: null, desde: a, ate: null,
      falhas: 0, sucessos: (anterior.sucessos || 0) + 1,
      limites: limites || anterior.limites || null,
      ultimoSucesso: new Date(a).toISOString()
    });
    return livro.get(id);
  }

  function registarFalha(id, classificacao) {
    const a = relogio();
    const c = classificacao || { tipo: 'indisponivel', esperarMs: ESPERA_PADRAO_MS.indisponivel, motivo: 'falha sem classificação' };
    const anterior = ler(id);
    livro.set(id, {
      id, estado: c.tipo, motivo: c.motivo || null, desde: a,
      ate: c.esperarMs == null ? null : a + c.esperarMs,
      falhas: (anterior.falhas || 0) + 1, sucessos: anterior.sucessos || 0,
      limites: anterior.limites || null,
      ondeEsperar: c.de || null,
      ultimaFalha: new Date(a).toISOString()
    });
    return livro.get(id);
  }

  /* Um fornecedor está disponível se nunca foi observado, se está ok, ou se já
     passou o tempo de espera. Passado o tempo, é tentado outra vez — a única
     forma de saber se voltou é perguntar-lhe. */
  function disponivel(id) {
    const e = ler(id);
    if (e.estado === 'desconhecido' || e.estado === 'ok') return true;
    if (e.ate == null) return true;
    return relogio() >= e.ate;
  }

  function relatorio() {
    const a = relogio();
    return [...livro.values()]
      .map((e) => ({
        id: e.id, estado: e.estado, label: (ESTADOS[e.estado] || ESTADOS.desconhecido).label,
        motivo: e.motivo, falhas: e.falhas, sucessos: e.sucessos,
        desde: e.desde ? new Date(e.desde).toISOString() : null,
        disponivelEm: e.ate ? new Date(e.ate).toISOString() : null,
        disponivelAgora: disponivel(e.id),
        esperaRestanteMs: e.ate && e.ate > a ? e.ate - a : 0,
        ondeEsperar: e.ondeEsperar || null,
        limites: e.limites || null,
        ultimoSucesso: e.ultimoSucesso || null,
        ultimaFalha: e.ultimaFalha || null
      }))
      .sort((x, y) => (x.disponivelAgora === y.disponivelAgora ? x.id.localeCompare(y.id) : (x.disponivelAgora ? -1 : 1)));
  }

  function esquecer(id) { livro.delete(id); }
  return { registarSucesso, registarFalha, disponivel, relatorio, ler, esquecer, tamanho: () => livro.size };
}
