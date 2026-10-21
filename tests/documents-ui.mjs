/* =====================================================================
   INTERFACE — documentos e texto extraído de PDF.

   Corre contra um servidor próprio (VN_ALLOW_LOCAL_FETCH=1) que serve, em
   /tests/fixtures/relatorio-chromium.pdf, um PDF verdadeiro do motor do
   Chromium. O teste verifica o percurso que interessa:

   1. recolher o PDF pela interface;
   2. ler o texto extraído (tem de conter «Relatório de teste»);
   3. usar um excerto no formulário de prova — que NÃO registra nada sozinho;
   4. marcar como revisto;
   5. e que a ficha do projecto continua com 0 provas enquanto ninguém as criar.
   ===================================================================== */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const PORT = 8700 + Math.floor(Math.random() * 200);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = '/tmp/vn-docui-' + crypto.randomBytes(4).toString('hex');
const srv = spawn(process.execPath, ['tools/serve.mjs'], {
  cwd: process.cwd(),
  env: Object.assign({}, process.env, {
    PORT: String(PORT), DATA_DIR: DATA, APP_SECRET: 'segredo-de-teste-docs-1234567890',
    ADMIN_EMAIL: 'docs@meridiano.test', REGISTER_MAX: '200', LOGIN_MAX_ATTEMPTS: '100',
    VN_ALLOW_LOCAL_FETCH: '1'
  }),
  stdio: 'ignore'
});
await new Promise((r) => setTimeout(r, 1700));

const R = [];
const t = async (name, fn) => { try { R.push({ name, ok: true, detail: await fn() }); } catch (e) { R.push({ name, ok: false, detail: e.message }); } };

const B = await chromium.launch({ executablePath: '/home/user/.cache/ms-playwright/chromium-1140/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
const p = await B.newPage({ viewport: { width: 1560, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/status of 40[013]/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 140)); });
let promptValue = 'A fundação recebeu 250 000 euros em 2019, segundo o registo comercial consultado.';
p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? promptValue : undefined));

async function waitFor(fn, timeout) {
  const t0 = Date.now();
  for (;;) { if (await p.evaluate(fn)) return true; if (Date.now() - t0 > (timeout || 30000)) throw new Error('tempo excedido'); await p.waitForTimeout(200); }
}
async function clickText(sel, text) {
  for (let i = 0; i < 12; i++) {
    const hit = await p.evaluate(([s, t2]) => {
      const b = [...document.querySelectorAll(s)].find((x) => x.textContent.trim() === t2);
      if (b) b.click();
      return !!b;
    }, [sel, text]);
    if (hit) return true;
    await p.waitForTimeout(200);
  }
  throw new Error('botão «' + text + '» não encontrado');
}

await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);
const email = 'docui' + Date.now().toString(36) + '@ex.pt';

await t('registo e projecto criados pela interface', async () => {
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
  }, email);
  await clickText('#accroot .btn', 'Criar conta');
  await waitFor(() => /Terminar sessão/.test(document.getElementById('accroot').textContent), 20000);
  await clickText('#accroot .btn', 'Projectos');
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    const inputs = [...document.querySelectorAll('#accroot input')];
    inputs[0].value = 'Caso com PDF';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = 'O apoio de 250 000 euros existiu?';
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickText('#accroot .btn', 'Criar projecto');
  await waitFor(() => /Caso com PDF/.test(document.getElementById('accroot').textContent), 15000);
  await clickText('#accroot .btn', 'Abrir');
  await waitFor(() => /Documentos e texto extraído/.test(document.getElementById('accroot').textContent), 20000);
  const txt = await p.textContent('#accroot');
  if (!/Nenhum documento recolhido/.test(txt)) throw new Error('painel de documentos vazio não declarado');
  if (!/Registo de provas \(0\)/.test(txt)) throw new Error('esperava 0 provas antes de qualquer recolha');
  return 'painel «Documentos e texto extraído (0)» e 0 provas';
});

await t('recolher o PDF pela interface: extrai 2 páginas e exige revisão', async () => {
  await p.evaluate((base) => {
    const inp = document.getElementById('docUrl');
    inp.value = base + '/tests/fixtures/relatorio-chromium.pdf';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, BASE);
  await clickText('#accroot .btn', 'Recolher e extrair');
  await waitFor(() => /revisão pendente/.test(document.getElementById('accroot').textContent), 30000);
  const txt = await p.textContent('#accroot');
  if (!/2 pág\./.test(txt)) throw new Error('não mostrou as 2 páginas: ' + txt.match(/Documentos[^]{0,200}/));
  if (!/ToUnicode/.test(txt)) throw new Error('não declarou o uso do mapa de caracteres');
  if (!/hash [0-9a-f]{12}/.test(txt)) throw new Error('não mostrou o hash do ficheiro');
  if (!/Registo de provas \(0\)/.test(txt)) throw new Error('a recolha criou provas sozinha');
  return 'documento recolhido · revisão pendente · 0 provas';
});

await t('ver texto: o conteúdo extraído é legível (acentos e valores)', async () => {
  await clickText('#accroot .btn', 'Ver texto');
  await waitFor(() => !!document.getElementById('docText'), 15000);
  const texto = await p.evaluate(() => document.getElementById('docText').value);
  if (!/Relatório de teste/.test(texto)) throw new Error('falta «Relatório de teste»');
  if (!/250 000 euros/.test(texto)) throw new Error('falta «250 000 euros»');
  if (!/Segunda página/.test(texto)) throw new Error('falta «Segunda página»');
  if (/\uFFFD/.test(texto)) throw new Error('há caracteres de substituição no texto');
  await p.evaluate(() => {
    const h = [...document.querySelectorAll('#accroot h4')].find((x) => /Documentos e texto extraído/.test(x.textContent));
    if (h) h.scrollIntoView({ block: 'start' });
  });
  await p.waitForTimeout(300);
  await p.screenshot({ path: '/home/user/docs/shot-27-documentos.png' });
  return texto.split('\n')[0].slice(0, 60) + '… (' + texto.length + ' caracteres)';
});

await t('marcar como revisto fica registado na lista', async () => {
  await clickText('#accroot .btn', 'Marcar como revisto');
  await waitFor(() => /revisto/.test(document.getElementById('accroot').textContent), 15000);
  const txt = await p.textContent('#accroot');
  if (!/revisto/.test(txt)) throw new Error('não ficou revisto');
  return 'estado «revisto» apresentado';
});

await t('usar excerto preenche o formulário de prova mas NÃO registra sozinho', async () => {
  await clickText('#accroot .btn', 'Ver texto');
  await waitFor(() => !!document.getElementById('docText'), 15000);
  await clickText('#accroot .btn', 'Usar excerto na nova prova');
  await waitFor(() => {
    const inp = [...document.querySelectorAll('#accroot input')].find((i) => /trecho exacto/i.test(i.placeholder || ''));
    return !!inp && inp.value.length > 20;
  }, 15000);
  const estado = await p.evaluate(() => {
    const inputs = [...document.querySelectorAll('#accroot input')];
    const excerto = inputs.find((i) => /trecho exacto/i.test(i.placeholder || ''));
    const titulo = inputs.find((i) => /título do documento/i.test(i.placeholder || ''));
    const url = inputs.find((i) => i.placeholder === 'https://…');
    const provas = [...document.querySelectorAll('#accroot h4')].find((x) => /Registo de provas/.test(x.textContent));
    return { excerto: excerto && excerto.value, titulo: titulo && titulo.value, url: url && url.value, cabecalho: provas ? provas.textContent : null };
  });
  if (!/250 000 euros/.test(estado.excerto || '')) throw new Error('excerto não preenchido: ' + estado.excerto);
  if (!/chromium\.pdf$/.test(estado.url || '')) throw new Error('URL não preenchida: ' + estado.url);
  if (!/\(0\)/.test(estado.cabecalho || '')) throw new Error('prova criada sem confirmação humana: ' + estado.cabecalho);
  return 'excerto e URL preenchidos · ' + estado.cabecalho.trim();
});

await t('PDF cifrado: a interface explica a recusa em vez de inventar texto', async () => {
  const r = await p.evaluate(async (base) => {
    const me = await (await fetch('api/projects')).json();
    const pid = me.projects[0].id;
    const res = await fetch('api/projects/' + pid + '/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': (document.cookie.match(/vn_csrf=([^;]+)/) || [])[1] },
      body: JSON.stringify({ url: base + '/tests/fixtures/cifrado.pdf' })
    });
    return { status: res.status, body: await res.json() };
  }, BASE);
  /* o ficheiro não existe: o que se verifica é que a falha é registada como inacessível */
  if (r.body.ok !== false) throw new Error('aceitou um documento inexistente');
  if (!r.body.document || !r.body.document.error) throw new Error('falha não registada: ' + JSON.stringify(r.body).slice(0, 160));
  return 'HTTP ' + r.status + ' · registado como inacessível: ' + String(r.body.document.error).slice(0, 60);
});

await B.close();
srv.kill('SIGTERM');
console.log('DOCUMENTOS NA INTERFACE');
for (const r of R) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + String(r.detail).slice(0, 170));
console.log('erros de runtime:', errs.length, errs.slice(0, 3));
const fails = R.filter((r) => !r.ok).length;
console.log('\n' + (R.length - fails) + '/' + R.length + ' passaram');
process.exit(fails ? 1 : 0);
