/* =====================================================================
   MODO SIMPLES — uma coisa de cada vez.

   Porque existe: a vista completa (mapa, filtros, consola, cronologias) é a
   ferramenta de quem já sabe o que procura; para começar a trabalhar é
   demasiada superfície. Este ecrã faz três coisas e só três:

     1. uma caixa onde se escreve a pergunta (e, com ela, se cria a
        investigação);
     2. uma pesquisa que procura ao mesmo tempo no trabalho do próprio
        utilizador (servidor, `/api/search`) e na base real carregada;
     3. o painel de uma investigação: o que já existe, o que falta, e o
        próximo passo concreto.

   Regras que este ficheiro respeita, sem excepções:
   · nada é inventado: cada número vem de uma resposta do servidor;
   · quando falta uma chave de IA, diz-se — não se simula uma análise;
   · o plano de fontes é determinístico (src/core/research.js), com ligações
     reais para os sítios oficiais, e é apresentado como plano, não como
     resultado;
   · a vista avançada continua a existir e não é substituída: é para onde se
     vai quando se quer o mapa, as provas e o relatório.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const el = (tag, attrs, kids) => VN.dom.el(tag, attrs, kids || []);
  const clear = (n) => { while (n && n.firstChild) n.removeChild(n.firstChild); };
  const data = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  let S = {
    me: null, csrf: null, meta: null, keys: null,
    ecra: 'inicio',          // inicio | projecto
    pergunta: '',
    busca: '',
    resultados: null,        // resposta de /api/search
    procurou: false,
    projectos: [],
    aberto: null,            // { project, evidence, documents, claims }
    msg: null,
    plano: null,
    execucoes: [],           // execuções de agentes do projecto aberto
    achados: [],             // achados da verificação automática
    ocupado: false,
    vista: 'simples'         // recorda a última vista escolhida
  };

  async function api(path, opts) {
    opts = opts || {};
    const headers = { accept: 'application/json' };
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

  /* ---------------- utilidades visuais ---------------- */
  function marca(texto, cls) {
    const m = S.msg;
    if (!m) return null;
    return el('div', { class: 'sm-msg ' + (m.cls || 'warn'), id: 'smMsg', text: m.text });
  }
  function aviso(texto, cls) {
    S.msg = texto ? { text: texto, cls: cls || 'warn' } : null;
    pintar();
  }

  /* Haverá análise por IA quando: (1) o utilizador tem chave validada, ou
     (2) o operador configurou uma chave no ambiente, ou (3) existe o fornecedor
     sem chave. O estado vem todo do servidor — a interface não o inventa. */
  function estadoIA() {
    const op = (S.keys && S.keys.operador) || null;
    const minha = !!(S.keys && S.keys.any);
    const doOperador = !!(op && op.activo && op.activo.provider);
    const semChave = !!(doOperador && op.activo.keyless);
    if (minha) return { tem: true, via: 'utilizador', rotulo: 'IA pronta', detalhe: 'chave da tua conta, validada' };
    if (semChave) return { tem: true, via: 'sem-chave', rotulo: 'IA sem chave', detalhe: 'fornecedor público sem chave (' + op.activo.provider + '): não envies dados pessoais' };
    if (doOperador) return { tem: true, via: 'operador', rotulo: 'IA pronta', detalhe: 'chave do operador (' + op.activo.provider + ' · ' + (op.activo.modelo || 'modelo por omissão') + ')' };
    return { tem: false, via: 'nenhuma', rotulo: 'IA sem chave', detalhe: 'sem chave: a análise automática por IA não corre' };
  }
  function temChave() {
    return estadoIA().tem;
  }

  function contar(itens) {
    return itens && itens.length ? itens.length : 0;
  }

  /* ---------------- ecrã 1: começar / pesquisar ---------------- */
  function cartaoPergunta() {
    const form = el('form', {
      class: 'sm-card sm-ask', id: 'smAsk',
      onsubmit: (ev) => { ev.preventDefault(); criarInvestigacao(); }
    });
    form.appendChild(el('label', { class: 'sm-label', for: 'smPergunta', text: 'O que queres investigar?' }));
    const campo = el('textarea', {
      class: 'sm-input', id: 'smPergunta', rows: '2', maxlength: '400',
      placeholder: 'Ex.: Quem financiou a fundação X entre 2015 e 2020?',
      oninput: (e) => {
        S.pergunta = e.target.value;
        /* o botão não é repintado a cada tecla (perder-se-ia o cursor):
           só se liga ou desliga conforme o que está escrito */
        const b = document.getElementById('smCriar');
        if (b) b.disabled = S.ocupado || S.pergunta.trim().length < 8;
      },
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); criarInvestigacao(); }
      }
    });
    campo.value = S.pergunta || '';
    form.appendChild(campo);
    form.appendChild(el('div', { class: 'sm-actions' }, [
      el('button', { class: 'sm-btn primary', type: 'submit', id: 'smCriar',
        disabled: S.ocupado || (S.pergunta || '').trim().length < 8,
        text: S.ocupado ? 'a criar…' : 'Começar investigação' }),
      el('span', { class: 'sm-hint', text: 'Cria a investigação e abre-a. Nada é pesquisado sem tu pedires.' })
    ]));
    return form;
  }

  function cartaoBusca() {
    const form = el('form', {
      class: 'sm-card sm-search', id: 'smSearchForm',
      onsubmit: (ev) => { ev.preventDefault(); procurar(); }
    });
    form.appendChild(el('label', { class: 'sm-label', for: 'smBusca', text: 'Procurar no que já tens' }));
    const linha = el('div', { class: 'sm-row' });
    const campo = el('input', {
      class: 'sm-input', id: 'smBusca', type: 'search', autocomplete: 'off',
      placeholder: 'Nome, empresa, valor, documento…',
      oninput: (e) => { S.busca = e.target.value; }
    });
    campo.value = S.busca || '';
    linha.appendChild(campo);
    linha.appendChild(el('button', { class: 'sm-btn', type: 'submit', id: 'smProcurar', text: 'Procurar' }));
    form.appendChild(linha);
    form.appendChild(el('div', { class: 'sm-hint', text:
      'Procura nas tuas investigações, provas, conclusões, documentos e memória — e na base real carregada.' }));
    return form;
  }

  function listaResultados() {
    const box = el('div', { class: 'sm-results', id: 'smResults' });
    if (!S.procurou) return box;
    const r = S.resultados;
    if (!r) return box;
    if (r.status === 400) {
      box.appendChild(el('p', { class: 'sm-muted', text: (r.error && r.error.message) || 'termo demasiado curto' }));
      return box;
    }
    if (!r.ok) {
      box.appendChild(el('p', { class: 'sm-muted', text: 'a pesquisa falhou: ' + ((r.error && r.error.message) || 'erro') }));
      return box;
    }
    const j = r.json || {};
    const publicos = (S.publicos || []);
    const total = (j.total || 0) + publicos.length;
    box.appendChild(el('p', { class: 'sm-muted', id: 'smResumo',
      text: total === 0
        ? 'Nada encontrado para «' + j.q + '». ' + (j.projects === 0 ? 'Ainda não tens investigações — cria a primeira acima.' : 'Tenta outra palavra ou cria uma investigação para este tema.')
        : total + ' resultado(s) para «' + j.q + '» · ' + (j.total || 0) + ' no teu trabalho · ' + publicos.length + ' na base real' +
          (j.widened ? ' · não havia resultados com todos os termos, por isso alarguei a qualquer um deles' : '') }));

    if ((j.results || []).length) {
      box.appendChild(el('h4', { class: 'sm-h4', text: 'No teu trabalho' }));
      const ul = el('div', { class: 'sm-list' });
      const nomes = { project: 'Investigação', evidence: 'Prova', claim: 'Conclusão', document: 'Documento',
        memory: 'Nota', relation: 'Relação', entity: 'Entidade' };
      j.results.forEach((x) => {
        ul.appendChild(el('button', {
          class: 'sm-item', type: 'button', dataset: { tipo: x.type, pid: x.projectId },
          onclick: () => abrirProjecto(x.projectId)
        }, [
          el('span', { class: 'sm-item-tag', text: (nomes[x.type] || x.type) + (x.parcial ? ' · parcial' : '') }),
          el('span', { class: 'sm-item-title', text: x.projectTitle || '' }),
          el('span', { class: 'sm-item-excerpt', text: (x.where ? x.where + ': ' : '') + (x.excerpt || '') + (x.casados > 1 ? ' · ' + x.casados + ' termos' : '') })
        ]));
      });
      box.appendChild(ul);
    }
    if (publicos.length) {
      box.appendChild(el('h4', { class: 'sm-h4', text: 'Na base real carregada' }));
      const ul2 = el('div', { class: 'sm-list' });
      publicos.slice(0, 8).forEach((p) => {
        ul2.appendChild(el('button', {
          class: 'sm-item', type: 'button', dataset: { tipo: 'publico', id: p.id },
          onclick: () => {
            S.vista = 'avancada';
            mostrarVista('avancada');
            const inp = document.getElementById('search');
            if (inp) { inp.value = p.label || ''; inp.dispatchEvent(new Event('input', { bubbles: true })); }
          }
        }, [
          el('span', { class: 'sm-item-tag', text: 'Base real' }),
          el('span', { class: 'sm-item-title', text: p.label || '' }),
          el('span', { class: 'sm-item-excerpt', text: (p.kind || 'entidade') + ' · abrir na vista avançada' })
        ]));
      });
      box.appendChild(ul2);
    }
    return box;
  }

  function listaProjectos() {
    const box = el('div', { class: 'sm-projects', id: 'smProjects' });
    box.appendChild(el('h4', { class: 'sm-h4', text: 'As tuas investigações' }));
    if (!S.projectos.length) {
      box.appendChild(el('p', { class: 'sm-muted', id: 'smSemProjectos',
        text: 'Ainda não há nenhuma. Escreve a pergunta acima e carrega em «Começar investigação».' }));
      return box;
    }
    const ul = el('div', { class: 'sm-list' });
    S.projectos.forEach((p) => {
      const n = (p.counts && p.counts.evidence) || 0;
      ul.appendChild(el('button', {
        class: 'sm-item', type: 'button', dataset: { pid: p.id },
        onclick: () => abrirProjecto(p.id)
      }, [
        el('span', { class: 'sm-item-title', text: p.title }),
        el('span', { class: 'sm-item-excerpt', text: (p.question || '').slice(0, 120) }),
        el('span', { class: 'sm-item-meta', text: n + ' prova(s) · criada em ' + data(p.createdAt) })
      ]));
    });
    box.appendChild(ul);
    return box;
  }

  function ecraInicio() {
    const root = el('div', { class: 'sm-wrap', id: 'smInicio' });
    root.appendChild(el('div', { class: 'sm-hero' }, [
      el('h1', { class: 'sm-h1', text: 'Investigar, em três passos' }),
      el('p', { class: 'sm-sub', text:
        'Escreve a pergunta, recolhe fontes com ligação, e só depois conclui. Cada afirmação fica ligada ao excerto de onde saiu.' })
    ]));
    const m = marca(); if (m) root.appendChild(m);
    root.appendChild(cartaoPergunta());
    root.appendChild(cartaoBusca());
    root.appendChild(listaResultados());
    root.appendChild(listaProjectos());
    return root;
  }

  /* ---------------- ecrã 2: uma investigação ---------------- */
  function blocoContagens(d) {
    const prj = d.project || {};
    const p = (prj.counts) || {};
    const itens = [
      ['Provas', contar(d.evidence)],
      ['Documentos', contar(d.documents)],
      ['Conclusões', contar(d.claims)]
    ];
    const box = el('div', { class: 'sm-stats', id: 'smStats' });
    itens.forEach(([k, v]) => box.appendChild(el('div', { class: 'sm-stat' }, [
      el('strong', { text: String(v) }), el('span', { text: k })
    ])));
    return box;
  }

  function blocoProximoPasso(d) {
    const box = el('div', { class: 'sm-card sm-next', id: 'smProximo' });
    const temChave = !!(S.keys && S.keys.any);
    box.appendChild(el('h3', { class: 'sm-h3', text: 'Próximo passo' }));

    if (!contar(d.evidence) && !contar(d.documents)) {
      box.appendChild(el('p', { class: 'sm-p', text:
        'Ainda não há nada registado. O caminho mais curto: colar o link de um documento oficial — o sistema descarrega, extrai o texto e obriga-te a confirmar o excerto antes de contar como prova.' }));
    } else if (!contar(d.claims)) {
      box.appendChild(el('p', { class: 'sm-p', text:
        'Já tens ' + contar(d.evidence) + ' prova(s). O passo seguinte é escrever a conclusão que elas sustentam — ou dizer que não sustentam nenhuma.' }));
    } else {
      box.appendChild(el('p', { class: 'sm-p', text:
        'Tens provas e conclusões. Podes rever o que está por verificar, exportar o relatório, ou abrir o mapa para ver as relações.' }));
    }

    const acoes = el('div', { class: 'sm-actions' });
    acoes.appendChild(el('button', { class: 'sm-btn primary', type: 'button', id: 'smRecolher',
      text: 'Recolher documento de um link', onclick: () => recolherDocumento() }));
    acoes.appendChild(el('button', { class: 'sm-btn', type: 'button', id: 'smRegistarProva',
      text: 'Registar prova à mão', onclick: () => formularioProva() }));
    acoes.appendChild(el('button', { class: 'sm-btn ghost', type: 'button', id: 'smPlano',
      text: 'Onde procurar (plano de fontes)', onclick: () => mostrarPlano() }));
    box.appendChild(acoes);

    if (!temChave) {
      box.appendChild(el('div', { class: 'sm-box warn', id: 'smSemChave' }, [
        el('strong', { text: 'Sem chave de IA: ' }),
        el('span', { text: 'o sistema não escreve conclusões nem resume documentos. Tudo o resto — recolher, extrair texto, registar provas, verificar valores — funciona sem IA. ' }),
        el('button', { class: 'sm-link', type: 'button', text: 'Adicionar chave', onclick: () => irParaChaves() })
      ]));
    }
    return box;
  }

  /* Verificação automática: corre os agentes LOCAIS (sem IA, sem custo) e
     mostra o que encontraram. Não inventa nada — se não houver achados, diz
     que não há. A análise por IA só aparece como possível quando há chave. */
  const AGENTES_LOCAIS = ['fact-checker', 'counter-evidence', 'red-team', 'orchestrator'];

  function blocoVerificacao(d) {
    const box = el('div', { class: 'sm-card', id: 'smVerificacao' });
    box.appendChild(el('h3', { class: 'sm-h3', text: 'Verificação automática' }));
    box.appendChild(el('p', { class: 'sm-hint', text:
      'Regras verificáveis sobre as provas deste projecto: datas em falta, confirmações que vêm da mesma origem, linguagem de imputação sem prova. Não usa IA e não custa nada.' }));
    const acoes = el('div', { class: 'sm-actions' });
    acoes.appendChild(el('button', { class: 'sm-btn', type: 'button', id: 'smVerificar',
      text: S.ocupado ? 'a verificar…' : 'Verificar agora',
      disabled: S.ocupado, onclick: () => verificar() }));
    if (temChave()) {
      acoes.appendChild(el('button', { class: 'sm-btn ghost', type: 'button', id: 'smAnalisarIA',
        text: 'Pedir análise à IA', onclick: () => analisarComIA() }));
    }
    box.appendChild(acoes);

    const lista = S.achados || [];
    if (S.verificou) {
      if (!lista.length) {
        box.appendChild(el('p', { class: 'sm-muted', id: 'smSemAchados',
          text: 'As verificações locais não encontraram problemas. Isto não significa que a investigação esteja correcta — significa que as regras automáticas não viram nada.' }));
      } else {
        const ul = el('div', { class: 'sm-list', id: 'smAchados' });
        lista.forEach((a) => {
          ul.appendChild(el('div', { class: 'sm-item static' }, [
            el('span', { class: 'sm-item-tag', text: 'gravidade ' + (a.severity || '—') }),
            el('span', { class: 'sm-item-title', text: a.message || a.code }),
            el('span', { class: 'sm-item-meta', text: (a.subject && a.subject.type ? a.subject.type + ' ' + a.subject.id : a.code) })
          ]));
        });
        box.appendChild(ul);
      }
    }
    return box;
  }

  async function verificar() {
    const d = S.aberto;
    if (!d) return;
    S.ocupado = true; S.msg = { text: 'A correr as verificações locais…', cls: 'info' };
    pintar();
    const achados = [];
    const resumo = [];
    for (const id of AGENTES_LOCAIS) {
      const r = await api('/api/projects/' + d.project.id + '/agents/' + id + '/run', { method: 'POST', body: { confirmCost: true } });
      const run = (r.json && r.json.run) || {};
      resumo.push((run.agentName || id) + ': ' + (run.status || (r.error && r.error.code) || 'erro'));
      (run.findings || []).forEach((f) => achados.push(f));
    }
    S.ocupado = false;
    await abrirProjecto(d.project.id, true);   // recarrega provas e execuções
    S.verificou = true;                        // ... e só depois fixa os achados,
    S.achados = achados;                       // senão o recarregamento apagava-os
    S.msg = { text: achados.length
        ? achados.length + ' achado(s). ' + resumo.join(' · ')
        : 'Nenhum problema detectado pelas regras locais. ' + resumo.join(' · '), cls: achados.length ? 'warn' : 'ok' };
    pintar();
  }

  async function analisarComIA() {
    const d = S.aberto;
    if (!d) return;
    if (!temChave()) {
      aviso('Sem chave de IA: a análise por IA não corre. Podes pôr a tua chave em Conta → Chaves de IA, ou o operador configura uma no servidor.');
      return;
    }
    S.ocupado = true; S.msg = { text: 'A pedir análise à IA (pode demorar)…', cls: 'info' };
    pintar();
    const pedidos = ['research-planner', 'relationship-mapper'];
    const out = [];
    for (const id of pedidos) {
      const r = await api('/api/projects/' + d.project.id + '/agents/' + id + '/run', { method: 'POST', body: { confirmCost: true } });
      const run = (r.json && r.json.run) || {};
      out.push((run.agentName || id) + ': ' + (run.status || 'erro') + (run.reason ? ' — ' + run.reason : ''));
    }
    S.ocupado = false;
    S.msg = { text: out.join(' · '), cls: 'ok' };
    await abrirProjecto(d.project.id, true);
  }

  function blocoExecucoes(d) {
    const runs = d.runs || [];
    if (!runs.length) return el('div', {});
    const box = el('div', { class: 'sm-card', id: 'smExecucoes' });
    box.appendChild(el('h3', { class: 'sm-h3', text: 'Últimas execuções' }));
    const ul = el('div', { class: 'sm-list' });
    runs.slice(-6).reverse().forEach((r) => {
      ul.appendChild(el('div', { class: 'sm-item static' }, [
        el('span', { class: 'sm-item-tag', text: (r.kind === 'ai' ? 'IA' : 'local') + ' · ' + (r.status || '') }),
        el('span', { class: 'sm-item-title', text: r.agentName || r.agentId }),
        el('span', { class: 'sm-item-meta', text: (r.reason || ((r.output && (r.output.summary || r.output.text)) || '').slice(0, 120) || 'sem detalhe') })
      ]));
    });
    box.appendChild(ul);
    return box;
  }

  function formularioProva() {
    const d = S.aberto;
    if (!d) return;
    const box = document.getElementById('smProvaForm');
    if (box) { box.remove(); return; }
    const form = el('form', {
      class: 'sm-card', id: 'smProvaForm',
      onsubmit: (ev) => { ev.preventDefault(); guardarProva(form); }
    });
    form.appendChild(el('h3', { class: 'sm-h3', text: 'Registar prova' }));
    form.appendChild(el('div', { class: 'sm-hint', text:
      'Uma prova precisa de título, excerto literal e origem. Sem excerto, não entra.' }));
    [['smEvTitle', 'Título do documento', 'text'], ['smEvUrl', 'Link (https://…)', 'text'], ['smEvExcerpt', 'Excerto literal (copiado do documento)', 'text']].forEach(([id, ph, type]) => {
      const inp = el('input', { class: 'sm-input', id, type, placeholder: ph, autocomplete: 'off' });
      form.appendChild(inp);
    });
    form.appendChild(el('div', { class: 'sm-actions' }, [
      el('button', { class: 'sm-btn primary', type: 'submit', id: 'smEvGuardar', text: 'Guardar prova' }),
      el('button', { class: 'sm-btn ghost', type: 'button', text: 'Cancelar',
        onclick: () => { const f = document.getElementById('smProvaForm'); if (f) f.remove(); } })
    ]));
    const alvo = document.getElementById('smProximo');
    if (alvo && alvo.parentNode) alvo.parentNode.insertBefore(form, alvo.nextSibling);
  }

  async function guardarProva(form) {
    const d = S.aberto;
    const v = (id) => (document.getElementById(id) || {}).value || '';
    const title = v('smEvTitle').trim(), excerpt = v('smEvExcerpt').trim(), url = v('smEvUrl').trim();
    if (title.length < 3 || excerpt.length < 10) {
      /* o formulário NÃO é apagado: quem escreveu não perde o texto por um erro */
      let m = document.getElementById('smEvErro');
      if (!m) {
        m = el('p', { class: 'sm-msg warn', id: 'smEvErro' });
        form.insertBefore(m, form.querySelector('.sm-actions'));
      }
      m.textContent = 'Falta o título (3 caracteres) ou o excerto literal (10 caracteres). Sem excerto não há prova.';
      return;
    }
    const r = await api('/api/projects/' + d.project.id + '/evidence', {
      method: 'POST',
      body: { title, excerpt, originalUrl: url || null, sourceType: 'primaria', stance: 'favoravel' }
    });
    if (!r.ok) { aviso('Não foi guardada: ' + ((r.error && r.error.message) || 'erro ' + r.status)); return; }
    S.msg = { text: r.json && r.json.duplicate ? 'Esta prova já existia: não foi duplicada.' : 'Prova registada.', cls: 'ok' };
    await abrirProjecto(d.project.id, true);
  }

  async function recolherDocumento() {
    const d = S.aberto;
    const url = (g.prompt('Link do documento (página ou PDF):', 'https://') || '').trim();
    if (!url || !/^https?:\/\//.test(url)) { if (url) aviso('O link tem de começar por http:// ou https://'); return; }
    S.ocupado = true; aviso('A descarregar e a extrair texto…', 'info');
    const r = await api('/api/projects/' + d.project.id + '/documents', { method: 'POST', body: { url } });
    S.ocupado = false;
    if (!r.ok) {
      aviso('Não foi possível recolher: ' + ((r.error && r.error.message) || 'erro ' + r.status));
      return;
    }
    const doc = (r.json && (r.json.document || r.json)) || {};
    S.msg = { text: 'Documento recolhido' + (doc.chars ? ' (' + doc.chars + ' caracteres extraídos)' : '') +
      '. O texto NÃO é prova: abre-o, lê e confirma o excerto.', cls: 'ok' };
    await abrirProjecto(d.project.id, true);
  }

  function mostrarPlano() {
    const d = S.aberto;
    if (!d || !VN.research || !VN.research.buildPlan) { aviso('Plano de fontes indisponível neste browser.'); return; }
    const plano = VN.research.buildPlan((d.project.question || d.project.title || ''), {});
    S.plano = plano;
    const box = document.getElementById('smPlanoBox');
    if (box) { box.remove(); return; }
    const out = el('div', { class: 'sm-card', id: 'smPlanoBox' });
    out.appendChild(el('h3', { class: 'sm-h3', text: 'Onde procurar — plano, não resultado' }));
    out.appendChild(el('p', { class: 'sm-p', text:
      'Este plano é gerado a partir da pergunta e aponta para fontes oficiais. Não é uma pesquisa feita: cada linha é um sítio onde a resposta pode estar, com o que esperar e o que não concluir.' }));
    (plano.steps || []).forEach((st) => {
      const b = el('div', { class: 'sm-plan-step' });
      b.appendChild(el('h4', { class: 'sm-h4', text: st.n + '. ' + st.title }));
      (st.actions || []).forEach((a) => b.appendChild(el('p', { class: 'sm-p small', text: '· ' + a })));
      (st.sources || []).forEach((s) => {
        b.appendChild(el('a', { class: 'sm-link', href: s.url, target: '_blank', rel: 'noopener noreferrer',
          text: (s.name || s.id) + ' — ' + (s.hint || '') }));
      });
      out.appendChild(b);
    });
    const alvo = document.getElementById('smProximo');
    if (alvo && alvo.parentNode) alvo.parentNode.insertBefore(out, alvo.nextSibling);
  }

  function blocoProvos(d) {
    const box = el('div', { class: 'sm-card', id: 'smProvas' });
    box.appendChild(el('h3', { class: 'sm-h3', text: 'Provas (' + contar(d.evidence) + ')' }));
    if (!contar(d.evidence)) {
      box.appendChild(el('p', { class: 'sm-muted', id: 'smSemProvas',
        text: 'Nenhuma ainda. Cada prova é um documento, com um excerto literal e um link.' }));
      return box;
    }
    const ul = el('div', { class: 'sm-list' });
    d.evidence.slice(-12).reverse().forEach((ev) => {
      const line = el('div', { class: 'sm-item static' }, [
        el('span', { class: 'sm-item-title', text: ev.title }),
        el('span', { class: 'sm-item-excerpt', text: ev.excerpt }),
        el('span', { class: 'sm-item-meta', text: (ev.originalUrl ? origem(ev.originalUrl) : 'sem link') +
          ' · ' + (ev.publicationDate || data(ev.createdAt)) + ' · ' + (ev.validationState || 'por verificar') + (ev.retractedAt ? ' · RETIRADA' : '') })
      ]);
      ul.appendChild(line);
    });
    box.appendChild(ul);
    return box;
  }

  function blocoDocumentos(d) {
    const box = el('div', { class: 'sm-card', id: 'smDocumentos' });
    const docs = d.documents || [];
    box.appendChild(el('h3', { class: 'sm-h3', text: 'Documentos (' + docs.length + ')' }));
    if (!docs.length) {
      box.appendChild(el('p', { class: 'sm-muted', text: 'Nenhum documento recolhido. Usa «Recolher documento de um link».' }));
      return box;
    }
    const ul = el('div', { class: 'sm-list' });
    docs.slice(-8).reverse().forEach((doc) => {
      ul.appendChild(el('div', { class: 'sm-item static' }, [
        el('span', { class: 'sm-item-title', text: doc.title || doc.url }),
        el('span', { class: 'sm-item-meta', text: (doc.reviewed ? 'revisto' : 'por revisar') + ' · ' +
          ((doc.text || '').length) + ' caracteres extraídos · ' + origem(doc.url) })
      ]));
    });
    box.appendChild(ul);
    return box;
  }

  function origem(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url || '').slice(0, 40); }
  }

  function ecraProjecto() {
    const d = S.aberto || {};
    const prj = d.project || {};
    const root = el('div', { class: 'sm-wrap', id: 'smProjecto' });
    root.appendChild(el('button', { class: 'sm-link back', type: 'button', id: 'smVoltar',
      text: '← Todas as investigações', onclick: () => { S.ecra = 'inicio'; S.aberto = null; S.plano = null; S.msg = null; pintar(); } }));
    root.appendChild(el('h1', { class: 'sm-h1', id: 'smTitulo', text: prj.title || 'Investigação' }));
    if (prj.question && prj.question !== prj.title) {
      root.appendChild(el('p', { class: 'sm-sub', id: 'smPergunta', text: prj.question }));
    }
    const m = marca(); if (m) root.appendChild(m);
    root.appendChild(blocoContagens(d));
    root.appendChild(blocoProximoPasso(d));
    root.appendChild(blocoProvos(d));
    root.appendChild(blocoDocumentos(d));
    root.appendChild(blocoVerificacao(d));
    root.appendChild(blocoExecucoes(d));
    root.appendChild(el('div', { class: 'sm-actions footer' }, [
      el('button', { class: 'sm-btn', type: 'button', id: 'smExportar', text: 'Exportar relatório',
        onclick: () => exportar(prj.id) }),
      el('button', { class: 'sm-btn ghost', type: 'button', id: 'smAvancado', text: 'Ver no mapa (vista avançada)',
        onclick: () => { irParaAvancado(prj.id); } })
    ]));
    return root;
  }

  async function exportar(pid) {
    const r = await api('/api/projects/' + pid + '/summary?format=md');
    if (!r.ok) { aviso('A exportação falhou: ' + ((r.error && r.error.message) || r.status)); return; }
    const txt = typeof r.json === 'string' ? r.json : JSON.stringify(r.json, null, 2);
    const blob = new Blob([txt], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'investigacao-' + pid + '.md';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    S.msg = { text: 'Relatório descarregado.', cls: 'ok' };
    pintar();
  }

  /* ---------------- acções ---------------- */
  async function criarInvestigacao() {
    const q = (S.pergunta || '').trim();
    if (q.length < 8) { aviso('Escreve a pergunta com pelo menos 8 caracteres — é ela que fica registada.'); return; }
    S.ocupado = true; pintar();
    const r = await api('/api/projects', { method: 'POST', body: { title: q.slice(0, 160), question: q } });
    S.ocupado = false;
    if (!r.ok) { aviso('Não foi criada: ' + ((r.error && r.error.message) || 'erro ' + r.status)); return; }
    const id = r.json.project.id;
    S.pergunta = '';
    S.msg = { text: 'Investigação criada.', cls: 'ok' };
    await carregarProjectos();
    await abrirProjecto(id, true);
  }

  async function procurar() {
    const q = (S.busca || '').trim();
    if (q.length < 2) { aviso('Escreve pelo menos 2 caracteres para procurar.'); return; }
    S.procurou = true;
    const r = await api('/api/search?q=' + encodeURIComponent(q));
    S.resultados = r;
    /* a base real é procurada no cliente (é o conjunto público carregado) */
    S.publicos = [];
    try {
      if (VN.app && typeof VN.app.search === 'function') {
        const res = VN.app.search(q, {});
        const lista = (res && (res.results || res.items || res)) || [];
        S.publicos = (Array.isArray(lista) ? lista : []).slice(0, 20).map((x) => ({
          id: x.id || x.entityId, label: x.label || x.name || x.title, kind: x.kind || x.type
        }));
      }
    } catch (e) { S.publicos = []; }
    pintar();
  }

  async function carregarProjectos() {
    const r = await api('/api/projects');
    S.projectos = (r.ok && r.json && (r.json.projects || r.json.items)) || [];
  }

  async function abrirProjecto(pid, manterMsg) {
    const [prj, ev, docs, cl, runs] = await Promise.all([
      api('/api/projects/' + pid),
      api('/api/projects/' + pid + '/evidence'),
      api('/api/projects/' + pid + '/documents'),
      api('/api/projects/' + pid + '/claims'),
      api('/api/projects/' + pid + '/agent-runs')
    ]);
    if (!prj.ok) { aviso('Investigação não encontrada: ' + ((prj.error && prj.error.message) || prj.status)); return; }
    S.aberto = {
      project: prj.json.project || prj.json,
      evidence: (ev.ok && (ev.json.evidence || ev.json.items)) || [],
      documents: (docs.ok && (docs.json.documents || docs.json.items)) || [],
      claims: (cl.ok && (cl.json.claims || cl.json.items)) || [],
      runs: (runs.ok && (runs.json.runs || [])) || []
    };
    S.achados = [];
    S.verificou = false;
    S.ecra = 'projecto';
    if (!manterMsg) S.msg = null;
    pintar();
  }

  function irParaChaves() {
    S.vista = 'avancada';
    mostrarVista('avancada');
    const btn = document.getElementById('btnAccount');
    if (btn) btn.click();
  }

  function irParaAvancado(pid) {
    S.vista = 'avancada';
    mostrarVista('avancada');
    const btn = document.getElementById('btnAccount');
    if (btn) btn.click();
    try { if (VN.accountUI && VN.accountUI.openProject) VN.accountUI.openProject(pid); } catch (e) { /* opcional */ }
  }

  /* ---------------- pintura ---------------- */
  function pintar() {
    const root = document.getElementById('vnSimples');
    if (!root) return;
    clear(root);
    root.appendChild(cabecalho());
    root.appendChild(el('main', { class: 'sm-main' }, [S.ecra === 'projecto' ? ecraProjecto() : ecraInicio()]));
  }

  function cabecalho() {
    const h = el('header', { class: 'sm-header' });
    h.appendChild(el('div', { class: 'sm-brand' }, [
      el('strong', { text: 'Conspiracy Tracker' }),
      el('span', { class: 'sm-badge', id: 'smModo', text: 'modo simples' })
    ]));
    const dir = el('div', { class: 'sm-header-right' });
    dir.appendChild(el('button', { class: 'sm-btn ghost', type: 'button', id: 'smIrAvancado',
      text: 'Vista avançada (mapa e ferramentas)', onclick: () => { S.vista = 'avancada'; mostrarVista('avancada'); } }));
    if (S.me) {
      dir.appendChild(el('button', {
        class: 'sm-badge ' + (temChave() ? 'ok' : 'warn'), type: 'button', id: 'smIaBadge',
        title: estadoIA().detalhe,
        text: estadoIA().rotulo,
        onclick: () => irParaChaves()
      }));
      dir.appendChild(el('span', { class: 'sm-user', id: 'smUser', text: S.me.email }));
    }
    h.appendChild(dir);
    return h;
  }

  /* Os avisos flutuantes do grafo («Modo completo…», «Semente: 14 entidades…»)
     ficam por cima de tudo e apareciam a flutuar sobre o modo simples. São
     escondidos enquanto a vista simples está activa — não se perde nada: são
     dicas do mapa, que não está a ser mostrado. */
  function esconderAvisosDoMapa(esconder) {
    const alvo = ['.toast', '.toasts', '.hint', '.graph-hint', '.map-hint', '#hint', '.statushint', '.cy-hint'];
    alvo.forEach((sel) => {
      document.querySelectorAll(sel).forEach((n) => { n.style.display = esconder ? 'none' : ''; });
    });
    /* as notificações internas do motor gráfico vivem em contentores com
       posição fixa; identificam-se pelo estilo, sem depender de nomes */
    document.querySelectorAll('body > div').forEach((n) => {
      if (n.id === 'vnSimples' || n.id === 'vnGate') return;
      const st = getComputedStyle(n);
      if (st.position === 'fixed' && Number(st.zIndex || 0) >= 5 && n.getAttribute('role') !== 'dialog') {
        n.style.display = esconder ? 'none' : '';
      }
    });
  }

  function mostrarVista(qual) {
    S.vista = qual;
    const simples = document.getElementById('vnSimples');
    const app = document.querySelector('main.layout');
    const topo = document.querySelector('header.top, header');
    const avancado = qual === 'avancada';
    document.documentElement.setAttribute('data-vn-vista', qual);
    if (simples) simples.style.display = avancado ? 'none' : '';
    esconderAvisosDoMapa(!avancado);
    if (app) app.style.display = avancado ? '' : 'none';
    const barra = document.getElementById('btnSimples');
    if (barra) barra.style.display = avancado ? '' : 'none';
    try { localStorage.setItem('vn.vista', qual); } catch (e) { /* sem armazenamento: segue */ }
    if (!avancado) pintar();
  }

  /* ---------------- arranque ---------------- */
  async function iniciar() {
    const me = await api('/api/auth/me');
    S.me = (me.json && me.json.user) || null;
    if (!S.me) return false;
    S.csrf = me.json.csrf || S.csrf;
    const [meta, keys] = await Promise.all([api('/api/meta'), api('/api/providers')]);
    S.meta = (meta.ok && meta.json) || null;
    const provs = (keys.ok && keys.json && (keys.json.providers || keys.json.items)) || [];
    S.keys = {
      any: provs.some((p) => p && (p.hasKey || p.saved || p.configured)),
      list: provs,
      operador: (keys.ok && keys.json && keys.json.operatorKeys) || null
    };
    await carregarProjectos();
    /* o botão da vista avançada que traz de volta ao modo simples */
    const voltar = document.getElementById('btnSimples');
    if (voltar && !voltar.dataset.ligado) {
      voltar.dataset.ligado = '1';
      voltar.addEventListener('click', () => mostrarVista('simples'));
    }
    const root = el('div', { id: 'vnSimples' });
    document.body.appendChild(root);
    let guardada = 'simples';
    try { guardada = localStorage.getItem('vn.vista') || 'simples'; } catch (e) { /* segue */ }
    pintar();
    mostrarVista(guardada === 'avancada' ? 'avancada' : 'simples');
    return true;
  }

  VN.simples = {
    iniciar, pintar, mostrarVista,
    getState: () => ({ ecra: S.ecra, vista: S.vista, projectos: S.projectos.length, aberto: S.aberto && S.aberto.project && S.aberto.project.id,
      provas: S.aberto ? contar(S.aberto.evidence) : 0, resultados: S.resultados && S.resultados.json ? S.resultados.json.total : null })
  };
})(typeof window !== 'undefined' ? window : globalThis);
