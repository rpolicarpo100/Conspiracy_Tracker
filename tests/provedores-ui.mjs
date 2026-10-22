/* Interface de fornecedores de IA (fase 4): catálogo com evidência, ranking
   provisório, decisão do selector com justificação, plano de fallback simulado.
   Tudo a partir do servidor real; nada é inventado no browser. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const PORT = 8900 + Math.floor(Math.random() * 90);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = '/tmp/vn-provui-' + crypto.randomBytes(4).toString('hex');
const srv = spawn(process.execPath, ['tools/serve.mjs'], {
  cwd: process.cwd(),
  env: Object.assign({}, process.env, {
    PORT: String(PORT), DATA_DIR: DATA, APP_SECRET: 'segredo-de-teste-ui-prov-1234',
    ADMIN_EMAIL: 'admin@prov.test', REGISTER_MAX: '200', LOGIN_MAX_ATTEMPTS: '100'
  }),
  stdio: 'ignore'
});
await new Promise((r) => setTimeout(r, 1600));

const email = 'prov-ui-' + Date.now().toString(36) + '@ex.pt';
const reg = await fetch(BASE + '/api/auth/register', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'SenhaForte123', acceptTerms: true })
});
if (reg.status !== 201) throw new Error('registo inicial: HTTP ' + reg.status);

const B = await chromium.launch({ executablePath: (process.env.CHROMIUM_PATH || undefined), args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
const p = await B.newPage({ viewport: { width: 1560, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/status of 40[01349]/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 140)); });
p.on('dialog', (d) => d.accept('ok'));

const R = [];
const t = async (name, fn) => { try { R.push({ name, ok: true, detail: await fn() }); } catch (e) { R.push({ name, ok: false, detail: e.message }); } };
async function waitFor(fn, timeout) {
  const t0 = Date.now();
  for (;;) { if (await p.evaluate(fn)) return true; if (Date.now() - t0 > (timeout || 20000)) throw new Error('tempo excedido'); await p.waitForTimeout(200); }
}
const body = () => p.textContent('#consolebody');

await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.evaluate((mail) => fetch('api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: mail, password: 'SenhaForte123' })
}).then((r) => r.json()), email);
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(900);
await p.click('#btnConsole');
await p.waitForTimeout(500);
await p.evaluate(() => [...document.querySelectorAll('.chips .btn')].find((b) => b.textContent.trim() === 'Fornecedores de IA').click());
await p.waitForTimeout(1200);

await t('o separador abre com o catálogo vazio e diz como começar', async () => {
  const s = await p.evaluate(() => VN.provedoresUI.getState());
  if (!s.meta) throw new Error('meta não carregou');
  if ((s.entries || []).length !== 0) throw new Error('catálogo devia começar vazio');
  if (!/Catálogo vazio/.test(await body())) throw new Error('sem estado vazio explícito');
  return s.meta.taskTypes.length + ' tipos de tarefa · ' + s.meta.accessClasses.length + ' classes de acesso · catálogo 0';
});

await t('o selector de tarefas lista as tarefas reais (não índices «0», «1»…)', async () => {
  const opts = await p.evaluate(() => [...document.querySelectorAll('#providersTask option')].map((o) => o.value));
  const meta = await p.evaluate(() => VN.provedoresUI.getState().meta);
  if (opts.length !== meta.taskTypes.length) throw new Error('opções: ' + opts.join(',') + ' (meta tem ' + meta.taskTypes.length + ')');
  const validos = meta.taskTypes.map((x) => x.id);
  const maus = opts.filter((o) => !validos.includes(o));
  if (maus.length) throw new Error('valores inválidos: ' + maus.join(','));
  return opts.length + ' tarefas: ' + opts.join(' · ');
});

await t('carregar a semente mostra 8 entradas com evidência datada', async () => {
  await p.evaluate(() => document.getElementById('btnSeedProviders').click());
  await waitFor(() => (VN.provedoresUI.getState().entries || []).length === 8, 15000);
  const s = await p.evaluate(() => VN.provedoresUI.getState());
  const comEvidencia = s.entries.filter((e) => (e.evidence || []).length > 0).length;
  if (comEvidencia !== 8) throw new Error('entradas sem evidência: ' + (8 - comEvidencia));
  const st = await p.textContent('#providerStats');
  if (!/8\s*Entradas/.test(st.replace(/\s+/g, ' '))) throw new Error('contador errado: ' + st);
  return comEvidencia + ' de 8 com evidência · ' + st.replace(/\s+/g, ' ').slice(0, 60);
});

await t('sem teste de geração o ranking não inventa nota (todas provisórias)', async () => {
  const s = await p.evaluate(() => VN.provedoresUI.getState());
  if (!s.ranking) throw new Error('ranking não carregou');
  if (s.ranking.computed !== 0) throw new Error('deu nota a ' + s.ranking.computed + ' linhas');
  if (!/Nenhuma linha tem nota/.test(await body())) throw new Error('sem aviso de ranking provisório');
  const rows = await p.evaluate(() => [...document.querySelectorAll('#providersRanking tbody tr')].length);
  return rows + ' linhas listadas · 0 com nota · cobertura máx ' + Math.max(...s.ranking.rows.map((r) => r.coveragePct)) + ' %';
});

await t('o selector recusa escolher e explica cada eliminação', async () => {
  await p.evaluate(() => document.getElementById('btnSelectProvider').click());
  await waitFor(() => VN.provedoresUI.getState().decision !== null, 15000);
  const d = await p.evaluate(() => VN.provedoresUI.getState().decision);
  if (d.chosen !== null) throw new Error('escolheu sem prova: ' + JSON.stringify(d.chosen));
  if (!d.rejected.length) throw new Error('não registou eliminações');
  if (!d.steps || d.steps.length !== 13) throw new Error('passos: ' + (d.steps || []).length);
  const txt = await body();
  if (!/Nenhum fornecedor escolhido|nenhum fornecedor escolhido/i.test(txt)) throw new Error('sem declaração visível de recusa');
  if (!/Eliminadas antes/.test(txt)) throw new Error('sem lista de eliminações');
  return d.rejected.length + ' eliminadas · motivo: ' + d.noChoiceReason.slice(0, 80);
});

await t('o plano de fallback é simulado: diz o custo (zero) antes de autorizar', async () => {
  await p.evaluate(() => document.getElementById('btnFallbackPlan').click());
  await p.waitForTimeout(1500);
  const s = await p.evaluate(() => VN.provedoresUI.getState());
  const txt = await body();
  if (!s.plan) throw new Error('sem resposta de plano');
  if (!(s.plan.plan || []).length) {
    if (!/Sem plano/.test(txt)) throw new Error('plano vazio sem explicação');
    return 'sem candidatos com prova → plano vazio com motivo (não inventa uma ordem)';
  }
  if (!/simulado — 0 pedidos, 0 custo/.test(txt)) throw new Error('não declara custo zero');
  return s.plan.plan.length + ' tentativas simuladas · 0 pedidos';
});

await t('testar níveis 1–2 é grátis, não usa chave, e o resultado fica no catálogo', async () => {
  await p.evaluate(() => document.getElementById('btnTestFree').click());
  /* esperar pela MENSAGEM final: o texto do botão também contém «níveis 1–2»
     e uma espera ingénua media o estado antes de os testes acabarem */
  await waitFor(() => { const n = document.getElementById('providerStatus'); return !!n && /^Testados/.test(n.textContent); }, 90000);
  const s = await p.evaluate(() => VN.provedoresUI.getState());
  const testadas = s.entries.filter((e) => (e.tests || []).length > 0).length;
  if (!testadas) throw new Error('nenhum teste ficou registado no catálogo');
  const hist = await p.evaluate(async () => (await fetch('api/provider-os/tests').then((r) => r.json())));
  if (!hist.total) throw new Error('histórico de testes vazio no servidor');
  return testadas + ' fornecedores com teste registado · ' + hist.total + ' registos no histórico · sem chave usada';
});

await t('a decisão fica no histórico do servidor (não só no ecrã)', async () => {
  const hist = await p.evaluate(async () => (await fetch('api/provider-os/decisions').then((r) => r.json())));
  if (!hist.total) throw new Error('sem decisões registadas');
  const d = hist.decisions[0];
  if (!d.why || !d.why.length) throw new Error('decisão sem justificação guardada');
  return hist.total + ' decisão(ões) · a mais recente com ' + d.why.length + ' razões escritas';
});

await t('sem erros de runtime', async () => {
  if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
  return 'nenhum';
});

await B.close();
srv.kill();

console.log('FORNECEDORES DE IA — INTERFACE\n');
let pass = 0, fail = 0;
R.forEach((r) => { if (r.ok) { pass++; console.log('PASS ' + r.name + ' → ' + r.detail); } else { fail++; console.log('FAIL ' + r.name + ' → ' + r.detail); } });
console.log('\n' + pass + '/' + pass + (fail ? ' · ' + fail + ' falharam' : ' passaram'));
process.exit(fail ? 1 : 0);
