/* VN · Caminhos documentados entre entidades + ligações comuns */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const { el, clear, fmtRange, fmtDate } = VN.dom;
  let CTX = null, mode = false;

  function init(ctx) {
    CTX = ctx;
    const run = document.getElementById('pathRun');
    if (run) run.addEventListener('click', () => execute());
    const close = document.getElementById('pathClose');
    if (close) close.addEventListener('click', () => setMode(false));
    const steps = document.getElementById('pathSteps');
    if (steps) steps.addEventListener('change', () => { CTX.store.state.path.maxSteps = Math.max(1, Math.min(6, +steps.value || 4)); });
    const ex = document.getElementById('pathExcludeDocs');
    if (ex) ex.addEventListener('change', () => { CTX.store.state.path.excludeDocs = ex.checked; });
  }

  function setMode(on) {
    mode = !!on;
    const bar = document.getElementById('pathbar');
    if (bar) bar.hidden = !mode;
    const btn = document.getElementById('btnPath');
    if (btn) btn.setAttribute('aria-pressed', String(mode));
    if (mode) { VN.details.setTab('paths'); refreshBar(); }
    else { CTX.app.engine.clearHighlight(); }
  }
  const isMode = () => mode;

  function refreshBar() {
    const { model, store } = CTX;
    const p = store.state.path;
    const A = document.getElementById('pathA'), B = document.getElementById('pathB');
    if (A) A.textContent = p.a ? (model.byId.get(p.a) || {}).name || p.a : 'seleccione uma entidade e clique em «Origem»';
    if (B) B.textContent = p.b ? (model.byId.get(p.b) || {}).name || p.b : 'seleccione e clique em «Destino»';
    const run = document.getElementById('pathRun');
    if (run) run.disabled = !(p.a && p.b && p.a !== p.b);
  }

  function execute() {
    const { store, model } = CTX;
    const p = store.state.path;
    if (!p.a || !p.b) { VN.dom.toast('Defina a origem e o destino', 'warn'); return; }
    if (p.a === p.b) { VN.dom.toast('Origem e destino iguais', 'warn'); return; }
    const masks = store.masks();
    const excludeTypes = p.excludeDocs ? new Set(['document', 'event', 'transaction']) : null;
    const t0 = performance.now();
    const res = VN.query.findPaths(model, p.a, p.b, {
      maxSteps: p.maxSteps,
      limit: 12,
      excludeTypes: excludeTypes,
      allowedEdges: masks.allowedEdges
    });
    const ms = Math.round(performance.now() - t0);
    store.setPath({ results: res, activeIndex: 0, meta: { ms: ms, at: Date.now() } });
    store.state.lastAction = 'Caminhos ' + (model.byId.get(p.a) || {}).name + ' ↔ ' +
      (model.byId.get(p.b) || {}).name + ': ' + res.paths.length + ' encontrados em ' + ms + ' ms';
    VN.dom.toast(res.paths.length ? res.paths.length + ' caminho(s) encontrados (' + ms + ' ms)' : 'Nenhum caminho dentro do limite de passos e filtros actuais', res.paths.length ? 'ok' : 'warn');
    if (res.paths.length) highlight(0); else CTX.app.engine.clearHighlight();
    VN.details.setTab('paths');
    CTX.app.updateStatus();
  }

  function highlight(i) {
    const { store } = CTX;
    const p = store.state.path;
    if (!p.results || !p.results.paths[i]) return;
    const path = p.results.paths[i];
    store.setPath({ activeIndex: i });
    CTX.app.engine.highlight({ nodes: path.nodes, edges: path.rels.map((r) => r.id), pathMode: true, dimOthers: true });
    CTX.app.engine.fit();
    VN.details.setTab('paths');
  }

  const STATUS_ORDER = ['confirmed', 'probable', 'alleged', 'unverified', 'contradicted'];

  function renderPanel(body) {
    const { store, model } = CTX;
    const p = store.state.path;
    clear(body);
    body.appendChild(el('div', { class: 'warnbox', text: 'Um caminho demonstra apenas que existem relações registadas. Não prova coordenação, acordo, intenção ou crime. A nota de evidência avalia a documentação das ligações, não as pessoas.' }));

    if (!p.results) {
      body.appendChild(el('div', { class: 'empty' }, [
        el('h3', { text: 'Procurar caminhos documentados' }),
        el('p', { text: '1. Selecione uma entidade e clique em «Origem». 2. Selecione outra e clique em «Destino». 3. Defina o número máximo de passos e procure.' }),
        el('p', { style: 'font-size:11.5px;margin-top:8px', text: 'Os resultados são ordenados por qualidade de evidência: elo mais fraco, confiança média, cobertura documental e número de passos.' }),
        el('button', { class: 'btn primary sm', type: 'button', style: 'margin-top:10px', text: 'Abrir modo caminhos', onclick: () => setMode(true) })
      ]));
      return;
    }

    const A = model.byId.get(p.a), B = model.byId.get(p.b);
    body.appendChild(el('div', { class: 'srcmeta', style: 'margin-bottom:8px' }, [
      'Procura entre ', el('b', { style: 'color:var(--ink)', text: (A || {}).name || '—' }), ' e ',
      el('b', { style: 'color:var(--ink)', text: (B || {}).name || '—' }), ' · até ' + p.maxSteps + ' passos · ',
      (p.meta ? p.meta.ms + ' ms' : ''), p.results.truncated ? ' · exploração truncada (limite de orçamento)' : ''
    ]));

    if (!p.results.paths.length) {
      body.appendChild(el('div', { class: 'empty' }, [
        el('h3', { text: 'Nenhum caminho encontrado' }),
        el('p', { text: 'Nenhuma sequência de relações documentadas liga estas entidades dentro do limite de passos e dos filtros activos.' }),
        el('p', { style: 'font-size:11.5px;margin-top:6px', text: 'Isto não significa que não exista relação — significa que não está registada nas fontes carregadas. Aumente os passos, remova filtros ou carregue mais entidades.' }),
        el('button', { class: 'btn sm', type: 'button', style: 'margin-top:8px', text: 'Aumentar para 6 passos', onclick: () => { store.setPath({ maxSteps: 6 }); const inp = document.getElementById('pathSteps'); if (inp) inp.value = 6; execute(); } })
      ]));
    } else {
      p.results.paths.forEach((path, i) => body.appendChild(pathCard(path, i)));
    }

    // ligações comuns
    const common = VN.query.commonNeighbors(model, p.a, p.b, { limit: 20 });
    body.appendChild(el('div', { class: 'block' }, [
      el('h4', {}, ['Ligações comuns directas ', el('span', { class: 'n', text: '(' + common.length + ')' })]),
      common.length ? el('div', {}, common.map((c) => el('div', { class: 'relrow', onclick: () => CTX.app.focusEntity(c.entity.id) }, [
        VN.dom.avatar(c.entity, 28),
        el('div', { class: 'rtext' }, [
          el('div', { class: 'rlabel' }, [el('b', { text: c.entity.name })]),
          el('div', { class: 'rmeta' }, [
            c.entity.typeLabel, '·', c.rels.length + ' ligações a ambos',
            '· qualidade média ' + (Math.round(c.score * 10) / 10) + '/4'
          ])
        ]),
        el('span', { class: 'go', text: '›' })
      ]))) : el('p', { class: 'side-note', text: 'Não existem vizinhos directos comuns. Só é possível relacioná-las por caminhos com intermediários.' })
    ]));

    body.appendChild(el('button', { class: 'btn sm', type: 'button', text: 'Exportar estes caminhos', onclick: () => CTX.app.exportPaths() }));
  }

  function pathCard(path, i) {
    const { model, store } = CTX;
    const active = store.state.path.activeIndex === i;
    const flags = [];
    if (path.hasContradicted) flags.push(['contraditada', 'bad']);
    if (path.hasUnverified) flags.push(['não verificada', 'warn']);
    if (path.hasAlleged) flags.push(['alegada', 'warn']);
    if (path.hasUndated) flags.push(['sem data', '']);

    const steps = path.rels.map((r, k) => {
      const from = model.byId.get(path.nodes[k]);
      return el('div', { class: 'step' }, [
        el('span', { class: 'sn', text: String(k + 1) }),
        el('div', { style: 'flex:1;min-width:0' }, [
          el('div', {}, [
            el('b', { text: (from || {}).name || path.nodes[k] }),
            el('span', { class: 'st-arrow', text: ' → ' }),
            el('span', { class: 'st-kind', text: r.kindLabel }),
            el('span', { class: 'st-arrow', text: ' → ' }),
            el('b', { text: (model.byId.get(path.nodes[k + 1]) || {}).name || path.nodes[k + 1] })
          ]),
          el('div', { class: 'rmeta' }, [
            el('span', { class: 'verifdot', style: 'background:' + r.statusColor + ';color:' + r.statusColor }),
            r.statusLabel, '·', fmtRange(r),
            r.src ? '· ' : '· ', r.src ? el('button', { class: 'linkbtn', text: (model.byId.get(r.src) || {}).name || r.src, onclick: (ev) => { ev.stopPropagation(); VN.details.openSource(r.src); } }) : 'sem fonte',
            el('button', { class: 'linkbtn', text: '· relação', onclick: (ev) => { ev.stopPropagation(); CTX.app.selectRelation(r.id); } })
          ])
        ])
      ]);
    });

    return el('div', { class: 'pathcard' + (active ? ' active' : '') }, [
      el('header', {}, [
        el('b', { text: '#' + (i + 1) }),
        el('span', { class: 'mini', text: path.hops + ' passos' }),
        el('span', { class: 'mini', title: 'Nota de qualidade de evidência', text: 'evidência ' + path.score }),
        el('span', { class: 'verifdot', style: 'background:' + (model.verification[path.minStatus] || {}).color + ';color:' + (model.verification[path.minStatus] || {}).color, title: 'Elo mais fraco: ' + ((model.verification[path.minStatus] || {}).label || '') }),
        el('button', { class: 'btn sm', style: 'margin-left:auto', type: 'button', text: active ? 'Realçado' : 'Realçar', onclick: () => highlight(i) })
      ]),
      el('div', { class: 'pathstats' }, [
        el('span', { text: 'confiança média ' + path.avgConf + '/5' }),
        el('span', { text: 'fonte em ' + Math.round(path.sourcedRatio * 100) + '% dos passos' }),
        path.chronological ? el('span', { text: 'ordem cronológica coerente' }) : el('span', { text: 'ordem cronológica não assegurada' }),
        ...flags.map((f) => el('span', { class: 'tag ' + f[1], text: f[0] }))
      ]),
      el('div', { class: 'steps' }, steps)
    ]);
  }

  VN.paths = { init, setMode, isMode, refreshBar, execute, highlight, renderPanel };
})(typeof window !== 'undefined' ? window : globalThis);
