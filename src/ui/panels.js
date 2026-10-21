/* VN · Painel esquerdo (filtros, análise, legenda, histórico), legenda rápida,
   barra de estado, menus de contexto, modais e avisos. */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const { el, $, $$, clear, fmtNum, fmtMoney, pct, toast } = VN.dom;

  let CTX = null;                       // {store, model, app}
  const openSections = { load: true, types: true, families: true, status: true, sources: false, options: false, dates: false, kinds: false };

  function init(ctx) { CTX = ctx; }

  /* ---------------- secção colapsável ---------------- */
  function section(key, title, count, body, opts) {
    opts = opts || {};
    const head = el('button', {
      class: 'sechead', type: 'button', 'aria-expanded': String(openSections[key] !== false),
      onclick: () => { openSections[key] = openSections[key] === false; renderSidebar(); }
    }, [el('span', { class: 'chev', text: '▾' }), title, count != null ? el('span', { class: 'count', text: count }) : null,
      opts.action || null]);
    const wrap = el('div', { class: 'sec' }, [head]);
    if (openSections[key] !== false) wrap.appendChild(el('div', { class: 'secbody' }, body));
    return wrap;
  }

  function checkRow(label, checked, onChange, meta, color, title) {
    const cb = el('input', { type: 'checkbox', checked: checked, onchange: (e) => onChange(e.target.checked) });
    return el('div', { class: 'frow', title: title || '' }, [
      el('label', {}, [cb, color ? el('span', { class: 'swatch', style: 'background:' + color }) : null,
        el('span', { text: label, style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' })]),
      meta != null ? el('span', { class: 'num', text: meta }) : null
    ]);
  }

  /* ---------------- FILTROS ---------------- */
  function renderFilters() {
    const { store, model } = CTX;
    const st = store.state;
    const m = store.masks();
    const total = model.entities.length;
    const out = [];

    // carregamento progressivo
    out.push(section('load', 'Carregamento', st.loaded.size + '/' + total, [
      el('div', { class: 'progress' }, [el('i', { style: 'width:' + pct(st.loaded.size, total) + '%' })]),
      el('div', { class: 'btnrow' }, [
        el('button', { class: 'btn sm', type: 'button', onclick: () => { store.seed(); CTX.app.refresh({ fit: true }); toast('Semente recarregada com as entidades mais ligadas'); }, text: 'Semente' }),
        el('button', { class: 'btn sm', type: 'button', onclick: () => { store.loadLevels(1); CTX.app.refresh(); toast('Explorado mais um nível a partir do que está carregado'); }, text: '1 nível' }),
        el('button', { class: 'btn sm', type: 'button', onclick: () => { store.loadAll(); CTX.app.refresh({ fit: true }); toast('Toda a rede carregada: ' + total + ' entidades'); }, text: 'Tudo' })
      ]),
      el('div', { class: 'frow' }, [
        el('span', { text: 'Limite por expansão', style: 'flex:1' }),
        el('input', { type: 'number', min: 1, max: 200, value: st.settings.maxPerExpand, 'aria-label': 'Máximo de vizinhos por expansão',
          onchange: (e) => { store.setSetting('maxPerExpand', Math.max(1, Math.min(200, +e.target.value || 24))); renderSidebar(); } })
      ]),
      checkRow('Agrupar vizinhos não carregados', st.settings.groupGhosts, (v) => { store.setSetting('groupGhosts', v); CTX.app.refresh(); }, null, null,
        'Mostra um nó agregado "+N" para cada tipo de vizinho ainda não carregado, em vez de carregar tudo.'),
      el('p', { class: 'side-note', text: 'O grafo nunca carrega toda a base de dados de uma vez: começa numa semente e cresce por expansão explícita.' })
    ]));

    // tipos de entidade
    const typeRows = Object.keys(model.entityTypes).map((t) => {
      const cfg = model.entityTypes[t];
      const count = model.counts[t] || 0;
      const loaded = Array.from(st.loaded).filter((id) => (model.byId.get(id) || {}).type === t).length;
      return checkRow(cfg.plural || cfg.label, st.filters.types.has(t), () => { store.toggleFilterSet('types', t); }, count + (loaded < count ? ' (' + loaded + ')' : ''), cfg.color);
    });
    out.push(section('types', 'Tipos de entidade', Object.keys(model.entityTypes).length, [
      ...typeRows,
      el('div', { class: 'btnrow' }, [
        el('button', { class: 'ghostbtn sm', type: 'button', text: 'Só pessoas e empresas',
          onclick: () => { store.setFilter({ types: new Set(['person', 'company']) }, 'Foco em pessoas e empresas'); CTX.app.refresh(); } }),
        el('button', { class: 'ghostbtn sm', type: 'button', text: 'Todos',
          onclick: () => { store.setFilter({ types: new Set(Object.keys(model.entityTypes)) }, 'Todos os tipos'); CTX.app.refresh(); } })
      ])
    ]));

    // famílias e tipos de relação
    const famRows = Object.keys(model.relationFamilies).map((f) => {
      const cfg = model.relationFamilies[f];
      const count = model.relations.filter((r) => r.family === f).length;
      return checkRow(cfg.label, st.filters.families.has(f), () => { store.toggleFilterSet('families', f); }, count, cfg.color);
    });
    const kindRows = Object.keys(model.relationTypes).map((k) => {
      const cfg = model.relationTypes[k];
      const count = model.relCounts[k] || 0;
      if (!count) return null;
      const on = !st.filters.kinds.size || st.filters.kinds.has(k);
      return checkRow(cfg.label, on, (v) => {
        if (!st.filters.kinds.size) { st.filters.kinds = new Set(Object.keys(model.relationTypes).filter((x) => model.relCounts[x])); }
        if (v) st.filters.kinds.add(k); else st.filters.kinds.delete(k);
        if (st.filters.kinds.size === Object.keys(model.relationTypes).filter((x) => model.relCounts[x]).length) st.filters.kinds = new Set();
        store.setFilter({}, 'Tipo de relação: ' + cfg.label); CTX.app.refresh();
      }, count, null, cfg.label);
    }).filter(Boolean);
    out.push(section('families', 'Relações', model.relations.length, [
      ...famRows,
      el('div', { class: 'btnrow' }, [el('button', {
        class: 'ghostbtn sm', type: 'button', 'aria-expanded': String(!!openSections.kinds),
        text: openSections.kinds ? '− Ocultar tipos específicos' : '+ Tipos específicos (' + kindRows.length + ')',
        onclick: () => { openSections.kinds = !openSections.kinds; renderSidebar(); }
      })]),
      openSections.kinds ? el('div', { style: 'margin-top:4px' }, kindRows) : null,
      st.filters.kinds.size ? el('div', { class: 'side-note', text: 'A filtrar ' + st.filters.kinds.size + ' tipos específicos. ' },
        [el('button', { class: 'linkbtn', text: 'limpar', onclick: () => { store.setFilter({ kinds: new Set() }, 'Limpar tipos'); CTX.app.refresh(); } })]) : null
    ]));

    // verificação
    const statusRows = Object.keys(model.verification).map((s) => {
      const cfg = model.verification[s];
      const count = model.statusCounts[s] || 0;
      const cb = el('input', { type: 'checkbox', checked: st.filters.statuses.has(s), onchange: () => { store.toggleFilterSet('statuses', s); CTX.app.refresh(); } });
      return el('div', { class: 'frow', title: cfg.desc }, [
        el('label', {}, [cb, el('span', { class: 'dot', style: 'background:' + cfg.color }), el('span', { text: cfg.label })]),
        el('span', { class: 'num', text: count })
      ]);
    });
    out.push(section('status', 'Estado de verificação', null, [
      ...statusRows,
      el('p', { class: 'side-note', text: 'Confirmação exige fonte primária identificada e excerto verificável. Alegações e relações não verificadas ficam sempre assinaladas.' })
    ]));

    // fontes
    const docs = model.entities.filter((e) => e.type === 'document');
    out.push(section('sources', 'Fontes documentais', docs.length, [
      el('p', { class: 'side-note', text: 'Restringir às relações sustentadas por um documento específico.' }),
      ...docs.map((d) => checkRow(d.name.length > 40 ? d.name.slice(0, 38) + '…' : d.name,
        st.filters.sources.has(d.id), () => { store.toggleFilterSet('sources', d.id); CTX.app.refresh(); },
        (model.stats.get(d.id) || { degree: 0 }).degree, null, d.name))
    ]));

    // opções
    out.push(section('options', 'Opções de análise', null, [
      checkRow('Ocultar documentos no grafo', st.settings.hideDocuments, (v) => { store.setSetting('hideDocuments', v); CTX.app.refresh(); }),
      checkRow('Apenas entidades com documentos associados', st.filters.docsOnly, (v) => { store.setFilter({ docsOnly: v }, 'Filtro: entidades com documentos'); CTX.app.refresh(); }),
      checkRow('Etiquetas nos nós', st.settings.showLabels, (v) => { store.setSetting('showLabels', v); CTX.app.engine.setLabels(v, st.settings.showEdgeLabels); }),
      checkRow('Etiquetas nas ligações', st.settings.showEdgeLabels, (v) => { store.setSetting('showEdgeLabels', v); CTX.app.engine.setLabels(st.settings.showLabels, v); }),
      el('div', { class: 'frow' }, [el('span', { text: 'Filtro textual de relações', style: 'flex:1' })]),
      el('div', { style: 'padding:0 6px 4px' }, [el('input', {
        type: 'text', placeholder: 'ex.: financiou, adenda, 2020', value: st.filters.text,
        oninput: (e) => { st.filters.text = e.target.value; CTX.app.refresh(); }
      })])
    ]));

    // datas
    out.push(section('dates', 'Período', null, [
      el('div', { class: 'frow' }, [
        el('span', { text: 'De', style: 'width:26px' }),
        el('input', { type: 'number', min: 1900, max: 2100, value: st.filters.yearFrom != null ? st.filters.yearFrom : '', placeholder: '—', 'aria-label': 'Ano inicial',
          onchange: (e) => { store.setFilter({ yearFrom: e.target.value ? +e.target.value : null }, 'Período: desde ' + e.target.value); CTX.app.refresh(); } }),
        el('span', { text: 'a', style: 'width:12px;text-align:center' }),
        el('input', { type: 'number', min: 1900, max: 2100, value: st.filters.yearTo != null ? st.filters.yearTo : '', placeholder: '—', 'aria-label': 'Ano final',
          onchange: (e) => { store.setFilter({ yearTo: e.target.value ? +e.target.value : null }, 'Período: até ' + e.target.value); CTX.app.refresh(); } })
      ]),
      el('p', { class: 'side-note', text: 'Só são mostradas relações válidas no período. Relações com datas desconhecidas não são projectadas: ficam assinaladas como tal.' })
    ]));

    return el('div', {}, out);
  }

  /* ---------------- ANÁLISE ---------------- */
  function renderAnalysis() {
    const { model, store } = CTX;
    const o = VN.query.overview(model);
    const m = store.masks();
    const rows = o.top.map((t) => el('div', { class: 'relrow', onclick: () => CTX.app.focusEntity(t.entity.id) }, [
      VN.dom.avatar(t.entity, 28),
      el('div', { class: 'rtext' }, [
        el('div', { class: 'rlabel' }, [el('b', { text: t.entity.name })]),
        el('div', { class: 'rmeta' }, [t.entity.typeLabel, '·', t.stats.degree + ' ligações',
          t.stats.moneyIn + t.stats.moneyOut > 0 ? el('span', { class: 'tag ok', text: fmtMoney(t.stats.moneyIn + t.stats.moneyOut) }) : null])
      ]),
      el('span', { class: 'go', text: '›' })
    ]));
    const stat = (label, value, sub) => el('div', { class: 'kpi' }, [
      el('b', { text: value }), el('span', { text: label }),
      sub ? el('div', { class: 'muted', style: 'font-size:10px', text: sub }) : null
    ]);
    return el('div', {}, [
      el('div', { class: 'kpis' }, [
        stat('entidades', String(model.entities.length), m.nodes.size + ' visíveis'),
        stat('relações', String(model.relations.length), m.edges.size + ' visíveis'),
        stat('fontes', String(model.docSet.size))
      ]),
      el('div', { class: 'kpis' }, [
        stat('confirmadas', String(o.confirmed)),
        stat('não confirmadas', String(o.unverified)),
        stat('sem fonte', String(o.undocumented))
      ]),
      el('div', { class: 'block' }, [
        el('h4', {}, ['Ligações mais densas ', el('span', { class: 'n', text: 'grau' })]),
        ...rows
      ]),
      el('div', { class: 'block' }, [
        el('h4', {}, ['Fluxos financeiros documentados']),
        el('div', { class: 'infobox' }, [
          el('div', { style: 'font-size:20px;font-weight:650;color:var(--ink);letter-spacing:-.02em', text: fmtMoney(o.money.total) }),
          el('div', { class: 'muted', style: 'font-size:11px', text: o.money.flows.length + ' relações com montante explícito (soma bruta, não consolidada)' })
        ]),
        ...o.money.flows.slice(0, 6).map((r) => el('div', { class: 'relrow', onclick: () => CTX.app.selectRelation(r.id) }, [
          el('div', { class: 'rtext' }, [
            el('div', { class: 'rlabel' }, [el('b', { text: fmtMoney(r.amount, r.currency) }), ' · ', r.kindLabel]),
            el('div', { class: 'rmeta' }, [r.fromName + ' → ' + r.toName])
          ])
        ]))
      ]),
      el('div', { class: 'block' }, [
        el('h4', {}, ['Qualidade dos dados']),
        el('div', { class: 'infobox' }, [
          el('div', { text: model.validation.errors.length + ' erros · ' + model.validation.warnings.length + ' avisos' }),
          el('div', { class: 'muted', style: 'font-size:11px', text: 'Verificação estrutural: relações confirmadas sem fonte, imagens sem licença, homónimos, datas invertidas.' }),
          el('button', { class: 'linkbtn', text: 'abrir relatório de qualidade', onclick: () => CTX.app.showQuality() })
        ]),
        el('button', { class: 'btn sm', type: 'button', style: 'margin-top:8px', text: 'Exportar relatório com provas',
          onclick: () => CTX.app.exportReport() })
      ])
    ]);
  }

  /* ---------------- LEGENDA ---------------- */
  function renderLegend() {
    const { model } = CTX;
    const typeRows = Object.keys(model.entityTypes).map((t) => el('div', { class: 'frow' }, [
      el('span', { class: 'swatch', style: 'background:' + model.entityTypes[t].color }),
      el('span', { text: model.entityTypes[t].label, style: 'flex:1' }),
      el('span', { class: 'num', text: model.counts[t] || 0 })
    ]));
    const verRows = Object.keys(model.verification).map((s) => {
      const v = model.verification[s];
      return el('div', { class: 'frow', title: v.desc }, [
        el('span', { class: 'dot', style: 'background:' + v.color }),
        el('span', { style: 'flex:1' }, [el('b', { text: v.short, style: 'color:' + v.color }), ' ' + v.label]),
        el('span', { class: 'num', text: model.statusCounts[s] || 0 })
      ]);
    });
    const famRows = Object.keys(model.relationFamilies).map((f) => el('div', { class: 'frow' }, [
      el('span', { class: 'swatch', style: 'background:' + model.relationFamilies[f].color }),
      el('span', { text: model.relationFamilies[f].label, style: 'flex:1' })
    ]));
    return el('div', {}, [
      el('div', { class: 'sectiontitle', text: 'Cor = tipo de entidade' }), ...typeRows,
      el('div', { class: 'sectiontitle', text: 'Linha = família de relação' }), ...famRows,
      el('div', { class: 'sectiontitle', text: 'Traço e selo = verificação' }), ...verRows,
      el('div', { class: 'sectiontitle', text: 'Estilo da linha' }),
      el('div', { class: 'frow' }, [el('span', { class: 'dashkey' }), el('span', { text: 'confirmada (contínua)', style: 'flex:1' })]),
      el('div', { class: 'frow' }, [el('span', { class: 'dashkey dashed' }), el('span', { text: 'provável / alegada (tracejada)', style: 'flex:1' })]),
      el('div', { class: 'frow' }, [el('span', { class: 'dashkey dotted' }), el('span', { text: 'não verificada (pontilhada)', style: 'flex:1' })]),
      el('div', { class: 'frow' }, [el('span', { class: 'dashkey dashed', style: 'border-color:#fb7185' }), el('span', { text: 'contraditada (tracejada vermelha)', style: 'flex:1' })]),
      el('div', { class: 'sectiontitle', text: 'Outros sinais' }),
      el('div', { class: 'frow' }, [el('span', { class: 'mini', text: '+N' }), el('span', { text: 'grupo de vizinhos não carregados', style: 'flex:1' })]),
      el('div', { class: 'frow' }, [el('span', { class: 'dot', style: 'background:var(--accent)' }), el('span', { text: 'contorno tracejado: não verificado', style: 'flex:1' })]),
      el('div', { class: 'warnbox', text: 'A cor representa apenas categorias e estados definidos nesta legenda. Nunca representa culpa, perigosidade ou suspeição.' })
    ]);
  }

  /* ---------------- HISTÓRICO ---------------- */
  function renderHistory() {
    const { store } = CTX;
    const st = store.state;
    const trail = st.trail || [];
    return el('div', {}, [
      el('div', { class: 'sectiontitle', text: 'Percurso de exploração' }),
      trail.length ? el('div', {}, trail.slice().reverse().map((t) => el('div', { class: 'relrow', onclick: () => t.id && CTX.app.focusEntity(t.id) }, [
        el('div', { class: 'rtext' }, [
          el('div', { class: 'rlabel', text: t.label }),
          el('div', { class: 'rmeta' }, [new Date(t.at).toLocaleTimeString('pt-PT'), '·', t.kind || ''])
        ])
      ]))) : el('p', { class: 'side-note', text: 'Ainda sem acções. Pesquise uma entidade para começar.' }),
      el('div', { class: 'sectiontitle', text: 'Acções reversíveis (' + st.history.length + ')' }),
      st.history.length ? el('div', {}, st.history.slice().reverse().slice(0, 20).map((h, i) => el('div', { class: 'frow' }, [
        el('span', { text: h.label, style: 'flex:1;font-size:11.5px' }),
        el('button', { class: 'linkbtn', text: 'anular', onclick: () => { CTX.app.undoTo(st.history.length - 1 - i); } })
      ]))) : el('p', { class: 'side-note', text: 'Sem acções reversíveis.' })
    ]);
  }

  function renderSidebar() {
    const body = $('#sidebody');
    if (!body || !CTX) return;
    clear(body);
    const tab = document.querySelector('.sidetab.active');
    const which = tab ? tab.dataset.sidetab : 'filters';
    body.appendChild(which === 'analysis' ? renderAnalysis() : which === 'legend' ? renderLegend() :
      which === 'history' ? renderHistory() : renderFilters());
  }

  /* ---------------- legenda rápida (sempre visível) ---------------- */
  function renderLegendBar() {
    const { model } = CTX;
    const bar = $('#legendbar');
    if (!bar) return;
    clear(bar);
    const item = (children) => el('span', { class: 'lg' }, children);
    bar.appendChild(el('b', { text: 'Legenda' }));
    bar.appendChild(item([el('span', { class: 'swatch', style: 'background:var(--confirmed)' }), 'confirmado']));
    bar.appendChild(item([el('span', { class: 'dashkey dashed', style: 'border-color:var(--probable)' }), 'provável/alegado']));
    bar.appendChild(item([el('span', { class: 'dashkey dotted', style: 'border-color:var(--unverified)' }), 'não verificado']));
    bar.appendChild(item([el('span', { class: 'dashkey dashed', style: 'border-color:var(--contradicted)' }), 'contraditado']));
    bar.appendChild(el('button', { class: 'linkbtn', text: 'legenda completa', onclick: () => {
      document.querySelector('.sidetab[data-sidetab="legend"]').click();
    } }));
  }

  function renderStatusBar(extra) {
    const { store, model } = CTX;
    const st = store.state;
    const m = store.masks();
    const c1 = $('#statCounts');
    if (c1) c1.textContent = m.nodes.size + '/' + model.entities.length + ' entidades · ' + m.edges.size + '/' + model.relations.length + ' relações';
    const active = [];
    if (st.filters.types.size !== Object.keys(model.entityTypes).length) active.push('tipos');
    if (st.filters.families.size !== Object.keys(model.relationFamilies).length) active.push('relações');
    if (st.filters.statuses.size !== Object.keys(model.verification).length) active.push('verificação');
    if (st.filters.kinds.size) active.push('tipos de relação');
    if (st.filters.sources.size) active.push('fontes');
    if (st.filters.yearFrom != null || st.filters.yearTo != null) active.push('período');
    if (st.filters.text) active.push('texto');
    if (st.filters.docsOnly) active.push('com documentos');
    const c2 = $('#statFilters');
    if (c2) c2.textContent = active.length ? 'filtros: ' + active.join(', ') : 'sem filtros';
    const c3 = $('#statPerf');
    if (c3) {
      const p = extra && extra.perf ? extra.perf : null;
      c3.textContent = p ? p.fps + ' fps · ' + p.nodes + ' nós / ' + p.edges + ' ligações · layout ' + p.layoutMs + ' ms' : '—';
    }
    const c4 = $('#statAction');
    if (c4) c4.textContent = st.lastAction || '';
  }

  /* ---------------- modais ---------------- */
  function modal(title, content, opts) {
    const box = $('#modal');
    $('#modalTitle').textContent = title;
    const body = $('#modalBody');
    clear(body);
    if (typeof content === 'string') body.innerHTML = content; else body.appendChild(content);
    box.hidden = false;
    document.body.classList.add('modal-open');
    const close = () => { box.hidden = true; document.body.classList.remove('modal-open'); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    $$('[data-close]', box).forEach((n) => { n.onclick = close; });
    if (opts && opts.wide) $('.modalcard', box).style.width = 'min(1100px,100%)';
    return { close, body };
  }

  function showQuality() {
    const { model } = CTX;
    const v = model.validation;
    const list = (arr, kind) => arr.length ? el('ul', {}, arr.slice(0, 80).map((i) => el('li', { text: i.msg })))
      : el('p', { class: 'muted', text: 'Nenhum.' });
    modal('Qualidade e integridade dos dados', el('div', {}, [
      el('p', { text: 'Verificação automática executada sobre o modelo em memória. Não valida a veracidade das fontes — valida a consistência do registo.' }),
      el('h3', { text: 'Erros (' + v.errors.length + ')' }), list(v.errors),
      el('h3', { text: 'Avisos (' + v.warnings.length + ')' }), list(v.warnings),
      el('h3', { text: 'Regras aplicadas' }),
      el('ul', {}, [
        el('li', { text: 'Toda a relação confirmada exige fonte documental identificada.' }),
        el('li', { text: 'Toda a imagem exige crédito e licença declarados; caso contrário é erro.' }),
        el('li', { text: 'Nomes duplicados são sinalizados como possível homónimo não resolvido.' }),
        el('li', { text: 'Intervalos de datas invertidos e auto-relações são sinalizados.' }),
        el('li', { text: 'Relações prováveis, alegadas ou não verificadas exigem justificação escrita.' })
      ]),
      el('h3', { text: 'Contagem' }),
      el('p', { text: model.entities.length + ' entidades · ' + model.relations.length + ' relações · ' +
        model.docSet.size + ' fontes documentais · ' + Object.keys(model.relationTypes).length + ' tipos de relação definidos.' })
    ]));
  }

  function showHelp() {
    modal('Como usar', el('div', {}, [
      el('p', { text: 'Esta é uma ferramenta de investigação documental. Cada ligação tem tipo, fonte, excerto e estado de verificação. Nada é inferido por proximidade.' }),
      el('h3', { text: 'Fluxo recomendado' }),
      el('ol', {}, [
        el('li', { text: 'Pesquisar uma entidade (⌘K ou /) e centrar o mapa nela.' }),
        el('li', { text: 'Expandir ligações directas (E) e abrir o painel de detalhes.' }),
        el('li', { text: 'Ler a fonte e o excerto de cada relação antes de concluir algo.' }),
        el('li', { text: 'Filtrar por período e por estado de verificação para isolar o que está documentado.' }),
        el('li', { text: 'Procurar caminhos (P) entre duas entidades e ordenar por qualidade de evidência.' }),
        el('li', { text: 'Exportar relatório com todas as referências às provas.' })
      ]),
      el('h3', { text: 'Atalhos' }),
      el('div', { class: 'infobox' }, [
        el('div', { text: '⌘K / Ctrl+K · pesquisar      F · ajustar vista      E · expandir      R · recolher' }),
        el('div', { text: 'P · modo caminhos      L · etiquetas      G · agrupar      H · ocultar      C · centrar' }),
        el('div', { text: 'U · anular      Shift+U · refazer      T · cronologia      Esc · fechar painéis      ? · ajuda' })
      ]),
      el('div', { class: 'warnbox', text: 'Aviso metodológico: um caminho entre duas entidades demonstra apenas que existem relações registadas. Não é prova de coordenação, acordo ou crime. Alegações não são factos.' })
    ]));
  }

  /* Proveniência: o que este conjunto é, como foi verificado e o que não se pode concluir. */
  function showProvenance(onOpen) {
    const m = (VN.app && VN.app.model) ? VN.app.model : null;
    const meta = (m && m.meta) || {};
    const ents = (m && m.entities) || [];
    const rels = (m && m.relations) || [];
    const docs = ents.filter((e) => e.type === 'document');
    const proc = rels.filter((r) => ['litigation_with', 'documented_in', 'ruled_on', 'mentioned_in'].includes(r.kind)).length;
    const verified = meta.fictional === false;
    modal('Proveniência dos dados', el('div', {}, [
      el('div', { class: verified ? 'infobox' : 'warnbox', html: verified
        ? '<b>Este conjunto declara proveniência verificada.</b> ' + docs.length + ' documentos com hash, ' + ents.length + ' entidades e ' + rels.length + ' relações com excerto.'
        : '<b>Este conjunto não declara proveniência verificada.</b> Trate-o como material por conferir.' }),
      el('h3', { text: 'De onde vêm os dados' }),
      el('p', { text: meta.disclaimer || 'Cada documento tem URL canónico, data de recolha, hash SHA-256 e o texto foi extraído do próprio ficheiro. A proveniência documento a documento está em data/real/PROVENIENCIA.json.' }),
      el('h3', { text: 'O que uma ligação significa aqui' }),
      el('p', { text: proc + ' das ' + rels.length + ' relações são processuais: «nomeado no mesmo processo», «documentado nesta decisão», «este tribunal proferiu esta decisão», «o nome ocorre nesta decisão». Nenhuma afirma crime, coordenação, conhecimento ou culpa — e nenhuma foi inferida de co-ocorrência.' }),
      el('div', { class: 'warnbox', text: 'Uma linha não é prova. Um caminho entre duas entidades mostra apenas que existem relações registadas entre elas. Alegações não são factos; nomes iguais podem ser pessoas diferentes.' }),
      el('h3', { text: 'Como entrar com outros dados' }),
      el('p', { text: 'Só por importação de um lote que passe a validação de proveniência: cada relação precisa de fonte, excerto literal, data de recolha e estado. Sem isso, o lote é recusado com os erros listados.' }),
      onOpen ? el('button', { class: 'btn primary', type: 'button', text: 'Abrir consola de investigação', onclick: () => { onOpen(); } }) : null
    ]));
  }

  /* menu de contexto */
  function contextMenu(x, y, items) {
    const menu = $('#ctxmenu');
    clear(menu);
    items.forEach((it) => {
      if (it.sep) { menu.appendChild(el('div', { class: 'sep' })); return; }
      menu.appendChild(el('button', { type: 'button', role: 'menuitem', onclick: () => { menu.hidden = true; it.run(); } },
        [el('span', { text: it.label }), it.key ? el('span', { class: 'k', text: it.key }) : null]));
    });
    menu.hidden = false;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
    setTimeout(() => document.addEventListener('click', () => { menu.hidden = true; }, { once: true }), 0);
  }

  VN.panels = { init, renderSidebar, renderLegendBar, renderStatusBar, modal, showQuality, showHelp, showProvenance, showFiction: showProvenance, contextMenu, toast };
})(typeof window !== 'undefined' ? window : globalThis);
