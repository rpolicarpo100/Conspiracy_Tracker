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
    providers: [], metrics: null, users: [], audit: [], sessions: [], msg: null, busy: false
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
  async function refresh() {
    const [me, meta] = await Promise.all([api('/api/auth/me'), api('/api/meta')]);
    S.me = (me.json && me.json.user) || null;
    S.csrf = (me.json && me.json.csrf) || S.csrf;
    S.meta = meta.json || null;
    if (S.me) {
      const pr = await api('/api/projects');
      if (pr.ok) S.projects = pr.json.projects;
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
    }
    paint();
  }

  /* ---------------- pintura ---------------- */
  function paint() {
    const root = document.getElementById('accroot');
    if (!root) return;
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
        el('td', {}, [el('button', {
          class: 'btn sm', type: 'button', text: 'Eliminar',
          onclick: async () => {
            if (!confirm('Eliminar «' + p.title + '»?')) return;
            await api('/api/projects/' + p.id, { method: 'DELETE' });
            refresh();
          }
        })])
      ])))
    ]));
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

  VN.accountUI = { mount, refresh, getState: () => S, api };
})(typeof window !== 'undefined' ? window : globalThis);
