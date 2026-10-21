/* =====================================================================
   VERIFICAÇÃO EM DOIS PASSOS (TOTP, RFC 6238) — sem dependências.

   Porque sem dependência: a superfície é pequena e verificável (HMAC-SHA1,
   Base32, contador de 30 s). Uma biblioteca a mais é uma atualização a mais
   e uma cadeia de fornecimento a mais — e aqui não ganha nada.

   Regras:
   · segredo de 160 bits, guardado no utilizador, nunca devolvido depois de
     activado (só o URI de activação, uma vez);
   · janela de ±1 passo (30 s) — tolera relógios desalinhados sem alargar o
     intervalo útil;
   · códigos de recuperação de uso único, guardados só como HMAC-SHA256 com
     sal do servidor (nunca em claro, nunca reutilizáveis);
   · limite de tentativas por conta; cada tentativa falhada é auditada;
   · activar/desactivar exige a palavra-passe actual — um cookie roubado não
     basta para trocar o segundo factor.
   ===================================================================== */
import crypto from 'node:crypto';

export const MFA = {
  digits: 6, period: 30, window: 1,
  secretBytes: 20,
  recoveryCodes: 10,
  recoveryCodeBytes: 5,
  maxAttempts: 8, attemptWindowMs: 10 * 60 * 1000,
  issuer: 'Meridiano'
};

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/* código TOTP para um contador concreto (exportado para os testes poderem
   gerar o código «certo» sem depender de relógio real) */
export function totpAt(secretB32, counter) {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(code % 10 ** MFA.digits).padStart(MFA.digits, '0');
}

export function counterNow(nowMs) { return Math.floor((nowMs || Date.now()) / 1000 / MFA.period); }

export function newSecret() { return base32Encode(crypto.randomBytes(MFA.secretBytes)); }

export function otpauthUri(secretB32, email) {
  const label = encodeURIComponent(MFA.issuer + ':' + String(email || 'conta'));
  const params = new URLSearchParams({
    secret: secretB32, issuer: MFA.issuer, algorithm: 'SHA1', digits: String(MFA.digits), period: String(MFA.period)
  });
  return 'otpauth://totp/' + label + '?' + params.toString();
}

/* confirma um código à janela actual; devolve o passo aceite (para impedir
   reutilização do mesmo código) ou null */
export function verifyTotp(secretB32, code, opts) {
  const o = Object.assign({}, MFA, opts || {});
  const clean = String(code || '').replace(/\D/g, '');
  if (clean.length !== o.digits) return null;
  const base = counterNow();
  for (let d = -o.window; d <= o.window; d++) {
    const counter = base + d;
    if (counter < 0) continue;
    const expected = totpAt(secretB32, counter);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return counter;
  }
  return null;
}

/* códigos de recuperação: devolvem-se uma vez, guarda-se só o HMAC */
export function newRecoveryCodes(pepper, howMany) {
  const n = howMany || MFA.recoveryCodes;
  const codes = [];
  for (let i = 0; i < n; i++) {
    const raw = crypto.randomBytes(MFA.recoveryCodeBytes).toString('hex').toUpperCase();   // 10 hex chars
    codes.push(raw.slice(0, 5) + '-' + raw.slice(5));
  }
  return codes.map((code) => ({ code, hash: recoveryHash(code, pepper) }));
}

export function recoveryHash(code, pepper) {
  const norm = String(code || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  return crypto.createHmac('sha256', String(pepper || 'sem-pepper')).update('recuperacao:' + norm).digest('hex');
}

/* consome um código de recuperação: devolve a lista restante, ou null */
export function consumeRecoveryCode(codes, code, pepper) {
  if (!Array.isArray(codes) || !codes.length) return null;
  const h = recoveryHash(code, pepper);
  const idx = codes.findIndex((c) => c.hash && crypto.timingSafeEqual(Buffer.from(c.hash), Buffer.from(h)));
  if (idx < 0) return null;
  return { remaining: codes.filter((_, i) => i !== idx), usedHash: codes[idx].hash };
}

/* limitador de tentativas MFA por conta (em memória, como o do login) */
export function makeAttemptLimiter() {
  const hits = new Map();
  return {
    blocked(userId) {
      const now = Date.now();
      const arr = (hits.get(userId) || []).filter((t) => now - t < MFA.attemptWindowMs);
      hits.set(userId, arr);
      return arr.length >= MFA.maxAttempts;
    },
    hit(userId) {
      const arr = (hits.get(userId) || []).filter((t) => Date.now() - t < MFA.attemptWindowMs);
      arr.push(Date.now()); hits.set(userId, arr);
      if (hits.size > 20000) hits.clear();
      return arr.length;
    },
    reset(userId) { hits.delete(userId); },
    remaining(userId) {
      const arr = (hits.get(userId) || []).filter((t) => Date.now() - t < MFA.attemptWindowMs);
      return Math.max(0, MFA.maxAttempts - arr.length);
    }
  };
}

export function maskSecret(secretB32) {
  const s = String(secretB32 || '');
  return s.length <= 6 ? '•'.repeat(s.length) : s.slice(0, 2) + '•'.repeat(Math.max(4, s.length - 4)) + s.slice(-2);
}
