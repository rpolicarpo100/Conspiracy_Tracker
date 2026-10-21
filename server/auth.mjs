/* =====================================================================
   AUTENTICAÇÃO E SESSÕES
   · palavras-passe: scrypt (N=2^15) com sal por utilizador
   · sessões: token aleatório de 32 bytes, guardado apenas como SHA-256
   · cookie HttpOnly + SameSite=Lax (+ Secure em https)
   · CSRF: double-submit (cookie legível + cabeçalho x-csrf-token)
   · limitação de tentativas por IP e por conta; respostas constantes
     para não permitir enumeração de contas
   ===================================================================== */
import crypto from 'node:crypto';

const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };
const SESSION_TTL = 12 * 3600 * 1000;
const MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 8);   // por chave, na janela
const WINDOW = 15 * 60 * 1000;
const REGISTER_MAX = Number(process.env.REGISTER_MAX || 10);        // por IP e por hora

export function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }).toString('hex');
  return { salt: s, hash };
}

export function verifyPassword(password, salt, expectedHex) {
  try {
    const got = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
    const exp = Buffer.from(expectedHex, 'hex');
    return got.length === exp.length && crypto.timingSafeEqual(got, exp);
  } catch { return false; }
}

export function passwordProblems(pw) {
  const e = [];
  if (typeof pw !== 'string' || pw.length < 10) e.push('pelo menos 10 caracteres');
  if (!/[a-z]/.test(pw || '')) e.push('uma minúscula');
  if (!/[A-Z]/.test(pw || '')) e.push('uma maiúscula');
  if (!/[0-9]/.test(pw || '')) e.push('um dígito');
  if (/^(password|123456|qwerty|admin)/i.test(pw || '')) e.push('não pode ser uma palavra-passe comum');
  return e;
}

export const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
export const newToken = (bytes) => crypto.randomBytes(bytes || 32).toString('base64url');

export function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

export function setCookie(name, value, opts) {
  opts = opts || {};
  const bits = [name + '=' + encodeURIComponent(value), 'Path=/', 'SameSite=' + (opts.sameSite || 'Lax')];
  if (opts.httpOnly) bits.push('HttpOnly');
  if (opts.secure) bits.push('Secure');
  if (opts.maxAge != null) bits.push('Max-Age=' + Math.floor(opts.maxAge / 1000));
  return bits.join('; ');
}

/* ---- limitador de tentativas em memória (janela deslizante) ---- */
function makeLimiter(max, windowMs) {
  const hits = new Map();
  return {
    hit(key) {
      const now = Date.now();
      const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
      arr.push(now); hits.set(key, arr);
      if (hits.size > 20000) hits.clear();
      return arr.length;
    },
    blocked(key) {
      const now = Date.now();
      const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
      return arr.length >= max;
    },
    reset(key) { hits.delete(key); },
    get max() { return max; }
  };
}

export function createAuth(store, opts) {
  opts = opts || {};
  const secure = opts.secure !== false;
  const loginLimiter = makeLimiter(MAX_ATTEMPTS, WINDOW);
  const registerLimiter = makeLimiter(REGISTER_MAX, 60 * 60 * 1000);
  const adminEmail = String(opts.adminEmail || '').toLowerCase();

  function issueSession(user, ctx) {
    const token = newToken(32);
    const csrf = newToken(24);
    return store.createSession({
      userId: user.id, tokenHash: sha256(token), ip: ctx.ip, ua: ctx.ua, ttlMs: SESSION_TTL
    }).then((s) => ({ token, csrf, session: s }));
  }

  function cookiesFor(token, csrf) {
    return [
      setCookie('vn_sid', token, { httpOnly: true, secure, maxAge: SESSION_TTL }),
      setCookie('vn_csrf', csrf, { httpOnly: false, secure, maxAge: SESSION_TTL })
    ];
  }

  async function currentUser(req) {
    const cookies = parseCookies(req.headers.cookie);
    if (!cookies.vn_sid) return null;
    const s = store.sessionByHash(sha256(cookies.vn_sid));
    if (!s || s.revokedAt) return null;
    if (new Date(s.expiresAt).getTime() < Date.now()) return null;
    const u = store.userById(s.userId);
    if (!u || u.status !== 'active') return null;
    store.touchSession(s.id);
    return { user: u, session: s, csrf: cookies.vn_csrf || null };
  }

  function csrfOk(req, auth) {
    if (!auth) return false;
    const header = req.headers['x-csrf-token'];
    return !!(header && auth.csrf && header === auth.csrf);
  }

  return {
    loginLimiter, registerLimiter, issueSession, cookiesFor, currentUser, csrfOk,
    adminEmail, SESSION_TTL, MAX_ATTEMPTS
  };
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, role: u.role, status: u.status,
    emailVerified: u.emailVerified, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
    termsAcceptedAt: u.termsAcceptedAt, mfa: !!u.mfa
  };
}
