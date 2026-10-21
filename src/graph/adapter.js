/* =====================================================================
   VN · MOTOR GRÁFICO (adaptador Cytoscape)
   Único ficheiro que conhece a biblioteca. Substituível por Sigma,
   G6 ou canvas próprio desde que implemente esta interface:
     init, sync, relayout, focusOn, fit, zoomBy, highlight, clearHighlight,
     setTheme, setLabels, destroy, onNodeTap, onEdgeTap, onBgTap, stats
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});

  function themeStyles(theme) {
    const dark = theme !== 'light';
    const ink = dark ? '#e2e8f0' : '#0f172a';
    const labelBg = dark ? 'rgba(8,15,28,.82)' : 'rgba(255,255,255,.88)';
    const dimOpacity = dark ? 0.14 : 0.18;
    const dash = { probable: 'dashed', alleged: 'dashed', unverified: 'dotted', contradicted: 'dashed', confirmed: 'solid' };
    const st = [
      { selector: 'node', style: {
          'background-image': 'data(img)',
          'background-fit': 'cover',
          'background-image-opacity': 1,
          'background-color': 'data(color)',
          'width': 'data(size)', height: 'data(size)',
          'border-width': 0,
          'shape': 'round-rectangle',
          'label': 'data(label)',
          'font-size': 11,
          'font-weight': 600,
          'font-family': 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          'color': ink,
          'text-valign': 'bottom', 'text-halign': 'center',
          'text-margin-y': 5,
          'text-wrap': 'ellipsis', 'text-max-width': 124,
          'text-background-color': labelBg,
          'text-background-opacity': 0.9,
          'text-background-padding': 3,
          'text-background-shape': 'round-rectangle',
          'overlay-opacity': 0,
          'z-index': 10
      }},
      { selector: 'node[kind = "ghost"]', style: {
          'background-image': 'none',
          'background-color': 'data(color)', 'background-opacity': 0.16,
          'border-width': 1.4, 'border-color': 'data(color)', 'border-style': 'dashed',
          'shape': 'round-rectangle', 'width': 34, height: 26,
          'font-size': 10, 'font-weight': 700, 'color': 'data(color)',
          'text-valign': 'center', 'text-margin-y': 0, 'text-background-opacity': 0,
          'z-index': 6
      }},
      { selector: 'node[status = "unverified"], node[status = "alleged"]', style: { 'border-width': 0 }},
      { selector: 'node.faded', style: { 'opacity': dimOpacity }},
      { selector: 'node.hl', style: { 'z-index': 30 }},
      { selector: 'node.sel', style: { 'overlay-opacity': 0.16, 'overlay-color': '#f8fafc', 'overlay-padding': 8 }},
      { selector: 'node.path', style: { 'overlay-opacity': 0.2, 'overlay-color': '#22d3ee', 'overlay-padding': 9 }},
      { selector: 'node.pinned', style: { 'overlay-opacity': 0.12, 'overlay-color': '#fbbf24', 'overlay-padding': 6 }},
      { selector: 'node.searchhit', style: { 'overlay-opacity': 0.22, 'overlay-color': '#fde047', 'overlay-padding': 7 }},
      { selector: 'edge', style: {
          'width': 'data(w)',
          'line-color': 'data(color)',
          'target-arrow-color': 'data(color)',
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.7,
          'curve-style': 'bezier',
          'control-point-step-size': 34,
          'opacity': 0.72,
          'line-style': 'data(style)',
          'label': 'data(relLabel)',
          'font-size': 9,
          'font-weight': 600,
          'color': ink,
          'text-background-color': labelBg,
          'text-background-opacity': 0.92,
          'text-background-padding': 2,
          'text-rotation': 'autorotate',
          'text-margin-y': -6,
          'text-opacity': 0,
          'overlay-opacity': 0,
          'z-index': 4
      }},
      { selector: 'edge.showlabel', style: { 'text-opacity': 1, 'z-index': 20 }},
      { selector: 'edge.faded', style: { 'opacity': 0.05 }},
      { selector: 'edge.hl', style: { 'opacity': 0.98, 'width': 'data(w2)', 'z-index': 25 }},
      { selector: 'edge.sel', style: { 'opacity': 1, 'width': 3.4, 'line-color': '#f8fafc', 'target-arrow-color': '#f8fafc', 'z-index': 26 }},
      { selector: 'edge.path', style: { 'opacity': 1, 'width': 3.6, 'line-color': '#22d3ee', 'target-arrow-color': '#22d3ee', 'z-index': 28 }}
    ];
    return st;
  }

  function Engine(container, opts) {
    opts = opts || {};
    this.container = container;
    this.cy = null;
    this.theme = opts.theme || 'dark';
    this.handlers = {};
    this.fps = 0;
    this.lastLayoutMs = 0;
    this.layoutCount = 0;
  }

  Engine.prototype.init = function () {
    const self = this;
    this.cy = g.cytoscape({
      container: this.container,
      elements: [],
      style: themeStyles(this.theme),
      wheelSensitivity: 0.22,
      minZoom: 0.08,
      maxZoom: 3.2,
      textureOnViewport: false,
      motionBlur: false,
      pixelRatio: 'auto',
      boxSelectionEnabled: false,
      selectionType: 'single'
    });
    const cy = this.cy;

    cy.on('tap', 'node', (evt) => {
      const d = evt.target.data();
      if (d.kind === 'ghost') { self.emit('ghostTap', { id: d.id, ghost: d.ghost, originalEvent: evt.originalEvent }); return; }
      self.emit('nodeTap', { id: d.id, originalEvent: evt.originalEvent });
    });
    cy.on('tap', 'edge', (evt) => self.emit('edgeTap', { id: evt.target.data('id'), originalEvent: evt.originalEvent }));
    cy.on('tap', (evt) => { if (evt.target === cy) self.emit('bgTap', evt); });
    cy.on('dbltap', 'node', (evt) => self.emit('nodeDblTap', { id: evt.target.data('id') }));
    cy.on('cxttap', 'node', (evt) => {
      const oe = evt.originalEvent;
      if (oe && oe.preventDefault) oe.preventDefault();
      self.emit('nodeContext', { id: evt.target.data('id'), x: oe.clientX, y: oe.clientY });
    });
    cy.on('cxttap', 'edge', (evt) => {
      const oe = evt.originalEvent;
      if (oe && oe.preventDefault) oe.preventDefault();
      self.emit('edgeContext', { id: evt.target.data('id'), x: oe.clientX, y: oe.clientY });
    });
    cy.on('mouseover', 'node', (evt) => {
      const oe = evt.originalEvent;
      self.emit('nodeHover', { id: evt.target.data('id'), x: oe.clientX, y: oe.clientY });
    });
    cy.on('mouseout', 'node', () => self.emit('nodeHover', null));
    cy.on('viewport', () => self.measureZoom());

    // amostrador de FPS (só durante actividade)
    let frames = 0, last = performance.now(), raf = null;
    function loop() {
      frames++;
      const now = performance.now();
      if (now - last >= 1000) {
        self.fps = Math.round((frames * 1000) / (now - last));
        frames = 0; last = now;
        self.emit('stats', self.stats());
      }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    this._raf = raf;
    this.emit('ready');
    return this;
  };

  Engine.prototype.on = function (evt, fn) { (this.handlers[evt] = this.handlers[evt] || []).push(fn); return this; };
  Engine.prototype.emit = function (evt, payload) { (this.handlers[evt] || []).forEach((f) => f(payload)); };

  /* Etiquetas e opacidade adaptam-se ao zoom para evitar sobreposição
     desnecessária em redes densas. Só actua ao cruzar limiares (barato). */
  Engine.prototype.measureZoom = function () {
    if (!this.cy) return;
    const z = this.cy.zoom();
    this.zoom = z;
    const hide = z < 0.62;
    const dense = z < 0.42;
    if (hide !== this._hideLabels || dense !== this._dense) {
      this._hideLabels = hide; this._dense = dense;
      this.cy.batch(() => {
        this.cy.nodes().toggleClass('hidelabel', hide);
        this.cy.edges().toggleClass('hidelabel', hide || !this._edgeLabelsOn);
        this.cy.edges().toggleClass('dense', dense);
      });
    }
    this.emit('zoom', z);
  };

  /* Sincroniza elementos de forma incremental (diff por id). */
  Engine.prototype.sync = function (view, opts) {
    opts = opts || {};
    const cy = this.cy;
    const wantNodes = new Map(view.nodes.map((n) => [n.id, n]));
    const wantEdges = new Map(view.edges.map((e) => [e.id, e]));

    // remoções
    cy.batch(() => {
      cy.nodes().forEach((n) => { if (!wantNodes.has(n.id())) n.remove(); });
      cy.edges().forEach((e) => { if (!wantEdges.has(e.id())) e.remove(); });

      // nós
      wantNodes.forEach((n, id) => {
        const el = cy.getElementById(id);
        if (el.nonempty()) {
          if (el.data('label') !== n.label) el.data('label', n.label);
          if (el.data('size') !== n.size) el.data('size', n.size);
          if (el.data('status') !== n.status) el.data('status', n.status);
          if (el.data('deg') !== n.deg) el.data('deg', n.deg);
          if (el.data('img') !== n.img) el.data('img', n.img);
          if (el.data('kind') !== n.kind) el.data('kind', n.kind);
          if (el.hasClass('pin') !== !!n.pinned) { if (n.pinned) el.addClass('pin'); else el.removeClass('pin'); }
        } else {
          cy.add({ group: 'nodes', data: n, classes: n.pinned ? 'pinned' : '' });
        }
      });
      // arestas
      wantEdges.forEach((e, id) => {
        if (cy.getElementById(id).nonempty()) return;
        if (!cy.getElementById(e.source).nonempty()) return;
        if (!cy.getElementById(e.target).nonempty()) return;
        cy.add({ group: 'edges', data: e });
      });
    });

    // Degradação automática: acima do limiar, desenhar sem imagens/etiquetas
    const count = cy.nodes().length;
    const lite = count > (this.liteThreshold || 420);
    if (lite !== this._lite) {
      this._lite = lite;
      cy.batch(() => cy.nodes().toggleClass('lite', lite));
      this.emit('perfmode', { lite: lite, nodes: count });
    }
    if (opts.layout !== false) this.relayout(opts);
    this.measureZoom();
  };

  /* Layout incremental: posiciona apenas elementos novos junto do contexto,
     evitando recalcular toda a rede (ver docs/BENCHMARKS.md). */
  Engine.prototype.relayout = function (opts) {
    opts = opts || {};
    const cy = this.cy;
    const nodes = cy.nodes();
    if (!nodes.length) return;
    const mode = opts.mode || 'fcose';
    const isNew = (n) => n.data('_lv') == null;
    const fresh = nodes.filter(isNew);
    const anchorId = opts.anchor;
    const t0 = performance.now();

    const presetFresh = (near) => {
      const anchor = near ? cy.getElementById(near) : null;
      const base = anchor && anchor.nonempty() ? anchor.position() : { x: 0, y: 0 };
      fresh.forEach((n, i) => {
        const a = (i / Math.max(1, fresh.length)) * Math.PI * 2;
        const rad = 90 + (i % 5) * 26;
        n.position({ x: base.x + Math.cos(a) * rad, y: base.y + Math.sin(a) * rad });
      });
    };

    const finish = () => {
      nodes.forEach((n) => n.data('_lv', 1));
      this.lastLayoutMs = Math.round(performance.now() - t0);
      this.layoutCount++;
      if (opts.fit) this.fitToContent();
      this.emit('layout', { ms: this.lastLayoutMs, mode: mode, nodes: nodes.length });
    };

    if (mode === 'preset') { finish(); return; }
    if (fresh.length === 0 && opts.force !== true) { finish(); return; }

    presetFresh(anchorId);

    // fcose limitado: para redes grandes o custo cresce muito (benchmark em docs/)
    const target = fresh.length ? cy.collection().union(fresh).union(fresh.neighborhood()) : nodes;
    const useFcose = (mode === 'fcose') && target.length <= 420;
    if (useFcose && g.cytoscapeFcose) {
      const l = target.layout({
        name: 'fcose', animate: false, randomize: true, fit: opts.fit === true,
        nodeDimensionsIncludeLabels: true, nodeRepulsion: 7800, idealEdgeLength: 92,
        edgeElasticity: 0.42, gravity: 0.28, nestingFactor: 0.1, numIter: 1400,
        tile: true, packComponents: true
      });
      l.one('layoutstop', finish);
      l.run();
      return;
    }
    // fallback determinístico e barato: posicionamento concêntrico por grau
    const concentric = nodes.layout({ name: 'concentric', fit: opts.fit === true, animate: false,
      concentric: (n) => n.data('deg') || 1, levelWidth: () => 3, minNodeSpacing: 34, avoidOverlap: true });
    concentric.one('layoutstop', finish);
    concentric.run();
  };

  Engine.prototype.focusOn = function (id, opts) {
    opts = opts || {};
    const cy = this.cy;
    const n = cy.getElementById(id);
    if (!n.nonempty()) return false;
    const z = opts.zoom || Math.max(cy.zoom(), 1.15);
    const pos = n.position();
    cy.animate({ center: { eles: n }, zoom: z }, { duration: opts.duration != null ? opts.duration : 320, easing: 'ease-out' });
    return pos;
  };

  Engine.prototype.fitToContent = function () {
    if (!this.cy) return;
    const pad = { top: 86, bottom: 66, left: 48, right: 48 };
    try { this.cy.fit(this.cy.elements(), pad); }
    catch (e) { try { this.cy.fit(this.cy.elements(), 60); } catch (e2) {} }
    this.measureZoom();
  };

  Engine.prototype.fit = function (padding) {
    if (!this.cy) return;
    const pad = padding || { top: 86, bottom: 66, left: 48, right: 48 };
    try { this.cy.animate({ fit: { eles: this.cy.elements(), padding: pad } }, { duration: 280 }); }
    catch (e) { this.fitToContent(); }
  };

  Engine.prototype.zoomBy = function (factor) {
    const cy = this.cy;
    cy.zoom({ level: Math.max(0.08, Math.min(3.2, cy.zoom() * factor)), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    this.measureZoom();
  };

  /* Garante que o nó âncora e os nós novos ficam visíveis, com o menor
     movimento possível. Se o conjunto for maior que a vista, ajusta. */
  Engine.prototype.ensureVisible = function (anchorId, ids, opts) {
    opts = opts || {};
    if (!this.cy) return;
    const cy = this.cy;
    const target = cy.collection();
    if (anchorId) target.merge(cy.getElementById(anchorId));
    (ids || []).forEach((id) => target.merge(cy.getElementById(id)));
    if (!target.length) return;
    const pad = { top: 80, bottom: 60, left: 60, right: 60 };
    const bb = target.boundingBox();
    const ext = cy.extent();
    const vw = ext.w, vh = ext.h;
    const insideX = bb.x1 >= ext.x1 + pad.left && bb.x2 <= ext.x2 - pad.right;
    const insideY = bb.y1 >= ext.y1 + pad.top && bb.y2 <= ext.y2 - pad.bottom;
    const tooBig = bb.w > vw * 0.82 || bb.h > vh * 0.82;
    if (tooBig) {
      cy.animate({ fit: { eles: target, padding: pad } }, { duration: 320 });
    } else if (!insideX || !insideY) {
      const dx = (bb.x1 + bb.x2) / 2 - (ext.x1 + ext.x2) / 2;
      const dy = (bb.y1 + bb.y2) / 2 - (ext.y1 + ext.y2) / 2;
      const p = cy.pan();
      cy.animate({ pan: { x: p.x - dx * cy.zoom(), y: p.y - dy * cy.zoom() } }, { duration: 280 });
    }
    this.measureZoom();
  };

  Engine.prototype.highlight = function (spec) {
    const cy = this.cy;
    if (!spec) return this.clearHighlight();
    const nodeIds = spec.nodes || [];
    const edgeIds = spec.edges || [];
    const keep = new Set([].concat(nodeIds));
    cy.batch(() => {
      cy.elements().removeClass('hl faded path');
      if (spec.dimOthers !== false) {
        cy.elements().addClass('faded');
        nodeIds.forEach((id) => { const n = cy.getElementById(id); n.removeClass('faded').addClass('hl'); n.connectedEdges().forEach((e) => { if (edgeIds.indexOf(e.id()) >= 0) e.removeClass('faded').addClass('hl'); }); });
        edgeIds.forEach((id) => { const e = cy.getElementById(id); if (e.nonempty()) { e.removeClass('faded').addClass('hl'); e.connectedNodes().removeClass('faded').addClass('hl'); } });
      }
      if (spec.pathMode) {
        nodeIds.forEach((id) => cy.getElementById(id).addClass('path'));
        edgeIds.forEach((id) => { const e = cy.getElementById(id); if (e.nonempty()) e.addClass('path').addClass('showlabel'); });
      }
    });
    if (spec.fit) this.fit();
  };

  Engine.prototype.clearHighlight = function () {
    if (!this.cy) return;
    this.cy.batch(() => this.cy.elements().removeClass('hl faded path showlabel'));
  };

  Engine.prototype.markSearch = function (ids) {
    if (!this.cy) return;
    this.cy.nodes().removeClass('searchhit');
    (ids || []).forEach((id) => this.cy.getElementById(id).addClass('searchhit'));
  };

  Engine.prototype.setSelection = function (kind, id) {
    if (!this.cy) return;
    this.cy.elements().removeClass('sel');
    if (!id) return;
    const el = this.cy.getElementById(id);
    if (el.nonempty()) el.addClass('sel');
  };

  Engine.prototype.setLabels = function (show, showEdge) {
    if (!this.cy) return;
    this._edgeLabelsOn = !!showEdge;
    this.cy.batch(() => {
      this.cy.nodes().toggleClass('hidelabel', !show);
      this.cy.edges().toggleClass('hidelabel', !showEdge || (this.zoom || 1) < 0.62);
      if (showEdge) this.cy.edges().addClass('showlabel'); else this.cy.edges().removeClass('showlabel');
    });
  };

  Engine.prototype.setTheme = function (theme) {
    this.theme = theme;
    if (!this.cy) return;
    this.cy.style(themeStyles(theme));
    this.cy.style().update();
  };

  Engine.prototype.panTo = function (dir) {
    const cy = this.cy;
    const p = cy.pan();
    const step = 90;
    const d = { left: [step, 0], right: [-step, 0], up: [0, step], down: [0, -step] }[dir];
    if (d) cy.pan({ x: p.x + d[0], y: p.y + d[1] });
  };

  Engine.prototype.getPositions = function () {
    const out = {};
    if (!this.cy) return out;
    this.cy.nodes().forEach((n) => { out[n.id()] = n.position(); });
    return out;
  };

  Engine.prototype.applyPositions = function (pos) {
    if (!this.cy) return;
    this.cy.batch(() => {
      Object.keys(pos).forEach((id) => { const n = this.cy.getElementById(id); if (n.nonempty()) n.position(pos[id]); });
    });
  };

  Engine.prototype.stats = function () {
    const cy = this.cy;
    return {
      fps: this.fps, zoom: cy ? cy.zoom() : 0,
      nodes: cy ? cy.nodes().length : 0,
      edges: cy ? cy.edges().length : 0,
      layoutMs: this.lastLayoutMs, layouts: this.layoutCount
    };
  };

  /* Forçar/desactivar manualmente o modo de desempenho. */
  Engine.prototype.setLite = function (on) {
    if (!this.cy) return;
    this._lite = !!on;
    this.cy.batch(() => this.cy.nodes().toggleClass('lite', !!on));
    this.emit('perfmode', { lite: !!on, nodes: this.cy.nodes().length, manual: true });
  };
  Engine.prototype.isLite = function () { return !!this._lite; };

  Engine.prototype.destroy = function () {
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this.cy) this.cy.destroy();
    this.cy = null;
  };

  VN.Engine = Engine;
  VN.themeStyles = themeStyles;
})(typeof window !== 'undefined' ? window : globalThis);
