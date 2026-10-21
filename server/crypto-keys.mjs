/* Cifra de chaves de API em repouso: AES-256-GCM com chave derivada de APP_SECRET.
   Sem APP_SECRET definido, a aplicação RECUSA guardar chaves (não há "cifra" falsa). */
import crypto from 'node:crypto';

export function keyVault(secret) {
  if (!secret || String(secret).length < 24) {
    return {
      enabled: false,
      reason: 'APP_SECRET não configurado (mínimo 24 caracteres): as chaves de API não podem ser guardadas com segurança',
      seal() { throw new Error('cofre desactivado'); },
      open() { throw new Error('cofre desactivado'); },
      mask() { return '—'; }
    };
  }
  const key = crypto.createHash('sha256').update(String(secret)).digest();
  const mask = (plain) => {
    const s = String(plain || '');
    if (s.length <= 8) return '••••';
    return s.slice(0, 4) + '…' + s.slice(-4);
  };
  return {
    enabled: true,
    reason: null,
    mask,
    seal(plain) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
      return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: enc.toString('base64') };
    },
    open(sealed) {
      if (!sealed || !sealed.iv) throw new Error('credencial inválida');
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
      d.setAuthTag(Buffer.from(sealed.tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(sealed.data, 'base64')), d.final()]).toString('utf8');
    }
  };
}
