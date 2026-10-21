/* =====================================================================
   VN · PALETA DE PESQUISA
   Pesquisa profunda a partir de qualquer ponto da aplicação:
   entidades + ligações + excertos, com explicação da correspondência
   («porquê»), sugestões para gralhas, ligações-entre-resultados e
   registo de resultados negativos. Nunca funde entidades homónimas.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const D = VN.dom;
  const { el, clear } = D;
  const K_RECENT = 'vn-recent-searches';

  let CTX = null, input = null, box = null, items = [], idx = -1, lastResult = null, timer = null;

  function init(ctx) {
    CTX = ctx;
    input = document.getElementById('search');
    box = document.getElementById('searchresults');
    if (!input || !box) return;

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => run(input.value), 80);
    });
    input.addEventListener('focus', () => { if (!input.value.trim()) showRecent(); else run(input.value); });
    input.addEventListener('keydown', onKey);
    document.addEventListener('click', (ev) => {
      if (!box.contains(ev.target) && ev.target !== input && !ev.target.closest('.sresult')) close();
    });
    document.addEventListener('keydown', (ev) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); open(); }
    });
  }

  function open(preset) {
    if (!input) return;
    if (preset != null) input.value = preset;
    input.focus(); input.select();
    if (input.value.trim()) run(input.value); else showRecent();
  }
  function close() { if (box) box.hidden = true; input && input.setAttribute('aria-expanded', 'false'); idx = -1; CTX.app.engine.markSearch([]); }

  function index() {
    const m = CTX.model;
    if (!m._searchIndex) m._searchIndex = VN.index.build(m);
    return m._searchIndex;
  }

  function run(q) {
    const query = String(q || '').trim();
    if (!query) { showRecent(); return; }
    const res = VN.search.run(index(), query, { limit: 60 });
    lastResult = res;
    render(res);
    // realçar no grafo as entidades encontradas
    const ids = res.results.filter((r) => r.kind === 'entity').slice(0, 40).map((r) => r.entity.id);
    CTX.app.engine.markSearch(ids);
  }

  function head(res) {
    const parts = [];
    parts.push(el('b', { text: (res.total || 0) + ' resultado' + (res.total === 1 ? '' : 's') }));
    const t = res.totalsAll || res.counts;
    if (t.entities || t.relations) parts.push(el('span', { class: 'muted', text: ' · ' + t.entities + ' entidades, ' + t.relations + ' ligações' }));
    parts.push(el('span', { class: 'muted', text: ' · ' + res.ms + ' ms' }));
    if (res.expanded) parts.push(el('span', { class: 'tag warn', text: 'pesquisa alargada (todos os termos não coincidiam)' }));
    const wrap = el('div', { class: 'spalhead' }, parts);
    if (res.parsed.hasStructured) {
      const chips = el('div', { class: 'spalchips' }, []);
      const p = res.parsed;
      p.filters.type.forEach((x) => chips.appendChild(chip('tipo:' + (CTX.model.entityTypes[x] || {}).label || x)));
      p.filters.status.forEach((x) => chips.appendChild(chip('estado:' + (CTX.model.verification[x] || {}).label || x)));
      p.filters.family.forEach((x) => chips.appendChild(chip('família:' + x)));
      p.filters.rel.forEach((x) => chips.appendChild(chip('relação:' + x)));
      p.filters.tag.forEach((x) => chips.appendChild(chip('etiqueta:' + x)));
      if (p.yearFrom != null || p.yearTo != null) chips.appendChild(chip('ano:' + (p.yearFrom != null ? p.yearFrom : '') + '–' + (p.yearTo != null ? p.yearTo : '')));
      if (chips.children.length) wrap.appendChild(chips);
    }
    return wrap;
  }
  const chip = (text) => el('span', { class: 'chip', text: text });

  function row(r, i) {
    const isEnt = r.kind === 'entity';
    const e = r.entity, rel = r.relation;
    const node = el('div', { class: 'sresult' + (isEnt ? '' : ' rel'), role: 'option', id: 'sres-' + i, 'aria-selected': 'false' });
    node.dataset.idx = String(i);

    if (isEnt) node.appendChild(el('img', { src: VN.avatars.dataUri(e, 30), width: 30, height: 30, alt: '' }));
    else node.appendChild(el('span', { class: 'rel-icon', title: 'Ligação documentada', text: '⇄' }));

    const mid = el('div', { class: 'smain' });
    if (isEnt) {
      mid.appendChild(el('span', { class: 'sname', text: e.name }));
      mid.appendChild(el('span', { class: 'smeta' }, [
        el('span', { class: 'dot', style: 'background:' + e.typeColor }), e.typeLabel,
        el('span', { text: '· ' + e.statusLabel }),
        el('span', { text: '· ' + (CTX.model.stats.get(e.id) || { degree: 0 }).degree + ' ligações' })
      ]));
    } else {
      mid.appendChild(el('span', { class: 'sname' }, [
        el('span', { text: rel.fromName }), el('span', { class: 'relkind', text: ' ' + rel.kindLabel + ' ' }), el('span', { text: rel.toName })
      ]));
      mid.appendChild(el('span', { class: 'smeta' }, [
        el('span', { class: 'verifdot', style: 'background:' + rel.statusColor + ';color:' + rel.statusColor }),
        rel.statusLabel,
        el('span', { text: '· ' + rel.familyLabel }),
        rel.src ? el('span', { text: '· ' + ((CTX.model.byId.get(rel.src) || {}).name || '').slice(0, 32) }) : el('span', { class: 'tag bad', text: 'sem fonte' })
      ]));
    }
    if (r.snippet && r.snippet.html) {
      mid.appendChild(el('span', { class: 'ssnip', html: r.snippet.html }));
    }
    if (r.why && r.why.length) {
      const why = el('span', { class: 'swhy2' }, []);
      r.why.slice(0, 3).forEach((w) => why.appendChild(el('span', { class: 'minitag' + (/aproximado/.test(w) ? ' warn' : ''), text: w })));
      mid.appendChild(why);
    }
    node.appendChild(mid);
    node.appendChild(el('span', { class: 'sscore', title: 'Pontuação de relevância (não é confiança na prova)', text: Math.round(r.score) + '' }));

    node.addEventListener('mouseenter', () => {
      idx = i; paint();
      if (isEnt) CTX.app.engine.highlight({ nodes: [e.id], edges: [], dimOthers: true });
      else CTX.app.engine.highlight({ nodes: [rel.from, rel.to], edges: [rel.id], dimOthers: true });
    });
    node.addEventListener('mouseleave', () => CTX.app.engine.markSearch(items.filter((x) => x.kind === 'entity').map((x) => x.entity.id)));
    node.addEventListener('click', (ev) => activate(i, ev.shiftKey, ev.altKey || ev.ctrlKey || ev.metaKey));
    return node;
  }

  function render(res) {
    clear(box);
    items = [];
    box.appendChild(head(res));

    if (!res.total) {
      empty(res);
      box.hidden = false; input.setAttribute('aria-expanded', 'true');
      return;
    }

    const ents = res.results.filter((r) => r.kind === 'entity');
    const rels = res.results.filter((r) => r.kind === 'relation');
    const maxEnt = 6, maxRel = 7;

    if (ents.length) {
      box.appendChild(el('div', { class: 'ssection' }, [
        el('span', { text: 'Entidades' }),
        el('span', { class: 'muted', text: ents.length > maxEnt ? ' · ' + ents.length : '' })
      ]));
      ents.slice(0, maxEnt).forEach((r) => { items.push(r); box.appendChild(row(r, items.length - 1)); });
    }
    if (rels.length) {
      box.appendChild(el('div', { class: 'ssection' }, [
        el('span', { text: 'Ligações e excertos' }),
        el('span', { class: 'muted', text: rels.length > maxRel ? ' · ' + rels.length : '' })
      ]));
      rels.slice(0, maxRel).forEach((r) => { items.push(r); box.appendChild(row(r, items.length - 1)); });
    }

    // ligações entre os resultados
    const entIds = ents.slice(0, 6).map((r) => r.entity.id);
    if (entIds.length >= 2) {
      const c = VN.search.connections(CTX.model, entIds, { limit: 6 });
      if (c.direct.length || c.shared.length) {
        const sec = el('div', { class: 'ssection' }, [el('span', { text: 'Ligações entre resultados' }),
          el('span', { class: 'muted', text: ' · registadas' })]);
        box.appendChild(sec);
        const line = el('div', { class: 'sconnect' }, []);
        c.direct.slice(0, 3).forEach((rel) => {
          line.appendChild(el('button', {
            class: 'linkbtn', type: 'button', title: 'Abrir esta ligação',
            text: rel.fromName + ' ' + rel.kindLabel + ' ' + rel.toName,
            onclick: () => { close(); CTX.app.selectRelation(rel.id); }
          }));
        });
        if (c.shared.length) {
          line.appendChild(el('span', { class: 'muted', text: 'vizinhos comuns: ' + c.shared.slice(0, 4).map((x) => x.entity.name).join(', ') }));
        }
        if (c.distance != null) line.appendChild(el('span', { class: 'muted', text: 'distância mínima entre os dois primeiros: ' + c.distance + ' passos' }));
        box.appendChild(line);
      }
    }

    const foot = el('div', { class: 'spalfoot' }, [
      el('span', { text: '↵ abrir' }), el('span', { text: '⇧↵ carregar no grafo' }),
      el('span', { text: '⌥↵ ver todos os resultados' }),
      el('button', { class: 'linkbtn', type: 'button', text: 'pesquisa completa →', onclick: () => openPage(input.value) })
    ]);
    box.appendChild(foot);
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    idx = 0; paint();
  }

  function empty(res) {
    box.appendChild(el('div', { class: 'semptyblock' }, [
      el('div', { text: 'Nenhum resultado para «' + (res.parsed.raw || '') + '».' }),
      el('div', { class: 'muted', style: 'font-size:11px;margin-top:4px' ,
        text: 'Pesquisados ' + (res.searched ? res.searched.documents : 0) + ' registos (' + (res.searched ? res.searched.tokens : 0) + ' termos indexados). Ausência de resultado não prova inexistência.' }),
      res.suggestions && res.suggestions.length ? el('div', { style: 'margin-top:6px' }, [
        el('span', { class: 'muted', text: 'Quis dizer: ' }),
        ...res.suggestions.map((s) => el('button', {
          class: 'chip', type: 'button', text: s.suggestion,
          onclick: () => { input.value = s.suggestion; run(s.suggestion); }
        }))
      ]) : null,
      el('div', { style: 'margin-top:8px;display:flex;gap:6px;flex-wrap:wrap' }, [
        el('button', { class: 'btn sm', type: 'button', text: 'Registar «não encontrado» no livro de provas',
          onclick: () => { close(); VN.console.openNegative(res.parsed.raw); } }),
        el('button', { class: 'btn sm', type: 'button', text: 'Ver sintaxe de pesquisa', onclick: () => VN.searchpage.openHelp() })
      ])
    ]));
  }

  function showRecent() {
    let recent = [];
    try { recent = JSON.parse(localStorage.getItem(K_RECENT) || '[]'); } catch (e) { recent = []; }
    clear(box);
    box.appendChild(el('div', { class: 'ssection' }, [
      el('span', { text: 'Pesquisa profunda' }),
      el('span', { class: 'muted', text: ' · ' + (CTX.model._searchIndex ? CTX.model._searchIndex.stats().documents : CTX.model.entities.length + CTX.model.relations.length) + ' registos indexados' })
    ]));
    box.appendChild(el('div', { class: 'syntax' }, [
      hint('tipo:pessoa · tipo:empresa · tipo:documento'),
      hint('estado:alegado · estado:confirmado · estado:não-verificado'),
      hint('ano:2016 ou ano:2016-2020'),
      hint('fonte:«certidão» · família:financeira · rel:accionista'),
      hint('"frase exacta" · -excluir · etiqueta:offshore')
    ]));
    if (recent.length) {
      box.appendChild(el('div', { class: 'ssection' }, [el('span', { text: 'Pesquisas recentes' })]));
      recent.forEach((q) => box.appendChild(el('div', {
        class: 'sresult', role: 'option', onclick: () => { input.value = q; run(q); }
      }, [el('span', { class: 'rel-icon', text: '↺' }), el('div', { class: 'smain' }, [el('span', { class: 'sname', text: q })])])));
    }
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  const hint = (t) => el('span', { class: 'chip mono', text: t });

  function paint() {
    Array.from(box.querySelectorAll('.sresult')).forEach((n) => {
      const on = Number(n.dataset.idx) === idx;
      n.setAttribute('aria-selected', String(on));
      if (on) n.scrollIntoView({ block: 'nearest' });
    });
  }

  function onKey(ev) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); idx = Math.min(items.length - 1, idx + 1); paint(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); idx = Math.max(0, idx - 1); paint(); }
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (items[idx]) activate(idx, ev.shiftKey, ev.altKey || ev.ctrlKey || ev.metaKey);
      else if (input.value.trim()) openPage(input.value);
    } else if (ev.key === 'Escape') { close(); input.blur(); }
    else if (ev.key === 'Tab') { close(); }
  }

  function remember(q) {
    try {
      const recent = JSON.parse(localStorage.getItem(K_RECENT) || '[]').filter((x) => x !== q);
      recent.unshift(q);
      localStorage.setItem(K_RECENT, JSON.stringify(recent.slice(0, 10)));
    } catch (e) {}
  }

  function activate(i, loadOnly, fullPage) {
    const r = items[i];
    if (!r) return;
    remember(input.value.trim());
    if (fullPage) { openPage(input.value); return; }
    if (r.kind === 'entity') {
      const e = r.entity;
      if (loadOnly) {
        CTX.store.ensureLoaded(e.id);
        CTX.app.refresh({ anchor: e.id });
        D.toast('«' + e.name + '» carregada no grafo');
      } else {
        close();
        input.value = e.name;
        CTX.app.focusEntity(e.id);
      }
    } else {
      const rel = r.relation;
      if (loadOnly) {
        CTX.store.ensureLoaded(rel.from); CTX.store.ensureLoaded(rel.to);
        CTX.app.refresh({ anchor: rel.from });
        D.toast('Extremos da ligação carregados no grafo');
      } else {
        close();
        CTX.app.selectRelation(rel.id);
      }
    }
  }

  function openPage(q) {
    close();
    VN.searchpage.open(q || input.value || '');
  }

  VN.palette = { init, open, close, run, openPage, lastResult: () => lastResult };
})(typeof window !== 'undefined' ? window : globalThis);
