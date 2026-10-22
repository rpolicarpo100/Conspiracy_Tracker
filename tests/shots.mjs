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
const page = await B.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await abrir(page);
await page.waitForTimeout(1600);
await page.screenshot({ path: '/home/user/docs/shot-01-initial.png' });

// seleccionar entidade central via pesquisa
await page.click('#search'); await page.fill('#search', 'Epstein'); await page.waitForTimeout(300);
await page.click('.sresult'); await page.waitForTimeout(1400);
await page.evaluate(() => { VN.app.expand('c-meridiano', 1); });
await page.waitForTimeout(1400);
await page.screenshot({ path: '/home/user/docs/shot-02-details.png' });

// seleccionar ligação
await page.evaluate(() => VN.app.selectRelation('r-079'));
await page.waitForTimeout(900);
await page.screenshot({ path: '/home/user/docs/shot-03-relation.png' });

// caminhos
await page.evaluate(() => { const st = VN.app.ctx.store; st.loadAll(); VN.app.refresh(); st.setPath({a:'p-vitor', b:'p-joaquim', maxSteps:4}); VN.app.runPath(); });
await page.waitForTimeout(1800);
await page.screenshot({ path: '/home/user/docs/shot-04-paths.png' });

// cronologia + análise
await page.evaluate(() => { VN.app.ctx.store.setFilter({ yearFrom: 2015, yearTo: 2022 }, 'período'); VN.app.refresh(); document.querySelector('.sidetab[data-sidetab="analysis"]').click(); });
await page.waitForTimeout(1200);
await page.screenshot({ path: '/home/user/docs/shot-05-period.png' });

// consola
await page.click('#btnConsole'); await page.waitForTimeout(700);
await page.fill('#consolebody textarea', 'Que relações documentadas existem entre o Grupo Aldevaran e a Câmara Municipal no contrato de concessão de 2016?');
await page.click('#consolebody .btn.primary'); await page.waitForTimeout(900);
await page.screenshot({ path: '/home/user/docs/shot-06-console.png' });

// modo claro
await page.keyboard.press('Escape');
await page.evaluate(() => { document.getElementById('modal').hidden = true; VN.app.setTheme('light'); });
await page.waitForTimeout(1200);
await page.screenshot({ path: '/home/user/docs/shot-07-light.png' });
await B.close();
