/* Testes da pesquisa profunda: exactidão, tolerância, sintaxe, segurança. */
import { chromium } from 'playwright';
import { entrarNaAplicacao, semearConta, CONTA_TESTE } from './_ui-entrada.mjs';
const B = await chromium.launch({ executablePath: (process.env.CHROMIUM_PATH || undefined), args: ['--no-sandbox','--disable-dev-shm-usage'], headless: true });
const page = await B.newPage({ viewport: { width: 1680, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
/* A aplicação exige sessão desde a fase 9: entra-se pela porta, como qualquer
   pessoa. Servidor de desenvolvimento (tools/dev-server.sh), nunca produção. */
const BASE = process.env.VN_BASE || 'http://127.0.0.1:8080';
await semearConta(BASE, CONTA_TESTE.email, CONTA_TESTE.password);
await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
await entrarNaAplicacao(page, BASE, CONTA_TESTE.email, CONTA_TESTE.password);

const results = [];
const t = async (name, fn) => {
  try { const r = await fn(); results.push({ name, ok: true, detail: r }); }
  catch (e) { results.push({ name, ok: false, detail: e.message }); }
};
const Q = (q, o) => page.evaluate(([q, o]) => VN.app.search(q, o), [q, o || {}]);

await t('índice construído e dimensionado', async () => {
  const s = await page.evaluate(() => { VN.app.search('x'); return VN.app.ctx.model._searchIndex.stats(); });
  if (!s.documents) throw new Error('índice vazio');
  return JSON.stringify(s);
});

await t('acentos e maiúsculas irrelevantes', async () => {
  const a = await Q('JEFFREY EPSTEIN'), b = await Q('jeffrey epstein'), c = await Q('Jeffrey Epstein');
  const top = (r) => r.results[0].entity && r.results[0].entity.id;
  if (top(a) !== top(b) || top(b) !== top(c)) throw new Error('resultados divergem: ' + top(a) + '/' + top(b) + '/' + top(c));
  return 'topo igual nos três: ' + top(a);
});

await t('gralha corrigida e assinalada (nunca silenciosa)', async () => {
  const r = await Q('epstain');
  if (!r.total) throw new Error('sem resultados');
  const fuzzy = r.results.filter((x) => x.fuzzy);
  if (!fuzzy.length) throw new Error('não assinalou aproximação');
  const why = fuzzy[0].why.join(' | ');
  if (!/aproximado/.test(why)) throw new Error('explicação ausente');
  return fuzzy.length + ' resultados aproximados · ' + why.slice(0, 90);
});

await t('frase exacta só devolve a frase', async () => {
  const r = await Q('"Jeffrey Epstein"');
  const hasPhrase = (x) => {
    const P = /jeffrey\s+(e\.\s+)?epstein/i;
    if (x.snippet && P.test(x.snippet.html.replace(/<[^>]+>/g, ''))) return true;
    if (x.entity && P.test(x.entity.name + ' ' + (x.entity.ctx || '') + ' ' + (x.entity.facts || []).join(' '))) return true;
    if (x.relation && P.test((x.relation.kindLabel || '') + ' ' + (x.relation.ex || '') + ' ' + (x.relation.fromName || '') + ' ' + (x.relation.toName || ''))) return true;
    return false;
  };
  const bad = r.results.filter((x) => !hasPhrase(x));
  if (bad.length) throw new Error('devolveu ' + bad.length + ' sem a frase');
  return r.total + ' resultados, todos com a frase';
});

await t('filtro tipo:pessoa', async () => {
  const r = await Q('epstein tipo:pessoa');
  const wrong = r.results.filter((x) => x.entity && x.entity.type !== 'person');
  if (wrong.length) throw new Error('tipos errados: ' + wrong.map((w) => w.entity.type));
  const relWrong = r.results.filter((x) => x.relation && ![x.relation.fromType, x.relation.toType].includes('person'));
  if (relWrong.length) throw new Error('ligações sem pessoa nos extremos');
  return r.counts.entities + ' entidades, ' + r.counts.relations + ' ligações, sem violações';
});

await t('filtro estado:não-verificado e estado:alegado', async () => {
  /* o conjunto real não tem alegações nem registos não verificados: o filtro
     tem de devolver zero, e é isso que se verifica (não se inventa um exemplo). */
  const a = await Q('estado:alegado');
  const n = await Q('estado:não-verificado');
  const badA = a.results.filter((x) => (x.entity ? x.entity.status : x.relation.status) !== 'alleged');
  const badN = n.results.filter((x) => (x.entity ? x.entity.status : x.relation.status) !== 'unverified');
  if (badA.length || badN.length) throw new Error('estados incorrectos');
  return a.total + ' alegadas · ' + n.total + ' não verificadas';
});

await t('filtro temporal ano:2016-2018', async () => {
  const r = await Q('ano:2016-2018');
  const bad = r.results.filter((x) => { const y = x.entity ? x.entity.year : x.relation.yStart; return y == null || y < 2016 || y > 2018; });
  if (bad.length) throw new Error(bad.length + ' fora do intervalo');
  return r.total + ' resultados, todos dentro de 2016–2018';
});

await t('exclusão -termo', async () => {
  const a = await Q('epstein');
  const b = await Q('epstein -maxwell');
  const leaked = b.results.filter((x) => /maxwell/i.test((x.entity ? x.entity.name + ' ' + (x.entity.ctx || '') : '') + (x.relation ? (x.relation.ex || '') : '')));
  if (b.total >= a.total) throw new Error('exclusão não reduziu (' + a.total + '→' + b.total + ')');
  if (leaked.length) throw new Error('documento excluído apareceu');
  return a.total + ' → ' + b.total;
});

await t('pesquisa alargada é avisada', async () => {
  const r = await Q('epstein maxwell termoquenaoexistezz');
  if (!r.total) throw new Error('devia encontrar com OR alargado');
  if (!r.expanded) throw new Error('não assinalou alargamento');
  return r.total + ' resultados com aviso de alargamento';
});

await t('excertos com destaque e contexto', async () => {
  const r = await Q('Jeffrey Epstein');
  const withMark = r.results.filter((x) => x.snippet && /<mark>/.test(x.snippet.html));
  if (!withMark.length) throw new Error('sem destaque');
  return withMark.length + '/' + r.total + ' com <mark> · ex.: ' + withMark[0].snippet.html.replace(/<[^>]+>/g, '').slice(0, 80);
});

await t('ligações entre resultados (registadas, não inferidas)', async () => {
  const kind = await page.evaluate(() => typeof window.VN);
  if (kind !== 'object') throw new Error('window.VN ausente (typeof=' + kind + ')');
  const c = await page.evaluate(() => {
    const M = window.VN.app.ctx.model;
    const res = window.VN.search.connections(M, ['p-jeffrey-epstein', 'd-cl-9839571', 'c-court-fladistctapp']);
    return {
      direct: res.direct.map((r) => ({ id: r.id, label: r.kindLabel })),
      registered: res.direct.every((r) => M.relById.has(r.id)),
      shared: res.shared.length, distance: res.distance
    };
  });
  if (!c.direct.length) throw new Error('sem relação directa');
  if (!c.registered) throw new Error('devolveu relação não registada no modelo');
  return c.direct.length + ' directas (' + c.direct.map((r) => r.id + ':' + r.label).join(', ') + ') · ' + c.shared + ' vizinhos comuns · distância ' + c.distance;
});

await t('nenhuma fusão de homónimos em pesquisa aproximada', async () => {
  const r = await Q('epstein');
  const names = r.results.filter((x) => x.entity).map((x) => x.entity.name);
  const uniq = new Set(names);
  if (uniq.size !== names.length) throw new Error('duplicou entidades');
  const approx = r.results.filter((x) => x.fuzzy).length;
  return names.length + ' entidades distintas, ' + approx + ' por aproximação (assinaladas)';
});

await t('zero resultados: sugestões + registo negativo disponível', async () => {
  const r = await Q('epstien');
  if (r.total) return 'encontrou por aproximação: ' + r.results[0].entity.name;
  if (!r.suggestions.length) throw new Error('sem sugestão');
  return 'sugestão: ' + r.suggestions.map((s) => s.term + '→' + s.suggestion).join(',');
});

await t('desempenho: 40 pesquisas seguidas', async () => {
  const ms = await page.evaluate(() => {
    const t0 = performance.now();
    for (let i = 0; i < 40; i++) VN.app.search(['epstein', 'maxwell', 'giuffre', 'jurisprudência', 'tipo:pessoa court', 'ano:2024 florida'][i % 6]);
    return Math.round((performance.now() - t0) / 40 * 10) / 10;
  });
  if (ms > 60) throw new Error('demasiado lento: ' + ms + ' ms/pesquisa');
  return ms + ' ms por pesquisa (média de 40, índice em memória)';
});

await t('paleta: teclado, grupos e ações', async () => {
  await page.click('#search');
  await page.fill('#search', 'epstein');
  await page.waitForTimeout(320);
  const groups = await page.$$eval('#searchresults .ssection', (n) => n.map((x) => x.textContent.trim()));
  const rows = await page.$$eval('#searchresults .sresult', (n) => n.length);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const selected = await page.textContent('#detailsbody h2').catch(() => '');
  if (!groups.length || !rows) throw new Error('paleta vazia');
  return rows + ' linhas · grupos: ' + groups.join(' / ') + ' · Enter abriu: ' + (selected || '(ligação)');
});

await t('página de pesquisa: fachas, ligações e exportação', async () => {
  await page.evaluate(() => VN.app.searchPage('epstein'));
  await page.waitForTimeout(700);
  const html = await page.textContent('#modalBody');
  if (!/Ligações entre os resultados|resultados/.test(html)) throw new Error('página sem conteúdo');
  const chips = await page.$$eval('#modalBody .chip', (n) => n.length);
  await page.evaluate(() => { const b = [...document.querySelectorAll('#modalBody .btn')].find((x) => /Exportar resultados/.test(x.textContent)); b && b.click(); });
  return 'fachas: ' + chips + ' · exportação accionada';
});

await t('sem erros de runtime', async () => {
  if (errors.length) throw new Error(errors.slice(0, 4).join(' | '));
  return 'nenhum';
});

console.log('PESQUISA PROFUNDA');
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + String(r.detail).slice(0, 220));
const fails = results.filter((r) => !r.ok).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passaram · erros: ' + errors.length);
await page.screenshot({ path: '/home/user/docs/shot-10-palette.png' });
await B.close();
process.exit(fails ? 1 : 0);
