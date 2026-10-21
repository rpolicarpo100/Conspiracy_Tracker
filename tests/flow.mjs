/* Teste funcional end-to-end em Chromium: critérios de aceitação 1–10. */
import { chromium } from 'playwright';
const B = await chromium.launch({ executablePath: '/home/user/.cache/ms-playwright/chromium-1140/chrome-linux/chrome', args: ['--no-sandbox','--disable-dev-shm-usage'], headless: true });
const page = await B.newPage({ viewport: { width: 1680, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const r = await fn(); results.push({ name, ok: true, ms: Date.now() - t0, detail: r }); }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, detail: e.message }); }
};
await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

// 1. pesquisar entidade
await step('1. Pesquisar entidade', async () => {
  await page.click('#search');
  await page.fill('#search', 'Meridiano');
  await page.waitForTimeout(350);
  const n = await page.locator('.sresult').count();
  if (!n) throw new Error('sem resultados');
  await page.click('.sresult');
  await page.waitForTimeout(900);
  const title = await page.textContent('#detailsbody h2');
  return n + ' resultados; aberto: ' + title;
});

// 2. nó com representação
await step('2. Nó com representação visual', async () => {
  const hasImg = await page.evaluate(() => {
    const cy = VN.app.engine.cy; const n = cy.getElementById('c-meridiano');
    return n.nonempty() && !!n.data('img') && n.data('img').startsWith('data:image/svg');
  });
  if (!hasImg) throw new Error('sem imagem no nó');
  const prov = await page.textContent('#detailsbody');
  if (!/Avatar procedimental|Logótipo fictício|Fotografia/.test(prov)) throw new Error('sem proveniência');
  return 'imagem embutida + proveniência declarada';
});

// 3. expandir
await step('3. Expandir relações documentadas', async () => {
  const before = await page.evaluate(() => VN.app.ctx.store.state.loaded.size);
  await page.keyboard.press('e');
  await page.waitForTimeout(1100);
  const after = await page.evaluate(() => VN.app.ctx.store.state.loaded.size);
  if (after <= before) throw new Error('não expandiu (' + before + '→' + after + ')');
  return before + ' → ' + after + ' entidades carregadas';
});

// 4. significado de cada ligação (etiqueta tipificada)
await step('4. Identificar significado da ligação', async () => {
  const info = await page.evaluate(() => {
    const cy = VN.app.engine.cy; const e = cy.edges().first();
    return { id: e.id(), label: e.data('relLabel'), style: e.style('line-style') };
  });
  if (!info.label) throw new Error('sem etiqueta de relação');
  return info.id + ' = "' + info.label + '" (' + info.style + ')';
});

// 5. consultar fonte
await step('5. Consultar fonte da relação', async () => {
  await page.evaluate(() => VN.app.selectRelation('r-001'));
  await page.waitForTimeout(500);
  const body = await page.textContent('#detailsbody');
  if (!/Excerto que sustenta|sem excerto/.test(body)) throw new Error('sem excerto');
  const links = await page.locator('#detailsbody .linkbtn').count();
  return 'painel com fonte, localização, excerto e ' + links + ' acções';
});

// 6. distinguir factos, alegações e não verificados
await step('6. Distinguir facto / alegação / não verificado', async () => {
  const counts = await page.evaluate(() => {
    const M = VN.app.ctx.model;
    return { factos: M.entities.filter(e => (e.facts || []).length).length,
      alegacoes: M.relations.filter(r => r.status === 'alleged').length,
      naoVerif: M.relations.filter(r => r.status === 'unverified').length,
      contraditas: M.relations.filter(r => r.status === 'contradicted').length,
      estilos: Array.from(new Set(M.relations.map(r => r.status))) };
  });
  if (!counts.alegacoes || !counts.naoVerif || !counts.contraditas) throw new Error('estados em falta');
  return JSON.stringify(counts);
});

// 7. filtrar por período e categoria
await step('7. Filtrar por período e categoria', async () => {
  const r = await page.evaluate(() => {
    const st = VN.app.ctx.store, M = VN.app.ctx.model;
    const before = st.masks().edges.size;
    st.setFilter({ yearFrom: 2016, yearTo: 2018 }, 'teste período'); VN.app.refresh();
    const period = st.masks().edges.size;
    // válida no período = intervalo da relação intersecta [2016,2018]
    const outside = Array.from(st.masks().edges).map(id => M.relById.get(id)).filter(r => {
      if (!r.yStart && !r.yEnd) return false;                 // sem data: mantida e assinalada
      const s0 = r.yStart != null ? r.yStart : -Infinity;
      const e0 = r.yEnd != null ? r.yEnd : Infinity;
      return !(s0 <= 2018 && e0 >= 2016);
    }).length;
    const loan2020 = st.masks().edges.has('r-079');
    st.setFilter({ yearFrom: null, yearTo: null, families: new Set(['financial']) }, 'teste família'); VN.app.refresh();
    const fam = st.masks().edges.size;
    const wrongFam = Array.from(st.masks().edges).map(id => M.relById.get(id)).filter(r => r.family !== 'financial').length;
    st.resetFilters(); VN.app.refresh();
    return { before, period, outside, fam, wrongFam, back: st.masks().edges.size };
  });
  if (r.outside || r.wrongFam) throw new Error('filtros incorrectos: ' + JSON.stringify(r));
  return JSON.stringify(r);
});

// 8. caminhos
await step('8. Encontrar caminhos entre duas entidades', async () => {
  const r = await page.evaluate(() => {
    const st = VN.app.ctx.store;
    st.loadAll(); VN.app.refresh();
    st.setPath({ a: 'p-vitor', b: 'p-joaquim', maxSteps: 4 });
    VN.app.runPath();
    return st.state.path.results ? { n: st.state.path.results.paths.length, best: st.state.path.results.paths[0] && st.state.path.results.paths[0].score, explored: st.state.path.results.explored } : null;
  });
  if (!r || !r.n) throw new Error('sem caminhos');
  const panel = await page.textContent('#detailsbody');
  if (!/não prova coordenação|não é prova/i.test(panel)) throw new Error('sem aviso metodológico');
  return JSON.stringify(r);
});

// 9. cronologia
await step('9. Inspeccionar cronologia', async () => {
  const r = await page.evaluate(() => {
    const s = VN.timeline.series;
    return { anos: s.years.length, min: s.years[0], max: s.years[s.years.length - 1],
      comRelacoes: s.buckets.filter(b => b.relations).length,
      semData: VN.app.ctx.model.relations.filter(x => !x.hasDates).length };
  });
  await page.click('.dtab[data-dtab="timeline"]');
  await page.waitForTimeout(400);
  const body = await page.textContent('#detailsbody');
  if (!/sem data|desconhecida/i.test(body)) throw new Error('não assinala datas desconhecidas');
  return JSON.stringify(r);
});

// 10. exportar relatório com referências
await step('10. Exportar relatório com provas', async () => {
  const html = await page.evaluate(() => VN.report.buildReport(VN.app.ctx, { all: true }));
  const checks = { refsRel: (html.match(/\[r-\d{3}\]/g) || []).length, refsDoc: (html.match(/\[d-[a-z0-9-]+\]/g) || []).length,
    excertos: (html.match(/class="q"/g) || []).length, metodo: /Metodologia/.test(html), aviso: /fictícios/i.test(html) };
  if (!checks.refsRel || !checks.excertos) throw new Error('relatório sem referências');
  await page.evaluate((h) => { window.__report = h; }, html);
  return JSON.stringify(checks) + ' · ' + html.length + ' bytes';
});

// extras: livro de provas, validação de IA, guarda de dados reais
await step('11. Livro de provas com hash encadeado', async () => {
  const r = await page.evaluate(async () => {
    const L = VN.ledger.create('teste');
    await L.append({ type: 'recolha', payload: { url: 'https://exemplo.pt', quote: 'abc' } });
    await L.append({ type: 'verificacao', payload: { ok: true } });
    const v1 = await L.verify();
    L.ledger.entries[0].payload.quote = 'ALTERADO';
    const v2 = await L.verify();
    return { ok1: v1.ok, hash: v1.head.slice(0, 12), detectou: !v2.ok, problemas: v2.problems.length };
  });
  if (!r.ok1 || !r.detectou) throw new Error('livro não detecta alteração');
  return JSON.stringify(r);
});

await step('12. Validador de IA rejeita afirmações sem prova', async () => {
  const r = await page.evaluate(() => {
    const bad = VN.research.validateAIResponse(JSON.stringify({ claims: [{ text: 'A empresa escondeu tudo', kind: 'facto', status: 'confirmado', sources: [] }], negativeResults: [], limits: [], nextSteps: [] }));
    const good = VN.research.validateAIResponse(JSON.stringify({ claims: [{ text: 'Detém 25% segundo certidão.', kind: 'facto', status: 'confirmado', sources: [{ name: 'Certidão', date: '2026-01-10', quote: '25%', sourceType: 'primaria' }], verification: 'x', disconfirming: null }], negativeResults: [], limits: [], nextSteps: [] }));
    return { rejeitadas: bad.rejected.length, aceites: good.accepted.length };
  });
  if (!r.rejeitadas || !r.aceites) throw new Error('validador incorrecto');
  return JSON.stringify(r);
});

await step('13. Portão de dados reais recusa falta de prova', async () => {
  const r = await page.evaluate(() => {
    const v = VN.realdata.validateBundle({ entities: [{ id: 'a', type: 'company', name: 'X', status: 'confirmed' }], relations: [{ id: 'r', from: 'a', to: 'a', kind: 'x', status: 'confirmed' }] });
    const sk = VN.realdata.validateBundle(VN.realdata.skeleton());
    return { recusou: !v.ok, erros: v.errors.length, esqueletoValido: sk.ok };
  });
  if (!r.recusou) throw new Error('aceitou dados sem prova');
  return JSON.stringify(r);
});

await step('14. Sem erros de runtime', async () => {
  if (errors.length) throw new Error(errors.slice(0, 5).join(' | '));
  return 'nenhum erro';
});

await page.screenshot({ path: '/home/user/docs/shot-02-flow.png' });
console.log('RESULTADOS');
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' (' + r.ms + ' ms) ' + (r.ok ? String(r.detail).slice(0, 220) : '→ ' + r.detail));
const fails = results.filter(r => !r.ok).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passaram · erros de consola: ' + errors.length);
await B.close();
process.exit(fails ? 1 : 0);
