/* Verificação AO VIVO do segundo factor (TOTP) no serviço público, com conta descartável.
   Uso: node tests/mfa-publico.mjs [URL]

   O código é calculado com a MESMA função que o servidor usa (`totpAt` de server/mfa.mjs),
   a partir do segredo que o servidor devolve uma única vez na ativação — não há mock.
   O que se prova: a sessão não existe antes do código, um código errado não abre sessão,
   um código certo abre, e desactivar exige palavra-passe + código. */
import { totpAt } from '../server/mfa.mjs';

const BASE = process.argv[2] || 'https://conspiracy-aitracker.onrender.com';
const EMAIL = 'mfa-live-' + Date.now().toString(36) + '@exemplo-qa.pt';
const PASSWORD = 'SenhaForte-2026!';
const out = [];
const ok = (c, m) => { out.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

function session(email) {
  let cookie = '', csrf = '';
  async function call(m, p, b) {
    const h = { 'content-type': 'application/json' };
    if (cookie) h.cookie = cookie;
    if (csrf) h['x-csrf-token'] = csrf;
    const res = await fetch(BASE + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    set.forEach((c) => {
      const [pair] = c.split(';'); const [k, v] = pair.split('=');
      if (k === 'vn_sid') cookie = 'vn_sid=' + v;
      if (k === 'vn_csrf') { csrf = v; cookie = (cookie ? cookie + '; ' : '') + 'vn_csrf=' + v; }
    });
    const txt = await res.text();
    let json = null; try { json = JSON.parse(txt); } catch { /* não JSON */ }
    return { status: res.status, json, text: txt, set };
  }
  return { call, get cookie() { return cookie; }, clear() { cookie = ''; csrf = ''; }, email };
}

const ses = session(EMAIL);
const reg = await ses.call('POST', '/api/auth/register', { email: EMAIL, password: PASSWORD, acceptTerms: true });
ok(reg.status === 201 || reg.status === 200, 'conta descartável criada (' + EMAIL + ')');

const setup = await ses.call('POST', '/api/auth/mfa/setup', { password: PASSWORD });
const secret = setup.json?.secret;
ok(setup.status === 201 && !!secret, 'segredo emitido uma vez (base32, ' + (secret || '').length + ' caracteres)');
ok(!JSON.stringify((await ses.call('GET', '/api/auth/mfa')).json).includes(secret || '###'), 'o segredo não volta a ser servido pelo estado');

const enable = await ses.call('POST', '/api/auth/mfa/enable', { code: totpAt(secret, Math.floor(Date.now() / 30000)) });
ok(enable.status === 200 && enable.json?.recoveryCodes?.length === 10, 'activado com código TOTP real · ' + (enable.json?.recoveryCodes || []).length + ' códigos de recuperação');

const st = await ses.call('GET', '/api/auth/mfa');
ok(st.json?.enabled === true, 'estado: activo · códigos restantes ' + st.json?.recoveryCodesLeft);

/* login em dois passos */
const login1 = await session('').call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
ok(login1.json?.mfaRequired === true && !!login1.json?.challenge, 'login devolve desafio, não sessão');
ok(!(login1.set || []).some((c) => c.startsWith('vn_sid=')), 'nenhum cookie de sessão antes do código');

const desafio = session('');
const wrong = await desafio.call('POST', '/api/auth/mfa/verify', { challenge: login1.json.challenge, code: '000000' });
ok(wrong.status === 401, 'código errado recusado (' + wrong.status + ')');
const afterWrong = await desafio.call('GET', '/api/auth/me');
ok(afterWrong.json?.user == null, 'sem sessão depois do código errado');

const desafio2 = session('');
const good = await desafio2.call('POST', '/api/auth/mfa/verify', { challenge: login1.json.challenge, code: totpAt(secret, Math.floor(Date.now() / 30000)) });
ok(good.status === 200, 'código certo aceite (' + good.status + ')');
const me = await desafio2.call('GET', '/api/auth/me');
ok(me.json?.user?.email === EMAIL, 'sessão criada só depois do segundo factor');

/* o mesmo desafio não serve duas vezes */
const replay = await session('').call('POST', '/api/auth/mfa/verify', { challenge: login1.json.challenge, code: totpAt(secret, Math.floor(Date.now() / 30000)) });
ok(replay.status === 401 || replay.status === 409, 'desafio de uso único (' + replay.status + ')');

/* desactivar exige palavra-passe + código */
const semCodigo = await desafio2.call('POST', '/api/auth/mfa/disable', { password: PASSWORD });
ok(semCodigo.status === 400 || semCodigo.status === 401, 'desactivar sem código recusado (' + semCodigo.status + ')');
const off = await desafio2.call('POST', '/api/auth/mfa/disable', { password: PASSWORD, code: totpAt(secret, Math.floor(Date.now() / 30000)) });
ok(off.status === 200, 'desactivado com palavra-passe + código (' + off.status + ')');

const del = await desafio2.call('DELETE', '/api/auth/account', { password: PASSWORD });
ok(del.status === 200, 'conta descartável eliminada');

console.log(out.join('\n'));
console.log('\n' + out.filter((l) => l.startsWith('PASS')).length + '/' + out.length + ' passaram');
