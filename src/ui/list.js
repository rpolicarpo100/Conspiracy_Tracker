/* VN · Vista em tabela — alternativa acessível ao grafo, mesmos dados e filtros. */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const { el, clear, fmtDate, fmtRange, fmtNum } = VN.dom;

  function show(ctx, which) {
    const { model, store } = ctx;
    const masks = store.masks();
    const wrap = el('div', { class: 'listwrap' });
    const tabs = el('div', { class: 'chips', style: 'margin-bottom:10px' }, [
      el('button', { class: 'btn sm' + (which !== 'relations' ? ' primary' : ''), type: 'button', text: 'Entidades (' + masks.nodes.size + ')', onclick: () => show(ctx, 'entities') }),
      el('button', { class: 'btn sm' + (which === 'relations' ? ' primary' : ''), type: 'button', text: 'Relações (' + masks.edges.size + ')', onclick: () => show(ctx, 'relations') }),
      el('button', { class: 'btn sm', type: 'button', text: 'Exportar CSV (todas as relações)', onclick: () => ctx.app.exportCSV() })
    ]);
    wrap.appendChild(tabs);
    wrap.appendChild(el('p', { class: 'muted', style: 'font-size:11.5px', text: 'Mesma informação do grafo, em formato tabular. Respeita os filtros activos. Clique numa linha para a abrir no painel de detalhes.' }));

    if (which === 'relations') {
      const t = el('table', { class: 'listtable' }, [
        el('thead', {}, [el('tr', {}, ['ID', 'Origem', 'Relação', 'Destino', 'Período', 'Estado', 'Conf.', 'Fonte', 'Excerto'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, model.relations.filter((r) => masks.edges.has(r.id)).map((r) => el('tr', {
          style: 'cursor:pointer', onclick: () => ctx.app.selectRelation(r.id)
        }, [
          el('td', { class: 'mono', text: r.id }),
          el('td', { text: r.fromName }),
          el('td', {}, [el('span', { class: 'swatch', style: 'background:' + r.familyColor }), ' ' + r.kindLabel]),
          el('td', { text: r.toName }),
          el('td', { text: fmtRange(r) }),
          el('td', {}, [el('span', { class: 'tag ' + (r.status === 'confirmed' ? 'ok' : r.status === 'contradicted' ? 'bad' : 'warn'), text: r.statusLabel })]),
          el('td', { text: r.conf != null ? String(r.conf) : '—' }),
          el('td', { text: r.src ? ((model.byId.get(r.src) || {}).name || r.src) : '—' }),
          el('td', { style: 'max-width:280px;color:var(--ink2)', text: r.ex ? '«' + r.ex.replace(/^«|»$/g, '') + '»' : '—' })
        ])))
      ]);
      wrap.appendChild(t);
    } else {
      const rows = Array.from(masks.nodes).map((id) => model.byId.get(id)).filter(Boolean)
        .sort((a, b) => model.stats.get(b.id).degree - model.stats.get(a.id).degree);
      const t = el('table', { class: 'listtable' }, [
        el('thead', {}, [el('tr', {}, ['', 'Nome', 'Tipo', 'Estado', 'Jurisdição', 'Data', 'Ligações', 'Confirmadas', 'Docs', 'ID'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, rows.map((e) => {
          const s = model.stats.get(e.id);
          return el('tr', { style: 'cursor:pointer', onclick: () => { document.getElementById('modal').hidden = true; ctx.app.focusEntity(e.id); } }, [
            el('td', {}, [el('img', { src: VN.avatars.dataUri(e, 26), width: 26, height: 26, style: 'border-radius:6px', alt: '' })]),
            el('td', {}, [el('b', { text: e.name }), el('div', { class: 'muted', style: 'font-size:10.5px', text: e.short || '' })]),
            el('td', { text: e.typeLabel }),
            el('td', {}, [el('span', { class: 'tag ' + (e.status === 'confirmed' ? 'ok' : e.status === 'contradicted' ? 'bad' : 'warn'), text: e.statusLabel })]),
            el('td', { text: e.juris || '—' }),
            el('td', { text: e.date ? fmtDate(e.date, e.precision) : '—' }),
            el('td', { text: String(s.degree) }),
            el('td', { text: String(s.confirmed) }),
            el('td', { text: String(s.documents.size) }),
            el('td', { class: 'mono', text: e.id })
          ]);
        }))
      ]);
      wrap.appendChild(t);
    }
    const m = VN.panels.modal(which === 'relations' ? 'Relações (vista em tabela)' : 'Entidades (vista em tabela)', wrap, { wide: true });
    return m;
  }

  VN.list = { show };
})(typeof window !== 'undefined' ? window : globalThis);
