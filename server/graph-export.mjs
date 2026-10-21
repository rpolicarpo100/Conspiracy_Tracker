/* =====================================================================
   EXPORTAÇÃO DO GRAFO (SVG / DOT / JSON) — servidor, sem dependências.

   A exportação não pode inventar nada nem perder a proveniência:
   · o SVG leva a legenda e os avisos («uma linha não é prova»), não só o desenho;
   · o JSON leva as arestas com ids de prova, confiança justificada e origens;
   · o DOT serve para reabrir noutra ferramenta, com os mesmos atributos.

   A disposição é determinística: o mesmo grafo exporta-se sempre igual, para
   que duas exportações possam ser comparadas.
   ===================================================================== */

const FAMILY_COLOR = {
  propriedade: '#818cf8', governança: '#38bdf8', financeiro: '#fda4af',
  contratual: '#2dd4bf', judicial: '#f59e0b', afiliação: '#fbbf24',
  documental: '#94a3b8', outra: '#64748b'
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const cut = (s, n) => { const t = String(s || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/* círculo + relaxamento determinístico (ordem por id) */
export function layoutDeterministic(nodes, edges, w, h) {
  const pos = new Map();
  const ordered = nodes.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const N = ordered.length;
  if (!N) return pos;
  /* área útil: deixa margem para o cabeçalho (avisos) e para a legenda em baixo */
  const top = 76, bottom = h - 104;
  const cx = w / 2, cy = (top + bottom) / 2;
  const availH = Math.max(120, bottom - top);
  if (N === 1) { pos.set(ordered[0].id, { x: cx, y: cy, vx: 0, vy: 0 }); return pos; }
  const R = Math.max(90, Math.min(w * 0.36, availH * 0.44));
  ordered.forEach((n, i) => {
    const a = (i / N) * Math.PI * 2 - Math.PI / 2;
    pos.set(n.id, { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * (availH * 0.42), vx: 0, vy: 0 });
  });
  const links = (edges || []).filter((e) => pos.has(e.from) && pos.has(e.to));
  const MIN = 150;
  for (let it = 0; it < 160; it++) {
    ordered.forEach((a) => {
      const pa = pos.get(a.id);
      ordered.forEach((b) => {
        if (a.id === b.id) return;
        const pb = pos.get(b.id);
        const dx = pa.x - pb.x, dy = pa.y - pb.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        if (d < MIN) { const push = (MIN - d) * 0.5; pa.vx += (dx / d) * push; pa.vy += (dy / d) * push; }
      });
    });
    links.forEach((e) => {
      const pa = pos.get(e.from), pb = pos.get(e.to);
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d - 210) * 0.012;
      pa.vx += (dx / d) * f; pa.vy += (dy / d) * f;
      pb.vx -= (dx / d) * f; pb.vy -= (dy / d) * f;
    });
    ordered.forEach((n) => {
      const p = pos.get(n.id);
      p.x += p.vx * 0.35; p.y += p.vy * 0.35;
      p.vx *= 0.7; p.vy *= 0.7;
      p.x = Math.max(90, Math.min(w - 90, p.x));
      p.y = Math.max(top + 30, Math.min(bottom - 30, p.y));
    });
  }
  return pos;
}

export function graphToSvg(graph, opts = {}) {
  const W = Number(opts.width) || 1100;
  const H = Number(opts.height) || 720;
  const nodes = (graph.nodes || []);
  const pos = layoutDeterministic(nodes, graph.edges || [], W, H);
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Grafo de entidades e relações com proveniência">');
  out.push('<title>' + esc((graph.project && graph.project.title) || 'Grafo das provas') + '</title>');
  out.push('<rect width="' + W + '" height="' + H + '" fill="#0b1220"/>');

  /* arestas primeiro, para ficarem por baixo dos nós */
  (graph.edges || []).forEach((e) => {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) return;
    const color = e.confidence && e.confidence.level === 'contraditoria' ? '#ef4444' : (FAMILY_COLOR[e.family] || '#64748b');
    const dash = e.inferred ? ' stroke-dasharray="7 5"' : '';
    out.push('<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) +
      '" stroke="' + color + '" stroke-width="' + (e.confidence && e.confidence.level === 'corroborada' ? 2.4 : 1.6) + '"' + dash + ' opacity="0.9"/>');
    /* rótulo da aresta deslocado na perpendicular: não cai em cima da linha nem do nó */
    /* o rótulo fica a 34% do percurso a partir da origem: dois rótulos no mesmo
       par de nós não caem um sobre o outro */
    const t0 = 0.34;
    const mx = a.x + (b.x - a.x) * t0, my = a.y + (b.y - a.y) * t0;
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / L, ny = dx / L;
    out.push('<text x="' + (mx + nx * 11).toFixed(1) + '" y="' + (my + ny * 11 + 3).toFixed(1) +
      '" fill="#94a3b8" font-size="9" text-anchor="middle" font-family="system-ui,sans-serif" style="paint-order:stroke;stroke:#0b1220;stroke-width:3px">' +
      esc(cut(e.label || e.type, 26)) + (e.inferred ? ' (inferida)' : '') + '</text>');
  });

  /* nós */
  nodes.forEach((n) => {
    const p = pos.get(n.id);
    if (!p) return;
    const r = 9 + Math.min(9, (n.degree || 0) * 1.6);
    out.push('<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + (n.color || '#64748b') + '" opacity="0.92"/>');
    /* nome acima do nó, tipo abaixo: menos colisões com as arestas que chegam */
    out.push('<text x="' + p.x.toFixed(1) + '" y="' + (p.y - r - 8).toFixed(1) + '" fill="#e2e8f0" font-size="11.5" text-anchor="middle" font-family="system-ui,sans-serif" style="paint-order:stroke;stroke:#0b1220;stroke-width:3px">' +
      esc(cut(n.name, 26)) + '</text>');
    out.push('<text x="' + p.x.toFixed(1) + '" y="' + (p.y + r + 13).toFixed(1) + '" fill="#64748b" font-size="8.5" text-anchor="middle" font-family="system-ui,sans-serif">' +
      esc(n.typeLabel + (n.disambiguator ? ' · ' + cut(n.disambiguator, 18) : (n.homonymRisk ? ' · homonímia possível' : ''))) + '</text>');
  });

  /* legenda e avisos: a exportação não sai do contexto */
  const fams = [...new Set((graph.edges || []).map((e) => e.family))];
  let ly = H - 18 - (fams.length * 13);
  out.push('<text x="16" y="' + (ly - 16) + '" fill="#94a3b8" font-size="10" font-family="system-ui,sans-serif">legenda: cor da aresta = família da relação · tracejada = inferência declarada · vermelha = contraditória</text>');
  fams.forEach((f, i) => {
    out.push('<line x1="16" y1="' + (ly + i * 13) + '" x2="40" y2="' + (ly + i * 13) + '" stroke="' + (FAMILY_COLOR[f] || '#64748b') + '" stroke-width="2"/>');
    out.push('<text x="46" y="' + (ly + i * 13 + 3) + '" fill="#cbd5e1" font-size="9" font-family="system-ui,sans-serif">' + esc(f) + '</text>');
  });
  const s = graph.stats || {};
  out.push('<text x="' + (W - 16) + '" y="18" text-anchor="end" fill="#e2e8f0" font-size="11" font-family="system-ui,sans-serif">' +
    esc(cut((graph.project && graph.project.title) || 'Grafo', 48)) + '</text>');
  out.push('<text x="' + (W - 16) + '" y="33" text-anchor="end" fill="#94a3b8" font-size="9" font-family="system-ui,sans-serif">' +
    esc((s.nodes || 0) + ' entidades · ' + (s.edges || 0) + ' relações · ' + (s.edgesCorroborated || 0) + ' corroboradas · ' +
      (s.edgesWithSingleOrigin || 0) + ' com uma só origem · ' + (s.inferred || 0) + ' inferidas') + '</text>');
  out.push('<text x="16" y="20" fill="#fbbf24" font-size="10" font-family="system-ui,sans-serif">uma linha não é prova: abra a aresta no serviço para ver as provas que a sustentam</text>');
  out.push('<text x="16" y="34" fill="#64748b" font-size="9" font-family="system-ui,sans-serif">gerado em ' + esc(new Date().toISOString()) + ' · exportação de dados do próprio projecto</text>');
  if (graph.filter && graph.filter.applied) {
    out.push('<text x="16" y="48" fill="#64748b" font-size="9" font-family="system-ui,sans-serif">filtro temporal: ' +
      esc((graph.filter.from || '—') + ' a ' + (graph.filter.to || '—')) + ' · ' + (graph.filter.relationsExcludedByPeriod || 0) +
      ' relação(ões) fora do período · ' + (graph.filter.relationsWithoutPeriod || 0) + ' sem período declarado</text>');
  }
  out.push('</svg>');
  return out.join('\n');
}

export function graphToDot(graph) {
  const q = (s) => '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const lines = ['digraph "' + ((graph.project && graph.project.title) || 'grafo').replace(/"/g, '') + '" {',
    '  rankdir=LR;', '  node [shape=ellipse, style=filled, fontname="Helvetica"];',
    '  edge [fontname="Helvetica", fontsize=9];',
    '  /* uma linha não é prova: cada aresta traz as provas que a sustentam em evidence_ids */'];
  (graph.nodes || []).forEach((n) => {
    lines.push('  ' + q(n.id) + ' [label=' + q(cut(n.name, 40) + '\\n' + n.typeLabel) + ', fillcolor="' + (n.color || '#64748b') + '"];');
  });
  (graph.edges || []).forEach((e) => {
    const attrs = [
      'label=' + q(cut(e.label || e.type, 40)),
      'style=' + (e.inferred ? 'dashed' : 'solid'),
      'color=' + q(e.confidence && e.confidence.level === 'contraditoria' ? '#ef4444' : (FAMILY_COLOR[e.family] || '#64748b')),
      'tooltip=' + q((e.confidence && e.confidence.level) + ': ' + (e.confidence && e.confidence.rationale)),
      'evidence_ids=' + q((e.evidenceIds || []).join(','))
    ];
    lines.push('  ' + q(e.from) + ' -> ' + q(e.to) + ' [' + attrs.join(', ') + '];');
  });
  lines.push('}');
  return lines.join('\n');
}

export function graphExportPayload(graph, { format, generatedBy }) {
  return {
    format,
    generatedAt: new Date().toISOString(),
    generatedBy: generatedBy || null,
    warnings: [
      'uma linha não é prova: cada aresta lista as provas que a sustentam',
      'co-ocorrência não é relação e não é exportada como aresta',
      'relações inferidas estão marcadas (inferred=true) e não substituem prova'
    ],
    filter: graph.filter || { applied: false },
    legend: graph.legend,
    stats: graph.stats,
    project: graph.project,
    nodes: graph.nodes,
    edges: graph.edges,
    candidates: graph.candidates
  };
}
