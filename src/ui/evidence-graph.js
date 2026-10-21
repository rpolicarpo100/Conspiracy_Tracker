/* =====================================================================
   GRAFO DAS PROVAS (SVG, sem bibliotecas)

   Desenha apenas o que o servidor devolveu. Regras visuais que não se negociam:
   · aresta sólida = relação com prova; tracejada = inferência declarada;
   · cor da aresta por família, nunca por «suspeita»;
   · co-ocorrências só aparecem se o utilizador as pedir, e aparecem como
     linhas pontilhadas cinzentas com o rótulo «não é relação»;
   · clicar abre a proveniência: que provas sustentam aquela linha.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const SVGNS = 'http://www.w3.org/2000/svg';

  const s = (tag, attrs, kids) => {
    const n = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach((k) => { if (attrs[k] != null) n.setAttribute(k, attrs[k]); });
    (kids || []).forEach((c) => n.appendChild(c));
    return n;
  };
  const FAMILY_COLOR = {
    propriedade: '#818cf8', governança: '#38bdf8', financeiro: '#fda4af',
    contratual: '#2dd4bf', judicial: '#f59e0b', afiliação: '#fbbf24',
    documental: '#94a3b8', outra: '#64748b'
  };

  /* disposição determinística: círculo inicial + relaxamento com limites.
     Sem simulação caótica: o mesmo grafo desenha-se sempre do mesmo modo. */
  function layout(nodes, edges, w, h) {
    const pos = new Map();
    if (!nodes.length) return pos;
    const N = nodes.length;
    const R = Math.min(w, h) * 0.34;
    const cx = w / 2, cy = h / 2;
    if (N === 1) { pos.set(nodes[0].id, { x: cx, y: cy - 10, vx: 0, vy: 0 }); return pos; }
    nodes.forEach((n, i) => {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      pos.set(n.id, { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, vx: 0, vy: 0 });
    });
    const links = edges.filter((e) => pos.has(e.from) && pos.has(e.to));
    const MIN = 78;              // distância mínima entre centros
    for (let it = 0; it < 140; it++) {
      nodes.forEach((a) => {
        const pa = pos.get(a.id);
        nodes.forEach((b) => {
          if (a.id === b.id) return;
          const pb = pos.get(b.id);
          let dx = pa.x - pb.x, dy = pa.y - pb.y;
          let d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          if (d < MIN) {
            const push = (MIN - d) * 0.5;
            pa.vx += (dx / d) * push; pa.vy += (dy / d) * push;
          }
        });
      });
      links.forEach((e) => {
        const pa = pos.get(e.from), pb = pos.get(e.to);
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = (d - 165) * 0.02;
        pa.vx += (dx / d) * f; pa.vy += (dy / d) * f;
        pb.vx -= (dx / d) * f; pb.vy -= (dy / d) * f;
      });
      nodes.forEach((n) => {
        const p = pos.get(n.id);
        p.x += Math.max(-6, Math.min(6, p.vx));
        p.y += Math.max(-6, Math.min(6, p.vy));
        p.vx *= 0.55; p.vy *= 0.55;
        // manter dentro da área útil
        p.x = Math.max(48, Math.min(w - 48, p.x));
        p.y = Math.max(34, Math.min(h - 34, p.y));
        // e sem fugir demasiado do centro
        const dx = p.x - cx, dy = p.y - cy;
        const dd = Math.sqrt(dx * dx + dy * dy);
        const maxR = Math.min(w, h) * 0.44;
        if (dd > maxR) { p.x = cx + (dx / dd) * maxR; p.y = cy + (dy / dd) * maxR; }
      });
    }
    return pos;
  }

  function render(host, data, opts) {
    opts = opts || {};
    while (host.firstChild) host.removeChild(host.firstChild);
    const graph = data.graph || data;
    const W = opts.width || 760, H = opts.height || 460;

    const wrap = document.createElement('div');
    wrap.className = 'evg-wrap';
    wrap.style.cssText = 'position:relative;border:1px solid var(--line,#2a3546);border-radius:8px;overflow:hidden;background:var(--panel,#0f1520)';

    const svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: String(H), role: 'img', 'aria-label': 'Grafo de entidades e relações com proveniência' });
    const defs = s('defs', {}, [
      s('marker', { id: 'evg-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' }, [
        s('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#64748b' })
      ])
    ]);
    svg.appendChild(defs);
    const root = s('g', {});
    svg.appendChild(root);
    wrap.appendChild(svg);

    const state = {
      showCandidates: !!opts.showCandidates, selected: null, query: '',
      hiddenTypes: new Set(), k: 1, tx: 0, ty: 0
    };

    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const visibleNodes = () => graph.nodes.filter((n) => !state.hiddenTypes.has(n.type));
    const visibleEdges = () => graph.edges.filter((e) => nodeById.has(e.from) && nodeById.has(e.to) &&
      !state.hiddenTypes.has(nodeById.get(e.from).type) && !state.hiddenTypes.has(nodeById.get(e.to).type));

    let pos = layout(visibleNodes(), visibleEdges(), W, H);

    function draw() {
      while (root.firstChild) root.removeChild(root.firstChild);
      const gnodes = visibleNodes(), gedges = visibleEdges();
      if (!gnodes.length) {
        root.appendChild(s('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', 'font-size': '11', fill: '#94a3b8' },
          [document.createTextNode('Sem entidades: registe provas com entidades para começar o grafo')]));
        return;
      }
      pos = layout(gnodes, gedges, W, H);
      const layerEdges = s('g', {});
      const layerCand = s('g', {});
      const layerNodes = s('g', {});
      root.appendChild(layerEdges); root.appendChild(layerCand); root.appendChild(layerNodes);

      /* candidatos por co-ocorrência: só a pedido, e dizendo o que são */
      if (state.showCandidates) {
        (graph.candidates || []).forEach((c) => {
          const pa = pos.get(c.from), pb = pos.get(c.to);
          if (!pa || !pb) return;
          layerCand.appendChild(s('line', {
            x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, stroke: '#475569', 'stroke-width': 1,
            'stroke-dasharray': '2 4', opacity: '0.8'
          }));
        });
      }

      /* arestas */
      gedges.forEach((e) => {
        const pa = pos.get(e.from), pb = pos.get(e.to);
        if (!pa || !pb) return;
        const colour = FAMILY_COLOR[e.family] || '#64748b';
        const contrad = e.confidence && e.confidence.level === 'contraditoria';
        const line = s('line', {
          x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y,
          stroke: contrad ? '#ef4444' : colour,
          'stroke-width': contrad ? 2.6 : 1.8,
          'stroke-dasharray': e.inferred ? '6 4' : null,
          'marker-end': e.direction === 'directed' ? 'url(#evg-arrow)' : null,
          'marker-start': e.direction === 'mutual' ? 'url(#evg-arrow)' : null,
          opacity: state.selected && state.selected.id !== e.id ? 0.35 : 0.95,
          style: 'cursor:pointer'
        });
        line.addEventListener('click', (ev) => { ev.stopPropagation(); state.selected = { kind: 'edge', id: e.id, data: e }; opts.onSelect && opts.onSelect(state.selected); });
        line.appendChild(s('title', {}, [document.createTextNode(e.label + ' · ' + (e.confidence ? e.confidence.level : '') + ' · ' + e.evidenceCount + ' prova(s)')]));
        layerEdges.appendChild(line);
      });

      /* nós */
      gnodes.forEach((n) => {
        const p = pos.get(n.id);
        const r = 9 + Math.min(11, n.evidenceIds.length * 2.2);
        const gg = s('g', { transform: 'translate(' + p.x + ',' + p.y + ')', style: 'cursor:pointer' });
        const dim = state.query && n.name.toLowerCase().indexOf(state.query.toLowerCase()) < 0;
        gg.appendChild(s('circle', {
          r: r, fill: n.color, 'fill-opacity': dim ? 0.18 : 0.9,
          stroke: state.selected && state.selected.kind === 'node' && state.selected.id === n.id ? '#fff' : '#0b111a',
          'stroke-width': state.selected && state.selected.kind === 'node' && state.selected.id === n.id ? 2.5 : 1.2
        }));
        const below = gnodes.indexOf(n) % 2 === 0;
        gg.appendChild(s('text', {
          y: below ? r + 14 : -(r + 8), 'text-anchor': 'middle', 'font-size': '10', fill: '#e2e8f0',
          style: 'paint-order:stroke;stroke:#0b111a;stroke-width:2.5px'
        }, [document.createTextNode(n.name.length > 26 ? n.name.slice(0, 24) + '…' : n.name)]));
        gg.appendChild(s('title', {}, [document.createTextNode(
          n.name + ' · ' + n.typeLabel + ' · ' + n.evidenceIds.length + ' prova(s)' + (n.disambiguator ? ' · ' + n.disambiguator : ' · sem desambiguador')
        )]));
        gg.addEventListener('click', (ev) => { ev.stopPropagation(); state.selected = { kind: 'node', id: n.id, data: n }; opts.onSelect && opts.onSelect(state.selected); });
        layerNodes.appendChild(gg);
      });
      applyTransform();
    }

    function applyTransform() { root.setAttribute('transform', 'translate(' + state.tx + ',' + state.ty + ') scale(' + state.k + ')'); }

    /* zoom e deslocamento */
    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const f = ev.deltaY < 0 ? 1.12 : 0.89;
      state.k = Math.max(0.35, Math.min(3.5, state.k * f));
      applyTransform();
    }, { passive: false });
    let drag = null;
    svg.addEventListener('mousedown', (ev) => { drag = { x: ev.clientX, y: ev.clientY, tx: state.tx, ty: state.ty }; });
    window.addEventListener('mouseup', () => { drag = null; });
    svg.addEventListener('mousemove', (ev) => {
      if (!drag) return;
      state.tx = drag.tx + (ev.clientX - drag.x);
      state.ty = drag.ty + (ev.clientY - drag.y);
      applyTransform();
    });

    /* controlos */
    const bar = document.createElement('div');
    bar.className = 'chips';
    bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:6px;border-bottom:1px solid var(--line,#2a3546)';

    const search = document.createElement('input');
    search.placeholder = 'procurar entidade…';
    search.className = 'input';
    search.style.cssText = 'font-size:10px;padding:3px 6px;min-width:140px';
    search.addEventListener('input', (e) => { state.query = e.target.value; draw(); });
    bar.appendChild(search);

    const candLabel = document.createElement('label');
    candLabel.style.cssText = 'font-size:10px;color:var(--muted);display:flex;gap:4px;align-items:center';
    const cand = document.createElement('input');
    cand.type = 'checkbox';
    cand.checked = state.showCandidates;
    cand.addEventListener('change', () => { state.showCandidates = cand.checked; draw(); });
    candLabel.appendChild(cand);
    candLabel.appendChild(document.createTextNode('mostrar co-ocorrências (' + (graph.candidates || []).length + ') — não são relações'));
    bar.appendChild(candLabel);

    const types = [...new Set(graph.nodes.map((n) => n.type))];
    types.forEach((tp) => {
      const meta = (data.entityTypes || graph.legend.entityTypes || {})[tp] || { label: tp, color: '#64748b' };
      const l = document.createElement('label');
      l.style.cssText = 'font-size:10px;display:flex;gap:4px;align-items:center;color:var(--muted)';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = true;
      cb.addEventListener('change', () => {
        if (cb.checked) state.hiddenTypes.delete(tp); else state.hiddenTypes.add(tp);
        draw();
      });
      const dot = document.createElement('span');
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:' + meta.color;
      l.appendChild(cb); l.appendChild(dot); l.appendChild(document.createTextNode(meta.label));
      bar.appendChild(l);
    });

    wrap.insertBefore(bar, svg);
    host.appendChild(wrap);

    /* legenda + avisos, sempre visíveis */
    const legend = document.createElement('div');
    legend.className = 'warnbox';
    legend.style.cssText = 'font-size:10px;margin-top:6px;line-height:1.5';
    legend.innerHTML = '';
    const mkLine = (txt) => { const d = document.createElement('div'); d.textContent = txt; legend.appendChild(d); };
    mkLine('Linha sólida: relação com prova registada. Linha tracejada: inferência declarada (não é prova).');
    mkLine('Linha vermelha: existe prova contrária ligada — não sustenta conclusão.');
    mkLine('Co-ocorrências, quando pedidas, são pontilhadas e cinzentas: aparecer no mesmo documento não prova relação.');
    mkLine('Clique numa entidade ou numa linha para ver as provas que a sustentam.');
    (graph.legend.warnings || []).forEach((w) => mkLine('· ' + w));
    host.appendChild(legend);

    draw();
    return { svg, wrap, state, draw, redraw: draw };
  }

  /* Exportação PNG no próprio browser: o desenho já está aqui, não há razão
     para o servidor rasterizar. Exporta o que está visível, com o fundo do
     serviço, a 2× para não sair desfocado. Devolve false se não for possível. */
  function exportPng(svgEl, filename) {
    if (!svgEl || !svgEl.getBBox) return false;
    let W = 0, H = 0;
    const vb = (svgEl.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every((x) => !isNaN(x))) { W = vb[2]; H = vb[3]; }
    if (!W || !H) return false;
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('width', String(W));
    clone.setAttribute('height', String(H));
    clone.setAttribute('xmlns', SVGNS);
    const xml = new XMLSerializer().serializeToString(clone);
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * scale; canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.onload = () => {
      try { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); } catch { /* desenho falhou */ }
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        const href = URL.createObjectURL(blob);
        a.href = href; a.download = filename || 'grafo.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 4000);
      }, 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    return true;
  }

  VN.evidenceGraph = { render, exportPng, FAMILY_COLOR };
})(typeof window !== 'undefined' ? window : globalThis);
