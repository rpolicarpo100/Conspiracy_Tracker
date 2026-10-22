/* Interface do registo de fontes (fase 3G): catálogo, verificação, classificação,
   decisão, cobertura e histórico de descobertas — tudo a partir do servidor real. */
import './_env.mjs';   // opt-in explícito: registo aberto só nos testes (ver tests/_env.mjs)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const PORT = 8900 + Math.floor(Math.random() * 90);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = '/tmp/vn-fontesui-' + crypto.randomBytes(4).toString('hex');
const srv = spawn(process.execPath, ['tools/serve.mjs'], {
  cwd: process.cwd(),
  env: Object.assign({}, process.env, {
    PORT: String(PORT), DATA_DIR: DATA, APP_SECRET: 'segredo-de-teste-ui-fontes-1234',
    ADMIN_EMAIL: 'admin@fontes.test', REGISTER_MAX: '200', LOGIN_MAX_ATTEMPTS: '100'
  }),
  stdio: 'ignore'
});
await new Promise((r) => setTimeout(r, 1600));

const email = 'fontes-ui-' + Date.now().toString(36) + '@ex.pt';
const reg = await fetch(BASE + '/api/auth/register', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'SenhaForte123', acceptTerms: true })
});
if (reg.status !== 201) throw new Error('registo inicial: HTTP ' + reg.status);

const B = await chromium.launch({ executablePath: (process.env.CHROMIUM_PATH || undefined), args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
const p = await B.newPage({ viewport: { width: 1560, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/status of 40[01349]/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 140)); });
const dialogs = [];
p.on('dialog', async (d) => {
  if (d.type() !== 'prompt') return d.accept();
  dialogs.push(d.message());
  const msg = d.message();
  let answer = 'ok';
  if (/URL/i.test(msg)) answer = 'https://www.courtlistener.com/';
  else if (/Nome/i.test(msg)) answer = 'CourtListener (Free Law Project)';
  else if (/Categoria/i.test(msg)) answer = 'tribunais';
  else if (/Jurisdição/i.test(msg)) answer = 'US';
  else if (/Instituição/i.test(msg)) answer = 'Free Law Project';
  else if (/quantos registos verificou/i.test(msg)) answer = '0';
  else if (/quantos desses tinham erro/i.test(msg)) answer = '0';
  else if (/Motivo/i.test(msg)) answer = 'fonte de teste automatizado: motivo escrito com mais de dez caracteres';
  await d.accept(answer);
});
const R = [];
const t = async (name, fn) => { try { R.push({ name, ok: true, detail: await fn() }); } catch (e) { R.push({ name, ok: false, detail: e.message }); } };
async function waitFor(fn, timeout) {
  const t0 = Date.now();
  for (;;) { if (await p.evaluate(fn)) return true; if (Date.now() - t0 > (timeout || 30000)) throw new Error('tempo excedido'); await p.waitForTimeout(200); }
}
const txt = () => p.textContent('#consolebody');

/* entrar e abrir a consola */
await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.evaluate((mail) => fetch('api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: mail, password: 'SenhaForte123' })
}).then((r) => r.json()), email);
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(900);
/* a aplicação abre no modo simples (fase 10); esta suite testa a vista
   completa, por isso escolhe-a — como qualquer pessoa faria na barra */
await p.evaluate(() => {
  try { localStorage.setItem('vn.vista', 'avancada'); } catch (e) { /* sem armazenamento */ }
  if (window.VN && window.VN.simples) VN.simples.mostrarVista('avancada');
});
await p.waitForTimeout(400);
await p.click('#btnConsole');
await p.waitForTimeout(500);
await p.evaluate(() => [...document.querySelectorAll('.chips .btn')].find((b) => b.textContent.trim() === 'Registo de fontes').click());
await p.waitForTimeout(1200);

await t('a área mostra os números reais do servidor (catálogo vazio no início)', async () => {
  const s = await p.evaluate(() => VN.fontesUI.getState());
  if (!s.meta) throw new Error('meta dos estados/categorias não carregou');
  if (s.stats.total !== 0) throw new Error('catálogo devia começar vazio, tem ' + s.stats.total);
  const body = await txt();
  if (!/Sem fontes registadas/.test(body)) throw new Error('sem estado vazio explícito');
  return s.meta.states.length + ' estados · ' + s.meta.categories.length + ' categorias · catálogo 0';
});

await t('registo manual: a fonte entra como DESCOBERTA (nunca como aprovada)', async () => {
  await p.evaluate(() => document.getElementById('btnAddSource').click());
  await waitFor(() => (VN.fontesUI.getState().sources || []).length === 1, 12000);
  const s = await p.evaluate(() => VN.fontesUI.getState().sources[0]);
  if (s.state !== 'DISCOVERED') throw new Error('estado inicial: ' + s.state);
  return s.name + ' · ' + s.stateLabel + ' · ' + s.domain;
});

await t('fonte sem classificação não tem nota («—») nem aprovação possível', async () => {
  await p.evaluate(() => [...document.querySelectorAll('#consolebody .btn')].find((b) => b.textContent.trim() === 'Abrir').click());
  await waitFor(() => /Sem classificação registada/.test(document.getElementById('consolebody').textContent), 8000);
  await p.evaluate(() => document.getElementById('btnApproveSource').click());
  try { await waitFor(() => /não se aprova uma fonte sem classificação/i.test(document.getElementById('consolebody').textContent), 8000); } catch { /* a mensagem faz falta abaixo */ }
  const body = await txt();
  if (!/não se aprova uma fonte sem classificação/i.test(body)) throw new Error('aprovou sem classificação: ' + body.slice(-200));
  return 'aprovação recusada com motivo visível';
});

await t('verificação real deixa HTTP, duração e interpretação no histórico', async () => {
  await p.evaluate(() => document.getElementById('btnCheckSource').click());
  await waitFor(() => /Verificações \(1\)/.test(document.getElementById('consolebody').textContent), 25000);
  const d = await p.evaluate(() => VN.fontesUI.getState().detail);
  const c = d.checks[0];
  if (typeof c.httpStatus !== 'number') throw new Error('sem HTTP observado');
  if (!c.why) throw new Error('sem interpretação');
  return 'HTTP ' + c.httpStatus + ' · ' + c.ms + ' ms · ' + c.why;
});

await t('classificar sem amostra dá «provisória» e a tabela diz o que falta', async () => {
  await p.evaluate(() => document.getElementById('btnRateSource').click());
  await waitFor(() => /provisória/i.test(document.getElementById('consolebody').textContent), 12000);
  const d = await p.evaluate(() => VN.fontesUI.getState().detail);
  const r = d.rating;
  if (!r.provisional) throw new Error('não ficou provisória');
  if (r.score !== null) throw new Error('atribuiu nota definitiva: ' + r.score);
  const linhas = await p.evaluate(() => document.querySelectorAll('#consolebody table').length);
  if (!linhas) throw new Error('sem tabela de dimensões');
  return 'provisória · falta: ' + (r.missing || []).join('; ').slice(0, 90);
});

await t('rejeição com motivo escrito fica registada e visível', async () => {
  await p.evaluate(() => [...document.querySelectorAll('#consolebody .btn')].find((b) => b.textContent.trim() === 'Rejeitar').click());
  await waitFor(() => /Decisões/.test(document.getElementById('consolebody').textContent), 10000);
  const d = await p.evaluate(() => VN.fontesUI.getState().detail);
  if (d.source.state !== 'REJECTED') throw new Error('estado: ' + d.source.state);
  if (!d.decisions.length || !/motivo escrito/.test(d.decisions[0].reason)) throw new Error('motivo não guardado');
  return 'REJECTED · ' + d.decisions[0].reason.slice(0, 60);
});

await t('duplicado é recusado com o motivo do servidor', async () => {
  await p.evaluate(() => document.getElementById('btnAddSource').click());
  await p.waitForTimeout(1200);
  const body = await txt();
  if (!/já está registada|duplicados não entram/i.test(body)) throw new Error('duplicado aceite: ' + body.slice(-200));
  const n = await p.evaluate(() => VN.fontesUI.getState().stats.total);
  if (n !== 1) throw new Error('o catálogo passou a ter ' + n + ' fontes');
  return '409 explicado na interface · catálogo continua com 1 fonte';
});

await t('simulação de descoberta não grava nada (e diz porquê se falhar)', async () => {
  const before = await p.evaluate(() => VN.fontesUI.getState().stats.total);
  await p.evaluate(() => document.getElementById('btnDiscoverDry').click());
  await p.waitForTimeout(6000);
  const s = await p.evaluate(() => VN.fontesUI.getState());
  const after = s.stats.total;
  const msg = (s.msg && s.msg.text) || '';
  if (/falhou/i.test(msg)) {
    if (!/429|limite|HTTP/i.test(msg)) throw new Error('falha sem explicação: ' + msg);
    return 'SKIP API pública indisponível/limitada: ' + msg.slice(0, 100);
  }
  if (after !== before) throw new Error('a simulação gravou: ' + before + '→' + after);
  return msg.slice(0, 120);
});

await t('cobertura e lacunas vêm do que está registado', async () => {
  const c = await p.evaluate(() => VN.fontesUI.getState().coverage);
  if (!c || !c.totals) throw new Error('sem cobertura');
  const body = await txt();
  if (!/Cobertura/.test(body) || !/não fontes validadas/.test(body)) throw new Error('sem nota metodológica na cobertura');
  return c.totals.sources + ' fonte(s) · ' + c.totals.countriesWithApproved + ' país(es) aprovado(s) · ' + c.gaps.categories.length + ' categorias por cobrir';
});

await p.screenshot({ path: '/home/user/docs/shot-29-fontes.png' });

await t('sem erros de runtime', async () => {
  if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
  return 'nenhum';
});

await B.close();
srv.kill('SIGKILL');

console.log('REGISTO DE FONTES — INTERFACE');
for (const r of R) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + String(r.detail).slice(0, 200));
const fails = R.filter((r) => !r.ok).length;
console.log('\n' + (R.length - fails) + '/' + R.length + ' passaram' + (fails ? ' (' + fails + ' falharam)' : ''));
if (fails) process.exitCode = 1;
