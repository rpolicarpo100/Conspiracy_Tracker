/* =====================================================================
   SEGURANÇA E DURABILIDADE — segundo factor e resistência da base.

   Duas famílias de teste, ambas sobre código real:

   A. TOTP (server/mfa.mjs)
      · os quatro vectores de teste do RFC 6238 (SHA-1, 6 dígitos);
      · janela ±1, rejeição de código repetido, códigos de recuperação de uso
        único guardados só como HMAC;
      · fluxo HTTP completo: a sessão NÃO nasce antes do código; desafio de uso
        único; limite de tentativas; troca de palavra-passe exige o código;
        desactivar exige palavra-passe E código.

   B. Base de dados em ficheiro (server/store.mjs)
      · escrita atómica com fsync e sha256 verificável;
      · ficheiro truncado → recuperação da cópia válida mais recente (dita);
      · sem cópia válida → recomeça vazia e DECLARA-O (nunca em silêncio);
      · segunda instância no mesmo diretório → só-de-leitura e /ready 503.
   ===================================================================== */
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createApi } from '../server/api.mjs';
import { createStore } from '../server/store.mjs';
import { base32Encode, base32Decode, totpAt, counterNow, verifyTotp, newSecret, otpauthUri, newRecoveryCodes, consumeRecoveryCode, recoveryHash, maskSecret, MFA } from '../server/mfa.mjs';

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { const d = await fn(); pass++; console.log('PASS ' + name + (d ? ' → ' + d : '')); }
  catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const tmp = (p) => '/tmp/vn-seg-' + crypto.randomBytes(4).toString('hex') + (p ? '-' + p : '');

/* processo vivo de verdade para simular «outra instância»: o ppid do sandbox
   pode já não existir, e um pid morto não é bloqueio nenhum */
const outroProcesso = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 120000)'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 300));
const PID_VIVO = outroProcesso.pid;

/* ======================= A. TOTP ======================= */

await t('RFC 6238: os quatro vectores de teste batem certo', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
  const vectores = [[59, '287082'], [1111111109, '081804'], [1234567890, '005924'], [2000000000, '279037']];
  const got = vectores.map(([t2]) => totpAt(secret, Math.floor(t2 / 30)));
  vectores.forEach(([t2, esperado], i) => ok(got[i] === esperado, 't=' + t2 + ' esperado ' + esperado + ', obtido ' + got[i]));
  return got.join(' ');
});

await t('Base32: ida e volta e tolerância a espaços/minúsculas', () => {
  const bytes = crypto.randomBytes(20);
  const enc = base32Encode(bytes);
  ok(base32Decode(enc).equals(bytes), 'ida e volta falhou');
  ok(base32Decode(enc.toLowerCase().replace(/(.{4})/g, '$1 ')).equals(bytes), 'não tolerou espaços/minúsculas');
  ok(base32Decode('').length === 0, 'string vazia devia dar 0 bytes');
  return enc.slice(0, 8) + '… (' + enc.length + ' caracteres)';
});

await t('verifyTotp: aceita ±1 passo e recusa fora da janela', () => {
  const secret = newSecret();
  const now = counterNow();
  for (const d of [-1, 0, 1]) ok(verifyTotp(secret, totpAt(secret, now + d)) === now + d, 'passo ' + d + ' devia ser aceite');
  ok(verifyTotp(secret, totpAt(secret, now + 3)) === null, 'passo +3 devia ser recusado');
  ok(verifyTotp(secret, totpAt(secret, now - 3)) === null, 'passo -3 devia ser recusado');
  const good = totpAt(secret, now);
  const alterado = String((Number(good) + 1) % 1e6).padStart(6, '0');
  ok(verifyTotp(secret, alterado) === null, 'código alterado devia ser recusado');
  ok(verifyTotp(secret, 'abc') === null && verifyTotp(secret, '') === null, 'entradas inválidas deviam ser recusadas');
  return 'janela de 3 passos, resto recusado';
});

await t('segredo: 160 bits, distinto a cada chamada, URI de activação correcto', () => {
  const a = newSecret(), b = newSecret();
  ok(a !== b, 'dois segredos iguais');
  ok(base32Decode(a).length === MFA.secretBytes, 'tamanho ' + base32Decode(a).length);
  const uri = otpauthUri(a, 'pessoa@exemplo.pt');
  ok(/^otpauth:\/\/totp\//.test(uri), 'URI ' + uri.slice(0, 20));
  ok(uri.includes('secret=' + a), 'o URI não leva o segredo');
  ok(uri.includes('issuer=Meridiano') && uri.includes('digits=6') && uri.includes('period=30'), 'parâmetros: ' + uri);
  ok(maskSecret(a).length === a.length && maskSecret(a).endsWith(a.slice(-2)), 'máscara: ' + maskSecret(a));
  ok(!maskSecret(a).includes(a.slice(2, 10)), 'a máscara revela o meio do segredo');
  return uri.slice(0, 48) + '…';
});

await t('códigos de recuperação: 10, únicos, guardados só como HMAC', () => {
  const pepper = crypto.randomBytes(16).toString('hex');
  const codes = newRecoveryCodes(pepper);
  ok(codes.length === MFA.recoveryCodes, 'quantidade ' + codes.length);
  ok(new Set(codes.map((c) => c.code)).size === codes.length, 'códigos repetidos');
  codes.forEach((c) => ok(!c.hash.includes(c.code.replace('-', '')), 'o hash contém o código'));
  ok(codes[0].hash === recoveryHash(codes[0].code, pepper), 'hash não reproduzível');
  ok(recoveryHash(codes[0].code, 'outro-pepper') !== codes[0].hash, 'o pepper não entra no hash');
  const consumo = consumeRecoveryCode(codes, codes[3].code, pepper);
  ok(consumo && consumo.remaining.length === codes.length - 1, 'não consumiu');
  ok(!consumeRecoveryCode(consumo.remaining, codes[3].code, pepper), 'o mesmo código serviu duas vezes');
  ok(consumeRecoveryCode(codes, 'AAAAA-BBBBB', pepper) === null, 'aceitou um código inventado');
  return codes.length + ' códigos, uso único';
});

/* ======================= B. fluxo HTTP ======================= */

const DIR = tmp('api');
const api = await createApi({ dataDir: DIR, appSecret: 'segredo-de-teste-seguranca-123456', adminEmail: 'admin@ex.pt', secure: false });
const srv = http.createServer((q, r) => api.handle(q, r, new URL(q.url, 'http://x')));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + srv.address().port;

function session() {
  let cookie = '', csrf = '';
  async function call(m, p, b, opts) {
    const h = { 'content-type': 'application/json' };
    if (cookie) h.cookie = cookie;
    if (csrf && !(opts && opts.noCsrf)) h['x-csrf-token'] = csrf;
    const res = await fetch(BASE + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
    (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
      const [pair] = c.split(';'); const [k, v] = pair.split('=');
      if (k === 'vn_sid') cookie = 'vn_sid=' + v;
      if (k === 'vn_csrf') { csrf = v; cookie += '; vn_csrf=' + v; }
    });
    const txt = await res.text();
    let json = null; try { json = JSON.parse(txt); } catch { /* não JSON */ }
    return { status: res.status, json, text: txt, setCookie: res.headers.getSetCookie ? res.headers.getSetCookie() : [] };
  }
  return { call, get cookie() { return cookie; } };
}

const PASSWORD = 'SenhaForte-2026!';
/* administrador primeiro: a auditoria só é legível por ADMIN (e o admin não usa MFA aqui) */
const adminSes = session();
await adminSes.call('POST', '/api/auth/register', { email: 'admin@ex.pt', password: PASSWORD, acceptTerms: true });
const ses = session();
let secret = null, recovery = null;
const email = 'mfa' + Date.now().toString(36) + '@ex.pt';

await t('conta criada e sem segundo factor por omissão', async () => {
  const r = await ses.call('POST', '/api/auth/register', { email, password: PASSWORD, acceptTerms: true });
  ok(r.status === 201, 'registo: ' + r.status);
  const st = await ses.call('GET', '/api/auth/mfa');
  ok(st.json.enabled === false && st.json.pending === false, 'estado inicial: ' + JSON.stringify(st.json).slice(0, 120));
  return 'enabled=false';
});

await t('activar exige a palavra-passe actual (401 sem ela)', async () => {
  const a = await ses.call('POST', '/api/auth/mfa/setup', { password: 'palavra-errada' });
  const b = await ses.call('POST', '/api/auth/mfa/setup', {});
  ok(a.status === 401, 'com palavra-passe errada: ' + a.status);
  ok(b.status === 401, 'sem palavra-passe: ' + b.status);
  const c = await ses.call('POST', '/api/auth/mfa/setup', { password: PASSWORD }, { noCsrf: true });
  ok(c.status === 403, 'sem CSRF: ' + c.status);
  return '401 / 401 / 403';
});

await t('setup devolve segredo e URI; nada é activado antes do código', async () => {
  const r = await ses.call('POST', '/api/auth/mfa/setup', { password: PASSWORD });
  ok(r.status === 201, 'setup: ' + r.status + ' ' + r.text.slice(0, 120));
  ok(base32Decode(r.json.secret).length === 20, 'segredo inválido');
  ok(/^otpauth:\/\/totp\//.test(r.json.otpauth), 'sem URI');
  const st = await ses.call('GET', '/api/auth/mfa');
  ok(st.json.enabled === false && st.json.pending === true, 'não devia estar activo: ' + JSON.stringify(st.json).slice(0, 120));
  ok(!JSON.stringify(st.json).includes(r.json.secret), 'o segredo voltou a ser servido pela API de estado');
  secret = r.json.secret;
  return 'pendente, segredo mostrado uma vez';
});

await t('activar com código errado é recusado e conta para o limite', async () => {
  const r = await ses.call('POST', '/api/auth/mfa/enable', { code: '000000' });
  ok(r.status === 400, 'estado ' + r.status);
  ok(typeof r.json.error.remaining === 'number', 'sem contagem de tentativas');
  const st = await ses.call('GET', '/api/auth/mfa');
  ok(st.json.enabled === false, 'activou com código errado');
  return '400, restam ' + r.json.error.remaining;
});

await t('activar com código válido devolve 10 códigos de recuperação (uma vez)', async () => {
  const r = await ses.call('POST', '/api/auth/mfa/enable', { code: totpAt(secret, counterNow()) });
  ok(r.status === 200, 'enable: ' + r.status + ' ' + r.text.slice(0, 120));
  ok(Array.isArray(r.json.recoveryCodes) && r.json.recoveryCodes.length === 10, 'códigos: ' + (r.json.recoveryCodes || []).length);
  ok(/uma única vez/.test(r.json.nota), 'falta o aviso de que se mostram uma vez');
  const st = await ses.call('GET', '/api/auth/mfa');
  ok(st.json.enabled === true && st.json.recoveryCodesLeft === 10, 'estado: ' + JSON.stringify(st.json).slice(0, 120));
  ok(!st.text.includes(r.json.recoveryCodes[0]), 'os códigos continuam a ser servidos pelo GET');
  recovery = r.json.recoveryCodes;
  return '10 códigos, máscara ' + st.json.secretMasked;
});

await t('login com segundo factor: NÃO emite sessão antes do código', async () => {
  const novo = session();
  const r = await novo.call('POST', '/api/auth/login', { email, password: PASSWORD });
  ok(r.status === 200 && r.json.mfaRequired === true, 'login: ' + r.status + ' ' + r.text.slice(0, 120));
  ok(r.json.user === undefined, 'o login devolveu o utilizador antes do segundo factor');
  ok(r.setCookie.length === 0 || !r.setCookie.some((c) => c.startsWith('vn_sid=')), 'foi emitido cookie de sessão');
  ok(typeof r.json.challenge === 'string' && r.json.challenge.length >= 32, 'sem desafio');
  ok(/só é criada depois/.test(r.json.nota), 'falta a nota explicativa');
  /* o desafio não serve para pedidos autenticados */
  const sonda = await novo.call('GET', '/api/auth/me');
  ok(sonda.json.user === null, 'o desafio autenticou pedidos');
  novo.__challenge = r.json.challenge;
  session.__pendente = novo;
  return 'desafio emitido, nenhuma sessão criada';
});

await t('código errado: 401 com tentativas restantes e auditoria', async () => {
  const novo = session.__pendente;
  const r = await novo.call('POST', '/api/auth/mfa/verify', { challenge: novo.__challenge, code: '123456' });
  ok(r.status === 401, 'estado ' + r.status);
  ok(/incorrecto/.test(r.json.error.message), r.json.error.message);
  const aud = await adminSes.call('GET', '/api/admin/audit?limit=50');
  const tipos = (aud.json.events || []).map((e) => e.type);
  ok(tipos.includes('mfa_failed'), 'sem evento mfa_failed na auditoria');
  return 'restam ' + r.json.error.remaining;
});

await t('código válido: sessão criada e desafio consumido', async () => {
  const novo = session.__pendente;
  const r = await novo.call('POST', '/api/auth/mfa/verify', { challenge: novo.__challenge, code: totpAt(secret, counterNow()) });
  ok(r.status === 200, 'estado ' + r.status + ' ' + r.text.slice(0, 120));
  ok(r.json.user && r.json.user.email === email, 'sem utilizador');
  ok(r.json.via === 'totp', 'via ' + r.json.via);
  ok(r.setCookie.some((c) => c.startsWith('vn_sid=')), 'sem cookie de sessão');
  const me = await novo.call('GET', '/api/auth/me');
  ok(me.json.user && me.json.user.email === email, 'a sessão não autentica');
  const outra = await novo.call('POST', '/api/auth/mfa/verify', { challenge: novo.__challenge, code: totpAt(secret, counterNow()) });
  ok(outra.status === 401, 'o desafio serviu duas vezes: ' + outra.status);
  return 'via totp · desafio de uso único';
});

await t('o mesmo código TOTP não pode ser reutilizado noutro login', async () => {
  const novo = session();
  const l = await novo.call('POST', '/api/auth/login', { email, password: PASSWORD });
  const r = await novo.call('POST', '/api/auth/mfa/verify', { challenge: l.json.challenge, code: totpAt(secret, counterNow()) });
  ok(r.status === 401, 'reutilização aceite: ' + r.status);
  return '401 (código já usado neste passo)';
});

await t('código de recuperação: entra uma vez e é consumido', async () => {
  const novo = session();
  const l = await novo.call('POST', '/api/auth/login', { email, password: PASSWORD });
  ok(l.json.methods.includes('recovery'), 'os métodos não anunciam recuperação: ' + JSON.stringify(l.json.methods));
  const r = await novo.call('POST', '/api/auth/mfa/verify', { challenge: l.json.challenge, recoveryCode: recovery[0] });
  ok(r.status === 200 && r.json.via === 'recovery', 'estado ' + r.status + ' ' + r.text.slice(0, 120));
  ok(r.json.recoveryLeft === 9, 'restam ' + r.json.recoveryLeft);
  ok(/usou um código de recuperação/.test(r.json.aviso), 'sem aviso de consumo');
  const novo2 = session();
  const l2 = await novo2.call('POST', '/api/auth/login', { email, password: PASSWORD });
  const r2 = await novo2.call('POST', '/api/auth/mfa/verify', { challenge: l2.json.challenge, recoveryCode: recovery[0] });
  ok(r2.status === 401, 'o código de recuperação serviu duas vezes');
  return 'consumido, restam 9';
});

await t('limite de tentativas: conta com segundo factor bloqueia ao fim de 8 códigos errados', async () => {
  /* conta própria: bloquear a conta principal estragaria os testes seguintes */
  const alvo = 'limite' + Date.now().toString(36) + '@ex.pt';
  const s2 = session();
  await s2.call('POST', '/api/auth/register', { email: alvo, password: PASSWORD, acceptTerms: true });
  const su = await s2.call('POST', '/api/auth/mfa/setup', { password: PASSWORD });
  await s2.call('POST', '/api/auth/mfa/enable', { code: totpAt(su.json.secret, counterNow()) });
  let ultimo = null;
  for (let i = 0; i < 12; i++) {
    const s3 = session();
    const l = await s3.call('POST', '/api/auth/login', { email: alvo, password: PASSWORD });
    if (l.status === 429) { ultimo = l; break; }
    ultimo = await s3.call('POST', '/api/auth/mfa/verify', { challenge: l.json.challenge, code: '999999' });
    if (ultimo.status === 429) break;
  }
  ok(ultimo && ultimo.status === 429, 'nunca bloqueou (último ' + (ultimo && ultimo.status) + ')');
  ok(/demasiados códigos/i.test(ultimo.json.error.message), ultimo.json.error.message);
  return '429 com razão escrita';
});

await t('trocar a palavra-passe com segundo factor activo exige um código', async () => {
  const sem = await ses.call('POST', '/api/auth/password', { current: PASSWORD, next: 'OutraSenha-2027!' });
  ok(sem.status === 401, 'trocou sem código: ' + sem.status);
  ok(/segundo passo|código/i.test(sem.json.error.message), sem.json.error.message);
  const com = await ses.call('POST', '/api/auth/password', { current: PASSWORD, next: 'OutraSenha-2027!', code: totpAt(secret, counterNow()) });
  ok(com.status === 200, 'com código: ' + com.status + ' ' + com.text.slice(0, 120));
  return 'exige código; troca aceite com código';
});

await t('desactivar exige palavra-passe E código (cookie roubado não basta)', async () => {
  const ses2 = session();
  const l = await ses2.call('POST', '/api/auth/login', { email, password: 'OutraSenha-2027!' });
  const entrar = await ses2.call('POST', '/api/auth/mfa/verify', { challenge: l.json.challenge, recoveryCode: recovery[1] });
  ok(entrar.status === 200, 'entrada: ' + entrar.status);
  const semCodigo = await ses2.call('POST', '/api/auth/mfa/disable', { password: 'OutraSenha-2027!' });
  ok(semCodigo.status === 400, 'desactivou sem código: ' + semCodigo.status);
  const comCodigo = await ses2.call('POST', '/api/auth/mfa/disable', { password: 'OutraSenha-2027!', code: totpAt(secret, counterNow()) });
  ok(comCodigo.status === 200, 'com código: ' + comCodigo.status + ' ' + comCodigo.text.slice(0, 120));
  const st = await ses2.call('GET', '/api/auth/mfa');
  ok(st.json.enabled === false, 'continua activo');
  const l3 = await ses2.call('POST', '/api/auth/login', { email, password: 'OutraSenha-2027!' });
  ok(l3.json.mfaRequired === undefined && l3.json.user, 'o login devia voltar a ser de um passo');
  return 'desactivado; login volta a um passo';
});

let missing = [];
await t('auditoria cobre o ciclo completo do segundo factor', async () => {
  const aud = await adminSes.call('GET', '/api/admin/audit?limit=200');
  const tipos = new Set((aud.json.events || []).map((e) => e.type));
  const exigidos = ['mfa_setup_started', 'mfa_enabled', 'mfa_challenge', 'mfa_failed', 'login_succeeded', 'mfa_disabled'];
  missing = exigidos.filter((x) => !tipos.has(x));
  ok(missing.length === 0, 'faltam eventos: ' + missing.join(', '));
  return exigidos.join(', ');
});

/* ======================= C. durabilidade da base ======================= */

await t('base: grava checksum e cópias de segurança rotativas', async () => {
  const dir = tmp('store');
  const s = await createStore(dir).init();
  await s.createUser({ email: 'a@ex.pt', passwordHash: 'x', salt: 'y' });
  const check = path.join(dir, 'db.json.sha256');
  ok(fs.existsSync(check), 'sem ficheiro de checksum');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'db.json'))).digest('hex');
  ok(fs.readFileSync(check, 'utf8').trim() === hash, 'o checksum não corresponde ao conteúdo');
  ok(fs.readdirSync(dir).some((f) => /^db-backup-/.test(f)), 'sem cópia de segurança');
  const integ = s.integrity();
  ok(integ.lock.held === true && integ.lock.readOnly === false, 'bloqueio: ' + JSON.stringify(integ.lock));
  await s.close();
  return 'sha256 + ' + integ.backups + ' cópia(s), bloqueio próprio';
});

await t('base truncada: recupera a cópia válida e diz qual', async () => {
  const dir = tmp('broken');
  const s = await createStore(dir).init();
  await s.createUser({ email: 'primeiro@ex.pt', passwordHash: 'x', salt: 'y' });
  await s.close();
  const file = path.join(dir, 'db.json');
  const bom = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, bom.slice(0, Math.floor(bom.length / 2)));   // escrita interrompida
  const s2 = await createStore(dir).init();
  const integ = s2.integrity();
  ok(s2.data.users.length === 1, 'não recuperou o utilizador');
  ok(integ.recovery.used && /(db-backup-|ultima-copia)/.test(integ.recovery.used), 'não declarou de onde recuperou: ' + integ.recovery.used);
  ok(/recuperada a cópia/.test(integ.recovery.reason), 'razão: ' + integ.recovery.reason);
  ok(fs.readdirSync(dir).some((f) => /\.broken-/.test(f)), 'não preservou o ficheiro danificado');
  await s2.close();
  return integ.recovery.reason.split('/').pop().slice(0, 60);
});

await t('base ilegível e sem cópias: recomeça vazia e DECLARA-O (nunca em silêncio)', async () => {
  const dir = tmp('norec');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'db.json'), '{"meio ficheiro": ');
  const s = await createStore(dir).init();
  const integ = s.integrity();
  ok(integ.recovery.freshStart === true, 'não marcou recomeço');
  ok(/recomeçada vazia/i.test(integ.recovery.reason), 'razão: ' + integ.recovery.reason);
  ok(s.data.users.length === 0, 'inventou dados');
  await s.close();
  return integ.recovery.reason.slice(0, 80);
});

await t('segunda instância no mesmo diretório: só-de-leitura e escrita recusada', async () => {
  const dir = tmp('lock');
  const a = await createStore(dir).init();
  await a.createUser({ email: 'dono@ex.pt', passwordHash: 'x', salt: 'y' });
  /* simula outro processo vivo: o bloqueio é reescrito com um pid que existe */
  fs.writeFileSync(path.join(dir, 'db.lock'), JSON.stringify({ pid: PID_VIVO, at: new Date().toISOString(), host: os.hostname() }));
  const b = await createStore(dir).init();
  const integ = b.integrity();
  ok(integ.lock.readOnly === true, 'a segunda instância não entrou em só-de-leitura');
  ok(/outra instância/.test(integ.lock.reason), 'razão: ' + integ.lock.reason);
  let recusou = false;
  try { await b.createUser({ email: 'x@ex.pt', passwordHash: 'x', salt: 'y' }); } catch (e) { recusou = /só-de-leitura/.test(e.message); }
  ok(recusou, 'a escrita não foi recusada');
  ok(b.data.users.length === 1, 'a leitura devia ver os dados existentes');
  await a.close();
  return 'modo só-de-leitura com motivo';
});

await t('/ready publica a integridade e recusa prontidão com base bloqueada', async () => {
  const dir = tmp('ready');
  const a = await createStore(dir).init();
  /* outra instância viva (o processo pai) detém a escrita */
  fs.writeFileSync(path.join(dir, 'db.lock'), JSON.stringify({ pid: PID_VIVO, at: new Date().toISOString(), host: os.hostname() }));
  const api2 = await createApi({ dataDir: dir, appSecret: 'segredo-de-teste-ready-1234567890', secure: false });
  const srv2 = http.createServer((q, r) => api2.handle(q, r, new URL(q.url, 'http://x')));
  await new Promise((r) => srv2.listen(0, '127.0.0.1', r));
  const base2 = 'http://127.0.0.1:' + srv2.address().port;
  /* a base deste servidor é outra instância da mesma pasta: bloqueada por `a` */
  const r = await fetch(base2 + '/ready');
  const j = await r.json();
  ok(j.checks.storage.integrity !== undefined, 'sem bloco de integridade');
  ok(j.checks.storage.readOnly === true, 'devia estar em só-de-leitura (o dono do bloqueio é outra instância)');
  ok(r.status === 503 && j.status === 'degraded', 'estado ' + r.status);
  ok(/só-de-leitura|recusa alterações/.test(j.aviso || ''), 'aviso: ' + j.aviso);
  srv2.close(); await api2.close(); await a.close();
  return 'HTTP 503 · integridade publicada · aviso escrito';
});

await t('mutação com base só-de-leitura devolve 503 e não grava', async () => {
  const dir = tmp('ro-write');
  const dono = await createStore(dir).init();
  fs.writeFileSync(path.join(dir, 'db.lock'), JSON.stringify({ pid: PID_VIVO, at: new Date().toISOString(), host: os.hostname() }));
  const api3 = await createApi({ dataDir: dir, appSecret: 'segredo-de-teste-ro-123456789012', adminEmail: 'admin@ex.pt', secure: false });
  const srv3 = http.createServer((q, r) => api3.handle(q, r, new URL(q.url, 'http://x')));
  await new Promise((r) => srv3.listen(0, '127.0.0.1', r));
  const b3 = 'http://127.0.0.1:' + srv3.address().port;
  const r = await fetch(b3 + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'n@ex.pt', password: PASSWORD, acceptTerms: true }) });
  ok(r.status === 503, 'estado ' + r.status);
  const j = await r.json();
  ok(j.error.retryable === true, 'sem indicação de poder tentar mais tarde: ' + JSON.stringify(j).slice(0, 120));
  ok(dono.data.users.length === 0, 'gravou apesar do bloqueio');
  srv3.close(); await api3.close(); await dono.close();
  return '503 retryable, nada gravado';
});

/* ---------- fecho ---------- */
srv.close();
await api.close();
outroProcesso.kill('SIGKILL');
console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
