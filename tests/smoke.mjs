import { chromium } from 'playwright';
import { entrarNaAplicacao, semearConta, CONTA_TESTE } from './_ui-entrada.mjs';

/* Desde a fase 9 a aplicação não arranca sem sessão: estes scripts entram pela
   porta, como qualquer pessoa, no servidor de desenvolvimento. Nunca produção. */
const BASE = process.env.VN_BASE || 'http://127.0.0.1:8080';
let contaSemeada = false;
async function abrir(pg) {
  if (!contaSemeada) { await semearConta(BASE, CONTA_TESTE.email, CONTA_TESTE.password); contaSemeada = true; }
  await pg.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await pg.waitForTimeout(900);
  await entrarNaAplicacao(pg, BASE, CONTA_TESTE.email, CONTA_TESTE.password);
}

const browser = await chromium.launch({ executablePath: (process.env.CHROMIUM_PATH || undefined), args: ['--no-sandbox','--disable-dev-shm-usage'], headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
const errors = [], logs = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); else logs.push(m.type()+': '+m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await abrir(page);
await page.waitForTimeout(2500);
const info = await page.evaluate(() => ({
  nodes: document.querySelectorAll('#detailsbody .empty').length,
  cyNodes: window.VN && VN.app && VN.app.engine ? VN.app.engine.stats() : null,
  loaded: VN && VN.app && VN.app.ctx.store ? VN.app.ctx.store.state.loaded.size : null,
  status: document.getElementById('statCounts')?.textContent,
  sidebar: document.getElementById('sidebody')?.children.length,
  legend: document.getElementById('legendbar')?.textContent?.slice(0,120),
  canvas: !!document.querySelector('#cy canvas')
}));
console.log(JSON.stringify(info, null, 2));
console.log('ERRORS:', errors.length); errors.slice(0,12).forEach(e => console.log(' -', e));
await page.screenshot({ path: '/home/user/docs/shot-01-initial.png', fullPage: false });
await browser.close();
