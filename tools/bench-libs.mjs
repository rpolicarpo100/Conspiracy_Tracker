/* Comparação de motores de grafo — 500 / 2000 / 5000 nós (rede sintética).
   Mede apenas a fase de cálculo de posições (layout), que em qualquer
   arquitectura é o factor limitante antes da renderização.
   Uso: node tools/bench-libs.mjs  -> escreve docs/BENCHMARKS-raw.json      */
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceCenter } from 'd3-force';
import { writeFileSync } from 'node:fs';

cytoscape.use(fcose);

function synthetic(n) {
  const nodes = [], edges = [];
  for (let i = 0; i < n; i++) nodes.push({ data: { id: 'n' + i } });
  // distribuição com hubs (cauda longa), típica de redes de influência
  for (let i = 1; i < n * 2.5; i++) {
    const a = i % n;
    const hub = Math.floor(Math.pow(Math.random(), 2.2) * n);
    edges.push({ data: { id: 'e' + i, source: 'n' + a, target: 'n' + hub } });
  }
  return { nodes, edges };
}

const time = async (fn) => { const t = performance.now(); await fn(); return Math.round(performance.now() - t); };

const results = [];
for (const n of [500, 2000, 5000]) {
  const { nodes, edges } = synthetic(n);
  const row = { nodes: n, edges: edges.length };

  // 1) cytoscape + fcose (layout "quality")
  const cy = cytoscape({ headless: true, elements: [...nodes, ...edges], styleEnabled: false });
  row.cytoscape_fcose = await time(() => new Promise((res) => {
    const l = cy.layout({ name: 'fcose', animate: false, randomize: true, numIter: 2500, quality: 'default' });
    l.one('layoutstop', res); l.run();
  }));
  // 2) cytoscape + cose built-in
  row.cytoscape_cose = await time(() => new Promise((res) => {
    const l = cy.layout({ name: 'cose', animate: false, numIter: 1000 });
    l.one('layoutstop', res); l.run();
  }));
  // 3) d3-force (300 ticks)
  row.d3_force = await time(() => {
    const ns = nodes.map((d) => ({ id: d.data.id }));
    const ls = edges.map((e) => ({ source: e.data.source, target: e.data.target }));
    const sim = forceSimulation(ns)
      .force('link', forceLink(ls).id((d) => d.id).distance(40))
      .force('charge', forceManyBody().strength(-60))
      .force('collide', forceCollide(6))
      .force('center', forceCenter(0, 0))
      .stop();
    for (let i = 0; i < 300; i++) sim.tick();
    return sim;
  });
  row.peakRssMB = Math.round(process.memoryUsage().rss / 1048576);
  results.push(row);
  console.log(JSON.stringify(row));
  cy.destroy();
}
writeFileSync(new URL('../docs/BENCHMARKS-raw.json', import.meta.url), JSON.stringify({ ranAt: new Date().toISOString(), node: process.version, results }, null, 2));
