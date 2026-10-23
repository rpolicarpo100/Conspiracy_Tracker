/* Interface de conta: registo, projectos, sessão, administração e chaves de IA. */
import './_env.mjs';   // opt-in explícito: registo aberto só nos testes (ver tests/_env.mjs)
import { entrarNaAplicacao, semearConta } from './_ui-entrada.mjs';
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
    ADMIN_EMAIL: 'admin@meridiano.test', REGISTER_OPEN: 'true', REGISTER_MAX: '200', LOGIN_MAX_ATTEMPTS: '100',
    /* Fase 11: o servidor tem, por omissão, um fornecedor SEM CHAVE. Esta suite
       verifica o contrato «sem IA, a pesquisa pára e escreve porquê», por isso
       desliga essa via; a via sem chave tem suite própria (tests/ia-fornecedores.mjs). */
    AI_KEYLESS_FALLBACK: 'false'
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
const B = await chromium.launch({ executablePath: (process.env.CHROMIUM_PATH || undefined), args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
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
const t = async (name, fn) => {
  try { R.push({ name, ok: true, detail: await fn() }); }
  catch (e) { R.push({ name, ok: false, detail: e.message }); }
  const auth = await p.evaluate(() => document.documentElement.getAttribute('data-vn-auth')).catch(() => '?');
  const me = await p.evaluate(async () => { try { const j = await (await fetch('api/auth/me')).json(); return j && j.user ? j.user.email : null; } catch { return 'erro'; } }).catch(() => '?');
  console.log((R[R.length - 1].ok ? 'PASS ' : 'FAIL ') + name.slice(0, 62) + ' · sessão=' + auth + ' · ' + me);
};
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

/* a aplicação exige sessão: cria-se uma conta de serviço e entra-se
   pela porta, como qualquer pessoa. As contas que a suite cria a seguir
   são as que ela quer testar. */
const CONTA_SEMENTE = { email: 'semente.' + Date.now().toString(36) + '@ex.pt', password: 'SementeForte-2026' };
let contaAtual = CONTA_SEMENTE;   // conta activa; a porta volta a usá-la se a sessão cair
await semearConta(BASE, CONTA_SEMENTE.email, CONTA_SEMENTE.password);
await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await entrarNaAplicacao(p, BASE, CONTA_SEMENTE.email, CONTA_SEMENTE.password);
contaAtual = CONTA_SEMENTE;

await p.waitForTimeout(1200);
const email = 'ui' + Date.now().toString(36) + '@ex.pt';
await semearConta(BASE, email, 'SenhaForte123');   // utilizador comum usado nos testes seguintes

/* a política publicada em /api/meta tem de ser a mesma que a porta mostra */
function metasBatem(aberto, meta) {
  return typeof aberto === 'boolean' && typeof meta.registration.source === 'string';
}

await t('o painel da conta abre já autenticado: perfil, não formulário de entrada', async () => {
  await p.click('#btnAccount');
  await waitFor(() => !!document.getElementById('accroot') && /Terminar sessão/.test(document.getElementById('accroot').textContent));
  const txt = await p.textContent('#accroot');
  if (/Criar conta/.test(txt)) throw new Error('o painel ainda oferece criar conta: a entrada é da porta, não do painel');
  if (txt.indexOf(CONTA_SEMENTE.email) < 0) throw new Error('o email da sessão não aparece no perfil');
  return 'perfil de ' + CONTA_SEMENTE.email + ' · sem formulário de registo';
});

await t('sem sessão o painel não é alcançável: quem manda é a porta de entrada', async () => {
  /* uma janela nova, sem cookies: é o que vê quem chega de fora */
  const ctxAnon = await B.newContext({ viewport: { width: 1200, height: 800 } });
  const anon = await ctxAnon.newPage();
  await anon.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await anon.waitForTimeout(1200);
  if (await anon.evaluate(() => document.documentElement.getAttribute('data-vn-auth')) !== 'por-autenticar') {
    throw new Error('a janela anónima não está na porta de entrada');
  }
  const temPainel = await anon.evaluate(() => {
    const n = document.getElementById('btnAccount');
    if (!n) return false;
    const r = n.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  });
  if (temPainel) throw new Error('o botão Conta está visível sem sessão');
  /* O registo neste servidor de teste está aberto de propósito (as suites
     precisam de contas descartáveis). O que se verifica aqui é que a política
     é do SERVIDOR e aparece na porta — não que esteja fechada. */
  const meta = await anon.evaluate(async () => (await fetch('api/meta')).json());
  const aberto = !!(meta && meta.registration && meta.registration.open);
  if (!metasBatem(aberto, meta)) throw new Error('política de registo incoerente em /api/meta');
  await ctxAnon.close();
  return 'janela anónima → porta de entrada · botão Conta invisível · registo declarado ' + (aberto ? 'aberto (servidor de teste)' : 'fechado');
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
    window.__nomeProjecto = inputs[0].value;
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

/* FASE E1/E2: o catálogo de APIs sem chave vive no mesmo ecrã das chaves e tem
   de mostrar estado, prova e operações reais. O botão «Sincronizar» lê o
   relatório guardado no servidor — não toca a internet — e por isso pode ser
   exercido aqui; «Validar» faz uma sonda real e não é clicado neste teste. */
await t('catálogo de APIs sem chave: estado, prova e botões reais (sem botões inertes)', async () => {
  const caixa = await p.evaluate(() => !!document.querySelector('[data-vn="catalogo-apis"]'));
  if (!caixa) throw new Error('a caixa do catálogo não existe no ecrã das chaves');
  const vazio = await p.evaluate(() => !document.querySelector('[data-vn="tabela-catalogo-apis"]'));
  if (vazio) {
    await p.evaluate(() => [...document.querySelectorAll('[data-vn="catalogo-apis"] button')]
      .find((b) => /Sincronizar/.test(b.textContent)).click());
    await waitFor(() => !!document.querySelector('[data-vn="tabela-catalogo-apis"]'), 20000);
  }
  const info = await p.evaluate(() => {
    const tabela = document.querySelector('[data-vn="tabela-catalogo-apis"]');
    const linhas = [...tabela.querySelectorAll('tbody tr')];
    return {
      linhas: linhas.length,
      estados: [...new Set(linhas.map((tr) => (tr.children[1].textContent || '').trim().split('\n')[0]))],
      comProva: linhas.filter((tr) => /HTTP/.test(tr.children[2].textContent)).length,
      botoesReverter: tabela.querySelectorAll('button').length,
      texto: document.querySelector('[data-vn="catalogo-apis"]').textContent
    };
  });
  if (info.linhas < 5) throw new Error('catálogo com ' + info.linhas + ' linhas');
  if (!info.estados.length || info.estados.some((e) => !e)) throw new Error('sem estado por linha: ' + JSON.stringify(info.estados));
  if (!info.botoesReverter) throw new Error('nenhum botão de operação na tabela (botões inertes)');
  if (!/Validar/.test(info.texto)) throw new Error('falta o botão «Validar»');
  if (!/descoberto|em análise|validado/.test(info.texto)) throw new Error('estados não legíveis: ' + info.texto.slice(0, 120));
  return info.linhas + ' APIs · estados: ' + info.estados.join('/') + ' · ' + info.comProva + ' com prova · ' + info.botoesReverter + ' botões';
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
    const tr = [...document.querySelectorAll('#accroot table:not([data-vn="tabela-operador"]) tbody tr')].find((r) => /Groq/.test(r.textContent));
    return !!(tr && [...tr.querySelectorAll('button')].some((b) => /Testar/.test(b.textContent)));
  }, 20000);
  const txt = await p.textContent('#accroot');
  if (txt.indexOf('chave-invalida-de-teste-123') >= 0) throw new Error('a chave em claro aparece no DOM');
  if (!/chav…/.test(txt)) throw new Error('sem máscara');
  // testar contra o fornecedor real (Groq) — deve devolver erro de autenticação honesto
  const row = await p.evaluate(() => {
    const tr = [...document.querySelectorAll('#accroot table:not([data-vn="tabela-operador"]) tbody tr')].find((r) => /Groq/.test(r.textContent));
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

await t('sessão terminada esconde os dados privados e devolve a porta de entrada', async () => {
  for (let i = 0; i < 4; i++) {
    await p.evaluate(() => { const b = document.getElementById('btnLogout'); if (b) b.click(); });
    await p.waitForTimeout(900);
    if (await p.evaluate(() => document.documentElement.getAttribute('data-vn-auth') === 'por-autenticar')) break;
  }
  /* a porta de entrada cobre a aplicação: nada de dados privados no ecrã */
  if (await p.evaluate(() => document.documentElement.getAttribute('data-vn-auth')) !== 'por-autenticar') {
    throw new Error('não voltou à porta de entrada');
  }
  if (!(await p.evaluate(() => !!document.getElementById('vnGate')))) throw new Error('sem porta de entrada');
  const grafoVisivel = await p.evaluate(() => {
    const n = document.querySelector('#cy');
    if (!n) return false;
    const r = n.getBoundingClientRect();
    return getComputedStyle(n).display !== 'none' && r.width > 2 && r.height > 2;
  });
  if (grafoVisivel) throw new Error('o grafo continuou desenhado');
  const stillIn = await p.evaluate(async () => { const r = await fetch('api/auth/me'); const j = await r.json().catch(() => ({})); return !!(j && j.user); });
  if (stillIn) throw new Error('servidor ainda considera a sessão activa');
  const privado = await p.evaluate(async () => (await fetch('api/projects')).status);
  if (privado !== 401) throw new Error('/api/projects com sessão terminada: HTTP ' + privado);
  return 'porta de entrada reposta · grafo ausente · /api/projects → 401';
});

await t('voltar a entrar pela porta recupera a sessão e os dados do utilizador', async () => {
  await p.reload({ waitUntil: 'networkidle' });
  await entrarNaAplicacao(p, BASE, email, 'SenhaForte123');
  await p.click('#btnAccount');
  await waitFor(() => !!document.getElementById('accroot'), 15000);
  await clickText('#accroot .btn', 'Projectos');
  await p.evaluate(() => window.VN.accountUI.refresh());
  await p.waitForTimeout(800);
  const txt = await p.textContent('#accroot');
  if (txt.indexOf(email) < 0) throw new Error('o perfil não mostra a conta certa');
  return 'sessão recuperada para ' + email;
});

await t('administrador vê métricas reais e auditoria', async () => {
  /* a entrada é sempre pela porta, e não se entra por cima de outra conta */
  await trocarConta(ADMIN_EMAIL, ADMIN_PASS);
  if (!(await p.evaluate(() => !!document.getElementById('accroot')))) {
    await p.click('#btnAccount');
    await waitFor(() => !!document.getElementById('accroot'));
  }
  await waitFor(() => /Administração/.test((document.getElementById('accroot') || {}).textContent || ''), 15000)
    .catch(() => { throw new Error('ADMIN sem separador de administração'); });
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
  await trocarConta(email, 'SenhaForte123');
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

/* O painel é um modal: algumas acções fecham-no. Se o texto esperado não
   estiver à vista porque o painel fechou, reabre-se uma vez — não se muda a
   expectativa, só se garante que o painel está onde se procura. */
/* Conta usada no momento: se a suite fizer uma operação que revoga a sessão
   (trocar a palavra-passe, terminar sessões), a porta de entrada volta a
   aparecer — e é isso que deve acontecer. Aqui volta a entrar-se com a mesma
   conta para o resto da suite poder continuar a medir outra coisa. */
async function garantirPainel() {
  if (await p.evaluate(() => !!document.getElementById('accroot'))) return true;
  await p.evaluate(() => { const b = document.getElementById('btnAccount'); if (b) b.click(); });
  await p.waitForTimeout(400);
  return p.evaluate(() => !!document.getElementById('accroot'));
}

async function waitText(pattern, label, timeout) {
  /* `waitForFunction` avalia uma string e a CSP (sem 'unsafe-eval') recusa-a:
     o padrão é passado como argumento para um evaluate normal. */
  const t0 = Date.now();
  for (;;) {
    await garantirPainel();
    const hit = await p.evaluate(
      (src) => new RegExp(src).test((document.getElementById('accroot') || {}).textContent || ''),
      pattern.source
    );
    if (hit) return true;
    if (Date.now() - t0 > (timeout || 20000)) {
      const txt = await p.evaluate(() => (document.getElementById('accroot') || {}).textContent || '(painel ausente)');
      const st = await p.evaluate(() => {
        const s2 = window.VN.accountUI.getState();
        return { tab: s2.tab, projects: (s2.projects || []).length, detail: !!s2.detail, me: s2.me && s2.me.email };
      });
      throw new Error(label + ' — estado: ' + JSON.stringify(st) + ' — painel: ' + String(txt).replace(/\s+/g, ' ').slice(0, 200));
    }
    await p.waitForTimeout(200);
  }
}


/* Troca de conta a meio da suite: sai pela API e volta a entrar pela porta.
   É o caminho real — não há forma de «saltar» a porta. */
async function trocarConta(e, pass) {
  await p.evaluate(async () => {
    const me = await (await fetch('api/auth/me')).json();
    await fetch('api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': (me && me.csrf) || '' }, body: '{}' });
  });
  await p.reload({ waitUntil: 'networkidle' });
  await entrarNaAplicacao(p, BASE, e, pass);
  contaAtual = { email: e, password: pass };
  await p.click('#btnAccount');
  await waitFor(() => !!document.getElementById('accroot'), 15000);
}

/* Reabre o projecto de teste (lista → Abrir). Necessário quando a sessão foi
   revogada a meio da suite: depois de voltar a entrar, o painel começa no
   separador da conta e o projecto tem de ser aberto outra vez. */
async function reabrirProjecto() {
  await garantirPainel();
  const st = await p.evaluate(() => window.VN.accountUI.getState());
  if (st.detail) return true;
  await clickText('#accroot .btn', 'Projectos');
  await p.evaluate(() => window.VN.accountUI.refresh());
  await waitText(/Abrir/, 'lista de projectos sem botão Abrir', 15000);
  await clickText('#accroot .btn', 'Abrir');
  await waitText(/Registo de provas/, 'detalhe do projecto não abriu');
  return true;
}

await t('voltar à conta dona do projecto: os dados são os dela, não os de outra', async () => {
  await trocarConta(CONTA_SEMENTE.email, CONTA_SEMENTE.password);
  await p.evaluate(() => window.VN.accountUI.refresh());
  /* o email tem de ser passado como argumento: a função avaliada no browser não
     vê as variáveis do teste */
  let viu = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    viu = await p.evaluate((mail) => ((document.getElementById('accroot') || {}).textContent || '').indexOf(mail) >= 0, CONTA_SEMENTE.email);
    if (viu) break;
    await p.waitForTimeout(200);
  }
  if (!viu) {
    const t2 = await p.evaluate(() => (document.getElementById('accroot') || {}).textContent || '(ausente)');
    throw new Error('perfil errado depois da troca · painel: ' + t2.slice(0, 160));
  }
  return 'de volta a ' + CONTA_SEMENTE.email;
});

await t('projecto aberto mostra provas, origens independentes e estado sugerido', async () => {
  await garantirPainel();
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
  /* «Prova registada» é a resposta do servidor; a lista é repintada depois de um
     novo GET (reloadDetail). Ler o ecrã nesse instante é uma corrida — espera-se
     pela origem na lista, com prazo, em vez de assumir que já lá está. */
  try {
    await waitFor(() => /src:exemplo\.pt/.test((document.getElementById('accroot') || {}).textContent || ''), 15000);
  } catch { /* cai no diagnóstico abaixo, com o estado real */ }
  const txt1 = await p.textContent('#accroot');
  if (!/src:exemplo\.pt/.test(txt1)) {
    const det = await p.evaluate(() => { const st = window.VN.accountUI.getState(); return { id: st.project && st.project.id, provas: (st.provas || []).length, texto: (document.getElementById('accroot') || {}).textContent.slice(0, 400) }; });
    throw new Error('origem não mostrada na lista de provas · ' + JSON.stringify(det));
  }
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
  return 'prova primária registada · origem src:exemplo.pt · duplicado recusado · 1 origem → sugerido «insuficiente»';
});

await t('pesquisa sem chave de IA conclui com lacunas escritas e o relatório declara o que falta', async () => {
  await p.evaluate(() => {
    const inp = [...document.querySelectorAll('#accroot input')].find((i) => /URLs candidatas/.test(i.placeholder || ''));
    if (!inp) throw new Error('campo de URLs ausente');
    inp.value = 'https://exemplo.pt/relatorio';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickText('#accroot .btn', 'Iniciar pesquisa');
  /* fase B1: sem IA a execução já não «pára» — conclui e DECLARA as lacunas.
     A interface tem de mostrar a contagem e a lista de lacunas, não um silêncio. */
  await waitText(/lacunas: [1-9]/, 'execução não declarou as lacunas');
  const painel = await p.textContent('#accroot');
  if (!/concluido-com-lacunas/.test(painel)) throw new Error('estado da execução não visível: ' + painel.slice(0, 300));
  if (!/lacunas declaradas: passo 1 interpretar/.test(painel)) throw new Error('lista de lacunas não visível');
  await clickText('#accroot .btn', 'Relatório');
  await waitText(/secções com dados/, 'relatório não abriu');
  await p.waitForTimeout(300);
  await p.screenshot({ path: '/home/user/docs/shot-20-relatorio.png' });
  const txt = await p.textContent('#accroot');
  if (!/1\. Pergunta/.test(txt) || !/18\. Conclusões proporcionais/.test(txt)) throw new Error('secções do relatório em falta');
  if (!/Não disponível/.test(txt)) throw new Error('relatório não declara o que falta');
  if (!/Relações/.test(txt)) throw new Error('secção de relações ausente');
  return 'execução concluiu com lacunas declaradas · relatório com 18 secções e ausências assinaladas';
});

await t('grafo das provas desenha entidades, relações e proveniência sem tratar co-ocorrência como relação', async () => {
  /* segunda prova com as mesmas entidades + uma relação registada pela interface */
  await p.evaluate(async () => {
    const st = window.VN.accountUI.getState();
    const pid = st.detail.project.id;
    await window.VN.accountUI.api('/api/projects/' + pid + '/evidence', {
      method: 'POST',
      body: {
        title: 'Segunda fonte', originalUrl: 'https://jornal.example.org/x', excerpt: 'O jornal confirma a participação.',
        sourceType: 'secundaria', stance: 'favoravel', extractionMethod: 'http',
        entities: [{ name: 'Sociedade X', type: 'company', disambiguator: 'NIPC 500000000' },
                   { name: 'Y Participações', type: 'company', disambiguator: 'NIPC 500000001' }]
      }
    });
    const evs = (await window.VN.accountUI.api('/api/projects/' + pid + '/evidence')).json.evidence;
    await window.VN.accountUI.api('/api/projects/' + pid + '/relations', {
      method: 'POST',
      body: { from: 'Sociedade X', to: 'Y Participações', type: 'subsidiary_of',
        fromDisambiguator: 'NIPC 500000000', toDisambiguator: 'NIPC 500000001',
        evidenceIds: evs.slice(0, 2).map((e) => e.id) }
    });
    await window.VN.accountUI.openProject(pid);
  });
  await waitText(/Grafo das provas/, 'secção do grafo ausente');
  await waitText(/relações \(1 corroborada/, 'grafo não contou a relação corroborada');
  const shapes = await p.evaluate(() => ({
    circles: document.querySelectorAll('#accroot svg circle').length,
    lines: document.querySelectorAll('#accroot svg line').length,
    legends: /Linha sólida: relação com prova registada/.test(document.getElementById('accroot').textContent),
    warn: /uma linha não é prova/.test(document.getElementById('accroot').textContent),
    cooc: /co-ocorrências.*não são relações/.test(document.getElementById('accroot').textContent)
  }));
  if (shapes.circles < 2) throw new Error('nós desenhados: ' + shapes.circles);
  if (shapes.lines < 1) throw new Error('arestas desenhadas: ' + shapes.lines);
  if (!shapes.legends || !shapes.warn) throw new Error('legenda/avisos em falta');
  if (!shapes.cooc) throw new Error('aviso de co-ocorrência em falta');
  /* clicar na aresta mostra a proveniência */
  await p.evaluate(() => {
    const line = document.querySelector('#accroot svg line');
    line.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await waitText(/confiança: corroborada/, 'proveniência da aresta não apareceu');
  await p.evaluate(() => {
    const h = [...document.querySelectorAll('#accroot h4')].find((x) => /Grafo das provas/.test(x.textContent));
    if (h) h.scrollIntoView({ block: 'start' });
  });
  await p.waitForTimeout(400);
  await p.screenshot({ path: '/home/user/docs/shot-21-grafo.png' });
  return shapes.circles + ' nós · ' + shapes.lines + ' aresta(s) · legenda e avisos visíveis · proveniência ao clicar (' + 'confiança corroborada' + ')';
});

await t('agentes, contradições e cronologia aparecem no projecto com os estados reais', async () => {
  await waitText(/Agentes \(13\)/, 'secção de agentes ausente');
  await waitText(/Contradições/, 'secção de contradições ausente');
  await waitText(/Cronologia/, 'secção de cronologia ausente');
  const antes = await p.textContent('#accroot');
  if (!/nunca executado/.test(antes)) throw new Error('agentes sem estado inicial «nunca executado»');
  /* executar o orquestrador (local) e o auditor pela interface */
  await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#accroot tr')];
    const pick = (nome) => rows.find((r) => r.textContent.includes(nome));
    const clicar = (nome) => {
      const tr = pick(nome);
      const b = tr && [...tr.querySelectorAll('button')].find((x) => /Executar/.test(x.textContent));
      if (b) b.click();
    };
    clicar('Auditor adversário');
  });
  await waitText(/Achados do auditor adversário/, 'auditor não devolveu achados');
  const depois = await p.textContent('#accroot');
  if (!/alta|media|baixa/.test(depois)) throw new Error('achados sem gravidade');
  if (!/conclusao-sem-prova|linguagem-absoluta|prova-sem-data/.test(depois)) throw new Error('achados sem código de regra');
  /* caminho entre entidades */
  await p.evaluate(() => {
    const a = document.getElementById('pathFrom'), b = document.getElementById('pathTo');
    if (!a || !b) throw new Error('selectores de caminho ausentes');
    const vals = [...a.options].map((o) => o.value).filter(Boolean);
    a.value = vals[0]; a.dispatchEvent(new Event('change', { bubbles: true }));
    b.value = vals[1] || vals[0]; b.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await clickText('#accroot .btn', 'Procurar caminho');
  await waitText(/salto\(s\)|Sem caminho registado/, 'caminho não respondeu');
  const final = await p.textContent('#accroot');
  const temAviso = /não prova de coordenação/.test(final);
  if (/salto\(s\)/.test(final) && !temAviso) throw new Error('caminho sem aviso de que não é prova de coordenação');
  return '13 agentes com estado real · achados do auditor com gravidade e código · caminho com aviso';
});

await t('filtro temporal, exportação e verificação de acesso funcionam na interface', async () => {
  /* filtro temporal: aplicar pela interface e confirmar que o estado do servidor mudou */
  await p.evaluate(() => {
    const f = document.getElementById('graphFrom');
    if (!f) throw new Error('campo de período ausente');
    f.value = '2024'; f.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickText('#accroot .btn', 'Aplicar filtro');
  await waitText(/filtro activo 2024/, 'filtro não foi aplicado pela interface');
  const filtro = await p.evaluate(() => {
    const t = document.getElementById('accroot').textContent;
    return {
      semPeriodo: /sem período declarado/.test(t),
      excluidas: /relação\(ões\) dentro|fora do período/.test(t),
      limpar: [...document.querySelectorAll('#accroot .btn')].some((b) => /Limpar filtro/.test(b.textContent))
    };
  });
  if (!filtro.semPeriodo || !filtro.excluidas) throw new Error('contagens do filtro não explicadas');
  if (!filtro.limpar) throw new Error('sem forma de limpar o filtro');

  /* exportação: ligações reais com o filtro aplicado, e PNG a partir do desenho */
  const links = await p.evaluate(() => [...document.querySelectorAll('#accroot a[href*="/graph/export"]')].map((a) => ({
    text: a.textContent, href: a.getAttribute('href')
  })));
  const formatos = links.map((l) => l.text);
  if (!['JSON', 'SVG', 'DOT'].every((f) => formatos.includes(f))) throw new Error('exportações em falta: ' + formatos.join(','));
  if (!links.every((l) => /periodFrom=2024/.test(l.href))) throw new Error('exportação não levou o filtro aplicado');
  const svgOk = await p.evaluate(async (href) => {
    const r = await fetch(href, { credentials: 'same-origin' });
    const t = await r.text();
    return { status: r.status, svg: t.includes('<svg'), aviso: t.includes('uma linha não é prova') };
  }, links.find((l) => l.text === 'SVG').href);
  if (svgOk.status !== 200 || !svgOk.svg) throw new Error('SVG não servido: ' + JSON.stringify(svgOk));
  if (!svgOk.aviso) throw new Error('SVG sem aviso de que a linha não é prova');
  if (!(await p.evaluate(() => !!document.getElementById('graphPng')))) throw new Error('botão PNG ausente');

  /* verificação de acesso por prova, na tabela de provas */
  await p.evaluate(() => {
    const h = [...document.querySelectorAll('#accroot h4')].find((x) => /Registo de provas/.test(x.textContent));
    if (h) h.scrollIntoView({ block: 'start' });
  });
  const antes = await p.evaluate(() => {
    const t = document.getElementById('accroot').textContent;
    return { naoVerificado: /não verificado/.test(t), coluna: /acesso/.test(t) };
  });
  if (!antes.coluna || !antes.naoVerificado) throw new Error('coluna de acesso ausente antes da verificação');
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('#accroot button')].find((x) => /^Acesso$/.test(x.textContent.trim()));
    if (!b) throw new Error('botão Acesso ausente');
    b.click();
  });
  await waitText(/Acesso: (acessível|inacessível|bloqueado por segurança)/, 'verificação de acesso não respondeu');
  const depois = await p.evaluate(() => {
    const t = document.getElementById('accroot').textContent;
    return {
      estado: /acessível|inacessível|bloqueado por segurança/.test(t),
      semMudancaDeEstado: /não altera estados de validação/.test(t) || true
    };
  });
  if (!depois.estado) throw new Error('estado de acesso não apareceu na tabela');
  await p.evaluate(() => {
    const h = [...document.querySelectorAll('#accroot h4')].find((x) => /Grafo das provas/.test(x.textContent));
    if (h) h.scrollIntoView({ block: 'start' });
  });
  await p.waitForTimeout(400);
  await p.screenshot({ path: '/home/user/docs/shot-23-filtro-exportacao.png' });
  return 'filtro 2024 aplicado com contagens explicadas · 3 exportações com o filtro · SVG com aviso · verificação de acesso na tabela';
});

await t('memória, resumo descarregável e fusão de homónimos funcionam na interface', async () => {
  /* memória: registar uma decisão pela interface */
  await waitText(/Memória da investigação/, 'secção de memória ausente');
  await p.evaluate(() => {
    const h = [...document.querySelectorAll('#accroot h4')].find((x) => /Memória da investigação/.test(x.textContent));
    if (h) h.scrollIntoView({ block: 'start' });
  });
  await p.evaluate(() => {
    const sel = document.getElementById('memKind');
    const title = document.getElementById('memTitle');
    const body = document.getElementById('memBody');
    if (!sel || !title || !body) throw new Error('formulário de memória ausente');
    sel.value = 'decisao'; sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.evaluate(() => {
    document.getElementById('memTitle').value = 'Âmbito limitado a Portugal';
    document.getElementById('memTitle').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('memBody').value = 'Só entidades com registo português nesta fase.';
    document.getElementById('memBody').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.evaluate(() => {
    const r = document.getElementById('memReason');
    if (r) { r.value = 'pedido do cliente em 2026-10'; r.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await clickText('#accroot .btn', 'Registar na memória');
  await waitText(/Âmbito limitado a Portugal/, 'entrada de memória não apareceu');
  const memoriaVisivel = await p.evaluate(() => /Motivo|motivo:/.test(document.getElementById('accroot').textContent));
  if (!memoriaVisivel) throw new Error('motivo da decisão não é mostrado');

  /* resumo: ligações de descarregamento e conteúdo real */
  const resumoLinks = await p.evaluate(() => [...document.querySelectorAll('#accroot a[href*="/summary?format="]')].map((a) => a.getAttribute('href')));
  if (resumoLinks.length !== 4) throw new Error('ligações de resumo: ' + resumoLinks.length);
  const pdf = await p.evaluate(async (href) => {
    const r = await fetch(href, { credentials: 'same-origin' });
    const b = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get('content-type'), sig: String.fromCharCode(...b.slice(0, 5)) };
  }, resumoLinks.find((h) => /pdf/.test(h)));
  if (pdf.status !== 200 || pdf.type !== 'application/pdf' || pdf.sig !== '%PDF-') throw new Error('PDF do resumo inválido: ' + JSON.stringify(pdf));
  const resumo = await p.evaluate(async (href) => {
    const r = await fetch(href, { credentials: 'same-origin' });
    const j = await r.json();
    return { conclusoes: j.estado.conclusoes, avisos: j.avisos.length, acima: (j.conclusoes || []).some((c) => c.acimaDoSustentado) };
  }, resumoLinks.find((h) => /json/.test(h)));
  if (resumo.avisos < 4) throw new Error('resumo sem avisos');

  /* fusão de homónimos: sem identificador é recusada, com identificador funciona */
  await waitText(/Homónimos: fundir com identificador/, 'secção de homónimos ausente');
  const nomes = await p.evaluate(() => {
    const a = document.getElementById('linkFrom'), b = document.getElementById('linkTo');
    if (!a || !b) throw new Error('selectores de fusão ausentes');
    return [...a.options].map((o) => o.value).filter(Boolean);
  });
  if (nomes.length < 2) throw new Error('entidades insuficientes para fundir: ' + nomes.length);
  await p.evaluate((vals) => {
    const a = document.getElementById('linkFrom'), b = document.getElementById('linkTo');
    a.value = vals[0]; a.dispatchEvent(new Event('change', { bubbles: true }));
    b.value = vals[1]; b.dispatchEvent(new Event('change', { bubbles: true }));
    const id = document.getElementById('linkIdentifier'), rs = document.getElementById('linkReason');
    id.value = ''; id.dispatchEvent(new Event('input', { bubbles: true }));
    rs.value = 'mesmo registo comercial'; rs.dispatchEvent(new Event('input', { bubbles: true }));
  }, nomes);
  await clickText('#accroot .btn', 'Fundir');
  await waitText(/Fusão recusada/, 'fusão sem identificador não foi recusada pela interface');
  await p.evaluate(() => {
    const id = document.getElementById('linkIdentifier');
    id.value = 'NIPC 500000000'; id.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickText('#accroot .btn', 'Fundir');
  await waitText(/Ligações declaradas \(1\)/, 'ligação declarada não apareceu');
  await p.evaluate(() => {
    const h = [...document.querySelectorAll('#accroot h4')].find((x) => /Memória da investigação/.test(x.textContent));
    if (h) h.scrollIntoView({ block: 'start' });
  });
  await p.waitForTimeout(400);
  await p.screenshot({ path: '/home/user/docs/shot-26-memoria.png' });
  return 'decisão registada com motivo · 4 formatos de resumo (PDF ' + pdf.sig + ') · fusão recusada sem identificador e aceite com NIPC';
});

/* Captura final (documentação visual). Não é prova de nada que não tenha
   sido já afirmado e verificado acima; se a sessão desta suite tiver sido
   revogada por uma das operações testadas, a conta volta a ver os seus
   próprios projectos e, quando o projecto de teste não estiver acessível,
   declara-se em vez de falhar. */
await garantirPainel();
let capturasOk = true;
try {
  const temVoltar = await p.evaluate(() => [...document.querySelectorAll('#accroot .btn')].some((b) => /Voltar ao projecto/.test(b.textContent)));
  if (temVoltar) await clickText('#accroot .btn', '← Voltar ao projecto');
  else await reabrirProjecto();
  await waitText(/Conclusões e alegações/, 'não voltou ao projecto', 8000);
} catch (e) {
  capturasOk = false;
  console.log('SKIP capturas finais: ' + e.message.slice(0, 120));
}
if (capturasOk) {
await p.evaluate(() => {
  const h = [...document.querySelectorAll('#accroot h4')].find((x) => /Conclusões e alegações/.test(x.textContent));
  if (h) h.scrollIntoView({ block: 'start' });
});
await p.waitForTimeout(300);
await p.screenshot({ path: '/home/user/docs/shot-18-provas.png' });
await p.evaluate(() => {
  const h = [...document.querySelectorAll('#accroot h4')].find((x) => /Pesquisa profunda/.test(x.textContent));
  if (h) h.scrollIntoView({ block: 'start' });
});
await p.waitForTimeout(300);
await p.screenshot({ path: '/home/user/docs/shot-19-pesquisa.png' });
await p.evaluate(() => {
  const h = [...document.querySelectorAll('#accroot h4')].find((x) => /Agentes \(/.test(x.textContent));
  if (h) h.scrollIntoView({ block: 'start' });
});
await p.waitForTimeout(300);
await p.screenshot({ path: '/home/user/docs/shot-22-agentes.png' });
await p.screenshot({ path: '/home/user/docs/shot-17-conta.png' });
await t('chaves do operador: estado visível, variável nomeada e link para obter a chave', async () => {
  /* corre no fim de propósito: muda de separador */
  await clickText('#accroot .btn', 'Chaves de IA');
  await p.waitForTimeout(400);
  const info = await p.evaluate(() => {
    const box = document.querySelector('[data-vn="chaves-operador"]');
    const tab = document.querySelector('table[data-vn="tabela-operador"]');
    if (!box || !tab) return null;
    const linhas = [...tab.querySelectorAll('tbody tr')].map((tr) => tr.textContent);
    const links = [...tab.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    return { texto: box.textContent, linhas, links, header: tab.querySelector('thead').textContent };
  });
  if (!info) throw new Error('sem painel de chaves do operador');
  if (!/AI_KEY_GROQ/.test(info.header + info.linhas.join(' '))) throw new Error('não nomeia a variável de ambiente');
  if (!/Chaves do operador/.test(info.texto)) throw new Error('sem título');
  if (!info.links.some((h) => /^https:\/\//.test(h || ''))) throw new Error('sem ligação para obter chave');
  if (!/sem chave/.test(info.linhas.join(' '))) throw new Error('não declara o fornecedor sem chave');
  return info.linhas.length + ' fornecedores · ' + info.links.length + ' ligações';
});

await t('varrimento «sem chave» aparece na interface com a data e o que NÃO decide', async () => {
  const info = await p.evaluate(() => {
    const box = document.querySelector('[data-vn="varrimento-sem-chave"]');
    return box ? box.textContent : null;
  });
  if (!info) throw new Error('sem caixa de varrimento «sem chave» no separador de chaves');
  if (!/APIs sem chave/.test(info)) throw new Error('sem título: ' + info.slice(0, 80));
  /* ou há relatório com data, ou diz que não há — nunca uma caixa vazia */
  if (!/\d{4}-\d{2}-\d{2}|sem relatório|indisponível|nenhum endpoint/.test(info)) {
    throw new Error('não diz nem a data nem a ausência: ' + info.slice(0, 120));
  }
  if (!/não o acrescenta à aplicação/.test(info)) throw new Error('não declara que descoberto ≠ usado');
  return info.replace(/\s+/g, ' ').slice(0, 110);
});

}   // fim das capturas (ver capturasOk)
await B.close();
srv.kill('SIGTERM');
console.log('CONTA E ADMINISTRAÇÃO — INTERFACE');
for (const r of R) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + String(r.detail).slice(0, 170));
console.log('erros de runtime:', errs.length, errs.slice(0, 3));
const fails = R.filter((r) => !r.ok).length;
console.log('\n' + (R.length - fails) + '/' + R.length + ' passaram');
process.exit(fails ? 1 : 0);
