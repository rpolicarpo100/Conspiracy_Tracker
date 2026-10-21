/* VN · Painel de detalhes: entidade, ligação, cronologia, fontes.
   Nunca abandona o grafo: tudo é mostrado ao lado. */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const D = VN.dom;
  const { el, clear, fmtDate, fmtRange, fmtMoney, fmtNum } = D;
  let CTX = null;
  let tab = 'summary';

  function init(ctx) {
    CTX = ctx;
    document.querySelectorAll('.dtab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.dtab)));
  }
  function setTab(t) {
    tab = t;
    document.querySelectorAll('.dtab').forEach((b) => {
      const on = b.dataset.dtab === t;
      b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on));
    });
    render();
  }
  const currentTab = () => tab;

  function render() {
    const body = document.getElementById('detailsbody');
    if (!body) return;
    const { store, model } = CTX;
    const sel = store.state.selected;
    clear(body);
    if (tab === 'paths') { VN.paths.renderPanel(body); return; }
    if (tab === 'timeline') { VN.timeline.renderPanel(body); return; }
    if (!sel) { body.appendChild(emptyState()); return; }
    if (sel.kind === 'node') body.appendChild(entityView(sel.id));
    else if (sel.kind === 'edge') body.appendChild(relationView(sel.id));
  }

  function emptyState() {
    const { model } = CTX;
    return el('div', { class: 'empty' }, [
      el('h3', { text: 'Seleccione uma entidade ou uma ligação' }),
      el('p', { text: 'Clique num nó para ver identidade, ligações, documentos e contraditórios. Clique numa linha para ver a relação exacta, a fonte e o excerto.' }),
      el('p', { style: 'margin-top:14px;font-size:11.5px' },
        ['Rede com ', el('b', { text: String(model.entities.length) }), ' entidades e ',
          el('b', { text: String(model.relations.length) }), ' relações tipificadas.']),
      el('button', { class: 'btn sm', type: 'button', style: 'margin-top:10px', text: 'Abrir ajuda e atalhos', onclick: () => CTX.app.showHelp() })
    ]);
  }

  /* ---------------- ENTIDADE ---------------- */
  function entityView(id) {
    const { model, store } = CTX;
    const e = model.byId.get(id);
    if (!e) return el('div', { class: 'empty', text: 'Entidade não encontrada.' });
    const st = model.stats.get(id);
    const rels = (model.neighbors.get(id) || []).slice().sort((a, b) => b.statusWeight - a.statusWeight);
    const prov = VN.avatars.provenance(e);
    const isPathA = store.state.path.a === id, isPathB = store.state.path.b === id;

    const head = el('div', { class: 'identity' }, [
      D.avatar(e, 64),
      el('div', { class: 'idtext' }, [
        el('h2', { text: e.name }),
        el('div', { class: 'sub', text: e.short || e.typeLabel }),
        el('div', { class: 'chips' }, [
          el('span', { class: 'chip', style: 'border-color:' + e.typeColor + '66' }, [
            el('span', { class: 'dot', style: 'background:' + e.typeColor }), e.typeLabel]),
          D.statusChip(e.status, model.verification),
          e.juris ? el('span', { class: 'chip', text: e.juris }) : null,
          e.date ? el('span', { class: 'chip', text: fmtDate(e.date, e.precision) }) : el('span', { class: 'chip', text: 'data desconhecida' })
        ]),
        el('div', { class: 'idline' }, [
          el('span', { text: e.id }),
          el('button', { class: 'linkbtn', text: 'copiar ID', onclick: () => { D.copy(e.id); D.toast('Identificador copiado'); } }),
          (e.aliases || []).length ? el('span', { text: 'aliases: ' + e.aliases.join(' · ') }) : null
        ])
      ])
    ]);

    const actions = el('div', { class: 'actions' }, [
      el('button', { class: 'btn sm', type: 'button', text: 'Expandir', title: 'Expandir ligações directas (E)', onclick: () => CTX.app.expand(id, 1) }),
      el('button', { class: 'btn sm', type: 'button', text: '+2 níveis', onclick: () => CTX.app.expand(id, 2) }),
      el('button', { class: 'btn sm', type: 'button', text: 'Centrar', onclick: () => CTX.app.focusEntity(id, false) }),
      el('button', { class: 'btn sm', type: 'button', text: store.state.pinned.has(id) ? 'Desafixar' : 'Fixar', onclick: () => { store.togglePin(id); CTX.app.refresh(); } }),
      el('button', { class: 'btn sm', type: 'button', text: 'Origem', title: 'Definir como origem do caminho', onclick: () => { store.setPath({ a: id }); D.toast('Origem do caminho: ' + e.name); VN.paths.refreshBar(); } }),
      el('button', { class: 'btn sm', type: 'button', text: 'Destino', title: 'Definir como destino do caminho', onclick: () => { store.setPath({ b: id }); D.toast('Destino do caminho: ' + e.name); VN.paths.refreshBar(); } }),
      el('button', { class: 'btn sm', type: 'button', text: 'Ocultar', onclick: () => { store.hide(id, true); CTX.app.refresh(); } }),
      el('button', { class: 'btn sm', type: 'button', text: 'Ficha', title: 'Exportar ficha desta entidade com referências', onclick: () => CTX.app.exportEntity(id) })
    ]);

    const kpis = el('div', { class: 'kpis' }, [
      el('div', { class: 'kpi' }, [el('b', { text: String(st.degree) }), el('span', { text: 'ligações' })]),
      el('div', { class: 'kpi' }, [el('b', { text: String(st.confirmed) }), el('span', { text: 'confirmadas' })]),
      el('div', { class: 'kpi' }, [el('b', { text: String(st.documents.size) }), el('span', { text: 'documentos' })])
    ]);

    const blocks = [];

    blocks.push(el('p', { class: 'ctxtext', text: e.ctx || '' }));

    if ((e.facts || []).length) blocks.push(block('Factos documentados', e.facts.map((f) =>
      el('div', { class: 'li fact' }, [el('span', { class: 'mk', text: '✓' }), el('span', { text: f })]))));

    if ((e.alleges || []).length) blocks.push(block('Alegações atribuídas', [
      ...e.alleges.map((f) => el('div', { class: 'li alleg' }, [el('span', { class: 'mk', text: '!' }), el('span', { text: f })])),
      el('div', { class: 'side-note', style: 'padding-left:18px', text: 'Alegação = afirmado por uma parte identificada. Não é facto provado.' })
    ]));

    if ((e.contradictions || []).length) blocks.push(block('Contra-provas e informação contraditória', [
      ...e.contradictions.map((f) => el('div', { class: 'li contra' }, [el('span', { class: 'mk', text: '✕' }), el('span', { text: f })]))
    ]));

    // ligações agrupadas por família
    const byFam = {};
    rels.forEach((r) => { (byFam[r.family] = byFam[r.family] || []).push(r); });
    const relBlocks = Object.keys(byFam).map((fam) => {
      const cfg = model.relationFamilies[fam];
      return el('div', { style: 'margin-bottom:8px' }, [
        el('div', { class: 'srcmeta', style: 'margin:6px 0 2px' }, [
          el('span', { class: 'swatch', style: 'background:' + cfg.color }), el('b', { style: 'color:var(--ink2)', text: cfg.label }),
          el('span', { text: '(' + byFam[fam].length + ')' })]),
        ...byFam[fam].map((r) => relationRow(r, id))
      ]);
    });
    blocks.push(block('Ligações directas', relBlocks));

    // financeiro
    const money = rels.filter((r) => typeof r.amount === 'number');
    if (money.length) blocks.push(block('Relações financeiras conhecidas', [
      ...money.map((r) => el('div', { class: 'relrow', onclick: () => CTX.app.selectRelation(r.id) }, [
        el('div', { class: 'rtext' }, [
          el('div', { class: 'rlabel' }, [el('b', { text: fmtMoney(r.amount, r.currency) }), ' · ' + r.kindLabel]),
          el('div', { class: 'rmeta' }, [r.from === id ? 'saída → ' + r.toName : 'entrada ← ' + r.fromName, '·', r.statusLabel, '·', fmtRange(r)])
        ])
      ])),
      el('div', { class: 'srcmeta', style: 'padding:6px 0', text: 'Soma bruta, sem consolidação. Montantes não equivalem a propriedade nem a benefício.' })
    ]));

    // documentos
    const docs = Array.from(st.documents).map((did) => model.byId.get(did)).filter(Boolean);
    if (docs.length) blocks.push(block('Documentos e fontes associadas', docs.map((d) =>
      el('div', { class: 'relrow', onclick: () => openSource(d.id) }, [
        el('div', { class: 'rtext' }, [
          el('div', { class: 'rlabel' }, [el('b', { text: d.name })]),
          el('div', { class: 'rmeta' }, [d.typeLabel, '·', fmtDate(d.date, d.precision), '·', d.id])
        ]),
        el('span', { class: 'go', text: '↗' })
      ]))));

    // cronologia da entidade
    const chrono = rels.filter((r) => r.hasDates).sort((a, b) => (a.tStart || 0) - (b.tStart || 0));
    if (chrono.length) blocks.push(block('Cronologia associada', chrono.slice(0, 14).map((r) => {
      const other = r.from === id ? r.toName : r.fromName;
      return el('div', { class: 'li' }, [
        el('span', { class: 'mk', style: 'color:var(--muted);font-variant-numeric:tabular-nums', text: (r.yStart || '—') + '' }),
        el('span', {}, [
          el('b', { style: 'color:var(--ink)', text: r.kindLabel + ' ' }), other,
          el('div', { class: 'srcmeta' }, [fmtRange(r) + ' · ' + r.startPrecisionLabel,
            r.status !== 'confirmed' ? el('span', { class: 'tag warn', text: r.statusLabel }) : null])
        ])
      ]);
    })));

    // proveniência visual
    blocks.push(block('Origem da representação visual', [
      el('div', { class: 'srcmeta', style: 'line-height:1.7' }, [
        el('span', { class: 'tag', text: prov.kind }),
        el('span', { text: 'crédito: ' + prov.credit }),
        el('span', { text: 'licença: ' + prov.licence }),
        el('span', { text: 'fonte: ' + prov.source })
      ]),
      el('p', { class: 'side-note', text: 'Nenhuma fotografia é inventada. Sem imagem fiável e licenciada, é usado um avatar procedimental identificado como tal.' })
    ]));

    blocks.push(el('div', { class: 'warnbox' }, [
      'Relações nesta ficha são registos documentais, não juízos. ',
      el('button', { class: 'linkbtn', text: 'Ver caminhos a partir desta entidade', onclick: () => { CTX.app.setPathMode(true); setTab('paths'); } })
    ]));

    return el('div', {}, [head, actions, kpis, ...blocks]);
  }

  function relationRow(r, selfId) {
    const { model } = CTX;
    const otherId = r.from === selfId ? r.to : r.from;
    const other = model.byId.get(otherId);
    const outgoing = r.from === selfId;
    const label = outgoing ? r.kindLabel : invertLabel(r.kindLabel);
    return el('div', { class: 'relrow', title: r.kindLabel + ' · ' + r.statusLabel, onclick: () => CTX.app.selectRelation(r.id) }, [
      other ? D.avatar(other, 28) : null,
      el('div', { class: 'rtext' }, [
        el('div', { class: 'rlabel' }, [
          el('span', { class: 'verifdot', style: 'background:' + r.statusColor + ';color:' + r.statusColor, title: r.statusLabel }),
          ' ', label + ' ', el('b', { text: other ? other.name : otherId })
        ]),
        el('div', { class: 'rmeta' }, [
          fmtRange(r), '·', r.statusLabel,
          typeof r.amount === 'number' ? '· ' + fmtMoney(r.amount, r.currency) : null,
          r.src ? '· ' + ((model.byId.get(r.src) || {}).name || r.src).slice(0, 34) : '· sem fonte'
        ])
      ]),
      el('button', { class: 'go', type: 'button', title: 'Carregar ligações desta entidade', text: '+',
        onclick: (ev) => { ev.stopPropagation(); CTX.app.expand(otherId, 1); } })
    ]);
  }

  function invertLabel(kindLabel) {
    const map = {
      'Participação accionista em': 'Tem como accionista',
      'É subsidiária de': 'Tem como subsidiária',
      'Ocupou cargo em': 'Teve como titular de cargo',
      'Membro de órgão social de': 'Tem como membro de órgão social',
      'Financiou': 'Foi financiada por',
      'Recebeu financiamento de': 'Financiou',
      'Celebrou contrato com': 'Celebrou contrato com',
      'É regulada por': 'Regula',
      'Foi investigada por': 'Investigou',
      'É mencionada em': 'Menciona',
      'Está documentada em': 'Documenta',
      'Documenta': 'Documenta',
      'Foi acusada por': 'Acusou',
      'Pronunciou-se sobre': 'Foi objecto de pronúncia de',
      'Nomeou': 'Foi nomeada por'
    };
    return map[kindLabel] || kindLabel;
  }

  function block(title, children) {
    return el('div', { class: 'block' }, [el('h4', {}, [title, el('span', { class: 'n', text: Array.isArray(children) ? '(' + children.length + ')' : '' })]),
      ...(Array.isArray(children) ? children : [children])]);
  }

  /* ---------------- RELAÇÃO ---------------- */
  function relationView(id) {
    const { model } = CTX;
    const r = model.relById.get(id);
    if (!r) return el('div', { class: 'empty', text: 'Relação não encontrada.' });
    const from = model.byId.get(r.from), to = model.byId.get(r.to);
    const srcDoc = r.src ? model.byId.get(r.src) : null;
    const conf = typeof r.conf === 'number' ? r.conf : null;

    const term = el('div', { class: 'rbody' }, [
      el('div', { class: 'rterm' }, [
        el('b', { text: from ? from.name : r.from }),
        el('span', { class: 'arrow', text: r.directed ? '→' : '↔' }),
        el('b', { text: to ? to.name : r.to })
      ]),
      el('div', { class: 'srcmeta', style: 'margin-top:5px' }, [
        el('span', { class: 'swatch', style: 'background:' + r.familyColor }),
        el('span', { text: r.kindLabel }),
        r.directed ? null : el('span', { class: 'tag', text: 'não dirigida' })
      ]),
      el('dl', { class: 'kv' }, [
        el('dt', { text: 'Família' }), el('dd', { text: r.familyLabel }),
        el('dt', { text: 'Período' }), el('dd', { text: fmtRange(r) }),
        el('dt', { text: 'Precisão' }), el('dd', { text: r.hasDates ? r.startPrecisionLabel : 'datas desconhecidas — não projectar' }),
        el('dt', { text: 'Estado' }), el('dd', {}, [D.statusChip(r.status, model.verification)]),
        el('dt', { text: 'Confiança' }), el('dd', {}, [conf != null ? el('span', { class: 'conf' }, [
          el('span', { class: 'bar' }, [el('i', { style: 'width:' + (conf / 5) * 100 + '%' })]),
          el('span', { text: conf + '/5' })
        ]) : el('span', { class: 'muted', text: 'não avaliada' })]),
        el('dt', { text: 'Justificação' }), el('dd', { text: r.why || '—' }),
        el('dt', { text: 'Fonte' }), el('dd', {}, [srcDoc
          ? el('button', { class: 'linkbtn', text: srcDoc.name, onclick: () => openSource(srcDoc.id) })
          : el('span', { class: 'tag bad', text: 'sem fonte documental' })]),
        el('dt', { text: 'Localização' }), el('dd', { text: r.loc || '—' }),
        el('dt', { text: 'Última verificação' }), el('dd', { text: r.lv ? fmtDate(r.lv) : 'nunca' }),
        el('dt', { text: 'ID' }), el('dd', { class: 'srcmeta' }, [el('span', { style: 'font-family:var(--mono)', text: r.id })])
      ])
    ]);

    const excerpt = r.ex ? el('div', { class: 'block' }, [
      el('h4', { text: 'Excerto que sustenta a relação' }),
      el('blockquote', { class: 'quote', text: '«' + r.ex.replace(/^«|»$/g, '') + '»' }),
      el('div', { class: 'srcmeta' }, [r.loc ? 'localização: ' + r.loc : '', srcDoc ? ' · ' + srcDoc.name : ''])
    ]) : el('div', { class: 'warnbox', text: 'Sem excerto de suporte. Esta relação não deve ser apresentada como documentada.' });

    const actions = el('div', { class: 'actions' }, [
      srcDoc ? el('button', { class: 'btn sm', type: 'button', text: 'Abrir fonte', onclick: () => openSource(srcDoc.id) }) : null,
      el('button', { class: 'btn sm', type: 'button', text: 'Realçar', onclick: () => CTX.app.highlightRelation(id) }),
      el('button', { class: 'btn sm', type: 'button', text: 'Expandir extremos', onclick: () => { CTX.app.expand(r.from, 1); CTX.app.expand(r.to, 1); } }),
      el('button', { class: 'btn sm', type: 'button', text: 'Caminho', onclick: () => { CTX.app.setPathMode(true); CTX.store.setPath({ a: r.from, b: r.to }); VN.paths.refreshBar(); setTab('paths'); } }),
      el('button', { class: 'btn sm', type: 'button', text: 'Ocultar', onclick: () => { CTX.store.hide(id, true); CTX.app.refresh(); } }),
      el('button', { class: 'btn sm', type: 'button', text: 'Copiar citação', onclick: () => { D.copy('«' + (r.ex || '') + '» — ' + (srcDoc ? srcDoc.name : 'sem fonte') + (r.loc ? ', ' + r.loc : '') + ' [' + r.id + ']'); D.toast('Citação copiada com referência'); } })
    ]);

    const sides = el('div', { class: 'block' }, [
      el('h4', { text: 'Entidades' }),
      ...[from, to].filter(Boolean).map((ent) => el('div', { class: 'relrow', onclick: () => CTX.app.focusEntity(ent.id) }, [
        D.avatar(ent, 28),
        el('div', { class: 'rtext' }, [
          el('div', { class: 'rlabel' }, [el('b', { text: ent.name })]),
          el('div', { class: 'rmeta' }, [ent.typeLabel, '·', ent.statusLabel])
        ]),
        el('span', { class: 'go', text: '›' })
      ]))
    ]);

    const others = el('div', { class: 'block' }, [
      el('h4', { text: 'O que esta ligação não prova' }),
      el('p', { class: 'side-note', style: 'padding:0', text: 'Uma relação tipificada documenta um acto ou vínculo registado numa fonte. Não estabelece intenção, ilegalidade, coordenação com terceiros, nem benefício efectivo. Relações marcadas como alegadas, não verificadas ou contraditadas devem ser lidas com a reserva correspondente.' })
    ]);

    return el('div', {}, [term, actions, excerpt, sides, others]);
  }

  /* ---------------- FONTE / DOCUMENTO ---------------- */
  function openSource(docId) {
    const { model } = CTX;
    const d = model.byId.get(docId);
    if (!d) return;
    const citing = model.relations.filter((r) => r.src === docId);
    const content = el('div', {}, [
      el('div', { class: 'chips' }, [
        el('span', { class: 'chip', style: 'border-color:' + d.typeColor + '66' }, [el('span', { class: 'dot', style: 'background:' + d.typeColor }), d.typeLabel]),
        D.statusChip(d.status, model.verification),
        el('span', { class: 'chip', text: fmtDate(d.date, d.precision) })
      ]),
      el('p', { style: 'margin-top:10px', text: d.ctx || '' }),
      (d.facts || []).length ? el('ul', {}, d.facts.map((f) => el('li', { text: f }))) : null,
      d.url ? el('p', {}, [el('a', { href: d.url, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir fonte original ↗' }),
        el('span', { class: 'muted', text: '  (' + (d.retrievedAt ? 'recolhida em ' + d.retrievedAt : 'data de recolha desconhecida') + ')' })])
        : el('div', { class: 'warnbox', text: 'Documento sem URL: faz parte do conjunto fictício de demonstração. No modo real, cada documento tem endereço de origem, data de recolha e hash do excerto.' }),
      d.hash ? el('p', { class: 'srcmeta' }, ['hash SHA-256 do excerto: ', el('code', { text: d.hash })]) : null,
      el('h3', { text: 'Relações sustentadas por este documento (' + citing.length + ')' }),
      ...citing.map((r) => el('div', { style: 'border-top:1px solid var(--line);padding:8px 0' }, [
        el('div', { class: 'rterm', style: 'font-size:12.5px' }, [el('b', { text: r.fromName }), ' ',
          el('span', { class: 'arrow', text: '→' }), ' ', el('b', { text: r.toName }), ' ',
          el('span', { class: 'muted', text: '· ' + r.kindLabel })]),
        r.loc ? el('div', { class: 'srcmeta', text: r.loc }) : null,
        r.ex ? el('blockquote', { class: 'quote', text: '«' + r.ex.replace(/^«|»$/g, '') + '»' }) : null,
        el('div', { class: 'srcmeta' }, [D.statusChip(r.status, model.verification),
          el('button', { class: 'linkbtn', text: 'ver relação', onclick: () => { document.getElementById('modal').hidden = true; CTX.app.selectRelation(r.id); } })])
      ]))
    ]);
    VN.panels.modal(d.name, content, { wide: true });
  }

  VN.details = { init, render, setTab, currentTab, openSource, entityView, relationView };
})(typeof window !== 'undefined' ? window : globalThis);
