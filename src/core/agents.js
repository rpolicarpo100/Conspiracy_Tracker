/* =====================================================================
   VN · AGENTES DE RECOLHA
   O que um agente PODE fazer: obter um documento de uma fonte declarada,
   provar que o obteve (URL, data, estado HTTP, tipo, tamanho, SHA-256),
   extrair campos de forma determinística e registar tudo no livro de provas.
   O que um agente NÃO PODE fazer: escrever no grafo, decidir culpas,
   contornar robots.txt, aceder a endereços privados, guardar credenciais
   ou fazer pedidos em massa.
   Modo por omissão: simulação (dry-run). Nada sai sem autorização.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});

  const LIMITS = {
    maxRequestsPerRun: 20,
    minIntervalMs: 1500,
    timeoutMs: 15000,
    maxBytes: 2 * 1024 * 1024,
    maxRedirects: 3
  };

  /* ---------- guardas ---------- */
  function isPrivateHost(host) {
    const h = String(host || '').toLowerCase();
    if (!h) return true;
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
    // IPv4 privado / loopback / link-local
    const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      const a = +m[1], b = +m[2];
      if (a === 10 || a === 127 || a === 0) return true;
      if (a === 169 && b === 254) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
      return false;
    }
    if (h === '::1' || h.startsWith('fd') || h.startsWith('fe80') || h === '[::1]') return true;
    return false;
  }

  function validateTask(task) {
    const errors = [];
    if (!task || typeof task !== 'object') return ['tarefa inválida'];
    if (!task.id) errors.push('falta id');
    if (!task.url) errors.push('falta url');
    else {
      let u = null;
      try { u = new URL(task.url); } catch (e) { errors.push('url inválido'); }
      if (u) {
        if (!/^https?:$/.test(u.protocol)) errors.push('apenas http/https');
        else if (isPrivateHost(u.hostname)) errors.push('endereço privado/local proibido (SSRF)');
      }
    }
    if (!task.source) errors.push('falta a fonte declarada (source)');
    if (task.method && !/^(GET|POST)$/.test(task.method)) errors.push('método não permitido');
    if (task.extract && !EXTRACTORS[task.extract.type]) errors.push('extractor desconhecido: ' + task.extract.type);
    return errors;
  }

  /* ---------- robots.txt (regras para user-agent *) ---------- */
  function parseRobots(text) {
    const groups = [];
    let cur = null;
    String(text || '').split(/\r?\n/).forEach((line) => {
      const l = line.replace(/#.*$/, '').trim();
      if (!l) return;
      const [k, ...rest] = l.split(':');
      const key = k.trim().toLowerCase();
      const val = rest.join(':').trim();
      if (key === 'user-agent') {
        if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
        cur.agents.push(val.toLowerCase());
      } else if (key === 'disallow' && cur) cur.rules.push({ allow: false, path: val });
      else if (key === 'allow' && cur) cur.rules.push({ allow: true, path: val });
      else if (key === 'crawl-delay' && cur) cur.delay = Number(val) || null;
    });
    const applicable = groups.filter((gr) => gr.agents.indexOf('*') >= 0 || gr.agents.indexOf('vn-agent') >= 0);
    const rules = applicable.reduce((acc, gr) => acc.concat(gr.rules), []);
    const delay = applicable.reduce((d, gr) => (gr.delay ? Math.max(d, gr.delay * 1000) : d), 0);
    return { rules: rules, delay: delay || null };
  }

  function robotsAllows(robots, path) {
    if (!robots || !robots.rules.length) return true;
    let decision = null, best = -1;
    robots.rules.forEach((r) => {
      if (!r.path) return;
      if (path.indexOf(r.path) === 0) {
        const len = r.path.length;
        if (len > best) { best = len; decision = r.allow; }
        else if (len === best && r.allow) decision = true;
      }
    });
    return decision !== false;
  }

  /* ---------- extractores determinísticos ---------- */
  const EXTRACTORS = {
    json: (body, cfg) => {
      let data;
      try { data = JSON.parse(body); } catch (e) { throw new Error('JSON inválido'); }
      const out = {};
      (cfg.fields || []).forEach((f) => {
        const v = f.path.split('.').reduce((o, k) => (o == null ? null : o[k]), data);
        out[f.name] = v == null ? null : v;
      });
      return out;
    },
    csv: (body, cfg) => {
      const sep = cfg.separator || ',';
      const lines = body.split(/\r?\n/).filter(Boolean);
      const header = (lines[0] || '').split(sep).map((h) => h.trim().replace(/^"|"$/g, ''));
      const rows = lines.slice(1).map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, '')));
      const idx = (cfg.fields || []).map((f) => ({ name: f.name, column: header.indexOf(f.column || f.name) }));
      return {
        rows: rows.length,
        sample: rows.slice(0, (cfg.sample || 5)).map((r) => {
          const o = {};
          idx.forEach((i) => { o[i.name] = i.column >= 0 ? r[i.column] : null; });
          return o;
        }),
        columns: header
      };
    },
    'html-table': (body, cfg) => {
      const tables = [];
      const re = /<table[\s\S]*?<\/table>/gi;
      let m;
      while ((m = re.exec(body))) {
        const rows = [];
        const rowRe = /<tr[\s\S]*?<\/tr>/gi;
        let rm;
        while ((rm = rowRe.exec(m[0]))) {
          const cells = [];
          const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
          let cm;
          while ((cm = cellRe.exec(rm[0]))) {
            cells.push(cm[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
          }
          if (cells.length) rows.push(cells);
        }
        if (rows.length) tables.push(rows);
      }
      return { tables: tables.length, firstTable: tables[cfg.table || 0] || [], rows: (tables[cfg.table || 0] || []).length };
    },
    regex: (body, cfg) => {
      const re = new RegExp(cfg.pattern, cfg.flags || 'gi');
      const found = [];
      let m;
      while ((m = re.exec(body)) && found.length < (cfg.limit || 50)) found.push(m[0]);
      return { matches: found.length, values: found };
    },
    none: () => ({})
  };

  /* cabeçalhos com valor probatório para a auditoria de APIs (nunca credenciais) */
  const HEADER_WHITELIST = [
    'content-type', 'content-length', 'cache-control', 'etag', 'last-modified', 'date',
    'strict-transport-security', 'content-security-policy', 'x-content-type-options',
    'x-frame-options', 'referrer-policy', 'access-control-allow-origin',
    'access-control-allow-credentials', 'access-control-expose-headers',
    'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'retry-after',
    'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-request-id', 'server', 'vary'
  ];
  function headersOf(res) {
    const out = {};
    HEADER_WHITELIST.forEach((h) => {
      const v = res.headers.get(h);
      if (v != null) out[h] = v;
    });
    return out;
  }

  /* ---------- núcleo ---------- */
  function createRunner(opts) {
    opts = opts || {};
    // allowPrivateHosts / limits: apenas para testes automatizados. A interface nunca os define.
    const limits = Object.assign({}, LIMITS, opts.limits || {});
    limits.maxProxyRequests = limits.maxProxyRequests || 200;
    const fetchFn = opts.fetchFn || (typeof fetch === 'function' ? fetch.bind(g) : null);
    const ledger = opts.ledger || null;
    const events = [];
    const state = { perHost: {}, robots: {}, requests: 0 };
    const emit = (ev) => { events.push(ev); if (opts.onEvent) opts.onEvent(ev); };

    async function hash(text) {
      if (g.crypto && g.crypto.subtle && typeof TextEncoder !== 'undefined') {
        const buf = await g.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
      }
      const nodeCrypto = (typeof require === 'function') ? require('crypto') : null;
      if (nodeCrypto) return nodeCrypto.createHash('sha256').update(text).digest('hex');
      return 'indisponivel';
    }

    async function fetchRobots(u) {
      const origin = u.origin;
      if (state.robots[origin]) return state.robots[origin];
      try {
        const res = await fetchFn(origin + '/robots.txt', { method: 'GET', redirect: 'follow' });
        const text = res.ok ? await res.text() : '';
        state.robots[origin] = parseRobots(text);
      } catch (e) {
        state.robots[origin] = { rules: [], delay: null, error: String(e && e.message || e) };
      }
      return state.robots[origin];
    }

    async function rateLimit(host) {
      const last = state.perHost[host] || 0;
      const wait = limits.minIntervalMs - (Date.now() - last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      state.perHost[host] = Date.now();
    }

    /* transport = 'direct' (fetch no cliente) | 'proxy' (agente local, mesmas guardas) */
    async function runViaProxy(task) {
      const res = await fetchFn(opts.proxyUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: task.id, url: task.url, source: task.source, method: task.method, extract: task.extract,
          robotsPolicy: task.robotsPolicy || 'obey', robotsJustification: task.robotsJustification || null,
          purpose: task.purpose || null, limits: task.limits || null
        })
      });
      if (!res.ok) throw new Error('agente local respondeu HTTP ' + res.status);
      const data = await res.json();
      const out = data.result;
      if (data.body != null) out.bodyText = data.body;
      if (data.body != null && out.evidence) {
        const digest = await hash(data.body);
        out.evidence.sha256Client = digest;
        out.evidence.sha256Agrees = digest === out.evidence.sha256;
        delete out.evidence.bodyText;
      }
      out.viaProxy = true;
      return out;
    }

    async function runOne(task, runOpts) {
      runOpts = runOpts || {};
      const dry = runOpts.dryRun !== false;
      const out = { id: task.id, label: task.label || task.id, url: task.url, source: task.source, status: 'pendente', evidence: null, error: null, extraction: null, dryRun: dry };
      const errors = validateTask(task);
      if (errors.length) {
        const softOnly = errors.every((e) => /privado\/local/.test(e));
        const delegated = softOnly && opts.transport === 'proxy';      // o agente local aplica a guarda
        const testBypass = softOnly && opts.allowPrivateHosts === true; // apenas testes automatizados
        if (!delegated && !testBypass) {
          out.status = 'recusada'; out.error = errors.join('; '); emit({ type: 'task', task: out }); return out;
        }
        out.note = delegated ? 'verificação de endereço delegada no agente local' : 'guarda SSRF desactivada (modo de teste)';
      }
      const cap = opts.transport === 'proxy' ? (limits.maxProxyRequests || 200) : limits.maxRequestsPerRun;
      if (state.requests >= cap) { out.status = 'recusada'; out.error = 'limite de ' + cap + ' pedidos por execução'; emit({ type: 'task', task: out }); return out; }

      const u = new URL(task.url);
      // Simulação não contacta ninguém: nem o robots.txt. O plano apenas declara o que será verificado.
      if (dry) {
        out.status = 'simulada';
        out.plan = {
          method: task.method || 'GET', url: task.url, headers: task.headers || {},
          checks: ['robots.txt do domínio', 'endereço público (sem SSRF)', 'tipo e tamanho da resposta', 'SHA-256 do corpo'],
          note: 'nenhum pedido efectuado'
        };
        if (ledger) {
          await ledger.append({
            type: 'recolha', subject: task.id,
            payload: { source: task.source, url: task.url, status: 'simulada', dryRun: true, checks: out.plan.checks },
            note: 'Simulação de recolha — nenhum pedido efectuado'
          });
        }
        emit({ type: 'task', task: out });
        return out;
      }
      const viaProxy = opts.transport === 'proxy' && opts.proxyUrl;
      const robots = viaProxy ? null : await fetchRobots(u).catch(() => null);
      if (robots && !robotsAllows(robots, u.pathname + u.search)) {
        /* robots.txt governa rastreadores. Quando a fonte publica termos próprios para
           clientes de API (com UA identificado), o operador pode declarar essa política
           na tarefa. Fica registado — não é um contorno silencioso. */
        if (task.robotsPolicy === 'api-terms' && task.robotsJustification) {
          out.robotsPolicy = { policy: 'api-terms', justification: task.robotsJustification, disallowedPath: u.pathname, robotsRules: robots.rules.length };
        } else {
          out.status = 'recusada';
          out.error = 'robots.txt proíbe este caminho (' + u.pathname + ') — a recolha não é feita' +
            (task.robotsPolicy === 'api-terms' ? ' (política «api-terms» sem justificação registada)' : '');
          emit({ type: 'task', task: out, robots: robots });
          return out;
        }
      }
      if (opts.transport === 'proxy' && opts.proxyUrl && !dry) {
        state.requests++;
        try { const via = await runViaProxy(task); if (ledger) {
          await ledger.append({ type: 'recolha', subject: task.id, payload: {
            source: task.source, url: task.url, status: via.status,
            httpStatus: via.evidence ? via.evidence.httpStatus : null,
            sha256: via.evidence ? via.evidence.sha256 : null,
            sha256Agrees: via.evidence ? via.evidence.sha256Agrees : null,
            bytes: via.evidence ? via.evidence.contentLength : null,
            fetchedAt: via.evidence ? via.evidence.fetchedAt : null, via: 'agente-local',
            robotsPolicy: via.robotsPolicy || (task.robotsPolicy === 'api-terms' ? { policy: 'api-terms', justification: task.robotsJustification || null } : null)
          }, note: 'Recolha via agente local; nenhum dado foi inserido no grafo' + (task.robotsPolicy === 'api-terms' ? ' · política declarada: api-terms' : '') }); }
          emit({ type: 'task', task: via }); return via;
        } catch (e) {
          const out = { id: task.id, label: task.label || task.id, url: task.url, source: task.source, status: 'falhou', error: String(e.message || e), evidence: null, extraction: null, viaProxy: true };
          emit({ type: 'task', task: out }); return out;
        }
      }

      await rateLimit(u.host);
      state.requests++;
      const startedAt = new Date().toISOString();
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      let res, body = '';
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), limits.timeoutMs) : null;
        res = await fetchFn(task.url, {
          method: task.method || 'GET',
          headers: Object.assign({ 'user-agent': 'VN-Agent/1.0 (+investigação documental; contacto do investigador)' }, task.headers || {}),
          redirect: 'follow',
          signal: controller ? controller.signal : undefined
        });
        if (timer) clearTimeout(timer);
        const buf = await res.arrayBuffer();
        if (buf.byteLength > limits.maxBytes) throw new Error('resposta acima do limite de ' + Math.round(limits.maxBytes / 1024) + ' kB');
        body = new TextDecoder('utf-8').decode(buf);
        const digest = await hash(body);
        out.evidence = {
          url: task.url, finalUrl: res.url || task.url, httpStatus: res.status,
          contentType: res.headers.get('content-type') || null,
          contentLength: buf.byteLength, sha256: digest, fetchedAt: startedAt,
          durationMs: Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0),
          lastModified: res.headers.get('last-modified') || null,
          etag: res.headers.get('etag') || null,
          source: task.source, robots: robots ? { rules: robots.rules.length, delay: robots.delay } : null
        };
        out.evidence.bodyText = body;   // memória de trabalho; removido antes de devolver/gravar
        out.bodyText = body;            // conveniência para extractores externos (não é gravado)
        out.evidence.headers = headersOf(res);
        out.status = res.ok ? 'recolhida' : 'erro-http';
        if (!res.ok) out.error = 'HTTP ' + res.status;
        if (res.ok && task.extract) {
          try {
            out.extraction = EXTRACTORS[task.extract.type](body, task.extract);
            // guardar apenas um recorte, não o corpo inteiro
            out.evidence.excerpt = body.slice(0, 400).replace(/\s+/g, ' ');
          } catch (e) { out.error = 'extracção falhou: ' + e.message; out.status = 'erro-extracao'; }
        }
      } catch (e) {
        out.status = 'falhou';
        const msg = String((e && (e.message || e)) || '');
        const code = (e && e.cause && e.cause.code) || '';
        const tls = /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|CERT_|ERR_TLS|unable to verify/i.test(msg + ' ' + code);
        if (tls) { out.tlsError = true; out.error = 'certificado TLS não verificável (' + (code || msg.slice(0, 60)) + ') — a recolha não é feita'; }
        else out.error = e && e.name === 'AbortError' ? 'tempo limite excedido (' + limits.timeoutMs + ' ms)' : (msg || 'falha de rede');
      }

      if (ledger) {
        await ledger.append({
          type: 'recolha',
          subject: task.id,
          payload: {
            source: task.source, url: task.url, status: out.status,
            httpStatus: out.evidence ? out.evidence.httpStatus : null,
            sha256: out.evidence ? out.evidence.sha256 : null,
            bytes: out.evidence ? out.evidence.contentLength : null,
            fetchedAt: startedAt, extraction: out.extraction, error: out.error,
            robotsPolicy: out.robotsPolicy || null
          },
          note: 'Recolha automática (agente); nenhum dado foi inserido no grafo' + (out.robotsPolicy ? ' · política declarada: api-terms' : '')
        });
      }
      emit({ type: 'task', task: out });
      return out;
    }

    async function run(tasks, runOpts) {
      const results = [];
      state.requests = 0;
      for (const t of (tasks || [])) results.push(await runOne(t, runOpts));
      const summary = {
        total: results.length,
        recolhidas: results.filter((r) => r.status === 'recolhida').length,
        simuladas: results.filter((r) => r.status === 'simulada').length,
        recusadas: results.filter((r) => r.status === 'recusada').length,
        falhas: results.filter((r) => ['falhou', 'erro-http', 'erro-extracao'].indexOf(r.status) >= 0).length,
        finishedAt: new Date().toISOString()
      };
      emit({ type: 'summary', summary: summary });
      return { results: results, summary: summary };
    }

    return { run, runOne, validateTask, parseRobots, robotsAllows, isPrivateHost, LIMITS: limits, EXTRACTORS, events: () => events };
  }

  /* ---------- biblioteca de tarefas de exemplo (reais, parametrizáveis) ---------- */
  function exampleTasks() {
    /* Estado verificado em 2026-10-21 a partir do agente local:
       · dados.gov.pt  → 200 application/json (extracção útil)
       · diariodarepublica.pt → 200, mas a listagem é construída por JavaScript (sem extracção server-side)
       · base.gov.pt   → 200, tabela também gerada no cliente (sem extracção server-side)
       · arquivo.pt    → 403 e robots.txt proíbe /wayback/cdx: a recolha é recusada, como deve ser
       Nenhuma destas fontes é usada para preencher o grafo sem revisão humana. */
    return [
      {
        id: 'dados-gov', label: 'dados.gov.pt — catálogo de dados abertos (API)', source: 'dados',
        url: 'https://dados.gov.pt/api/1/datasets/?page_size=2', method: 'GET',
        extract: { type: 'json', fields: [{ name: 'total', path: 'total' }, { name: 'primeiroTitulo', path: 'data.0.title' }] },
        note: 'API pública (JSON). Devolve metadados do catálogo, não contratos: serve para provar obtenção e hash.'
      },
      {
        id: 'dr-pesquisa', label: 'Diário da República — Pesquisa', source: 'dr',
        url: 'https://diariodarepublica.pt/dr/pesquisa?q=funda%C3%A7%C3%A3o', method: 'GET',
        extract: { type: 'regex', pattern: '<title>[^<]{5,200}</title>', limit: 2 },
        note: 'Listagem construída por JavaScript: prova-se a obtenção (200 + hash), não a extracção. Para o conteúdo, abrir o URL final.'
      },
      {
        id: 'base-contratos', label: 'Portal BASE — contratos públicos', source: 'base',
        url: 'https://www.base.gov.pt/Base4/pt/pesquisa/?type=contratos&texto=500000000', method: 'GET',
        extract: null,
        note: 'Pesquisa por NIF. Página 200 com resultados gerados no cliente; substituir texto= pelo NIF em análise.'
      }
    ];
  }

  VN.agents = { createRunner, exampleTasks, EXTRACTORS, LIMITS, parseRobots, robotsAllows, isPrivateHost, validateTask };
})(typeof window !== 'undefined' ? window : globalThis);
