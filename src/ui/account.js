/* =====================================================================
   CONTA, PROJECTOS, CHAVES DE IA E ADMINISTRAÇÃO (interface)
   Todo o controlo de acesso é do servidor; esta camada só esconde o que
   não interessa mostrar. Um 403 do servidor é sempre respeitado.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const el = (tag, attrs, kids) => VN.dom.el(tag, attrs, kids || []);
  const clear = (n) => { while (n && n.firstChild) n.removeChild(n.firstChild); };

  const DRAFT = { auth: {}, project: {}, key: {}, password: {} };   // valores sobrevivem a repintagens
  let S = {
    me: null, csrf: null, tab: 'account', projects: [], meta: null,
    providers: [], metrics: null, users: [], audit: [], sessions: [], msg: null, busy: false,
    detail: null,           // projecto aberto: { project, evidence, claims, runs }
    report: null            // relatório de 18 secções aberto
  };

  async function api(path, opts) {
    opts = opts || {};
    const headers = { 'accept': 'application/json' };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (S.csrf && opts.method && opts.method !== 'GET') headers['x-csrf-token'] = S.csrf;
    const res = await fetch(new URL(path.replace(/^\//, ''), location.href).href, {
      method: opts.method || 'GET', headers, credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    }).catch(() => null);
    if (!res) return { status: 0, error: { message: 'servidor inacessível' } };
    const json = await res.json().catch(() => ({}));
    if (json && json.csrf) S.csrf = json.csrf;
    return { status: res.status, ok: res.ok, json, error: json && json.error };
  }

  /* Mensagens sem repintar a área toda: um clique durante uma repintagem perdia-se. */
  function note(text, cls) {
    S.msg = { text, cls: cls || 'warn' };
    const box = document.getElementById('accmsg');
    if (box) { box.textContent = text; box.style.display = 'block'; return; }
    paint();
  }

  /* ---------------- arranque ---------------- */
  /* Contador de geração: uma resposta antiga (de antes de sair ou de trocar de conta)
     nunca pode sobrepor-se ao estado novo. Sem isto, um refresh lento de um utilizador
     anterior repintava a lista de projectos do anterior por cima da sessão actual. */
  let gen = 0;
  async function refresh() {
    const my = ++gen;
    const [me, meta] = await Promise.all([api('/api/auth/me'), api('/api/meta')]);
    if (my !== gen) return;                    // chegou tarde: deita-se fora
    S.me = (me.json && me.json.user) || null;
    S.csrf = (me.json && me.json.csrf) || S.csrf;
    S.meta = meta.json || null;
    if (S.me) {
      const pr = await api('/api/projects');
      if (my !== gen) return;
      if (pr.ok) S.projects = pr.json.projects;
      else S.projects = [];
      const pv = await api('/api/providers');
      if (pv.ok) S.providers = pv.json.providers;
      const se = await api('/api/auth/sessions');
      if (se.ok) S.sessions = se.json.sessions;
      if (S.me.role === 'ADMIN') {
        const [m, u, a] = await Promise.all([api('/api/admin/metrics'), api('/api/admin/users'), api('/api/admin/audit?limit=60')]);
        if (m.ok) S.metrics = m.json;
        if (u.ok) S.users = u.json.users;
        if (a.ok) S.audit = a.json.events;
      }
    } else {
      S.projects = []; S.providers = []; S.sessions = []; S.metrics = null; S.users = []; S.audit = [];
      S.detail = null;
    }
    if (my !== gen) return;
    paint();
  }

  /* ---------------- pintura ---------------- */
  /* Uma falha ao desenhar o painel nunca deixa a área em branco nem engole o erro:
     mostra-o (sem dados privados) e registra-o na consola. */
  function paint() {
    const root = document.getElementById('accroot');
    if (!root) return;
    try { paintInto(root); }
    catch (e) {
      clear(root);
      root.appendChild(el('div', { class: 'warnbox', text: 'Falha ao desenhar esta área: ' + e.message + '. O resto da aplicação continua a funcionar.' }));
      if (typeof console !== 'undefined') console.error('[conta]', e);
    }
  }

  function paintInto(root) {
    clear(root);

    if (!S.meta) {
      root.appendChild(el('div', { class: 'warnbox', text: 'Servidor de contas inacessível. A aplicação continua a funcionar apenas no navegador; contas, projectos e chaves de IA precisam do servidor.' }));
      return;
    }
    root.appendChild(el('div', {
      id: 'accmsg', class: 'warnbox',
      style: 'margin-bottom:8px' + (S.msg ? '' : ';display:none'),
      text: S.msg ? S.msg.text : ''
    }));

    if (!S.me) return paintAuth(root);

    const tabs = [['account', 'Conta'], ['projects', 'Projectos'], ['keys', 'Chaves de IA']];
    if (S.me.role === 'ADMIN') tabs.push(['admin', 'Administração']);
    const chips = el('div', { class: 'chips' }, tabs.map(([id, label]) => el('button', {
      class: 'btn sm' + (S.tab === id ? ' primary' : ''), type: 'button', text: label,
      onclick: () => { S.tab = id; S.msg = null; paint(); }
    })));
    root.appendChild(el('div', { class: 'statline', style: 'margin-bottom:6px' }, [
      el('b', { text: S.me.email }),
      el('span', { class: 'tag ' + (S.me.role === 'ADMIN' ? 'warn' : 'muted'), style: 'margin-left:8px', text: S.me.role }),
      el('button', {
        id: 'btnLogout', class: 'btn sm', style: 'margin-left:auto', type: 'button', text: 'Terminar sessão',
        onclick: async () => { await api('/api/auth/logout', { method: 'POST', body: {} }); S.me = null; S.tab = 'account'; S.msg = null; S.authMode = 'login'; refresh(); }
      })
    ]));
    root.appendChild(chips);
    const body = el('div', { style: 'margin-top:10px' });
    if (S.tab === 'account') paintAccount(body);
    else if (S.tab === 'projects') paintProjects(body);
    else if (S.tab === 'keys') paintKeys(body);
    else paintAdmin(body);
    root.appendChild(body);
  }

  function field(label, attrs) {
    return el('label', { style: 'display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--muted);margin:4px 0' }, [
      el('span', { text: label }), el('input', Object.assign({ class: 'input', style: 'min-width:240px' }, attrs || {}))
    ]);
  }

  function paintAuth(root) {
    if (S.authMode === 'register') {
      const f = DRAFT.auth;
      root.appendChild(el('p', { text: 'Criar conta. Os dados ficam no servidor da aplicação; a política de privacidade explica o que é guardado e quem pode consultar.' }));
      root.appendChild(field('Email', { type: 'email', oninput: (e) => { f.email = e.target.value; } }));
      root.appendChild(field('Palavra-passe (10+, maiúscula, minúscula, dígito)', { type: 'password', value: f.password || '', oninput: (e) => { f.password = e.target.value; } }));
      root.appendChild(el('label', { style: 'display:flex;gap:6px;font-size:11px;margin:6px 0' }, [
        el('input', { type: 'checkbox', onchange: (e) => { f.terms = e.target.checked; } }),
        el('span', { text: 'Aceito a política de privacidade e compreendo que os administradores podem consultar as minhas pesquisas para fins de suporte e segurança (acesso registado em auditoria).' })
      ]));
      root.appendChild(el('div', { class: 'chips' }, [
        el('button', {
          class: 'btn primary sm', type: 'button', text: 'Criar conta',
          onclick: async () => {
            const r = await api('/api/auth/register', { method: 'POST', body: { email: f.email, password: f.password, acceptTerms: f.terms === true } });
            if (!r.ok) return note('Não foi possível: ' + r.error.message, 'bad');
            await refresh();
          }
        }),
        el('button', { class: 'btn sm', type: 'button', text: 'Já tenho conta', onclick: () => { S.authMode = 'login'; paint(); } })
      ]));
      return;
    }
    const f = DRAFT.auth;
    root.appendChild(el('p', { text: 'Entrar. Sem conta, os dados de investigação continuam a viver apenas neste navegador; com conta passam a estar associados ao utilizador e isolados de outros.' }));
    root.appendChild(field('Email', { type: 'email', value: f.email || '', oninput: (e) => { f.email = e.target.value; } }));
    root.appendChild(field('Palavra-passe', { type: 'password', value: f.password || '', oninput: (e) => { f.password = e.target.value; } }));
    root.appendChild(el('div', { class: 'chips', style: 'margin-top:6px' }, [
      el('button', {
        class: 'btn primary sm', type: 'button', text: 'Entrar',
        onclick: async () => {
          const r = await api('/api/auth/login', { method: 'POST', body: { email: f.email, password: f.password } });
          if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
          await refresh();
        }
      }),
      el('button', { class: 'btn sm', type: 'button', text: 'Criar conta', onclick: () => { S.authMode = 'register'; paint(); } })
    ]));
    if (S.meta && S.meta.registration && S.meta.registration.passwordPolicy) {
      root.appendChild(el('div', { class: 'warnbox', style: 'margin-top:8px;font-size:11px', text: 'Política de palavra-passe: ' + S.meta.registration.passwordPolicy.join(' · ') + '. Recuperação de palavra-passe por email ainda não está implementada: sem essa via, um administrador pode repor a conta (operação auditada).' }));
    }
  }

  function paintAccount(root) {
    root.appendChild(el('table', { class: 'listtable' }, [
      el('tbody', {}, [
        ['Email', S.me.email], ['Papel', S.me.role], ['Criada em', S.me.createdAt],
        ['Último acesso', S.me.lastLoginAt || '—'], ['Email verificado', S.me.emailVerified ? 'sim' : 'não (verificação por email ainda não implementada)']
      ].map(([k, v]) => el('tr', {}, [el('th', { style: 'width:150px;font-size:11px', text: k }), el('td', { style: 'font-size:11px', text: String(v) })])))
    ]));

    const sess = el('table', { class: 'listtable', style: 'margin-top:8px' }, [
      el('thead', {}, [el('tr', {}, ['Sessão', 'criada', 'vista', 'expira', 'IP', ''].map((h) => el('th', { text: h })))]),
      el('tbody', {}, S.sessions.map((s) => el('tr', {}, [
        el('td', { style: 'font-size:10px', text: s.current ? 'esta' : s.id.slice(-6) }),
        el('td', { style: 'font-size:10px', text: (s.createdAt || '').slice(0, 16).replace('T', ' ') }),
        el('td', { style: 'font-size:10px', text: (s.lastSeenAt || '').slice(0, 16).replace('T', ' ') }),
        el('td', { style: 'font-size:10px', text: (s.expiresAt || '').slice(0, 16).replace('T', ' ') }),
        el('td', { style: 'font-size:10px;color:var(--muted)', text: s.ip || '—' }),
        el('td', {}, s.revoked || s.current ? el('span', { class: 'tag muted', text: s.revoked ? 'revogada' : 'actual' }) : el('button', {
          class: 'btn sm', type: 'button', text: 'Terminar', onclick: async () => { await api('/api/auth/sessions/' + s.id, { method: 'DELETE' }); refresh(); }
        }))
      ])))
    ]);
    root.appendChild(el('h4', { style: 'margin:12px 0 4px;font-size:12px', text: 'Sessões activas' }));
    root.appendChild(sess);
    root.appendChild(el('div', { class: 'chips', style: 'margin-top:6px' }, [
      el('button', { class: 'btn sm', type: 'button', text: 'Terminar todas as outras sessões', onclick: async () => { await api('/api/auth/logout-all', { method: 'POST', body: {} }); note('Sessões terminadas', 'ok'); refresh(); } })
    ]));

    const f = {};
    root.appendChild(el('h4', { style: 'margin:12px 0 4px;font-size:12px', text: 'Alterar palavra-passe' }));
    root.appendChild(field('Actual', { type: 'password', oninput: (e) => { f.current = e.target.value; } }));
    root.appendChild(field('Nova', { type: 'password', oninput: (e) => { f.next = e.target.value; } }));
    root.appendChild(el('div', { class: 'chips' }, [
      el('button', {
        class: 'btn sm', type: 'button', text: 'Alterar',
        onclick: async () => {
          const r = await api('/api/auth/password', { method: 'POST', body: f });
          note(r.ok ? 'Palavra-passe alterada; as outras sessões foram terminadas.' : 'Falhou: ' + r.error.message, r.ok ? 'ok' : 'bad');
        }
      })
    ]));

    root.appendChild(el('h4', { style: 'margin:12px 0 4px;font-size:12px', text: 'Os meus dados (RGPD)' }));
    root.appendChild(el('div', { class: 'chips' }, [
      el('button', {
        class: 'btn sm', type: 'button', text: 'Exportar os meus dados (JSON)',
        onclick: async () => {
          const r = await api('/api/auth/export');
          if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
          VN.dom.download('meridiano-dados-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(r.json, null, 2), 'application/json');
          note('Exportação descarregada (operação registada em auditoria).', 'ok');
        }
      }),
      el('button', {
        class: 'btn sm danger', type: 'button', text: 'Eliminar conta',
        onclick: async () => {
          const pw = prompt('Para eliminar a conta, escreva a palavra-passe. Esta acção é irreversível e apaga projectos, chaves e sessões.');
          if (!pw) return;
          const r = await api('/api/auth/account', { method: 'DELETE', body: { password: pw } });
          if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
          S.me = null; await refresh();
        }
      })
    ]));
  }

  function paintProjects(root) {
    if (S.report) { paintReport(root); return; }
    if (S.detail) { paintProjectDetail(root); return; }
    const f = DRAFT.project;
    root.appendChild(el('p', { style: 'font-size:11px', text: 'Projectos independentes por utilizador. Um projecto guarda a pergunta, o âmbito, as hipóteses e os limites — não confunde hipótese com facto.' }));
    root.appendChild(field('Título', { placeholder: 'ex.: Cadeia de participações em X', value: f.title || '', oninput: (e) => { f.title = e.target.value; } }));
    root.appendChild(field('Pergunta inicial', { placeholder: 'o que se pretende saber', value: f.question || '', oninput: (e) => { f.question = e.target.value; } }));
    root.appendChild(el('div', { class: 'chips', style: 'margin:6px 0' }, [
      el('button', {
        class: 'btn primary sm', type: 'button', text: 'Criar projecto',
        onclick: async () => {
          if (!f.title) return note('Indique um título', 'warn');
          const r = await api('/api/projects', { method: 'POST', body: f });
          if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
          DRAFT.project = {};
          note('Projecto criado', 'ok'); await refresh();
        }
      })
    ]));
    if (!S.projects.length) {
      root.appendChild(el('div', { class: 'warnbox', text: 'Ainda não tem projectos. Crie um para guardar a investigação no servidor (hoje continua tudo no navegador).' }));
      return;
    }
    root.appendChild(el('table', { class: 'listtable' }, [
      el('thead', {}, [el('tr', {}, ['Projecto', 'pergunta', 'estado', 'criado', ''].map((h) => el('th', { text: h })))]),
      el('tbody', {}, S.projects.map((p) => el('tr', {}, [
        el('td', { style: 'font-size:11px' }, [el('b', { text: p.title }), el('div', { style: 'color:var(--muted);font-size:10px', text: p.id })]),
        el('td', { style: 'font-size:10px', text: (p.question || '—').slice(0, 70) }),
        el('td', {}, [el('span', { class: 'tag ' + (p.status === 'draft' ? 'muted' : 'ok'), text: p.status })]),
        el('td', { style: 'font-size:10px', text: (p.createdAt || '').slice(0, 10) }),
        el('td', { style: 'white-space:nowrap' }, [
          el('button', { class: 'btn sm primary', type: 'button', text: 'Abrir', onclick: () => openProject(p.id) }),
          el('button', {
            class: 'btn sm', type: 'button', text: 'Eliminar', style: 'margin-left:4px',
            onclick: async () => {
              if (!confirm('Eliminar «' + p.title + '»?')) return;
              await api('/api/projects/' + p.id, { method: 'DELETE' });
              refresh();
            }
          })
        ])
      ])))
    ]));
  }

  /* ---------------- projecto aberto: provas e conclusões ---------------- */

  async function openProject(id) {
    const [p, ev, cl, rn] = await Promise.all([
      api('/api/projects/' + id), api('/api/projects/' + id + '/evidence'),
      api('/api/projects/' + id + '/claims'), api('/api/projects/' + id + '/runs')
    ]);
    if (!p.ok) return note('Não foi possível abrir o projecto: ' + (p.error && p.error.message), 'bad');
    S.detail = {
      project: p.json.project, evidence: ev.ok ? ev.json.evidence : [], claims: cl.ok ? cl.json.claims : [],
      runs: rn.ok ? rn.json.runs : [], profiles: rn.ok ? rn.json.profiles : ['rapida', 'normal', 'profunda', 'exaustiva'],
      steps: rn.ok ? rn.json.steps : []
    };
    paint();
  }

  /* relatório de 18 secções: 'Não disponível' é mostrado como tal, não escondido */
  async function openReport(projectId) {
    const r = await api('/api/projects/' + projectId + '/report');
    if (!r.ok) return note('Relatório indisponível: ' + (r.error && r.error.message), 'bad');
    S.report = r.json;
    paint();
  }

  function paintReport(root) {
    const rep = S.report;
    root.appendChild(el('div', { class: 'chips', style: 'margin-bottom:6px' }, [
      el('button', { class: 'btn sm', type: 'button', text: '← Voltar ao projecto', onclick: () => { S.report = null; paint(); } }),
      el('span', { class: 'tag ' + (rep.summary.unavailable ? 'warn' : 'ok'), text: rep.summary.available + '/' + rep.summary.sections + ' secções com dados' }),
      el('span', { style: 'font-size:10px;color:var(--muted)', text: rep.summary.evidence + ' provas · ' + rep.summary.claims + ' conclusões · ' + rep.summary.runs + ' execuções' })
    ]));
    root.appendChild(el('h3', { style: 'margin:6px 0;font-size:14px', text: 'Relatório — ' + rep.project.title }));
    rep.sections.forEach((sec) => {
      root.appendChild(el('div', { class: 'warnbox', style: 'margin:6px 0' }, [
        el('div', { style: 'font-size:11px;font-weight:600', text: sec.n + '. ' + sec.title }),
        sec.available === false
          ? el('div', { style: 'font-size:10px;color:var(--bad,#c33)', text: sec.note || 'Não disponível' })
          : el('pre', {
            style: 'font-size:10px;white-space:pre-wrap;margin:4px 0 0;color:var(--muted)',
            text: JSON.stringify(sec.content, null, 1).slice(0, 1200)
          }),
        sec.available !== false && sec.content && sec.content.nota
          ? el('div', { style: 'font-size:10px;color:var(--muted)', text: 'nota: ' + sec.content.nota }) : null
      ].filter(Boolean)));
    });
  }

  async function reloadDetail() {
    if (!S.detail) return;
    await openProject(S.detail.project.id);
  }

  function stateTag(state) {
    const ok = ['confirmada', 'corroborada-independente'].includes(state);
    const bad = ['refutada', 'contraditoria', 'fonte-inacessivel'].includes(state);
    return el('span', { class: 'tag ' + (ok ? 'ok' : bad ? 'bad' : 'warn'), text: state });
  }

  function paintProjectDetail(root) {
    const d = S.detail, p = d.project;
    root.appendChild(el('div', { class: 'chips', style: 'margin-bottom:6px' }, [
      el('button', { class: 'btn sm', type: 'button', text: '← Todos os projectos', onclick: () => { S.detail = null; S.report = null; paint(); } }),
      el('button', { class: 'btn sm', type: 'button', text: 'Relatório', onclick: () => openReport(p.id) }),
      el('span', { class: 'tag ' + (p.status === 'archived' ? 'muted' : 'ok'), text: p.status }),
      el('span', { style: 'font-size:10px;color:var(--muted)', text: p.id })
    ]));
    root.appendChild(el('h3', { style: 'margin:6px 0;font-size:14px', text: p.title }));
    root.appendChild(el('div', { style: 'font-size:11px;color:var(--muted)', text: p.question || 'sem pergunta definida' }));

    /* acções do ciclo de vida */
    const act = (label, action, confirmMsg) => el('button', {
      class: 'btn sm', type: 'button', text: label, style: 'margin-right:4px',
      onclick: async () => {
        if (confirmMsg && !confirm(confirmMsg)) return;
        const r = await api('/api/projects/' + p.id + '/' + action, { method: 'POST', body: {} });
        if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
        note('Acção «' + label + '» aplicada', 'ok'); await reloadDetail();
      }
    });
    root.appendChild(el('div', { class: 'chips', style: 'margin:8px 0' }, [
      act('Duplicar', 'duplicate'),
      p.status === 'archived' ? act('Retomar', 'resume') : act('Arquivar', 'archive'),
      act('Cancelar', 'cancel', 'Cancelar a investigação? O histórico mantém-se.'),
      el('button', {
        class: 'btn sm', type: 'button', text: 'Checkpoint',
        onclick: async () => {
          const label = prompt('Descrição do checkpoint:', 'revisão de provas');
          if (!label) return;
          const r = await api('/api/projects/' + p.id + '/checkpoints', { method: 'POST', body: { label } });
          if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
          note('Checkpoint registado (' + r.json.checkpoint.evidenceCount + ' provas, ' + r.json.checkpoint.claimCount + ' alegações)', 'ok');
          await reloadDetail();
        }
      })
    ]));

    /* âmbito e limites (edição directa) */
    const f = DRAFT.detail || (DRAFT.detail = {});
    const save = el('button', {
      class: 'btn sm primary', type: 'button', text: 'Guardar âmbito',
      onclick: async () => {
        const body = {
          objective: f.objective !== undefined ? f.objective : p.objective,
          referenceDate: f.referenceDate !== undefined ? f.referenceDate : p.referenceDate,
          timeLimit: f.timeLimit !== undefined ? f.timeLimit : p.timeLimit,
          completionCriteria: f.completionCriteria !== undefined
            ? String(f.completionCriteria).split('\n').map((x) => x.trim()).filter(Boolean) : p.completionCriteria
        };
        const r = await api('/api/projects/' + p.id, { method: 'PATCH', body });
        if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
        note('Âmbito actualizado', 'ok'); await reloadDetail();
      }
    });
    root.appendChild(el('div', { class: 'warnbox', style: 'margin:8px 0' }, [
      el('div', { style: 'font-size:10px;color:var(--muted);margin-bottom:4px', text: 'OBJECTIVO, DATA DE REFERÊNCIA, LIMITE E CRITÉRIOS DE CONCLUSÃO' }),
      field('Objectivo', { value: p.objective || '', oninput: (e) => { f.objective = e.target.value; } }),
      field('Data de referência', { placeholder: '2024-12-31', value: p.referenceDate || '', oninput: (e) => { f.referenceDate = e.target.value; } }),
      field('Limite temporal', { placeholder: 'ex.: 30 dias, 40 chamadas', value: p.timeLimit || '', oninput: (e) => { f.timeLimit = e.target.value; } }),
      field('Critérios de conclusão (um por linha)', {
        value: (p.completionCriteria || []).join('\n'), oninput: (e) => { f.completionCriteria = e.target.value; }
      }),
      save
    ]));

    /* hipóteses */
    root.appendChild(el('h4', { style: 'margin:12px 0 4px;font-size:12px', text: 'Hipóteses (' + (p.hypotheses || []).length + ')' }));
    if (!(p.hypotheses || []).length) {
      root.appendChild(el('div', { style: 'font-size:11px;color:var(--muted)', text: 'Sem hipóteses registadas. Uma hipótese não é um facto: fica «a-testar» até haver provas.' }));
    } else {
      root.appendChild(el('table', { class: 'listtable' }, [
        el('thead', {}, [el('tr', {}, ['hipótese', 'estado', 'teste'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, p.hypotheses.map((h) => el('tr', {}, [
          el('td', { style: 'font-size:11px', text: h.text }),
          el('td', {}, [stateTag(h.state)]),
          el('td', {}, [el('select', {
            onchange: async (e) => {
              const hyps = p.hypotheses.map((x) => x.id === h.id ? Object.assign({}, x, { status: e.target.value }) : x);
              const r = await api('/api/projects/' + p.id, { method: 'PATCH', body: { hypotheses: hyps } });
              if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
              await reloadDetail();
            }
          }, ['a-testar', 'suportada', 'refutada', 'inconclusiva'].map((v) =>
            el('option', { value: v, selected: h.status === v, text: v })))])
        ])))
      ]));
    }
    root.appendChild(addHypothesisForm);

    /* pesquisa profunda */
    root.appendChild(el('h4', { style: 'margin:16px 0 4px;font-size:12px', text: 'Pesquisa profunda (' + (d.runs || []).length + ')' }));
    const rf = DRAFT.run || (DRAFT.run = { profile: 'normal', urls: '' });
    root.appendChild(el('div', { class: 'warnbox' }, [
      el('div', { style: 'font-size:10px;color:var(--muted);margin-bottom:4px', text: 'PERFIL DE EXECUÇÃO — um perfil define esforço, não cobertura: no fim é dito o que se consultou e por que parou' }),
      el('div', { class: 'chips' }, [
        el('select', { onchange: (e) => { rf.profile = e.target.value; } },
          (d.profiles || ['rapida', 'normal', 'profunda', 'exaustiva']).map((v) => el('option', { value: v, selected: rf.profile === v, text: 'perfil: ' + v }))),
        el('input', {
          placeholder: 'URLs candidatas (uma por linha)', value: rf.urls, style: 'flex:1;min-width:260px',
          oninput: (e) => { rf.urls = e.target.value; }
        })
      ]),
      el('button', {
        class: 'btn sm primary', type: 'button', text: 'Iniciar pesquisa', style: 'margin-top:4px',
        onclick: async () => {
          const urls = String(rf.urls || '').split('\n').map((x) => x.trim()).filter(Boolean);
          const r = await api('/api/projects/' + p.id + '/runs', { method: 'POST', body: { profile: rf.profile, urls } });
          if (!r.ok) return note('Falhou: ' + (r.error && r.error.message), 'bad');
          const run = r.json.run;
          note('Execução ' + run.status + (run.stopReason ? ' — parou: ' + run.stopReason : '') +
            ' · passos registados: ' + (run.steps || []).length +
            ' · fontes consultadas: ' + (run.sourcesConsulted || []).length, run.stopReason ? 'warn' : 'ok');
          await reloadDetail();
        }
      })
    ]));
    (d.runs || []).forEach((run) => {
      const done = (run.steps || []).filter((x) => x.status === 'concluido').length;
      root.appendChild(el('div', { class: 'warnbox', style: 'margin:6px 0' }, [
        el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [
          el('span', { class: 'tag ' + (run.status === 'aguarda-revisao-humana' ? 'ok' : run.status === 'stopped' ? 'warn' : 'muted'), text: run.status }),
          el('b', { style: 'font-size:11px', text: 'perfil ' + run.profile }),
          el('span', { style: 'font-size:10px;color:var(--muted)', text: done + '/20 passos concluídos · ' + (run.sourcesConsulted || []).length + ' fontes consultadas' }),
          run.stopReason ? el('span', { style: 'font-size:10px;color:var(--bad,#c33)', text: 'parou: ' + run.stopReason }) : null,
          el('button', {
            class: 'btn sm', type: 'button', text: 'Relatório', style: 'margin-left:auto',
            onclick: () => openReport(p.id)
          }),
          ['pending', 'running'].includes(run.status) ? el('button', {
            class: 'btn sm', type: 'button', text: 'Cancelar',
            onclick: async () => {
              const r = await api('/api/runs/' + run.id + '/cancel', { method: 'POST', body: {} });
              if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
              await reloadDetail();
            }
          }) : null,
          run.status === 'stopped' ? el('button', {
            class: 'btn sm', type: 'button', text: 'Retomar',
            onclick: async () => {
              const r = await api('/api/runs/' + run.id + '/resume', { method: 'POST', body: {} });
              if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
              note('Retomada: ' + r.json.run.status + (r.json.run.stopReason ? ' — parou de novo: ' + r.json.run.stopReason : ''), 'warn');
              await reloadDetail();
            }
          }) : null
        ].filter(Boolean)),
        run.stopDetail ? el('div', { style: 'font-size:10px;color:var(--muted)', text: run.stopDetail }) : null,
        el('div', { style: 'font-size:10px;color:var(--muted);margin-top:2px', text:
          (run.steps || []).map((x) => x.n + '.' + x.id + (x.status === 'concluido' ? '✓' : x.status === 'ignorado-pelo-perfil' ? '·' : x.status === 'nao-executado' ? '∅' : '✗')).join(' ') })
      ].filter(Boolean)));
    });

    /* provas */
    root.appendChild(el('h4', { style: 'margin:16px 0 4px;font-size:12px', text: 'Registo de provas (' + d.evidence.length + ')' }));
    root.appendChild(el('div', { style: 'font-size:10px;color:var(--muted);margin-bottom:4px', text: 'Cópias do mesmo comunicado contam como UMA origem: a corroboração usa origens independentes, não ficheiros.' }));
    if (d.evidence.length) {
      root.appendChild(el('table', { class: 'listtable' }, [
        el('thead', {}, [el('tr', {}, ['prova', 'tipo', 'posição', 'origem', 'estado', 'verificada', ''].map((h) => el('th', { text: h })))]),
        el('tbody', {}, d.evidence.map((ev) => el('tr', { style: ev.retractedAt ? 'opacity:.55' : '' }, [
          el('td', { style: 'font-size:10px' }, [
            el('b', { text: ev.title }),
            el('div', { style: 'color:var(--muted)', text: (ev.canonicalUrl || ev.location || 'sem URL') + ' · ' + (ev.contentHash || '').slice(0, 10) + '…' }),
            el('div', { style: 'color:var(--muted)', text: (ev.excerpt || '').slice(0, 110) })
          ]),
          el('td', { style: 'font-size:10px', text: ev.sourceType }),
          el('td', { style: 'font-size:10px', text: ev.stance }),
          el('td', { style: 'font-size:10px;color:var(--muted)', text: ev.originKey }),
          el('td', {}, [stateTag(ev.validationState), ev.retractedAt ? el('div', { style: 'font-size:9px;color:var(--muted)', text: 'retirada' }) : null].filter(Boolean)),
          el('td', { style: 'font-size:10px', text: ev.verificationDate ? ev.verificationDate.slice(0, 10) : '—' }),
          el('td', {}, [ev.retractedAt ? null : el('button', {
            class: 'btn sm', type: 'button', text: 'Anotar',
            onclick: async () => {
              const lim = prompt('Limitações desta prova:', ev.limitations || '');
              if (lim == null) return;
              const r = await api('/api/evidence/' + ev.id, { method: 'PATCH', body: { limitations: lim, verificationDate: new Date().toISOString() } });
              if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
              await reloadDetail();
            }
          }), ev.retractedAt ? null : el('button', {
            class: 'btn sm', type: 'button', text: 'Retirar', style: 'margin-left:4px',
            onclick: async () => {
              const reason = prompt('Motivo da retirada (fica registado; a prova não é apagada):', '');
              if (!reason) return;
              const r = await api('/api/evidence/' + ev.id, { method: 'DELETE', body: { reason } });
              if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
              note('Prova retirada com motivo; histórico conservado.', 'ok'); await reloadDetail();
            }
          })].filter(Boolean))
        ])))
      ]));
    }
    root.appendChild(addEvidenceForm(p.id));

    /* conclusões */
    root.appendChild(el('h4', { style: 'margin:16px 0 4px;font-size:12px', text: 'Conclusões e alegações (' + d.claims.length + ')' }));
    root.appendChild(el('div', { style: 'font-size:10px;color:var(--muted);margin-bottom:4px', text: 'O servidor recusa estados que as provas não sustentam: «confirmada» exige duas origens independentes e uma prova primária, sem prova contrária activa.' }));
    if (!d.claims.length) root.appendChild(el('div', { style: 'font-size:11px;color:var(--muted)', text: 'Sem conclusões registadas.' }));
    d.claims.forEach((c) => {
      const fa = c.factors || {};
      root.appendChild(el('div', { class: 'warnbox', style: 'margin:6px 0' }, [
        el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [
          stateTag(c.state),
          el('b', { style: 'font-size:11px', text: c.text }),
          el('span', { style: 'font-size:10px;color:var(--muted)', text: 'sugerido pelas provas: ' + c.suggested })
        ]),
        el('div', { style: 'font-size:10px;color:var(--muted);margin:4px 0' , text:
          'origens independentes ' + (fa.independentOrigins || 0) + ' · favoráveis ' + (fa.favourable || 0) +
          ' · contrárias ' + (fa.contrary || 0) + ' · primárias ' + (fa.primaryFavourable || 0) +
          ' · cópias redundantes ' + (fa.copiesWithoutIndependentValue || 0) }),
        el('div', { class: 'chips' }, [
          el('button', {
            class: 'btn sm', type: 'button', text: 'Aplicar estado sugerido (' + c.suggested + ')',
            onclick: async () => {
              const r = await api('/api/claims/' + c.id, { method: 'PATCH', body: { state: c.suggested } });
              if (!r.ok) return note('Recusado pelo servidor: ' + (r.error.reasons || [r.error.message]).join('; '), 'bad');
              note('Estado aplicado: ' + c.suggested, 'ok'); await reloadDetail();
            }
          }),
          el('select', {
            onchange: async (e) => {
              const eid = e.target.value;
              if (!eid) return;
              const r = await api('/api/claims/' + c.id, { method: 'PATCH', body: { evidenceId: eid } });
              if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
              e.target.value = '';
              await reloadDetail();
            }
          }, [el('option', { value: '', text: 'ligar prova…' })].concat(
            d.evidence.filter((ev) => !ev.retractedAt).map((ev) =>
              el('option', { value: ev.id, text: (ev.stance === 'contraria' ? '✗ ' : '✓ ') + ev.title.slice(0, 50) }))
          )),
          el('span', { style: 'font-size:10px;color:var(--muted)', text: (c.evidenceIds || []).length + ' prova(s) ligada(s)' })
        ])
      ]));
    });
    root.appendChild(addClaimForm(p.id));
  }

  const addHypothesisForm = el('div', { class: 'chips', style: 'margin-top:6px' }, [
    el('input', {
      placeholder: 'nova hipótese a testar', style: 'flex:1;min-width:220px',
      oninput: (e) => { DRAFT.hyp = e.target.value; }
    }),
    el('button', {
      class: 'btn sm', type: 'button', text: 'Adicionar hipótese',
      onclick: async () => {
        const text = (DRAFT.hyp || '').trim();
        if (!text) return note('Escreva a hipótese', 'warn');
        const p = S.detail.project;
        const hyps = (p.hypotheses || []).concat([{ text, status: 'a-testar' }]);
        const r = await api('/api/projects/' + p.id, { method: 'PATCH', body: { hypotheses: hyps } });
        if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
        DRAFT.hyp = '';
        await reloadDetail();
      }
    })
  ]);

  function addEvidenceForm(projectId) {
    const f = DRAFT.evidence || (DRAFT.evidence = { sourceType: 'secundaria', stance: 'favoravel', extractionMethod: 'manual' });
    const mk = (label, attrs) => field(label, Object.assign({ value: f[attrs.name] || '' }, attrs));
    return el('div', { class: 'warnbox', style: 'margin-top:8px' }, [
      el('div', { style: 'font-size:10px;color:var(--muted);margin-bottom:4px', text: 'NOVA PROVA — o excerto é obrigatório: sem excerto não há o que verificar' }),
      mk('Título', { name: 'title', placeholder: 'título do documento', oninput: (e) => { f.title = e.target.value; } }),
      mk('URL original', { name: 'originalUrl', placeholder: 'https://…', oninput: (e) => { f.originalUrl = e.target.value; } }),
      mk('Excerto citado', { name: 'excerpt', placeholder: 'o trecho exacto que sustenta a alegação', oninput: (e) => { f.excerpt = e.target.value; } }),
      el('div', { class: 'chips' }, [
        el('select', { onchange: (e) => { f.sourceType = e.target.value; } }, ['primaria', 'secundaria', 'documento-oficial', 'base-de-dados', 'comunicado', 'reproducao']
          .map((v) => el('option', { value: v, selected: f.sourceType === v, text: 'tipo: ' + v }))),
        el('select', { onchange: (e) => { f.stance = e.target.value; } }, ['favoravel', 'contraria', 'neutra']
          .map((v) => el('option', { value: v, selected: f.stance === v, text: 'posição: ' + v }))),
        el('select', { onchange: (e) => { f.extractionMethod = e.target.value; } }, ['manual', 'http', 'pdf', 'api', 'ocr']
          .map((v) => el('option', { value: v, selected: f.extractionMethod === v, text: v }))),
        el('button', {
          class: 'btn sm primary', type: 'button', text: 'Registar prova',
          onclick: async () => {
            const body = {
              title: f.title, originalUrl: f.originalUrl || null, excerpt: f.excerpt,
              sourceType: f.sourceType, stance: f.stance, extractionMethod: f.extractionMethod,
              syndicationOf: f.syndicationOf || null,
              language: 'pt'
            };
            const r = await api('/api/projects/' + projectId + '/evidence', { method: 'POST', body });
            if (!r.ok) return note('Recusada: ' + (r.error.errors || [r.error.message]).join('; '), 'bad');
            const dup = r.json.duplicate ? ' (já existia: não foi duplicada)' : '';
            DRAFT.evidence = { sourceType: f.sourceType, stance: f.stance, extractionMethod: f.extractionMethod };
            note('Prova registada' + dup + ' · URL canónico: ' + r.json.evidence.canonicalUrl, 'ok');
            await reloadDetail();
          }
        })
      ])
    ]);
  }

  function addClaimForm(projectId) {
    const f = DRAFT.claim || (DRAFT.claim = {});
    return el('div', { class: 'warnbox', style: 'margin-top:8px' }, [
      el('div', { style: 'font-size:10px;color:var(--muted);margin-bottom:4px', text: 'NOVA CONCLUSÃO — nasce como hipótese; o estado sobe só com provas que o sustentem' }),
      field('Alegação', { placeholder: 'o que se afirma, em termos verificáveis', value: f.text || '', oninput: (e) => { f.text = e.target.value; } }),
      el('div', { class: 'chips' }, [
        el('select', { onchange: (e) => { f.kind = e.target.value; } }, ['facto', 'alegacao', 'hipotese', 'inferencia']
          .map((v) => el('option', { value: v, selected: (f.kind || 'facto') === v, text: v }))),
        el('button', {
          class: 'btn sm primary', type: 'button', text: 'Registar conclusão',
          onclick: async () => {
            const r = await api('/api/projects/' + projectId + '/claims', { method: 'POST', body: { text: f.text, kind: f.kind || 'facto' } });
            if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
            DRAFT.claim = {};
            note('Conclusão registada como ' + r.json.claim.state, 'ok');
            await reloadDetail();
          }
        })
      ])
    ]);
  }

  function paintKeys(root) {
    const kv = (S.providers[0] && S.providers[0].keyVault) || S.meta.keyVault || {};
    root.appendChild(el('div', { class: 'warnbox', style: 'margin-bottom:8px' }, [
      el('b', { text: 'Chaves de API: ' }),
      el('span', { text: kv.enabled
        ? 'cifradas em repouso (AES-256-GCM). O servidor devolve apenas a máscara e nunca as mostra a administradores.'
        : 'cofre desactivado — ' + (kv.reason || 'APP_SECRET não configurado') + '. Sem cofre, não é possível guardar chaves.' })
    ]));
    root.appendChild(el('p', { style: 'font-size:11px;color:var(--muted)', text: 'Cada chave é validada com pedidos reais: lista de modelos e uma geração mínima. Sem validação o estado fica «não verificado» e as chamadas são recusadas pelo servidor.' }));

    const f = DRAFT.key;
    if (!f.provider) f.provider = (S.providers[0] || {}).id || 'groq';
    const sel = el('select', {
      class: 'input',
      onchange: (e) => { DRAFT.key.provider = e.target.value; }
    }, (S.providers || []).map((p) => el('option', { value: p.id, selected: p.id === f.provider ? 'selected' : null, text: p.label })));
    root.appendChild(el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin:6px 0' }, [
      el('label', { style: 'display:flex;flex-direction:column;gap:3px;font-size:10px;color:var(--muted)' }, [el('span', { text: 'Fornecedor' }), sel]),
      field('Chave (api key)', { type: 'password', value: f.apiKey || '', oninput: (e) => { f.apiKey = e.target.value; } }),
      field('Modelo', { placeholder: 'ex.: llama-3.3-70b-versatile', value: f.model || '', oninput: (e) => { f.model = e.target.value; } }),
      field('Conta (Cloudflare, opcional)', { value: f.accountId || '', oninput: (e) => { f.accountId = e.target.value; } })
    ]));
    root.appendChild(el('div', { class: 'chips' }, [
      el('button', {
        class: 'btn primary sm', type: 'button', text: 'Guardar chave',
        onclick: async () => {
          const provider = sel.value || DRAFT.key.provider;
          if (!f.apiKey) return note('Indique a chave', 'warn');
          const r = await api('/api/providers/' + provider + '/key', { method: 'POST', body: { apiKey: f.apiKey, model: f.model, accountId: f.accountId } });
          if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
          DRAFT.key = { provider: provider };
          await refresh();
          note('Chave guardada (máscara ' + r.json.mask + '). Agora valide-a.', 'ok');
        }
      })
    ]));

    root.appendChild(el('table', { class: 'listtable', style: 'margin-top:10px' }, [
      el('thead', {}, [el('tr', {}, ['Fornecedor', 'máscara', 'modelo', 'estado', 'último erro', ''].map((h) => el('th', { text: h })))]),
      el('tbody', {}, (S.providers || []).map((p) => el('tr', {}, [
        el('td', { style: 'font-size:11px' }, [el('b', { text: p.label }), el('div', { style: 'color:var(--muted);font-size:10px', text: p.freeTier || '' })]),
        el('td', { style: 'font-family:monospace;font-size:10px', text: p.mask || '—' }),
        el('td', { style: 'font-size:10px', text: p.model || '—' }),
        el('td', {}, [el('span', { class: 'tag ' + (p.status === 'operational' ? 'ok' : p.status === 'error' ? 'bad' : 'muted'), text: p.status })]),
        el('td', { style: 'font-size:10px;color:var(--warn);max-width:220px', text: (p.lastError || '').slice(0, 90) }),
        el('td', {}, [
          p.configured ? el('button', {
            class: 'btn sm', type: 'button', text: 'Testar',
            onclick: async () => {
              note('A testar ' + p.label + '…', 'warn');
              const r = await api('/api/providers/' + p.id + '/test', { method: 'POST', body: {} });
              if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
              const v = r.json.validation;
              note(v.ok ? p.label + ': ligação válida (' + v.latencyMs + ' ms, ' + v.modelsCount + ' modelos)' : p.label + ' falhou em «' + v.stage + '»: ' + v.error, v.ok ? 'ok' : 'bad');
              refresh();
            }
          }) : null,
          p.configured ? el('button', {
            class: 'btn sm', type: 'button', text: 'Apagar',
            onclick: async () => { await api('/api/providers/' + p.id + '/key', { method: 'DELETE' }); await refresh(); }
          }) : null
        ].filter(Boolean))
      ])))
    ]));
  }

  function paintAdmin(root) {
    const m = S.metrics;
    if (!m) return root.appendChild(el('div', { class: 'warnbox', text: 'Métricas indisponíveis (sem resposta do servidor).' }));
    const card = (label, value) => el('div', { class: 'warnbox', style: 'flex:1;min-width:120px' }, [
      el('div', { style: 'font-size:10px;color:var(--muted)', text: label }),
      el('div', { style: 'font-size:18px;font-weight:600', text: String(value) })
    ]);
    root.appendChild(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
      card('Utilizadores', m.users.total), card('Administradores', m.users.admins),
      card('Sessões activas', m.users.activeSessions), card('Projectos', m.projects.total),
      card('Chamadas de IA', m.ai.totalCalls), card('Falhas de login', m.security.loginFailures)
    ]));
    root.appendChild(el('div', { class: 'warnbox', style: 'margin-top:8px;font-size:11px' }, [
      el('b', { text: 'Não disponível: ' }),
      el('span', { text: m.notAvailable.join(' · ') })
    ]));

    root.appendChild(el('h4', { style: 'margin:12px 0 4px;font-size:12px', text: 'Utilizadores' }));
    root.appendChild(el('table', { class: 'listtable' }, [
      el('thead', {}, [el('tr', {}, ['Email', 'papel', 'estado', 'projectos', 'chaves', ''].map((h) => el('th', { text: h })))]),
      el('tbody', {}, S.users.map((u) => el('tr', {}, [
        el('td', { style: 'font-size:11px', text: u.email }),
        el('td', {}, [el('span', { class: 'tag ' + (u.role === 'ADMIN' ? 'warn' : 'muted'), text: u.role })]),
        el('td', {}, [el('span', { class: 'tag ' + (u.status === 'active' ? 'ok' : 'bad'), text: u.status })]),
        el('td', { style: 'font-size:11px', text: String(u.projects) }),
        el('td', { style: 'font-size:10px', text: (u.hasKeys || []).map((k) => k.provider + ' ' + k.mask).join(', ') || '—' }),
        el('td', {}, [
          el('button', {
            class: 'btn sm', type: 'button', text: 'Ver pesquisas',
            onclick: async () => {
              const reason = prompt('Motivo do acesso (fica registado na auditoria):', 'suporte');
              if (!reason) return;
              const r = await api('/api/admin/users/' + u.id + '/projects?reason=' + encodeURIComponent(reason));
              if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
              note(u.email + ': ' + r.json.projects.length + ' projecto(s) — acesso registado com o motivo indicado.', 'ok');
            }
          }),
          u.role === 'ADMIN' ? null : el('button', {
            class: 'btn sm', type: 'button', text: u.status === 'active' ? 'Suspender' : 'Reactivar',
            onclick: async () => {
              await api('/api/admin/users/' + u.id + '/status', { method: 'POST', body: { status: u.status === 'active' ? 'suspended' : 'active' } });
              refresh();
            }
          })
        ].filter(Boolean))
      ])))
    ]));

    root.appendChild(el('h4', { style: 'margin:12px 0 4px;font-size:12px', text: 'Auditoria recente' }));
    root.appendChild(el('table', { class: 'listtable' }, [
      el('thead', {}, [el('tr', {}, ['data', 'evento', 'actor', 'detalhe'].map((h) => el('th', { text: h })))]),
      el('tbody', {}, S.audit.slice(0, 40).map((e) => el('tr', {}, [
        el('td', { style: 'font-size:10px', text: (e.at || '').slice(0, 19).replace('T', ' ') }),
        el('td', { style: 'font-size:10px', text: e.type }),
        el('td', { style: 'font-size:10px', text: (e.actorId || '—').slice(-6) }),
        el('td', { style: 'font-size:10px;color:var(--muted)', text: JSON.stringify(e.detail || {}).slice(0, 90) })
      ])))
    ]));
  }

  /* ---------------- montagem ---------------- */
  function mount() {
    const host = el('div', { id: 'accroot' });
    host.appendChild(el('p', { style: 'font-size:11px;color:var(--muted)', text: 'a carregar…' }));
    refresh();
    return host;
  }

  VN.accountUI = { mount, refresh, paint, getState: () => S, api, openProject, openReport };
})(typeof window !== 'undefined' ? window : globalThis);
