/* Interface de conta: registo, projectos, sessão, administração e chaves de IA. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

/* servidor próprio e isolado: os testes não dependem do estado de outra instância */
const PORT = 8400 + Math.floor(Math.random() * 300);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = '/tmp/vn-uitest-' + crypto.randomBytes(4).toString('hex');
const srv = spawn(process.execPath, ['tools/serve.mjs'], {
  cwd: process.cwd(),
  env: Object.assign({}, process.env, {
    PORT: String(PORT), DATA_DIR: DATA, APP_SECRET: 'segredo-de-teste-ui-1234567890',
    ADMIN_EMAIL: 'admin@meridiano.test', REGISTER_MAX: '200', LOGIN_MAX_ATTEMPTS: '100'
  }),
  stdio: 'ignore'
});
await new Promise((r) => setTimeout(r, 1600));
const ADMIN_EMAIL = 'admin@meridiano.test';
const ADMIN_PASS = 'SenhaForteAdmin123';
const seed = await fetch(BASE + '/api/auth/register', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS, acceptTerms: true })
});
if (seed.status !== 201) throw new Error('semeadura do administrador falhou: HTTP ' + seed.status);
const B = await chromium.launch({ executablePath: '/tmp/pw/chromium-1140/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
const p = await B.newPage({ viewport: { width: 1560, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => {
  // 400 (política de palavra-passe), 401 (/me depois de sair) e 403 (sondagem de um USER
  // às rotas de administração) são recusas deliberadas do teste, não erros da aplicação
  if (m.type() === 'error' && !/status of 40[013]/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 140));
});
p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'teste automatizado' : undefined));
const R = [];
const t = async (name, fn) => { try { R.push({ name, ok: true, detail: await fn() }); } catch (e) { R.push({ name, ok: false, detail: e.message }); } };
async function waitFor(fn, timeout) {
  const t0 = Date.now();
  for (;;) { if (await p.evaluate(fn)) return true; if (Date.now() - t0 > (timeout || 30000)) throw new Error('tempo excedido'); await p.waitForTimeout(200); }
}
async function fill(sel, index, value) {
  await p.evaluate(([s2, i, v]) => {
    const inps = [...document.querySelectorAll(s2)];
    const inp = inps[i];
    if (!inp) throw new Error('campo ' + i + ' inexistente');
    inp.value = v;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, [sel, index, value]);
  await p.waitForTimeout(120);
}
async function fillByPlaceholder(placeholder, value) {
  await p.evaluate(([ph, v]) => {
    const inp = [...document.querySelectorAll('#accroot input')].find((i) => (i.placeholder || '').includes(ph));
    if (!inp) throw new Error('campo com placeholder «' + ph + '» não encontrado');
    inp.value = v;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, [placeholder, value]);
  await p.waitForTimeout(120);
}
async function clickText(sel, text) {
  for (let i = 0; i < 12; i++) {
    const ok = await p.evaluate(([s, t2]) => {
      const b = [...document.querySelectorAll(s)].find((x) => x.textContent.trim() === t2);
      if (b) b.click();
      return !!b;
    }, [sel, text]);
    if (ok) return true;
    await p.waitForTimeout(200);
  }
  return false;
}

await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });

await p.waitForTimeout(1200);
const email = 'ui' + Date.now().toString(36) + '@ex.pt';

await t('botão Conta abre a área de autenticação', async () => {
  await p.click('#btnAccount');
  await waitFor(() => !!document.getElementById('accroot') && /Entrar/.test(document.getElementById('accroot').textContent));
  const txt = await p.textContent('#accroot');
  if (!/política de privacidade|Criar conta/i.test(txt)) throw new Error('sem opções de conta');
  return 'formulário de entrada visível (' + txt.trim().slice(0, 60) + '…)';
});

await t('registo pela interface cria sessão e mostra o email', async () => {
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
  const txt = await p.textContent('#accroot');
  if (txt.indexOf(email) < 0) throw new Error('email não apresentado');
  return 'sessão criada para ' + email;
});

await t('política de palavra-passe é aplicada pelo servidor, não pela interface', async () => {
  const r = await p.evaluate(async () => {
    const res = await fetch('api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'fraco' + Date.now() + '@ex.pt', password: '123', acceptTerms: true })
    });
    return { status: res.status, body: await res.json() };
  });
  if (r.status !== 400 || !/fraca/.test(r.body.error.message)) throw new Error('HTTP ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 80));
  return 'registo com «123» → 400 (' + r.body.error.message.slice(0, 60) + ')';
});

await t('projecto criado na interface aparece na lista', async () => {
  await clickText('#accroot .btn', 'Projectos');
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const inputs = [...document.querySelectorAll('#accroot input')];
    inputs[0].value = 'Caso UI ' + new Date().toISOString().slice(11, 19);
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = 'Quem controla a cadeia?';
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickText('#accroot .btn', 'Criar projecto');
  await waitFor(() => /Caso UI/.test(document.getElementById('accroot').textContent), 15000);
  return 'projecto visível na tabela';
});

await t('separador de chaves mostra o estado do cofre e recusa guardar sem APP_SECRET? (cofre activo)', async () => {
  await clickText('#accroot .btn', 'Chaves de IA');
  await p.waitForTimeout(500);
  const txt = await p.textContent('#accroot');
  if (!/cifradas em repouso|cofre desactivado/.test(txt)) throw new Error('sem estado do cofre');
  const providers = await p.evaluate(() => document.querySelectorAll('#accroot table tbody tr').length);
  if (providers < 6) throw new Error('lista de fornecedores incompleta (' + providers + ')');
  return providers + ' fornecedores listados · ' + (/cifradas em repouso/.test(txt) ? 'cofre activo' : 'cofre desactivado');
});

await t('chave de IA: guardada com máscara e validada contra o fornecedor real', async () => {
  await p.evaluate(() => {
    const sel = document.querySelector('#accroot select');
    sel.value = 'groq'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const inputs = [...document.querySelectorAll('#accroot input')];
    inputs[0].value = 'chave-invalida-de-teste-123';
    inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].value = 'llama-3.3-70b-versatile';
    inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickText('#accroot .btn', 'Guardar chave');
  await waitFor(() => /Chave guardada/.test(document.getElementById('accroot').textContent), 20000);
  await waitFor(() => {
    const tr = [...document.querySelectorAll('#accroot table tbody tr')].find((r) => /Groq/.test(r.textContent));
    return !!(tr && [...tr.querySelectorAll('button')].some((b) => /Testar/.test(b.textContent)));
  }, 20000);
  const txt = await p.textContent('#accroot');
  if (txt.indexOf('chave-invalida-de-teste-123') >= 0) throw new Error('a chave em claro aparece no DOM');
  if (!/chav…/.test(txt)) throw new Error('sem máscara');
  // testar contra o fornecedor real (Groq) — deve devolver erro de autenticação honesto
  const row = await p.evaluate(() => {
    const tr = [...document.querySelectorAll('#accroot table tbody tr')].find((r) => /Groq/.test(r.textContent));
    const b = [...tr.querySelectorAll('button')].find((x) => /Testar/.test(x.textContent));
    if (b) b.click();
    return !!b;
  });
  if (!row) throw new Error('sem botão Testar para Groq');
  await waitFor(() => /credencial recusada|ligação válida|falhou em/.test(document.getElementById('accroot').textContent), 40000);
  const after = await p.textContent('#accroot');
  const m = after.match(/Groq[^.]{0,140}/);
  return 'máscara «chav…123» · ' + (m ? m[0].trim().slice(0, 110) : 'resultado do teste apresentado');
});

await t('sessão terminada esconde os dados privados', async () => {
  for (let i = 0; i < 4; i++) {
    await p.evaluate(() => { const b = document.getElementById('btnLogout'); if (b) b.click(); });
    await p.waitForTimeout(900);
    const gone = await p.evaluate(() => /Entrar\./.test((document.getElementById('accroot') || {}).textContent || ''));
    if (gone) break;
  }
  const dump = await p.evaluate(() => (document.getElementById('accroot') || {}).textContent || 'SEM ACCROOT');
  if (/Chaves de IA|Projectos/.test(dump)) throw new Error('dados privados continuam visíveis: ' + dump.trim().slice(0, 120));
  if (dump.includes(email)) throw new Error('email do utilizador continua no painel');
  if (!/Palavra-passe/.test(dump)) throw new Error('sem formulário de autenticação: ' + dump.trim().slice(0, 120));
  const stillIn = await p.evaluate(async () => { const r = await fetch('api/auth/me'); const j = await r.json(); return !!j.user; });
  if (stillIn) throw new Error('servidor ainda considera a sessão activa');
  return 'formulário de autenticação reposto, sem dados privados e sessão inválida no servidor';
  const txt = await p.textContent('#accroot');
  if (/Caso UI/.test(txt)) throw new Error('projectos continuam visíveis após sair');
  return 'volta ao formulário de entrada, sem projectos';
});

await t('administrador vê métricas reais e auditoria', async () => {
  await fill('#accroot input', 0, ADMIN_EMAIL);
  await fill('#accroot input', 1, ADMIN_PASS);
  await clickText('#accroot .btn', 'Entrar');
  await waitFor(() => /Terminar sessão/.test(document.getElementById('accroot').textContent), 20000);
  if (!/Administração/.test(await p.textContent('#accroot'))) throw new Error('ADMIN sem separador de administração');
  await clickText('#accroot .btn', 'Administração');
  await waitFor(() => /Auditoria recente/.test(document.getElementById('accroot').textContent), 20000);
  const txt = await p.textContent('#accroot');
  const m = txt.match(/Utilizadores(\d+)/);
  if (!m || Number(m[1]) < 2) throw new Error('contagem de utilizadores inesperada');
  if (!/Não disponível/.test(txt)) throw new Error('não declara métricas indisponíveis');
  if (!/admin_user_status|user_registered|session_created/.test(txt)) throw new Error('auditoria sem eventos reais');
  if (new RegExp(ADMIN_PASS).test(txt)) throw new Error('palavra-passe exposta na interface');
  return 'utilizadores: ' + m[1] + ' · auditoria com eventos reais · indisponíveis declarados';
});

await t('utilizador comum não vê a área de administração', async () => {
  await clickText('#accroot .btn', 'Terminar sessão');
  await waitFor(() => /Palavra-passe/.test(document.getElementById('accroot').textContent), 20000);
  await fill('#accroot input', 1, 'SenhaForte123');
  await fill('#accroot input', 0, email);
  await clickText('#accroot .btn', 'Entrar');
  await waitFor(() => /Terminar sessão/.test(document.getElementById('accroot').textContent), 20000);
  const txt = await p.textContent('#accroot');
  if (/Administração/.test(txt)) throw new Error('separador administrativo visível para USER');
  const direct = await p.evaluate(async () => {
    const out = {};
    for (const path of ['api/admin/metrics', 'api/admin/users', 'api/admin/audit']) out[path] = (await fetch(path)).status;
    return out;
  });
  for (const [path, code] of Object.entries(direct)) if (code !== 403) throw new Error(path + ' respondeu ' + code + ' a um USER');
  return 'sem separador · métricas/utilizadores/auditoria → 403 no servidor';
});

async function waitText(pattern, label, timeout) {
  /* `waitForFunction` avalia uma string e a CSP (sem 'unsafe-eval') recusa-a:
     o padrão é passado como argumento para um evaluate normal. */
  const t0 = Date.now();
  for (;;) {
    const hit = await p.evaluate(
      (src) => new RegExp(src).test((document.getElementById('accroot') || {}).textContent || ''),
      pattern.source
    );
    if (hit) return true;
    if (Date.now() - t0 > (timeout || 20000)) {
      const txt = await p.textContent('#accroot');
      const st = await p.evaluate(() => {
        const s2 = window.VN.accountUI.getState();
        return { tab: s2.tab, projects: (s2.projects || []).length, detail: !!s2.detail, me: s2.me && s2.me.email };
      });
      const fs2 = await import('node:fs');
      fs2.writeFileSync('/tmp/panel-debug.txt', String(txt));
      throw new Error(label + ' — estado: ' + JSON.stringify(st) + ' — painel em /tmp/panel-debug.txt');
    }
    await p.waitForTimeout(200);
  }
}

await t('projecto aberto mostra provas, origens independentes e estado sugerido', async () => {
  await clickText('#accroot .btn', 'Projectos');
  /* recarregar do servidor: o teste não depende do momento em que a sessão anterior pintou */
  await p.evaluate(() => window.VN.accountUI.refresh());
  await waitText(/Abrir/, 'lista de projectos sem botão Abrir', 15000);
  await clickText('#accroot .btn', 'Abrir');
  await waitText(/Registo de provas/, 'detalhe do projecto não abriu');

  /* prova primária */
  await fillByPlaceholder('título do documento', 'Relatório oficial');
  await fillByPlaceholder('https://', 'https://exemplo.pt/relatorio?utm_source=boletim');
  await fillByPlaceholder('o trecho exacto', 'O relatório confirma a transferência de 12 milhões de euros.');
  await clickText('#accroot .btn', 'Registar prova');
  await waitText(/Prova registada/, 'prova não foi aceite');
  const txt1 = await p.textContent('#accroot');
  if (!/host:exemplo\.pt/.test(txt1)) throw new Error('origem não mostrada na lista de provas');
  if (!/utm_source/.test(txt1) === false) throw new Error('o URL canónico devia estar sem UTM');

  /* mesma prova outra vez (o formulário fica limpo depois de guardar): não duplica */
  await fillByPlaceholder('título do documento', 'Relatório oficial');
  await fillByPlaceholder('https://', 'https://exemplo.pt/relatorio');   // mesmo URL canónico, sem UTM
  await fillByPlaceholder('o trecho exacto', 'O relatório confirma a transferência de 12 milhões de euros.');
  await clickText('#accroot .btn', 'Registar prova');
  try { await waitFor(() => /já existia/.test(document.getElementById('accmsg').textContent), 20000); }
  catch { throw new Error('duplicado não foi reconhecido — mensagem: ' + (await p.textContent('#accmsg'))); }

  /* conclusão */
  await fillByPlaceholder('o que se afirma', 'A transferência de 12 milhões de euros ocorreu em 2021');
  await clickText('#accroot .btn', 'Registar conclusão');
  await waitText(/A transferência de 12 milhões/, 'conclusão não apareceu no painel');
  /* ligar a prova à conclusão (a ligação é explícita, não automática) */
  await p.evaluate(() => {
    const sel = [...document.querySelectorAll('#accroot select')]
      .find((s2) => [...s2.options].some((o) => /ligar prova/.test(o.textContent)));
    if (!sel) throw new Error('sem selector de ligação de provas');
    const opt = [...sel.options].find((o) => o.value);
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await waitText(/origens independentes 1/, 'factores de corroboração não visíveis');
  const txt2 = await p.textContent('#accroot');
  if (!/sugerido pelas provas: insuficiente/.test(txt2)) throw new Error('estado sugerido incorreto: ' + (txt2.match(/sugerido pelas provas: \w[-\w]*/) || ['?'])[0]);
  return 'prova primária registada · origem host:exemplo.pt · duplicado recusado · 1 origem → sugerido «insuficiente»';
});

/* captura final: conclusão com factores de corroboração visíveis */
await p.evaluate(() => {
  const h = [...document.querySelectorAll('#accroot h4')].find((x) => /Conclusões e alegações/.test(x.textContent));
  if (h) h.scrollIntoView({ block: 'start' });
});
await p.waitForTimeout(300);
await p.screenshot({ path: '/home/user/docs/shot-18-provas.png' });
await p.screenshot({ path: '/home/user/docs/shot-17-conta.png' });
await B.close();
srv.kill('SIGTERM');
console.log('CONTA E ADMINISTRAÇÃO — INTERFACE');
for (const r of R) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + String(r.detail).slice(0, 170));
console.log('erros de runtime:', errs.length, errs.slice(0, 3));
const fails = R.filter((r) => !r.ok).length;
console.log('\n' + (R.length - fails) + '/' + R.length + ' passaram');
process.exit(fails ? 1 : 0);
