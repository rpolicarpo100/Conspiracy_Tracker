import { chromium } from 'playwright';
const B = await chromium.launch({ executablePath: (process.env.CHROMIUM_PATH || undefined), args: ['--no-sandbox'], headless: true });
const p = await B.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
await p.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.click('#btnConsole');
await p.waitForTimeout(500);
const tabs = ['Fontes','Livro de provas','Dados reais','Agentes de recolha','Configuração de IA','Investigar'];
for (const t of tabs) {
  await p.click(`#consolebody >> text="${t}"`).catch(async () => {
    await p.evaluate((label) => [...document.querySelectorAll('#consolebody .btn, .chips .btn')].find(b => b.textContent.trim() === label)?.click(), t);
  });
  await p.waitForTimeout(350);
  const txt = (await p.textContent('#consolebody')).length;
  console.log(t.padEnd(18), 'conteúdo:', txt, 'chars');
}
// validar JSON inválido e válido através da UI
await p.evaluate(() => [...document.querySelectorAll('.chips .btn')].find(b => b.textContent.trim() === 'Investigar').click());
await p.waitForTimeout(300);
await p.evaluate(() => [...document.querySelectorAll('#consolebody .btn')].find(b => /Validar resposta/.test(b.textContent)).click());
await p.waitForTimeout(300);
await p.fill('.modalbody textarea', '{"claims":[{"text":"A empresa pagou 1 M€ sem qualquer fonte indicada","kind":"facto","status":"confirmado","sources":[]}],"negativeResults":[],"limits":[],"nextSteps":[]}');
await p.evaluate(() => [...document.querySelectorAll('.modalbody .btn')].find(b => b.textContent.trim() === 'Validar').click());
await p.waitForTimeout(400);
const verdict = await p.textContent('.modalbody');
console.log('validador na UI:', /rejeitada/i.test(verdict) ? 'OK (rejeitou e mostrou motivos)' : 'FALHOU');
await p.screenshot({ path: '/home/user/docs/shot-08-validation.png' });
console.log('erros:', errs.length, errs.slice(0,4));
await B.close();
