/* =====================================================================
   PORTA DE ENTRADA — autenticação obrigatória antes de qualquer dado

   Porque existe: as rotas do servidor já recusam quem não tem sessão, mas a
   aplicação abria na mesma e mostrava o grafo vazio. Isso dá a impressão de
   um site público com dados em falta, quando o que existe é uma plataforma
   privada. Aqui a regra é uma só: sem sessão válida, não se desenha nada.

   O que esta camada NÃO faz: decidir permissões. Quem decide é o servidor.
   Aqui só se pergunta «quem sou eu?» (/api/auth/me), se apresentam as
   mensagens reais de erro (401, 403, 429, 503) e se conduz o utilizador pelo
   que o servidor exigir: segundo factor (MFA) e troca de palavra-passe
   temporária.

   Estados possíveis: 'verificando' → 'entrar' | 'mfa' | 'trocar' | 'dentro'
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const el = (tag, attrs, kids) => VN.dom.el(tag, attrs, kids || []);

  let S = {
    estado: 'verificando',   // verificando | entrar | mfa | trocar | dentro
    me: null, csrf: null, meta: null,
    email: '', password: '', code: '', recoveryCode: '',
    novaPassword: '', novaPassword2: '',
    desafio: null,           // { token, email, methods, expiresAt }
    msg: null, busy: false, erroRede: null, tentativas: 0
  };
  let raiz = null;
  let aoEntrar = null;

  const api = async (caminho, opts) => {
    opts = opts || {};
    const headers = { accept: 'application/json' };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (S.csrf && opts.method && opts.method !== 'GET') headers['x-csrf-token'] = S.csrf;
    let res;
    try {
      res = await fetch(caminho, {
        method: opts.method || 'GET', headers, credentials: 'same-origin',
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
      });
    } catch (e) {
      /* rede em baixo não é «credenciais inválidas»: é outro estado e diz-se */
      return { status: 0, ok: false, erroRede: String(e.message || e), json: {} };
    }
    const json = await res.json().catch(() => ({}));
    if (json && json.csrf) S.csrf = json.csrf;
    return { status: res.status, ok: res.ok, json, erro: json && json.error };
  };

  function motivo(r) {
    if (r.status === 0) return 'servidor inacessível: ' + (r.erroRede || 'sem rede');
    if (r.json && r.json.error && r.json.error.message) return r.json.error.message;
    if (r.json && r.json.reason) return r.json.reason + (r.json.how ? ' — ' + r.json.how : '');
    return 'resposta inesperada do servidor (HTTP ' + r.status + ')';
  }

  /* ---------------- vigia de sessão ----------------
     Qualquer pedido à API que devolva 401 depois de haver sessão significa que
     ela deixou de valer (expirou, foi revogada noutro dispositivo, ou a conta
     foi suspensa). Em vez de deixar o ecrã a mostrar dados velhos, a aplicação
     volta à porta de entrada e diz porquê. Um só ponto, para todos os módulos. */
  let vigiaInstalado = false;
  let aVerificar = null;          // uma confirmação de sessão de cada vez
  let ultimaVerificacao = 0;
  function instalarVigia() {
    if (vigiaInstalado || typeof g.fetch !== 'function') return;
    vigiaInstalado = true;
    const original = g.fetch.bind(g);
    g.fetch = async function (recurso, opcoes) {
      const res = await original(recurso, opcoes);
      try {
        const url = typeof recurso === 'string' ? recurso : (recurso && recurso.url) || '';
        const mesmaOrigem = !/^https?:\/\//i.test(url) || url.indexOf(g.location.origin) === 0;
        const daApi = /(^|\/)api\//.test(url);
        /* Só interessa o 401 da API e apenas quando já há sessão. Mas um 401
           pode não ser da sessão: rotas com token próprio (cron), palavra-passe
           errada, código de segundo factor recusado — todas devolvem 401. Por
           isso não se decide pelo primeiro 401: pergunta-se a quem sabe,
           /api/auth/me, e só se essa também recusar é que a sessão morreu. */
        const rotaDeSessao = /\/api\/auth\/(me|login|logout|password|mfa)/.test(url);
        if (res.status === 401 && mesmaOrigem && daApi && !rotaDeSessao && S.estado === 'dentro') {
          const agora = Date.now();
          if (agora - ultimaVerificacao > 2000) {
            ultimaVerificacao = agora;
            aVerificar = aVerificar || original('api/auth/me', { credentials: 'same-origin', headers: { accept: 'application/json' } })
              .then(async (r) => {
                /* /api/auth/me responde 200 com user:null quando não há sessão
                   (é a pergunta «quem sou eu?», não um erro). Por isso a
                   confirmação lê o corpo, não apenas o código HTTP. */
                const j = await r.json().catch(() => ({}));
                const semSessao = r.status === 401 || !(j && j.user);
                if (semSessao && S.estado === 'dentro') {
                  expirou('a sessão deixou de ser válida (expirou, foi terminada ou a conta foi suspensa): entre novamente');
                }
              })
              .catch(() => {})
              .finally(() => { aVerificar = null; });
          }
        }
      } catch (e) { /* o vigia nunca pode quebrar o pedido original */ }
      return res;
    };
  }

  /* ---------------- arranque ---------------- */
  async function iniciar(callback) {
    aoEntrar = callback;
    instalarVigia();
    raiz = document.createElement('div');
    raiz.id = 'vnGate';
    raiz.setAttribute('role', 'dialog');
    raiz.setAttribute('aria-modal', 'true');
    raiz.setAttribute('aria-label', 'Entrada');
    document.body.appendChild(raiz);
    /* o conteúdo da aplicação não é desenhado enquanto não houver sessão;
       o atributo fica visível a quem inspecciona e é testável */
    document.documentElement.setAttribute('data-vn-auth', 'verificando');
    S.meta = (await api('api/meta')).json || null;
    const r = await api('api/auth/me');
    if (r.ok && r.json && r.json.user) {
      S.me = r.json.user;
      if (S.me.mustChangePassword) { S.estado = 'trocar'; }
      else { entrar(); return; }
    } else {
      S.estado = 'entrar';
    }
    pintar();
  }

  function entrar() {
    S.estado = 'dentro';
    document.documentElement.setAttribute('data-vn-auth', 'autenticado');
    if (raiz) raiz.remove();
    raiz = null;
    if (aoEntrar) aoEntrar(S.me, S.csrf);
  }

  function sair(motivoTexto) {
    /* a mensagem de saída (sessão expirada, por exemplo) não se perde no
       reinício do estado: quem é expulso tem de saber porquê */
    S = Object.assign(S, { estado: 'entrar', me: null, csrf: null, password: '', code: '', recoveryCode: '', novaPassword: '', novaPassword2: '', desafio: null,
      msg: motivoTexto ? { tipo: 'erro', texto: motivoTexto } : null });
    document.documentElement.setAttribute('data-vn-auth', 'por-autenticar');
    if (!raiz) { raiz = document.createElement('div'); raiz.id = 'vnGate'; document.body.appendChild(raiz); }
    pintar();
  }

  /* ---------------- desenho ---------------- */
  function pintar() {
    if (!raiz) return;
    /* o atributo é a única fonte para o CSS e para quem inspecciona:
       tem de seguir o estado real, não o momento em que a porta foi criada */
    const mapa = { verificando: 'verificando', entrar: 'por-autenticar', mfa: 'por-autenticar', trocar: 'por-autenticar', dentro: 'autenticado' };
    document.documentElement.setAttribute('data-vn-auth', mapa[S.estado] || 'por-autenticar');
    while (raiz.firstChild) raiz.removeChild(raiz.firstChild);
    if (S.estado === 'verificando') {
      raiz.appendChild(el('div', { class: 'gate-card', style: 'align-items:center' }, [
        el('div', { class: 'gate-logo' }, [icon()]),
        el('div', { style: 'font-size:12px;color:var(--muted)', text: 'a verificar sessão…' })
      ]));
      return;
    }
    raiz.appendChild(el('div', { class: 'gate-card' }, [
      el('div', { class: 'gate-logo' }, [icon()]),
      el('h1', { class: 'gate-title', text: 'Conspiracy Tracker' }),
      el('div', { class: 'gate-sub', text: 'plataforma privada de investigação · é preciso sessão para ver qualquer dado' })
    ]));
    const cartao = el('div', { class: 'gate-card' });
    if (S.estado === 'entrar') pintarEntrada(cartao);
    else if (S.estado === 'mfa') pintarMfa(cartao);
    else if (S.estado === 'trocar') pintarTroca(cartao);
    raiz.appendChild(cartao);
    raiz.appendChild(el('div', { class: 'gate-foot' }, [
      el('span', { text: 'sessão de 12 h · acessos e alterações ficam na auditoria · nenhum dado é mostrado sem sessão' })
    ]));
  }

  function aviso(cartao) {
    if (!S.msg) return;
    cartao.appendChild(el('div', { class: 'gate-msg ' + (S.msg.tipo === 'erro' ? 'erro' : 'info'), id: 'gateMsg', role: 'status', text: S.msg.texto }));
  }

  function campo(rotulo, attrs) {
    return el('label', { class: 'gate-field' }, [
      el('span', { text: rotulo }),
      el('input', Object.assign({ class: 'gate-input', autocomplete: 'on' }, attrs))
    ]);
  }

  /* O botão só fica desactivado enquanto há um pedido em curso. Desactivá-lo
     por «campo vazio» deixa a pessoa a olhar para um botão morto sem saber
     porquê; a validação acontece ao submeter e explica o que falta. */
  function botao(texto, onclick) {
    return el('button', {
      class: 'gate-btn', type: 'submit', id: 'gateSubmit',
      disabled: !!S.busy,
      text: S.busy ? 'a processar…' : texto,
      onclick: (ev) => { ev.preventDefault(); if (!S.busy) onclick(); }
    });
  }

  function pintarEntrada(cartao) {
    const form = el('form', { class: 'gate-form', onsubmit: (ev) => { ev.preventDefault(); entrarComPassword(); } });
    aviso(form);
    form.appendChild(campo('Email', {
      type: 'email', name: 'email', id: 'gateEmail', value: S.email, required: true,
      autocomplete: 'username', autofocus: true,
      oninput: (e) => { S.email = e.target.value; }
    }));
    form.appendChild(campo('Palavra-passe', {
      type: 'password', name: 'password', id: 'gatePassword', value: S.password, required: true,
      autocomplete: 'current-password',
      oninput: (e) => { S.password = e.target.value; }
    }));
    form.appendChild(botao('Entrar', entrarComPassword));
    cartao.appendChild(form);
    /* Uma nota só, com as duas informações que interessam a quem está de fora:
       como se obtém conta e o que fazer se a palavra-passe se perdeu. */
    const fechado = !!(S.meta && S.meta.registration && !S.meta.registration.open);
    cartao.appendChild(el('div', { class: 'gate-note', id: 'gateRegistoFechado', text: fechado
      ? 'Sem conta nem auto-registo: um administrador cria-a e entrega uma palavra-passe temporária para trocar no primeiro acesso. Se perdeu a palavra-passe, é ele que a repõe — a operação fica na auditoria.'
      : 'Se perdeu a palavra-passe, um administrador repõe-na (operação registada na auditoria).' }));
  }

  function pintarMfa(cartao) {
    const form = el('form', { class: 'gate-form', onsubmit: (ev) => { ev.preventDefault(); verificarMfa(); } });
    aviso(form);
    form.appendChild(el('div', { class: 'gate-note', style: 'margin-top:0', text:
      'Segundo passo para ' + (S.desafio && S.desafio.email || S.email) + ': a sessão só é criada depois de o código ser aceite.' }));
    form.appendChild(campo('Código da aplicação (6 dígitos)', {
      type: 'text', inputmode: 'numeric', name: 'code', id: 'gateCode', value: S.code,
      autocomplete: 'one-time-code', autofocus: true, maxlength: 6,
      oninput: (e) => { S.code = e.target.value; }
    }));
    const metodos = (S.desafio && S.desafio.methods) || ['totp'];
    if (metodos.indexOf('recovery') >= 0) {
      form.appendChild(campo('…ou um código de recuperação', {
        type: 'text', name: 'recovery', id: 'gateRecovery', value: S.recoveryCode,
        autocomplete: 'off', oninput: (e) => { S.recoveryCode = e.target.value; }
      }));
    }
    form.appendChild(botao('Confirmar', verificarMfa));
    cartao.appendChild(form);
    cartao.appendChild(el('button', {
      class: 'gate-link', type: 'button', text: 'Voltar à entrada', id: 'gateVoltar',
      onclick: () => { S.estado = 'entrar'; S.desafio = null; S.code = ''; S.recoveryCode = ''; S.msg = null; pintar(); }
    }));
  }

  function pintarTroca(cartao) {
    const form = el('form', { class: 'gate-form', onsubmit: (ev) => { ev.preventDefault(); trocarPassword(); } });
    aviso(form);
    form.appendChild(el('div', { class: 'gate-msg info', id: 'gateTrocaObrigatoria', text:
      'A conta ' + (S.me && S.me.email) + ' tem uma palavra-passe temporária. Enquanto não a trocar, o servidor recusa todas as outras operações.' }));
    form.appendChild(campo('Palavra-passe actual (a temporária)', {
      type: 'password', name: 'atual', id: 'gateAtual', value: S.password, autocomplete: 'current-password', autofocus: true,
      oninput: (e) => { S.password = e.target.value; }
    }));
    form.appendChild(campo('Nova palavra-passe (10+, maiúscula, minúscula, dígito)', {
      type: 'password', name: 'nova', id: 'gateNova', value: S.novaPassword, autocomplete: 'new-password',
      oninput: (e) => { S.novaPassword = e.target.value; }
    }));
    form.appendChild(campo('Repetir a nova palavra-passe', {
      type: 'password', name: 'nova2', id: 'gateNova2', value: S.novaPassword2, autocomplete: 'new-password',
      oninput: (e) => { S.novaPassword2 = e.target.value; }
    }));
    if (S.me && S.me.mfa) {
      form.appendChild(campo('Código da aplicação (a conta tem segundo factor)', {
        type: 'text', name: 'codigo', id: 'gateCodigoMfa', value: S.code, inputmode: 'numeric',
        oninput: (e) => { S.code = e.target.value; }
      }));
    }
    form.appendChild(botao('Definir palavra-passe', trocarPassword));
    cartao.appendChild(form);
    cartao.appendChild(el('button', {
      class: 'gate-link', type: 'button', text: 'Sair desta conta', id: 'gateSair',
      onclick: async () => { await api('api/auth/logout', { method: 'POST', body: {} }); sair(); }
    }));
  }

  function icon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '30'); svg.setAttribute('height', '30');
    svg.innerHTML = '<path d="M16 3l11 6.5v13L16 29 5 22.5v-13z" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
      '<circle cx="16" cy="11" r="2.6" fill="currentColor"/><circle cx="10" cy="20" r="2.2" fill="currentColor" opacity=".8"/>' +
      '<circle cx="22" cy="20" r="2.2" fill="currentColor" opacity=".8"/>';
    return svg;
  }

  /* ---------------- acções ---------------- */
  async function entrarComPassword() {
    if (S.busy) return;
    if (!S.email || !S.password) { S.msg = { tipo: 'erro', texto: 'indique email e palavra-passe' }; pintar(); return; }
    S.busy = true; S.msg = null; pintar();
    const r = await api('api/auth/login', { method: 'POST', body: { email: S.email, password: S.password } });
    S.busy = false;
    if (!r.ok) {
      S.tentativas++;
      S.msg = { tipo: 'erro', texto: motivo(r) + (r.status === 429 ? '' : '') };
      pintar(); return;
    }
    if (r.json && r.json.mfaRequired) {
      S.desafio = { token: r.json.challenge, email: S.email, methods: r.json.methods || ['totp'], expiresAt: r.json.expiresAt };
      S.estado = 'mfa'; S.password = ''; pintar(); return;
    }
    await concluirEntrada();
  }

  async function verificarMfa() {
    if (S.busy) return;
    S.busy = true; S.msg = null; pintar();
    const corpo = { challenge: S.desafio && S.desafio.token, code: S.code || undefined, recoveryCode: S.recoveryCode || undefined };
    const r = await api('api/auth/mfa/verify', { method: 'POST', body: corpo });
    S.busy = false;
    if (!r.ok) { S.msg = { tipo: 'erro', texto: motivo(r) }; pintar(); return; }
    await concluirEntrada();
  }

  async function concluirEntrada() {
    const me = await api('api/auth/me');
    S.me = (me.json && me.json.user) || null;
    if (!S.me) { S.estado = 'entrar'; S.msg = { tipo: 'erro', texto: 'a sessão não foi criada; tente novamente' }; pintar(); return; }
    /* a palavra-passe temporária fica preenchida: acabou de ser escrita e
       voltar a pedi-la não acrescenta segurança nenhuma dentro da mesma
       sessão — o que importa é ela ser substituída antes de qualquer uso */
    if (S.me.mustChangePassword) { S.estado = 'trocar'; S.msg = null; pintar(); return; }
    entrar();
  }

  async function trocarPassword() {
    if (S.busy) return;
    if (S.novaPassword !== S.novaPassword2) { S.msg = { tipo: 'erro', texto: 'as duas palavras-passe novas não coincidem' }; pintar(); return; }
    S.busy = true; S.msg = null; pintar();
    const r = await api('api/auth/password', {
      method: 'POST',
      body: { current: S.password, next: S.novaPassword, code: S.code || undefined }
    });
    S.busy = false;
    if (!r.ok) { S.msg = { tipo: 'erro', texto: motivo(r) }; pintar(); return; }
    /* a troca revoga as outras sessões e limpa a marca de temporária */
    const me = await api('api/auth/me');
    S.me = (me.json && me.json.user) || S.me;
    S.novaPassword = ''; S.novaPassword2 = ''; S.password = ''; S.code = '';
    S.msg = null;
    if (S.me && !S.me.mustChangePassword) { entrar(); return; }
    S.msg = { tipo: 'info', texto: 'palavra-passe alterada; a sessão continua a exigir um passo — tente entrar novamente' };
    S.estado = 'entrar'; pintar();
  }

  /* Chamado pela aplicação quando o servidor devolve 401 a meio do uso
     (sessão expirada ou revogada noutro dispositivo). */
  function expirou(motivoTexto) {
    sair(motivoTexto || 'a sessão expirou: entre novamente');
  }

  /* Sair pelo painel da conta tem de repor a porta, tal como a expiração de
     sessão: a aplicação não pode ficar desenhada atrás de um ecrã de entrada. */
  function sessaoTerminou() {
    sair('sessão terminada neste dispositivo');
  }

  VN.gate = { iniciar, sair, expirou, sessaoTerminou,
    get estado() { return S.estado; }, get me() { return S.me; }, get csrf() { return S.csrf; } };
})(typeof window !== 'undefined' ? window : globalThis);
