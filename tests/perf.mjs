/* Medições de desempenho no browser (Chromium headless), com resultados reais. */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const B = await chromium.launch({ executablePath: '/home/user/.cache/ms-playwright/chromium-1140/chrome-linux/chrome', args: ['--no-sandbox','--disable-dev-shm-usage'], headless: true });
const page = await B.newPage({ viewport: { width: 1600, height: 950 } });
const out = { ranAt: new Date().toISOString(), browser: 'Chromium (headless)', viewport: '1600x950', results: {} };
await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

out.results.redeReal = await page.evaluate(async () => {
  const { store, model, app } = { store: VN.app.ctx.store, model: VN.app.ctx.model, app: VN.app };
  const engine = app.engine;
  const t = {};
  let t0 = performance.now();
  store.seed(); app.refresh({ fit: true, force: true });
  t.sementeMs = Math.round(performance.now() - t0);

  t0 = performance.now();
  store.loadAll(); app.refresh({ fit: true, force: true });
  t.redeCompletaMs = Math.round(performance.now() - t0);

  t0 = performance.now();
  app.expand('c-meridiano', 1);
  t.expandirMs = Math.round(performance.now() - t0);

  t0 = performance.now();
  store.setFilter({ yearFrom: 2016, yearTo: 2020 }, 'perf'); app.refresh();
  t.filtroMs = Math.round(performance.now() - t0);
  store.resetFilters(); app.refresh();

  t0 = performance.now();
  const r = VN.query.findPaths(model, 'p-vitor', 'p-lima' in {} ? '' : 'p-joaquim', { maxSteps: 5, limit: 12 });
  t.caminhosMs = Math.round(performance.now() - t0);
  t.caminhosEncontrados = r.paths.length;

  // FPS durante deslocamento contínuo
  const fps = await new Promise((res) => {
    let frames = 0; const start = performance.now(); let last = start;
    const cy = engine.cy;
    function tick() {
      const now = performance.now();
      cy.panBy({ x: (now % 40 < 20 ? 3 : -3), y: Math.sin(now / 300) * 2 });
      frames++;
      if (now - start < 2500) requestAnimationFrame(tick); else res(Math.round(frames / ((now - start) / 1000)));
    }
    requestAnimationFrame(tick);
  });
  t.fpsDeslocamento = fps;
  t.nosRenderizados = engine.cy.nodes().length;
  t.ligacoesRenderizadas = engine.cy.edges().length;
  t.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  return t;
});

// Rede sintética grande, para documentar limites de escala
out.results.escala = await page.evaluate(async () => {
  const rows = [];
  const host = document.createElement('div');
  // contentor VISÍVEL: canvas fora do ecrã é composto de forma diferente e falsearia a medição
  host.style.cssText = 'position:fixed;left:0;top:0;width:1600px;height:900px;z-index:9999;background:#05080f';
  document.body.appendChild(host);
  for (const n of [500, 1000, 2000, 5000]) {
    const eng = new VN.Engine(host, { theme: 'dark' });
    eng.init();
    const nodes = [], edges = [];
    for (let i = 0; i < n; i++) {
      nodes.push({ id: 'n' + i, label: 'N' + i, color: '#38bdf8', size: 28, status: 'confirmed', deg: 2, kind: 'person', img: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" rx="14" fill="#0369a1"/></svg>') });
    }
    for (let i = 1; i < n * 2.5; i++) {
      edges.push({ id: 'e' + i, source: 'n' + (i % n), target: 'n' + Math.floor(Math.pow(Math.random(), 2.2) * n), color: '#818cf8', w: 1, w2: 2, style: 'solid', relLabel: 'Financiou', status: 'confirmed' });
    }
    const t0 = performance.now();
    eng.sync({ nodes, edges }, { mode: 'preset', fit: true });
    const syncMs = Math.round(performance.now() - t0);
    const t1 = performance.now();
    await new Promise((res) => { const l = eng.cy.layout({ name: 'concentric', animate: false, concentric: (x) => x.data('deg') || 1, levelWidth: () => 3, minNodeSpacing: 20 }); l.one('layoutstop', res); l.run(); });
    const layoutMs = Math.round(performance.now() - t1);
    const measureFps = (ms) => new Promise((res) => {
      let frames = 0; const start = performance.now();
      function tick() { const now = performance.now(); eng.cy.panBy({ x: (now % 40 < 20 ? 4 : -4), y: 0 }); frames++; if (now - start < (ms || 1800)) requestAnimationFrame(tick); else res(Math.round(frames / ((now - start) / 1000))); }
      requestAnimationFrame(tick);
    });
    eng.setLite(false);
    const fpsCompleto = await measureFps();
    eng.setLite(true);
    const fpsLite = await measureFps();
    rows.push({ nos: n, ligacoes: edges.length, sincronizacaoMs: syncMs, layoutConcentricoMs: layoutMs,
      fpsModoCompleto: fpsCompleto, fpsModoLite: fpsLite, degradacaoAutomatica: n > 420 });
    eng.destroy();
  }
  host.remove();
  return rows;
});

writeFileSync(new URL('../docs/BENCHMARKS-perf.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await B.close();
