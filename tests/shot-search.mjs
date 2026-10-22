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

const B = await chromium.launch({ executablePath: (process.env.CHROMIUM_PATH || undefined), args: ['--no-sandbox','--disable-dev-shm-usage'], headless: true });
const p = await B.newPage({ viewport: { width: 1680, height: 1000 }, colorScheme: 'dark' });
await abrir(p);
await p.waitForTimeout(1400);
await p.click('#search'); await p.fill('#search', 'financiamento'); await p.waitForTimeout(400);
await p.screenshot({ path: '/home/user/docs/shot-10-palette.png' });
await p.fill('#search', 'epstain'); await p.waitForTimeout(400);
await p.screenshot({ path: '/home/user/docs/shot-11-fuzzy.png' });
await p.fill('#search', 'aldevaran'); await p.waitForTimeout(400);
await p.evaluate(() => VN.app.searchPage('aldevaran'));
await p.waitForTimeout(900);
await p.screenshot({ path: '/home/user/docs/shot-12-searchpage.png' });
await B.close();
