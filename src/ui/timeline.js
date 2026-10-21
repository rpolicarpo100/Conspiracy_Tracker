/* VN · Cronologia sincronizada com o grafo.
   - Barras: relações com data de início no ano.
   - Marca inferior: documentos, acontecimentos e transacções.
   - Selecção de intervalo por arrasto; distingue datas exactas de estimativas.
   - Relações sem data NUNCA são projectadas: contadas à parte. */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const { el, clear, fmtDate, fmtRange } = VN.dom;
  let CTX = null, canvas = null, series = null, drag = null, hoverYear = null;

  function init(ctx) {
    CTX = ctx;
    host = document.getElementById('timeline');
    canvas = host && host.tagName === 'CANVAS' ? host : null;
    if (host && !canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'tlcanvas';
      host.appendChild(canvas);
    }
    const toggle = document.getElementById('timelineToggle');
    if (toggle) toggle.addEventListener('click', () => {
      const b = document.getElementById('bottom');
      b.classList.toggle('collapsed');
      const on = !b.classList.contains('collapsed');
      toggle.textContent = on ? '▾' : '▴';
      toggle.setAttribute('aria-expanded', String(on));
      if (on) draw();
    });
    const all = document.getElementById('tlAll');
    if (all) all.addEventListener('click', () => {
      const t = CTX.model.timeline;
      CTX.store.setFilter({ yearFrom: t.fullMin || t.min, yearTo: t.fullMax || t.max }, 'Período: todo o historial (' + (t.fullMin || t.min) + '–' + (t.fullMax || t.max) + ')');
      CTX.app.refresh();
    });
    const clr = document.getElementById('tlClear');
    if (clr) clr.addEventListener('click', () => { CTX.store.setFilter({ yearFrom: null, yearTo: null }, 'Sem filtro temporal'); CTX.app.refresh(); });
    const unk = document.getElementById('tlUnknown');
    if (unk) unk.addEventListener('change', () => { CTX.store.state.settings.includeUndated = unk.checked; draw(); CTX.app.refresh(); });

    if (canvas) {
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointerleave', () => { hoverYear = null; if (!drag) draw(); });
      canvas.addEventListener('dblclick', () => { CTX.store.setFilter({ yearFrom: null, yearTo: null }, 'Sem filtro temporal'); CTX.app.refresh(); });
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'slider');
      canvas.setAttribute('aria-label', 'Intervalo temporal. Use as setas para ajustar o início e o fim.');
      canvas.addEventListener('keydown', (e) => {
        const st = CTX.store.state.filters;
        let from = st.yearFrom != null ? st.yearFrom : series.min;
        let to = st.yearTo != null ? st.yearTo : series.max;
        if (e.key === 'ArrowLeft') { to = Math.max(from, to - 1); }
        else if (e.key === 'ArrowRight') { to = Math.min(series.max, to + 1); }
        else if (e.key === 'Home') { from = series.min; }
        else if (e.key === 'End') { to = series.max; }
        else return;
        e.preventDefault();
        CTX.store.setFilter({ yearFrom: from, yearTo: to }, 'Período ' + from + '–' + to);
        CTX.app.refresh();
      });
    }
    window.addEventListener('resize', () => draw());
  }

  function compute() {
    const { model, store } = CTX;
    series = VN.query.timelineSeries(model, { min: model.timeline.min, max: model.timeline.max });
    const extra = document.getElementById('timelineSummary');
    const st = store.state.filters;
    if (extra) {
      const undated = model.relations.filter((r) => !r.hasDates).length;
      const off = model.timeline.offRange || 0;
      if (off && (st.yearFrom == null && st.yearTo == null)) {
        extra.textContent = 'todas as datas · ' + undated + ' relações sem data (assinaladas) · ' + off + ' relação(ões) fora da régua (histórico antigo: veja «Todo o período»)';
        return series;
      }
      extra.textContent = (st.yearFrom != null || st.yearTo != null)
        ? 'período ' + (st.yearFrom != null ? st.yearFrom : series.min) + '–' + (st.yearTo != null ? st.yearTo : series.max
        )
        : 'todas as datas · ' + undated + ' relações sem data (assinaladas, não projectadas)';
    }
    return series;
  }

  let host = null;
  function geometry() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    const padL = 46, padR = 14, padT = 20, padB = 22;
    return { dpr, W, H, padL, padR, padT, padB, w: Math.max(10, W - padL - padR), h: Math.max(10, H - padT - padB) };
  }

  function draw() {
    if (!canvas || !CTX) return;
    if (!series) compute();
    const b = document.getElementById('bottom');
    if (b && b.classList.contains('collapsed')) return;
    const { dpr, W, H, padL, padR, padT, padB, w, h } = geometry();
    if (!w || !h) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim() || '#dbe4f0';
    const muted = css.getPropertyValue('--muted').trim() || '#7c8ca5';
    const line = css.getPropertyValue('--line').trim() || '#1e2b3f';
    const accent = css.getPropertyValue('--accent').trim() || '#22d3ee';
    const confirmed = css.getPropertyValue('--confirmed').trim() || '#34d399';
    const years = series.years;
    const n = years.length;
    const bw = w / n;
    const maxRel = Math.max(1, ...series.buckets.map((x) => x.relations));
    const st = CTX.store.state.filters;
    const from = st.yearFrom != null ? st.yearFrom : series.min;
    const to = st.yearTo != null ? st.yearTo : series.max;

    // fundo do período seleccionado
    const x0 = padL + (from - series.min) * bw;
    const x1 = padL + (Math.min(to, series.max) - series.min + 1) * bw;
    ctx.fillStyle = 'color-mix(in srgb, ' + accent + ' 12%, transparent)';
    ctx.fillStyle = 'rgba(34,211,238,.10)';
    ctx.fillRect(x0, padT - 4, Math.max(2, x1 - x0), h + 8);

    // grelha + eixo
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT + h); ctx.lineTo(padL + w, padT + h); ctx.stroke();
    ctx.fillStyle = muted; ctx.font = '9.5px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(String(maxRel), padL - 6, padT + 4);
    ctx.fillText('0', padL - 6, padT + h);

    // barras: relações (empilhadas: exactas + estimadas)
    series.buckets.forEach((bk, i) => {
      const bx = padL + i * bw + Math.max(1, bw * 0.14);
      const bwidth = Math.max(2, bw * 0.72);
      const total = bk.relations;
      const exact = bk.relationsExact;
      const est = total - exact;
      if (total) {
        const hEst = (est / maxRel) * h;
        const hEx = (exact / maxRel) * h;
        ctx.fillStyle = 'rgba(52,211,153,.35)';
        ctx.fillRect(bx, padT + h - hEst, bwidth, hEst);
        ctx.fillStyle = confirmed;
        ctx.fillRect(bx, padT + h - hEst - hEx, bwidth, hEx);
      }
      if (hoverYear === bk.year) {
        ctx.strokeStyle = accent; ctx.lineWidth = 1;
        ctx.strokeRect(bx - 1, padT - 2, bwidth + 2, h + 4);
      }
      // marcas inferiores
      const marks = bk.documents + bk.events + bk.transactions;
      if (marks) {
        ctx.fillStyle = 'rgba(148,163,184,.85)';
        for (let k = 0; k < Math.min(marks, 6); k++) {
          ctx.beginPath();
          ctx.arc(padL + i * bw + bw / 2 + (k - Math.min(marks, 6) / 2) * 3.4, padT + h + 8, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // etiquetas de ano (espaçadas)
      const every = n > 40 ? 10 : n > 24 ? 5 : n > 12 ? 2 : 1;
      if (i % every === 0 || i === n - 1) {
        ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(String(bk.year), padL + i * bw + bw / 2, padT + h + 12);
      }
    });

    // readout
    const ro = document.getElementById('tlReadout');
    if (ro) {
      const y = hoverYear != null ? hoverYear : null;
      const bk = y != null ? series.buckets[y - series.min] : null;
      ro.textContent = bk ? bk.year + ' · ' + bk.relations + ' relações (' + bk.relationsExact + ' com data exacta) · ' +
        bk.documents + ' doc · ' + bk.events + ' acont. · ' + bk.transactions + ' trans.' :
        (st.yearFrom != null || st.yearTo != null ? 'filtro activo: ' + from + '–' + to : 'arraste para seleccionar um intervalo');
    }
    // legenda
    const lg = document.querySelector('.tl-legend');
    if (!lg) {
      const d = el('div', { class: 'tl-legend' }, [
        el('span', {}, [el('span', { class: 'swatch', style: 'background:var(--confirmed)' }), 'relações com data exacta']),
        el('span', {}, [el('span', { class: 'swatch', style: 'background:rgba(52,211,153,.35)' }), 'mês/ano (estimada)']),
        el('span', {}, [el('span', { class: 'dot', style: 'background:#94a3b8' }), 'documentos e acontecimentos'])
      ]);
      host ? host.appendChild(d) : null;
    }
  }

  function yearAt(evt) {
    const rect = canvas.getBoundingClientRect();
    const { padL, w } = geometry();
    const rel = (evt.clientX - rect.left - padL) / w;
    const y = Math.round(series.min + rel * series.years.length - 0.5);
    return Math.max(series.min, Math.min(series.max, y));
  }

  function onDown(evt) {
    if (!series) compute();
    drag = { start: yearAt(evt), end: yearAt(evt) };
    canvas.setPointerCapture && canvas.setPointerCapture(evt.pointerId);
    draw();
  }
  function onMove(evt) {
    if (!series) return;
    const y = yearAt(evt);
    if (drag) {
      drag.end = y;
      // pré-visualização
      const a = Math.min(drag.start, drag.end), b = Math.max(drag.start, drag.end);
      const ro = document.getElementById('tlReadout');
      if (ro) ro.textContent = 'selecção: ' + a + '–' + b;
      draw();
    } else {
      hoverYear = y;
      draw();
    }
  }
  function onUp(evt) {
    if (!drag || !series) return;
    const a = Math.min(drag.start, yearAt(evt)), b = Math.max(drag.start, yearAt(evt));
    const single = a === b;
    drag = null;
    CTX.store.setFilter({ yearFrom: single ? a : a, yearTo: single ? a : b }, 'Período ' + a + '–' + b);
    VN.dom.toast('Período ' + a + '–' + b + ': só relações válidas neste intervalo' + (single ? '' : '') + '. Relações sem data ficam assinaladas.');
    CTX.app.refresh();
  }

  /* painel de detalhes: cronologia em lista */
  function renderPanel(body) {
    const { model, store } = CTX;
    clear(body);
    const st = store.state.filters;
    const yFrom = st.yearFrom, yTo = st.yearTo;
    const rels = model.relations.filter((r) => {
      if (yFrom == null && yTo == null) return true;
      if (!r.yStart) return true; // sem data: mostradas à parte
      return r.yStart >= (yFrom != null ? yFrom : -Infinity) && r.yStart <= (yTo != null ? yTo : Infinity);
    });
    const dated = rels.filter((r) => r.hasDates).sort((a, b) => (a.tStart || 0) - (b.tStart || 0));
    const undated = rels.filter((r) => !r.hasDates);

    body.appendChild(el('div', { class: 'warnbox', text: 'Datas exactas, estimativas (mês/ano) e datas desconhecidas são distinguidas. Relações sem data não são projectadas em períodos anteriores: apenas assinaladas.' }));

    body.appendChild(el('div', { class: 'srcmeta', style: 'margin:8px 0' }, [
      (yFrom != null || yTo != null ? 'Período ' + (yFrom != null ? yFrom : model.timeline.min) + '–' + (yTo != null ? yTo : model.timeline.max) : 'Todo o período'),
      ' · ' + dated.length + ' relações datadas · ' + undated.length + ' sem data'
    ]));

    // acontecimentos e documentos no período
    const points = model.entities.filter((e) => ['event', 'document', 'transaction'].includes(e.type) && e.year)
      .filter((e) => (yFrom == null && yTo == null) || (e.year >= (yFrom != null ? yFrom : -Infinity) && e.year <= (yTo != null ? yTo : Infinity)))
      .sort((a, b) => (a.year || 0) - (b.year || 0));

    if (points.length) {
      body.appendChild(el('div', { class: 'block' }, [
        el('h4', {}, ['Documentos e acontecimentos ', el('span', { class: 'n', text: '(' + points.length + ')' })]),
        ...points.map((e) => el('div', { class: 'relrow', onclick: () => e.type === 'document' ? VN.details.openSource(e.id) : CTX.app.focusEntity(e.id) }, [
          el('span', { class: 'dot', style: 'background:' + e.typeColor + ';margin-top:8px' }),
          el('div', { class: 'rtext' }, [
            el('div', { class: 'rlabel' }, [el('b', { text: e.name })]),
            el('div', { class: 'rmeta' }, [e.typeLabel, '·', fmtDate(e.date, e.precision)])
          ])
        ]))
      ]));
    }

    body.appendChild(el('div', { class: 'block' }, [
      el('h4', {}, ['Relações datadas ', el('span', { class: 'n', text: '(' + dated.length + ')' })]),
      ...dated.slice(0, 120).map((r) => el('div', { class: 'li' }, [
        el('span', { class: 'mk', style: 'color:var(--accent);font-variant-numeric:tabular-nums;min-width:38px', text: (r.yStart || '—') + '' }),
        el('div', { style: 'flex:1' }, [
          el('div', {}, [el('b', { style: 'color:var(--ink)', text: r.fromName }), ' ' + r.kindLabel + ' ',
            el('b', { style: 'color:var(--ink)', text: r.toName })]),
          el('div', { class: 'srcmeta' }, [
            el('span', { class: 'verifdot', style: 'background:' + r.statusColor + ';color:' + r.statusColor }),
            fmtRange(r), '·', r.startPrecisionLabel,
            el('button', { class: 'linkbtn', text: '· abrir', onclick: () => CTX.app.selectRelation(r.id) })
          ])
        ])
      ])),
      dated.length > 120 ? el('p', { class: 'side-note', text: 'A mostrar as primeiras 120. Exporte o relatório para a lista completa.' }) : null
    ]));

    body.appendChild(el('div', { class: 'block' }, [
      el('h4', {}, ['Relações sem data (não projectadas) ', el('span', { class: 'n', text: '(' + undated.length + ')' })]),
      ...undated.slice(0, 40).map((r) => el('div', { class: 'li' }, [
        el('span', { class: 'mk', style: 'color:var(--muted)', text: '?' }),
        el('div', { style: 'flex:1' }, [
          el('div', {}, [el('b', { style: 'color:var(--ink)', text: r.fromName }), ' ' + r.kindLabel + ' ',
            el('b', { style: 'color:var(--ink)', text: r.toName })]),
          el('div', { class: 'srcmeta' }, [r.statusLabel, '· data desconhecida — limitação explícita',
            el('button', { class: 'linkbtn', text: '· abrir', onclick: () => CTX.app.selectRelation(r.id) })])
        ])
      ]))
    ]));
  }

  VN.timeline = { init, draw, compute, renderPanel, get series() { return series; } };
})(typeof window !== 'undefined' ? window : globalThis);
