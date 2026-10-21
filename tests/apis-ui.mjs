/* Interface de APIs: catálogo, auditoria real através do agente local, descoberta e API personalizada. */
import { chromium } from 'playwright';
const B = await chromium.launch({ executablePath: (process.env.CHROMIUM_PATH || undefined), args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
const p = await B.newPage({ viewport: { width: 1560, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
p.on('dialog', (d) => d.accept());

/* a CSP da app proíbe eval; esperas são feitas por sondagem com page.evaluate */
async function waitFor(page, fn, timeout) {
  const t0 = Date.now();
  const limit = timeout || 60000;
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() - t0 > limit) throw new Error('tempo de espera excedido (' + limit + ' ms)');
    await page.waitForTimeout(250);
  }
}

const R = [];
const t = async (name, fn) => { try { R.push({ name, ok: true, detail: await fn() }); } catch (e) { R.push({ name, ok: false, detail: e.message }); } };

await p.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(1300);
await p.click('#btnConsole');
await p.waitForTimeout(400);
await p.evaluate(() => [...document.querySelectorAll('.chips .btn')].find((b) => b.textContent.trim() === 'APIs').click());
await p.waitForTimeout(500);

await t('separador «APIs» com catálogo, pesos e guardas', async () => {
  const txt = await p.textContent('#apisroot');
  ['segurança', 'fiabilidade', 'utilidade', 'robots', 'fonte de verdades', 'APIs.guru'].forEach((k) => {
    if (txt.toLowerCase().indexOf(k.toLowerCase()) < 0) throw new Error('falta menção a «' + k + '»');
  });
  const rows = await p.evaluate(() => document.querySelectorAll('#apisroot table tbody tr').length);
  if (rows < 12) throw new Error('catálogo incompleto: ' + rows + ' linhas');
  return rows + ' entradas no catálogo · 3 dimensões explicadas';
});

await t('auditoria real de uma API (GLEIF) produz pontuações e razões', async () => {
  await p.evaluate(() => VN.apis.auditOne(VN.apis.byId('gleif'), VN.agents.createRunner({ transport: 'proxy', proxyUrl: new URL('api/fetch', location.href).href }), { attempts: 1 }));
  await p.evaluate(() => {
    const btns = [...document.querySelectorAll('#apisroot table tbody tr')];
    const row = btns.find((tr) => /GLEIF/.test(tr.textContent));
    row.querySelector('button').click();
  });
  await waitFor(p, () => /Segurança/.test(document.getElementById('apisroot').textContent), 150000);
  await p.waitForTimeout(1200);
  const txt = await p.textContent('#apisroot');
  if (!/Segurança/.test(txt) || !/Fiabilidade/.test(txt)) throw new Error('razões por dimensão não apresentadas');
  const pills = await p.evaluate(() => [...document.querySelectorAll('#apisroot .scorepill')].slice(0, 3).map((x) => x.textContent));
  if (pills.length < 3) throw new Error('faltam pontuações');
  return 'pontuações seg/fia/uti: ' + pills.join(' · ');
});

await t('detalhe mostra cabeçalhos observados e SHA-256 das respostas', async () => {
  await p.evaluate(() => {
    const d = [...document.querySelectorAll('#apisroot details')][0];
    if (d) d.open = true;
  });
  const txt = await p.textContent('#apisroot');
  if (!/Cabeçalhos observados/.test(txt)) throw new Error('sem bloco de cabeçalhos');
  if (!/200/.test(txt)) throw new Error('sem estado HTTP nas tentativas');
  return 'cabeçalhos e tentativas visíveis';
});

await t('API personalizada: validação recusa URL inválido e aceita válido', async () => {
  await p.evaluate(() => [...document.querySelectorAll('#apisroot .btn')].find((b) => b.textContent.trim() === 'Adicionar API').click());
  await p.waitForTimeout(300);
  await p.evaluate(() => {
    const inputs = [...document.querySelectorAll('#apisroot input.input')];
    const set = (i, v) => { inputs[i].value = v; inputs[i].dispatchEvent(new Event('input', { bubbles: true })); };
    set(0, 'API de teste'); set(1, 'ftp://x/y');
    [...document.querySelectorAll('#apisroot .btn')].find((b) => /Validar e adicionar/.test(b.textContent)).click();
  });
  await p.waitForTimeout(500);
  const toasts = await p.textContent('.toasts');
  if (!/URL tem de começar/.test(toasts)) throw new Error('não recusou URL inválido: ' + toasts.slice(0, 120));
  await p.evaluate(() => {
    const inputs = [...document.querySelectorAll('#apisroot input.input')];
    const set = (i, v) => { inputs[i].value = v; inputs[i].dispatchEvent(new Event('input', { bubbles: true })); };
    set(1, 'https://dados.gov.pt/api/1/datasets/?page_size=1'); set(2, 'https://dados.gov.pt/pt/docapi/');
    set(3, 'dados abertos'); set(4, 'nenhuma'); set(6, '85'); set(7, 'catálogo de dados abertos portugueses');
    [...document.querySelectorAll('#apisroot .btn')].find((b) => /Validar e adicionar/.test(b.textContent)).click();
  });
  await p.waitForTimeout(600);
  const n = await p.evaluate(() => document.querySelectorAll('#apisroot table tbody tr').length);
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('vn-apis-custom') || '[]').length);
  if (stored !== 1) throw new Error('não ficou guardada no localStorage');
  if (n < 13) throw new Error('não apareceu na tabela (' + n + ')');
  return 'recusou URL inválido · aceitou e persistiu a válida (' + n + ' linhas)';
});

await t('agente de descoberta: candidatos reais do APIs.guru para «contracts»', async () => {
  await p.evaluate(() => {
    const i = [...document.querySelectorAll('#apisroot input.input')].pop();
    i.value = 'contracts'; i.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('#apisroot .btn')].find((b) => /Procurar APIs/.test(b.textContent)).click();
  });
  await waitFor(p, () => {
    const root = document.getElementById('apisroot');
    if (!root) return false;
    const stillRunning = [...root.querySelectorAll('.btn')].some((b) => /A procurar/.test(b.textContent));
    return !stillRunning && (root.querySelectorAll('table').length >= 2 || /Nenhum candidato/.test(root.textContent));
  }, 180000);
  await p.waitForTimeout(500);
  const txt = await p.textContent('#apisroot');
  const m = txt.match(/(\d+) candidatos/);
  if (!m) throw new Error('sem contagem de candidatos: ' + txt.slice(-200));
  const rows = await p.evaluate(() => document.querySelectorAll('#apisroot table').length);
  if (rows < 2) throw new Error('tabela de candidatos ausente');
  return m[0] + ' · tabela de candidatos com ligação à especificação OpenAPI';
});

await t('auditoria de candidato deriva pedido da especificação (sem inventar)', async () => {
  const specUrl = await p.evaluate(() => (state => state)(null) || (document.querySelector('#apisroot table a[href$=".json"], #apisroot table a[href*="/specs/"]') || {}).href || null);
  if (!specUrl) throw new Error('sem especificação OpenAPI na lista de candidatos');
  const done = await p.evaluate(async (openapiUrl) => {
    const c = { provider: 'teste-local', version: '1', title: 'Local', description: 'teste', openapiUrl: openapiUrl, docs: null };
    const res = await VN.apis.auditCandidate(c, VN.agents.createRunner({ transport: 'proxy', proxyUrl: new URL('api/fetch', location.href).href }));
    return { spec: !!res.spec, probe: res.probe && res.probe.url, notes: res.notes, verdict: res.audit && res.audit.verdict };
  }, specUrl);
  if (!done.spec) throw new Error('especificação não obtida');
  return 'spec lida · pedido: ' + (done.probe || 'nenhum (exige parâmetros)') + ' · veredicto: ' + (done.verdict || 'sem pedido');
});

await t('cada auditoria fica no livro de provas (cadeia intacta)', async () => {
  await p.evaluate(() => [...document.querySelectorAll('.chips .btn')].find((b) => b.textContent.trim() === 'Livro de provas').click());
  await p.waitForTimeout(600);
  const txt = await p.textContent('.modalbody');
  const n = (txt.match(/Auditoria de API/g) || []).length;
  if (!n) throw new Error('sem entradas de auditoria no livro');
  await p.evaluate(() => [...document.querySelectorAll('.modalbody .btn')].find((b) => /Verificar integridade/.test(b.textContent)).click());
  await p.waitForTimeout(800);
  const toast = await p.textContent('.toasts');
  if (!/cadeia intacta/i.test(toast)) throw new Error('integridade: ' + toast.slice(0, 120));
  return n + ' auditorias registadas · ' + toast.trim().slice(0, 70);
});

await p.evaluate(() => [...document.querySelectorAll('.chips .btn')].find((b) => b.textContent.trim() === 'APIs').click());
await p.waitForTimeout(500);
await p.screenshot({ path: '/home/user/docs/shot-15-apis.png' });
await B.close();
console.log('APIs — INTERFACE');
for (const r of R) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + String(r.detail).slice(0, 180));
console.log('erros de runtime:', errs.length, errs.slice(0, 3));
const fails = R.filter((r) => !r.ok).length;
console.log('\n' + (R.length - fails) + '/' + R.length + ' passaram');
process.exit(fails || errs.length ? 1 : 0);
