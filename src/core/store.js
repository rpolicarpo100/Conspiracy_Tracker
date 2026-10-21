/* =====================================================================
   VN · ESTADO DA APLICAÇÃO
   Estado explícito, histórico navegável e derivação de visibilidade.
   A UI e o motor gráfico apenas lêem estado e emitem acções.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const Q = VN.query;

  function createStore(model, opts) {
    opts = opts || {};
    const listeners = {};
    const allTypes = new Set(model.entities.map((e) => e.type));
    const allFamilies = new Set(model.relations.map((r) => r.family));
    const allStatuses = new Set(model.relations.map((r) => r.status));
    const allKinds = new Set(model.relations.map((r) => r.kind));

    const state = {
      model: model,
      theme: 'dark',
      filters: {
        types: new Set(allTypes),
        families: new Set(allFamilies),
        statuses: new Set(allStatuses),
        kinds: new Set(),
        sources: new Set(),
        yearFrom: null,
        yearTo: null,
        text: '',
        docsOnly: false
      },
      settings: {
        maxPerExpand: 24,        // limite de vizinhos por expansão
        groupGhosts: true,       // agrupamento visual de vizinhos não carregados
        maxGhosts: 14,           // máximo de grupos "+N" simultâneos
        showLabels: true,
        showEdgeLabels: false,
        hideDocuments: false,    // ocultação temporária de documentos
        layout: 'fcose',
        seedSize: 14,
        animate: true
      },
      loaded: new Set(),         // nós carregados (carregamento progressivo)
      pinned: new Set(),         // nós fixados pelo utilizador
      hidden: new Set(),         // ocultação temporária individual
      selected: null,            // {kind:'node'|'edge', id}
      hover: null,
      path: { a: null, b: null, maxSteps: 4, excludeDocs: true, results: null, activeIndex: 0, meta: null },
      search: { q: '', results: [], open: false, active: -1 },
      lastAction: 'Inicialização',
      history: [],
      future: [],
      seen: {},                  // contadores de desempenho/telemetria local
      view: { zoom: 1, fps: 0, renderedNodes: 0, renderedEdges: 0, layoutMs: 0 }
    };

    function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return () => off(evt, fn); }
    function off(evt, fn) { listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn); }
    function emit(evt, payload) { (listeners[evt] || []).forEach((fn) => { try { fn(payload, state); } catch (e) { console.error('[store]', e); } }); }

    function snapshot(label) {
      state.history.push({
        label: label,
        at: Date.now(),
        filters: {
          types: new Set(state.filters.types), families: new Set(state.filters.families),
          statuses: new Set(state.filters.statuses), sources: new Set(state.filters.sources),
          kinds: new Set(state.filters.kinds),
          yearFrom: state.filters.yearFrom, yearTo: state.filters.yearTo,
          text: state.filters.text, docsOnly: state.filters.docsOnly
        },
        loaded: new Set(state.loaded),
        hidden: new Set(state.hidden),
        selected: state.selected
      });
      if (state.history.length > 40) state.history.shift();
      state.future.length = 0;
    }

    /* ---------- visibilidade derivada ---------- */
    function masks() {
      const m = Q.applyFilters(model, Object.assign({}, state.filters, { pinned: Array.from(state.pinned) }));
      // restringir ao carregado (carregamento progressivo) + fixados
      const nodes = new Set();
      m.nodes.forEach((id) => { if (state.loaded.has(id) || state.pinned.has(id)) nodes.add(id); });
      state.pinned.forEach((id) => { if (model.byId.has(id)) nodes.add(id); });
      state.hidden.forEach((id) => nodes.delete(id));
      if (state.settings.hideDocuments) {
        Array.from(nodes).forEach((id) => { if ((model.byId.get(id) || {}).type === 'document') nodes.delete(id); });
      }
      const edges = new Set();
      m.edges.forEach((id) => {
        const r = model.relById.get(id);
        if (r && nodes.has(r.from) && nodes.has(r.to)) edges.add(id);
      });
      return { nodes: nodes, edges: edges, temporal: m.temporal, allowedEdges: m.edges };
    }

    /* Vizinhos elegíveis que ainda não estão carregados, agrupados por tipo. */
    function ghosts(mask) {
      if (!state.settings.groupGhosts) return [];
      const out = [];
      mask.nodes.forEach((id) => {
        const groups = new Map();
        (model.neighbors.get(id) || []).forEach((r) => {
          if (!mask.allowedEdges.has(r.id)) return;
          const other = r.from === id ? r.to : r.from;
          if (mask.nodes.has(other) || state.hidden.has(other)) return;
          if (state.settings.hideDocuments && (model.byId.get(other) || {}).type === 'document') return;
          const t = (model.byId.get(other) || {}).type || 'unknown';
          if (!groups.has(t)) groups.set(t, []);
          groups.get(t).push({ id: other, rel: r });
        });
        groups.forEach((members, type) => {
          out.push({
            id: 'ghost|' + id + '|' + type, anchor: id, type: type,
            count: members.length, members: members,
            color: (model.entityTypes[type] || {}).color || '#94a3b8',
            label: (model.entityTypes[type] || {}).label || type
          });
        });
      });
      // Limitar a carga visual: prioriza o nó seleccionado e os maiores grupos.
      const sel = state.selected && state.selected.kind === 'node' ? state.selected.id : null;
      const pinned = state.pinned;
      out.sort((a, b) => {
        const pa = (a.anchor === sel ? 1000 : 0) + (pinned.has(a.anchor) ? 500 : 0) + a.count;
        const pb = (b.anchor === sel ? 1000 : 0) + (pinned.has(b.anchor) ? 500 : 0) + b.count;
        return pb - pa;
      });
      const limited = out.slice(0, state.settings.maxGhosts || 14);
      if (!sel) return limited;
      // com selecção activa, mostrar todos os grupos do nó seleccionado + os maiores
      const selGhosts = out.filter((x) => x.anchor === sel);
      const rest = limited.filter((x) => x.anchor !== sel);
      return selGhosts.concat(rest).slice(0, (state.settings.maxGhosts || 14) + selGhosts.length);
    }

    /* ---------- acções ---------- */
    const api = {
      state, on, off, emit, masks, ghosts, snapshot, allTypes, allFamilies, allStatuses, allKinds,

      seed() {
        const ranked = model.entities.slice().sort((a, b) =>
          (model.stats.get(b.id).degree) - (model.stats.get(a.id).degree));
        state.loaded = new Set(ranked.slice(0, state.settings.seedSize).map((e) => e.id));
        // incluir relações entre carregados
        state.lastAction = 'Semente inicial: ' + state.loaded.size + ' entidades com mais ligações';
        emit('load');
        emit('change', { reason: 'seed' });
      },

      ensureLoaded(id) {
        if (!id || state.loaded.has(id)) return false;
        state.loaded.add(id);
        return true;
      },

      expand(id, level) {
        level = Math.max(1, level || 1);
        snapshot('Expandir ' + (model.byId.get(id) || {}).name);
        const added = new Set();
        let frontier = new Set([id]);
        const perLimit = state.settings.maxPerExpand;
        for (let l = 0; l < level; l++) {
          const next = new Set();
          let count = 0;
          frontier.forEach((fid) => {
            const rels = (model.neighbors.get(fid) || []).slice().sort((a, b) => b.statusWeight - a.statusWeight);
            for (const r of rels) {
              if (count >= perLimit * Math.max(1, frontier.size)) break;
              const other = r.from === fid ? r.to : r.from;
              if (state.loaded.has(other) || added.has(other) || state.hidden.has(other)) continue;
              const o = model.byId.get(other);
              if (!o) continue;
              if (state.settings.hideDocuments && o.type === 'document') continue;
              added.add(other); next.add(other); count++;
            }
          });
          next.forEach((n) => state.loaded.add(n));
          frontier = next;
          if (!next.size) break;
        }
        state.lastAction = 'Expansão de ' + (model.byId.get(id) || {}).name + ' (nível ' + level + '): +' + added.size;
        emit('change', { reason: 'expand', anchor: id, added: added });
        return added;
      },

      expandGhost(ghostId) {
        const [tag, anchor, type] = ghostId.split('|');
        const g = api.ghosts(api.masks()).find((x) => x.id === ghostId);
        if (!g) return;
        snapshot('Carregar ' + g.members.length + ' ' + g.label.toLowerCase());
        const limit = state.settings.maxPerExpand;
        g.members.slice(0, limit).forEach((m) => state.loaded.add(m.id));
        g.members.slice(limit).forEach((m) => state.pinned.delete(m.id));
        state.lastAction = 'Grupo aberto: ' + g.count + ' ' + g.label.toLowerCase() + ' ligadas a ' +
          (model.byId.get(anchor) || {}).name + (g.count > limit ? ' (limite ' + limit + ')' : '');
        emit('change', { reason: 'ghost', anchor: anchor, type: type });
      },

      collapse(id) {
        snapshot('Recolher ramo de ' + (model.byId.get(id) || {}).name);
        const neighbors = new Set();
        (model.neighbors.get(id) || []).forEach((r) => {
          const other = r.from === id ? r.to : r.from;
          // não recolher se o vizinho tem outras ligações a nós fixados/visíveis fora do ramo
          const keep = (model.neighbors.get(other) || []).some((r2) => {
            const o2 = r2.from === other ? r2.to : r2.from;
            return o2 !== id && (state.pinned.has(o2) || o2 === state.path.a || o2 === state.path.b);
          });
          if (!keep) neighbors.add(other);
        });
        neighbors.forEach((n) => { if (!state.pinned.has(n) && n !== state.path.a && n !== state.path.b) state.loaded.delete(n); });
        state.lastAction = 'Ramo recolhido: -' + neighbors.size + ' entidades';
        emit('change', { reason: 'collapse', anchor: id });
      },

      loadAll() {
        snapshot('Carregar toda a rede');
        model.entities.forEach((e) => state.loaded.add(e.id));
        state.lastAction = 'Toda a rede carregada (' + state.loaded.size + ' entidades)';
        emit('change', { reason: 'loadAll' });
      },

      loadLevels(level) {
        snapshot('Explorar ' + level + ' nível(is) a partir da semente');
        const base = Array.from(state.loaded);
        base.forEach((id) => api.expand(id, level));
      },

      togglePin(id) {
        if (state.pinned.has(id)) state.pinned.delete(id); else state.pinned.add(id);
        emit('change', { reason: 'pin', id: id });
      },

      hide(id, on) {
        if (on === false) state.hidden.delete(id); else state.hidden.add(id);
        state.lastAction = on === false ? 'Elemento reposto' : 'Elemento ocultado temporariamente';
        emit('change', { reason: 'hide', id: id });
      },
      unhideAll() { state.hidden.clear(); emit('change', { reason: 'unhide' }); },

      select(sel) {
        state.selected = sel;
        if (sel && sel.kind === 'node') api.ensureLoaded(sel.id);
        emit('select', sel);
        emit('change', { reason: 'select' });
      },

      setFilter(patch, label) {
        snapshot(label || 'Alteração de filtro');
        Object.assign(state.filters, patch);
        state.lastAction = label || 'Filtro actualizado';
        emit('filters');
        emit('change', { reason: 'filter' });
      },
      toggleFilterSet(key, value) {
        const set = state.filters[key];
        if (set.has(value)) set.delete(value); else set.add(value);
        state.lastAction = 'Filtro ' + key + ': ' + value;
        emit('filters');
        emit('change', { reason: 'filter' });
      },
      resetFilters() {
        snapshot('Limpar filtros');
        state.filters.types = new Set(allTypes);
        state.filters.families = new Set(allFamilies);
        state.filters.statuses = new Set(allStatuses);
        state.filters.kinds = new Set();
        state.filters.sources = new Set();
        state.filters.yearFrom = null;
        state.filters.yearTo = null;
        state.filters.text = '';
        state.filters.docsOnly = false;
        state.lastAction = 'Filtros limpos';
        emit('filters'); emit('change', { reason: 'filter' });
      },

      setSetting(k, v) {
        state.settings[k] = v;
        state.lastAction = 'Definição: ' + k + ' = ' + v;
        emit('change', { reason: 'setting', key: k });
      },

      setTheme(t) { state.theme = t; emit('theme', t); },

      setPath(patch) {
        Object.assign(state.path, patch);
        emit('path');
      },
      setSearch(patch) { Object.assign(state.search, patch); emit('search'); },

      undo() {
        const prev = state.history.pop();
        if (!prev) return;
        state.future.push({
          filters: state.filters, loaded: new Set(state.loaded), hidden: new Set(state.hidden),
          selected: state.selected, label: prev.label
        });
        state.filters = Object.assign({}, state.filters, prev.filters);
        state.filters.kinds = new Set(prev.filters.kinds || []);
        state.loaded = new Set(prev.loaded);
        state.hidden = new Set(prev.hidden);
        state.selected = prev.selected;
        state.lastAction = 'Anulado: ' + prev.label;
        emit('change', { reason: 'undo' });
        emit('filters');
      },
      redo() {
        const nxt = state.future.pop();
        if (!nxt) return;
        state.loaded = new Set(nxt.loaded);
        state.hidden = new Set(nxt.hidden);
        state.selected = nxt.selected;
        state.lastAction = 'Refeito: ' + nxt.label;
        emit('change', { reason: 'redo' });
      },

      dateRange() {
        // devolve o domínio efectivo para a cronologia
        return model.timeline;
      }
    };

    return api;
  }

  VN.createStore = createStore;
})(typeof window !== 'undefined' ? window : globalThis);
