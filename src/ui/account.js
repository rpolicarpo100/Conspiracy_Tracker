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
    providers: [], metrics: null, users: [], audit: [], sessions: [], mfa: null, msg: null, busy: false,
    detail: null,           // projecto aberto: { project, evidence, claims, runs, graph, agents, agentRuns }
    path: null,             // caminho entre entidades pedido
    mfaChallenge: null,     // login a meio do segundo factor: { token, email, expiresAt, methods }
    graphView: null,        // referência ao SVG desenhado (para exportar PNG)
    period: { from: '', to: '' },   // filtro temporal do grafo
    accessOut: null,        // último resultado de verificação de acesso
    memory: [],             // memória da investigação do projecto aberto
    memoryKinds: null,
    entityLinks: [],        // ligações de homónimos declaradas
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
      if (pv.ok) { S.providers = pv.json.providers; S.operatorKeys = pv.json.operatorKeys || null; }
      const se = await api('/api/auth/sessions');
      if (se.ok) S.sessions = se.json.sessions;
      const mf = await api('/api/auth/mfa');
      if (mf.ok) S.mfa = mf.json;
      else S.mfa = { enabled: false };
      if (S.me.role === 'ADMIN') {
        const [m, u, a] = await Promise.all([api('/api/admin/metrics'), api('/api/admin/users'), api('/api/admin/audit?limit=60')]);
        if (m.ok) S.metrics = m.json;
        if (u.ok) S.users = u.json.users;
        if (a.ok) S.audit = a.json.events;
      }
    } else {
      S.projects = []; S.providers = []; S.sessions = []; S.metrics = null; S.users = []; S.audit = []; S.mfa = null; S.operatorKeys = null;
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
        /* o fim de sessão é da porta de entrada: o painel não tem formulário
           próprio. Avisa-se a porta e é ela que repõe o ecrã. */
        onclick: async () => {
          await api('/api/auth/logout', { method: 'POST', body: {} });
          S.me = null; S.tab = 'account'; S.msg = null;
          if (g.VN && g.VN.gate && typeof g.VN.gate.sessaoTerminou === 'function') { g.VN.gate.sessaoTerminou(); return; }
          S.authMode = 'login'; refresh();
        }
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
    /* o registo é uma decisão do servidor: o browser não a presume nem a
       esconde com um botão que só falharia depois de preencher o formulário */
    const reg = (S.meta && S.meta.registration) || null;
    const regAberta = !!(reg && reg.open);
    if (S.authMode === 'register' && !regAberta) {
      root.appendChild(el('div', { class: 'warnbox', id: 'registoFechado', style: 'font-size:11px' }, [
        el('b', { text: 'Registo público fechado. ' }),
        el('span', { text: (reg && reg.policy) || 'as contas são criadas por um administrador.' }),
        el('div', { style: 'margin-top:4px;color:var(--muted)', text: 'Peça a um administrador para criar a conta; receberá uma palavra-passe temporária para trocar no primeiro acesso.' })
      ]));
      root.appendChild(el('div', { class: 'chips' }, [
        el('button', { class: 'btn sm', type: 'button', text: 'Voltar à entrada', onclick: () => { S.authMode = 'login'; paint(); } })
      ]));
      return;
    }
    if (S.authMode === 'register') {
      const f = DRAFT.auth;
      root.appendChild(el('p', { text: 'Criar conta. Os dados ficam na base de dados da aplicação (PostgreSQL gerido na UE); a política de privacidade (docs/PRIVACIDADE.md) diz o que é guardado, onde e quem pode consultar.' }));
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
          /* conta com segundo factor: o servidor devolve um desafio, não uma sessão */
          if (r.json && r.json.mfaRequired) {
            S.mfaChallenge = { token: r.json.challenge, expiresAt: r.json.expiresAt, methods: r.json.methods || ['totp'], email: f.email };
            note('Introduza o código da aplicação de autenticação (' + (r.json.methods || ['totp']).join(' ou ') + ').', 'warn');
            return paint();
          }
          await refresh();
        }
      }),
      regAberta
        ? el('button', { class: 'btn sm', type: 'button', id: 'btnIrRegisto', text: 'Criar conta', onclick: () => { S.authMode = 'register'; paint(); } })
        : el('span', { class: 'muted', style: 'font-size:10px;align-self:center', text: 'registo público fechado — a conta é criada por um administrador' })
    ]));
    if (S.mfaChallenge) {
      const g = DRAFT.mfaChallenge || (DRAFT.mfaChallenge = { code: '', recoveryCode: '' });
      root.appendChild(el('div', { class: 'warnbox', style: 'margin-top:8px' }, [
        el('div', { style: 'font-size:11px' }, [el('b', { text: 'Segundo passo para ' + S.mfaChallenge.email })]),
        el('div', { style: 'font-size:10px;color:var(--muted)', text: 'a sessão só é criada depois de o código ser aceite' }),
        el('div', { class: 'chips', style: 'margin-top:4px' }, [
          el('input', { id: 'mfaCode', placeholder: 'código de 6 dígitos', style: 'width:140px', oninput: (e) => { g.code = e.target.value; } }),
          el('button', {
            id: 'mfaVerify', class: 'btn sm primary', type: 'button', text: 'Confirmar código',
            onclick: async () => {
              const r = await api('/api/auth/mfa/verify', { method: 'POST', body: { challenge: S.mfaChallenge.token, code: g.code } });
              if (!r.ok) return note('Código recusado: ' + (r.error.message) + (r.error.remaining != null ? ' (' + r.error.remaining + ' tentativa(s))' : ''), 'bad');
              S.mfaChallenge = null; DRAFT.mfaChallenge = { code: '', recoveryCode: '' };
              if (r.json.aviso) note(r.json.aviso, 'warn');
              await refresh();
            }
          }),
          el('button', {
            class: 'btn sm', type: 'button', text: 'Usar código de recuperação',
            onclick: async () => {
              const codigo = prompt('Código de recuperação (ex.: A1B2C-3D4E5):', '');
              if (!codigo) return;
              const r = await api('/api/auth/mfa/verify', { method: 'POST', body: { challenge: S.mfaChallenge.token, recoveryCode: codigo } });
              if (!r.ok) return note('Recusado: ' + r.error.message, 'bad');
              S.mfaChallenge = null;
              note(r.json.aviso || 'Entrou com um código de recuperação.', 'warn');
              await refresh();
            }
          })
        ])
      ]));
    }
    if (S.meta && S.meta.registration && S.meta.registration.passwordPolicy) {
      root.appendChild(el('div', { class: 'warnbox', style: 'margin-top:8px;font-size:11px', text: 'Política de palavra-passe: ' + S.meta.registration.passwordPolicy.join(' · ') + '. Recuperação de palavra-passe por email ainda não está implementada: sem essa via, um administrador pode repor a conta (operação auditada).' }));
    }
  }

  /* ---------------- verificação em dois passos (TOTP) ---------------- */
  function mfaPanel(onChanged) {
    const m = S.mfa || { enabled: false };
    const f = DRAFT.mfa || (DRAFT.mfa = { password: '', code: '', recoveryCode: '' });
    const root = el('div', {});
    root.appendChild(el('h4', { style: 'margin:12px 0 4px;font-size:12px', text: 'Verificação em dois passos (TOTP)' }));
    const rb = recoveryBox();
    if (rb) root.appendChild(rb);
    root.appendChild(el('div', { style: 'font-size:10px;color:var(--muted);margin-bottom:4px', text:
      'Um código de 6 dígitos a cada 30 s, de uma aplicação de autenticação. Sem isto, uma palavra-passe apanhada basta para entrar.' }));

    if (m.enabled) {
      root.appendChild(el('div', { class: 'warnbox' }, [
        el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [
          el('span', { class: 'tag ok', text: 'activo' }),
          el('span', { style: 'font-size:10px;color:var(--muted)', text: 'segredo ' + (m.secretMasked || '—') + ' · desde ' + String(m.enabledAt || '').slice(0, 10) }),
          el('span', { class: 'tag ' + (m.recoveryCodesLeft <= 2 ? 'warn' : 'muted'), text: m.recoveryCodesLeft + ' código(s) de recuperação' })
        ]),
        el('div', { class: 'chips', style: 'margin-top:6px' }, [
          el('input', { type: 'password', placeholder: 'palavra-passe actual', oninput: (e) => { f.password = e.target.value; } }),
          el('input', { placeholder: 'código de 6 dígitos', style: 'width:120px', oninput: (e) => { f.code = e.target.value; } }),
          el('button', {
            class: 'btn sm', type: 'button', text: 'Gerar novos códigos de recuperação',
            onclick: async () => {
              const r = await api('/api/auth/mfa/recovery', { method: 'POST', body: { password: f.password, code: f.code } });
              if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
              showRecoveryCodes(r.json.recoveryCodes);
              await onChanged();
            }
          }),
          el('button', {
            class: 'btn sm danger', type: 'button', text: 'Desactivar',
            onclick: async () => {
              const r = await api('/api/auth/mfa/disable', { method: 'POST', body: { password: f.password, code: f.code, recoveryCode: f.recoveryCode } });
              if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
              note('Verificação em dois passos desactivada; as outras sessões foram terminadas.', 'warn');
              f.password = ''; f.code = '';
              await onChanged();
            }
          })
        ]),
        el('div', { style: 'font-size:9px;color:var(--muted)', text: 'desactivar exige a palavra-passe e um código válido (ou um código de recuperação)' })
      ]));
      return root;
    }

    if (m.pending) {
      const setup = DRAFT.mfaSetup || null;
      root.appendChild(el('div', { class: 'warnbox' }, [
        el('div', { style: 'font-size:10px', text: 'Activem-se agora: introduza o segredo na aplicação de autenticação e confirme o código de 6 dígitos.' }),
        setup ? el('div', { style: 'font-size:10px;margin-top:4px' }, [
          el('div', {}, [el('b', { text: 'segredo: ' }), el('code', { text: setup.secret })]),
          el('div', { style: 'color:var(--muted);word-break:break-all', text: setup.otpauth })
        ]) : el('div', { style: 'font-size:10px;color:#c96', text: 'o segredo só é mostrado no momento em que é criado: recomece a activação' }),
        el('div', { class: 'chips', style: 'margin-top:6px' }, [
          el('input', { placeholder: 'código de 6 dígitos', style: 'width:140px', oninput: (e) => { f.code = e.target.value; } }),
          el('button', {
            class: 'btn sm primary', type: 'button', text: 'Confirmar e activar',
            onclick: async () => {
              const r = await api('/api/auth/mfa/enable', { method: 'POST', body: { code: f.code } });
              if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
              DRAFT.mfaSetup = null;
              f.code = '';
              note('Verificação em dois passos activa.', 'ok');
              showRecoveryCodes(r.json.recoveryCodes);
              await onChanged();
            }
          })
        ])
      ]));
      return root;
    }

    root.appendChild(el('div', { class: 'chips' }, [
      el('input', { type: 'password', placeholder: 'palavra-passe actual', oninput: (e) => { f.password = e.target.value; } }),
      el('button', {
        class: 'btn sm primary', type: 'button', text: 'Activar verificação em dois passos',
        onclick: async () => {
          const r = await api('/api/auth/mfa/setup', { method: 'POST', body: { password: f.password } });
          if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
          DRAFT.mfaSetup = { secret: r.json.secret, otpauth: r.json.otpauth };
          note('Segredo criado: introduza-o na aplicação de autenticação e confirme o código.', 'warn');
          await onChanged();
        }
      })
    ]));
    root.appendChild(el('div', { style: 'font-size:9px;color:var(--muted);margin-top:4px', text:
      'o segredo é mostrado uma única vez; os códigos de recuperação também — guarde-os antes de fechar esta área' }));
    return root;
  }

  /* os códigos de recuperação são mostrados UMA vez pelo servidor; aqui ficam
     apenas na memória desta página até a pessoa dizer que os guardou */
  function showRecoveryCodes(codes) {
    S.recoveryCodes = codes;
  }

  function recoveryBox() {
    if (!S.recoveryCodes || !S.recoveryCodes.length) return null;
    return el('div', { class: 'warnbox', id: 'mfaRecoveryBox', style: 'margin:8px 0' }, [
      el('div', { style: 'font-size:11px' }, [el('b', { text: 'Códigos de recuperação — cada um serve uma vez. Guarde-os agora:' })]),
      el('div', { style: 'font-family:ui-monospace,monospace;font-size:11px;line-height:1.6;margin-top:4px' },
        S.recoveryCodes.map((c) => el('div', { text: c }))),
      el('div', { style: 'font-size:9px;color:var(--muted)', text: 'o servidor não os volta a mostrar: sem eles e sem a aplicação de autenticação, a conta não entra' }),
      el('div', { class: 'chips', style: 'margin-top:4px' }, [
        el('button', {
          class: 'btn sm', type: 'button', text: 'Copiar',
          onclick: () => { VN.dom.download('conspiracy-tracker-codigos-recuperacao.txt', S.recoveryCodes.join('\n'), 'text/plain'); note('Ficheiro com os códigos descarregado.', 'ok'); }
        }),
        el('button', {
          class: 'btn sm', type: 'button', text: 'Já os guardei',
          onclick: () => { S.recoveryCodes = null; paint(); }
        })
      ])
    ]);
  }

  function paintAccount(root) {
    if (S.me && S.me.mustChangePassword) {
      root.appendChild(el('div', { class: 'warnbox', id: 'trocaObrigatoria', style: 'font-size:11px' }, [
        el('b', { text: 'Palavra-passe temporária. ' }),
        el('span', { text: 'Esta conta foi criada por um administrador com uma palavra-passe temporária. Enquanto não a trocar (no formulário «Alterar palavra-passe», abaixo), o servidor recusa todas as outras operações com o código PASSWORD_CHANGE_REQUIRED.' })
      ]));
    }
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

    root.appendChild(mfaPanel(refresh));

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
          VN.dom.download('conspiracy-tracker-dados-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(r.json, null, 2), 'application/json');
          note('Exportação descarregada (operação registada em auditoria).', 'ok');
        }
      }),
      el('a', {
        class: 'btn sm', href: '/api/auth/backup', download: '', text: 'Cópia de segurança completa (JSON)',
        title: 'projectos, provas, conclusões, relações, memória e ligações — sem chaves nem palavras-passe'
      }),
      el('button', {
        class: 'btn sm', type: 'button', text: 'Repor a partir de cópia',
        onclick: async () => {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = 'application/json,.json';
          inp.onchange = async () => {
            const file = inp.files && inp.files[0];
            if (!file) return;
            let parsed = null;
            try { parsed = JSON.parse(await file.text()); } catch { return note('Ficheiro não é JSON válido', 'bad'); }
            if (!['conspiracy-tracker-backup/1', 'meridiano-backup/1'].includes(parsed.format))
              return note('Este ficheiro não é uma cópia do Conspiracy Tracker (' + (parsed.format || 'sem formato') + ')', 'bad');
            if (!confirm('Repor ' + ((parsed.projects || []).length) + ' projecto(s) desta cópia? Os projectos são criados de novo (não substituem os existentes).')) return;
            const r = await api('/api/auth/restore', { method: 'POST', body: { backup: parsed } });
            if (!r.ok) return note('Reposição falhou: ' + r.error.message, 'bad');
            const s2 = r.json.restored;
            note('Reposto: ' + s2.projects + ' projecto(s), ' + s2.evidence + ' prova(s), ' + s2.claims + ' conclusão(ões), ' +
              s2.notes + ' nota(s). Chaves de IA não são repostas (reintroduza-as no separador de chaves).', 'ok');
            await refresh();
          };
          inp.click();
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

  /* ---------------- documentos recolhidos: texto extraído para revisão humana ---------------- */
  function documentsPanel(projectId, docs) {
    const f = DRAFT.doc || (DRAFT.doc = { url: '' });
    const root = el('div', {});
    root.appendChild(el('h4', { style: 'margin:16px 0 4px;font-size:12px', text: 'Documentos e texto extraído (' + (docs || []).length + ')' }));
    root.appendChild(el('div', { class: 'warnbox', style: 'margin-bottom:6px' }, [
      el('div', { style: 'font-size:10px;color:var(--muted)', text:
        'Recolher guarda o texto lido e o hash SHA-256 do ficheiro — não cria provas. PDF cifrado não é aberto (não se contorna protecção); ' +
        'digitalizações passam por OCR quando o motor está disponível e a confiança é declarada; um PDF sem mapa de caracteres pode sair com letras erradas. Leia antes de citar.' }),
      el('div', { style: 'font-size:9px;color:var(--muted)', text: (() => {
        const oc = S.meta && S.meta.documents && S.meta.documents.ocr;
        if (!oc) return '';
        return oc.available
          ? 'OCR disponível (' + oc.engine + ' ' + (oc.version || '') + ', ' + (oc.languages || []).join('+') + ', dados ' + (oc.dataSource || '') + ') — apoios de confiança inferior a ' + oc.minConfidence + '/100 são assinalados'
          : 'OCR indisponível: ' + (oc.reason || 'sem motor') + ' — digitalizações ficam registadas como «sem camada de texto»';
      })() }),
      el('div', { class: 'chips', style: 'margin-top:4px' }, [
        el('input', {
          id: 'docUrl', placeholder: 'URL do documento (PDF ou página web)', style: 'width:360px',
          value: f.url || '', oninput: (e) => { f.url = e.target.value; }
        }),
        el('button', {
          id: 'docFetch', class: 'btn sm primary', type: 'button', text: 'Recolher e extrair',
          onclick: async () => {
            const url = String(f.url || '').trim();
            if (!url) return note('Indique o endereço do documento', 'warn');
            const r = await api('/api/projects/' + projectId + '/documents', { method: 'POST', body: { url } });
            if (!r.ok) return note('Recolha recusada: ' + (r.error && r.error.message), 'bad');
            const ex = r.json.extraction || {};
            if (r.json.ok) {
              note('Documento recolhido · ' + (ex.method || '?') + (ex.pages ? ' · ' + ex.pages + ' página(s)' : '') +
                ' · ' + (r.json.document.textChars || 0) + ' caracteres · revisão obrigatória antes de citar', 'ok');
            } else {
              note('Fonte registada como inacessível: ' + (r.json.erro || 'falha na recolha') + ' (fica no registo, não se apaga)', 'warn');
            }
            await reloadDetail();
          }
        })
      ])
    ]));
    if (!(docs || []).length) {
      root.appendChild(el('div', { style: 'font-size:11px;color:var(--muted)', text: 'Nenhum documento recolhido neste projecto.' }));
      return root;
    }
    const box = el('div', {});
    root.appendChild(box);
    box.appendChild(el('table', { class: 'listtable' }, [
      el('thead', {}, [el('tr', {}, ['documento', 'tipo', 'texto', 'revisão', ''].map((h) => el('th', { text: h })))]),
      el('tbody', {}, docs.map((doc) => el('tr', {}, [
        el('td', { style: 'font-size:10px' }, [
          el('b', { text: doc.title || doc.host || doc.url }),
          el('div', { style: 'color:var(--muted)', text: String(doc.canonicalUrl || doc.url).slice(0, 90) }),
          doc.ok ? el('div', { style: 'color:var(--muted)', text: 'hash ' + String(doc.hash || '').slice(0, 12) + '… · ' + (doc.bytes || 0) + ' B' })
            : el('div', { style: 'color:#c66', text: 'inacessível: ' + (doc.error || 'falha') })
        ]),
        el('td', { style: 'font-size:10px' }, [
          el('span', { class: 'tag', text: doc.kind || '?' }),
          doc.extraction && doc.extraction.method === 'ocr' ? el('div', { style: 'font-size:9px;color:#c96', text: 'OCR' + (doc.extraction.confidence != null ? ' ' + doc.extraction.confidence + '/100' : '') }) : null,
          doc.extraction && doc.extraction.usedToUnicode ? el('div', { style: 'font-size:9px;color:var(--muted)', text: 'ToUnicode ✓' }) : null,
          doc.extraction && doc.extraction.imageOnly ? el('div', { style: 'font-size:9px;color:#c66', text: 'só imagem (sem OCR)' }) : null,
          doc.extraction && doc.extraction.encrypted ? el('div', { style: 'font-size:9px;color:#c66', text: 'cifrado' }) : null
        ].filter(Boolean)),
        el('td', { style: 'font-size:10px;color:var(--muted)' }, [
          el('div', { text: doc.textChars ? doc.textChars + ' caracteres' + (doc.extraction && doc.extraction.pages ? ' · ' + doc.extraction.pages + ' pág.' : '') : 'sem texto extraído' }),
          doc.extraction && doc.extraction.warnings && doc.extraction.warnings.length
            ? el('div', { style: 'color:#c96', text: doc.extraction.warnings.length + ' aviso(s) da extracção' }) : null
        ].filter(Boolean)),
        el('td', { style: 'font-size:10px' }, [
          doc.reviewed ? el('span', { class: 'tag ok', text: 'revisto' }) : el('span', { class: 'tag warn', text: 'revisão pendente' })
        ]),
        el('td', {}, [
          doc.ok ? el('button', {
            class: 'btn sm', type: 'button', text: 'Ver texto',
            onclick: async () => {
              const r = await api('/api/documents/' + doc.id);
              if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
              clear(box);
              const dd = r.json.document;
              const w = (dd.extraction && dd.extraction.warnings) || [];
              box.appendChild(el('div', { class: 'warnbox' }, [
                el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [
                  el('b', { style: 'font-size:11px', text: dd.title || dd.host || dd.url }),
                  el('span', { class: 'tag ' + (dd.reviewed ? 'ok' : 'warn'), text: dd.reviewed ? 'revisto' : 'revisão pendente' }),
                  el('span', { style: 'font-size:9px;color:var(--muted)', text: (dd.extraction && dd.extraction.method) || '' })
                ]),
                el('div', { style: 'font-size:9px;color:var(--muted)', text: String(dd.canonicalUrl || dd.url) }),
                w.length ? el('ul', { style: 'font-size:9px;color:#c96;margin:4px 0 0 16px' }, w.map((x) => el('li', { text: x }))) : null,
                /* <textarea> não aceita value por atributo: o texto entra como conteúdo */
                el('textarea', {
                  id: 'docText', style: 'width:100%;height:180px;margin-top:4px;font-family:ui-monospace,monospace;font-size:10px',
                  readonly: ''
                }, [String(dd.text || '')]),
                el('div', { class: 'chips', style: 'margin-top:4px' }, [
                  el('button', {
                    class: 'btn sm', type: 'button', text: 'Usar excerto na nova prova',
                    title: 'preenche o formulário de prova com o excerto seleccionado (ou o início do texto); a prova só é registada quando você a registar',
                    onclick: () => {
                      const ta = box.querySelector('#docText');
                      const sel = ta ? String(ta.value.slice(ta.selectionStart, ta.selectionEnd)).trim() : '';
                      const inicio = String(dd.text || '').slice(0, 280);
                      const excerto = prompt('Excerto exacto que sustenta a alegação (edite e confirme):', sel || inicio);
                      if (excerto == null) return;
                      DRAFT.evidence = Object.assign({}, DRAFT.evidence || {}, {
                        title: dd.title || dd.host || '',
                        originalUrl: dd.canonicalUrl || dd.url,
                        excerpt: excerto,
                        extractionMethod: dd.kind === 'pdf' ? 'pdf' : 'http'
                      });
                      note('Formulário de prova preenchido. Reveja o excerto e registe — o texto extraído não se transforma em prova sozinho.', 'warn');
                      reloadDetail();
                    }
                  }),
                  el('button', {
                    class: 'btn sm', type: 'button', text: dd.reviewed ? 'Anular revisão' : 'Marcar como revisto',
                    onclick: async () => {
                      const r2 = await api('/api/documents/' + dd.id, { method: 'PATCH', body: { reviewed: !dd.reviewed } });
                      if (!r2.ok) return note('Falhou: ' + r2.error.message, 'bad');
                      note(r2.json.document.reviewed ? 'Documento marcado como revisto' : 'Revisão anulada', 'ok');
                      await reloadDetail();
                    }
                  }),
                  el('button', {
                    class: 'btn sm', type: 'button', text: 'Fechar',
                    onclick: () => { clear(box); reloadDetail(); }
                  })
                ])
              ]));
            }
          }) : null,
          el('button', {
            class: 'btn sm', type: 'button', text: 'Remover', style: 'margin-left:4px',
            onclick: async () => {
              if (!confirm('Remover este documento do projecto? O registo de provas que já o citem não é alterado.')) return;
              const r = await api('/api/documents/' + doc.id, { method: 'DELETE', body: {} });
              if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
              note('Documento removido', 'ok'); await reloadDetail();
            }
          })
        ].filter(Boolean))
      ])))
    ]));
    return root;
  }

  /* ---------------- projecto aberto: provas e conclusões ---------------- */

  async function openProject(id) {
    S.report = null;                      // abrir um projecto sai da vista de relatório
    S.path = null;
    DRAFT.memory = DRAFT.memory || { kind: 'nota', title: '', body: '', reason: '' };
    /* o filtro temporal é do projecto: trocar de projecto não herda o recorte do anterior */
    if (!S.detail || !S.detail.project || S.detail.project.id !== id) S.period = { from: '', to: '' };
    const [p, ev, cl, rn] = await Promise.all([
      api('/api/projects/' + id), api('/api/projects/' + id + '/evidence'),
      api('/api/projects/' + id + '/claims'), api('/api/projects/' + id + '/runs')
    ]);
    if (!p.ok) return note('Não foi possível abrir o projecto: ' + (p.error && p.error.message), 'bad');
    const qs = periodQS();
    const gr = await api('/api/projects/' + id + '/graph' + qs);
    const ag = await api('/api/agents');
    const ar = await api('/api/projects/' + id + '/agent-runs');
    const mm = await api('/api/projects/' + id + '/memory');
    S.detail = {
      project: p.json.project, evidence: ev.ok ? ev.json.evidence : [], claims: cl.ok ? cl.json.claims : [],
      runs: rn.ok ? rn.json.runs : [], profiles: rn.ok ? rn.json.profiles : ['rapida', 'normal', 'profunda', 'exaustiva'],
      steps: rn.ok ? rn.json.steps : [],
      graph: gr.ok ? gr.json : null,
      agents: ag.ok ? ag.json.agents : [],
      agentRuns: ar.ok ? ar.json.runs : [],
      agentQuotas: ar.ok ? (ar.json.quotas || {}) : {},
      quotaRules: ar.ok ? ar.json.quotaRules : null,
      memoryKinds: mm.ok ? mm.json.kinds : null,
      memory: mm.ok ? mm.json.notes : []
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

  /* filtro temporal: os parâmetros têm nomes próprios para não colidirem com
     «from»/«to», que no grafo são ids de entidades do cálculo de caminho */
  function periodQS() {
    const f = S.period || {};
    const parts = [];
    if (f.from) parts.push('periodFrom=' + encodeURIComponent(f.from));
    if (f.to) parts.push('periodTo=' + encodeURIComponent(f.to));
    return parts.length ? '?' + parts.join('&') : '';
  }
  async function reloadGraph(projectId) {
    const r = await api('/api/projects/' + projectId + '/graph' + periodQS());
    if (!r.ok) return note('Grafo: ' + (r.error && r.error.message), 'bad');
    if (S.detail) S.detail.graph = r.json;
    paint();
  }

  function paintProjectDetail(root) {
    const d = S.detail, p = d.project;
    root.appendChild(el('div', { class: 'chips', style: 'margin-bottom:6px' }, [
      el('button', { class: 'btn sm', type: 'button', text: '← Todos os projectos', onclick: () => { S.detail = null; S.report = null; S.path = null; paint(); } }),
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

    /* grafo das provas */
    root.appendChild(el('h4', { style: 'margin:16px 0 4px;font-size:12px', text: 'Grafo das provas' }));
    if (!d.graph) {
      root.appendChild(el('div', { class: 'warnbox', text: 'Grafo indisponível.' }));
    } else {
      const gg = d.graph.graph;
      root.appendChild(el('div', { style: 'font-size:10px;color:var(--muted);margin-bottom:4px', text:
        gg.stats.nodes + ' entidades · ' + gg.stats.edges + ' relações (' + gg.stats.edgesCorroborated + ' corroboradas, ' +
        gg.stats.edgesWithSingleOrigin + ' com uma só origem, ' + gg.stats.inferred + ' inferidas) · ' +
        gg.stats.candidates + ' co-ocorrência(s) não desenhada(s) como relação · ' +
        gg.stats.entitiesWithoutDisambiguator + ' entidade(s) sem desambiguador' }));
      /* filtro temporal + exportação */
      const gflt = (d.graph && d.graph.filter) || { applied: false };
      root.appendChild(el('div', { class: 'chips', style: 'margin:6px 0 2px' }, [
        el('span', { style: 'font-size:10px;color:var(--muted)', text: 'período:' }),
        el('input', {
          id: 'graphFrom', placeholder: 'de AAAA-MM-DD', value: (S.period && S.period.from) || '', style: 'width:120px',
          oninput: (e) => { S.period.from = e.target.value.trim(); }
        }),
        el('input', {
          id: 'graphTo', placeholder: 'até AAAA-MM-DD', value: (S.period && S.period.to) || '', style: 'width:120px',
          oninput: (e) => { S.period.to = e.target.value.trim(); }
        }),
        el('button', {
          class: 'btn sm', type: 'button', text: 'Aplicar filtro',
          onclick: async () => { await reloadGraph(p.id); }
        }),
        gflt.applied ? el('button', {
          class: 'btn sm', type: 'button', text: 'Limpar filtro',
          onclick: async () => { S.period = { from: '', to: '' }; await reloadGraph(p.id); }
        }) : null,
        el('span', { style: 'font-size:10px;color:var(--muted);margin-left:8px', text: 'exportar:' }),
        el('a', { class: 'btn sm', href: '/api/projects/' + p.id + '/graph/export?format=json' + periodQS().replace('?', '&'), download: '', text: 'JSON' }),
        el('a', { class: 'btn sm', href: '/api/projects/' + p.id + '/graph/export?format=svg' + periodQS().replace('?', '&'), download: '', text: 'SVG' }),
        el('a', { class: 'btn sm', href: '/api/projects/' + p.id + '/graph/export?format=dot' + periodQS().replace('?', '&'), download: '', text: 'DOT' }),
        el('button', {
          id: 'graphPng', class: 'btn sm', type: 'button', text: 'PNG',
          onclick: () => {
            if (!S.graphView || !VN.evidenceGraph || !VN.evidenceGraph.exportPng) return note('Desenho indisponível para PNG', 'warn');
            const okPng = VN.evidenceGraph.exportPng(S.graphView.svg, 'conspiracy-tracker-' + p.id + '-grafo.png');
            if (okPng === false) return note('O browser recusou gerar a imagem PNG: utilize a exportação SVG', 'warn');
          }
        })
      ].filter(Boolean)));
      if (gflt.applied) {
        root.appendChild(el('div', { style: 'font-size:10px;color:var(--muted)', text:
          'filtro activo ' + (gflt.from || '—') + ' a ' + (gflt.to || '—') + ' · ' + (gflt.relationsIncluded || 0) + ' relação(ões) dentro · ' +
          (gflt.relationsExcludedByPeriod || 0) + ' fora do período · ' + (gflt.relationsWithoutPeriod || 0) +
          ' sem período declarado (ficam incluídas: não se exclui por data o que não tem data)' }));
      }
      const gbox = el('div', {});
      root.appendChild(gbox);
      const detailBox = el('div', { class: 'warnbox', style: 'margin-top:6px;font-size:10px' });
      root.appendChild(detailBox);
      const showDetail = (sel) => {
        clear(detailBox);
        if (sel.kind === 'edge') {
          const e = sel.data;
          detailBox.appendChild(el('b', { text: e.fromName + ' → ' + e.toName + ' · ' + e.label }));
          detailBox.appendChild(el('div', { text: 'confiança: ' + e.confidence.level + ' — ' + e.confidence.rationale }));
          detailBox.appendChild(el('div', { text: 'provas (' + e.evidenceIds.length + '): ' + e.evidenceIds.map((id) => {
            const found = (d.evidence || []).find((x) => x.id === id);
            return found ? found.title : id;
          }).join(' · ') }));
          if (e.inferred) detailBox.appendChild(el('div', { style: 'color:var(--muted)', text: 'inferência declarada: ' + (e.reasoning || '(sem raciocínio)') }));
          if (e.limitations) detailBox.appendChild(el('div', { style: 'color:var(--muted)', text: 'limitações: ' + e.limitations }));
        } else {
          const n = sel.data;
          detailBox.appendChild(el('b', { text: n.name + ' · ' + n.typeLabel }));
          detailBox.appendChild(el('div', { text: n.disambiguator ? 'identificador: ' + n.disambiguator : 'sem desambiguador: pode ser homónimo de outra entidade com o mesmo nome' }));
          detailBox.appendChild(el('div', { text: 'provas (' + n.evidenceIds.length + '): ' + n.evidenceIds.map((id) => {
            const found = (d.evidence || []).find((x) => x.id === id);
            return found ? found.title : id;
          }).join(' · ') }));
        }
      };
      if (VN.evidenceGraph) {
        S.graphView = VN.evidenceGraph.render(gbox, d.graph, { onSelect: showDetail, width: 820, height: 360 });
      } else {
        gbox.appendChild(el('div', { class: 'warnbox', text: 'Módulo de desenho do grafo não carregado.' }));
      }

      /* criar relação: exige prova, por isso a prova é escolhida aqui */
      const rf2 = DRAFT.rel || (DRAFT.rel = { type: 'subsidiary_of' });
      const evidOptions = (d.evidence || []).filter((x) => !x.retractedAt).map((x) => el('option', { value: x.id, text: x.title.slice(0, 48) }));
      const nodeOptions = () => gg.nodes.map((n) => el('option', { value: n.id, text: n.name.slice(0, 40) }));
      root.appendChild(el('div', { class: 'warnbox', style: 'margin-top:8px' }, [
        el('div', { style: 'font-size:10px;color:var(--muted);margin-bottom:4px', text: 'NOVA RELAÇÃO — sem prova registada não entra no grafo' }),
        el('div', { class: 'chips' }, [
          el('select', { onchange: (e) => { rf2.from = e.target.value; } }, [el('option', { value: '', text: 'de…' })].concat(nodeOptions())),
          el('select', { onchange: (e) => { rf2.to = e.target.value; } }, [el('option', { value: '', text: 'para…' })].concat(nodeOptions())),
          el('select', { onchange: (e) => { rf2.type = e.target.value; } },
            Object.keys(d.graph.relationTypes || {}).map((k) => el('option', { value: k, selected: rf2.type === k, text: (d.graph.relationTypes[k].label || k) })))
        ]),
        el('div', { class: 'chips' }, [
          el('select', { onchange: (e) => { rf2.evidenceId = e.target.value; } },
            [el('option', { value: '', text: 'prova que sustenta…' })].concat(evidOptions)),
          el('button', {
            class: 'btn sm primary', type: 'button', text: 'Registar relação',
            onclick: async () => {
              const from = gg.nodes.find((n) => n.id === rf2.from);
              const to = gg.nodes.find((n) => n.id === rf2.to);
              const r = await api('/api/projects/' + p.id + '/relations', {
                method: 'POST',
                body: {
                  from: from ? from.name : rf2.from, to: to ? to.name : rf2.to, type: rf2.type,
                  fromDisambiguator: from ? from.disambiguator : null, toDisambiguator: to ? to.disambiguator : null,
                  evidenceIds: rf2.evidenceId ? [rf2.evidenceId] : []
                }
              });
              if (!r.ok) return note('Recusada: ' + (r.error.errors || [r.error.message]).join('; '), 'bad');
              note('Relação registada com prova: ' + r.json.relation.type, 'ok');
              await reloadDetail();
            }
          })
        ])
      ]));
    }

    /* contradições */
    const contrad = (d.graph && d.graph.contradicoes) || [];
    root.appendChild(el('h4', { style: 'margin:16px 0 4px;font-size:12px', text: 'Contradições (' + contrad.length + ')' }));
    if (!contrad.length) {
      root.appendChild(el('div', { style: 'font-size:11px;color:var(--muted)', text: 'Nenhuma contradição registada entre provas ligadas. A ausência de contradição não é confirmação: é uma lacuna por preencher.' }));
    } else {
      contrad.forEach((c) => {
        root.appendChild(el('div', { class: 'warnbox', style: 'margin:4px 0;font-size:11px' }, [
          el('span', { class: 'tag bad', text: c.tipo }),
          el('b', { text: ' ' + c.descricao }),
          el('div', { style: 'font-size:10px;color:var(--muted)', text: c.provas.map((p) => (p.posicao === 'contraria' ? '✗ ' : '✓ ') + (p.titulo || p.id)).join(' · ') })
        ]));
      });
    }

    /* cronologia */
    const tl = (d.graph && d.graph.timeline) || { eventos: [] };
    root.appendChild(el('h4', { style: 'margin:16px 0 4px;font-size:12px', text: 'Cronologia (' + (tl.total || 0) + ')' }));
    if (!tl.total) {
      root.appendChild(el('div', { style: 'font-size:11px;color:var(--muted)', text: tl.nota || 'Sem datas registadas: nada a ordenar.' }));
    } else {
      root.appendChild(el('table', { class: 'listtable' }, [
        el('thead', {}, [el('tr', {}, ['data', 'tipo', 'evento', ''].map((x) => el('th', { text: x })))]),
        el('tbody', {}, tl.eventos.slice(0, 30).map((e) => el('tr', {}, [
          el('td', { style: 'font-size:10px', text: String(e.data).slice(0, 10) }),
          el('td', { style: 'font-size:10px', text: e.tipo }),
          el('td', { style: 'font-size:10px', text: e.titulo }),
          el('td', { style: 'font-size:9px;color:var(--muted)', text: e.prova || e.relacao || '' })
        ])))
      ]));
    }

    /* caminho entre entidades, com restrições */
    if (d.graph && d.graph.graph && d.graph.graph.nodes.length > 1) {
      const pf = DRAFT.path || (DRAFT.path = {});
      root.appendChild(el('h4', { style: 'margin:16px 0 4px;font-size:12px', text: 'Caminho entre entidades' }));
      root.appendChild(el('div', { class: 'chips' }, [
        el('select', { id: 'pathFrom', onchange: (e) => { pf.from = e.target.value; } },
          [el('option', { value: '', text: 'de…' })].concat(d.graph.graph.nodes.map((n) => el('option', { value: n.id, text: n.name })))),
        el('select', { id: 'pathTo', onchange: (e) => { pf.to = e.target.value; } },
          [el('option', { value: '', text: 'para…' })].concat(d.graph.graph.nodes.map((n) => el('option', { value: n.id, text: n.name })))),
        el('button', {
          class: 'btn sm', type: 'button', text: 'Procurar caminho',
          onclick: async () => {
            if (!pf.from || !pf.to) return note('Escolha as duas entidades', 'warn');
            const q = [];
            if (pf.type) q.push('pathTypes=' + encodeURIComponent(pf.type));
            if (pf.noInferred) q.push('pathExcludeInferred=1');
            if (pf.notBefore) q.push('pathNotBefore=' + encodeURIComponent(pf.notBefore));
            if (pf.notAfter) q.push('pathNotAfter=' + encodeURIComponent(pf.notAfter));
            const r = await api('/api/projects/' + p.id + '/graph?from=' + encodeURIComponent(pf.from) +
              '&to=' + encodeURIComponent(pf.to) + (q.length ? '&' + q.join('&') : ''));
            if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
            S.path = r.json.caminho;
            paint();
          }
        })
      ]));
      /* restrições: opcionais, e sempre visíveis na resposta */
      const relTypes = Object.keys(d.graph.relationTypes || {});
      root.appendChild(el('div', { class: 'chips', style: 'margin-top:4px' }, [
        el('span', { style: 'font-size:9px;color:var(--muted)', text: 'restrições:' }),
        el('select', { id: 'pathType', onchange: (e) => { pf.type = e.target.value; } },
          [el('option', { value: '', text: 'todas as relações' })].concat(relTypes.map((k) =>
            el('option', { value: k, selected: pf.type === k, text: (d.graph.relationTypes[k].label || k) })))),
        el('input', { id: 'pathNotBefore', placeholder: 'de AAAA-MM-DD', value: pf.notBefore || '', style: 'width:110px', oninput: (e) => { pf.notBefore = e.target.value.trim(); } }),
        el('input', { id: 'pathNotAfter', placeholder: 'até AAAA-MM-DD', value: pf.notAfter || '', style: 'width:110px', oninput: (e) => { pf.notAfter = e.target.value.trim(); } }),
        el('label', { style: 'font-size:9px;color:var(--muted);display:flex;gap:4px;align-items:center' }, [
          el('input', { id: 'pathNoInferred', type: 'checkbox', onchange: (e) => { pf.noInferred = e.target.checked; } }),
          el('span', { text: 'excluir relações inferidas' })
        ])
      ]));
      if (S.path) {
        if (!S.path.found) {
          root.appendChild(el('div', { class: 'warnbox', style: 'font-size:11px', text: 'Sem caminho: ' + S.path.reason }));
        } else {
          const r = S.path.restricoes || {};
          root.appendChild(el('div', { class: 'warnbox', style: 'font-size:11px' }, [
            el('b', { text: S.path.saltos + ' salto(s)' }),
            r.aplicadas ? el('div', { style: 'font-size:9px;color:var(--muted)', text:
              'restrições aplicadas · ' + r.arestasUsadas + ' de ' + r.arestasNoGrafo + ' relações usáveis (' + r.arestasExcluidas + ' excluídas)' +
              (r.tipos ? ' · tipos: ' + r.tipos.join(', ') : '') + (r.excluirInferidas ? ' · sem inferências' : '') }) : null,
            el('div', { style: 'font-size:10px;color:var(--muted)', text: S.path.aviso }),
            ...S.path.passos.map((st) => el('div', { style: 'font-size:10px;margin-top:3px' }, [
              el('b', { text: st.de + ' → ' + st.para }),
              el('span', { text: ' · ' + st.tipo + ' · ' + st.confianca.level + ' · ' + st.provas.length + ' prova(s)' + (st.inferida ? ' · inferida' : '') })
            ]))
          ].filter(Boolean)));
        }
      }
    }

    /* fusão de homónimos com identificador */
    if (d.graph && d.graph.graph) {
      const gg2 = d.graph.graph;
      const lk = DRAFT.link || (DRAFT.link = {});
      root.appendChild(el('h4', { style: 'margin:16px 0 4px;font-size:12px', text: 'Homónimos: fundir com identificador' }));
      root.appendChild(el('div', { style: 'font-size:10px;color:var(--muted);margin-bottom:4px', text:
        'O grafo nunca junta dois nomes iguais por parecerem a mesma pessoa. Só funde quando é declarado o identificador que o prova (NIPC, LEI, registo). A ligação é reversível e fica na auditoria.' }));
      root.appendChild(el('div', { class: 'chips' }, [
        el('select', { id: 'linkFrom', onchange: (e) => { lk.from = e.target.value; } },
          [el('option', { value: '', text: 'entrada a fundir…' })].concat(gg2.nodes.map((n) => el('option', { value: n.id, text: n.name })))),
        el('select', { id: 'linkTo', onchange: (e) => { lk.to = e.target.value; } },
          [el('option', { value: '', text: 'entidade de referência…' })].concat(gg2.nodes.map((n) => el('option', { value: n.id, text: n.name })))),
        el('input', { id: 'linkIdentifier', placeholder: 'identificador (NIPC, LEI…)', value: lk.identifier || '', oninput: (e) => { lk.identifier = e.target.value; } }),
        el('input', { id: 'linkReason', placeholder: 'motivo', value: lk.reason || '', oninput: (e) => { lk.reason = e.target.value; } }),
        el('button', {
          class: 'btn sm', type: 'button', text: 'Fundir',
          onclick: async () => {
            const find = (key) => gg2.nodes.find((n) => n.id === key);
            const a2 = find(lk.from), b2 = find(lk.to);
            if (!a2 || !b2) return note('Escolha as duas entradas', 'warn');
            const r = await api('/api/projects/' + p.id + '/entities/link', { method: 'POST', body: {
              from: { name: a2.name, disambiguator: a2.disambiguator }, to: { name: b2.name, disambiguator: b2.disambiguator },
              identifier: lk.identifier, reason: lk.reason
            } });
            if (!r.ok) return note('Fusão recusada: ' + r.error.message, 'bad');
            note('Entidades fundidas com identificador ' + r.json.link.identifier + ' (reversível).', 'ok');
            await reloadDetail();
          }
        })
      ]));
      const links2 = gg2.entityLinks || [];
      if (links2.length) {
        root.appendChild(el('div', { class: 'warnbox', style: 'font-size:10px;margin-top:4px' }, [
          el('b', { text: 'Ligações declaradas (' + links2.length + ')' }),
          ...links2.map((l) => el('div', { style: 'display:flex;gap:6px;align-items:center;margin-top:2px' }, [
            el('span', { text: (l.from && l.from.name) + ' = ' + (l.to && l.to.name) + ' · ' + l.identifier + ' · ' + l.reason }),
            el('button', {
              class: 'btn sm', type: 'button', text: 'Desfazer', style: 'margin-left:auto',
              onclick: async () => {
                const reason = prompt('Motivo para desfazer a ligação:', '');
                if (!reason) return;
                const r = await api('/api/entity-links/' + l.id, { method: 'DELETE', body: { reason } });
                if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
                await reloadDetail();
              }
            })
          ]))
        ]));
      }
    }

    /* agentes */
    root.appendChild(el('h4', { style: 'margin:16px 0 4px;font-size:12px', text: 'Agentes (' + (d.agents || []).length + ')' }));
    root.appendChild(el('div', { style: 'font-size:10px;color:var(--muted);margin-bottom:4px', text: 'Agentes locais analisam o que está registado. Agentes de IA exigem chave validada e devolvem propostas — nunca escrevem conclusões nem promovem hipóteses a facto.' }));
    const runsByAgent = {};
    (d.agentRuns || []).forEach((r) => { runsByAgent[r.agentId] = r; });
    root.appendChild(el('table', { class: 'listtable' }, [
      el('thead', {}, [el('tr', {}, ['agente', 'tipo', 'última execução', 'orçamento', ''].map((x) => el('th', { text: x })))]),
      el('tbody', {}, (d.agents || []).map((ag) => {
        const last = runsByAgent[ag.id];
        return el('tr', {}, [
          el('td', { style: 'font-size:11px' }, [el('b', { text: ag.name }), el('div', { style: 'font-size:9px;color:var(--muted)', text: ag.contract.out.join(' · ') })]),
          el('td', {}, [el('span', { class: 'tag ' + (ag.kind === 'local' ? 'ok' : 'warn'), text: ag.kind })]),
          el('td', { style: 'font-size:10px' }, [
            last ? el('span', { class: 'tag ' + (last.status === 'concluido' ? 'ok' : last.status === 'nao-executado' ? 'warn' : 'bad'), text: last.status }) : el('span', { style: 'color:var(--muted)', text: 'nunca executado' }),
            last && last.reason ? el('div', { style: 'font-size:9px;color:var(--muted)', text: last.reason.slice(0, 80) }) : null,
            last && last.findings ? el('div', { style: 'font-size:9px;color:var(--muted)', text: last.findings.length + ' achado(s)' }) : null
          ].filter(Boolean)),
          (() => {
            const q = (d.agentQuotas || {})[ag.id];
            if (!q) return el('td', {});
            return el('td', { style: 'font-size:9px;color:var(--muted)' }, [
              el('div', { text: q.remaining + '/' + q.limits.perAgentPerProject + ' restantes (24 h)' }),
              q.warn ? el('div', { style: 'color:var(--warn,#b45309)', text: q.warn }) : null
            ].filter(Boolean));
          })(),
          el('td', {}, [el('button', {
            class: 'btn sm', type: 'button', text: 'Executar',
            onclick: async () => {
              const r = await api('/api/projects/' + p.id + '/agents/' + ag.id + '/run', { method: 'POST', body: {} });
              if (r.status === 429) return note('Limite: ' + r.error.message, 'warn');
              if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
              const run = r.json.run;
              note(ag.name + ': ' + run.status + (run.reason ? ' — ' + run.reason : '') +
                (run.findings ? ' · ' + run.findings.length + ' achado(s)' : ''), run.status === 'concluido' ? 'ok' : 'warn');
              await reloadDetail();
            }
          })])
        ]);
      }))
    ]));
    const ultimoAuditor = runsByAgent['red-team'];
    if (ultimoAuditor && ultimoAuditor.findings && ultimoAuditor.findings.length) {
      root.appendChild(el('div', { class: 'warnbox', style: 'margin-top:6px' }, [
        el('b', { style: 'font-size:11px', text: 'Achados do auditor adversário (' + ultimoAuditor.findings.length + ')' }),
        ...ultimoAuditor.findings.slice(0, 12).map((f) => el('div', { style: 'font-size:10px;margin-top:2px' }, [
          el('span', { class: 'tag ' + (f.severity === 'alta' ? 'bad' : f.severity === 'media' ? 'warn' : 'muted'), text: f.severity }),
          el('span', { text: ' ' + f.code + ' — ' + f.message })
        ]))
      ]));
    }

    /* memória da investigação */
    const kinds = d.memoryKinds || { nota: { label: 'Nota' }, decisao: { label: 'Decisão' }, glossario: { label: 'Glossário' }, lacuna: { label: 'Lacuna' }, correcao: { label: 'Correcção' } };
    const notes = d.memory || [];
    const mf = DRAFT.memory || (DRAFT.memory = { kind: 'nota', title: '', body: '', reason: '' });
    root.appendChild(el('h4', { style: 'margin:16px 0 4px;font-size:12px', text: 'Memória da investigação (' + notes.length + ')' }));
    root.appendChild(el('div', { style: 'font-size:10px;color:var(--muted);margin-bottom:4px', text:
      'O que não pode depender de alguém se lembrar: decisões com motivo, vocabulário, lacunas e correcções. A memória explica; não altera estados de conclusões nem cria provas.' }));
    if (notes.length) {
      notes.filter((n) => !n.archivedAt).slice(0, 20).forEach((n) => {
        root.appendChild(el('div', { class: 'warnbox', style: 'margin:4px 0' }, [
          el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [
            el('span', { class: 'tag ' + (n.kind === 'lacuna' ? 'warn' : n.kind === 'correcao' ? 'bad' : 'ok'), text: (kinds[n.kind] && kinds[n.kind].label) || n.kind }),
            el('b', { style: 'font-size:11px', text: n.title }),
            n.pinned ? el('span', { class: 'tag', text: 'fixada' }) : null,
            el('span', { style: 'font-size:9px;color:var(--muted)', text: String(n.createdAt || '').slice(0, 10) }),
            el('button', {
              class: 'btn sm', type: 'button', text: 'Arquivar', style: 'margin-left:auto',
              onclick: async () => {
                const reason = prompt('Motivo para arquivar esta entrada (fica registado):', '');
                if (!reason) return;
                const r = await api('/api/memory/' + n.id, { method: 'DELETE', body: { reason } });
                if (!r.ok) return note('Falhou: ' + r.error.message, 'bad');
                await reloadDetail();
              }
            })
          ].filter(Boolean)),
          el('div', { style: 'font-size:10px;margin-top:2px', text: n.body }),
          n.reason ? el('div', { style: 'font-size:9px;color:var(--muted)', text: 'motivo: ' + n.reason }) : null,
          (n.links && (n.links.evidenceIds || []).length) ? el('div', { style: 'font-size:9px;color:var(--muted)', text: 'ligada a ' + n.links.evidenceIds.length + ' prova(s)' }) : null
        ].filter(Boolean)));
      });
      const archived = notes.filter((n) => n.archivedAt).length;
      if (archived) root.appendChild(el('div', { style: 'font-size:9px;color:var(--muted)', text: archived + ' entrada(s) arquivada(s) — conservadas no histórico, fora da vista.' }));
    } else {
      root.appendChild(el('div', { style: 'font-size:11px;color:var(--muted)', text: 'Sem entradas: nenhuma decisão registada ainda.' }));
    }
    root.appendChild(el('div', { class: 'warnbox', style: 'margin-top:6px' }, [
      el('div', { class: 'chips' }, [
        el('select', { id: 'memKind', onchange: (e) => { mf.kind = e.target.value; paint(); } },
          Object.keys(kinds).map((k) => el('option', { value: k, selected: mf.kind === k, text: kinds[k].label }))),
        el('input', { id: 'memTitle', placeholder: 'título', value: mf.title || '', style: 'flex:1;min-width:180px', oninput: (e) => { mf.title = e.target.value; } })
      ]),
      el('textarea', {
        id: 'memBody', placeholder: 'o que fica registado', value: mf.body || '',
        style: 'width:100%;min-height:52px;margin-top:4px',
        oninput: (e) => { mf.body = e.target.value; }
      }),
      ['decisao', 'correcao'].includes(mf.kind) ? el('input', {
        id: 'memReason', placeholder: 'motivo / fundamento (obrigatório)', value: mf.reason || '', style: 'width:100%;margin-top:4px',
        oninput: (e) => { mf.reason = e.target.value; }
      }) : null,
      el('button', {
        class: 'btn sm primary', type: 'button', text: 'Registar na memória', style: 'margin-top:4px',
        onclick: async () => {
          const r = await api('/api/projects/' + p.id + '/memory', { method: 'POST', body: {
            kind: mf.kind, title: mf.title, body: mf.body, reason: mf.reason
          } });
          if (!r.ok) return note('Recusado: ' + r.error.message, 'bad');
          DRAFT.memory = { kind: 'nota', title: '', body: '', reason: '' };
          note('Registado na memória (' + r.json.note.kind + ').', 'ok');
          await reloadDetail();
        }
      })
    ].filter(Boolean)));

    /* resumo descarregável */
    root.appendChild(el('h4', { style: 'margin:16px 0 4px;font-size:12px', text: 'Resumo da investigação' }));
    root.appendChild(el('div', { style: 'font-size:10px;color:var(--muted);margin-bottom:4px', text:
      'Descarrega o resumo construído a partir dos dados registados. Um resumo não é prova: cada conclusão traz o estado atribuído, o estado que as provas sustentam e o número de origens independentes.' }));
    root.appendChild(el('div', { class: 'chips' }, ['pdf', 'md', 'csv', 'json'].map((f) => el('a', {
      class: 'btn sm' + (f === 'pdf' ? ' primary' : ''), href: '/api/projects/' + p.id + '/summary?format=' + f,
      download: '', text: 'Resumo ' + f.toUpperCase()
    })).concat([
      el('button', {
        id: 'memMd', class: 'btn sm', type: 'button', text: 'Memória (MD)',
        onclick: async () => {
          const r = await fetch('/api/projects/' + p.id + '/memory?format=md', { credentials: 'same-origin' });
          if (!r.ok) return note('Memória indisponível', 'bad');
          VN.dom.download('conspiracy-tracker-memoria-' + p.id + '.md', await r.text(), 'text/markdown');
          note('Memória descarregada em Markdown.', 'ok');
        }
      })
    ])));

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

    /* documentos recolhidos (o texto alimenta a revisão humana das provas) */
    root.appendChild(documentsPanel(p.id, d.project.documents || []));

    /* provas */
    root.appendChild(el('h4', { style: 'margin:16px 0 4px;font-size:12px', text: 'Registo de provas (' + d.evidence.length + ')' }));
    root.appendChild(el('div', { style: 'font-size:10px;color:var(--muted);margin-bottom:4px', text: 'Cópias do mesmo comunicado contam como UMA origem: a corroboração usa origens independentes, não ficheiros.' }));
    root.appendChild(el('div', { class: 'chips', style: 'margin-bottom:4px' }, [
      el('button', {
        id: 'checkAccessBulk', class: 'btn sm', type: 'button', text: 'Verificar acesso (até 5)',
        onclick: async () => {
          const r = await api('/api/projects/' + p.id + '/check-access', { method: 'POST', body: { limit: 5 } });
          if (!r.ok) return note('Verificação: ' + (r.error && r.error.message), 'bad');
          const c = r.json.counts || {};
          note('Verificadas ' + r.json.checked + ': ' + Object.keys(c).map((k) => k + ' ' + c[k]).join(' · ') +
            (r.json.skipped.withoutUrl ? ' · ' + r.json.skipped.withoutUrl + ' sem URL' : '') +
            ' — não altera estados de validação', 'warn');
          await reloadDetail();
        }
      }),
      el('span', { style: 'font-size:9px;color:var(--muted)', text: 'verificação de uma página por prova, sem contornar barreiras e sem guardar conteúdo' })
    ]));
    if (d.evidence.length) {
      root.appendChild(el('table', { class: 'listtable' }, [
        el('thead', {}, [el('tr', {}, ['prova', 'tipo', 'posição', 'origem', 'estado', 'acesso', 'verificada', ''].map((h) => el('th', { text: h })))]),
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
          el('td', { style: 'font-size:9px' }, (() => {
            const ac = ev.access;
            if (!ac) return [el('span', { style: 'color:var(--muted)', text: 'não verificado' })];
            const cls = ac.status === 'acessivel' ? 'ok' : ac.status === 'inacessivel' ? 'bad' : 'warn';
            return [
              el('span', { class: 'tag ' + cls, text: ac.stateLabel || ac.status }),
              el('div', { style: 'color:var(--muted)', text: (ac.httpStatus ? 'HTTP ' + ac.httpStatus + ' · ' : '') + String(ac.checkedAt || '').slice(0, 10) }),
              ac.reason ? el('div', { style: 'color:var(--muted)', text: ac.reason.slice(0, 60) }) : null
            ].filter(Boolean);
          })()),
          el('td', { style: 'font-size:10px', text: ev.verificationDate ? ev.verificationDate.slice(0, 10) : '—' }),
          el('td', {}, [ev.retractedAt ? null : el('button', {
            class: 'btn sm', type: 'button', text: 'Acesso',
            title: 'verifica agora se a fonte responde (sem contornar barreiras)',
            onclick: async () => {
              const r = await api('/api/evidence/' + ev.id + '/check-access', { method: 'POST', body: {} });
              if (!r.ok) return note('Verificação: ' + (r.error && r.error.message), 'bad');
              const c = r.json.check;
              note('Acesso: ' + (c.stateLabel || c.status) + (c.reason ? ' — ' + c.reason : '') +
                (r.json.suggestion && r.json.suggestion.suggestion ? ' · sugestão: ' + r.json.suggestion.suggestion + ' (decisão humana)' : ''),
                c.status === 'acessivel' ? 'ok' : 'warn');
              await reloadDetail();
            }
          }), ev.retractedAt ? null : el('button', {
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
      mk('Entidades (Nome|tipo|desambiguador; vírgula entre entidades)', {
        name: 'entities', placeholder: 'Sociedade X|company|NIPC 500000000, Y Participações|company',
        oninput: (e) => { f.entities = e.target.value; }
      }),
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
            const entities = String(f.entities || '').split(',').map((chunk) => {
              const parts = chunk.split('|').map((x) => x.trim());
              if (!parts[0]) return null;
              const out = { name: parts[0] };
              if (parts[1]) out.type = parts[1];
              if (parts[2]) out.disambiguator = parts[2];
              return out;
            }).filter(Boolean);
            const body = {
              title: f.title, originalUrl: f.originalUrl || null, excerpt: f.excerpt,
              sourceType: f.sourceType, stance: f.stance, extractionMethod: f.extractionMethod,
              syndicationOf: f.syndicationOf || null,
              entities, language: 'pt'
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

    /* ---- chaves do operador: o que existe no ambiente do servidor (Render) ---- */
    const op = S.operatorKeys;
    if (op) {
      const ativo = op.activo;
      root.appendChild(el('div', { class: 'warnbox', style: 'margin:8px 0', 'data-vn': 'chaves-operador' }, [
        el('b', { text: 'Chaves do operador (servidor): ' }),
        el('span', { text: ativo
          ? 'activa — ' + ativo.provider + (ativo.modelo ? ' · ' + ativo.modelo : '') + (ativo.keyless ? ' (sem chave, serviço público)' : '')
          : 'nenhuma chave de servidor e fallback sem chave desligado. Sem chave tua, a análise por IA não corre.' }),
        el('div', { style: 'font-size:10px;color:var(--muted);margin-top:4px', text: 'As chaves do servidor são variáveis de ambiente (Render → Environment). Uma por fornecedor; o valor nunca é mostrado aqui, só o estado. Um valor começado por «SUBSTITUIR» conta como não configurado.' })
      ]));
      const linhas = Object.keys(op.providers || {}).map((id) => {
        const v = op.providers[id];
        const est = v.keyless ? 'sem chave' : v.estado === 'ok' ? 'configurada' : v.estado === 'marcador' ? 'por preencher' : 'ausente';
        return el('tr', {}, [
          el('td', { style: 'font-size:11px' }, [el('b', { text: v.label || id }), el('div', { style: 'color:var(--muted);font-size:10px', text: v.freeTier || '' })]),
          el('td', { style: 'font-family:monospace;font-size:10px', text: v.env || '—' }),
          el('td', {}, [el('span', { class: 'tag ' + (v.estado === 'ok' || v.keyless ? 'ok' : v.estado === 'marcador' ? 'warn' : 'muted'), text: est })]),
          el('td', { style: 'font-size:10px' }, [v.keyUrl
            ? el('a', { href: v.keyUrl, target: '_blank', rel: 'noopener noreferrer', style: 'color:var(--accent)', text: 'obter chave ↗' })
            : el('span', { style: 'color:var(--muted)', text: 'não precisa' })])
        ]);
      });
      root.appendChild(el('table', { class: 'listtable', 'data-vn': 'tabela-operador' }, [
        el('thead', {}, [el('tr', {}, ['Fornecedor', 'variável no Render', 'estado', 'chave'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, linhas)
      ]));
    }

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
        el('td', { style: 'font-size:11px' }, [el('b', { text: p.label }), el('div', { style: 'color:var(--muted);font-size:10px', text: p.freeTier || '' }),
          p.keyUrl ? el('a', { href: p.keyUrl, target: '_blank', rel: 'noopener noreferrer', style: 'font-size:10px;color:var(--accent)', text: 'obter chave ↗' }) : null].filter(Boolean)),
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
