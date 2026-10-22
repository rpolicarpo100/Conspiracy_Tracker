/* =====================================================================
   VN · CONSOLA DE INVESTIGAÇÃO
   Pergunta → plano de fontes verificáveis → afirmações com fonte →
   livro de provas com hash → importação de dados reais validados.
   A IA é opcional e nunca tem autoridade: as suas afirmações entram
   como ALEGAÇÕES sujeitas a verificação humana.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const D = VN.dom;
  const { el, clear, esc, toast } = D;

  const K = {
    dataset: 'vn-dataset', bundle: 'vn-real-bundle', ai: 'vn-ai-config',
    ledger: (ds) => 'vn-ledger-' + ds, research: (ds) => 'vn-research-' + ds
  };

  let ctx = null, ledger = null, modalRef = null, tab = 'ask', lastPlan = null, lastValidation = null;
  let agentTasks = null, agentResult = null, agentLive = false, agentBusy = false;
  let agentProxy = /^https?:$/.test(location.protocol);

  const dataset = () => localStorage.getItem(K.dataset) || 'fictional';

  function open() {
    ctx = VN.app.ctx;
    const body = el('div', {}, [tabs(), el('div', { id: 'consolebody', style: 'margin-top:12px' })]);
    modalRef = VN.panels.modal('Consola de investigação', body, { wide: true });
    initLedger().then(() => paint());
  }

  function tabs() {
    const items = [
      ['ask', 'Investigar'], ['sources', 'Fontes'], ['evidence', 'Livro de provas'],
      ['real', 'Dados reais'], ['agents', 'Agentes de recolha'], ['apis', 'APIs'],
      ['registro', 'Registo de fontes'], ['provedores', 'Fornecedores de IA'], ['ai', 'Configuração de IA']
    ];
    const wrap = el('div', { class: 'chips' });
    items.forEach(([id, label]) => wrap.appendChild(el('button', {
      class: 'btn sm' + (tab === id ? ' primary' : ''), type: 'button', text: label,
      onclick: () => { tab = id; paint(); }
    })));
    return wrap;
  }

  async function initLedger() {
    if (ledger) return;
    ledger = VN.ledger.create('caso-' + dataset());
    const raw = localStorage.getItem(K.ledger(dataset()));
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        ledger.ledger.entries = saved.entries || [];
        ledger.ledger.head = saved.head || null;
        ledger.ledger.createdAt = saved.createdAt || ledger.ledger.createdAt;
      } catch (e) { console.warn('livro de provas ilegível', e); }
    }
    // entrada de abertura, para datar o início do trabalho
    if (!ledger.ledger.entries.length) {
      await ledger.append({ type: 'abertura', payload: { dataset: dataset(), modelo: VN.app.ctx.model.meta.title }, note: 'Início do registo nesta sessão' });
      persistLedger();
    }
  }
  function persistLedger() {
    localStorage.setItem(K.ledger(dataset()), JSON.stringify({ entries: ledger.ledger.entries, head: ledger.ledger.head, createdAt: ledger.ledger.createdAt }));
  }

  function paint() {
    const body = document.getElementById('consolebody');
    if (!body) return;
    clear(body);
    const header = document.querySelector('#consolebody');
    if (tab === 'ask') body.appendChild(viewAsk());
    else if (tab === 'sources') body.appendChild(viewSources());
    else if (tab === 'evidence') body.appendChild(viewEvidence());
    else if (tab === 'real') body.appendChild(viewReal());
    else if (tab === 'agents') body.appendChild(viewAgents());
    else if (tab === 'apis') body.appendChild(viewApis());
    else if (tab === 'registro') body.appendChild(viewFontes());
    else if (tab === 'provedores') body.appendChild(viewProvedores());
    else body.appendChild(viewAI());
    // re-render tabs active state
    const chips = body.parentNode.querySelector('.chips');
    if (chips) {
      const labels = ['ask', 'sources', 'evidence', 'real', 'agents', 'apis', 'registro', 'ai'];
      Array.from(chips.children).forEach((b, i) => b.className = 'btn sm' + (labels[i] === tab ? ' primary' : ''));
    }
  }

  /* ---------------- 1. INVESTIGAR ---------------- */
  function viewAsk() {
    const wrap = el('div', {});
    wrap.appendChild(el('div', { class: 'warnbox', html:
      '<b>O objectivo não é confirmar uma suspeita: é descobrir o que é verdade.</b> ' +
      'Uma pergunta como «o que os media escondem sobre X» não é verificável. É convertida em perguntas testáveis, ' +
      'com fontes primárias, resultados negativos registados e tentativa explícita de refutação.' }));

    const q = el('textarea', { rows: 3, placeholder: 'Ex.: Que relação documentada existe entre a empresa X e o município Y no contrato de 2020? / Quem é o beneficiário efectivo da sociedade Z?', style: 'width:100%;resize:vertical' });
    const planBox = el('div', { style: 'margin-top:10px' });

    const renderPlan = (plan) => {
      lastPlan = plan;
      clear(planBox);
      planBox.appendChild(el('div', { class: 'infobox' }, [
        el('b', { text: 'Plano de investigação' }),
        el('div', { class: 'muted', style: 'font-size:11px', text: 'Classificação: ' + plan.tags.join(' · ') + ' · ' + plan.steps.length + ' fases · gerado localmente, sem IA' })
      ]));
      plan.steps.forEach((s) => planBox.appendChild(el('div', { style: 'border:1px solid var(--line2);border-radius:9px;padding:9px 11px;margin-bottom:7px' }, [
        el('div', { style: 'display:flex;gap:8px;align-items:center' }, [
          el('span', { class: 'mini', text: s.n + '' }),
          el('b', { style: 'font-size:12px;color:var(--ink)', text: s.title }),
          el('span', { class: 'tag', text: s.phase })
        ]),
        el('ul', { style: 'margin:6px 0 0;padding-left:18px;font-size:11.5px' }, s.actions.map((a) => el('li', { text: a }))),
        s.sources.length ? el('div', { class: 'srcmeta', style: 'margin-top:6px' }, s.sources.map((src) => src.url
          ? el('a', { href: src.url, target: '_blank', rel: 'noopener noreferrer', class: 'chip', text: src.name, title: src.caveat })
          : el('span', { class: 'chip', text: src.name, title: src.caveat }))) : null
      ])));
      planBox.appendChild(el('div', { class: 'block' }, [
        el('h4', { text: 'Hipóteses e teste de refutação' }),
        ...plan.hypotheses.map((h) => el('div', { class: 'li' }, [
          el('span', { class: 'mk', style: 'color:var(--accent)', text: h.id }),
          el('div', {}, [el('b', { style: 'color:var(--ink)', text: h.text }), el('div', { class: 'srcmeta', text: 'Como testar: ' + h.test })])
        ]))
      ]));
      planBox.appendChild(el('div', { class: 'block' }, [
        el('h4', { text: 'Limites' }),
        el('ul', { style: 'margin:0;padding-left:18px;font-size:11.5px' }, plan.limits.map((l) => el('li', { text: l })))
      ]));
      planBox.appendChild(el('div', { class: 'actions' }, [
        el('button', { class: 'btn sm primary', type: 'button', text: 'Enviar plano à IA (se configurada)', onclick: () => runAI(plan) }),
        el('button', { class: 'btn sm', type: 'button', text: 'Copiar prompt para usar noutra ferramenta', onclick: () => {
          const pr = VN.research.buildAIPrompt(plan.question, { plan: plan, entities: ctx.model.entities.filter((e) => plan.question.toLowerCase().includes((e.name || '').toLowerCase().split(' ')[0])).slice(0, 5) });
          D.copy(pr.system + '\n\n' + pr.user); toast('Prompt copiado — cole numa IA e traga o JSON de volta para validação');
        } }),
        el('button', { class: 'btn sm', type: 'button', text: 'Registar este plano no livro', onclick: async () => {
          await ledger.append({ type: 'plano', subject: plan.id, payload: { question: plan.question, steps: plan.steps.map((s) => s.title), tags: plan.tags }, note: 'Plano de investigação' });
          persistLedger(); toast('Plano registado no livro de provas', 'ok'); paint();
        } })
      ]));
    };

    wrap.appendChild(el('label', { class: 'inline', style: 'display:block;margin:10px 0 4px;font-weight:600;color:var(--ink)' }, ['Pergunta de investigação']));
    wrap.appendChild(q);
    wrap.appendChild(el('div', { class: 'actions' }, [
      el('button', { class: 'btn primary sm', type: 'button', text: 'Gerar plano de fontes', onclick: () => {
        const question = q.value.trim();
        if (question.length < 8) { toast('Escreva uma pergunta concreta', 'warn'); return; }
        const similar = ctx.model.entities.filter((e) => {
          const first = (e.name || '').split(' ')[0].toLowerCase();
          return first.length > 3 && question.toLowerCase().includes(first);
        }).slice(0, 6);
        renderPlan(VN.research.buildPlan(question, { entities: similar }));
      } }),
      el('button', { class: 'btn sm', type: 'button', text: 'Validar resposta JSON de uma IA', onclick: () => pasteValidation() })
    ]));
    wrap.appendChild(el('div', { style: 'margin:10px 0 0;font-size:11px;color:var(--muted)', text:
      'O planeador funciona sem IA. Se usar IA, ela recebe o contrato de evidência: sem fonte, data e excerto, a afirmação é rejeitada automaticamente.' }));
    wrap.appendChild(planBox);
    if (lastPlan) renderPlan(lastPlan);
    return wrap;
  }

  function pasteValidation() {
    const ta = el('textarea', { rows: 10, placeholder: 'Cole aqui o JSON devolvido pela IA…', style: 'width:100%;font-family:var(--mono);font-size:11px' });
    const out = el('div', { style: 'margin-top:10px' });
    const content = el('div', {}, [
      el('p', { text: 'A resposta é validada campo a campo. Afirmações sem fonte datada, confirmações sem fonte primária e linguagem de imputação são rejeitadas.' }),
      ta,
      el('div', { class: 'actions' }, [el('button', { class: 'btn primary sm', type: 'button', text: 'Validar', onclick: () => {
        const res = VN.research.validateAIResponse(ta.value);
        clear(out);
        if (res.error) { out.appendChild(el('div', { class: 'warnbox', text: res.error })); return; }
        out.appendChild(el('div', { class: res.rejected.length ? 'warnbox' : 'infobox' }, [
          el('b', { text: res.summary })
        ]));
        if (res.rejected.length) out.appendChild(el('div', {}, [
          el('h4', { class: 'muted', style: 'font-size:11px', text: 'Rejeitadas' }),
          ...res.rejected.map((r) => el('div', { class: 'li contra' }, [
            el('span', { class: 'mk', text: '✕' }),
            el('div', {}, [el('b', { style: 'color:var(--ink)', text: (r.claim.text || '').slice(0, 140) }),
              el('div', { class: 'srcmeta', text: r.reasons.join(' · ') })])
          ]))
        ]));
        if (res.accepted.length) out.appendChild(el('div', {}, [
          el('h4', { class: 'muted', style: 'font-size:11px', text: 'Aceites para registo (como alegações, não como factos)' }),
          ...res.accepted.map((c) => el('div', { style: 'border-top:1px solid var(--line);padding:7px 0' }, [
            el('b', { style: 'color:var(--ink);font-size:12px', text: c.text }),
            el('div', { class: 'srcmeta' }, (c.sources || []).map((s) => s.name + (s.date ? ' (' + s.date + ')' : '') + (s.quote ? ' — «' + s.quote.slice(0, 80) + '»' : ''))),
            el('button', { class: 'btn sm', type: 'button', text: 'Registar como alegação no livro', onclick: async () => {
              await ledger.append(VN.research.claimToLedgerEntry(c, lastPlan ? lastPlan.question : '(sem plano)'));
              persistLedger(); toast('Alegação registada com fonte — sujeita a verificação', 'ok'); tab = 'evidence'; paint();
            } })
          ]))
        ]));
      } })])
    ]);
    const m = VN.panels.modal('Validar resposta de IA', content, { wide: true });
    content.appendChild(out);
  }

  /* ---------------- 2. FONTES ---------------- */
  function viewSources() {
    const wrap = el('div', {});
    wrap.appendChild(el('p', { text: 'Directório de fontes utilizáveis no plano. Inclui o tipo de acesso e a limitação de cada uma — a limitação é parte da fonte.' }));
    const t = el('table', { class: 'listtable' }, [
      el('thead', {}, [el('tr', {}, ['Fonte', 'Acesso', 'Cobre', 'Como usar', 'Limitação'].map((h) => el('th', { text: h })))]),
      el('tbody', {}, VN.research.SOURCES.map((s) => el('tr', {}, [
        el('td', {}, [s.url ? el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.name }) : el('b', { text: s.name })]),
        el('td', {}, [el('span', { class: 'tag ' + (s.access === 'público' ? 'ok' : 'warn'), text: s.access })]),
        el('td', { text: s.covers.join(', ') }),
        el('td', { style: 'font-size:11px', text: s.hint }),
        el('td', { style: 'font-size:11px;color:var(--warn)', text: s.caveat })
      ])))
    ]);
    wrap.appendChild(t);
    wrap.appendChild(el('div', { class: 'warnbox', text: 'Nenhuma destas fontes "revela tudo". Registos públicos têm omissões e erros; o que não está publicado não prova que não exista. O livro de provas serve precisamente para documentar o que foi procurado e não encontrado.' }));
    return wrap;
  }

  /* ---------------- 2b. AGENTES DE RECOLHA ---------------- */
  const AGENT_STATUS_PT = {
    simulada: ['Simulada', 'warn'], recolhida: ['Recolhida', 'ok'], recusada: ['Recusada', 'bad'],
    'erro-http': ['Erro HTTP', 'bad'], 'erro-extracao': ['Extracção falhou', 'bad'], falhou: ['Falhou', 'bad'], pendente: ['Pendente', 'warn']
  };

  function viewAgents() {
    const wrap = el('div', {});
    wrap.appendChild(el('p', { text: 'Um agente só faz três coisas: obtém um documento de uma fonte declarada, prova o que obteve (URL final, data, estado HTTP, tipo, tamanho, SHA-256) e regista-o no livro de provas. Não escreve no grafo, não decide culpas e não faz pedidos em massa.' }));
    const guards = el('div', { class: 'warnbox', style: 'margin:8px 0' }, [
      el('b', { text: 'Guardas activas: ' }),
      el('span', { text: 'robots.txt respeitado · apenas http/https · endereços privados e de metadados recusados (SSRF) · ' +
        'máximo ' + VN.agents.LIMITS.maxRequestsPerRun + ' pedidos por execução · intervalo mínimo ' + VN.agents.LIMITS.minIntervalMs + ' ms por servidor · ' +
        'limite de ' + Math.round(VN.agents.LIMITS.maxBytes / 1024) + ' kB e ' + Math.round(VN.agents.LIMITS.timeoutMs / 1000) + ' s por resposta · ' +
        'user-agent identificado · sem credenciais guardadas · nenhum resultado entra automaticamente no grafo.' })
    ]);
    wrap.appendChild(guards);

    if (!agentTasks) agentTasks = VN.agents.exampleTasks().map((t) => Object.assign({ on: true }, t));
    const box = el('div', {});
    const head = el('div', { class: 'chips' }, [
      el('button', {
        class: 'btn sm' + (agentLive ? '' : ' primary'), type: 'button', text: 'Simulação (recomendado)',
        onclick: () => { agentLive = false; paint(); }
      }),
      el('button', {
        class: 'btn sm' + (agentLive ? ' danger' : ''), type: 'button', text: 'Execução real',
        onclick: () => { agentLive = true; paint(); }
      })
    ]);
    box.appendChild(head);
    box.appendChild(el('label', { style: 'display:flex;gap:6px;align-items:center;font-size:11px;margin:6px 0;color:var(--muted)' }, [
      el('input', { type: 'checkbox', checked: agentProxy ? 'checked' : null, onchange: (e) => { agentProxy = e.target.checked; paint(); } }),
      el('span', { text: 'Usar agente local (/api/fetch) — recomendado: lê robots.txt e contorna a falta de CORS, com as mesmas guardas e hash verificado dos dois lados' })
    ]));
    box.appendChild(el('p', { style: 'font-size:11px;color:var(--muted);margin:6px 0', text: agentLive
      ? 'Execução real: os pedidos saem deste navegador para os domínios indicados. Substitua os marcadores INSERIR-… por valores concretos e verifique os termos de utilização de cada fonte.'
      : 'Simulação: nada sai da máquina — nem sequer o robots.txt. É apresentado o plano de cada pedido (robots.txt a verificar, guarda SSRF, limites, hash) e a tentativa fica registada no livro de provas.' }));

    const rows = agentTasks.map((t, i) => {
      const url = el('input', { class: 'input', value: t.url, style: 'min-width:340px', oninput: (e) => { t.url = e.target.value; } });
      return el('tr', {}, [
        el('td', {}, [el('input', { type: 'checkbox', checked: t.on ? 'checked' : null, onchange: (e) => { t.on = e.target.checked; } })]),
        el('td', { style: 'font-size:11px' }, [el('b', { text: t.label }), el('div', { style: 'color:var(--muted)', text: t.note || '' })]),
        el('td', {}, [url]),
        el('td', {}, [el('span', { class: 'tag', text: t.extract ? t.extract.type : 'nenhum' })])
      ]);
    });
    box.appendChild(el('table', { class: 'listtable' }, [
      el('thead', {}, [el('tr', {}, ['', 'Tarefa', 'URL', 'Extracção'].map((h) => el('th', { text: h })))]),
      el('tbody', {}, rows)
    ]));

    const runBtn = el('button', {
      class: 'btn primary', type: 'button', disabled: agentBusy ? 'disabled' : null,
      text: agentBusy ? 'A executar…' : (agentLive ? 'Executar pedidos reais' : 'Simular recolha'),
      onclick: async () => {
        const chosen = agentTasks.filter((t) => t.on);
        if (!chosen.length) return toast('Seleccione pelo menos uma tarefa', 'warn');
        if (agentLive && !confirm('Executar ' + chosen.length + ' pedido(s) reais para os domínios indicados?')) return;
        agentBusy = true; paint();
        try {
          await initLedger();
          const runner = VN.agents.createRunner({
            ledger: ledger,
            transport: agentProxy ? 'proxy' : 'direct',
            proxyUrl: agentProxy ? new URL('api/fetch', location.href).href : null
          });
          agentResult = await runner.run(chosen, { dryRun: !agentLive });
          persistLedger();
          toast(agentLive ? 'Recolha registada no livro de provas' : 'Simulação concluída — nada foi pedido', 'ok');
        } catch (e) { toast('Falhou: ' + e.message, 'bad'); }
        agentBusy = false; paint();
      }
    });
    box.appendChild(el('div', { class: 'chips', style: 'margin-top:8px' }, [
      runBtn,
      el('button', { class: 'btn sm', type: 'button', text: 'Repor tarefas de exemplo', onclick: () => { agentTasks = null; agentResult = null; paint(); } })
    ]));

    if (agentResult) {
      const s = agentResult.summary;
      box.appendChild(el('div', { class: 'statline', style: 'margin-top:10px' }, [
        el('b', { text: s.total + ' tarefa(s): ' }),
        el('span', { text: s.recolhidas + ' recolhidas · ' + s.simuladas + ' simuladas · ' + s.recusadas + ' recusadas · ' + s.falhas + ' falhas' })
      ]));
      box.appendChild(el('table', { class: 'listtable' }, [
        el('thead', {}, [el('tr', {}, ['Tarefa', 'Estado', 'HTTP', 'Tamanho', 'SHA-256', 'Extracção / erro'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, agentResult.results.map((r) => {
          const [label, cls] = AGENT_STATUS_PT[r.status] || [r.status, 'warn'];
          const ev = r.evidence || {};
          const ext = r.extraction ? JSON.stringify(r.extraction).slice(0, 150) : (r.error || (r.plan ? 'plano: ' + r.plan.method + ' ' + r.plan.url : ''));
          return el('tr', {}, [
            el('td', { style: 'font-size:11px' }, [el('b', { text: r.label }), el('div', { style: 'color:var(--muted)', text: r.source + (r.viaProxy ? ' · agente local' : '') })]),
            el('td', {}, [el('span', { class: 'tag ' + cls, text: label })]),
            el('td', { text: ev.httpStatus == null ? '—' : String(ev.httpStatus) }),
            el('td', { text: ev.contentLength == null ? '—' : Math.round(ev.contentLength / 1024) + ' kB' }),
            el('td', { style: 'font-family:monospace;font-size:10px' }, [
              ev.sha256 ? el('span', { title: ev.sha256, text: ev.sha256.slice(0, 16) + '…' }) : el('span', { text: '—' }),
              ev.sha256Agrees === true ? el('div', { class: 'tag ok', style: 'margin-top:2px', text: 'hash confirmado' }) :
                ev.sha256Agrees === false ? el('div', { class: 'tag bad', style: 'margin-top:2px', text: 'hash diverge' }) : null
            ]),
            el('td', { style: 'font-size:10px;max-width:340px;word-break:break-word' }, [el('span', { text: ext })])
          ]);
        }))
      ]));
      const okEv = agentResult.results.filter((r) => r.evidence && r.evidence.url);
      if (okEv.length) {
        box.appendChild(el('div', { class: 'chips', style: 'margin-top:8px' }, [
          el('button', {
            class: 'btn sm', type: 'button', text: 'Exportar prova de recolha (JSON)',
            onclick: () => D.download('recolha-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({
              generatedAt: new Date().toISOString(), dryRun: !agentLive, guards: VN.agents.LIMITS,
              note: 'Evidência de obtenção documental. Nenhum item foi inserido no grafo.',
              results: agentResult.results.map((r) => { const c = Object.assign({}, r); delete c.bodyText; if (c.evidence) { const e = Object.assign({}, c.evidence); delete e.bodyText; c.evidence = e; } return c; })
            }, null, 2), 'application/json')
          }),
          el('button', { class: 'btn sm', type: 'button', text: 'Ver no livro de provas', onclick: () => { tab = 'evidence'; paint(); } })
        ]));
      }
      box.appendChild(el('div', { class: 'warnbox', text: 'Um documento obtido não é uma relação. Para que qualquer dado entre no grafo é preciso: fonte identificada, excerto, data, estado de verificação e revisão humana no separador «Livro de provas» ou «Dados reais».' }));
    }
    wrap.appendChild(box);
    return wrap;
  }

  /* ---------------- 2c. APIs EXTERNAS ---------------- */
  let apisNode = null;
  function viewApis() {
    if (!apisNode) {
      apisNode = VN.apisUI.mount({
        D: D, el: el, toast: toast,
        ledgerWrapper: () => ({
          append: async (entry) => { await initLedger(); await ledger.append(entry); persistLedger(); }
        }),
        appendLedger: async (entry) => { await initLedger(); await ledger.append(entry); persistLedger(); }
      });
    }
    return apisNode;
  }

  /* ------------- 2b. REGISTO DE FONTES (servidor) ------------- */
  let fontesNode = null;
  function viewFontes() {
    if (!fontesNode) {
      /* a API da consola usa o mesmo `api()` de sempre (CSRF incluído) mas aqui
         precisamos de devolver estado HTTP, para distinguir «recusado» de
         «sem rede» — por isso o envelope é explícito. */
      const call = async (path, opts) => {
        opts = opts || {};
        const headers = { accept: 'application/json' };
        if (opts.body !== undefined) headers['content-type'] = 'application/json';
        const csrf = document.cookie.split('; ').find((c) => c.startsWith('vn_csrf='));
        if (csrf && (opts.method || 'GET') !== 'GET') headers['x-csrf-token'] = decodeURIComponent(csrf.split('=')[1]);
        const res = await fetch(new URL(path.replace(/^\//, ''), location.href).href, {
          method: opts.method || 'GET', headers, credentials: 'same-origin',
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
        }).catch(() => null);
        if (!res) return { ok: false, status: 0, json: null, error: { message: 'servidor inacessível' } };
        const json = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, json, error: json && json.error };
      };
      fontesNode = VN.fontesUI.mount({ el: el, clear: clear, toast: toast, api: call });
    }
    return fontesNode;
  }

  /* ------------- 2c. FORNECEDORES DE IA (Provider OS) ------------- */
  let provedoresNode = null;
  function viewProvedores() {
    if (!provedoresNode) {
      /* mesma chamada com estado HTTP explícito usada no registo de fontes:
         «recusado» e «sem rede» não podem ser a mesma mensagem */
      const call = async (path, opts) => {
        opts = opts || {};
        const headers = { accept: 'application/json' };
        if (opts.body !== undefined) headers['content-type'] = 'application/json';
        const csrf = document.cookie.split('; ').find((c) => c.startsWith('vn_csrf='));
        if (csrf && (opts.method || 'GET') !== 'GET') headers['x-csrf-token'] = decodeURIComponent(csrf.split('=')[1]);
        const res = await fetch(new URL(path.replace(/^\//, ''), location.href).href, {
          method: opts.method || 'GET', headers, credentials: 'same-origin',
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
        }).catch(() => null);
        if (!res) return { ok: false, status: 0, json: null, error: { message: 'servidor inacessível' } };
        const json = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, json, error: json && json.error };
      };
      provedoresNode = VN.provedoresUI.mount({ el: el, clear: clear, toast: toast, api: call });
    }
    return provedoresNode;
  }

  /* ---------------- 3. LIVRO DE PROVAS ---------------- */
  function viewEvidence() {
    const wrap = el('div', {});
    wrap.appendChild(el('p', { text: 'Registo append-only com hash encadeado. Alterar uma entrada antiga quebra a cadeia e é detectado na verificação.' }));
    const entries = ledger.ledger.entries.slice().reverse();
    wrap.appendChild(el('div', { class: 'actions' }, [
      el('button', { class: 'btn sm primary', type: 'button', text: 'Verificar integridade', onclick: async () => {
        const v = await ledger.verify();
        toast(v.ok ? 'Integridade confirmada: ' + v.entries + ' entradas, cadeia intacta' : 'FALHA de integridade em ' + v.problems.length + ' entrada(s)', v.ok ? 'ok' : 'bad', 6000);
        paint();
      } }),
      el('button', { class: 'btn sm', type: 'button', text: 'Exportar livro (JSON)', onclick: () => {
        D.download('livro-de-provas-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(ledger.ledger, null, 2), 'application/json');
      } }),
      el('button', { class: 'btn sm', type: 'button', text: 'Registar resultado negativo', onclick: () => negativeDialog() }),
      el('button', { class: 'btn sm', type: 'button', text: 'Registar verificação manual', onclick: () => manualDialog() })
    ]));
    if (!entries.length) { wrap.appendChild(el('div', { class: 'empty', text: 'Livro vazio.' })); return wrap; }
    wrap.appendChild(el('table', { class: 'listtable' }, [
      el('thead', {}, [el('tr', {}, ['#', 'Data', 'Tipo', 'Assunto', 'Conteúdo', 'Hash'].map((h) => el('th', { text: h })))]),
      el('tbody', {}, entries.map((e) => el('tr', {}, [
        el('td', { class: 'mono', text: String(e.n) }),
        el('td', { style: 'white-space:nowrap;font-size:10.5px', text: new Date(e.at).toLocaleString('pt-PT') }),
        el('td', {}, [el('span', { class: 'tag ' + (e.type === 'refutacao' ? 'bad' : e.type === 'verificacao' ? 'ok' : ''), text: e.type })]),
        el('td', { class: 'mono', text: e.subject || '—' }),
        el('td', { style: 'font-size:11px;max-width:420px' }, [
          el('div', { text: e.payload && e.payload.question ? 'P: ' + e.payload.question : (e.payload && e.payload.text ? e.payload.text : (e.note || '')) }),
          e.payload && e.payload.sources ? el('div', { class: 'srcmeta' }, e.payload.sources.map((s) => s.name + (s.date ? ' · ' + s.date : ''))) : null,
          e.payload && e.payload.source ? el('div', { class: 'srcmeta', text: e.payload.source + (e.payload.query ? ' · termos: ' + e.payload.query : '') + (e.payload.result ? ' · ' + e.payload.result : '') }) : null
        ]),
        el('td', { class: 'mono', style: 'font-size:9.5px', text: (e.hash || '').slice(0, 12) + '…' })
      ])))
    ]));
    return wrap;
  }

  function negativeDialog() {
    const src = el('input', { type: 'text', placeholder: 'Fonte consultada (ex.: Portal BASE)' });
    const q = el('input', { type: 'text', placeholder: 'Termos exactos usados na pesquisa' });
    const res = el('select', {}, [
      el('option', { value: 'nao_encontrado', text: 'não encontrado' }),
      el('option', { value: 'sem_acesso', text: 'sem acesso (restrito/pago)' }),
      el('option', { value: 'nao_publicado', text: 'não publicado' })
    ]);
    const note = el('input', { type: 'text', placeholder: 'Observações (opcional)' });
    const content = el('div', {}, [
      el('div', { class: 'warnbox', text: 'Registar o que não se encontrou é uma prova de diligência. Nunca escreva «não existe»: escreva «não encontrado em <fonte> em <data>».' }),
      el('p', {}, [el('b', { text: 'Fonte' }), src]),
      el('p', {}, [el('b', { text: 'Termos' }), q]),
      el('p', {}, [el('b', { text: 'Resultado' }), res]),
      el('p', {}, [el('b', { text: 'Observações' }), note]),
      el('button', { class: 'btn primary sm', type: 'button', text: 'Registar', onclick: async () => {
        if (!src.value.trim() || !q.value.trim()) { toast('Indique a fonte e os termos', 'warn'); return; }
        await ledger.append({ type: 'resultado_negativo', payload: { source: src.value.trim(), query: q.value.trim(), result: res.value, observedAt: new Date().toISOString().slice(0, 10) }, note: note.value });
        persistLedger(); document.getElementById('modal').hidden = true; toast('Resultado negativo registado com data', 'ok'); open();
      } })
    ]);
    VN.panels.modal('Registar resultado negativo', content);
  }

  function manualDialog() {
    const subj = el('input', { type: 'text', placeholder: 'ID da relação ou entidade (ex.: R-014)' });
    const quote = el('input', { type: 'text', placeholder: 'Excerto literal verificado' });
    const url = el('input', { type: 'url', placeholder: 'URL da fonte (se aplicável)' });
    const status = el('select', {}, [
      el('option', { value: 'confirmado', text: 'confirmado por fonte primária' }),
      el('option', { value: 'refutado', text: 'refutado por documento posterior' }),
      el('option', { value: 'parcial', text: 'parcialmente correcto' })
    ]);
    const content = el('div', {}, [
      el('p', { text: 'Registo humano de verificação. Este é o único caminho para elevar uma relação a «confirmada» — e fica datado no livro.' }),
      el('p', {}, [el('b', { text: 'Assunto' }), subj]),
      el('p', {}, [el('b', { text: 'Excerto' }), quote]),
      el('p', {}, [el('b', { text: 'URL' }), url]),
      el('p', {}, [el('b', { text: 'Conclusão' }), status]),
      el('button', { class: 'btn primary sm', type: 'button', text: 'Registar verificação', onclick: async () => {
        if (!subj.value.trim() || !quote.value.trim()) { toast('Assunto e excerto são obrigatórios', 'warn'); return; }
        await ledger.append({ type: 'verificacao', subject: subj.value.trim(), payload: { source: url.value || null, quote: quote.value, status: status.value, verifiedAt: new Date().toISOString().slice(0, 10) }, note: 'Verificação humana' });
        persistLedger(); document.getElementById('modal').hidden = true; toast('Verificação registada e datada', 'ok'); open();
      } })
    ]);
    VN.panels.modal('Registar verificação humana', content);
  }

  /* ---------------- 4. DADOS REAIS ---------------- */
  function viewReal() {
    const wrap = el('div', {});
    const active = dataset();
    const sessao = active === 'real' ? 'lote importado nesta sessão' : 'conjunto incluído (importação verificada)';
    wrap.appendChild(el('div', { class: 'infobox', html:
      '<b>Conjunto activo: ' + sessao + '</b><br>' +
      'Cada relação tem fonte, excerto literal e data de recolha; os documentos têm hash. ' +
      'Não há dados de demonstração inventados: se um nome aqui aparece, aparece num documento citável. ' +
      'Relações não verificadas continuam assinaladas e nada é promovido a «confirmado» sem revisão humana.' }));

    const file = el('input', { type: 'file', accept: '.json,application/json' });
    const out = el('div', { style: 'margin-top:10px' });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const text = await f.text();
      let obj;
      try { obj = JSON.parse(text); } catch (e) { clear(out); out.appendChild(el('div', { class: 'warnbox', text: 'JSON inválido: ' + e.message })); return; }
      const v = VN.realdata.validateBundle(obj);
      lastValidation = v;
      clear(out);
      out.appendChild(el('div', { class: v.ok ? 'infobox' : 'warnbox' }, [
        el('b', { text: v.ok ? 'Validação aprovada — ' + v.stats.entities + ' entidades, ' + v.stats.relations + ' relações (' + v.stats.withExcerpt + ' com excerto)' : 'Importação recusada: ' + v.errors.length + ' erro(s) de proveniência' }),
        el('div', { style: 'font-size:11px;margin-top:4px', text: v.ok ? 'Pode carregar este conjunto. Relações confirmadas exigem revisor, método e data.' : 'Corrija os erros abaixo. Sem eles, o grafo estaria a afirmar coisas sem prova.' })
      ]));
      if (v.errors.length) out.appendChild(el('div', {}, [el('h4', { class: 'muted', style: 'font-size:11px', text: 'Erros' }),
        el('ul', { style: 'font-size:11px;color:#fda4af' }, v.errors.slice(0, 40).map((e) => el('li', { text: e.msg })))]));
      if (v.warnings.length) out.appendChild(el('div', {}, [el('h4', { class: 'muted', style: 'font-size:11px', text: 'Avisos' }),
        el('ul', { style: 'font-size:11px;color:#fcd34d' }, v.warnings.slice(0, 40).map((e) => el('li', { text: e.msg })))]));
      if (v.ok) {
        out.appendChild(el('div', { class: 'actions' }, [
          el('button', { class: 'btn primary sm', type: 'button', text: 'Carregar este conjunto real', onclick: () => {
            localStorage.setItem(K.bundle, JSON.stringify(VN.realdata.toModel(obj)));
            localStorage.setItem(K.dataset, 'real');
            toast('Conjunto real validado e guardado. A recarregar…', 'ok');
            setTimeout(() => location.reload(), 700);
          } }),
          el('button', { class: 'btn sm', type: 'button', text: 'Só pré-visualizar (não substituir)', onclick: () => toast('Pré-visualização não implementada: valide e depois carregue', 'warn') })
        ]));
      }
    });

    wrap.appendChild(el('h3', { style: 'font-size:12px;margin:12px 0 6px', text: '1. Importar um conjunto validado (JSON)' }));
    wrap.appendChild(file);
    wrap.appendChild(out);

    wrap.appendChild(el('h3', { style: 'font-size:12px;margin:16px 0 6px', text: '2. Regras que a importação aplica' }));
    wrap.appendChild(el('ul', { style: 'font-size:11.5px' }, [
      el('li', { text: 'Toda a relação precisa de documento-fonte, excerto literal, estado e data de verificação.' }),
      el('li', { text: 'Estado «confirmado» exige revisor humano identificado, método e data. Fonte jornalística não confirma.' }),
      el('li', { text: 'Documentos exigem URL ou referência de arquivo, data de recolha e hash do excerto.' }),
      el('li', { text: 'Pessoas e organizações exigem identificador de desambiguação (registo, ano de nascimento, NIF com hash) para evitar homónimos.' }),
      el('li', { text: 'Imagens exigem crédito, licença e origem; caso contrário é usado avatar procedimental.' }),
      el('li', { text: 'Lotes que se declaram fictícios (`meta.fictional: true`) são recusados: o produto não aceita mundos inventados.' })
    ]));

    wrap.appendChild(el('h3', { style: 'font-size:12px;margin:16px 0 6px', text: '3. Ferramentas' }));
    wrap.appendChild(el('div', { class: 'actions' }, [
      el('button', { class: 'btn sm', type: 'button', text: 'Descarregar esqueleto JSON', onclick: () => {
        D.download('esqueleto-dados-reais.json', JSON.stringify(VN.realdata.skeleton(), null, 2), 'application/json');
      } }),
      el('button', { class: 'btn sm', type: 'button', text: 'Descarregar esquema documentado', onclick: () => {
        D.download('esquema-dados-reais.json', JSON.stringify(VN.realdata.SCHEMA_DOC, null, 2), 'application/json');
      } }),
      active === 'real' ? el('button', { class: 'btn sm danger', type: 'button', text: 'Voltar ao conjunto incluído', onclick: () => {
        localStorage.removeItem(K.dataset);
        localStorage.removeItem('vn-real-bundle');
        toast('A voltar ao conjunto incluído (importação verificada)…');
        setTimeout(() => location.reload(), 600);
      } }) : null
    ]));

    wrap.appendChild(el('h3', { style: 'font-size:12px;margin:16px 0 6px', text: '4. O que este sistema não faz' }));
    wrap.appendChild(el('div', { class: 'warnbox', html:
      'Não descobre factos por si. Não acede a bases privadas. Não transforma rumores em acusações. ' +
      'Não afirma que alguém é culpado. Não substitui jornalismo, advogados, revisores de contas ou o Ministério Público.<br><br>' +
      'O que faz: organizar provas, mostrar o que está e não está documentado, detectar contradições, impedir que alegações se tornem factos por repetição, ' +
      'e deixar um rasto auditável de tudo o que foi consultado — incluindo o que não foi encontrado.' }));
    return wrap;
  }

  /* ---------------- 5. IA ---------------- */
  function aiConfig() {
    try { return JSON.parse(localStorage.getItem(K.ai) || '{}'); } catch (e) { return {}; }
  }

  function viewAI() {
    const cfg = aiConfig();
    const wrap = el('div', {});
    wrap.appendChild(el('div', { class: 'warnbox', html:
      '<b>Antes de ligar uma IA:</b> qualquer texto que enviar sai deste dispositivo para o fornecedor que configurar. ' +
      'Não envie dados pessoais sensíveis, fontes protegidas nem material sob segredo de justiça. ' +
      'A IA não tem autoridade sobre o grafo: tudo o que devolve entra como alegação, com fonte, e é validado campo a campo.' }));

    const endpoint = el('input', { type: 'url', value: cfg.endpoint || '', placeholder: 'https://api.openai.com/v1/chat/completions (ou compatível)' });
    const model = el('input', { type: 'text', value: cfg.model || '', placeholder: 'nome do modelo' });
    const key = el('input', { type: 'password', value: cfg.key || '', placeholder: 'chave de API (fica apenas neste navegador)' });

    wrap.appendChild(el('p', {}, [el('b', { text: 'Endpoint compatível com OpenAI ' }), el('span', { class: 'muted', text: '(POST /chat/completions)' }), endpoint]));
    wrap.appendChild(el('p', {}, [el('b', { text: 'Modelo ' }), model]));
    wrap.appendChild(el('p', {}, [el('b', { text: 'Chave ' }), key]));
    wrap.appendChild(el('div', { class: 'actions' }, [
      el('button', { class: 'btn primary sm', type: 'button', text: 'Guardar', onclick: () => {
        localStorage.setItem(K.ai, JSON.stringify({ endpoint: endpoint.value.trim(), model: model.value.trim(), key: key.value }));
        toast('Configuração guardada localmente', 'ok');
      } }),
      el('button', { class: 'btn sm danger', type: 'button', text: 'Apagar chave', onclick: () => {
        localStorage.removeItem(K.ai); toast('Chave apagada'); paint();
      } }),
      el('button', { class: 'btn sm', type: 'button', text: 'Testar ligação', onclick: () => testAI() })
    ]));

    wrap.appendChild(el('h3', { style: 'font-size:12px;margin:16px 0 6px', text: 'Contrato de evidência imposto à IA' }));
    wrap.appendChild(el('pre', { style: 'white-space:pre-wrap;font-size:10.5px;background:var(--bg2);border:1px solid var(--line2);border-radius:9px;padding:10px;max-height:240px;overflow:auto', text: VN.research.AI_SYSTEM }));

    wrap.appendChild(el('h3', { style: 'font-size:12px;margin:16px 0 6px', text: 'Sem chave? Use o modo manual' }));
    wrap.appendChild(el('p', { style: 'font-size:11.5px', text: 'Em «Investigar» pode copiar o prompt e usá-lo em qualquer assistente. Depois cole a resposta JSON em «Validar resposta de uma IA»: o validador rejeita afirmações sem fonte, confirmações sem fonte primária e linguagem de imputação.' }));
    return wrap;
  }

  async function testAI() {
    const cfg = aiConfig();
    if (!cfg.endpoint) { toast('Configure o endpoint primeiro', 'warn'); return; }
    try {
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: Object.assign({ 'content-type': 'application/json' }, cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}),
        body: JSON.stringify({ model: cfg.model || undefined, temperature: 0, max_tokens: 24, messages: [{ role: 'user', content: 'Responda apenas: ok' }] })
      });
      toast(res.ok ? 'Ligação estabelecida (HTTP ' + res.status + ')' : 'Servidor respondeu ' + res.status, res.ok ? 'ok' : 'bad', 5000);
    } catch (e) {
      toast('Falha de rede/CORS: ' + e.message + '. Se a API não permitir pedidos do browser, use o modo manual (copiar prompt / colar resposta).', 'bad', 8000);
    }
  }

  async function runAI(plan) {
    const cfg = aiConfig();
    state_lastPrompt = VN.research.buildAIPrompt(plan.question, { plan: plan, entities: ctx.model.entities.slice(0, 8) });
    if (!cfg.endpoint) {
      D.copy(state_lastPrompt.system + '\n\n' + state_lastPrompt.user);
      toast('Sem endpoint configurado: prompt copiado. Use numa IA e cole a resposta em «Validar resposta de uma IA».', 'warn', 7000);
      return;
    }
    const consent = confirm('Enviar a pergunta e o contexto desta sessão para ' + cfg.endpoint + '?\n\nNada é enviado sem este consentimento. A resposta será tratada como alegação até verificação humana.');
    if (!consent) return;
    toast('A contactar o modelo…');
    try {
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: Object.assign({ 'content-type': 'application/json' }, cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}),
        body: JSON.stringify({
          model: cfg.model || undefined, temperature: 0.1,
          messages: [{ role: 'system', content: state_lastPrompt.system }, { role: 'user', content: state_lastPrompt.user }],
          response_format: { type: 'json_object' }
        })
      });
      const json = await res.json();
      const text = (((json.choices || [])[0] || {}).message || {}).content || JSON.stringify(json);
      const v = VN.research.validateAIResponse(text);
      await ledger.append({ type: 'resposta_ia', subject: plan.id, payload: { endpoint: cfg.endpoint, model: cfg.model || null, accepted: v.accepted ? v.accepted.length : 0, rejected: v.rejected ? v.rejected.length : 0, raw: text.slice(0, 8000) }, note: 'Resposta de IA validada automaticamente' });
      persistLedger();
      if (v.error) { toast('Resposta inválida: ' + v.error, 'bad'); return; }
      const box = el('div', {}, [
        el('div', { class: v.rejected.length ? 'warnbox' : 'infobox', text: v.summary }),
        ...(v.accepted || []).map((c) => el('div', { style: 'border-top:1px solid var(--line);padding:8px 0' }, [
          el('b', { style: 'color:var(--ink);font-size:12px', text: c.text }),
          el('div', { class: 'srcmeta' }, (c.sources || []).map((s) => s.name + (s.date ? ' · ' + s.date : '') + (s.quote ? ' — «' + s.quote.slice(0, 90) + '»' : ''))),
          el('button', { class: 'btn sm', type: 'button', text: 'Registar como alegação', onclick: async () => {
            await ledger.append(VN.research.claimToLedgerEntry(c, plan.question)); persistLedger(); toast('Registada', 'ok');
          } })
        ])),
        ...(v.rejected || []).map((r) => el('div', { class: 'li contra' }, [el('span', { class: 'mk', text: '✕' }),
          el('div', {}, [el('b', { style: 'color:var(--ink)', text: (r.claim.text || '').slice(0, 160) }), el('div', { class: 'srcmeta', text: r.reasons.join(' · ') })])]))
      ]);
      VN.panels.modal('Resposta da IA — validada', box, { wide: true });
    } catch (e) {
      toast('Falha ao contactar o modelo: ' + e.message + '. Use o modo manual.', 'bad', 8000);
    }
  }
  let state_lastPrompt = null;

  VN.console = { open, dataset };
})(typeof window !== 'undefined' ? window : globalThis);
