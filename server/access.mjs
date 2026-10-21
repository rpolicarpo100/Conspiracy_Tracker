/* =====================================================================
   VERIFICAÇÃO DE ACESSO A UMA FONTE (sem contornar barreiras)

   O que este módulo NÃO faz, por decisão:
   · não contorna paywalls, muros de registo, CAPTCHAs nem bloqueios;
   · não faz recolha automática: verifica UMA página, a pedido do utilizador,
     e não guarda o conteúdo no registo (só metadados: estado, HTTP, tipo);
   · não aceita esquemas além de http/https nem destinos internos (SSRF).

   O resultado é sempre um facto observado agora, com data: «acessível»,
   «inacessível» ou «bloqueado por segurança», nunca uma suposição.
   ===================================================================== */
import dns from 'node:dns/promises';
import net from 'node:net';

export const ACCESS_METHOD = 'GET (sem cookies, sem credenciais, sem execução de scripts)';
export const MAX_REDIRECTS = 3;
export const DEFAULT_TIMEOUT_MS = 12000;
export const DEFAULT_MAX_BYTES = 65536;

/* Intervalos que nunca são alvo legítimo de uma verificação de fonte:
   loopback, redes privadas, link-local (inclui metadados de cloud 169.254.169.254),
   CGNAT, multicast, reservados e IPv6 equivalentes. */
const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]
];

const v4ToInt = (ip) => ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;

export function isBlockedAddress(ip) {
  const a = String(ip || '').trim().toLowerCase();
  if (!a) return { blocked: true, reason: 'endereço vazio' };
  const fam = net.isIP(a);
  if (fam === 4) {
    const n = v4ToInt(a);
    for (const [base, bits] of BLOCKED_V4) {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      if ((n & mask) === (v4ToInt(base) & mask)) return { blocked: true, reason: 'endereço IPv4 interno/reservado: ' + a };
    }
    return { blocked: false };
  }
  if (fam === 6) {
    const s = a.replace(/^\[|\]$/g, '');
    if (s === '::' || s === '::1') return { blocked: true, reason: 'endereço IPv6 de loopback/indefinido' };
    if (s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return { blocked: true, reason: 'IPv6 link-local' };
    if (s.startsWith('fc') || s.startsWith('fd')) return { blocked: true, reason: 'IPv6 único local (privado)' };
    if (s.startsWith('ff')) return { blocked: true, reason: 'IPv6 multicast' };
    /* IPv4 mapeado em IPv6 (::ffff:127.0.0.1) */
    const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isBlockedAddress(m[1]);
    return { blocked: false };
  }
  return { blocked: true, reason: 'endereço não reconhecido como IP' };
}

export const ACCESS_STATE_LABEL = {
  acessivel: 'acessível',
  inacessivel: 'inacessível',
  bloqueado: 'bloqueado por segurança',
  'nao-verificado': 'não verificado'
};

/* Validação do alvo antes de qualquer pedido de rede. */
export async function validateTarget(rawUrl, { lookup } = {}) {
  let u;
  try { u = new URL(String(rawUrl || '').trim()); } catch { return { ok: false, status: 'bloqueado', reason: 'URL inválido' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, status: 'bloqueado', reason: 'esquema não permitido: ' + u.protocol + ' (só http/https)' };
  }
  if (u.username || u.password) return { ok: false, status: 'bloqueado', reason: 'URL com credenciais incorporadas é recusado' };
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    const b = isBlockedAddress(host);
    return b.blocked ? { ok: false, status: 'bloqueado', reason: b.reason } : { ok: true, url: u, ips: [host] };
  }
  let addrs = [];
  try {
    addrs = await (lookup || dns.lookup)(host, { all: true, verbatim: true });
  } catch (e) {
    return { ok: false, status: 'inacessivel', reason: 'nome não resolve: ' + (e.code || e.message) };
  }
  if (!Array.isArray(addrs) || !addrs.length) return { ok: false, status: 'inacessivel', reason: 'nome não resolve' };
  const ips = addrs.map((a) => (typeof a === 'string' ? a : a.address));
  for (const ip of ips) {
    const b = isBlockedAddress(ip);
    if (b.blocked) return { ok: false, status: 'bloqueado', reason: b.reason + ' (resolução de ' + host + ')' };
  }
  return { ok: true, url: u, ips };
}

/* Lê no máximo maxBytes do corpo e corta a ligação: uma fonte não pode
   transformar uma verificação de estado numa transferência de 200 MB. */
async function readLimited(res, maxBytes) {
  if (!res.body) return { bytes: 0, truncated: false, skipped: false };
  /* se o servidor declara um ficheiro enorme, nem se começa a ler */
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes * 50) {
    try { await res.body.cancel(); } catch { /* já fechado */ }
    return { bytes: 0, truncated: true, skipped: true };
  }
  const reader = res.body.getReader();
  let bytes = 0, truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value ? value.byteLength : 0;
      /* o limite é aplicado por blocos: lê-se até ao limite e corta-se a ligação.
         bytes = o que foi realmente recebido (nunca se reporta menos do que veio) */
      if (bytes >= maxBytes) { truncated = true; break; }
    }
  } finally { try { await reader.cancel(); } catch { /* já fechado */ } }
  return { bytes, truncated, skipped: false };
}

export async function checkAccess(rawUrl, opts = {}) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const timeoutMs = Math.min(Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS, 30000);
  const maxBytes = Math.min(Number(opts.maxBytes) || DEFAULT_MAX_BYTES, 262144);
  const fetchImpl = opts.fetchImpl || fetch;
  const lookup = opts.lookup || dns.lookup;

  const base = {
    method: ACCESS_METHOD, startedAt, redirects: [],
    limitations: ['verifica uma só página, a pedido do utilizador: não é recolha automática',
      'não contorna paywalls, muros de registo, CAPTCHAs nem limitações de acesso',
      'o conteúdo lido não é guardado: apenas o estado observado e metadados']
  };

  const done = (status, extra) => Object.assign({}, base, {
    status, stateLabel: ACCESS_STATE_LABEL[status] || status,
    ms: Date.now() - t0, checkedAt: new Date().toISOString(),
    finalUrl: null, httpStatus: null, contentType: null, bytes: null, truncated: false, reason: null
  }, extra);

  let target = rawUrl;
  let hops = 0;
  for (;;) {
    const v = await validateTarget(target, { lookup });
    if (!v.ok) return done(v.status, { reason: v.reason, finalUrl: String(target).slice(0, 500) });

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(v.url.toString(), {
        method: 'GET', redirect: 'manual', signal: ac.signal,
        headers: {
          'user-agent': 'ConspiracyTracker/verificacao-de-fonte (+verificação manual de acessibilidade)',
          accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.8,*/*;q=0.5',
          'accept-language': 'pt-PT,pt;q=0.9,en;q=0.7'
        }
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = e && (e.name === 'AbortError' || e.message === 'aborted' || ac.signal.aborted);
      return done('inacessivel', {
        reason: aborted ? 'tempo esgotado após ' + timeoutMs + ' ms' : 'falha de rede: ' + ((e && (e.code || e.name)) || 'erro'),
        finalUrl: v.url.toString()
      });
    }

    const code = res.status;
    /* redireccionamentos seguidos à mão para revalidar cada salto (SSRF) */
    if (code >= 300 && code < 400) {
      const loc = res.headers.get('location');
      clearTimeout(timer);
      try { await res.body?.cancel(); } catch { /* sem corpo */ }
      if (!loc) return done('inacessivel', { httpStatus: code, reason: 'redireccionamento sem destino', finalUrl: v.url.toString() });
      if (hops >= MAX_REDIRECTS) {
        return done('inacessivel', { httpStatus: code, reason: 'excedeu ' + MAX_REDIRECTS + ' redireccionamentos', finalUrl: v.url.toString() });
      }
      const next = new URL(loc, v.url).toString();
      base.redirects.push({ from: v.url.toString(), to: next, status: code });
      hops++; target = next;
      continue;
    }

    const contentType = res.headers.get('content-type') || null;
    let read = { bytes: 0, truncated: false, skipped: false };
    try { read = await readLimited(res, maxBytes); } catch { /* corpo ilegível não invalida o estado HTTP */ }
    clearTimeout(timer);

    const meta = {
      httpStatus: code, contentType, bytes: read.bytes, truncated: read.truncated, downloadSkipped: read.skipped,
      finalUrl: v.url.toString()
    };

    if (code === 401 || code === 402 || code === 403 || code === 407) {
      return done('inacessivel', Object.assign(meta, {
        reason: 'acesso restrito (HTTP ' + code + '): registada como inacessível; não contornamos barreiras de acesso'
      }));
    }
    if (code === 404 || code === 410) {
      return done('inacessivel', Object.assign(meta, { reason: 'documento desaparecido (HTTP ' + code + ')' }));
    }
    if (code === 429) {
      return done('inacessivel', Object.assign(meta, { reason: 'servidor de origem limitou os pedidos (HTTP 429)' }));
    }
    if (code >= 500) {
      return done('inacessivel', Object.assign(meta, { reason: 'erro do servidor de origem (HTTP ' + code + ')' }));
    }
    if (code >= 200 && code < 300) {
      return done('acessivel', meta);
    }
    return done('inacessivel', Object.assign(meta, { reason: 'resposta HTTP ' + code + ' não é conteúdo servido' }));
  }
}

/* Estado observado → sugestão de estado de validação da prova.
   A sugestão NUNCA é aplicada automaticamente: quem decide é uma pessoa. */
export function accessSuggestion(access) {
  if (!access) return { suggestion: null, requiresHuman: false, note: 'sem verificação registada' };
  if (access.status === 'inacessivel') {
    return {
      suggestion: 'fonte-inacessivel', requiresHuman: true,
      note: 'a fonte não respondeu ou exige acesso: o estado «fonte inacessível» deve ser confirmado por uma pessoa; os dados não mudam sozinhos'
    };
  }
  if (access.status === 'acessivel') {
    return { suggestion: null, requiresHuman: false, note: 'a fonte respondeu agora; isso não valida o conteúdo nem o excerto' };
  }
  return { suggestion: null, requiresHuman: true, note: 'verificação bloqueada por segurança: o endereço não é um alvo válido' };
}
