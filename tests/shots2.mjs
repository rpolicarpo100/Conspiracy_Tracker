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
await p.waitForTimeout(1800);
await p.screenshot({ path: '/home/user/docs/shot-01-initial.png' });
await p.evaluate(() => VN.app.focusEntity('p-vitor'));
await p.waitForTimeout(1500);
await p.evaluate(() => VN.app.expand('p-vitor', 1));
await p.waitForTimeout(1600);
await p.screenshot({ path: '/home/user/docs/shot-02-details.png' });
await B.close();

const B2 = await chromium.launch({ executablePath: (process.env.CHROMIUM_PATH || undefined), args: ['--no-sandbox','--disable-dev-shm-usage'], headless: true });
const q = await B2.newPage({ viewport: { width: 1680, height: 1000 }, colorScheme: 'light' });
await abrir(q);
await q.waitForTimeout(1500);
await q.evaluate(() => { VN.app.setTheme('light'); VN.app.focusEntity('c-meridiano'); });
await q.waitForTimeout(1400);
await q.evaluate(() => VN.app.selectRelation('r-020'));
await q.waitForTimeout(1200);
await q.screenshot({ path: '/home/user/docs/shot-07-light.png' });
await q.close();

const m = await B2.newPage({ viewport: { width: 900, height: 760 }, colorScheme: 'dark' });
await abrir(m);
await m.waitForTimeout(1600);
await m.evaluate(() => VN.app.focusEntity('c-meridiano'));
await m.waitForTimeout(1200);
await m.screenshot({ path: '/home/user/docs/shot-09-narrow.png' });
await B2.close();
