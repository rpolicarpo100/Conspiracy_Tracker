/* =====================================================================
   VN · PÁGINA DE PESQUISA COMPLETA
   Todos os resultados (entidades + ligações), fachas por tipo/estado/ano,
   ligações entre resultados, carregamento no grafo, exportação com fontes
   e registo de resultados negativos.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const D = VN.dom;
  const { el, clear } = D;

  let CTX = null, state = { q: '', sort: 'score', results: null, facets: {}, kind: 'all', facetSel: { type: null, status: null, year: null } };

  function init(ctx) { CTX = ctx; }

  function index() {
    const m = CTX.model;
    if (!m._searchIndex) m._searchIndex = VN.index.build(m);
    return m._searchIndex;
  }

  function open(q) {
    state.q = q || '';
    state.facetSel = { type: null, status: null, year: null };
    state.sort = 'score'; state.kind = 'all';
    const body = el('div', { class: 'spage' });
    const m = VN.panels.modal('Pesquisa completa', body, { wide: true });
    const render = () => {
      clear(body);
      body.appendChild(controls(render));
      const res = state.results;
      if (!res) return;
      body.appendChild(summary(res));
      const filtered = applyFacets(res.results);
      body.appendChild(kindBar(res, filtered, render));
      if (!filtered.length) {
        body.appendChild(el('div', { class: 'empty', text: 'Sem resultados com as fachas seleccionadas.' }));
        return;
      }
      body.appendChild(list(filtered, render));
      body.appendChild(connections(filtered));
      body.appendChild(actions(res, filtered));
    };
    state.results = VN.search.run(index(), state.q, { limit: 400 });
    state.facets = VN.search.facets(state.results.results, CTX.model);
    render();
    VN.searchpage._render = render;
    return m;
  }

  function controls(render) {
    const input = el('input', { type: 'text', value: state.q, placeholder: 'termos, "frase", tipo:pessoa, estado:alegado, ano:2016-2020, -excluir', style: 'flex:1' });
    const go = () => {
      state.q = input.value.trim();
      state.results = VN.search.run(index(), state.q, { limit: 400 });
      state.facets = VN.search.facets(state.results.results, CTX.model);
      state.facetSel = { type: null, status: null, year: null };
      render();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return el('div', { style: 'display:flex;gap:6px;align-items:center;margin-bottom:10px' }, [
      input,
      el('button', { class: 'btn primary sm', type: 'button', text: 'Pesquisar', onclick: go }),
      el('button', { class: 'btn sm', type: 'button', text: 'Sintaxe', onclick: () => openHelp() })
    ]);
  }

  function summary(res) {
    const t = res.totalsAll || res.counts;
    return el('div', { class: 'infobox' }, [
      el('div', {}, [
        el('b', { text: res.total + ' resultado' + (res.total === 1 ? '' : 's') }),
        el('span', { class: 'muted', text: ' · ' + t.entities + ' entidades · ' + t.relations + ' ligações · ' + res.ms + ' ms' })
      ]),
      res.expanded ? el('div', { class: 'tag warn', style: 'margin-top:5px', text: 'pesquisa alargada: não havia documentos com todos os termos' }) : null,
      res.notFound && res.notFound.length ? el('div', { class: 'srcmeta', style: 'margin-top:5px' }, [
        el('span', { text: 'termos sem qualquer correspondência: ' }),
        ...res.notFound.map((x) => el('span', { class: 'tag bad', text: x })),
        el('span', { class: 'muted', text: ' (registar como resultado negativo)' })
      ]) : null,
      res.suggestions && res.suggestions.length ? el('div', { class: 'srcmeta', style: 'margin-top:5px' }, [
        el('span', { text: 'quis dizer: ' }),
        ...res.suggestions.map((s) => el('button', { class: 'linkbtn', text: s.suggestion, onclick: () => { state.q = s.suggestion; open(s.suggestion); } }))
      ]) : null,
      el('div', { class: 'srcmeta', style: 'margin-top:6px', text: 'Procurado em ' + res.searched.documents + ' registos, ' + res.searched.tokens + ' termos indexados. A ausência de resultado não prova inexistência: registe-a com fonte e data.' })
    ]);
  }

  function applyFacets(rows) {
    (function f(rows) { return rows; })(rows);
    return rows.filter((r) => {
      const s = state.facetSel;
      if (state.kind !== 'all' && r.kind !== state.kind) return false;
      if (s.type) {
        if (r.entity) { if (r.entity.type !== s.type) return false; }
        else if (![r.relation.fromType, r.relation.toType].includes(s.type)) return false;
      }
      if (s.status) {
        const st = r.entity ? r.entity.status : r.relation.status;
        if (st !== s.status) return false;
      }
      if (s.year) {
        const y = r.entity ? r.entity.year : r.relation.yStart;
        if (y !== s.year) return false;
      }
      return true;
    }).sort((a, b) => {
      if (state.sort === 'name') {
        const an = a.entity ? a.entity.name : a.relation.fromName;
        const bn = b.entity ? b.entity.name : b.relation.fromName;
        return an.localeCompare(bn, 'pt');
      }
      if (state.sort === 'date') {
        const ay = a.entity ? (a.entity.year || 9999) : (a.relation.yStart || 9999);
        const by = b.entity ? (b.entity.year || 9999) : (b.relation.yStart || 9999);
        return ay - by;
      }
      if (state.sort === 'evidence') {
        const ae = a.entity ? a.entity.status === 'confirmed' : a.relation.statusWeight;
        const be = b.entity ? b.entity.status === 'confirmed' : b.relation.statusWeight;
        return (be === ae ? b.score - a.score : (be ? 1 : 0) - (ae ? 1 : 0));
      }
      return b.score - a.score;
    });
  }

  function kindBar(res, filtered, render) {
    const b = (label, k) => el('button', {
      class: 'btn sm' + (state.kind === k ? ' primary' : ''), type: 'button',
      text: label, onclick: () => { state.kind = k; render(); }
    });
    const f = state.facets;
    const chipBtn = (label, group, value, count) => el('button', {
      class: 'chip' + (state.facetSel[group] === value ? ' on' : ''), type: 'button',
      title: 'Filtrar por ' + label,
      text: label + (count != null ? ' (' + count + ')' : ''),
      onclick: () => { state.facetSel[group] = state.facetSel[group] === value ? null : value; render(); }
    });
    const typeChips = Object.keys(f.types || {}).sort((a, b) => f.types[b] - f.types[a]).slice(0, 8)
      .map((t) => chipBtn((CTX.model.entityTypes[t] || {}).label || t, 'type', t, f.types[t]));
    const statusChips = Object.keys(f.statuses || {}).sort((a, b) => f.statuses[b] - f.statuses[a])
      .map((s) => chipBtn((CTX.model.verification[s] || {}).label || s, 'status', s, f.statuses[s]));
    const years = Object.keys(f.years || {}).map(Number).sort((a, b) => b - a).slice(0, 6);
    const yearChips = years.map((y) => chipBtn(String(y), 'year', y, f.years[y]));
    const sortSel = el('select', { style: 'width:auto', onchange: (e) => { state.sort = e.target.value; render(); } }, [
      el('option', { value: 'score', text: 'Ordenar: relevância' }),
      el('option', { value: 'evidence', text: 'Ordenar: qualidade de prova' }),
      el('option', { value: 'date', text: 'Ordenar: data' }),
      el('option', { value: 'name', text: 'Ordenar: nome' })
    ]);
    return el('div', { style: 'margin:8px 0' }, [
      el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px' }, [
        b('Tudo (' + res.total + ')', 'all'),
        b('Entidades (' + res.totalsAll.entities + ')', 'entity'),
        b('Ligações (' + res.totalsAll.relations + ')', 'relation'),
        el('span', { class: 'grow', style: 'flex:1' }),
        sortSel
      ]),
      el('div', { class: 'chips' }, [...typeChips, ...statusChips, ...yearChips])
    ]);
  }

  function list(rows, render) {
    const wrap = el('div', { style: 'max-height:46vh;overflow:auto;border:1px solid var(--line);border-radius:10px' });
    rows.slice(0, 300).forEach((r) => {
      const isEnt = r.kind === 'entity';
      const e = r.entity, rel = r.relation;
      const row = el('div', { class: 'sprow' }, [
        isEnt ? el('img', { src: VN.avatars.dataUri(e, 32), width: 32, height: 32, alt: '', style: 'border-radius:8px' })
          : el('span', { class: 'rel-icon', text: '⇄' }),
        el('div', { style: 'flex:1;min-width:0' }, [
          el('div', {}, isEnt
            ? el('b', { text: e.name })
            : el('span', {}, [el('b', { text: rel.fromName }), el('span', { class: 'relkind', text: ' ' + rel.kindLabel + ' ' }), el('b', { text: rel.toName })])),
          el('div', { class: 'srcmeta' }, isEnt
            ? [el('span', { class: 'dot', style: 'background:' + e.typeColor }), e.typeLabel, ' · ' + e.statusLabel, ' · ' + (e.juris || '—'), e.date ? ' · ' + D.fmtDate(e.date, e.precision) : ' · data desconhecida']
            : [el('span', { class: 'verifdot', style: 'background:' + rel.statusColor + ';color:' + rel.statusColor }), rel.statusLabel,
              ' · ' + D.fmtRange(rel), rel.src ? ' · ' + ((CTX.model.byId.get(rel.src) || {}).name || '') : ' · sem fonte',
              el('button', { class: 'linkbtn', text: '· relação', onclick: () => { document.getElementById('modal').hidden = true; CTX.app.selectRelation(rel.id); } })]),
          r.snippet ? el('div', { class: 'ssnip', style: 'margin-top:3px', html: r.snippet.html }) : null,
          el('div', { class: 'swhy2' }, r.why.slice(0, 3).map((w) => el('span', { class: 'minitag', text: w })))
        ]),
        el('div', { style: 'display:flex;flex-direction:column;gap:4px;flex:none' }, [
          isEnt ? el('button', { class: 'btn sm', type: 'button', text: 'Carregar', onclick: () => {
            CTX.store.ensureLoaded(e.id); CTX.app.refresh({ anchor: e.id }); D.toast('«' + e.name + '» no grafo');
          } }) : el('button', { class: 'btn sm', type: 'button', text: 'Carregar', onclick: () => {
            CTX.store.ensureLoaded(rel.from); CTX.store.ensureLoaded(rel.to); CTX.app.refresh({ anchor: rel.from }); D.toast('Ligação carregada');
          } }),
          el('button', { class: 'btn sm', type: 'button', text: 'Abrir', onclick: () => {
            document.getElementById('modal').hidden = true;
            if (isEnt) CTX.app.focusEntity(e.id); else CTX.app.selectRelation(rel.id);
          } })
        ])
      ]);
      wrap.appendChild(row);
    });
    if (rows.length > 300) wrap.appendChild(el('div', { class: 'srcmeta', style: 'padding:8px', text: 'A mostrar 300 de ' + rows.length + '. Refine a pesquisa ou exporte.' }));
    return wrap;
  }

  function connections(rows) {
    const ids = rows.filter((r) => r.kind === 'entity').slice(0, 8).map((r) => r.entity.id);
    if (ids.length < 2) return el('div');
    const c = VN.search.connections(CTX.model, ids, { limit: 8 });
    return el('div', { class: 'block', style: 'margin-top:12px' }, [
      el('h4', { text: 'Ligações entre os resultados' }),
      el('div', { class: 'srcmeta' }, ['Distância mínima entre os dois primeiros resultados: ', el('b', { text: c.distance != null ? c.distance + ' passos' : 'não encontrada' })]),
      c.direct.length ? el('div', {}, [
        el('div', { class: 'srcmeta', text: 'Relações directas registadas entre resultados:' }),
        ...c.direct.slice(0, 10).map((r) => el('div', { class: 'relrow', onclick: () => { document.getElementById('modal').hidden = true; CTX.app.selectRelation(r.id); } }, [
          el('div', { class: 'rtext' }, [
            el('div', { class: 'rlabel' }, [el('b', { text: r.fromName }), ' ' + r.kindLabel + ' ', el('b', { text: r.toName })]),
            el('div', { class: 'rmeta' }, [el('span', { class: 'verifdot', style: 'background:' + r.statusColor + ';color:' + r.statusColor }), r.statusLabel, ' · ' + D.fmtRange(r)])
          ])
        ]))
      ]) : el('p', { class: 'side-note', text: 'Não existe relação directa registada entre estes resultados. Use «Caminhos» para procurar sequências documentadas.' }),
      c.shared.length ? el('div', { class: 'srcmeta', style: 'margin-top:6px' }, [
        el('span', { text: 'Vizinhos comuns: ' }),
        ...c.shared.map((s) => el('button', { class: 'linkbtn', text: s.entity.name + ' (' + s.count + ')', onclick: () => { document.getElementById('modal').hidden = true; CTX.app.focusEntity(s.entity.id); } }))
      ]) : null
    ]);
  }

  function actions(res, filtered) {
    return el('div', { class: 'actions', style: 'margin-top:12px' }, [
      el('button', { class: 'btn primary sm', type: 'button', text: 'Carregar todos os resultados no grafo', onclick: () => {
        let n = 0;
        filtered.forEach((r) => {
          if (r.entity) { CTX.store.ensureLoaded(r.entity.id); n++; }
          else { CTX.store.ensureLoaded(r.relation.from); CTX.store.ensureLoaded(r.relation.to); n += 2; }
        });
        CTX.store.state.lastAction = 'Pesquisa «' + state.q + '»: ' + n + ' entidades carregadas';
        CTX.app.refresh({ fit: true, force: true });
        D.toast('Resultados carregados no grafo (' + n + ' entidades)', 'ok');
        document.getElementById('modal').hidden = true;
      } }),
      el('button', { class: 'btn sm', type: 'button', text: 'Exportar resultados (HTML com fontes)', onclick: () => {
        D.download('pesquisa-' + new Date().toISOString().slice(0, 10) + '.html', exportHTML(state.q, filtered), 'text/html;charset=utf-8');
        D.toast('Resultados exportados com fontes', 'ok');
      } }),
      el('button', { class: 'btn sm', type: 'button', text: 'Registar «não encontrado»', onclick: () => {
        document.getElementById('modal').hidden = true;
        VN.console.openNegative(state.q);
      } })
    ]);
  }

  function exportHTML(q, rows) {
    const esc = D.esc;
    const h = ['<!DOCTYPE html><html lang="pt-PT"><head><meta charset="utf-8"><title>Resultados de pesquisa — ' + esc(q) + '</title>',
      '<style>body{font:13px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:960px;margin:30px auto;padding:0 18px;color:#1b2431}',
      'table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #dfe5ec;padding:5px 7px;text-align:left;vertical-align:top}',
      'th{background:#f3f6fa;font-size:11px;text-transform:uppercase}.q{color:#5b6b82;font-style:italic}.b{display:inline-block;padding:1px 6px;border:1px solid #cbd5e1;border-radius:99px;font-size:10px}',
      '.warn{border-left:3px solid #b45309;background:#fff8ec;padding:9px 12px;margin:10px 0;font-size:12px}</style></head><body>'];
    h.push('<h1>Resultados de pesquisa</h1>');
    h.push('<p class="q">Termo: «' + esc(q) + '» · ' + rows.length + ' resultados · gerado em ' + new Date().toLocaleString('pt-PT') + '</p>');
    h.push('<div class="warn">A relevância da pesquisa ordena resultados por utilidade, <b>não</b> é uma medida de verdade nem de culpa. Cada linha remete para a fonte e o estado de verificação.</div>');
    h.push('<table><tr><th>Tipo</th><th>Resultado</th><th>Estado</th><th>Fonte</th><th>Excerto</th><th>Referência</th></tr>');
    rows.slice(0, 500).forEach((r) => {
      if (r.entity) {
        h.push('<tr><td>' + esc(r.entity.typeLabel) + '</td><td><b>' + esc(r.entity.name) + '</b><br><span class="q">' + esc(r.entity.short || '') + '</span></td>' +
          '<td>' + esc(r.entity.statusLabel) + '</td><td>' + esc((r.entity.facts || []).length + ' factos documentados') + '</td><td>' + esc(r.snippet ? r.snippet.html.replace(/<[^>]+>/g, '') : '') + '</td><td>' + esc(r.entity.id) + '</td></tr>');
      } else {
        const rel = r.relation;
        h.push('<tr><td>Ligação</td><td>' + esc(rel.fromName) + ' <b>' + esc(rel.kindLabel) + '</b> ' + esc(rel.toName) + '</td>' +
          '<td>' + esc(rel.statusLabel) + '</td><td>' + esc(rel.src ? ((CTX.model.byId.get(rel.src) || {}).name || rel.src) : 'sem fonte') + '</td>' +
          '<td>' + esc(rel.ex || '') + '</td><td>' + esc(rel.id) + '</td></tr>');
      }
    });
    h.push('</table></body></html>');
    return h.join('\n');
  }

  function openHelp() {
    VN.panels.modal('Sintaxe e alcance da pesquisa', el('div', {}, [
      el('h3', { text: 'Sintaxe' }),
      el('table', { class: 'listtable' }, [
        el('thead', {}, [el('tr', {}, ['Escreva', 'Efeito'].map((x) => el('th', { text: x })))]),
        el('tbody', {}, [
          ['samaniego rocha', 'todos os termos têm de aparecer (AND). Se nada houver, a pesquisa alarga e avisa.'],
          ['"beneficiário efectivo"', 'frase exacta, na ordem'],
          ['-documento', 'excluir resultados que contenham o termo'],
          ['tipo:pessoa', 'só entidades desse tipo (nas ligações: extremos desse tipo)'],
          ['estado:alegado', 'só o que está nesse estado de verificação'],
          ['ano:2016 ou ano:2015-2020', 'intervalo temporal (exclui registos sem data)'],
          ['fonte:certidão', 'resultados cuja fonte contenha esse texto'],
          ['família:financeira', 'só ligações dessa família'],
          ['rel:accionista', 'só tipos de relação que contenham o termo'],
          ['etiqueta:offshore', 'entidades com essa etiqueta'],
          ['id:r-079', 'identificador interno']
        ].map((r) => el('tr', {}, [el('td', {}, [el('code', { text: r[0] })]), el('td', { text: r[1] })])))
      ]),
      el('h3', { text: 'O que é indexado' }),
      el('ul', {}, [
        el('li', { text: 'Entidades: nome, alias, identificador, descrição, etiquetas, contexto, factos, alegações, contra-provas, jurisdição.' }),
        el('li', { text: 'Ligações: tipo, família, entidades ligadas, justificação, localização na fonte e excerto literal.' }),
        el('li', { text: 'Acentos e maiúsculas são ignorados; plurais e gralhas comuns são tolerados (assinalados como aproximados).' }),
        el('li', { text: 'Sinónimos documentais (accionista/participação, financiou/emprestou) são expandidos com peso menor e assinalados.' })
      ]),
      el('h3', { text: 'O que a pesquisa NÃO faz' }),
      el('ul', {}, [
        el('li', { text: 'Não funde entidades homónimas: uma semelhança de nome é apresentada como semelhança, nunca como identidade.' }),
        el('li', { text: 'Não infere relações: devolve registos e excertos existentes; ligações entre resultados são as registadas.' }),
        el('li', { text: 'Não ordena por culpa nem por suspeita. Ordena por utilidade (correspondência, documentação, grau).' }),
        el('li', { text: 'Não conclui a partir da ausência de resultados: «não encontrado» pode ser registado no livro de provas com fonte, termos e data.' })
      ]),
      el('div', { class: 'warnbox', text: 'Pesquisar melhor é alargar a base documental e explicar cada correspondência — não acelerar conclusões.' })
    ]), { wide: true });
  }

  VN.searchpage = { init, open, openHelp };
})(typeof window !== 'undefined' ? window : globalThis);
