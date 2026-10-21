/* =====================================================================
   VN · Controlador
   Liga modelo → estado → motor gráfico → painéis. Não contém regras de
   dados (model.js/query.js) nem desenho de grafo (adapter.js).
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const D = VN.dom;
  const { el, $, $$, clear } = D;

  let model = null, store = null, engine = null;
  const ctx = {};

  const TYPE_LABEL = () => model.entityTypes;

  /* ---------------- arranque ---------------- */
  /* Conta / projectos / chaves de IA / administração */
  function wireAccount() {
    const btn = D.el ? document.getElementById('btnAccount') : document.getElementById('btnAccount');
    if (!btn || !VN.accountUI) return;
    btn.addEventListener('click', () => {
      const body = VN.accountUI.mount();
      VN.panels.modal('Conta e administração', body, { wide: true });
    });
    fetch('api/auth/me', { credentials: 'same-origin' }).then((r) => r.json()).then((d) => {
      if (d && d.user) {
        const label = document.getElementById('accLabel');
        if (label) label.textContent = d.user.email.split('@')[0];
        btn.title = 'Sessão: ' + d.user.email + ' (' + d.user.role + ')';
      }
    }).catch(() => {});
  }

  function boot() {
    model = VN.model.normalize(selectDataset());
    store = VN.createStore(model);
    store.state.trail = [];

    // tema guardado / preferência do sistema
    const saved = localStorage.getItem('vn-theme');
    const theme = saved || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    setTheme(theme, true);

    ctx.store = store; ctx.model = model; ctx.app = app;
    VN.panels.init(ctx);
    VN.details.init(ctx);
    VN.paths.init(ctx);
    VN.searchpage.init(ctx);
    VN.timeline.init(ctx);

    engine = new VN.Engine($('#cy'), { theme: store.state.theme });
    ctx.engine = app.engine = engine;
    engine.init();

    engine.on('nodeTap', (e) => {
      if (e.originalEvent && e.originalEvent.shiftKey) { store.togglePin(e.id); refresh(); return; }
      app.selectEntity(e.id);
    });
    engine.on('nodeDblTap', (e) => { app.expand(e.id, 1); app.focusEntity(e.id); });
    engine.on('edgeTap', (e) => app.selectRelation(e.id));
    engine.on('ghostTap', (e) => { store.expandGhost(e.id); refresh(); toast('Grupo de vizinhos carregado'); });
    engine.on('bgTap', () => { if (store.state.selected) { store.select(null); refreshDetails(); } });
    engine.on('nodeHover', (e) => showTooltip(e));
    engine.on('nodeContext', (e) => nodeMenu(e));
    engine.on('edgeContext', (e) => edgeMenu(e));
    engine.on('stats', (s) => { store.state.view = Object.assign(store.state.view, s); updateStatus(); });
    engine.on('layout', (l) => { store.state.view.layoutMs = l.ms; updateStatus(); });
    engine.on('perfmode', (p) => {
      D.toast(p.lite
        ? 'Modo de desempenho activo: ' + p.nodes + ' nós. Imagens e etiquetas substituídas por formas simples para manter a interacção fluida.'
        : 'Modo completo: imagens e etiquetas visíveis (' + p.nodes + ' nós).', p.lite ? 'warn' : '', 5200);
    });

    store.on('change', () => { refresh(); });
    store.on('theme', () => {});
    store.on('path', () => VN.paths.refreshBar());

    // semente inicial
    store.seed();
    seedLabelsShown = store.state.settings.showLabels;
    updateDatasetBadge();
    buildLegendBar();
    VN.timeline.compute();
    refresh({ fit: true });
    VN.timeline.draw();
    setTimeout(() => { try { engine.fitToContent(); } catch (e) {} }, 260);

    wireTopbar();
    wireToolbar();
    wireSidebar();
    wireKeyboard();
    wireSearch();
    wireAccount();
    restoreHash();

    D.toast('Semente: ' + store.state.loaded.size + ' entidades com mais ligações. Pesquise (⌘K) ou expanda.', '', 6000);
    updateStatus();
  }

  let seedLabelsShown = true;

  /* Escolha do conjunto: demonstração fictícia ou dados reais validados. */
  function selectDataset() {
    const ds = localStorage.getItem('vn-dataset') || 'fictional';
    if (ds === 'real') {
      try {
        const raw = localStorage.getItem('vn-real-bundle');
        if (raw) {
          const obj = JSON.parse(raw);
          const v = VN.realdata.validateBundle(obj);
          if (v.ok) return obj;
          console.warn('Conjunto real guardado não passa validação; a usar demonstração.', v.errors);
          D.toast('Os dados reais guardados falharam a validação. A abrir demonstração.', 'bad', 7000);
        }
      } catch (e) { console.warn(e); }
    }
    return g.VN_DATA;
  }

  function updateDatasetBadge() {
    const badge = $('#fictionBadge');
    if (!badge) return;
    const real = !!(model.meta && model.meta.fictional === false);
    badge.innerHTML = real
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l6 3v4c0 3-2.6 5.3-6 6-3.4-.7-6-3-6-6v-4z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 8l2 2 3.4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg> Dados reais'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l6 3v4c0 3-2.6 5.3-6 6-3.4-.7-6-3-6-6v-4z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 5v4M8 11v.6" stroke="currentColor" stroke-width="1.4"/></svg> Dados fictícios';
    badge.title = real ? 'Conjunto real importado e validado — abrir consola' : 'Demonstração fictícia — abrir nota metodológica';
    badge.onclick = real ? () => app.openConsole() : () => VN.panels.showFiction(() => app.openConsole());
  }

  /* ---------------- vista → motor ---------------- */
  function buildView() {
    const masks = store.masks();
    const st = store.state;
    const nodes = [], edges = [];
    masks.nodes.forEach((id) => {
      const e = model.byId.get(id);
      if (!e) return;
      const s = model.stats.get(id);
      const size = Math.max(24, Math.min(50, 24 + s.degree * 1.9));
      nodes.push({
        id: id, label: shorten(e.name), color: e.typeColor, size: size,
        status: e.status, deg: s.degree, kind: e.type,
        img: VN.avatars.dataUri(e, Math.round(size * 2)), type: e.type,
        pinned: st.pinned.has(id)
      });
    });
    masks.edges.forEach((id) => {
      const r = model.relById.get(id);
      if (!r) return;
      const w = 1 + Math.max(0, (r.statusWeight || 0)) * 0.42 + (r.conf ? r.conf * 0.1 : 0);
      edges.push({
        id: r.id, source: r.from, target: r.to,
        color: r.familyColor, w: Math.round(w * 10) / 10, w2: Math.round((w + 2.2) * 10) / 10,
        style: r.status === 'confirmed' ? 'solid' : r.status === 'unverified' ? 'dotted' : 'dashed',
        relLabel: r.kindLabel, status: r.status
      });
    });
    // nós agregados de vizinhos não carregados
    const ghosts = store.ghosts(masks);
    ghosts.forEach((gh) => {
      nodes.push({
        id: gh.id, label: '+' + gh.count, color: gh.color, size: 30, status: 'unverified',
        deg: gh.count, kind: 'ghost', img: null, type: gh.type, ghost: gh
      });
      // ligação ténue ao anfitrião, para o grupo ficar ancorado
      edges.push({
        id: 'ge|' + gh.id, source: gh.anchor, target: gh.id, color: gh.color,
        w: 1, w2: 2, style: 'dotted', relLabel: gh.label + ' (' + gh.count + ')', status: 'unverified'
      });
    });
    return { nodes, edges, masks };
  }

  function shorten(name) {
    let s = String(name)
      .replace(/\bS\.?A\.?|\bSGPS\b|\bLda\.?|\bS\.à r\.l\.|\bFCR\b|\bSCR\b/g, '')
      .replace(/\s*—\s*.*$/, '')
      .replace(/\s{2,}/g, ' ').trim();
    if (s.length > 34) s = s.slice(0, 32).trim() + '…';
    return s;
  }

  function refresh(opts) {
    opts = opts || {};
    const view = buildView();
    engine.sync(view, {
      anchor: opts.anchor,
      fit: opts.fit,
      mode: store.state.settings.layout,
      force: opts.force
    });
    if (opts.fit && opts.fitFocus) engine.fit();
    VN.panels.renderSidebar();
    VN.panels.renderLegendBar();
    renderDetails();
    VN.paths.refreshBar();
    VN.timeline.compute();
    VN.timeline.draw();
    updateStatus();
    pushHash();
    if (store.state.selected) engine.setSelection(store.state.selected.kind, store.state.selected.id);
  }

  function refreshDetails() { VN.details.render(); }

  function renderDetails() {
    const sel = store.state.selected;
    const body = $('#detailsbody');
    if (!body) return;
    // se o separador é entidade/ligação, redesenhar; se for caminhos/cronologia, deixar
    const tab = VN.details.currentTab();
    if (tab === 'summary' || tab === 'relation') VN.details.render();
    else if (tab === 'paths') VN.paths.renderPanel(body);
    else if (tab === 'timeline') VN.timeline.renderPanel(body);
  }

  function updateStatus() {
    VN.panels.renderStatusBar({ perf: engine ? engine.stats() : null });
  }

  /* ---------------- acções ---------------- */
  const app = {
    engine: null,
    ctx: ctx,

    selectEntity(id) {
      store.ensureLoaded(id);
      store.select({ kind: 'node', id: id });
      store.state.trail.push({ at: Date.now(), label: 'Selecção: ' + (model.byId.get(id) || {}).name, id: id, kind: 'selecção' });
      if (store.state.trail.length > 60) store.state.trail.shift();
      engine.setSelection('node', id);
      VN.details.setTab('summary');
      refreshDetails();
      updateStatus();
    },

    selectRelation(id) {
      const r = model.relById.get(id);
      if (!r) return;
      store.ensureLoaded(r.from); store.ensureLoaded(r.to);
      store.select({ kind: 'edge', id: id });
      engine.setSelection('edge', id);
      VN.details.setTab('relation');
      refreshDetails();
      app.highlightRelation(id);
      updateStatus();
    },

    highlightRelation(id) {
      const r = model.relById.get(id);
      if (!r) return;
      engine.highlight({ nodes: [r.from, r.to], edges: [id], dimOthers: true });
      engine.focusOn(r.from, { zoom: Math.max(engine.zoom || 1, 1.05) });
    },

    focusEntity(id, fitTo) {
      if (!model.byId.has(id)) return;
      store.ensureLoaded(id);
      if (!store.masks().nodes.has(id)) {
        // se está escondido por filtro, repor tipo
        const e = model.byId.get(id);
        store.state.filters.types.add(e.type);
        store.state.hidden.delete(id);
      }
      refresh({ anchor: id });
      engine.focusOn(id, { zoom: 1.25 });
      app.selectEntity(id);
      store.state.trail.push({ at: Date.now(), label: 'Centrado em ' + (model.byId.get(id) || {}).name, id: id, kind: 'centrar' });
    },

    expand(id, levels) {
      const added = store.expand(id, levels || 1);
      refresh({ anchor: id });
      if (added && added.size) {
        const ids = Array.from(added);
        setTimeout(() => engine.ensureVisible(id, ids), 340);
      }
      if (added && added.size) D.toast('+' + added.size + ' entidades ligadas a ' + shorten((model.byId.get(id) || {}).name));
      else D.toast('Sem novas ligações a carregar', 'warn');
      store.state.trail.push({ at: Date.now(), label: 'Expandir ' + (model.byId.get(id) || {}).name, id: id, kind: 'expansão' });
    },

    collapse(id) { store.collapse(id); refresh({ anchor: id }); D.toast('Ramo recolhido'); },

    setPathMode(on) { VN.paths.setMode(on); },
    runPath() { VN.paths.execute(); },
    refresh: refresh,

    setTheme(t) { setTheme(t); },
    showQuality() { VN.panels.showQuality(); },
    showHelp() { VN.panels.showHelp(); },
    showFiction(onOpen) { VN.panels.showFiction(onOpen); },

    exportReport(all) {
      const html = VN.report.buildReport(ctx, { all: !!all });
      const tagReal = model.meta && model.meta.fictional === false ? 'dados-reais' : 'meridiano';
      D.download('relatorio-' + tagReal + '-' + stamp() + '.html', html, 'text/html;charset=utf-8');
      D.toast('Relatório exportado com referências às provas', 'ok');
    },
    exportEntity(id) {
      const html = VN.report.buildEntity(ctx, id || (store.state.selected || {}).id);
      D.download('ficha-' + (id || 'entidade') + '-' + stamp() + '.html', html, 'text/html;charset=utf-8');
      D.toast('Ficha exportada');
    },
    exportPaths() {
      const html = VN.report.buildPaths(ctx);
      if (!html) { D.toast('Sem caminhos para exportar', 'warn'); return; }
      D.download('caminhos-' + stamp() + '.html', html, 'text/html;charset=utf-8');
      D.toast('Caminhos exportados com fontes');
    },
    exportCSV() {
      D.download('relacoes-' + stamp() + '.csv', VN.report.buildCSV(ctx), 'text/csv;charset=utf-8');
      D.toast('CSV exportado (todas as relações com provas)');
    },
    exportJSON() {
      D.download('modelo-' + stamp() + '.json', VN.report.buildJSON(ctx), 'application/json');
      D.toast('Modelo completo exportado em JSON');
    },
    showPerf() { perfModal(); },
    openConsole() { VN.console ? VN.console.open() : D.toast('Módulo de investigação indisponível', 'bad'); },

    updateStatus() { updateStatus(); },

    undoTo(idx) {
      // anula até ao índice pedido
      const hist = store.state.history;
      const target = Math.max(0, idx);
      while (store.state.history.length > target) store.undo();
      refresh();
    }
  };
  g.VN.app = app;

  function stamp() { return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'); }

  function setTheme(t, initial) {
    document.documentElement.setAttribute('data-theme', t);
    document.querySelector('meta[name="color-scheme"]').setAttribute('content', t === 'light' ? 'light dark' : 'dark light');
    localStorage.setItem('vn-theme', t);
    const btn = $('#btnTheme');
    if (btn) btn.setAttribute('aria-pressed', String(t === 'light'));
    if (store) store.setTheme(t);
    if (engine) engine.setTheme(t);
    if (document.body) VN.timeline && VN.timeline.draw && store && VN.timeline.draw();
  }

  /* ---------------- pesquisa (paleta + página completa) ---------------- */
  function wireSearch() { VN.palette.init(ctx); }
  app.search = function (q, opts) {
    if (!model._searchIndex) model._searchIndex = VN.index.build(model);
    return VN.search.run(model._searchIndex, q, opts || {});
  };
  app.searchPage = function (q) { VN.searchpage.open(q); };

  /* ---------------- topbar / toolbar ---------------- */
  function wireTopbar() {
    $('#btnTheme').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
    $('#btnHelp').addEventListener('click', () => VN.panels.showHelp());
    $('#fictionBadge').addEventListener('click', () => VN.panels.showFiction(() => app.openConsole()));
    $('#btnQuality').addEventListener('click', () => VN.panels.showQuality());
    $('#btnList').addEventListener('click', () => VN.list.show(ctx, 'entities'));
    $('#btnExport').addEventListener('click', (ev) => exportMenu(ev));
    const bc = $('#btnConsole'); if (bc) bc.addEventListener('click', () => app.openConsole());
    $('#btnPerf').addEventListener('click', () => perfModal());
  }

  function exportMenu(ev) {
    const r = ev.currentTarget.getBoundingClientRect();
    VN.panels.contextMenu(r.left - 180, r.bottom + 6, [
      { label: 'Relatório completo (HTML, com provas)', run: () => app.exportReport(true) },
      { label: 'Relatório do que está visível', run: () => app.exportReport(false) },
      { sep: true },
      { label: 'Ficha da entidade seleccionada', run: () => app.exportEntity() },
      { label: 'Caminhos encontrados', run: () => app.exportPaths() },
      { sep: true },
      { label: 'Relações em CSV', run: () => app.exportCSV() },
      { label: 'Modelo completo em JSON', run: () => app.exportJSON() },
      { sep: true },
      { label: 'Imprimir / PDF', run: () => window.print() }
    ]);
  }

  function wireToolbar() {
    $$('[data-act]').forEach((btn) => btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      const sel = store.state.selected;
      if (act === 'zoomin') engine.zoomBy(1.25);
      else if (act === 'zoomout') engine.zoomBy(0.8);
      else if (act === 'fit') engine.fit();
      else if (act === 'center') { if (sel) engine.focusOn(sel.kind === 'edge' ? (model.relById.get(sel.id) || {}).from : sel.id); else engine.fit(); }
      else if (act === 'expand1') { if (sel) app.expand(sel.kind === 'edge' ? (model.relById.get(sel.id) || {}).from : sel.id, 1); else D.toast('Selecione um nó ou expanda a partir da semente', 'warn'); }
      else if (act === 'expand2') { if (sel) app.expand(sel.kind === 'edge' ? (model.relById.get(sel.id) || {}).from : sel.id, 2); }
      else if (act === 'collapse') { if (sel) app.collapse(sel.kind === 'edge' ? (model.relById.get(sel.id) || {}).from : sel.id); }
      else if (act === 'path') app.setPathMode(!VN.paths.isMode());
      else if (act === 'labels') { const on = store.state.settings.showLabels = !store.state.settings.showLabels; btn.setAttribute('aria-pressed', String(on)); engine.setLabels(on, store.state.settings.showEdgeLabels); }
      else if (act === 'group') { const on = store.state.settings.groupGhosts = !store.state.settings.groupGhosts; btn.setAttribute('aria-pressed', String(on)); refresh(); }
      else if (act === 'hide') { if (sel) { store.hide(sel.id, true); refresh(); D.toast('Elemento ocultado. Use a legenda ou «repor» para voltar.'); } }
    }));
    const layoutSel = $('#layoutSel');
    if (layoutSel) layoutSel.addEventListener('change', () => { store.setSetting('layout', layoutSel.value); refresh({ force: true }); D.toast('Disposição: ' + layoutSel.options[layoutSel.selectedIndex].text); });
    const tlToggle = $('#timelineToggle');
    if (tlToggle) tlToggle.addEventListener('click', () => setTimeout(() => VN.timeline.draw(), 30));
  }

  function wireSidebar() {
    $$('.sidetab').forEach((b) => b.addEventListener('click', () => {
      $$('.sidetab').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', String(x === b)); });
      VN.panels.renderSidebar();
    }));
    $('#btnUndo').addEventListener('click', () => { store.undo(); refresh(); });
    $('#btnRedo').addEventListener('click', () => { store.redo(); refresh(); });
    $('#btnResetFilters').addEventListener('click', () => { store.resetFilters(); refresh({ fit: true }); D.toast('Filtros limpos'); });
    $('#detailsClose').addEventListener('click', () => { document.body.classList.toggle('details-hidden'); refresh(); });
    $$('.dtab').forEach((b) => b.addEventListener('click', () => VN.details.setTab(b.dataset.dtab)));
  }

  /* ---------------- teclado ---------------- */
  function wireKeyboard() {
    let gPending = false;
    document.addEventListener('keydown', (ev) => {
      const tag = (ev.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || ev.target.isContentEditable;
      const mod = ev.metaKey || ev.ctrlKey;
      if (mod && ev.key.toLowerCase() === 'k') { ev.preventDefault(); $('#search').focus(); $('#search').select(); return; }
      if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) store.redo(); else store.undo(); refresh(); return; }
      if (typing) return;
      if (ev.key === '?') { VN.panels.showHelp(); return; }
      if (ev.key === 'Escape') {
        const modal = $('#modal'); if (modal && !modal.hidden) { modal.hidden = true; document.body.classList.remove('modal-open'); return; }
        $('#ctxmenu').hidden = true;
        if (VN.paths.isMode()) { VN.paths.setMode(false); return; }
        if (store.state.selected) { store.select(null); engine.clearHighlight(); refreshDetails(); }
        return;
      }
      const sel = store.state.selected;
      const selId = sel ? (sel.kind === 'edge' ? (model.relById.get(sel.id) || {}).from : sel.id) : null;
      switch (ev.key.toLowerCase()) {
        case '/': ev.preventDefault(); $('#search').focus(); break;
        case 'f': engine.fit(); break;
        case 'e': if (selId) app.expand(selId, 1); break;
        case 'r': if (selId) app.collapse(selId); break;
        case 'p': app.setPathMode(!VN.paths.isMode()); break;
        case 'l': { const on = store.state.settings.showLabels = !store.state.settings.showLabels; engine.setLabels(on, store.state.settings.showEdgeLabels); break; }
        case 'g': store.setSetting('groupGhosts', !store.state.settings.groupGhosts); refresh(); break;
        case 'h': if (sel) { store.hide(sel.id, true); refresh(); } break;
        case 'c': if (selId) engine.focusOn(selId); else engine.fit(); break;
        case 't': $('#timelineToggle').click(); break;
        case 'u': if (ev.shiftKey) store.redo(); else store.undo(); refresh(); break;
        case 'o': if (selId) VN.panels.contextMenu(window.innerWidth / 2 - 100, 120, nodeMenuItems(selId)); break;
        case '+': case '=': engine.zoomBy(1.2); break;
        case '-': engine.zoomBy(0.83); break;
        case 'arrowleft': engine.panTo('left'); break;
        case 'arrowright': engine.panTo('right'); break;
        case 'arrowup': engine.panTo('up'); break;
        case 'arrowdown': engine.panTo('down'); break;
        default: return;
      }
    });
  }

  /* ---------------- menus contextuais e tooltip ---------------- */
  function nodeMenuItems(id) {
    const e = model.byId.get(id) || {};
    const pinned = store.state.pinned.has(id);
    return [
      { label: 'Abrir detalhes', key: 'Enter', run: () => app.selectEntity(id) },
      { label: 'Expandir ligações directas', key: 'E', run: () => app.expand(id, 1) },
      { label: 'Expandir dois níveis', run: () => app.expand(id, 2) },
      { label: 'Recolher ramo', key: 'R', run: () => app.collapse(id) },
      { sep: true },
      { label: 'Centrar no mapa', key: 'C', run: () => engine.focusOn(id) },
      { label: pinned ? 'Desafixar' : 'Fixar no mapa', run: () => { store.togglePin(id); refresh(); } },
      { label: 'Ocultar temporariamente', key: 'H', run: () => { store.hide(id, true); refresh(); } },
      { label: 'Isolar (ocultar os restantes)', run: () => {
        const keep = new Set([id].concat((model.neighbors.get(id) || []).map((r) => r.from === id ? r.to : r.from)));
        Array.from(store.state.loaded).forEach((n) => { if (!keep.has(n)) store.hide(n, true); });
        refresh(); D.toast('Vista isolada: ' + e.name + ' e vizinhos');
      } },
      { sep: true },
      { label: 'Definir como origem do caminho', run: () => { store.setPath({ a: id }); VN.paths.setMode(true); VN.paths.refreshBar(); } },
      { label: 'Definir como destino do caminho', run: () => { store.setPath({ b: id }); VN.paths.setMode(true); VN.paths.refreshBar(); } },
      { label: 'Ver ligações comuns com o outro extremo', run: () => { VN.paths.setMode(true); VN.details.setTab('paths'); } },
      { sep: true },
      { label: 'Exportar ficha com referências', run: () => app.exportEntity(id) },
      { label: 'Copiar identificador', run: () => { D.copy(id); D.toast('ID copiado: ' + id); } }
    ];
  }
  function nodeMenu(e) { VN.panels.contextMenu(e.x, e.y, nodeMenuItems(e.id)); }
  function edgeMenu(e) {
    const r = model.relById.get(e.id) || {};
    VN.panels.contextMenu(e.x, e.y, [
      { label: 'Ver relação e fonte', run: () => app.selectRelation(e.id) },
      { label: 'Abrir documento-fonte', run: () => r.src ? VN.details.openSource(r.src) : D.toast('Relação sem fonte documental', 'warn') },
      { label: 'Realçar esta ligação', run: () => app.highlightRelation(e.id) },
      { label: 'Caminho entre os extremos', run: () => { store.setPath({ a: r.from, b: r.to }); VN.paths.setMode(true); VN.paths.execute(); } },
      { sep: true },
      { label: 'Ocultar ligação', run: () => { store.hide(e.id, true); refresh(); } },
      { label: 'Copiar citação', run: () => { D.copy('«' + (r.ex || '') + '» — ' + ((model.byId.get(r.src) || {}).name || 'sem fonte') + ' [' + r.id + ']'); D.toast('Citação copiada'); } }
    ]);
  }

  function showTooltip(e) {
    const tip = $('#tooltip');
    if (!e || !e.id) { tip.hidden = true; return; }
    if (e.id.startsWith('ghost|')) {
      const ghosts = store.ghosts(store.masks());
      const gh = ghosts.find((x) => x.id === e.id);
      if (!gh) { tip.hidden = true; return; }
      tip.innerHTML = '<strong>' + D.esc(gh.count + ' ' + gh.label) + '</strong>' +
        '<div class="tmeta">ainda não carregadas · ' + D.esc((model.byId.get(gh.anchor) || {}).name) + '</div>' +
        '<div class="tmeta">clique para carregar (máx. ' + store.state.settings.maxPerExpand + ')</div>';
      tip.hidden = false;
      tip.style.left = Math.min(window.innerWidth - 330, e.x + 14) + 'px';
      tip.style.top = Math.max(8, e.y - 10) + 'px';
      return;
    }
    const ent = model.byId.get(e.id);
    if (!ent) { tip.hidden = true; return; }
    const s = model.stats.get(e.id);
    tip.innerHTML = '<strong>' + D.esc(ent.name) + '</strong>' +
      '<div class="tmeta">' + D.esc(ent.typeLabel) + ' · ' + D.esc(ent.statusLabel) + '</div>' +
      '<div class="tmeta">' + s.degree + ' ligações · ' + s.confirmed + ' confirmadas · ' + s.documents.size + ' documentos</div>' +
      '<div class="tmeta">' + D.esc(ent.short || '') + '</div>';
    tip.hidden = false;
    tip.style.left = Math.min(window.innerWidth - 330, e.x + 14) + 'px';
    tip.style.top = Math.max(8, e.y - 10) + 'px';
  }

  /* ---------------- desempenho ---------------- */
  function perfModal() {
    const s = engine.stats();
    const body = el('div', {}, [
      el('p', { text: 'Indicadores medidos nesta sessão, no seu navegador. Não são estimativas.' }),
      el('table', { class: 'listtable' }, [
        el('thead', {}, [el('tr', {}, ['Indicador', 'Valor'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, [
          ['Fotogramas por segundo (pan/zoom)', s.fps + ' fps'],
          ['Nós renderizados', String(s.nodes)],
          ['Ligações renderizadas', String(s.edges)],
          ['Entidades carregadas', String(store.state.loaded.size) + ' / ' + model.entities.length],
          ['Último cálculo de disposição', s.layoutMs + ' ms'],
          ['Cálculos de disposição nesta sessão', String(s.layouts)],
          ['Zoom actual', s.zoom.toFixed(2)],
          ['Modo de disposição', store.state.settings.layout],
          ['Limite por expansão', String(store.state.settings.maxPerExpand)]
        ].map((r) => el('tr', {}, [el('td', { text: r[0] }), el('td', { text: r[1] })])))
      ]),
      el('h3', { text: 'Estado actual' }),
      el('p', {}, ['Modo: ', el('b', { text: engine.isLite() ? 'desempenho (formas simples)' : 'completo (imagens e etiquetas)' }),
        ' · limiar automático: 420 nós. ', el('button', { class: 'linkbtn', text: 'alternar manualmente', onclick: () => {
          engine.setLite(!engine.isLite()); refresh();
        } })]),
      el('h3', { text: 'Como o grafo se mantém utilizável' }),
      el('ul', {}, [
        el('li', { text: 'Carregamento progressivo: só entra no browser o que é carregado por semente ou expansão explícita.' }),
        el('li', { text: 'Agrupamento de vizinhos: cada tipo de vizinho não carregado é representado por um nó «+N», em vez de centenas de nós.' }),
        el('li', { text: 'Disposição incremental: só os nós novos são posicionados; a rede existente não é recalculada.' }),
        el('li', { text: 'Limite configurável por expansão, para controlar o crescimento.' }),
        el('li', { text: 'Filtros aplicados sobre máscaras, sem reconstruir o modelo.' }),
        el('li', { text: 'Degradação automática acima de 420 nós: sem imagens nem etiquetas, o que evita a queda de fluidez medida nos testes de escala.' })
      ]),
      el('h3', { text: 'Resultados de referência' }),
      el('p', { text: 'As medições de comparação entre bibliotecas (Cytoscape/fcose, d3-force) e os testes de esforço no browser estão em docs/BENCHMARKS.md e docs/BENCHMARKS-raw.json.' }),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn sm', type: 'button', text: 'Teste rápido: carregar tudo e medir', onclick: () => {
          const t0 = performance.now();
          store.loadAll(); refresh({ fit: true, force: true });
          const dt = Math.round(performance.now() - t0);
          D.toast('Rede completa carregada em ' + dt + ' ms (disposição ' + engine.stats().layoutMs + ' ms)', dt > 4000 ? 'warn' : 'ok', 6000);
        } }),
        el('button', { class: 'btn sm', type: 'button', text: 'Repor semente', onclick: () => { store.seed(); refresh({ fit: true }); } })
      ])
    ]);
    VN.panels.modal('Desempenho medido', body);
  }

  /* ---------------- hash / restauro ---------------- */
  let hashTimer = null;
  function pushHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(() => {
      const st = store.state;
      const params = new URLSearchParams();
      if (st.selected) params.set('sel', st.selected.kind + ':' + st.selected.id);
      if (st.path.a) params.set('a', st.path.a);
      if (st.path.b) params.set('b', st.path.b);
      if (st.filters.yearFrom != null) params.set('y0', st.filters.yearFrom);
      if (st.filters.yearTo != null) params.set('y1', st.filters.yearTo);
      const h = params.toString();
      if (h) history.replaceState(null, '', '#' + h);
      else history.replaceState(null, '', location.pathname + location.search);
    }, 250);
  }
  function restoreHash() {
    const h = location.hash.replace(/^#/, '');
    if (!h) return;
    const p = new URLSearchParams(h);
    if (p.get('y0') || p.get('y1')) store.setFilter({ yearFrom: p.get('y0') ? +p.get('y0') : null, yearTo: p.get('y1') ? +p.get('y1') : null }, 'Período restaurado do URL');
    if (p.get('a')) store.state.path.a = p.get('a');
    if (p.get('b')) store.state.path.b = p.get('b');
    const sel = p.get('sel');
    if (sel) {
      const [kind, id] = sel.split(':');
      if (kind === 'node' && model.byId.has(id)) { app.focusEntity(id); }
      else if (kind === 'edge' && model.relById.has(id)) { app.selectRelation(id); }
    }
    if (p.get('a') || p.get('b')) VN.paths.refreshBar();
  }

  /* ---------------- legenda rápida ---------------- */
  function buildLegendBar() { VN.panels.renderLegendBar(); }

  document.addEventListener('DOMContentLoaded', () => {
    try { boot(); }
    catch (e) {
      console.error(e);
      document.body.insertAdjacentHTML('afterbegin', '<div style="padding:16px;color:#fda4af;font:14px system-ui">Erro ao iniciar: ' + D.esc(e.message) + '</div>');
    }
  });
  g.VNBOOT = boot;
})(typeof window !== 'undefined' ? window : globalThis);
