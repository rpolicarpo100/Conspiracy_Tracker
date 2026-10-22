/* =====================================================================
   INTERFACE — verificação em dois passos, de ponta a ponta.

   O código TOTP é calculado no próprio teste (server/mfa.mjs), a partir do
   segredo que a interface mostra uma única vez. Não há códigos inventados nem
   atalhos no servidor: se a interface e o servidor discordarem, o teste falha.
   ===================================================================== */
import './_env.mjs';   // opt-in explícito: registo aberto só nos testes (ver tests/_env.mjs)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { totpAt, counterNow } from '../server/mfa.mjs';

const PORT = 8900 + Math.floor(Math.random() * 90);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = '/tmp/vn-mfaui-' + crypto.randomBytes(4).toString('hex');
const srv = spawn(process.execPath, ['tools/serve.mjs'], {
  cwd: process.cwd(),
  env: Object.assign({}, process.env, {
    PORT: String(PORT), DATA_DIR: DATA, APP_SECRET: 'segredo-de-teste-mfa-ui-1234567890',
    ADMIN_EMAIL: 'admin@meridiano.test', REGISTER_MAX: '200', LOGIN_MAX_ATTEMPTS: '100'
  }),
  stdio: 'ignore'
});
await new Promise((r) => setTimeout(r, 1700));

const R = [];
const t = async (name, fn) => { try { R.push({ name, ok: true, detail: await fn() }); } catch (e) { R.push({ name, ok: false, detail: e.message }); } };

const B = await chromium.launch({ executablePath: (process.env.CHROMIUM_PATH || undefined), args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
const p = await B.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/status of 40[019]/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 140)); });
let promptAnswer = null;
p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (promptAnswer || '') : undefined));

async function waitFor(fn, timeout) {
  const t0 = Date.now();
  for (;;) { if (await p.evaluate(fn)) return true; if (Date.now() - t0 > (timeout || 25000)) throw new Error('tempo excedido'); await p.waitForTimeout(200); }
}
async function clickText(sel, text) {
  for (let i = 0; i < 14; i++) {
    const hit = await p.evaluate(([s, t2]) => {
      const b = [...document.querySelectorAll(s)].find((x) => x.textContent.trim() === t2);
      if (b) { b.click(); return true; }
      return false;
    }, [sel, text]);
    if (hit) return true;
    await p.waitForTimeout(200);
  }
  throw new Error('botão «' + text + '» não encontrado');
}
/* o formulário de entrada usa rótulos (<label>), não placeholders */
async function fillLabel(label, value) {
  await p.evaluate(([lb, v]) => {
    const lab = [...document.querySelectorAll('#accroot label')].find((l) => (l.textContent || '').trim().startsWith(lb));
    const inp = lab && (lab.querySelector('input') || (lab.htmlFor && document.getElementById(lab.htmlFor)));
    if (!inp) throw new Error('campo «' + lb + '» não encontrado');
    inp.value = v;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, [label, value]);
  await p.waitForTimeout(150);
}

async function fill(placeholder, value) {
  await p.evaluate(([ph, v]) => {
    const inp = [...document.querySelectorAll('#accroot input')].find((i) => (i.placeholder || '') === ph);
    if (!inp) throw new Error('campo «' + ph + '» não encontrado');
    inp.value = v;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, [placeholder, value]);
  await p.waitForTimeout(150);
}

const EMAIL = 'mfa' + Date.now().toString(36) + '@ex.pt';
const PASS = 'SenhaForte123';
let secret = null;

await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);

await t('registo pela interface', async () => {
  await p.click('#btnAccount');
  await waitFor(() => !!document.getElementById('accroot'));
  await clickText('#accroot .btn', 'Criar conta');
  await p.waitForTimeout(300);
  await p.evaluate((mail) => {
    const inputs = [...document.querySelectorAll('#accroot input')];
    inputs[0].value = mail; inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = 'SenhaForte123'; inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    const cb = document.querySelector('#accroot input[type=checkbox]');
    cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
  }, EMAIL);
  await clickText('#accroot .btn', 'Criar conta');
  await waitFor(() => /Terminar sessão/.test(document.getElementById('accroot').textContent), 20000);
  return 'sessão criada';
});

await t('painel do segundo factor presente e desactivado', async () => {
  const txt = await p.textContent('#accroot');
  if (!/Verificação em dois passos/.test(txt)) throw new Error('sem painel');
  if (!/Activar verificação em dois passos/.test(txt)) throw new Error('sem botão de activação');
  return 'painel visível, estado desactivado';
});

await t('activar: segredo mostrado uma vez e confirmação por código', async () => {
  await fill('palavra-passe actual', PASS);
  await clickText('#accroot .btn', 'Activar verificação em dois passos');
  await waitFor(() => /segredo:/.test(document.getElementById('accroot').textContent), 15000);
  secret = await p.evaluate(() => {
    const code = [...document.querySelectorAll('#accroot code')].find((c) => /^[A-Z2-7]{16,}$/.test(c.textContent.trim()));
    return code ? code.textContent.trim() : null;
  });
  if (!secret) throw new Error('o segredo não apareceu no ecrã');
  const uri = await p.evaluate(() => (document.getElementById('accroot').textContent.match(/otpauth:\/\/totp\/[^\s]+/) || [])[0] || '');
  if (!/secret=/.test(uri)) throw new Error('sem URI de activação');
  await fill('código de 6 dígitos', totpAt(secret, counterNow()));
  await clickText('#accroot .btn', 'Confirmar e activar');
  await waitFor(() => /tag ok[^>]*>activo|>activo</.test(document.getElementById('accroot').innerHTML), 15000);
  return 'segredo ' + secret.slice(0, 4) + '… · activo';
});

await t('códigos de recuperação mostrados uma vez (10), em caixa própria', async () => {
  const codes = await p.evaluate(() => {
    const box = document.getElementById('mfaRecoveryBox');
    return box ? [...box.querySelectorAll('div')].map((d) => d.textContent.trim()).filter((x) => /^[0-9A-F]{5}-[0-9A-F]{5}$/.test(x)) : [];
  });
  if (codes.length !== 10) throw new Error('códigos na caixa: ' + codes.length);
  promptAnswer = codes[0];
  return codes.length + ' códigos (ex.: ' + codes[0] + ')';
});

await t('o segredo desaparece do ecrã; os códigos ficam até serem dispensados', async () => {
  await p.evaluate(() => window.VN.accountUI.refresh());
  await p.waitForTimeout(900);
  const txt = await p.textContent('#accroot');
  if (txt.includes(secret)) throw new Error('o segredo continua no ecrã');
  if (!/activo/.test(txt)) throw new Error('estado não repintado: ' + txt.slice(0, 160));
  if (!(await p.evaluate(() => !!document.getElementById('mfaRecoveryBox')))) throw new Error('os códigos desapareceram antes de serem guardados');
  await clickText('#accroot .btn', 'Já os guardei');
  await p.waitForTimeout(400);
  if (await p.evaluate(() => !!document.getElementById('mfaRecoveryBox'))) throw new Error('a caixa não fechou');
  return 'segredo fora do ecrã; códigos dispensados pelo utilizador';
});

await t('sair e entrar: a interface pede o segundo passo antes de abrir a conta', async () => {
  await p.evaluate(() => { const b = document.getElementById('btnLogout'); if (b) b.click(); });
  await waitFor(() => /Entrar/.test(document.getElementById('accroot').textContent), 15000);
  await fillLabel('Email', EMAIL);
  await fillLabel('Palavra-passe', PASS);
  await clickText('#accroot .btn', 'Entrar');
  await waitFor(() => !!document.getElementById('mfaCode'), 20000);
  const txt = await p.textContent('#accroot');
  if (!/Segundo passo/.test(txt)) throw new Error('sem indicação do segundo passo');
  if (/Terminar sessão/.test(txt)) throw new Error('entrou sem o código');
  const me = await p.evaluate(async () => (await (await fetch('api/auth/me')).json()).user);
  if (me) throw new Error('o servidor já considera a sessão aberta');
  return 'pedido de código antes da sessão';
});

await t('código errado: mensagem honesta, sessão continua fechada', async () => {
  await fill('código de 6 dígitos', '000000');
  await clickText('#accroot .btn', 'Confirmar código');
  await waitFor(() => /Código recusado/.test(document.getElementById('accroot').textContent), 15000);
  const me = await p.evaluate(async () => (await (await fetch('api/auth/me')).json()).user);
  if (me) throw new Error('a sessão abriu com código errado');
  return '401 mostrado, sem sessão';
});

await t('código certo: entra e a conta mostra o segundo factor activo', async () => {
  await fill('código de 6 dígitos', totpAt(secret, counterNow()));
  await clickText('#accroot .btn', 'Confirmar código');
  await waitFor(() => /Terminar sessão/.test(document.getElementById('accroot').textContent), 20000);
  const txt = await p.textContent('#accroot');
  if (!/activo/.test(txt)) throw new Error('painel não mostra activo');
  await p.evaluate(() => {
    const h = [...document.querySelectorAll('#accroot h4')].find((x) => /Verificação em dois passos/.test(x.textContent));
    if (h) h.scrollIntoView({ block: 'start' });
  });
  await p.waitForTimeout(400);
  await p.screenshot({ path: '/home/user/docs/shot-28-mfa.png' });
  return 'sessão aberta com TOTP; captura shot-28-mfa.png';
});

await t('desactivar exige palavra-passe e código', async () => {
  await fill('palavra-passe actual', PASS);
  await clickText('#accroot .btn', 'Desactivar');
  await waitFor(() => /Falhou|desactivada/.test(document.getElementById('accroot').textContent), 15000);
  let txt = await p.textContent('#accroot');
  if (/desactivada/.test(txt)) throw new Error('desactivou sem código');
  await fill('código de 6 dígitos', totpAt(secret, counterNow()));
  await clickText('#accroot .btn', 'Desactivar');
  await waitFor(() => /desactivada/.test(document.getElementById('accroot').textContent), 20000);
  txt = await p.textContent('#accroot');
  if (!/Activar verificação em dois passos/.test(txt)) throw new Error('painel não voltou ao estado desactivado');
  return 'recusado sem código; desactivado com código';
});

await t('documentos: o painel declara o estado real do OCR', async () => {
  await clickText('#accroot .btn', 'Projectos');
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const inputs = [...document.querySelectorAll('#accroot input')];
    inputs[0].value = 'Caso OCR'; inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = 'O OCR funciona?'; inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickText('#accroot .btn', 'Criar projecto');
  await waitFor(() => /Caso OCR/.test(document.getElementById('accroot').textContent), 15000);
  await clickText('#accroot .btn', 'Abrir');
  await waitFor(() => /Documentos e texto extraído/.test(document.getElementById('accroot').textContent), 15000);
  const txt = await p.textContent('#accroot');
  const declara = /OCR disponível|OCR indisponível/.test(txt);
  if (!declara) throw new Error('o painel não diz se o OCR está disponível');
  return (txt.match(/OCR (disponível|indisponível)[^\n]{0,70}/) || [''])[0];
});

await B.close();
srv.kill('SIGTERM');
console.log('VERIFICAÇÃO EM DOIS PASSOS — INTERFACE');
for (const r of R) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + String(r.detail).slice(0, 170));
console.log('erros de runtime:', errs.length, errs.slice(0, 3));
const fails = R.filter((r) => !r.ok).length;
console.log('\n' + (R.length - fails) + '/' + R.length + ' passaram (restaram ' + (await Promise.resolve(0)) + ')');
process.exit(fails ? 1 : 0);
