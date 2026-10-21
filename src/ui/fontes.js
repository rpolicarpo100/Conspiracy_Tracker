/* =====================================================================
   VN · REGISTO DE FONTES (interface)

   Mostra o que existe de facto no servidor: fontes com estado, verificações
   datadas, classificações com justificação e decisões auditadas. Não há
   números de demonstração: se não houver fontes, aparece uma tabela vazia e
   o botão de descoberta.

   Regras visíveis na interface (não só na documentação):
   · uma fonte sem verificação não tem nota — mostra «provisória»;
   · aprovar exige classificação não provisória e motivo escrito;
   · a descoberta diz quantas fontes criou, quantas eram duplicadas e qual
     foi a consulta exacta usada.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});

  const S = {
    sources: null, stats: null, meta: null, coverage: null, runs: null,
    selected: null, detail: null, busy: '', msg: null, filter: { state: '', category: '', jurisdiction: '', q: '' }
  };

  let ctxDeps = null;      /* {el, clear, toast, api} injectado pela consola */

  async function load() {
    const { api } = ctxDeps;
    if (!S.meta) { const m = await api('/api/sources/meta'); if (m.ok) S.meta = m.json; }
    const q = [];
    if (S.filter.state) q.push('state=' + encodeURIComponent(S.filter.state));
    if (S.filter.category) q.push('category=' + encodeURIComponent(S.filter.category));
    if (S.filter.jurisdiction) q.push('jurisdiction=' + encodeURIComponent(S.filter.jurisdiction));
    if (S.filter.q) q.push('q=' + encodeURIComponent(S.filter.q));
    const [list, cov, runs] = await Promise.all([
      api('/api/sources' + (q.length ? '?' + q.join('&') : '')),
      api('/api/coverage'),
      api('/api/discovery/runs')
    ]);
    if (list.ok) { S.sources = list.json.items; S.stats = list.json.stats; }
    else S.msg = { text: 'Não foi possível ler o registo: ' + (list.error && list.error.message || list.status), cls: 'warn' };
    if (cov.ok) S.coverage = cov.json;
    if (runs.ok) S.runs = runs.json.runs;
  }

  /* a API devolve o motivo em `error`, às vezes como objecto: sem isto a
     interface mostrava «[object Object]» em vez da razão real da recusa. */
  const reasonOf = (r) => {
    const e = r && (r.json && r.json.error);
    if (!e) return 'HTTP ' + (r && r.status);
    if (typeof e === 'string') return e;
    return e.message || e.code || JSON.stringify(e);
  };

  const bandChip = (r) => {
    if (!r) return '—';
    if (r.provisional) return 'provisória';
    return (r.band || '?') + ' · ' + r.score;
  };

  function mount(deps) {
    ctxDeps = deps;
    const { el, clear, toast, api } = deps;
    const wrap = el('div', {});

    function paint() {
      clear(wrap);
      if (S.msg) wrap.appendChild(el('div', { class: 'warnbox', text: S.msg.text }));
      wrap.appendChild(el('div', { class: 'infobox', html:
        '<b>Descobrir não é validar.</b> Uma fonte entra como <i>descoberta</i> e só chega a <i>aprovada</i> ' +
        'depois de verificação técnica, classificação com evidência e uma decisão com motivo escrito. ' +
        'Uma falha de hoje não apaga a verificação de ontem: o histórico fica.' }));

      /* ---- painel ---- */
      if (S.stats) {
        const st = S.stats;
        wrap.appendChild(el('div', { class: 'statline', style: 'margin:8px 0' }, [
          ['Fontes', st.total], ['Descobertas', st.DISCOVERED || 0], ['Verificadas', (st.TECHNICAL_TESTING || 0) + (st.CONTENT_AUDIT || 0)],
          ['Aprovadas', (st.APPROVED || 0) + (st.ACTIVE || 0)], ['Restritas', st.RESTRICTED || 0],
          ['Indisponíveis', (st.TEMPORARILY_UNAVAILABLE || 0) + (st.DEGRADED || 0)], ['Rejeitadas', st.REJECTED || 0]
        ].map(([k, v]) => el('span', {}, [el('b', { text: String(v) }), el('span', { class: 'muted', text: ' ' + k })]))));
      }

      /* ---- acções ---- */
      const actions = el('div', { class: 'chips', style: 'margin:6px 0' }, [
        el('button', { class: 'btn sm primary', type: 'button', id: 'btnDiscover', text: S.busy === 'discover' ? 'A descobrir…' : 'Descobrir fontes (CourtListener)',
          onclick: () => runDiscovery(false) }),
        el('button', { class: 'btn sm', type: 'button', id: 'btnDiscoverDry', text: 'Simular (não grava)', onclick: () => runDiscovery(true) }),
        el('button', { class: 'btn sm', type: 'button', id: 'btnAddSource', text: 'Registar fonte', onclick: () => addSource() }),
        el('button', { class: 'btn sm', type: 'button', text: 'Actualizar', onclick: () => refresh() })
      ]);
      wrap.appendChild(actions);

      /* ---- filtros ---- */
      const filt = el('div', { class: 'chips', style: 'margin:6px 0' }, [
        selectEl('estado', [['', 'Todos os estados']].concat((S.meta ? S.meta.states : []).map((s) => [s.id, s.label])), S.filter.state, (v) => { S.filter.state = v; refresh(); }),
        selectEl('categoria', [['', 'Todas as categorias']].concat((S.meta ? S.meta.categories : []).map((c) => [c.id, c.label])), S.filter.category, (v) => { S.filter.category = v; refresh(); }),
        selectEl('jurisdição', [['', 'Todas as jurisdições']].concat(((S.coverage && S.coverage.countries) || []).map((c) => [c.key, c.key])), S.filter.jurisdiction, (v) => { S.filter.jurisdiction = v; refresh(); })
      ]);
      wrap.appendChild(filt);

      /* ---- catálogo ---- */
      wrap.appendChild(el('h3', { style: 'font-size:12px;margin:12px 0 4px', text: 'Catálogo (' + (S.sources ? S.sources.length : 0) + ')' }));
      if (!S.sources) {
        wrap.appendChild(el('div', { class: 'empty', text: 'A carregar…' }));
      } else if (!S.sources.length) {
        wrap.appendChild(el('div', { class: 'empty', text: 'Sem fontes registadas. Comece por «Descobrir fontes» ou registe uma manualmente.' }));
      } else {
        wrap.appendChild(el('table', { class: 'listtable' }, [
          el('thead', {}, [el('tr', {}, ['Fonte', 'Domínio', 'Categoria', 'Jurisdição', 'Estado', 'Última verificação', 'Nota', ''].map((h) => el('th', { text: h })))]),
          el('tbody', {}, S.sources.map((s) => el('tr', {}, [
            el('td', { title: s.url, text: s.name }),
            el('td', { class: 'mono', text: s.domain || '—' }),
            el('td', { text: (S.meta ? ((S.meta.categories.find((c) => c.id === s.category) || {}).label) : null) || s.category }),
            el('td', { text: s.jurisdiction || '—' }),
            el('td', {}, [el('span', { class: 'tag ' + stateClass(s.state), text: s.stateLabel })]),
            el('td', { class: 'mono', text: s.lastCheckAt ? s.lastCheckAt.slice(0, 16).replace('T', ' ') + (s.lastCheckStatus ? ' · ' + s.lastCheckStatus : '') : 'nunca' }),
            el('td', { text: bandChip(s.rating) }),
            el('td', {}, [
              el('button', { class: 'btn sm', type: 'button', text: 'Abrir', onclick: () => openDetail(s.id) })
            ])
          ])))
        ]));
      }

      /* ---- cobertura ---- */
      if (S.coverage) {
        const c = S.coverage;
        wrap.appendChild(el('h3', { style: 'font-size:12px;margin:14px 0 4px', text: 'Cobertura' }));
        wrap.appendChild(el('div', { class: 'infobox', html:
          '<b>' + c.totals.sources + '</b> fonte(s) registada(s) · <b>' + c.totals.countriesWithSources + '</b> país(es) com alguma fonte · ' +
          '<b>' + c.totals.countriesWithApproved + '</b> com fonte aprovada, num catálogo de ' + c.totals.countriesCatalogued + ' jurisdições. ' +
          '<br><span class="muted">' + c.note + '</span>' }));
        if (c.gaps.categories.length) {
          wrap.appendChild(el('div', { style: 'font-size:11px;color:var(--muted);margin-top:4px',
            text: c.gaps.categories.length + ' categorias sem qualquer fonte: ' + c.gaps.categories.slice(0, 12).join(', ') + (c.gaps.categories.length > 12 ? '…' : '') }));
        }
        if (c.gaps.countries.length) {
          wrap.appendChild(el('div', { style: 'font-size:11px;color:var(--muted);margin-top:2px',
            text: c.gaps.countries.length + ' jurisdições sem fonte aprovada: ' + c.gaps.countries.slice(0, 18).join(', ') + (c.gaps.countries.length > 18 ? '…' : '') }));
        }
      }

      /* ---- execuções ---- */
      if (S.runs) {
        wrap.appendChild(el('h3', { style: 'font-size:12px;margin:14px 0 4px', text: 'Histórico de descobertas' }));
        if (!S.runs.length) wrap.appendChild(el('div', { class: 'empty', text: 'Nenhuma execução registada.' }));
        else {
          wrap.appendChild(el('table', { class: 'listtable' }, [
            el('thead', {}, [el('tr', {}, ['Início', 'Adaptador', 'Resultado', 'Encontrados', 'Novos', 'Duplicados', 'Duração', 'Consulta'].map((h) => el('th', { text: h })))]),
            el('tbody', {}, S.runs.map((r) => el('tr', {}, [
              el('td', { class: 'mono', text: String(r.startedAt || '').slice(0, 16).replace('T', ' ') }),
              el('td', { text: r.adapter }),
              el('td', {}, [el('span', { class: 'tag ' + (r.status === 'completed' ? 'ok' : 'warn'), text: r.status })]),
              el('td', { text: r.found == null ? '—' : String(r.found) }),
              el('td', { text: r.created == null ? '—' : String(r.created) }),
              el('td', { text: r.duplicates == null ? '—' : String(r.duplicates) }),
              el('td', { text: r.durationMs == null ? '—' : r.durationMs + ' ms' }),
              el('td', { class: 'mono', style: 'font-size:10px', title: r.query || '', text: (r.query || r.error || '').slice(0, 70) })
            ])))
          ]));
        }
      }

      /* ---- detalhe ---- */
      if (S.selected && S.detail) wrap.appendChild(detailBox());
    }

    function selectEl(label, options, value, onChange) {
      const sel = el('select', { class: 'input', style: 'min-width:150px;font-size:11px', onchange: (e) => onChange(e.target.value) },
        options.map(([v, l]) => el('option', { value: v, text: l, selected: v === value ? 'selected' : null })));
      return el('label', { style: 'display:flex;gap:4px;align-items:center;font-size:10px;color:var(--muted)' }, [el('span', { text: label }), sel]);
    }

    const stateClass = (st) => (st === 'APPROVED' || st === 'ACTIVE') ? 'ok'
      : st === 'REJECTED' ? 'bad'
        : st === 'RESTRICTED' || st === 'TEMPORARILY_UNAVAILABLE' || st === 'DEGRADED' ? 'warn' : 'muted';

    async function refresh() { await load(); paint(); }

    async function runDiscovery(dry) {
      S.busy = 'discover'; paint();
      const r = await api('/api/discovery/run', { method: 'POST', body: { adapter: 'courtlistener_courts', pageSize: 40, dryRun: dry } });
      S.busy = '';
      if (!r.ok) {
        S.msg = { text: 'Descoberta falhou: ' + reasonOf(r) + ' — nenhuma fonte foi marcada como descoberta.', cls: 'warn' };
      } else {
        const j = r.json;
        S.msg = { text: (dry ? 'Simulação: ' : '') + j.candidates + ' candidato(s) · ' + j.created + ' nova(s) · ' + j.duplicates + ' duplicada(s) · ' + j.durationMs + ' ms · consulta: ' + j.query, cls: 'info' };
      }
      await refresh();
      if (r.ok) toast('Descoberta concluída', 'ok');
    }

    async function addSource() {
      const url = prompt('URL da fonte (http/https):');
      if (!url) return;
      const name = prompt('Nome da fonte:', url) || url;
      const cat = prompt('Categoria (ex.: tribunais, contratos_publicos, sancoes):', 'tribunais') || 'tribunais';
      const juris = prompt('Jurisdição (ISO-2, ex.: PT):', 'PT') || '';
      const r = await api('/api/sources', { method: 'POST', body: { url, name, category: cat, jurisdiction: juris } });
      if (!r.ok) S.msg = { text: 'Não registada: ' + reasonOf(r) + (r.json && r.json.nota ? ' — ' + r.json.nota : ''), cls: 'warn' };
      else S.msg = { text: 'Fonte registada como «descoberta». Falta verificar e classificar.', cls: 'info' };
      await refresh();
    }

    async function openDetail(id) {
      const r = await api('/api/sources/' + id);
      if (!r.ok) { S.msg = { text: 'Não foi possível abrir a fonte.', cls: 'warn' }; paint(); return; }
      S.selected = id; S.detail = r.json; paint();
    }

    function detailBox() {
      const d = S.detail, s = d.source;
      const box = el('div', { class: 'card', style: 'margin-top:14px;padding:10px;border:1px solid var(--line);border-radius:6px' });
      box.appendChild(el('div', { class: 'statline' }, [
        el('b', { text: s.name }),
        el('span', { class: 'tag ' + stateClass(s.state), style: 'margin-left:8px', text: (S.meta ? ((S.meta.states.find((x) => x.id === s.state) || {}).label) : null) || s.state }),
        el('button', { class: 'btn sm', style: 'margin-left:auto', type: 'button', text: 'Fechar', onclick: () => { S.selected = null; S.detail = null; paint(); } })
      ]));
      box.appendChild(el('div', { style: 'font-size:11px;margin:4px 0' }, [
        el('div', { class: 'mono', text: s.canonicalUrl || s.url }),
        el('div', { class: 'muted', text: 'descoberta por ' + ((s.discoveredVia && s.discoveredVia.adapter) || '—') +
          (s.discoveredVia && s.discoveredVia.query ? ' · consulta: ' + s.discoveredVia.query : '') +
          ' · registo ' + String(s.createdAt || '').slice(0, 16).replace('T', ' ') })
      ]));

      box.appendChild(el('div', { class: 'chips', style: 'margin:8px 0' }, [
        el('button', { class: 'btn sm primary', type: 'button', id: 'btnCheckSource', text: 'Verificar acesso', onclick: async () => {
          const r = await api('/api/sources/' + s.id + '/check', { method: 'POST', body: {} });
          if (!r.ok) S.msg = { text: 'Verificação falhou: ' + reasonOf(r), cls: 'warn' };
          else S.msg = { text: 'Verificação: HTTP ' + (r.json.check.httpStatus || '—') + ' · ' + r.json.check.ms + ' ms · ' + r.json.interpretation, cls: 'info' };
          await refresh(); if (S.selected) await openDetail(s.id);
        } }),
        el('button', { class: 'btn sm', type: 'button', id: 'btnRateSource', text: 'Classificar', onclick: async () => {
          const institution = prompt('Instituição responsável (deixe vazio se não souber):', s.institution || '') || '';
          const sampleN = prompt('Quantos registos verificou contra o original? (0 = nenhum)', '0');
          const sampleErr = prompt('Quantos desses tinham erro?', '0');
          const meta = { institution: institution || null };
          const n = Number(sampleN) || 0;
          if (n > 0) meta.sample = { checked: n, errors: Number(sampleErr) || 0 };
          meta.authors = confirm('A fonte identifica os autores ou responsáveis?');
          meta.methodology = confirm('Publica metodologia?');
          meta.corrections = confirm('Tem política de correcções?');
          meta.dates = confirm('Mostra datas de publicação?');
          const r = await api('/api/sources/' + s.id + '/rate', { method: 'POST', body: { meta } });
          if (!r.ok) S.msg = { text: 'Classificação falhou: ' + reasonOf(r), cls: 'warn' };
          else S.msg = { text: r.json.rating.provisional
            ? 'Classificação PROVISÓRIA (evidência insuficiente): ' + (r.json.rating.missing || []).join('; ')
            : 'Classificação ' + r.json.rating.band + ' · ' + r.json.rating.score + '/100' + (r.json.rating.cappedBy ? ' · limite: ' + r.json.rating.cappedBy : ''), cls: 'info' };
          await refresh(); if (S.selected) await openDetail(s.id);
        } }),
        el('button', { class: 'btn sm', type: 'button', id: 'btnApproveSource', text: 'Aprovar', onclick: () => decide(s.id, 'approve') }),
        el('button', { class: 'btn sm', type: 'button', text: 'Rejeitar', onclick: () => decide(s.id, 'reject') }),
        el('button', { class: 'btn sm', type: 'button', text: 'Pedir revisão', onclick: () => decide(s.id, 'review') })
      ]));

      const r = d.rating;
      if (r) {
        box.appendChild(el('h4', { style: 'font-size:11px;margin:8px 0 2px', text: r.provisional ? 'Classificação provisória — evidência insuficiente' : 'Classificação ' + r.band + ' · ' + r.score + '/100' }));
        if (r.cappedBy) box.appendChild(el('div', { class: 'warnbox', style: 'font-size:11px', text: 'Limite aplicado: ' + r.cappedBy }));
        box.appendChild(el('table', { class: 'listtable' }, [
          el('thead', {}, [el('tr', {}, ['Dimensão', 'Nota', 'Justificação', 'O que falta'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, Object.entries(r.dims || {}).map(([k, v]) => el('tr', {}, [
            el('td', { text: (S.meta && S.meta.dimensions[k]) || k }),
            el('td', { class: 'mono', text: v.score == null ? '—' : String(v.score) }),
            el('td', { style: 'font-size:10.5px', text: v.justification || '' }),
            el('td', { style: 'font-size:10.5px;color:var(--muted)', text: (v.missing || []).join('; ') || '—' })
          ])))
        ]));
      } else {
        box.appendChild(el('div', { class: 'empty', text: 'Sem classificação registada: esta fonte ainda não tem nota (e não deve ter).' }));
      }

      if (d.checks && d.checks.length) {
        box.appendChild(el('h4', { style: 'font-size:11px;margin:10px 0 2px', text: 'Verificações (' + d.checks.length + ')' }));
        box.appendChild(el('table', { class: 'listtable' }, [
          el('thead', {}, [el('tr', {}, ['Data', 'HTTP', 'ms', 'Tipo', 'TLS', 'Estado observado', 'Interpretação'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, d.checks.slice(-8).reverse().map((c) => el('tr', {}, [
            el('td', { class: 'mono', text: String(c.at).slice(0, 16).replace('T', ' ') }),
            el('td', { class: 'mono', text: c.httpStatus == null ? '—' : String(c.httpStatus) }),
            el('td', { text: c.ms == null ? '—' : String(c.ms) }),
            el('td', { style: 'font-size:10px', text: (c.contentType || '—').slice(0, 40) }),
            el('td', { text: c.tls ? 'sim' : 'não' }),
            el('td', { text: c.observed || '—' }),
            el('td', { style: 'font-size:10.5px', text: c.why || '' })
          ])))
        ]));
      }

      if (d.decisions && d.decisions.length) {
        box.appendChild(el('h4', { style: 'font-size:11px;margin:10px 0 2px', text: 'Decisões' }));
        box.appendChild(el('ul', { style: 'font-size:11px' }, d.decisions.map((x) => el('li', {
          text: String(x.at).slice(0, 16).replace('T', ' ') + ' · ' + x.decision + ' → ' + x.state + ' · ' + x.reason
        }))));
      }
      return box;
    }

    async function decide(id, decision) {
      const reason = prompt('Motivo da decisão (obrigatório, mínimo 10 caracteres):');
      if (!reason) return;
      const r = await api('/api/sources/' + id + '/decision', { method: 'POST', body: { decision, reason } });
      if (!r.ok) S.msg = { text: 'Decisão recusada: ' + reasonOf(r), cls: 'warn' };
      else S.msg = { text: 'Decisão registada: ' + r.json.source.state + ' · motivo guardado na auditoria.', cls: 'info' };
      await refresh(); if (S.selected) await openDetail(id);
    }

    load().then(paint).catch((e) => { paint(); wrap.appendChild(el('div', { class: 'warnbox', text: 'Falha ao ler o registo: ' + e.message })); });
    return wrap;
  }

  VN.fontesUI = { mount, getState: () => S };
})(typeof window !== 'undefined' ? window : globalThis);
