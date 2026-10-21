/* =====================================================================
   VN · APIs EXTERNAS
   Duas coisas distintas, de propósito:
   1. CATÁLOGO — APIs que sabemos para que servem, com limite, licença e
      o que cada uma NÃO responde. A entrada é curada e datada.
   2. AUDITORIA — um agente que pede a API, mede o que aconteceu e pontua
      segurança / utilidade / fiabilidade com razões explícitas.
   Regras: nenhuma pontuação sem razão; nenhum dado de auditoria entra no
   grafo; uma API "aprovada" não é uma API "confiável para tudo".
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});

  const NOW = '2026-10-21';

  /* ------------------------------------------------------------------
     CATÁLOGO CURADO
     usefulness.score: 0–100 avaliado pelo que a API responde para uma
     investigação de fluxos financeiros e ligações societárias em PT/UE.
     Cada entrada declara o limite e o que não prova.
     ------------------------------------------------------------------ */
  const CATALOG = [
    {
      id: 'gleif', name: 'GLEIF — LEI (Legal Entity Identifier)', group: 'societário',
      url: 'https://api.gleif.org/api/v1/lei-records?page%5Bsize%5D=1', docs: 'https://www.gleif.org/en/lei-data/gleif-api',
      licence: 'Dados abertos CC0 (GLEIF)', auth: 'nenhuma', keyed: false, https: true,
      answers: 'Identificador único internacional de entidades legais, nome, país, endereço registado, entidade-mãe (relação de reporte).',
      limits: 'Não traz beneficiário efectivo nem capital; a relação «ultimate parent» é declarada pela própria entidade.',
      usefulness: { score: 88, why: 'Liga sucursais e grupos entre países pelo mesmo identificador — resolve homónimos de empresas.' },
      probe: { url: 'https://api.gleif.org/api/v1/lei-records?page%5Bsize%5D=1', json: true, hasPath: 'data.0.id', badUrl: 'https://api.gleif.org/api/v1/lei-records/XXXX' },
      measured: { status: 200, contentType: 'application/vnd.api+json' }
    },
    {
      id: 'vies', name: 'VIES — validação de NIF intracomunitário', group: 'societário',
      url: 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/PT/vat/500000000', docs: 'https://ec.europa.eu/taxation_customs/vies/#/technical-information',
      licence: 'Serviço público da Comissão Europeia (uso razoável)', auth: 'nenhuma', keyed: false, https: true,
      answers: 'Se um número de IVA está registado e activo, e o nome e endereço associados no momento da consulta.',
      limits: 'Só valida; não devolve histórico nem participações. O nome pode vir incompleto. Guardar o resultado com data — muda com o tempo.',
      usefulness: { score: 72, why: 'Confirma existência legal de uma contraparte antes de aceitar um nome como identidade.' },
      probe: { url: 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/PT/vat/500000000', json: true, hasPath: 'isValid' },
      measured: { status: 200, contentType: 'application/json' }
    },
    {
      id: 'wikidata', name: 'Wikidata — entidades e identificadores', group: 'referência',
      url: 'https://www.wikidata.org/w/rest.php/v1/search/page?q=funda%C3%A7%C3%A3o&limit=1', docs: 'https://www.wikidata.org/wiki/Wikidata:REST_API',
      robotsPolicy: 'api-terms',
      robotsJustification: 'robots.txt da Wikimedia bloca /w/ para rastreadores; a própria Wikimedia publica uma política de UA para clientes de API (API:Etiquette). Uso declarado como cliente de API identificado, 1 pedido pontual.',
      licence: 'CC0', auth: 'nenhuma', keyed: false, https: true,
      answers: 'Identificadores estáveis (Q…) que ligam a mesma pessoa/empresa em bases diferentes; ligações a registos oficiais por propriedade.',
      limits: 'Conteúdo editável por qualquer pessoa. Nunca é fonte primária: serve para desambiguar e para chegar ao registo oficial. O robots.txt proíbe /w/ a rastreadores — o acesso é feito ao abrigo da política de cliente de API, declarada na tarefa.',
      usefulness: { score: 80, why: 'Resolve homónimos e dá o mapa de identificadores de outras bases — o passo que evita fundir duas pessoas erradas.' },
      probe: { url: 'https://www.wikidata.org/w/rest.php/v1/search/page?q=funda%C3%A7%C3%A3o&limit=1', json: true, hasPath: 'pages' },
      measured: { status: 200, contentType: 'application/json' }
    },
    {
      id: 'dados-gov', name: 'dados.gov.pt — catálogo de dados abertos', group: 'nacional',
      url: 'https://dados.gov.pt/api/1/datasets/?page_size=1', docs: 'https://dados.gov.pt/pt/docapi/',
      licence: 'Dados abertos (ver licença de cada conjunto)', auth: 'nenhuma', keyed: false, https: true,
      answers: 'Índice de conjuntos de dados públicos portugueses (contratos, subsídios, efetivos) com URL de descarga.',
      limits: 'Catálogo, não dados: a licença e a qualidade variam por conjunto. Muitos conjuntos estão desactualizados.',
      usefulness: { score: 84, why: 'Porta de entrada para os dados administrativos que documentam transferências públicas.' },
      probe: { url: 'https://dados.gov.pt/api/1/datasets/?page_size=1', json: true, hasPath: 'total' },
      measured: { status: 200, contentType: 'application/json' }
    },
    {
      id: 'dr', name: 'Diário da República — pesquisa', group: 'nacional',
      url: 'https://diariodarepublica.pt/dr/pesquisa?q=funda%C3%A7%C3%A3o', docs: 'https://diariodarepublica.pt/dr/ajuda',
      licence: 'Consulta pública (termos do IMPIC/INCM)', auth: 'nenhuma', keyed: false, https: true,
      answers: 'Actos societários publicados: constituição, alterações de capital, gerentes, fusões, dissoluções.',
      limits: 'A listagem é gerada no cliente (a extracção automática não vê resultados). É prova documental, não dado estruturado.',
      usefulness: { score: 95, why: 'É a fonte primária portuguesa para participações e órgãos sociais — o que se cita num relatório.' },
      probe: { url: 'https://diariodarepublica.pt/dr/pesquisa?q=funda%C3%A7%C3%A3o', json: false, expectHtml: true },
      measured: { status: 200, contentType: 'text/html; charset=utf-8', note: 'HTML dinâmico: recolha válida, extracção automática limitada' }
    },
    {
      id: 'base', name: 'Portal BASE — contratos públicos', group: 'nacional',
      url: 'https://www.base.gov.pt/Base4/pt/pesquisa/?type=contratos&texto=500000000', docs: 'https://www.base.gov.pt/Base4/pt/ayuda/',
      licence: 'Dados abertos do Estado (ver termos do BASE)', auth: 'nenhuma', keyed: false, https: true,
      answers: 'Contratos públicos: adjudicante, adjudicatário, objecto, valor, data, procedimento.',
      limits: 'Interface sem API documentada estável; a listagem exige JavaScript. Para volume, usar os ficheiros abertos do portal.',
      usefulness: { score: 92, why: 'Liga empresas a dinheiro público com valor e data — a relação financeira mais verificável em PT.' },
      probe: { url: 'https://www.base.gov.pt/Base4/pt/pesquisa/?type=contratos&texto=500000000', json: false, expectHtml: true },
      measured: { status: 200, contentType: 'text/html; charset=utf-8', note: 'HTML dinâmico' }
    },
    {
      id: 'eurostat', name: 'Eurostat — estatísticas europeias', group: 'referência',
      url: 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nama_10_gdp?format=JSON&geo=PT&time=2020', docs: 'https://wikis.ec.europa.eu/display/EUROSTATHELP/API+-+Getting+started',
      licence: 'Reutilização livre com atribuição (Comissão Europeia)', auth: 'nenhuma', keyed: false, https: true,
      answers: 'Séries macro (PIB, emprego, comércio) por país/região — contexto para dimensionar valores atípicos.',
      limits: 'Agregados estatísticos, nunca entidades. Não serve para afirmar nada sobre uma empresa concreta.',
      usefulness: { score: 45, why: 'Útil para contexto e proporções, não para relações entre entidades.' },
      probe: { url: 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nama_10_gdp?format=JSON&geo=PT&time=2020', json: true, hasPath: 'dimension' },
      measured: { status: 200, contentType: 'application/json' }
    },
    {
      id: 'worldbank', name: 'World Bank — indicadores', group: 'referência',
      url: 'https://api.worldbank.org/v2/country/PT?format=json', docs: 'https://datahelpdesk.worldbank.org/knowledgebase/topics/125589',
      licence: 'CC BY 4.0', auth: 'nenhuma', keyed: false, https: true,
      answers: 'País/região, rendimento, indicadores de desenvolvimento.',
      limits: 'País como unidade. Nenhuma entidade, nenhuma relação societária.',
      usefulness: { score: 38, why: 'Contexto macro apenas; baixa relevância para ligações societárias.' },
      probe: { url: 'https://api.worldbank.org/v2/country/PT?format=json', json: true, hasPath: '0' },
      measured: { status: 200, contentType: 'application/json;charset=utf-8' }
    },
    {
      id: 'data-europa', name: 'data.europa.eu — hub de dados da UE', group: 'referência',
      url: 'https://data.europa.eu/api/hub/search/search?q=fundo', docs: 'https://data.europa.eu/en/developers',
      licence: 'Varia por conjunto; metadados abertos', auth: 'nenhuma', keyed: false, https: true,
      answers: 'Metadados de conjuntos de dados europeus (incluindo contratos e beneficiários de fundos).',
      limits: 'Metadados, não dados. A qualidade e a licença variam por conjunto.',
      usefulness: { score: 66, why: 'Ajuda a localizar fundos e beneficiários publicados por vários Estados.' },
      probe: { url: 'https://data.europa.eu/api/hub/search/search?q=fundo', json: true, hasPath: 'result' },
      measured: { status: 200, contentType: 'application/json' }
    },
    {
      id: 'ted', name: 'TED — contratação pública da UE', group: 'europeu',
      url: 'https://api.ted.europa.eu/v3/notices/search', docs: 'https://docs.ted.europa.eu/api/latest/',
      licence: 'Reutilização livre (Comissão Europeia)', auth: 'nenhuma (POST)', keyed: false, https: true,
      answers: 'Anúncios de concursos e adjudicações acima dos limiares europeus.',
      limits: 'Só aceita POST com corpo próprio: um agente GET é recusado (405) — não é falha da fonte.',
      usefulness: { score: 78, why: 'Contratos europeus ligam adjudicatários a valores e datas com identificadores estáveis.' },
      probe: { url: 'https://api.ted.europa.eu/v3/notices/search', json: true, method: 'GET', expectStatus: 405 },
      measured: { status: 405, contentType: 'application/json', note: 'exige POST — erros correctos são sinal de API viva' }
    },
    {
      id: 'eu-sanctions', name: 'EU — lista consolidada de sanções (XML/FSF)', group: 'sanções',
      url: 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw', docs: 'https://finance.ec.europa.eu/eu-and-world/sanctions-restrictive-measures/overview-sanctions-and-related-resources_en',
      licence: 'Documento oficial (reutilização com atribuição)', auth: 'nenhuma', keyed: false, https: true,
      answers: 'Pessoas e entidades sujeitas a medidas restritivas da UE, com identificadores e fundamentos.',
      limits: 'Ficheiro com ~19 MB (acima do limite do agente): recolher manualmente ou com limite elevado. Uma ausência não iliba — há sanções de outros países.',
      usefulness: { score: 90, why: 'Liga pessoas e empresas a um estado jurídico oficial e datado — nunca a uma suspeita.' },
      probe: { url: 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw', json: false, skipBody: true, expectXml: true, tooLarge: true, sizeHintMB: 19.5 },
      measured: { status: 200, contentType: 'application/xml', note: '≈19,5 MB · tempo > 2 s' }
    },
    {
      id: 'apis-guru', name: 'APIs.guru — catálogo de APIs (descoberta)', group: 'descoberta',
      url: 'https://api.apis.guru/v2/providers.json', docs: 'https://apis.guru/api-doc/',
      licence: 'CC0 (metadados OpenAPI)', auth: 'nenhuma', keyed: false, https: true,
      answers: 'Lista de fornecedores e especificações OpenAPI — é a fonte usada pelo agente de descoberta desta aplicação.',
      limits: 'Metadados de terceiros: não garante que a API esteja viva, gratuita ou permitida. Cada candidato tem de ser auditado.',
      usefulness: { score: 70, why: 'Permite descobrir APIs e obter a sua especificação para teste automático — sem inventar endpoints.' },
      probe: { url: 'https://api.apis.guru/v2/providers.json', json: true, hasPath: 'data' },
      measured: { status: 200, contentType: 'application/json' }
    }
  ];

  /* ------------------------------------------------------------------
     DIMENSÕES E PESOS — explícitos, para a pontuação ser discutível
     ------------------------------------------------------------------ */
  const WEIGHTS = {
    security: [
      ['https', 25, 'todo o pedido é feito por TLS (https)'],
      ['httpsRedirect', 10, 'redireccionamentos mantêm https'],
      ['hsts', 10, 'cabeçalho Strict-Transport-Security presente'],
      ['browserSafe', 10, 'CORS explícito ou ausente sem credenciais (sem wildcard+credenciais)'],
      ['robots', 10, 'robots.txt permite o caminho pedido'],
      ['noKeyInUrl', 15, 'não exige chave na query string'],
      ['headers', 10, 'Content-Security-Policy / X-Content-Type-Options presentes'],
      ['noCredentials', 10, 'nenhuma credencial foi necessária nesta auditoria']
    ],
    reliability: [
      ['availability', 40, 'número de pedidos bem sucedidos em 3 tentativas'],
      ['latency', 25, 'latência mediana'],
      ['consistency', 15, 'tipo de conteúdo estável entre tentativas'],
      ['errorSemantics', 15, 'erro devolve 4xx (não 5xx nem 200 com erro)']
    ],
    usefulness: [
      ['curated', 60, 'valor declarado e justificado para a investigação'],
      ['structure', 20, 'resposta é máquina-legível e traz os campos esperados'],
      ['coverage', 20, 'cobre entidades e ligações reais (não só agregados)']
    ]
  };

  function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

  /* resolve um caminho "a.0.b" num objecto (para validar respostas) */
  function pathOf(obj, path) {
    if (!path) return undefined;
    return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  /* ------------------------- auditoria ------------------------- */
  async function auditOne(entry, runner, opts) {
    opts = opts || {};
    const attempts = opts.attempts || 3;
    const reasons = { security: [], reliability: [], usefulness: [] };
    const points = { security: 0, reliability: 0, usefulness: 0 };
    const runs = [];
    const add = (dim, key, pts, text) => { points[dim] += pts; reasons[dim].push({ key: key, points: pts, text: text }); };

    /* --- utilidade declarada --- */
    const curated = entry.usefulness && typeof entry.usefulness.score === 'number' ? entry.usefulness.score : 40;
    add('usefulness', 'curated', (curated / 100) * 60, (entry.usefulness && entry.usefulness.why) || 'valor declarado no catálogo');

    const tooLarge = !!(entry.probe && entry.probe.tooLarge);
    let first = null;
    for (let i = 0; i < attempts && !tooLarge; i++) {
      const res = await runner.runOne({
        id: entry.id + '#' + i, url: entry.url, source: entry.id,
        method: entry.probe && entry.probe.method ? entry.probe.method : 'GET',
        robotsPolicy: entry.robotsPolicy || 'obey',
        robotsJustification: entry.robotsJustification || null
      }, { dryRun: false });
      runs.push(res);
      if (!first && res.evidence) first = res.evidence;
    }
    const ok = runs.filter((r) => r.evidence && r.evidence.httpStatus >= 200 && r.evidence.httpStatus < 300);
    const expected = entry.probe && entry.probe.expectStatus ? entry.probe.expectStatus : null;
    const expectedOk = expected ? runs.filter((r) => r.evidence && r.evidence.httpStatus === expected) : ok;
    const good = expected ? expectedOk : ok;
    const lat = runs.filter((r) => r.evidence && r.evidence.fetchedAt).map((r) => r.evidence && r.evidence.durationMs).filter((x) => typeof x === 'number');

    if (entry.probe && entry.probe.tooLarge) {
      add('reliability', 'availability', 0, 'não auditada automaticamente: ficheiro de ≈' + (entry.probe.sizeHintMB || '?') + ' MB excede o limite de 2 MB do agente');
    }

    /* --- fiabilidade --- */
    const authBlocked = runs.filter((r) => r.evidence && (r.evidence.httpStatus === 401 || r.evidence.httpStatus === 403)).length;
    if (!tooLarge && !good.length && authBlocked === runs.length) {
      add('reliability', 'availability', 24, 'exige credenciais (HTTP ' + (runs[0].evidence.httpStatus) + '): não é avaria, mas também não é uma fonte verificável sem chave');
    } else {
      add('reliability', 'availability', tooLarge ? 0 : (good.length / attempts) * 40, good.length + '/' + attempts + ' pedidos com a resposta esperada' + (expected ? ' (HTTP ' + expected + ')' : ' (2xx)'));
    }
    const latency = lat.length ? lat.slice().sort((a, b) => a - b)[Math.floor(lat.length / 2)] : null;
    const latPts = latency == null ? 0 : latency < 400 ? 25 : latency < 900 ? 19 : latency < 2000 ? 12 : 5;
    add('reliability', 'latency', latPts, latency == null ? 'latência não medida (sem corpo/tempos)' : 'mediana ' + latency + ' ms');
    const types = Array.from(new Set(runs.map((r) => r.evidence && r.evidence.contentType).filter(Boolean)));
    add('reliability', 'consistency', types.length <= 1 ? 15 : 6, types.length <= 1 ? 'tipo de conteúdo estável' : 'tipo variou: ' + types.join(' / '));

    let errorSemantics = 0, badNote = tooLarge ? 'não testado (recolha manual necessária)' : 'não testado';
    if (!tooLarge && entry.probe && entry.probe.badUrl) {
      const bad = await runner.runOne({ id: entry.id + '#bad', url: entry.probe.badUrl, source: entry.id }, { dryRun: false });
      const st = bad.evidence && bad.evidence.httpStatus;
      if (st >= 400 && st < 500) { errorSemantics = 15; badNote = 'recurso inexistente devolve ' + st + ' (erro honesto)'; }
      else if (st >= 500) { badNote = 'recurso inexistente devolveu ' + st + ' (erro do servidor)'; }
      else badNote = 'recurso inexistente devolveu ' + (st || 'sem resposta') + ' — cuidado ao interpretar vazios';
    }
    add('reliability', 'errorSemantics', errorSemantics, badNote);

    /* --- utilidade medida --- */
    let structure = 0, structureNote = 'sem resposta para avaliar estrutura';
    const body = runs.map((r) => (r.bodyText != null ? r.bodyText : (r.evidence && r.evidence.bodyText))).find((b) => b != null);
    if (body != null) {
      let parsed = null;
      if (entry.probe && entry.probe.json !== false) { try { parsed = JSON.parse(body); } catch (e) { parsed = null; } }
      if (parsed == null && entry.probe && entry.probe.json !== false) structureNote = 'corpo recebido mas não é JSON — não é utilizável por um agente';
      if (parsed && (entry.probe.hasPath ? pathOf(parsed, entry.probe.hasPath) !== undefined : true)) {
        structure = 20; structureNote = 'JSON válido' + (entry.probe.hasPath ? ' e campo «' + entry.probe.hasPath + '» presente' : '');
      } else if (parsed) { structure = 10; structureNote = 'JSON válido, mas o campo esperado «' + entry.probe.hasPath + '» não aparece'; }
      else if (entry.probe && (entry.probe.expectHtml || entry.probe.expectXml)) { structure = 8; structureNote = 'documento legível por humanos (' + (first ? first.contentType : '?') + ') — extracção automática limitada'; }
      else { structure = 0; structureNote = structureNote.indexOf('não é JSON') >= 0 ? structureNote : 'resposta não interpretável'; }
    }
    add('usefulness', 'structure', structure, structureNote);
    const cov = entry.group === 'referência' ? 6 : entry.group === 'descoberta' ? 10 : 20;
    add('usefulness', 'coverage', cov, entry.group === 'referência' ? 'dados agregados: não descreve entidades' : 'descreve entidades e/ou ligações');

    /* --- segurança --- */
    const u = first ? first.finalUrl || first.url : entry.url;
    const isHttps = /^https:/i.test(entry.url) && (!first || /^https:/i.test(u));
    add('security', 'https', isHttps ? 25 : 0, isHttps ? 'TLS em todos os pedidos' : 'há pedido sem TLS');
    add('security', 'httpsRedirect', isHttps ? 10 : 0, isHttps ? 'sem downgrade de protocolo' : 'redireccionamento para http');
    const h = (first && first.headers) || {};
    add('security', 'hsts', h['strict-transport-security'] ? 10 : 0, h['strict-transport-security'] ? 'HSTS activo' : 'sem HSTS (não impede o uso, apenas endurece)');
    const acao = h['access-control-allow-origin'];
    const acac = h['access-control-allow-credentials'];
    const wildcardCreds = acao === '*' && String(acac) === 'true';
    add('security', 'browserSafe', wildcardCreds ? 0 : 10, wildcardCreds ? 'CORS wildcard com credenciais (perigoso)' : (acao ? 'CORS declarado: ' + acao : 'sem CORS: não utilizável directamente no navegador (usar agente local)'));
    const robotsOk = tooLarge ? true : runs.every((r) => r.status !== 'recusada' || !/robots/.test(r.error || ''));
    const policy = runs.map((r) => r.robotsPolicy).find(Boolean) || null;
    add('security', 'robots', robotsOk ? 10 : 0,
      policy ? 'robots.txt proíbe ' + policy.disallowedPath + ' para rastreadores; pedido feito como cliente de API com UA identificado, por decisão registada do operador'
             : robotsOk ? 'robots.txt permite o pedido' : 'robots.txt proíbe: recolha automatizada recusada');
    const keyInUrl = /[?&](api[_-]?key|key|token|apikey|access_token)=/i.test(entry.url);
    add('security', 'noKeyInUrl', keyInUrl ? 0 : 15, keyInUrl ? 'chave na query string (fica em registos e referrers)' : 'nenhuma chave na URL');
    const secHeaders = (h['content-security-policy'] ? 1 : 0) + (h['x-content-type-options'] ? 1 : 0) + (h['referrer-policy'] ? 1 : 0);
    add('security', 'headers', secHeaders >= 2 ? 10 : secHeaders === 1 ? 5 : 0, secHeaders ? secHeaders + ' cabeçalho(s) de endurecimento presentes' : 'sem CSP/XCTO/Referrer-Policy');
    add('security', 'noCredentials', 10, 'nenhuma credencial introduzida pelo agente');

    /* --- veredicto --- */
    const s = clamp(points.security), r = clamp(points.reliability), us = clamp(points.usefulness);
    const fatal = [];
    const tlsFail = runs.some((r) => r.tlsError) || (first && first.tlsError);
    if (tlsFail) { fatal.push('certificado TLS não verificável'); add('security', 'tlsChain', -0, 'cadeia de certificados incompleta ou inválida: o pedido é recusado pelo agente'); }
    if (!isHttps && !opts.allowHttp) fatal.push('sem TLS');
    if (!robotsOk) fatal.push('robots.txt proíbe');
    if (wildcardCreds) fatal.push('CORS wildcard com credenciais');
    const min = Math.min(s, r, us);
    const outOfScope = us < 55 && s >= 70 && r >= 40 && min === us;
    const verdict = fatal.length ? 'rejeitada'
      : tooLarge ? 'nao-auditada'
      : outOfScope ? 'fora-do-ambito'
      : min >= 75 ? 'aprovada' : min >= 55 ? 'condicional' : 'rejeitada';
    const verdictWhy = fatal.length
      ? 'Falha bloqueante: ' + fatal.join('; ')
      : tooLarge ? 'Fiável e segura segundo o que foi possível medir, mas demasiado grande para o agente (≈' + (entry.probe.sizeHintMB || '?') + ' MB): recolher manualmente.'
      : outOfScope ? 'Tecnicamente sólida (segurança ' + s + ', fiabilidade ' + r + '), mas a utilidade é ' + us + '/100: descreve agregados, não entidades ou ligações.'
      : verdict === 'aprovada' ? 'Todas as dimensões ≥ 75.'
      : verdict === 'condicional' ? 'Dimensão mais fraca em ' + min + '/100 — usar com as ressalvas listadas.'
      : 'Dimensão mais fraca em ' + min + '/100 — não cumpre o mínimo para uso em investigação.';

    return {
      id: entry.id, name: entry.name, group: entry.group, url: entry.url, docs: entry.docs || null,
      licence: entry.licence || null, auth: entry.auth || null, answers: entry.answers || null, limits: entry.limits || null,
      auditedAt: new Date().toISOString(),
      runs: runs.map((x) => ({
        status: x.status, http: x.evidence ? x.evidence.httpStatus : null,
        bytes: x.evidence ? x.evidence.contentLength : null,
        type: x.evidence ? x.evidence.contentType : null,
        sha256: x.evidence ? String(x.evidence.sha256 || '').slice(0, 16) : null,
        tlsError: !!x.tlsError, note: x.error || null
      })),
      headers: h,
      scores: { security: s, reliability: r, usefulness: us },
      reasons: reasons, points: points, weights: WEIGHTS,
      verdict: verdict, verdictWhy: verdictWhy, fatal: fatal,
      probeOk: good.length > 0
    };
  }

  async function auditAll(entries, runner, opts) {
    const out = [];
    for (const e of entries) out.push(await auditOne(e, runner, opts));
    return out.sort((a, b) => (b.scores.security + b.scores.reliability + b.scores.usefulness) - (a.scores.security + a.scores.reliability + a.scores.usefulness));
  }

  /* ------------------------------------------------------------------
     DESCOBERTA DE APIs (agente)
     Fonte: APIs.guru (metadados OpenAPI). Não inventa endpoints: lê a
     especificação e, quando consegue, deriva um pedido GET sem parâmetros
     obrigatórios. Se não conseguir, diz que não conseguiu.
     ------------------------------------------------------------------ */
  const DISCOVERY_SOURCES = [
    { id: 'apis-guru', name: 'APIs.guru', listUrl: 'https://api.apis.guru/v2/list.json', perProvider: 'https://api.apis.guru/v2/{provider}.json', licence: 'CC0' }
  ];

  /* Descoberta: uma chamada ao catálogo (declarada como purpose=catalogue) + filtro local. */
  async function discoverCatalog(runner, term, limit) {
    const res = await runner.runOne({
      id: 'apis-guru-list', url: 'https://api.apis.guru/v2/list.json', source: 'apis-guru',
      purpose: 'catalogue', limits: { maxBytes: 12 * 1024 * 1024 }
    }, { dryRun: false });
    const body = res.bodyText != null ? res.bodyText : (res.evidence && res.evidence.bodyText);
    if (!body) return { candidates: [], error: res.error || res.status || 'catálogo não obtido', bytes: res.evidence ? res.evidence.contentLength : null };
    let list = null;
    try { list = JSON.parse(body); } catch (e) { return { candidates: [], error: 'catálogo recebido não é JSON', bytes: body.length }; }
    return { candidates: candidatesFromList(list, term, limit || 24), error: null, bytes: body.length, sha256: res.evidence ? res.evidence.sha256 : null };
  }

  function normaliseTerm(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim(); }

  /* Extrai candidatos de uma lista de APIs.guru (formato {provider: {preferred, versions:{v:{info,swaggerUrl,...}}}}) */
  function candidatesFromList(list, terms, limit) {
    const t = normaliseTerm(terms).split(/\s+/).filter(Boolean);
    const out = [];
    Object.keys(list || {}).forEach((provider) => {
      const entry = list[provider] || {};
      const pref = entry.preferred;
      const versions = entry.versions || {};
      Object.keys(versions).forEach((v) => {
        const spec = versions[v] || {};
        const info = spec.info || {};
        const hay = normaliseTerm([provider, info.title, info.description, (info['x-apisguru-categories'] || []).join(' ')].join(' '));
        const hits = t.filter((term) => hay.indexOf(term) >= 0);
        if (t.length && !hits.length) return;
        const cat = (info['x-apisguru-categories'] || [])[0] || null;
        out.push({
          provider: provider, version: v, preferred: v === pref,
          title: info.title || provider, description: (info.description || '').slice(0, 240),
          category: cat, version_license: (info['x-apisguru-categories'] ? null : null),
          specUrl: spec.swaggerUrl || null, openapiUrl: spec.openapiUrl || spec.swaggerUrl || null,
          docs: (spec.info && spec.info['x-origin'] && spec.info['x-origin'][0] && spec.info['x-origin'][0].url) || null,
          terms: (info.termsOfService || null), contact: (info.contact && info.contact.name) || null,
          hits: hits, score: hits.length * 10 + (v === pref ? 2 : 0) + (spec.swaggerUrl ? 1 : 0)
        });
      });
    });
    return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit || 40);
  }

  /* Deriva um pedido seguro a partir da especificação OpenAPI/Swagger. */
  function deriveProbe(spec) {
    const servers = (spec.servers || []).map((s) => s.url).filter(Boolean);
    const base = servers[0] || (spec.host ? ((spec.schemes && spec.schemes[0]) || 'https') + '://' + spec.host + (spec.basePath || '') : null);
    const paths = spec.paths || {};
    const secDefs = (spec.components && spec.components.securitySchemes) || spec.securityDefinitions || {};
    const authTypes = Object.keys(secDefs).map((k) => secDefs[k].type || secDefs[k].scheme || 'declarado');
    const globalSecurity = (spec.security || []).length > 0;
    let chosen = null;
    for (const p of Object.keys(paths)) {
      const item = paths[p] || {};
      const op = item.get;
      if (!op) continue;
      // parâmetros podem estar no item de caminho (Swagger 2.0) ou na operação (OpenAPI 3)
      const params = (item.parameters || []).concat(op.parameters || []);
      const requiredPath = params.filter((x) => (x.in === 'path' || x.in === 'query') && x.required);
      if (requiredPath.length) continue;
      if ((op.security || globalSecurity) && (op.security === undefined ? true : op.security.length)) {
        // se a segurança está declarada globalmente, o pedido precisa de chave: não serve de sonda
        if (globalSecurity || (op.security || []).length) continue;
      }
      chosen = { path: p, summary: op.summary || op.operationId || null };
      break;
    }
    return {
      base: base, path: chosen ? chosen.path : null, summary: chosen ? chosen.summary : null,
      url: base && chosen ? base.replace(/\/$/, '') + chosen.path : null,
      openapi: spec.openapi || spec.swagger || null,
      pathCount: Object.keys(paths).length,
      requiresAuth: globalSecurity || authTypes.length > 0,
      authTypes: authTypes,
      title: (spec.info && spec.info.title) || null,
      version: (spec.info && spec.info.version) || null,
      licence: (spec.info && spec.info.license && spec.info.license.name) || null
    };
  }

  /* Auditoria de um candidato descoberto: especificação + (se possível) um pedido real. */
  async function auditCandidate(cand, runner) {
    const out = { candidate: cand, spec: null, probe: null, audit: null, notes: [] };
    const specRes = await runner.runOne({
      id: 'spec-' + cand.provider, url: cand.openapiUrl, source: 'apis-guru',
      purpose: 'spec', limits: { maxBytes: 24 * 1024 * 1024 }
    }, { dryRun: false });
    const specBody = specRes.bodyText != null ? specRes.bodyText : (specRes.evidence && specRes.evidence.bodyText);
    if (specBody == null) {
      out.notes.push('especificação não obtida (' + (specRes.error || specRes.status) + ')');
      return out;
    }
    let spec = null;
    try { spec = JSON.parse(specBody); } catch (e) { out.notes.push('especificação não é JSON válido'); }
    if (!spec) return out;
    const probe = deriveProbe(spec);
    out.spec = {
      title: probe.title, version: probe.version, licence: probe.licence, openapi: probe.openapi,
      sizeMB: specBody.length > 1048576 ? +(specBody.length / 1048576).toFixed(1) : null,
      pathCount: probe.pathCount, requiresAuth: probe.requiresAuth, authTypes: probe.authTypes,
      sha256: specRes.evidence ? String(specRes.evidence.sha256 || '').slice(0, 16) : null
    };
    out.probe = probe;
    if (!probe.url) { out.notes.push('nenhum GET sem parâmetros obrigatórios nem autenticação: auditoria funcional impossível sem chave'); return out; }
    const entry = {
      id: cand.provider + '@' + cand.version, name: cand.title, group: 'descoberta',
      url: probe.url, docs: cand.docs || cand.terms || null, licence: probe.licence || cand.terms,
      auth: probe.requiresAuth ? 'declarada (' + probe.authTypes.join(', ') + ')' : 'nenhuma',
      answers: cand.description, limits: 'Candidato descoberto automaticamente: utilidade não curada. Verificar termos antes de usar.',
      usefulness: { score: 50, why: 'candidato descoberto automaticamente — utilidade ainda não avaliada por humano' },
      probe: { url: probe.url, json: true }
    };
    out.audit = await auditOne(entry, runner, { attempts: 2 });
    out.notes.push('pedido de teste derivado da especificação: GET ' + probe.path);
    return out;
  }

  /* ------------------------- entradas personalizadas ------------------------- */
  function makeCustom(form) {
    const errors = [];
    const name = String(form.name || '').trim();
    let url = String(form.url || '').trim();
    if (!name) errors.push('falta o nome');
    if (!url) errors.push('falta o URL de teste');
    if (url && !/^https?:\/\//i.test(url)) errors.push('o URL tem de começar por http:// ou https://');
    if (url && /^http:\/\//i.test(url)) errors.push('URL sem TLS: será penalizado na segurança');
    let host = null;
    try { host = new URL(url).hostname; } catch (e) { if (url) errors.push('URL inválido'); }
    const entry = {
      id: 'custom-' + (form.id || Date.now().toString(36)),
      name: name, group: form.group || 'personalizada', url: url, docs: form.docs || null,
      licence: form.licence || 'não declarada', auth: form.auth || 'não declarada',
      keyed: /[?&](api[_-]?key|key|token|apikey)=/i.test(url), https: /^https:/i.test(url),
      answers: form.answers || null, limits: form.limits || null,
      usefulness: { score: Number(form.usefulness) || 50, why: form.why || 'avaliação do utilizador (não curada)' },
      probe: { url: url, json: form.json !== false, hasPath: form.hasPath || null, badUrl: form.badUrl || null },
      custom: true, host: host, addedAt: new Date().toISOString()
    };
    return { entry: entry, errors: errors };
  }

  VN.apis = {
    CATALOG, WEIGHTS, DISCOVERY_SOURCES, NOW,
    auditOne, auditAll, auditCandidate, candidatesFromList, deriveProbe, makeCustom, pathOf, clamp, discoverCatalog,
    byId: (id) => CATALOG.filter((e) => e.id === id)[0] || null
  };
})(typeof window !== 'undefined' ? window : globalThis);
