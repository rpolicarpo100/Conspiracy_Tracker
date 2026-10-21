/* =====================================================================
   VN · INTERFACE DE APIs
   Três secções: catálogo auditável · agente de descoberta · adicionar API.
   Nenhuma auditoria escreve no grafo; cada uma vai para o livro de provas.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});

  const LS_CUSTOM = 'vn-apis-custom';
  const VERDICT_PT = {
    aprovada: ['aprovada', 'ok'], condicional: ['condicional', 'warn'],
    rejeitada: ['rejeitada', 'bad'], 'fora-do-ambito': ['fora do âmbito', 'muted'],
    'nao-auditada': ['não auditada', 'muted']
  };

  function clearNode(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }

  function loadCustom() {
    try { return JSON.parse(localStorage.getItem(LS_CUSTOM) || '[]'); } catch (e) { return []; }
  }
  function saveCustom(list) { localStorage.setItem(LS_CUSTOM, JSON.stringify(list.slice(0, 50))); }

  function mount(deps) {
    const D = deps.D, el = deps.el, toast = deps.toast;
    const state = {
      audits: {}, custom: loadCustom(), candidates: [], candidateAudits: {},
      selected: null, busy: null, showCustomForm: false, discoverTerm: 'company registry', discoveryRan: false
    };

    const host = el('div', { id: 'apisroot' });
    const runner = () => {
      const proxy = /^https?:$/.test(location.protocol);
      return VN.agents.createRunner({
        ledger: deps.ledgerWrapper ? deps.ledgerWrapper() : null,
        transport: proxy ? 'proxy' : 'direct',
        proxyUrl: proxy ? new URL('api/fetch', location.href).href : null
      });
    };

    const allEntries = () => VN.apis.CATALOG.concat(state.custom.map((c) => c.entry));

    function scorePill(v, max) {
      const cls = v >= 75 ? 'ok' : v >= 55 ? 'warn' : 'bad';
      return el('span', { class: 'scorepill ' + cls, title: v + '/' + max, text: String(v) });
    }

    function paintDetails(box) {
      const id = state.selected;
      if (!id) { box.appendChild(el('p', { style: 'font-size:11px;color:var(--muted)', text: 'Seleccione uma API para ver as razões de cada pontuação.' })); return; }
      const entry = allEntries().filter((e) => e.id === id)[0];
      const a = state.audits[id];
      if (!entry) return;
      box.appendChild(el('h4', { style: 'margin:4px 0', text: entry.name }));
      const meta = [
        ['Grupo', entry.group], ['Licença', entry.licence || '—'], ['Autenticação', entry.auth || '—'],
        ['Responde a', entry.answers || '—'], ['Limite', entry.limits || '—']
      ];
      box.appendChild(el('table', { class: 'listtable' }, [
        el('tbody', {}, meta.map(([k, v]) => el('tr', {}, [el('th', { style: 'width:140px;font-size:11px', text: k }), el('td', { style: 'font-size:11px', text: String(v) })])))
      ]));
      box.appendChild(el('div', { class: 'chips', style: 'margin:6px 0' }, [
        el('a', { class: 'btn sm', href: entry.url, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir endpoint' }),
        entry.docs ? el('a', { class: 'btn sm', href: entry.docs, target: '_blank', rel: 'noopener noreferrer', text: 'Documentação' }) : null,
        el('button', { class: 'btn sm primary', type: 'button', text: 'Auditar esta API', onclick: () => auditEntries([entry]) })
      ].filter(Boolean)));
      if (!a) return;
      box.appendChild(el('div', { class: 'statline', style: 'margin:8px 0' }, [
        el('span', { class: 'tag ' + (VERDICT_PT[a.verdict] || ['?', 'muted'])[1], text: (VERDICT_PT[a.verdict] || [a.verdict])[0] }),
        el('span', { style: 'margin-left:8px;font-size:11px', text: a.verdictWhy })
      ]));
      ['security', 'reliability', 'usefulness'].forEach((dim) => {
        const label = dim === 'security' ? 'Segurança' : dim === 'reliability' ? 'Fiabilidade' : 'Utilidade';
        const bloco = el('div', { style: 'margin:8px 0' }, [
          el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
            el('b', { style: 'font-size:12px', text: label }),
            scorePill(a.scores[dim], 100),
            el('span', { style: 'font-size:10px;color:var(--muted)', text: 'de 100 (máx. teórico ' + (dim === 'usefulness' ? 100 : 100) + ')' })
          ])
        ]);
        const ul = el('ul', { style: 'margin:4px 0 0 16px;padding:0;font-size:11px' });
        a.reasons[dim].forEach((r) => ul.appendChild(el('li', { class: r.points > 0 ? '' : 'dim', text: (r.points > 0 ? '+' + r.points : '0') + ' · ' + r.text })));
        bloco.appendChild(ul);
        box.appendChild(bloco);
      });
      if (a.headers && Object.keys(a.headers).length) {
        box.appendChild(el('details', {}, [
          el('summary', { style: 'font-size:11px;cursor:pointer', text: 'Cabeçalhos observados (' + Object.keys(a.headers).length + ')' }),
          el('pre', { style: 'font-size:10px;max-height:160px;overflow:auto;white-space:pre-wrap', text: Object.keys(a.headers).map((k) => k + ': ' + a.headers[k]).join('\n') })
        ]));
      }
      box.appendChild(el('table', { class: 'listtable', style: 'margin-top:8px' }, [
        el('thead', {}, [el('tr', {}, ['#', 'estado', 'HTTP', 'bytes', 'SHA-256', 'nota'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, a.runs.map((r, i) => el('tr', {}, [
          el('td', { text: String(i + 1) }), el('td', { text: r.status }),
          el('td', { text: r.http == null ? '—' : String(r.http) }),
          el('td', { text: r.bytes == null ? '—' : String(r.bytes) }),
          el('td', { style: 'font-family:monospace;font-size:10px', text: r.sha256 || '—' }),
          el('td', { style: 'font-size:10px', text: r.note || '' })
        ])))
      ]));
    }

    async function auditEntries(entries) {
      if (state.busy) return toast('Já há uma auditoria em curso', 'warn');
      state.busy = 'audit';
      paint();
      const r = runner();
      try {
        if (entries.length === 1) { state.selected = entries[0].id; paint(); }
        for (const e of entries) {
          const a = await VN.apis.auditOne(e, r, { attempts: 2 });
          state.audits[e.id] = a;
          if (deps.appendLedger) {
            await deps.appendLedger({
              type: 'auditoria_api', subject: e.id,
              payload: {
                name: e.name, url: e.url, licence: e.licence || null,
                scores: a.scores, verdict: a.verdict, verdictWhy: a.verdictWhy,
                http: a.runs.map((x) => x.http), sha256: a.runs.map((x) => x.sha256),
                reasons: ['security', 'reliability', 'usefulness'].reduce((o, d2) => { o[d2] = a.reasons[d2].map((x) => x.points + ' ' + x.text); return o; }, {})
              },
              note: 'Auditoria de API: ' + a.verdict + ' — nenhum dado entrou no grafo'
            });
          }
        }
        toast('Auditoria concluída: ' + entries.length + ' API(s)', 'ok');
      } catch (err) { toast('Auditoria falhou: ' + err.message, 'bad'); }
      state.busy = null;
      paint();
    }

    async function discover(term) {
      if (state.busy) return toast('Já há uma operação em curso', 'warn');
      state.busy = 'discover';
      paint();
      try {
        const out = await VN.apis.discoverCatalog(runner(), term, 24);
        if (out.error) throw new Error(out.error);
        state.candidates = out.candidates;
        state.discoveryRan = true;
        if (deps.appendLedger) {
          await deps.appendLedger({
            type: 'descoberta_api', subject: 'apis-guru',
            payload: { term: term, candidates: out.candidates.slice(0, 24).map((c) => c.provider + '@' + c.version), bytes: out.bytes, sha256: out.sha256 || null },
            note: 'Descoberta de APIs (metadados OpenAPI) — candidatos não são recomendações'
          });
        }
        toast(state.candidates.length + ' candidatos para «' + term + '»', state.candidates.length ? 'ok' : 'warn');
      } catch (e) { toast('Descoberta falhou: ' + e.message, 'bad'); }
      state.busy = null;
      paint();
    }

    async function auditCandidate(c) {
      if (state.busy) return toast('Já há uma operação em curso', 'warn');
      state.busy = 'candidate:' + c.provider;
      paint();
      try {
        const res = await VN.apis.auditCandidate(c, runner());
        state.candidateAudits[c.provider] = res;
        if (res.audit && deps.appendLedger) {
          await deps.appendLedger({
            type: 'auditoria_api', subject: c.provider + '@' + c.version,
            payload: { discovered: true, spec: res.spec, probe: res.probe && res.probe.url, scores: res.audit.scores, verdict: res.audit.verdict },
            note: 'Candidato descoberto auditado — não é recomendação de uso'
          });
        }
        toast(res.audit ? 'Candidato auditado: ' + res.audit.verdict : 'Candidato sem pedido testável', res.audit ? 'ok' : 'warn');
      } catch (e) { toast('Falhou: ' + e.message, 'bad'); }
      state.busy = null;
      paint();
    }

    function paint() {
      const root = host;
      if (!root) return;
      clearNode(root);

      root.appendChild(el('p', { text: 'As APIs externas servem para obter provas, não para encher o mapa. O catálogo declara o que cada uma responde e o que não prova; o agente mede o resto. Uma API «aprovada» é uma API tecnicamente sólida, não uma fonte de verdades.' }));
      root.appendChild(el('div', { class: 'warnbox', style: 'margin:6px 0' }, [
        el('b', { text: 'Como é pontuado: ' }),
        el('span', { text: 'segurança (TLS, HSTS, CORS, robots, chave na URL, cabeçalhos) · fiabilidade (3 pedidos: disponibilidade, latência mediana, tipo estável, erros honestos) · utilidade (valor curado 60 + estrutura da resposta 20 + cobertura de entidades 20). Pesos e razões em src/core/apis.js; cada pontuação é acompanhada do motivo.' })
      ]));

      const chips = el('div', { class: 'chips' }, [
        el('button', {
          class: 'btn primary', type: 'button', disabled: state.busy ? 'disabled' : null,
          text: state.busy === 'audit' ? 'A auditar…' : 'Auditar catálogo (' + allEntries().length + ')',
          onclick: () => auditEntries(allEntries())
        }),
        el('button', {
          class: 'btn sm', type: 'button', text: 'Exportar relatório (JSON)',
          onclick: () => {
            const rel = {
              generatedAt: new Date().toISOString(),
              method: 'auditoria pela interface; pesos em src/core/apis.js',
              audits: Object.values(state.audits),
              candidates: state.candidateAudits,
              custom: state.custom
            };
            if (!rel.audits.length) return toast('Ainda não há auditorias', 'warn');
            D.download('apis-auditoria-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(rel, null, 2), 'application/json');
          }
        }),
        el('button', { class: 'btn sm', type: 'button', text: state.showCustomForm ? 'Fechar formulário' : 'Adicionar API', onclick: () => { state.showCustomForm = !state.showCustomForm; paint(); } })
      ]);
      root.appendChild(chips);

      /* --- catálogo --- */
      const rows = allEntries().map((e) => {
        const a = state.audits[e.id];
        const v = a ? (VERDICT_PT[a.verdict] || [a.verdict, 'muted']) : null;
        return el('tr', {
          style: 'cursor:pointer', onclick: () => { state.selected = e.id; paint(); },
          class: state.selected === e.id ? 'sel' : ''
        }, [
          el('td', { style: 'font-size:11px' }, [
            el('b', { text: e.name }),
            el('div', { style: 'color:var(--muted)', text: (e.custom ? 'personalizada · ' : '') + (e.group || '') }),
            e.robotsPolicy === 'api-terms' ? el('span', { class: 'tag warn', style: 'margin-top:2px', text: 'robots: política declarada' }) : null
          ].filter(Boolean)),
          el('td', { style: 'font-size:10px;color:var(--muted)', text: (e.licence || '—').slice(0, 44) }),
          el('td', { style: 'font-size:11px', text: e.auth || '—' }),
          el('td', {}, a ? el('div', { style: 'display:flex;gap:4px' }, [scorePill(a.scores.security), scorePill(a.scores.reliability), scorePill(a.scores.usefulness)]) : el('span', { style: 'color:var(--muted);font-size:10px', text: 'por auditar' })),
          el('td', {}, a ? el('span', { class: 'tag ' + v[1], text: v[0] }) : el('span', { class: 'tag muted', text: '—' })),
          el('td', {}, [
            el('button', {
              class: 'btn sm', type: 'button', text: state.busy === 'candidate:' + e.id ? '…' : 'Auditar',
              onclick: (ev) => { ev.stopPropagation(); auditEntries([e]); }
            })
          ])
        ]);
      });

      root.appendChild(el('table', { class: 'listtable', style: 'margin-top:8px' }, [
        el('thead', {}, [el('tr', {}, ['API', 'licença', 'auth', 'seg · fia · uti', 'veredicto', ''].map((h) => el('th', { text: h })))]),
        el('tbody', {}, rows)
      ]));

      const det = el('div', { style: 'margin-top:10px;border-top:1px solid var(--line);padding-top:8px' });
      paintDetails(det);
      root.appendChild(det);

      /* --- formulário de API personalizada --- */
      if (state.showCustomForm) {
        const f = {};
        const inp = (k, label, ph, val) => {
          const i = el('input', { class: 'input', placeholder: ph || '', value: val || '', style: 'min-width:220px', oninput: (ev) => { f[k] = ev.target.value; } });
          return el('label', { style: 'display:flex;flex-direction:column;gap:2px;font-size:10px;color:var(--muted)' }, [el('span', { text: label }), i]);
        };
        const box = el('div', { class: 'warnbox', style: 'margin-top:10px' }, [
          el('b', { text: 'Adicionar API ao catálogo' }),
          el('p', { style: 'font-size:11px', text: 'A API fica guardada neste navegador (localStorage) e pode ser auditada como as outras. Não é enviada para nenhum servidor.' }),
          el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin:6px 0' }, [
            inp('name', 'Nome', 'ex.: Registo Comercial (API)'),
            inp('url', 'URL de teste (GET)', 'https://…'),
            inp('docs', 'Documentação', 'https://…'),
            inp('licence', 'Licença / termos', 'ex.: dados abertos CC BY'),
            inp('auth', 'Autenticação', 'nenhuma / chave / OAuth'),
            inp('hasPath', 'Campo esperado (opcional)', 'ex.: data.0.id'),
            inp('usefulness', 'Utilidade 0–100', '70'),
            inp('why', 'Porquê (justificação)', 'o que esta API permite provar')
          ]),
          el('div', { class: 'chips' }, [
            el('button', {
              class: 'btn primary sm', type: 'button', text: 'Validar e adicionar',
              onclick: () => {
                const res = VN.apis.makeCustom(f);
                if (res.errors.length) return toast(res.errors.join(' · '), 'bad', 7000);
                state.custom.push({ entry: res.entry });
                saveCustom(state.custom);
                state.showCustomForm = false; state.selected = res.entry.id;
                toast('API adicionada — pode auditar já', 'ok');
                paint();
              }
            }),
            el('button', {
              class: 'btn sm', type: 'button', text: 'Remover todas as personalizadas',
              onclick: () => { state.custom = []; saveCustom([]); state.selected = null; paint(); }
            })
          ])
        ]);
        root.appendChild(box);
      }

      /* --- descoberta --- */
      const disc = el('div', { style: 'margin-top:14px;border-top:1px solid var(--line);padding-top:10px' });
      disc.appendChild(el('h4', { style: 'margin:0 0 4px', text: 'Agente de descoberta de APIs' }));
      disc.appendChild(el('p', { style: 'font-size:11px;color:var(--muted);margin:2px 0', text: 'Procura no catálogo APIs.guru (metadados OpenAPI, CC0), propõe candidatos e, para cada um, obtém a especificação e deriva um pedido GET sem parâmetros obrigatórios. Se não conseguir derivar um pedido, diz isso — não inventa endpoints.' }));
      const term = el('input', { class: 'input', value: state.discoverTerm, style: 'min-width:240px', oninput: (ev) => { state.discoverTerm = ev.target.value; } });
      disc.appendChild(el('div', { class: 'chips', style: 'margin:6px 0' }, [
        term,
        el('button', { class: 'btn sm primary', type: 'button', disabled: state.busy ? 'disabled' : null, text: state.busy === 'discover' ? 'A procurar…' : 'Procurar APIs', onclick: () => discover(state.discoverTerm) }),
        el('span', { style: 'font-size:10px;color:var(--muted)', text: 'ex.: contracts · company · sanctions · procurement' })
      ]));
      if (state.discoveryRan) {
        disc.appendChild(el('div', { class: 'statline', style: 'margin:6px 0;font-size:11px' }, [
          el('b', { text: state.candidates.length + ' candidatos' }),
          el('span', { text: ' para «' + state.discoverTerm + '» · fonte: APIs.guru (metadados OpenAPI) · nenhum candidato é recomendação' })
        ]));
        if (!state.candidates.length) disc.appendChild(el('div', { class: 'warnbox', text: 'Nenhum candidato para este termo. Experimente outra palavra — o catálogo cobre sobretudo serviços comerciais, não registos públicos nacionais.' }));
        else {
          disc.appendChild(el('table', { class: 'listtable' }, [
            el('thead', {}, [el('tr', {}, ['API', 'fornecedor', 'versão', 'espec.', 'auditoria'].map((h) => el('th', { text: h })))]),
            el('tbody', {}, state.candidates.map((c) => {
              const ca = state.candidateAudits[c.provider];
              return el('tr', {}, [
                el('td', { style: 'font-size:11px' }, [el('b', { text: c.title }), el('div', { style: 'color:var(--muted);font-size:10px', text: (c.description || '').slice(0, 110) })]),
                el('td', { style: 'font-size:10px', text: c.provider }),
                el('td', { style: 'font-size:10px', text: c.version + (c.preferred ? ' ★' : '') }),
                el('td', {}, [c.openapiUrl ? el('a', { class: 'btn sm', href: c.openapiUrl, target: '_blank', rel: 'noopener noreferrer', text: 'OpenAPI' }) : el('span', { text: '—' })]),
                el('td', {}, [
                  ca ? el('span', { class: 'tag ' + (ca.audit ? (VERDICT_PT[ca.audit.verdict] || ['?', 'muted'])[1] : 'muted'), text: ca.audit ? (VERDICT_PT[ca.audit.verdict] || [ca.audit.verdict])[0] : 'sem pedido' })
                     : el('button', { class: 'btn sm', type: 'button', text: 'Auditar', onclick: () => auditCandidate(c) })
                ])
              ]);
            }))
          ]));
          const withAudit = state.candidates.filter((c) => state.candidateAudits[c.provider]);
          if (withAudit.length) {
            const last = state.candidateAudits[withAudit[0].provider];
            if (last.spec) {
              disc.appendChild(el('div', { class: 'statline', style: 'margin-top:6px;font-size:11px' }, [
                el('b', { text: last.spec.title + ' ' + last.spec.version }),
                el('span', { text: ' · OpenAPI ' + (last.spec.openapi || '?') + ' · ' + last.spec.pathCount + ' caminhos' + (last.spec.sizeMB ? ' · especificação com ' + last.spec.sizeMB + ' MB' : '') + ' · licença: ' + (last.spec.licence || 'não declarada') + ' · auth: ' + (last.spec.requiresAuth ? last.spec.authTypes.join(', ') : 'nenhuma') + (last.probe && last.probe.url ? ' · pedido de teste: ' + last.probe.url : '') })
              ]));
            }
            if (last.notes.length) disc.appendChild(el('div', { class: 'warnbox', style: 'font-size:11px', text: last.notes.join(' · ') }));
          }
        }
        disc.appendChild(el('div', { class: 'warnbox', style: 'margin-top:8px', text: 'Um candidato auditado não é uma recomendação: a utilidade foi marcada como «não avaliada por humano» e os termos de utilização têm de ser lidos antes de usar. Nada disto entra no grafo automaticamente.' }));
      }
      root.appendChild(disc);
    }

    paint();
    return host;
  }

  VN.apisUI = { mount, loadCustom, saveCustom };
})(typeof window !== 'undefined' ? window : globalThis);
