/* =====================================================================
   VN · FORNECEDORES DE IA (interface do Provider OS — fases 2–4)

   Mostra o que o servidor sabe de facto: catálogo com evidência datada,
   ranking por tarefa, a decisão do selector com justificação e alternativa,
   e o plano de fallback calculado (sem gastar nada).

   Regras visíveis na própria interface:
   · sem teste de geração não há nota — aparece «provisória» e o que falta;
   · testar níveis 4–6 gasta a chave do utilizador: pede confirmação explícita;
   · quando não há prova suficiente, o selector NÃO escolhe: diz porquê;
   · testes sintéticos não contam para a nota (o servidor já os ignora).
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});

  const S = {
    meta: null, entries: null, ranking: null, decisions: null,
    decision: null, plan: null, schedule: null, health: null,
    disc: null, discResult: null, filterCat: '', bench: null, suite: null,
    task: 'conversa', busy: '', msg: null, open: null
  };

  let ctxDeps = null;
  const reasonOf = (r) => {
    const e = r && r.json && r.json.error;
    if (!e) return 'HTTP ' + (r && r.status);
    return typeof e === 'string' ? e : (e.message || JSON.stringify(e));
  };

  function mount(deps) {
    ctxDeps = deps;
    const { el, clear, toast, api } = deps;
    const wrap = el('div', { id: 'provedoresroot' });

    async function load() {
      const [meta, cat, rank, dec, sch, hea, disc, bench, suite] = await Promise.all([
        api('/api/provider-os/meta'),
        api('/api/provider-os/catalog' + (S.filterCat ? '?category=' + S.filterCat : '')),
        api('/api/provider-os/ranking?task=' + encodeURIComponent(S.task)),
        api('/api/provider-os/decisions'),
        api('/api/provider-os/schedule'),
        api('/api/provider-os/health'),
        api('/api/provider-os/discovery/categories'),
        api('/api/provider-os/benchmarks'),
        api('/api/provider-os/benchmark/suite')
      ]);
      if (meta.ok) S.meta = meta.json;
      if (cat.ok) S.entries = cat.json.entries;
      if (rank.ok) S.ranking = rank.json;
      if (dec.ok) S.decisions = dec.json;
      if (sch.ok) S.schedule = sch.json;
      if (hea.ok) S.health = hea.json;
      if (disc.ok) S.disc = disc.json;
      if (bench.ok) S.bench = bench.json;
      if (suite.ok) S.suite = suite.json;
    }

    function chip(res) {
      const cls = res === 'PASS' ? 'ok' : res === 'FAIL' ? 'bad' : res === 'BLOCKED' ? 'warn' : 'muted';
      return el('span', { class: 'scorepill ' + cls, text: res || '—' });
    }

    function paint() {
      clear(wrap);
      if (S.msg) wrap.appendChild(el('div', { class: 'warnbox', text: S.msg.text, id: 'providerStatus' }));
      wrap.appendChild(el('div', { class: 'infobox', html:
        '<b>Uma nota só existe com medição.</b> O catálogo guarda a evidência de cada afirmação (URL, data, método). ' +
        'Sem um teste de geração com <i>PASS</i>, a linha aparece como <i>provisória</i> e diz o que falta — ' +
        'e o selector recusa escolher em vez de adivinhar.' }));

      if (S.entries) {
        const comGeracao = S.entries.filter((e) => (e.tests || []).some((t) => t.level === 4 && t.result === 'PASS')).length;
        const testadas = S.entries.filter((e) => (e.tests || []).length > 0).length;
        wrap.appendChild(el('div', { class: 'statline', style: 'margin:8px 0', id: 'providerStats' }, [
          ['Entradas', S.entries.length], ['Com teste', testadas], ['Com geração', comGeracao],
          ['Com nota', S.ranking ? S.ranking.computed : 0], ['Decisões', S.decisions ? S.decisions.total : 0]
        ].map(([k, v]) => el('span', {}, [el('b', { text: String(v) }), el('span', { class: 'muted', text: ' ' + k })]))));
      }

      /* ---- acções ---- */
      const acoes = el('div', { class: 'actions', style: 'margin:6px 0' });
      acoes.appendChild(el('button', { class: 'btn sm', type: 'button', id: 'btnSeedProviders', text: 'Carregar semente', onclick: async () => {
        const r = await api('/api/provider-os/seed', { method: 'POST', body: {} });
        S.msg = r.ok ? { text: 'Semente: ' + r.json.created + ' criadas, ' + r.json.updated + ' actualizadas.' + (r.json.invalid.length ? ' Recusadas: ' + r.json.invalid.length : '') }
          : { text: 'Semente falhou: ' + reasonOf(r) };
        await load(); paint();
      } }));
      /* /api/provider-os/meta devolve `taskTypes` como LISTA de {id,label}:
         iterar com Object.keys produzia as opções «0», «1»… (bug visível na
         captura de ecrã — a lista de tarefas aparecia como «0») */
      const tipos = (S.meta && Array.isArray(S.meta.taskTypes)) ? S.meta.taskTypes
        : (S.meta && S.meta.taskTypes ? Object.keys(S.meta.taskTypes).map((id) => ({ id, label: id })) : [{ id: 'conversa', label: 'conversa' }]);
      const sel = el('select', { id: 'providersTask', class: 'btn sm', style: 'margin:0 4px' },
        tipos.map((t) => el('option', { value: t.id, text: t.id + ' — ' + t.label, selected: t.id === S.task })));
      sel.value = S.task;
      sel.addEventListener('change', async (ev) => { S.task = ev.target.value; S.decision = null; S.plan = null; await load(); paint(); });
      acoes.appendChild(sel);
      acoes.appendChild(el('button', { class: 'btn primary sm', type: 'button', id: 'btnSelectProvider', text: 'Escolher fornecedor', onclick: async () => {
        S.msg = null;
        const r = await api('/api/provider-os/select', { method: 'POST', body: { task: S.task } });
        if (r.ok) {
          S.decision = r.json;
          S.msg = { text: r.json.chosen
            ? 'Escolhido ' + r.json.chosen.key + ' · nota ' + r.json.chosen.score + '/' + r.json.chosen.band + ' · confiança ' + r.json.confidence
            : 'Não foi escolhido nenhum fornecedor: ' + r.json.noChoiceReason };
        } else S.msg = { text: 'Selecção recusada: ' + reasonOf(r) };
        /* A decisão aparece já: recarregar o catálogo são duas idas ao servidor
           e, até elas terminarem, o ecrã mostrava o estado anterior — quem
           lê não deve ficar à espera para saber que o selector recusou. */
        paint();
        await load(); paint();
      } }));
      acoes.appendChild(el('button', { class: 'btn sm', type: 'button', id: 'btnFallbackPlan', text: 'Plano de fallback', onclick: async () => {
        const r = await api('/api/provider-os/fallback/plan', { method: 'POST', body: { task: S.task, seed: 42 } });
        if (r.ok) {
          S.plan = r.json;
          S.msg = { text: r.json.plan.length
            ? 'Plano calculado: ' + r.json.plan.length + ' tentativa(s) — nenhum pedido foi feito, nada foi gasto.'
            : 'Sem plano: ' + (r.json.reason || 'nenhuma candidata com prova suficiente') };
        } else S.msg = { text: 'Plano recusado: ' + reasonOf(r) };
        paint();
      } }));
      if (S.entries && S.entries.length) acoes.appendChild(el('button', { class: 'btn sm', type: 'button', id: 'btnTestFree', text: 'Testar documentação e acesso (níveis 1–2, sem chave)', onclick: async () => {
        S.busy = 'test'; paint();
        let feitos = 0, pass = 0;
        for (const e of S.entries.filter((x) => x.kind !== 'tool')) {
          const r = await api('/api/provider-os/test', { method: 'POST', body: { key: e.key, levels: [1, 2] } });
          if (r.ok) { feitos++; if (r.json.results[1] && r.json.results[1].result === 'PASS') pass++; }
        }
        S.busy = '';
        S.msg = { text: 'Testados ' + feitos + ' fornecedores (só níveis 1–2, sem custo): ' + pass + ' com documentação a responder. Nenhuma chave foi usada.' };
        await load(); paint();
      } }));
      acoes.appendChild(el('button', { class: 'btn sm', type: 'button', id: 'btnReevalRun', text: 'Reavaliar agora (níveis 1–2)', onclick: async () => {
        const r = await api('/api/provider-os/schedule/run', { method: 'POST', body: { limit: 4 } });
        if (!r.ok) { S.msg = { text: 'Reavaliação recusada: ' + reasonOf(r) }; paint(); return; }
        S.msg = { text: r.json.executed
          ? 'Reavaliados ' + r.json.executed + ' fornecedor(es) com níveis 1–2 (sem chave, sem custo)' +
            (r.json.skipped ? ' · ' + r.json.skipped + ' fora do orçamento do lote' : '')
          : 'Nada em atraso: ' + (r.json.note || 'nenhuma reavaliação devida') };
        await load(); paint();
      } }));
      acoes.appendChild(el('button', { class: 'btn sm', type: 'button', id: 'btnHealthCheck', text: 'Sonda de saúde (sem chave)', onclick: async () => {
        const r = await api('/api/provider-os/health/check', { method: 'POST', body: {} });
        if (!r.ok) { S.msg = { text: 'Sonda recusada: ' + reasonOf(r) }; paint(); return; }
        const responderam = (r.json.probes || []).filter((x) => x.status === 'respondeu').length;
        S.msg = { text: 'Sonda: ' + responderam + ' de ' + r.json.checked + ' responderam · ' + r.json.invariants.novosTestes +
          ' testes criados · estados alterados: ' + (r.json.invariants.estadosAlterados ? 'SIM' : 'não') };
        await load(); paint();
      } }));
      wrap.appendChild(acoes);

      /* ---- descoberta contínua (fase 6) ---- */
      if (S.disc) {
        const box = el('div', { style: 'margin:10px 0;padding:8px;border:1px solid var(--line)', id: 'discoveryBox' });
        box.appendChild(el('h4', { style: 'font-size:12px;margin:0 0 4px', text:
          'Descoberta contínua — ' + S.disc.totals.entries + ' entradas em 5 categorias' }));
        const chips = el('div', { class: 'chips', style: 'margin-bottom:6px' });
        const todas = el('button', { class: 'btn sm' + (S.filterCat === '' ? ' primary' : ''), type: 'button', text: 'Todas (' + S.disc.totals.entries + ')',
          onclick: async () => { S.filterCat = ''; await load(); paint(); } });
        chips.appendChild(todas);
        (S.disc.categories || []).forEach((c) => {
          chips.appendChild(el('button', {
            class: 'btn sm' + (S.filterCat === c.id ? ' primary' : ''),
            type: 'button', title: c.label,
            text: c.id + ' · ' + c.total,
            onclick: async () => { S.filterCat = S.filterCat === c.id ? '' : c.id; await load(); paint(); }
          }));
        });
        box.appendChild(chips);
        box.appendChild(el('div', { style: 'font-size:10.5px;color:var(--muted)', text:
          (S.disc.categories || []).map((c) => c.id + ' — ' + c.label).join(' · ') }));
        if (S.filterCat) {
          const c = (S.disc.categories || []).find((x) => x.id === S.filterCat);
          box.appendChild(el('div', { style: 'font-size:11px;margin-top:4px', text:
            'Filtro activo: ' + S.filterCat + ' — ' + (c ? c.label : '') + ' (' + (c ? c.total : 0) + ' entradas, ' + (c ? c.measured : 0) + ' com ≥2 campos medidos)' }));
        }

        /* adaptadores reais, todos sem chave */
        const adap = el('div', { class: 'actions', style: 'margin:6px 0' });
        (S.disc.adapters || []).forEach((ad) => {
          adap.appendChild(el('button', { class: 'btn sm', type: 'button', id: 'btnDisc_' + ad.key,
            title: ad.url + ' (alimenta ' + ad.feeds.join('/') + ')',
            text: 'Descobrir: ' + ad.label.split('(')[0].trim(), onclick: async () => {
              S.msg = { text: 'A consultar ' + ad.url + '…' };
              paint();
              const r = await api('/api/provider-os/discover', { method: 'POST', body: { adapter: ad.key, limit: 60 } });
              if (!r.ok) { S.msg = { text: 'Descoberta recusada (' + ad.key + '): ' + reasonOf(r) }; paint(); return; }
              S.discResult = Object.assign({ adapter: ad.key }, r.json);
              S.msg = { text: 'Descoberta ' + ad.key + ': ' + r.json.created + ' criadas, ' + r.json.updated + ' actualizadas, ' +
                r.json.rejected + ' recusadas, ' + r.json.truncated + ' fora do lote · categorias ' +
                Object.entries(r.json.categories || {}).map(([k, v]) => k + '=' + v).join(' ') };
              await load(); paint();
            } }));
        });
        box.appendChild(adap);
        (S.disc.adapters || []).forEach((ad) => {
          if (!ad.lastRun) return;
          box.appendChild(el('div', { style: 'font-size:10.5px;color:var(--muted)', text:
            ad.key + ': última execução ' + String(ad.lastRun.at || '').slice(0, 16).replace('T', ' ') + ' · ' +
            (ad.lastRun.created || 0) + ' criadas · ' + (ad.lastRun.ms || 0) + ' ms' }));
        });

        /* cobertura dos 9 campos: o mapa do que falta é parte do resultado */
        const campos = S.disc.fields || {};
        box.appendChild(el('table', { class: 'listtable', id: 'accessFields', style: 'margin-top:6px' }, [
          el('thead', {}, [el('tr', {}, ['Campo de acesso', 'Medido', 'Declarado', 'Desconhecido'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, Object.entries(campos).map(([k, v]) => el('tr', {}, [
            el('td', {}, [el('b', { text: k }), el('div', { class: 'muted', style: 'font-size:10px', text: v.label })]),
            el('td', { class: 'mono', text: String(v.measured) }),
            el('td', { class: 'mono', text: String(v.declared) }),
            el('td', { class: 'mono', style: v.unknown === S.disc.totals.entries && S.disc.totals.entries ? 'color:var(--muted)' : '', text: String(v.unknown) })
          ])))
        ]));
        box.appendChild(el('div', { style: 'font-size:10.5px;color:var(--muted);margin-top:4px', text:
          'Um campo só conta quando tem fonte datada; «desconhecido» é uma resposta, não uma falha a esconder.' }));
        wrap.appendChild(box);
      }

      /* ---- catálogo ---- */
      if (!S.entries || !S.entries.length) {
        wrap.appendChild(el('div', { class: 'empty', id: 'providersEmpty', text: 'Catálogo vazio: carregue a semente para começar (nada é inventado localmente).' }));
        return;
      }
      wrap.appendChild(el('h4', { style: 'font-size:12px;margin:10px 0 4px', text: 'Catálogo (' + S.entries.length + ')' }));
      const rows = S.entries.map((e) => {
        const tests = e.tests || [];
        const ultimo = tests.length ? tests[tests.length - 1] : null;
        return el('tr', {}, [
          el('td', {}, [el('b', { text: e.name }), el('div', { class: 'muted', style: 'font-size:10px', text: e.key })]),
          el('td', { text: (e.access && e.access.class) || '—' }),
          el('td', { text: e.state || '—' }),
          el('td', { style: 'font-size:10.5px', text: (e.evidenceSummary ? e.evidenceSummary.measured + ' medidas' : '—') +
            (e.evidenceSummary && e.evidenceSummary.freshnessDays != null ? ' · ' + e.evidenceSummary.freshnessDays + ' d' : '') }),
          el('td', {}, [ultimo ? chip(ultimo.result) : el('span', { class: 'muted', text: 'nunca testado' })]),
          el('td', {}, [el('button', { class: 'btn sm', type: 'button', text: 'Ver', onclick: async () => {
            S.open = S.open === e.key ? null : e.key; paint();
          } })])
        ]);
      });
      wrap.appendChild(el('table', { class: 'listtable', id: 'providersTable' }, [
        el('thead', {}, [el('tr', {}, ['Fornecedor', 'Classe', 'Estado', 'Evidência', 'Último teste', ''].map((h) => el('th', { text: h })))]),
        el('tbody', {}, rows)
      ]));

      if (S.open) {
        const e = S.entries.filter((x) => x.key === S.open)[0];
        const box = el('div', { style: 'margin:8px 0;padding:8px;border:1px solid var(--line)', id: 'providerDetail' });
        box.appendChild(el('h4', { style: 'font-size:11px;margin:0 0 4px', text: e.name + ' — ' + e.key }));
        box.appendChild(el('div', { style: 'font-size:11px', text: 'Endpoints: ' + ((e.endpoints || []).map((x) => x.base).join(', ') || 'nenhum (é uma ferramenta, não um serviço)') }));
        box.appendChild(el('table', { class: 'listtable' }, [
          el('thead', {}, [el('tr', {}, ['Afirmação', 'Estado', 'Data', 'Fonte', 'Método'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, (e.evidence || []).map((x) => el('tr', {}, [
            el('td', { text: x.a }), el('td', { text: x.status }), el('td', { class: 'mono', text: x.at || '—' }),
            el('td', { style: 'font-size:10px', text: x.url || '—' }), el('td', { style: 'font-size:10px', text: x.method || '—' })
          ])))
        ]));
        box.appendChild(el('div', { class: 'actions', style: 'margin-top:6px' }, [
          el('button', { class: 'btn sm', type: 'button', id: 'btnTestGeneration', text: 'Testar geração (níveis 3–4 — gasta a sua chave)', onclick: async () => {
            if (!confirm('Os níveis 3–4 fazem pedidos reais com a SUA chave guardada e podem custar dinheiro. Continuar?')) return;
            const r = await api('/api/provider-os/test', { method: 'POST', body: { key: e.key, levels: [3, 4], confirmCost: true } });
            if (!r.ok) { S.msg = { text: 'Teste recusado: ' + reasonOf(r) }; paint(); return; }
            const partes = Object.keys(r.json.results).map((n) => n + ':' + r.json.results[n].result);
            S.msg = { text: 'Resultado ' + partes.join(' · ') + (r.json.hadKey ? '' : ' — sem chave guardada, a geração fica BLOQUEADA') };
            await load(); paint();
          } })
        ]));
        wrap.appendChild(box);
      }

      /* ---- reavaliação e saúde (fase 5) ---- */
      if (S.schedule) {
        const c = S.schedule.counts;
        wrap.appendChild(el('h4', { style: 'font-size:12px;margin:12px 0 4px', text:
          'Próximas reavaliações — ' + c.due + ' em atraso de ' + c.total + ' (' + c.manual + ' exigem decisão humana)' }));
        const fila = (S.schedule.queue || []).slice(0, 6);
        if (!fila.length) {
          wrap.appendChild(el('div', { class: 'empty', id: 'reevalEmpty', text: 'Nada em atraso: o calendário é derivado do histórico de testes e da idade da evidência.' }));
        } else {
          wrap.appendChild(el('table', { class: 'listtable', id: 'reevalTable' }, [
            el('thead', {}, [el('tr', {}, ['Fornecedor', 'Ação', 'Prioridade', 'Motivo'].map((h) => el('th', { text: h })))]),
            el('tbody', {}, fila.map((x) => el('tr', {}, [
              el('td', {}, [el('b', { text: x.name || x.key }), el('div', { class: 'muted', style: 'font-size:10px', text: x.key })]),
              el('td', { style: 'font-size:10.5px', text: x.action }),
              el('td', { class: 'mono', text: String(x.priority) }),
              el('td', { style: 'font-size:10.5px', text: x.reason })
            ])))
          ]));
        }
        const futuras = (S.schedule.all || []).filter((x) => x.nextDueAt && !x.due);
        if (futuras.length) {
          wrap.appendChild(el('div', { style: 'font-size:10.5px;color:var(--muted);margin-top:4px', text:
            'Agendadas: ' + futuras.slice(0, 5).map((x) => (x.name || x.key) + ' → ' + String(x.nextDueAt).slice(0, 10) +
              (x.intervalDays != null ? ' (' + x.intervalDays + ' d)' : '')).join(' · ') }));
        }
      }
      if (S.health && S.health.providers) {
        const st = {};
        S.health.providers.forEach((p) => { st[p.status] = (st[p.status] || 0) + 1; });
        wrap.appendChild(el('div', { class: 'infobox', id: 'healthBox', style: 'margin-top:8px;font-size:11px', html:
          '<b>Sonda de saúde:</b> ' + Object.entries(st).map(([k, v]) => v + ' ' + k.toLowerCase().replace('sem-dados', 'sem dados')).join(' · ') +
          '. <i>Health check não é teste de qualidade:</i> só diz se o serviço responde — não cria testes, não promove estados e não entra na nota.' }));
      }

      /* ---- benchmarks (fase 7) ---- */
      if (S.bench) {
        const box = el('div', { style: 'margin:10px 0;padding:8px;border:1px solid var(--line)', id: 'benchmarkBox' });
        box.appendChild(el('h4', { style: 'font-size:12px;margin:0 0 4px', text:
          'Benchmarks — mesmas perguntas, verificação objectiva (' + (S.suite ? S.suite.tasks.length : 5) + ' tarefas)' }));
        box.appendChild(el('div', { style: 'font-size:10.5px;color:var(--muted)', text:
          (S.suite ? S.suite.tasks.map((t2) => t2.id).join(' · ') : '') }));
        const acoesB = el('div', { class: 'actions', style: 'margin:6px 0' });
        acoesB.appendChild(el('button', { class: 'btn sm', type: 'button', id: 'btnBenchAll', text: 'Correr benchmark nos fornecedores com chave (gasta créditos)', onclick: async () => {
          if (!confirm('O benchmark faz 5 pedidos reais por fornecedor, com a SUA chave guardada. Continuar?')) return;
          S.busy = 'bench'; paint();
          const alvos = (S.entries || []).filter((e) => e.kind !== 'tool' && e.endpoints && e.endpoints.length).slice(0, 4);
          const feitos = [];
          for (const e of alvos) {
            const r = await api('/api/provider-os/benchmark', { method: 'POST', body: { key: e.key, confirmCost: true } });
            if (!r.ok) { feitos.push(e.key + ': ' + reasonOf(r)); continue; }
            feitos.push(e.key + ': ' + (r.json.ok ? r.json.summary.qualityScore + '/100' : r.json.status));
          }
          S.busy = '';
          S.msg = { text: 'Benchmark: ' + feitos.join(' · ') };
          await load(); paint();
        } }));
        box.appendChild(acoesB);
        if (!S.bench.ran) {
          box.appendChild(el('div', { class: 'warnbox', id: 'benchEmpty', text:
            'Nenhum benchmark executado: sem chave guardada não há como medir qualidade. A matriz fica vazia em vez de preenchida com estimativas.' }));
        } else {
          /* uma linha por fornecedor; uma célula por tarefa (com o motivo no title) */
          const cabecalho = ['Fornecedor', 'Nota', 'Tarefas', 'Custo medido']
            .concat((S.bench.tasks || []).map((x) => x.id));
          const linhas = S.bench.rows.map((r) => {
            const celulas = [
              el('td', {}, [el('b', { text: r.key }), el('div', { class: 'muted', style: 'font-size:10px', text: r.model || '—' })]),
              el('td', { class: 'mono', text: r.qualityScore == null ? '—' : String(r.qualityScore) }),
              el('td', { class: 'mono', text: r.passRate == null ? '—' : Math.round(r.passRate) + ' %' }),
              el('td', { class: 'mono', text: r.costUsd == null ? '—' : r.costUsd.toFixed(6) + ' USD' })
            ];
            (S.bench.tasks || []).forEach((x) => {
              const cell = (r.cells || {})[x.id];
              if (!cell) { celulas.push(el('td', {}, [el('span', { class: 'muted', text: '—' })])); return; }
              const cls = cell.result === 'PASS' ? 'ok' : cell.result === 'FAIL' ? 'bad' : 'muted';
              celulas.push(el('td', {}, [el('span', { class: 'scorepill ' + cls, title: cell.why || '', text: cell.result })]));
            });
            return el('tr', {}, celulas);
          });
          box.appendChild(el('table', { class: 'listtable', id: 'benchTable' }, [
            el('thead', {}, [el('tr', {}, cabecalho.map((h) => el('th', { text: h })))]),
            el('tbody', {}, linhas)
          ]));
          box.appendChild(el('div', { style: 'font-size:10.5px;color:var(--muted);margin-top:4px', text:
            'A nota de qualidade é a taxa de tarefas passadas (exclui a tarefa de segurança, que tem dimensão própria). ' +
            'É esta nota que o ranking passa a usar — antes era sempre «não medida».' }));
        }
        wrap.appendChild(box);
      }

      /* ---- ranking ---- */
      if (S.ranking) {
        wrap.appendChild(el('h4', { style: 'font-size:12px;margin:12px 0 4px', text: 'Ranking — ' + S.ranking.taskLabel + ' (' + S.ranking.computed + ' com nota de ' + S.ranking.total + ')' }));
        if (!S.ranking.computed) {
          wrap.appendChild(el('div', { class: 'warnbox', id: 'rankingProvisional', text:
            'Nenhuma linha tem nota: falta um teste de geração com PASS e ≥ 40 % dos pesos medidos. ' +
            'Uma nota calculada com uma dimensão entre oito não seria um ranking, seria ruído.' }));
        }
        wrap.appendChild(el('table', { class: 'listtable', id: 'providersRanking' }, [
          el('thead', {}, [el('tr', {}, ['Fornecedor', 'Nota', 'Cobertura', 'Classificação', 'Falta'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, S.ranking.rows.slice(0, 10).map((r) => el('tr', {}, [
            el('td', { text: r.name }),
            el('td', { class: 'mono', text: r.score == null ? '—' : String(r.score) + ' ' + (r.band || '') }),
            el('td', { class: 'mono', text: r.coveragePct + ' %' }),
            el('td', { style: 'font-size:10.5px', text: r.verdict }),
            el('td', { style: 'font-size:10px;color:var(--muted)', text: (r.missing || []).join(', ') || '—' })
          ])))
        ]));
      }

      /* ---- decisão ---- */
      if (S.decision) {
        const d = S.decision;
        const box = el('div', { style: 'margin:10px 0;padding:8px;border:1px solid var(--line)', id: 'providerDecision' });
        box.appendChild(el('h4', { style: 'font-size:12px;margin:0 0 4px', text: d.chosen
          ? 'Decisão: ' + d.chosen.name + ' · nota ' + d.chosen.score + '/' + d.chosen.band + ' · confiança ' + d.confidence
          : 'Decisão: nenhum fornecedor escolhido' }));
        if (!d.chosen) box.appendChild(el('div', { class: 'warnbox', text: d.noChoiceReason }));
        box.appendChild(el('ul', { style: 'font-size:11px', id: 'decisionWhy' }, (d.justification || []).map((x) => el('li', { text: x }))));
        if (d.alternatives && d.alternatives.length) {
          box.appendChild(el('div', { style: 'font-size:11px;margin-top:4px', text: 'Por que não a alternativa:' }));
          box.appendChild(el('ul', { style: 'font-size:11px' }, d.alternatives.map((a) => el('li', { text: a.name + ' (' + (a.score == null ? 'sem nota' : a.score) + '): ' + a.whyNot }))));
        }
        if (d.whatWouldChangeIt && d.whatWouldChangeIt.length) {
          box.appendChild(el('div', { style: 'font-size:11px;margin-top:4px', text: 'O que mudaria esta decisão:' }));
          box.appendChild(el('ul', { style: 'font-size:11px' }, d.whatWouldChangeIt.map((x) => el('li', { text: x }))));
        }
        if (d.rejected && d.rejected.length) {
          box.appendChild(el('div', { style: 'font-size:11px;margin-top:4px', text: 'Eliminadas antes (' + d.rejected.length + '):' }));
          box.appendChild(el('ul', { style: 'font-size:10.5px;color:var(--muted)' }, d.rejected.slice(0, 8).map((r) => el('li', { text: r.name + ' — ' + r.stage + ': ' + r.reason }))));
        }
        box.appendChild(el('details', { style: 'font-size:10.5px;margin-top:6px' }, [
          el('summary', { text: 'Os 13 passos desta decisão' }),
          el('table', { class: 'listtable' }, [
            el('thead', {}, [el('tr', {}, ['#', 'Passo', 'O que aconteceu'].map((h) => el('th', { text: h })))]),
            el('tbody', {}, (d.steps || []).map((s) => el('tr', {}, [
              el('td', { class: 'mono', text: String(s.step) }),
              el('td', { text: (s.name || s.key) }),
              el('td', { style: 'font-size:10px', text: resumoPasso(s) })
            ])))
          ])
        ]));
        wrap.appendChild(box);
      }

      /* ---- plano de fallback ---- */
      if (S.plan && S.plan.plan && S.plan.plan.length) {
        const box = el('div', { style: 'margin:10px 0;padding:8px;border:1px solid var(--line)', id: 'providerPlan' });
        box.appendChild(el('h4', { style: 'font-size:12px;margin:0 0 4px', text: 'Plano de fallback (simulado — 0 pedidos, 0 custo)' }));
        box.appendChild(el('ol', { style: 'font-size:11px' }, S.plan.plan.map((x) => el('li', {
          text: x.providerKey + ' · tentativa ' + x.attempt + ' · espera ' + x.delayMs + ' ms (máx ' + x.maxDelayMs + ' ms)'
        }))));
        if (S.plan.policy) box.appendChild(el('div', { style: 'font-size:10.5px;color:var(--muted)', text:
          'Política: base ' + S.plan.policy.baseMs + ' ms · tecto ' + S.plan.policy.capMs + ' ms · jitter ' + S.plan.policy.jitter +
          ' · máx ' + S.plan.policy.maxAttemptsPerProvider + ' tentativas por fornecedor · orçamento ' + S.plan.policy.budgetUsd + ' USD' }));
        wrap.appendChild(box);
      }
    }

    function resumoPasso(s) {
      if (s.kept != null && s.removed != null) return 'ficaram ' + s.kept + ', removidas ' + s.removed;
      if (s.order) return s.order.map((x) => x.key.split('/').pop() + ' ' + (x.score == null ? '—' : x.score)).join(' · ');
      if (s.task) return 'tarefa ' + s.task + ' (pesos ' + Object.values(s.weights || {}).join('/') + ')';
      if (s.pinnedKey) return 'fixado: ' + s.pinnedKey + (s.note ? ' — ' + s.note : '');
      if (s.alternatives != null) return s.alternatives + ' alternativa(s)';
      if (s.validityDays != null) return s.validityDays + ' dias (reavaliar em ' + s.recheckAt + ')';
      if (s.unknownCost) return 'custo desconhecido: ' + s.unknownCost.join(', ');
      return s.note || '';
    }

    load().then(paint).catch((e) => { paint(); wrap.appendChild(el('div', { class: 'warnbox', text: 'Falha ao ler o catálogo: ' + e.message })); });
    return wrap;
  }

  VN.provedoresUI = { mount, getState: () => S };
})(typeof window !== 'undefined' ? window : globalThis);
