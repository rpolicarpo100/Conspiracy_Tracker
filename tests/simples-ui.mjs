/* =====================================================================
   MODO SIMPLES E PESQUISA DO UTILIZADOR — interface.

   Duas coisas que o utilizador pediu e que aqui ficam provadas:
   1. criar uma investigação e trabalhar nela sem passar pelo mapa;
   2. procurar no PRÓPRIO trabalho (projectos, provas, documentos, memória),
      que era o que não existia: a pesquisa antiga só cobria o conjunto
      público carregado.

   O que este ficheiro NÃO faz: fingir que a IA corre. Quando não há chave,
   o teste verifica que a interface o DIZ (e que a análise por IA não é
   oferecida como se existisse).
   ===================================================================== */
import './_env.mjs';
import { chromium } from 'playwright';
import { entrarNaAplicacao, semearConta, CONTA_TESTE } from './_ui-entrada.mjs';

const BASE = process.env.VN_BASE || 'http://127.0.0.1:8080';
await semearConta(BASE, CONTA_TESTE.email, CONTA_TESTE.password);

const B = await chromium.launch({ executablePath: (process.env.CHROMIUM_PATH || undefined), args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
const p = await B.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0134]/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 160)); });

const R = [];
const t = async (name, fn) => {
  try { R.push({ name, ok: true, detail: await fn() }); }
  catch (e) { R.push({ name, ok: false, detail: e.message }); }
};

async function waitFor(fn, arg, timeout) {
  const t0 = Date.now();
  for (;;) {
    if (await p.evaluate(fn, arg)) return true;
    if (Date.now() - t0 > (timeout || 20000)) throw new Error('tempo excedido');
    await p.waitForTimeout(150);
  }
}
const texto = (sel) => p.evaluate((s) => (document.querySelector(s) || {}).textContent || '', sel);
const visivel = (sel) => p.evaluate((s) => {
  const n = document.querySelector(s);
  if (!n) return false;
  const r = n.getBoundingClientRect();
  return getComputedStyle(n).display !== 'none' && r.width > 2 && r.height > 2;
}, sel);

await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await entrarNaAplicacao(p, BASE, CONTA_TESTE.email, CONTA_TESTE.password, { vista: 'simples' });
await waitFor(() => !!document.getElementById('vnSimples'), null, 15000);

await t('ao entrar, o que se vê é uma pergunta e uma caixa de pesquisa — não o mapa', async () => {
  if (!(await visivel('#smPergunta'))) throw new Error('sem caixa de pergunta');
  if (!(await visivel('#smBusca'))) throw new Error('sem caixa de pesquisa');
  const mapa = await p.evaluate(() => {
    const m = document.querySelector('main.layout');
    if (!m) return false;
    const r = m.getBoundingClientRect();
    return getComputedStyle(m).display !== 'none' && r.width > 2;
  });
  if (mapa) throw new Error('o mapa continua à frente do modo simples');
  if (await visivel('#cy')) throw new Error('o grafo está visível sem ser pedido');
  return 'modo simples à frente · mapa escondido';
});

await t('a vista avançada continua acessível e o regresso também', async () => {
  await p.evaluate(() => document.getElementById('smIrAvancado').click());
  await waitFor(() => {
    const m = document.querySelector('main.layout');
    if (!m) return false;
    const r = m.getBoundingClientRect();
    return getComputedStyle(m).display !== 'none' && r.width > 2;
  });
  const botao = await visivel('#btnSimples');
  if (!botao) throw new Error('sem botão «Modo simples» na vista avançada');
  await p.evaluate(() => document.getElementById('btnSimples').click());
  await waitFor(() => {
    const n = document.getElementById('vnSimples');
    return n && getComputedStyle(n).display !== 'none';
  });
  return 'ida e volta entre as duas vistas';
});

await t('a barra diz o estado real da IA (sem chave, quando não há chave)', async () => {
  const txt = await texto('#smIaBadge');
  const tem = /IA pronta/.test(txt);
  const sem = /IA sem chave/.test(txt);
  if (!tem && !sem) throw new Error('estado da IA não declarado: ' + txt);
  const ofereceIA = await p.evaluate(() => !!document.getElementById('smAnalisarIA'));
  if (sem && ofereceIA) throw new Error('oferece análise por IA sem chave configurada');
  return txt.trim();
});

let pid = null;
await t('uma pergunta cria a investigação e abre-a (sem passar pelo mapa)', async () => {
  const pergunta = 'Quem financiou a fundação Calouste em 2019?';
  await p.fill('#smPergunta', pergunta);
  await waitFor(() => !document.getElementById('smCriar').disabled, null, 5000);
  await p.evaluate(() => document.getElementById('smCriar').click());
  await waitFor((q) => {
    const h = document.getElementById('smTitulo');
    return !!h && h.textContent.indexOf(q.slice(0, 20)) >= 0;
  }, pergunta, 20000);
  pid = await p.evaluate(() => window.VN.simples.getState().aberto);
  if (!pid) throw new Error('o projecto não ficou aberto');
  const stats = await texto('#smStats');
  if (!/Provas/i.test(stats)) throw new Error('sem contagens');
  return 'projecto ' + pid + ' aberto · contagens visíveis';
});

await t('o próximo passo é concreto e diz o que falta', async () => {
  const txt = await texto('#smProximo');
  if (!/Ainda não há nada registado|Já tens/.test(txt)) throw new Error('sem indicação de próximo passo');
  if (!(await visivel('#smRecolher'))) throw new Error('sem acção para recolher documento');
  return txt.replace(/\s+/g, ' ').slice(0, 90);
});

await t('o plano de fontes é apresentado como plano, com ligações reais, e não como resultado', async () => {
  await p.evaluate(() => document.getElementById('smPlano').click());
  await waitFor(() => !!document.getElementById('smPlanoBox'));
  const passos = await p.evaluate(() => document.querySelectorAll('#smPlanoBox .sm-plan-step').length);
  if (passos < 3) throw new Error('plano com ' + passos + ' passos');
  const links = await p.evaluate(() => [...document.querySelectorAll('#smPlanoBox a')].map((a) => a.getAttribute('href')));
  const externos = links.filter((h) => /^https?:\/\//.test(h || ''));
  if (externos.length < 2) throw new Error('sem ligações a fontes oficiais');
  const txt = await texto('#smPlanoBox');
  if (!/plano, não resultado/i.test(txt)) throw new Error('o plano não se declara como plano');
  if (await p.evaluate(() => document.querySelectorAll('#smPlanoBox a[target="_blank"]').length === 0)) throw new Error('ligações sem target/rel');
  const rel = await p.evaluate(() => [...document.querySelectorAll('#smPlanoBox a')].every((a) => (a.getAttribute('rel') || '').includes('noopener')));
  if (!rel) throw new Error('ligações externas sem rel=noopener');
  return passos + ' passos · ' + externos.length + ' ligações oficiais';
});

await t('registar uma prova exige excerto e aparece na lista', async () => {
  await p.evaluate(() => document.getElementById('smRegistarProva').click());
  await waitFor(() => !!document.getElementById('smProvaForm'));
  await p.fill('#smEvTitle', 'Relatório de contas 2019');
  await p.fill('#smEvExcerpt', 'curto');           // deliberadamente inválido
  await p.evaluate(() => document.getElementById('smEvGuardar').click());
  await p.waitForTimeout(700);
  const n0 = await p.evaluate(() => window.VN.simples.getState().provas);
  if (n0 !== 0) throw new Error('aceitou uma prova sem excerto utilizável');
  await p.fill('#smEvExcerpt', 'A fundação recebeu 250 000 euros em 2019, segundo o relatório de contas.');
  await p.evaluate(() => document.getElementById('smEvGuardar').click());
  await waitFor(() => window.VN.simples.getState().provas === 1, null, 15000);
  const lista = await texto('#smProvas');
  if (!/Relatório de contas 2019/.test(lista)) throw new Error('a prova não aparece');
  return 'excerto curto recusado · prova registada e listada';
});

await t('a verificação automática corre sem IA e diz o que encontrou', async () => {
  await p.evaluate(() => document.getElementById('smVerificar').click());
  await waitFor(() => /achado|problema/i.test(document.body.innerText), null, 30000);
  const msg = await texto('#vnSimples .sm-msg');
  if (!/Verificador de factos/.test(msg)) throw new Error('não correu a verificação: ' + msg.slice(0, 80));
  const runs = await p.evaluate(() => document.querySelectorAll('#smExecucoes .sm-item').length);
  if (runs < 3) throw new Error('execuções não registadas (' + runs + ')');
  const iaUsada = await p.evaluate(() => [...document.querySelectorAll('#smExecucoes .sm-item')]
    .map((n) => n.textContent).join(' '));
  if (/IA · nao-executado/.test(iaUsada) && /IA pronta/.test(await texto('#smIaBadge'))) {
    throw new Error('agente de IA não executado apesar de haver chave');
  }
  return (msg.match(/\d+ achado/) || ['sem achados'])[0] + ' · ' + runs + ' execuções locais registadas';
});

await t('a pesquisa no meu trabalho encontra a prova e o projecto', async () => {
  await p.evaluate(() => document.getElementById('smVoltar').click());
  await waitFor(() => !!document.getElementById('smBusca'));
  await p.fill('#smBusca', 'Calouste');
  await p.evaluate(() => document.getElementById('smProcurar').click());
  await waitFor(() => !!document.getElementById('smResumo'), null, 15000);
  const resumo = await texto('#smResumo');
  if (!/\d+ resultado/.test(resumo)) throw new Error('sem resumo: ' + resumo);
  const itens = await p.evaluate(() => document.querySelectorAll('#smResults .sm-item').length);
  if (itens < 1) throw new Error('sem resultados para um termo que existe no trabalho');
  const tipos = await p.evaluate(() => [...document.querySelectorAll('#smResults .sm-item-tag')].map((n) => n.textContent));
  if (tipos.indexOf('Investigação') < 0) throw new Error('o projecto não aparece na pesquisa');
  return resumo.replace(/\s+/g, ' ').slice(0, 70) + ' · ' + tipos.length + ' itens';
});

await t('quando alarga a pesquisa, a interface diz que alargou e marca os parciais', async () => {
  await p.fill('#smBusca', 'Calouste astronomia');
  await p.evaluate(() => document.getElementById('smProcurar').click());
  /* o resumo anterior ainda está no ecrã: espera-se pelo texto NOVO */
  await waitFor(() => {
    const n = document.getElementById('smResumo');
    return n && /astronomia/.test(n.textContent);
  }, null, 15000);
  const resumo = await texto('#smResumo');
  if (!/alarguei/.test(resumo)) throw new Error('não declarou o alargamento: ' + resumo.slice(0, 80));
  const tags = await p.evaluate(() => [...document.querySelectorAll('#smResults .sm-item-tag')].map((n) => n.textContent));
  if (!tags.some((t) => /parcial/.test(t))) throw new Error('nenhum resultado marcado como parcial');
  return 'alargamento declarado · ' + tags.filter((t) => /parcial/.test(t)).length + ' parciais';
});

await t('a pesquisa recusa termos demasiado curtos em vez de devolver tudo', async () => {
  await p.fill('#smBusca', 'a');
  await p.evaluate(() => document.getElementById('smProcurar').click());
  await p.waitForTimeout(600);
  const msg = await texto('#vnSimples .sm-msg');
  if (!/2 caracteres|pelo menos/i.test(msg)) throw new Error('não avisou: ' + msg.slice(0, 60));
  return 'aviso de termo curto';
});

await t('resultado da pesquisa abre a investigação certa', async () => {
  await p.fill('#smBusca', 'Calouste');
  await p.evaluate(() => document.getElementById('smProcurar').click());
  await waitFor(() => document.querySelectorAll('#smResults .sm-item').length > 0, null, 15000);
  /* guarda o projecto que o resultado aponta, para comparar com o que abre */
  const alvo = await p.evaluate(() => {
    const b = document.querySelector('#smResults .sm-item[data-pid]');
    if (!b) return null;
    b.click();
    return b.getAttribute('data-pid');
  });
  if (!alvo) throw new Error('resultado sem projecto associado');
  await waitFor((id) => window.VN.simples.getState().aberto === id, alvo, 20000);
  const titulo = await texto('#smTitulo');
  if (!/Calouste/.test(titulo)) throw new Error('abriu outro projecto: ' + titulo.slice(0, 60));
  return 'resultado apontava para ' + alvo + ' e foi esse que abriu';
});

await t('a pesquisa de outra conta não vê este trabalho', async () => {
  /* contexto de navegador próprio: a sessão da outra conta não pode contaminar
     a desta página (foi exactamente o erro que esta correcção evita) */
  const outra = { email: 'outra.' + Date.now().toString(36) + '@ex.pt', password: 'OutraForte-2026' };
  await semearConta(BASE, outra.email, outra.password);
  const ctx2 = await B.newContext({ viewport: { width: 1000, height: 800 } });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await entrarNaAplicacao(p2, BASE, outra.email, outra.password);
  const r = await p2.evaluate(async () => (await (await fetch('api/search?q=Calouste', { headers: { accept: 'application/json' } })).json()));
  const meu = await p.evaluate(async () => (await (await fetch('api/search?q=Calouste', { headers: { accept: 'application/json' } })).json()).total);
  await ctx2.close();
  if (!r || typeof r.total !== 'number') throw new Error('resposta inesperada: ' + JSON.stringify(r).slice(0, 80));
  if (r.total !== 0) throw new Error('a outra conta viu ' + r.total + ' resultado(s) de trabalho alheio');
  if (meu < 1) throw new Error('a conta dona deixou de encontrar o seu próprio trabalho');
  return 'outra conta: 0 resultados · conta dona: ' + meu;
});

await t('fim de sessão devolve à porta e o modo simples desaparece com a aplicação', async () => {
  await p.evaluate(async () => {
    const me = await (await fetch('api/auth/me')).json();
    await fetch('api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': (me && me.csrf) || '' }, body: '{}' });
  });
  await p.evaluate(() => window.VN.gate.sessaoTerminou());
  await waitFor(() => document.documentElement.getAttribute('data-vn-auth') === 'por-autenticar', null, 15000);
  const escondido = await p.evaluate(() => {
    const n = document.getElementById('vnSimples');
    if (!n) return true;
    const r = n.getBoundingClientRect();
    return getComputedStyle(n).display === 'none' || r.width < 2;
  });
  const projects = await p.evaluate(async () => (await fetch('api/projects')).status);
  if (!escondido) throw new Error('o modo simples ficou visível depois de sair');
  if (projects !== 401) throw new Error('a API respondeu ' + projects + ' depois de sair');
  return 'porta reposta · modo simples fora do ecrã · API 401';
});

await t('sem erros de runtime em todo o percurso', async () => {
  if (errs.length) throw new Error(errs.slice(0, 2).join(' | '));
  return 'nenhum';
});

await B.close();
console.log('MODO SIMPLES E PESQUISA — INTERFACE');
R.forEach((r) => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + String(r.detail).slice(0, 170)));
const fails = R.filter((r) => !r.ok).length;
console.log('\n' + (R.length - fails) + '/' + R.length + ' passaram');
process.exit(fails ? 1 : 0);
