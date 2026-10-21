/* Agentes de recolha vistos pela interface: simulação, guarda SSRF e registo no livro. */
import { chromium } from 'playwright';
const B = await chromium.launch({ executablePath: '/tmp/pw/chromium-1140/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
const p = await B.newPage({ viewport: { width: 1560, height: 980 } });
const errs = [];
const external = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
p.on('request', (r) => { const u = r.url(); if (!u.startsWith('http://127.0.0.1:8080')) external.push(u); });
p.on('dialog', (d) => d.accept());
p.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
const R = [];
const t = async (name, fn) => { try { R.push({ name, ok: true, detail: await fn() }); } catch (e) { R.push({ name, ok: false, detail: e.message }); } };

await p.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(1300);
await p.click('#btnConsole');
await p.waitForTimeout(400);
await p.evaluate(() => [...document.querySelectorAll('.chips .btn')].find((b) => b.textContent.trim() === 'Agentes de recolha').click());
await p.waitForTimeout(400);

await t('separador «Agentes de recolha» com guardas visíveis', async () => {
  const txt = await p.textContent('#consolebody');
  ['robots.txt', 'SSRF', '20 pedidos', 'livro de provas'].forEach((k) => { if (txt.indexOf(k) < 0) throw new Error('falta menção a ' + k); });
  const rows = await p.evaluate(() => document.querySelectorAll('#consolebody table tbody tr').length);
  if (rows < 3) throw new Error('tarefas de exemplo em falta (' + rows + ')');
  return rows + ' tarefas de exemplo · guardas listadas';
});

await t('simulação: nada sai da máquina e todos os estados são «Simulada»', async () => {
  external.length = 0;
  await p.evaluate(() => [...document.querySelectorAll('#consolebody .btn')].find((b) => b.textContent.trim() === 'Simular recolha').click());
  await p.waitForTimeout(2500);
  const st = await p.evaluate(() => {
    const tables = [...document.querySelectorAll('#consolebody table')];
    const res = tables[tables.length - 1];
    return [...res.querySelectorAll('tbody tr')].map((tr) => tr.children[1].textContent.trim());
  });
  const simuladas = st.filter((s) => s === 'Simulada').length;
  if (!simuladas) throw new Error('sem estados simulados: ' + st.join(' | '));
  const alvo = external.filter((u) => !/\/api\/fetch$/.test(u));
  if (alvo.length) throw new Error('pedidos inesperados: ' + alvo.slice(0, 3).join(', '));
  const resumo = await p.textContent('#consolebody');
  if (!/simuladas/.test(resumo)) throw new Error('resumo da execução ausente');
  return simuladas + ' simuladas · 0 pedidos a domínios externos';
});

await t('guarda SSRF aplicada pelo agente local (execução real recusada)', async () => {
  await p.evaluate(() => {
    const inp = document.querySelector('#consolebody table tbody tr td input.input');
    inp.value = 'http://127.0.0.1:8080/index.html';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('#consolebody .btn')].find((b) => b.textContent.trim() === 'Execução real').click();
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    // manter só a primeira tarefa seleccionada
    const rows = [...[...document.querySelectorAll('#consolebody table')][0].querySelectorAll('tbody tr')];
    rows.slice(1).forEach((tr) => { const cb = tr.querySelector('input[type=checkbox]'); if (cb.checked) { cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); } });
    [...document.querySelectorAll('#consolebody .btn')].find((b) => b.textContent.trim() === 'Executar pedidos reais').click();
  });
  await p.waitForTimeout(3000);
  const txt = await p.textContent('#consolebody');
  if (!/Recusada/.test(txt)) throw new Error('não há estado Recusada');
  if (!/SSRF/.test(txt)) throw new Error('motivo SSRF não apresentado');
  return 'estado Recusada com motivo «endereço privado/local proibido (SSRF)»';
});

await t('livro de provas regista as recolhas (e a cadeia continua válida)', async () => {
  await p.evaluate(() => [...document.querySelectorAll('.chips .btn')].find((b) => b.textContent.trim() === 'Livro de provas').click());
  await p.waitForTimeout(500);
  const txt = await p.textContent('.modalbody');
  const rec = (txt.match(/Recolha automática|Simulação de recolha/gi) || []).length;
  if (!rec) throw new Error('sem entradas de recolha no livro');
  await p.evaluate(() => [...document.querySelectorAll('.modalbody .btn')].find((b) => /Verificar integridade/.test(b.textContent)).click());
  await p.waitForTimeout(700);
  const toast = await p.textContent('.toasts');
  if (!/cadeia intacta/i.test(toast)) throw new Error('verificação de integridade: ' + toast.slice(0, 120));
  return rec + ' entrada(s) de recolha no livro · ' + toast.trim().slice(0, 90);
});

await t('nenhum resultado de recolha entrou no grafo', async () => {
  const st = await p.evaluate(() => ({ n: VN.app.ctx.model.entities.length, r: VN.app.ctx.model.relations.length }));
  if (st.n !== 69 || st.r !== 126) throw new Error('o modelo mudou: ' + JSON.stringify(st));
  return 'modelo intacto: ' + st.n + ' entidades / ' + st.r + ' relações';
});

await p.evaluate(() => [...document.querySelectorAll('.chips .btn')].find((b) => b.textContent.trim() === 'Agentes de recolha').click());
await p.waitForTimeout(400);
await p.screenshot({ path: '/home/user/docs/shot-13-agentes.png' });
await B.close();
console.log('AGENTES — INTERFACE');
for (const r of R) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + String(r.detail).slice(0, 180));
console.log('erros de runtime:', errs.length, errs.slice(0, 3));
const fails = R.filter((r) => !r.ok).length;
console.log('\n' + (R.length - fails) + '/' + R.length + ' passaram');
process.exit(fails || errs.length ? 1 : 0);
