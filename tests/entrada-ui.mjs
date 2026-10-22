/* Porta de entrada — autenticação obrigatória na interface (fase 9).

   Prova, num browser real, que sem sessão NÃO se vê nada: a aplicação não
   arranca, o grafo não é criado, nenhum pedido de dados é feito. Depois
   exercita os três caminhos de entrada (credenciais, segundo factor,
   palavra-passe temporária), a saída e a expiração de sessão a meio do uso.

   Servidor próprio, dados descartáveis, conta criada por registo aberto só
   aqui (REGISTER_OPEN=true no processo de teste — em produção está fechado). */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { totpAt, counterNow } from '../server/mfa.mjs';

const PORT = 8600 + Math.floor(Math.random() * 90);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = '/tmp/vn-gate-' + crypto.randomBytes(4).toString('hex');
const srv = spawn(process.execPath, ['tools/serve.mjs'], {
  cwd: process.cwd(),
  env: Object.assign({}, process.env, {
    PORT: String(PORT), DATA_DIR: DATA, APP_SECRET: 'segredo-de-teste-entrada-1234',
    ADMIN_EMAIL: 'chefe@entrada.test', REGISTER_OPEN: 'true', REGISTER_MAX: '100', LOGIN_MAX_ATTEMPTS: '50'
  }),
  stdio: 'ignore'
});
await new Promise((r) => setTimeout(r, 2000));

const R = [];
const t = async (name, fn) => { try { R.push({ name, ok: true, detail: await fn() }); } catch (e) { R.push({ name, ok: false, detail: e.message }); } };

const B = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
const ctx = await B.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/status of 40[01349]/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 140)); });

const pedidos = [];
p.on('request', (r) => { if (/\/api\//.test(r.url())) pedidos.push(new URL(r.url()).pathname); });

const estado = () => p.evaluate(() => document.documentElement.getAttribute('data-vn-auth'));
const texto = (sel) => p.evaluate((s) => { const n = document.querySelector(s); return n ? n.textContent : ''; }, sel);
const esperar = async (fn, ms) => { const t0 = Date.now(); for (;;) { if (await p.evaluate(fn)) return true; if (Date.now() - t0 > (ms || 15000)) throw new Error('tempo excedido'); await p.waitForTimeout(150); } };

/* contas por registo (só possível neste servidor de teste) */
async function criarConta(email, password) {
  const r = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, acceptTerms: true })
  });
  if (r.status !== 201) throw new Error('registo de teste: HTTP ' + r.status);
  return r.json;
}

const adminEmail = 'chefe@entrada.test';
const ADMIN_PW = 'ChefeForte-2026';
await criarConta(adminEmail, ADMIN_PW);

/* ===================================================================== */
await t('sem sessão a aplicação não arranca: porta de entrada e zero dados', async () => {
  pedidos.length = 0;
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  if (await estado() !== 'por-autenticar') throw new Error('data-vn-auth = ' + await estado());
  if (!(await p.evaluate(() => !!document.getElementById('vnGate')))) throw new Error('sem porta de entrada');
  if (await p.evaluate(() => !!document.querySelector('#cy canvas'))) throw new Error('o grafo foi criado sem sessão');
  if (await p.evaluate(() => !!(window.VN && VN.app && VN.app.engine))) throw new Error('o motor do grafo arrancou sem sessão');
  /* os únicos pedidos permitidos são os de identificação, não de dados */
  const deDados = pedidos.filter((x) => !/^\/api\/(auth\/me|meta)$/.test(x));
  if (deDados.length) throw new Error('pedidos de dados sem sessão: ' + deDados.join(', '));
  /* o conteúdo da aplicação está escondido, não apenas por cima */
  const visivel = await p.evaluate(() => {
    const h = document.querySelector('header.topbar');
    return h ? getComputedStyle(h).display !== 'none' : false;
  });
  if (visivel) throw new Error('a barra da aplicação continua visível por baixo');
  return 'data-vn-auth=' + await estado() + ' · grafo ausente · pedidos: ' + pedidos.join(', ');
});

await t('o ecrã de entrada diz que o registo está fechado e como se obtém conta', async () => {
  const nota = await texto('#gateRegistoFechado');
  if (!/administrador/i.test(nota)) throw new Error('a nota não explica quem cria a conta: ' + nota.slice(0, 100));
  if (await p.evaluate(() => !!document.querySelector('#gateCriarConta'))) throw new Error('existe um botão de criar conta');
  return nota.slice(0, 90) + '…';
});

await t('credenciais erradas mostram a mensagem do servidor e não deixam entrar', async () => {
  await p.fill('#gateEmail', adminEmail);
  await p.fill('#gatePassword', 'ErradaDeProposito-1');
  await p.click('#gateSubmit');
  await waitMsg();
  const msg = await texto('#gateMsg');
  if (!/credenciais inválidas/i.test(msg)) throw new Error('mensagem: ' + msg);
  if (await estado() !== 'por-autenticar') throw new Error('entrou com credenciais erradas');
  if (await p.evaluate(() => !!document.querySelector('#cy canvas'))) throw new Error('o grafo apareceu');
  return msg;
});

async function waitMsg() { await esperar(() => !!document.getElementById('gateMsg'), 12000); }

await t('entrada correcta: a aplicação arranca e a porta desaparece', async () => {
  await p.fill('#gatePassword', ADMIN_PW);
  await p.click('#gateSubmit');
  await esperar(() => document.documentElement.getAttribute('data-vn-auth') === 'autenticado', 20000);
  await p.waitForTimeout(1500);
  if (await p.evaluate(() => !!document.getElementById('vnGate'))) throw new Error('a porta continuou no DOM');
  if (!(await p.evaluate(() => !!document.querySelector('#cy canvas')))) throw new Error('o grafo não arrancou');
  return 'autenticado · grafo desenhado · porta removida';
});

await t('a sessão sobrevive a um recarregamento (não se pede a palavra-passe outra vez)', async () => {
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  if (await estado() !== 'autenticado') throw new Error('depois de recarregar: ' + await estado());
  if (await p.evaluate(() => !!document.getElementById('vnGate'))) throw new Error('voltou a pedir entrada');
  return 'recarregar → já dentro';
});

await t('sair volta à porta e o histórico do browser não reabre a aplicação', async () => {
  const st = await p.evaluate(async () => {
    const me = await (await fetch('api/auth/me')).json();
    const r = await fetch('api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrf || '' }, body: '{}' });
    return r.status;
  });
  if (st !== 200) throw new Error('logout: HTTP ' + st);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  if (await estado() !== 'por-autenticar') throw new Error('depois do logout: ' + await estado());
  if (await p.evaluate(() => !!document.querySelector('#cy canvas'))) throw new Error('a aplicação continuou visível');
  return 'logout → porta de entrada · nenhum grafo';
});

await t('sessão revogada noutro dispositivo devolve o utilizador à entrada', async () => {
  await p.fill('#gateEmail', adminEmail);
  await p.fill('#gatePassword', ADMIN_PW);
  await p.click('#gateSubmit');
  await esperar(() => document.documentElement.getAttribute('data-vn-auth') === 'autenticado', 20000);
  await p.waitForTimeout(800);

  /* A sessão é revogada NO SERVIDOR (como quando se carrega em «terminar as
     outras sessões» noutro dispositivo). O cookie desta janela continua
     válido na forma, mas deixa de corresponder a uma sessão: é exactamente o
     caso em que a aplicação não pode continuar a mostrar dados. */
  const lg = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: ADMIN_PW })
  });
  if (lg.status !== 200) throw new Error('login de revogação: HTTP ' + lg.status);
  const csrf2 = (await lg.json()).csrf;
  const cookie2 = lg.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const rev = await fetch(BASE + '/api/auth/logout-all', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie2, 'x-csrf-token': csrf2 },
    body: '{}'
  });
  if (rev.status !== 200) throw new Error('logout-all: HTTP ' + rev.status);

  await p.evaluate(() => fetch('api/projects'));
  await esperar(() => document.documentElement.getAttribute('data-vn-auth') === 'por-autenticar', 10000);
  const msg = await texto('#gateMsg');
  if (!/sessão/i.test(msg)) throw new Error('sem explicação para a saída: ' + JSON.stringify(msg));
  /* o grafo pode continuar no DOM (a aplicação já estava carregada), mas não
     pode continuar visível: quem foi expulso não vê dados */
  const grafoVisivel = await p.evaluate(() => {
    const n = document.querySelector('#cy');
    if (!n) return false;
    const r = n.getBoundingClientRect();
    return getComputedStyle(n).display !== 'none' && r.width > 2 && r.height > 2;
  });
  if (grafoVisivel) throw new Error('o grafo continuou visível depois de a sessão ser revogada');
  return msg.slice(0, 84);
});

await t('conta com palavra-passe temporária: troca obrigatória antes de entrar', async () => {
  const email = 'temp.' + Date.now().toString(36) + '@entrada.test';
  /* um administrador cria a conta (a palavra-passe volta uma única vez) */
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: ADMIN_PW })
  });
  const setCookies = login.headers.getSetCookie();
  const csrf = (await login.json()).csrf;
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  const criar = await fetch(BASE + '/api/admin/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
    body: JSON.stringify({ email })
  });
  if (criar.status !== 201) throw new Error('criação: HTTP ' + criar.status + ' ' + (await criar.text()).slice(0, 120));
  const temp = (await criar.json()).tempPassword;

  await ctx.clearCookies();
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);
  await p.fill('#gateEmail', email);
  await p.fill('#gatePassword', temp);
  await p.click('#gateSubmit');
  try {
    await esperar(() => !!document.getElementById('gateTrocaObrigatoria'), 15000);
  } catch (e) {
    const diag = await p.evaluate(() => ({
      estado: document.documentElement.getAttribute('data-vn-auth'),
      msg: (document.getElementById('gateMsg') || {}).textContent || '',
      campos: [...document.querySelectorAll('#vnGate input')].map((i) => i.id),
      html: (document.getElementById('vnGate') || {}).innerHTML ? 'presente' : 'ausente'
    }));
    throw new Error('não apareceu o ecrã de troca: ' + JSON.stringify(diag));
  }
  if (await estado() !== 'por-autenticar') throw new Error('estado: ' + await estado());
  if (await p.evaluate(() => !!document.querySelector('#cy canvas'))) throw new Error('entrou sem trocar a palavra-passe');
  await p.fill('#gateNova', 'DefinitivaForte-99');
  await p.fill('#gateNova2', 'DefinitivaForte-99');
  await p.click('#gateSubmit');
  await esperar(() => document.documentElement.getAttribute('data-vn-auth') === 'autenticado', 20000);
  if (!(await p.evaluate(() => !!document.querySelector('#cy canvas')))) throw new Error('não entrou depois da troca');
  return 'temporária → ecrã de troca → nova palavra-passe → dentro';
});

await t('conta com segundo factor: a sessão só nasce depois do código', async () => {
  const email = 'mfa.' + Date.now().toString(36) + '@entrada.test';
  await criarConta(email, 'MfaForte-2026');

  /* activar o segundo factor como um utilizador faria no painel: sessão por
     HTTP, setup com a palavra-passe e confirmação de um código TOTP real */
  const lg = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'MfaForte-2026' })
  });
  if (lg.status !== 200) throw new Error('login de preparação: HTTP ' + lg.status);
  const csrf = (await lg.json()).csrf;
  const cookie = lg.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const setup = await fetch(BASE + '/api/auth/mfa/setup', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
    body: JSON.stringify({ password: 'MfaForte-2026' })
  });
  if (setup.status !== 201) throw new Error('setup MFA: HTTP ' + setup.status + ' ' + (await setup.text()).slice(0, 120));
  const secret = (await setup.json()).secret;
  const act = await fetch(BASE + '/api/auth/mfa/enable', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
    body: JSON.stringify({ code: totpAt(secret, counterNow()) })
  });
  if (act.status !== 200) throw new Error('activação MFA: HTTP ' + act.status + ' ' + (await act.text()).slice(0, 140));

  /* agora a porta tem de pedir o código */
  await ctx.clearCookies();
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1000);
  await p.fill('#gateEmail', email); await p.fill('#gatePassword', 'MfaForte-2026');
  await p.click('#gateSubmit');
  await esperar(() => !!document.getElementById('gateCode'), 15000);
  if (await estado() !== 'por-autenticar') throw new Error('entrou sem o código (estado ' + await estado() + ')');
  if (await p.evaluate(() => !!document.querySelector('#cy canvas'))) throw new Error('o grafo apareceu antes do segundo factor');

  /* código errado: recusa e continua fora */
  await p.fill('#gateCode', '000000');
  await p.click('#gateSubmit');
  await esperar(() => { const n = document.getElementById('gateMsg'); return !!n && /código/i.test(n.textContent); }, 12000);
  if (await estado() !== 'por-autenticar') throw new Error('aceitou um código errado');

  /* código certo: entra */
  await p.fill('#gateCode', totpAt(secret, counterNow()));
  await p.click('#gateSubmit');
  await esperar(() => document.documentElement.getAttribute('data-vn-auth') === 'autenticado', 20000);
  if (!(await p.evaluate(() => !!document.querySelector('#cy canvas')))) throw new Error('não arrancou depois do código');
  return 'login → código pedido → código errado recusado → código certo → dentro';
});

await t('sem erros de runtime em toda a sessão de testes', async () => {
  if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
  return 'nenhum';
});

await B.close();
srv.kill();
const ok = R.filter((r) => r.ok).length;
for (const r of R) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + r.detail);
console.log('\n' + ok + '/' + R.length + ' passaram');
process.exit(ok === R.length ? 0 : 1);
