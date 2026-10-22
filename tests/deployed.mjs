/* Verificação do site publicado (Render). Uso: node tests/deployed.mjs https://conspiracy-aitracker.onrender.com */
import { chromium } from 'playwright';
import { entrarNaAplicacao } from './_ui-entrada.mjs';

/* A aplicação publicada exige sessão desde a fase 9. As credenciais vêm do
   ambiente, nunca do repositório: VN_DEPLOY_EMAIL / VN_DEPLOY_PASSWORD.
   Sem elas, este script declara que não pode verificar em vez de falhar por
   motivos errados. */
const URL_APP = process.argv[2] || 'https://conspiracy-aitracker.onrender.com';
const DEPLOY_EMAIL = process.env.VN_DEPLOY_EMAIL || '';
const DEPLOY_PASS = process.env.VN_DEPLOY_PASSWORD || '';
const B = await chromium.launch({ executablePath: (process.env.CHROMIUM_PATH || undefined), args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
const p = await B.newPage({ viewport: { width: 1560, height: 980 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 160)); });
const R = [];
const t = async (name, fn) => { try { R.push({ name, ok: true, detail: await fn() }); } catch (e) { R.push({ name, ok: false, detail: e.message }); } };
async function waitFor(fn, timeout) {
  const t0 = Date.now();
  for (;;) { if (await p.evaluate(fn)) return true; if (Date.now() - t0 > (timeout || 60000)) throw new Error('tempo excedido'); await p.waitForTimeout(300); }
}

await p.goto(URL_APP, { waitUntil: 'networkidle', timeout: 90000 });
await p.waitForTimeout(1500);

/* a porta de entrada tem de estar lá, e o resto do corpo escondido */
await t('porta de entrada presente e corpo privado escondido', async () => {
  const st = await p.evaluate(() => ({
    auth: document.documentElement.getAttribute('data-vn-auth'),
    gate: !!document.getElementById('vnGate'),
    campos: !!document.getElementById('gateEmail') && !!document.getElementById('gatePassword')
  }));
  if (!st.gate || !st.campos) throw new Error('porta ausente na versão publicada');
  if (st.auth !== 'por-autenticar') throw new Error('estado da porta: ' + st.auth);
  return 'porta visível · data-vn-auth=por-autenticar';
});

if (!DEPLOY_EMAIL || !DEPLOY_PASS) {
  console.log('SKIP restantes verificações: sem VN_DEPLOY_EMAIL/VN_DEPLOY_PASSWORD no ambiente');
  for (const r of R) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + r.detail);
  await B.close();
  process.exit(R.some((r) => !r.ok) ? 1 : 0);
}
await entrarNaAplicacao(p, URL_APP, DEPLOY_EMAIL, DEPLOY_PASS);

await t('mapa carrega com semente e legenda', async () => {
  const st = await p.evaluate(() => ({
    canvas: !!document.querySelector('#cy canvas'),
    status: (document.querySelector('#status, .statusbar') || {}).textContent || '',
    legend: (document.querySelector('#legend') || {}).textContent || '',
    entities: VN.app.ctx.model.entities.length, relations: VN.app.ctx.model.relations.length,
    fictional: VN_DATA.meta.fictional
  }));
  if (!st.canvas) throw new Error('canvas do grafo ausente');
  if (st.entities < 10 || st.relations < 10) throw new Error('modelo: ' + st.entities + '/' + st.relations);
  if (st.fictional !== false) throw new Error('o conjunto carregado não é real');
  return 'grafo visível · ' + st.entities + ' entidades / ' + st.relations + ' relações · ' + st.status.trim().slice(0, 48);
});

await t('pesquisa profunda responde na versão publicada', async () => {
  await p.click('#search');
  await p.fill('#search', 'epstain');
  await p.waitForTimeout(900);
  const rows = await p.evaluate(() => document.querySelectorAll('#searchresults .sresult').length);
  const txt = await p.evaluate(() => (document.getElementById('searchresults') || {}).textContent || '');
  if (!rows) throw new Error('paleta sem resultados');
  if (!/epstein/i.test(txt)) throw new Error('sem sugestão aproximada');
  return rows + ' resultados · correcção «epstain → Epstein» na versão publicada';
});

await t('agente local (/api/fetch) funciona no servidor público', async () => {
  const r = await p.evaluate(async () => {
    const runner = VN.agents.createRunner({ transport: 'proxy', proxyUrl: new URL('api/fetch', location.href).href });
    const out = await runner.run([{ id: 'deploy', url: 'https://dados.gov.pt/api/1/datasets/?page_size=1', source: 'deploy' }], { dryRun: false });
    const x = out.results[0];
    return { status: x.status, http: x.evidence && x.evidence.httpStatus, bytes: x.evidence && x.evidence.contentLength, hash: x.evidence && x.evidence.sha256Agrees, err: x.error };
  });
  if (r.status !== 'recolhida') throw new Error(r.status + ': ' + r.err);
  if (r.hash !== true) throw new Error('hash não confirmado');
  return 'HTTP ' + r.http + ' · ' + r.bytes + ' B · hash confirmado dos dois lados';
});

await t('separador APIs audita uma API a partir do servidor público', async () => {
  await p.keyboard.press('Escape');
  await p.click('#btnConsole');
  await p.waitForTimeout(500);
  await p.evaluate(() => [...document.querySelectorAll('.chips .btn')].find((b) => b.textContent.trim() === 'APIs').click());
  await p.waitForTimeout(600);
  await p.evaluate(() => {
    const row = [...document.querySelectorAll('#apisroot table tbody tr')].find((tr) => /VIES/.test(tr.textContent));
    row.querySelector('button').click();
  });
  await waitFor(() => /Segurança/.test(document.getElementById('apisroot').textContent), 120000);
  const pills = await p.evaluate(() => [...document.querySelectorAll('#apisroot .scorepill')].slice(0, 3).map((x) => x.textContent));
  if (pills.length < 3) throw new Error('sem pontuações');
  return 'VIES: seg ' + pills[0] + ' · fia ' + pills[1] + ' · uti ' + pills[2];
});

await t('/api/fetch recusa origem externa (proxy não é aberto)', async () => {
  // o navegador não deixa forjar Origin; o teste é feito fora do navegador
  const res = await fetch(new URL('api/fetch', URL_APP).href, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://exemplo-malicioso.test' },
    body: JSON.stringify({ url: 'https://dados.gov.pt/api/1/datasets/?page_size=1' })
  });
  if (res.status !== 403) throw new Error('respondeu HTTP ' + res.status + ' (esperado 403)');
  const body = await res.json().catch(() => ({}));
  return 'HTTP 403 · ' + String(body.error || '').slice(0, 60);
});

await t('endereço interno recusado no servidor público (SSRF)', async () => {
  const res = await fetch(new URL('api/fetch', URL_APP).href, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/', source: 'teste' })
  });
  const data = await res.json();
  if (data.result.status !== 'recusada') throw new Error('aceitou: ' + JSON.stringify(data.result).slice(0, 120));
  return data.result.error;
});

await p.screenshot({ path: '/home/user/docs/shot-16-deploy.png' });
await B.close();
console.log('SITE PUBLICADO · ' + URL_APP);
for (const r of R) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + String(r.detail).slice(0, 170));
console.log('erros de runtime:', errs.length, errs.slice(0, 3));
const fails = R.filter((r) => !r.ok).length;
console.log('\n' + (R.length - fails) + '/' + R.length + ' passaram');
process.exit(fails ? 1 : 0);
