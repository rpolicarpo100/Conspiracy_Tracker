/* Recolha real contra uma fonte pública (requer internet).
   Prova: pedido efectuado, estado HTTP, tipo, tamanho, SHA-256 confirmado dos dois lados.
   Nada é inserido no grafo. */
import { chromium } from 'playwright';

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

const B = await chromium.launch({ executablePath: (process.env.CHROMIUM_PATH || undefined), args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
const p = await B.newPage({ viewport: { width: 1560, height: 980 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('dialog', (d) => d.accept());
await p.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.click('#btnConsole');
await p.waitForTimeout(400);
await p.evaluate(() => [...document.querySelectorAll('.chips .btn')].find((b) => b.textContent.trim() === 'Agentes de recolha').click());
await p.waitForTimeout(400);
const out = await p.evaluate(async () => {
  const runner = VN.agents.createRunner({ ledger: null, transport: 'proxy', proxyUrl: new URL('api/fetch', location.href).href });
  const r = await runner.run([{
    id: 'dados-gov', url: 'https://dados.gov.pt/api/1/datasets/?page_size=2', source: 'dados',
    extract: { type: 'json', fields: [{ name: 'total', path: 'total' }, { name: 'primeiroTitulo', path: 'data.0.title' }] }
  }], { dryRun: false });
  return r.results[0];
});
await p.evaluate(() => [...document.querySelectorAll('#consolebody .btn')].find((b) => b.textContent.trim() === 'Execução real').click());
await p.waitForTimeout(300);
await p.evaluate(() => {
  const rows = [...document.querySelectorAll('#consolebody table')[0].querySelectorAll('tbody tr')];
  rows.slice(1).forEach((tr) => { const cb = tr.querySelector('input[type=checkbox]'); if (cb.checked) { cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); } });
  [...document.querySelectorAll('#consolebody .btn')].find((b) => b.textContent.trim() === 'Executar pedidos reais').click();
});
await waitFor(p, () => /Recolhida/.test(document.getElementById('consolebody').textContent), 90000).catch(() => {});
await p.waitForTimeout(1200);
await p.screenshot({ path: '/home/user/docs/shot-14-recolha-real.png' });
console.log('RECOLHA REAL (fonte pública)');
console.log('estado      ', out.status);
console.log('HTTP        ', out.evidence && out.evidence.httpStatus);
console.log('tipo        ', out.evidence && out.evidence.contentType);
console.log('bytes       ', out.evidence && out.evidence.contentLength);
console.log('sha256      ', out.evidence && out.evidence.sha256);
console.log('hash cliente', out.evidence && out.evidence.sha256Agrees ? 'confere com o do agente' : 'NÃO confere');
console.log('extracção   ', JSON.stringify(out.extraction));
console.log('robots      ', JSON.stringify(out.evidence && out.evidence.robots));
console.log('erros       ', errs.length ? errs : 'nenhum');
await B.close();
