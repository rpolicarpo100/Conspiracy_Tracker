/* =====================================================================
   VN · MOTOR DE INVESTIGAÇÃO
   Regras — não opiniões:
   1. Uma pergunta gera um PLANO DE FONTES verificáveis, não uma resposta.
   2. Cada afirmação só entra no registo com fonte, excerto e data.
   3. O que não foi encontrado é registado como resultado negativo:
      «não encontrado em X, em data Y» — nunca «não existe».
   4. Uma hipótese tem de incluir o teste que a pode REFUTAR.
   5. Alegação ≠ facto. Confirmação exige fonte primária + revisor humano.
   O módulo funciona sem IA (planeador determinístico) e com IA
   (contrato estrito de evidência, ver buildAIPrompt/validateAIResponse).
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});

  /* ---------------- directório de fontes reais ---------------- */
  const SOURCES = [
    { id: 'base', name: 'Portal BASE — contratos públicos', url: 'https://www.base.gov.pt', access: 'público',
      covers: ['contratual'], hint: 'contratos, aditamentos, entidades adjudicantes e adjudicatárias, valores',
      caveat: 'Registo administrativo; erros de reporte existem. Confirmar no Diário da República quando publicado.' },
    { id: 'dr', name: 'Diário da República', url: 'https://diariodarepublica.pt', access: 'público',
      covers: ['contratual', 'público'], hint: 'nomeações, despachos, regulamentos, avisos de concurso, extinção de sociedades',
      caveat: 'Publicação oficial, mas não substitui o teor integral do processo.' },
    { id: 'rcbe', name: 'Registo Central do Beneficiário Efetivo', url: 'https://www.rcbe.pt', access: 'restrito',
      covers: ['societário'], hint: 'beneficiário efetivo declarado de sociedades portuguesas',
      caveat: 'Acesso condicionado a interesse legítimo. A declaração é feita pela própria entidade — pode ser falsa.' },
    { id: 'certidao', name: 'Certidão permanente do registo comercial', url: 'https://justica.gov.pt', access: 'pago',
      covers: ['societário'], hint: 'accionistas, órgãos sociais, capital, pacto social, alterações',
      caveat: 'Fonte primária societária. Não revela beneficiário efetivo quando há cadeia estrangeira.' },
    { id: 'tcontas', name: 'Tribunal de Contas — relatórios', url: 'https://www.tcontas.pt', access: 'público',
      covers: ['contratual', 'financeiro'], hint: 'auditorias a contratos, concessões, municípios e empresas públicas',
      caveat: 'Relatórios anuais; podem estar desactualizados face a decisões posteriores.' },
    { id: 'citius', name: 'Citius — consulta de processos judiciais', url: 'https://www.citius.mj.pt', access: 'restrito',
      covers: ['judicial'], hint: 'estado dos processos, decisões, arguidos',
      caveat: 'Acesso a processos pendentes é limitado por segredo de justiça. Decisões de 1.ª instância não são definitivas.' },
    { id: 'dgsi', name: 'DGSI — jurisprudência', url: 'https://www.dgsi.pt', access: 'público',
      covers: ['judicial'], hint: 'acórdãos e sentenças publicadas',
      caveat: 'Só processos findos com decisão publicada. Ausência não significa inexistência.' },
    { id: 'parlamento', name: 'Assembleia da República — Transparência', url: 'https://www.parlamento.pt', access: 'público',
      covers: ['político', 'lobby'], hint: 'reuniões, audições, registos de interesse, deslocações',
      caveat: 'Cobertura irregular entre gabinetes e grupos parlamentares.' },
    { id: 'eutr', name: 'Registo de Transparência da UE', url: 'https://ec.europa.eu/transparencyregister', access: 'público',
      covers: ['lobby'], hint: 'representantes de interesses acreditados em Bruxelas, reuniões com comissários',
      caveat: 'Declarativo; reuniões nem sempre registadas por todas as direcções-gerais.' },
    { id: 'ted', name: 'TED — contratos públicos da UE', url: 'https://ted.europa.eu', access: 'público',
      covers: ['contratual'], hint: 'anúncios e adjudicações acima dos limiares europeus',
      caveat: 'Cobre apenas contratação acima de limiares.' },
    { id: 'gleif', name: 'GLEIF — identificadores LEI', url: 'https://www.gleif.org', access: 'público',
      covers: ['societário', 'financeiro'], hint: 'identidade de entidades legais e relações de grupo declaradas',
      caveat: 'Depende da qualidade da declaração da entidade; relações de grupo são auto-declaradas.' },
    { id: 'opencorp', name: 'OpenCorporates', url: 'https://opencorporates.com', access: 'público',
      covers: ['societário'], hint: 'registos comerciais de várias jurisdições, dirigentes, filiais',
      caveat: 'Agregador: confirmar sempre no registo oficial da jurisdição.' },
    { id: 'offshore', name: 'ICIJ Offshore Leaks Database', url: 'https://offshoreleaks.icij.org', access: 'público',
      covers: ['societário', 'offshore'], hint: 'entidades offshore em fugas de documentos (Panama/Pandora/Swiss leaks)',
      caveat: 'Presença em fuga de documentos não implica ilícito. Muitas entidades são legais.' },
    { id: 'aleph', name: 'OCCRP Aleph', url: 'https://aleph.occrp.org', access: 'público/registo',
      covers: ['documental'], hint: 'arquivo pesquisável de documentos de investigação e registos',
      caveat: 'Mistura fontes primárias e secundárias: verificar a origem de cada documento.' },
    { id: 'opensanc', name: 'OpenSanctions', url: 'https://www.opensanctions.org', access: 'público',
      covers: ['sancionatório'], hint: 'sanções, PEPs, listas de exclusão, ligações a entidades sancionadas',
      caveat: 'Correspondências de nomes produzem falsos positivos: exigir data de nascimento e documento.' },
    { id: 'eu-sanctions', name: 'EU Sanctions Map', url: 'https://www.sanctionsmap.eu', access: 'público',
      covers: ['sancionatório'], hint: 'regimes de sanções da UE e listas consolidadas',
      caveat: 'Consultar a lista consolidada oficial em EUR-Lex para efeitos jurídicos.' },
    { id: 'curia', name: 'CURIA — Tribunal de Justiça da UE', url: 'https://curia.europa.eu', access: 'público',
      covers: ['judicial'], hint: 'acórdãos europeus, processos de concorrência e auxílios de Estado',
      caveat: 'Identificar o número do processo; homónimos frequentes.' },
    { id: 'ine', name: 'INE — Instituto Nacional de Estatística', url: 'https://www.ine.pt', access: 'público',
      covers: ['estatístico'], hint: 'dados económicos e sociais para contextualizar, não para provar relações',
      caveat: 'Dados agregados: não permitem inferir condutas individuais.' },
    { id: 'pordata', name: 'PORDATA', url: 'https://www.pordata.pt', access: 'público',
      covers: ['estatístico'], hint: 'séries estatísticas comparáveis',
      caveat: 'Fonte secundária; citar o INE subjacente.' },
    { id: 'arquivo', name: 'Arquivo.pt', url: 'https://arquivo.pt', access: 'público',
      covers: ['documental'], hint: 'versões arquivadas de páginas e comunicados entretanto removidos',
      caveat: 'A página pode ter mudado após a captura: registar a data do instantâneo.' },
    { id: 'foi', name: 'Acesso a documentos administrativos (Lei n.º 46/2007)', url: null, access: 'por pedido',
      covers: ['documental', 'público'], hint: 'pedido escrito ao organismo, com prazo legal de resposta; a recusa é fundamentada',
      caveat: 'A ausência de resposta ou a recusa fundamentada é, ela própria, informação registável.' },
    { id: 'media', name: 'Arquivos de imprensa e media', url: null, access: 'variável',
      covers: ['media'], hint: 'pistas e contexto; raramente prova',
      caveat: 'Notícia não é prova. Usar como pista e ir à fonte primária citada.' }
  ];

  /* ---------------- classificação da pergunta ---------------- */
  const RULES = [
    { tag: 'societário', re: /empresa|sociedade|grupo|holding|participa|accion|acion|capital|subsidi|benefici|offshore|regist|acionista/i },
    { tag: 'contratual', re: /contrato|concurso|concess|adjudic|adenda|procedimento|licita|obra|fornec|preço|preco/i },
    { tag: 'judicial', re: /tribunal|processo|senten|acórd|acord|arguid|acus|investig|inquérito|inquerito|crime|crime|julgamento|condena/i },
    { tag: 'financeiro', re: /financ|emprést|emprest|banco|pagamento|transfer|montante|euro|milh|dívida|divida|fluxo|fatura|factura/i },
    { tag: 'público', re: /câmara|camara|município|municipio|governo|minist|estado|autarquia|organismo|agência|agencia|regulador/i },
    { tag: 'político', re: /polític|politic|deputad|ministro|presidente|partido|cargo|nomea|elei/i },
    { tag: 'lobby', re: /lobby|influênc|influenc|reunião|reuniao|audição|audicao|porta giratória|giratoria/i },
    { tag: 'sancionatório', re: /sanç|sanc|embargo|lista|pep|expost|risco/i },
    { tag: 'offshore', re: /offshore|luxemburgo|panam|paraíso|paraiso|fiduci|trust|veículo|veiculo/i },
    { tag: 'religioso', re: /igreja|diocese|bispo|fundação|fundacao|eclesi|religios/i },
    { tag: 'media', re: /notícia|noticia|jornal|media|imprensa|reportagem|esconde|omite|silêncio|silencio/i },
    { tag: 'estatístico', re: /quantos|percentagem|estatíst|estatist|média|media|tendência|tendencia/i }
  ];

  function classify(question) {
    const tags = RULES.filter((r) => r.re.test(question)).map((r) => r.tag);
    return tags.length ? tags : ['documental'];
  }

  function sourcesFor(tags) {
    const pick = SOURCES.filter((s) => s.covers.some((c) => tags.indexOf(c) >= 0));
    return (pick.length ? pick : SOURCES.slice(0, 6));
  }

  /* ---------------- planeador determinístico ---------------- */
  function buildPlan(question, opts) {
    opts = opts || {};
    const tags = classify(question);
    const srcs = sourcesFor(tags);
    const entities = (opts.entities || []).slice(0, 6);
    const steps = [];
    let n = 1;

    steps.push({
      n: n++, phase: 'enquadramento', title: 'Fixar a pergunta e os termos exactos',
      actions: [
        'Escrever a pergunta como afirmação testável (ex.: «X detinha Y% de Z em <data>»).',
        'Fixar variantes de nome e erros ortográficos comuns; registar data de nascimento ou NIF quando aplicável para evitar homónimos.',
        'Definir o que contaria como prova e o que contaria como refutação, ANTES de procurar.'
      ],
      sources: [], kind: 'method'
    });

    if (tags.indexOf('societário') >= 0 || entities.length) {
      steps.push({
        n: n++, phase: 'identidade', title: 'Identidade jurídica e cadeia de controlo',
        actions: [
          'Obter certidão permanente do registo comercial (accionistas, órgãos sociais, alterações).',
          'Verificar beneficiário efetivo declarado e comparar com a cadeia societária até à pessoa singular.',
          'Procurar identificadores LEI e relações de grupo declaradas.',
          'Se existir veículo estrangeiro, identificar a lei da jurisdição e o registo público correspondente.'
        ],
        sources: SOURCES.filter((s) => ['certidao', 'rcbe', 'gleif', 'opencorp', 'offshore'].indexOf(s.id) >= 0),
        kind: 'societário'
      });
    }
    if (tags.indexOf('contratual') >= 0) {
      steps.push({
        n: n++, phase: 'actos', title: 'Contratos, concursos e aditamentos',
        actions: [
          'Localizar o procedimento no Portal BASE: entidade adjudicante, valor, prazo, concorrentes.',
          'Comparar o objecto do contrato com o que foi executado e com os aditamentos.',
          'Verificar publicação no Diário da República e anúncio no TED quando acima do limiar.',
          'Confirmar se houve relatório do Tribunal de Contas e ler as reservas, não só a conclusão.'
        ],
        sources: SOURCES.filter((s) => ['base', 'dr', 'ted', 'tcontas'].indexOf(s.id) >= 0),
        kind: 'contratual'
      });
    }
    if (tags.indexOf('financeiro') >= 0) {
      steps.push({
        n: n++, phase: 'fluxos', title: 'Fluxos financeiros e sua proveniência',
        actions: [
          'Separar montante contratado de montante pago: são coisas diferentes.',
          'Identificar a contraparte de cada pagamento e o instrumento (contrato, empréstimo, donativo, garantia).',
          'Verificar contas publicadas, relatórios de auditoria e, quando existam, decisões judiciais sobre os valores.',
          'Registar valores não confirmados como não confirmados — nunca somar alegações a factos.'
        ],
        sources: SOURCES.filter((s) => ['tcontas', 'certidao', 'dgsi'].indexOf(s.id) >= 0),
        kind: 'financeiro'
      });
    }
    if (tags.indexOf('judicial') >= 0) {
      steps.push({
        n: n++, phase: 'judicial', title: 'Processos, decisões e estado processual',
        actions: [
          'Identificar número de processo e tribunal; distinguir arguido, acusação, pronúncia, sentença e trânsito em julgado.',
          'Ler o dispositivo da decisão, não apenas o resumo noticioso.',
          'Registar se a decisão é de 1.ª instância e se há recurso pendente.',
          'Procurar decisões posteriores que contradigam o que foi noticiado.'
        ],
        sources: SOURCES.filter((s) => ['citius', 'dgsi', 'curia'].indexOf(s.id) >= 0),
        kind: 'judicial'
      });
    }
    if (tags.indexOf('público') >= 0 || tags.indexOf('político') >= 0 || tags.indexOf('lobby') >= 0) {
      steps.push({
        n: n++, phase: 'esfera pública', title: 'Decisões públicas e influência declarada',
        actions: [
          'Recolher actas, deliberações e despachos que decidem o acto em causa.',
          'Cruzar agendas e registos de interesse com as datas das decisões.',
          'Verificar registos de representação de interesses (nacional e UE) e reuniões declaradas.',
          'Pedir, por escrito, os documentos que faltam (Lei n.º 46/2007) e registar o pedido e a resposta.'
        ],
        sources: SOURCES.filter((s) => ['dr', 'parlamento', 'eutr', 'foi', 'base'].indexOf(s.id) >= 0),
        kind: 'público'
      });
    }
    if (tags.indexOf('religioso') >= 0) {
      steps.push({
        n: n++, phase: 'instituições', title: 'Instituições religiosas e fundações',
        actions: [
          'Distinguir pessoa singular (bispo, dirigente) de instituição (diocese, fundação) — a relação é com o cargo, não com a pessoa.',
          'Obter estatutos e composição dos órgãos; verificar quem designa quem.',
          'Registar donativos com recibo, data e finalidade declarada.'
        ],
        sources: SOURCES.filter((s) => ['certidao', 'dr'].indexOf(s.id) >= 0),
        kind: 'religioso'
      });
    }
    if (tags.indexOf('sancionatório') >= 0) {
      steps.push({
        n: n++, phase: 'risco', title: 'Sanções e exposição política',
        actions: [
          'Pesquisar listas consolidadas com data de nascimento e identificadores, para reduzir falsos positivos.',
          'Distinguir sanção aplicada de mera correspondência de nome.',
          'Registar a versão da lista consultada e a data.'
        ],
        sources: SOURCES.filter((s) => ['opensanc', 'eu-sanctions'].indexOf(s.id) >= 0),
        kind: 'sancionatório'
      });
    }

    steps.push({
      n: n++, phase: 'refutação', title: 'Tentar refutar a hipótese',
      actions: [
        'Procurar o documento que, existindo, desmentiria a afirmação (ex.: acta que mostre ausência, parecer que afaste o conflito).',
        'Procurar decisões contraditórias, incluindo absolvições e arquivamentos.',
        'Contactar a entidade visada e registar a resposta integral, mesmo que negue tudo.',
        'Verificar se o que parece relação é apenas co-presença, coincidência de nome ou proximidade temporal.'
      ],
      sources: SOURCES.filter((s) => ['media', 'dgsi', 'foi'].indexOf(s.id) >= 0),
      kind: 'refutação'
    });

    steps.push({
      n: n++, phase: 'registo negativo', title: 'Registar o que NÃO foi encontrado',
      actions: [
        'Para cada fonte consultada sem resultado, registar: fonte, termos usados, data da consulta.',
        'Distinguir «não publicado» de «não existente» e de «não acedido».',
        'O registo negativo é prova de diligência: protege a investigação de acusações de omissão.'
      ],
      sources: [], kind: 'registo'
    });

    return {
      id: 'plan-' + Date.now().toString(36),
      question: question,
      tags: tags,
      createdAt: new Date().toISOString(),
      steps: steps,
      hypotheses: buildHypotheses(question, tags),
      limits: [
        'Uma correlação temporal não é causalidade.',
        'Ausência de registo público não prova inexistência.',
        'Documentos de fuga (leaks) exigem verificação independente.',
        'Nenhuma conclusão deve ser publicada sem revisão humana e direito de resposta.'
      ]
    };
  }

  function buildHypotheses(question, tags) {
    const base = question.replace(/\?+$/, '').trim();
    return [
      { id: 'H1', text: 'A afirmação é verdadeira e está documentada em fonte primária.', test: 'Obter documento primário com o facto explícito e datado.' },
      { id: 'H2', text: 'A afirmação é parcialmente verdadeira: o facto existe mas com alcance, data ou valor diferentes.', test: 'Comparar o texto noticioso com o documento original, campo a campo.' },
      { id: 'H3', text: 'A afirmação resulta de confusão entre entidades homónimas.', test: 'Confirmar identificadores (NIF, data de nascimento, registo) em cada documento.' },
      { id: 'H4', text: 'A afirmação é falsa e existe documento que a contradiz.', test: 'Localizar decisão ou acto posterior que negue o facto alegado.' },
      { id: 'H5', text: 'O facto não é verificável com as fontes disponíveis.', test: 'Esgotar pedidos formais de acesso e registar as recusas.' }
    ];
  }

  /* ---------------- contrato de IA ---------------- */
  const AI_SYSTEM = [
    'És um assistente de investigação documental. A tua função é organizar e verificar provas, não criar narrativas.',
    'REGRAS INVIOLÁVEIS:',
    '1. Nunca apresentes uma afirmação sem fonte identificável (URL, documento, número de processo, data de consulta).',
    '2. Distingue sempre: facto documentado, alegação de uma parte, inferência, hipótese.',
    '3. Se não encontraste, escreve "não encontrado em <fonte> em <data>". Nunca escrevas "não existe".',
    '4. Não atribuas crimes, intenções ou coordenação a pessoas ou organizações com base em relações ou proximidade.',
    '5. Não uses linguagem de culpa, perigosidade ou suspeita. Descreve actos e vínculos registados.',
    '6. Identifica homónimos e exige identificadores antes de fundir entidades.',
    '7. Apresenta sempre a hipótese alternativa e o teste que a refutaria.',
    '8. Se a pergunta pressupõe uma conclusão ("o que os media escondem"), reformula-a como pergunta verificável e diz isso explicitamente.',
    '9. Todos os campos de saída são obrigatórios. Se não souberes, preenche com null e explica porquê em "limits".',
    '10. Responde em português de Portugal, em JSON válido, sem texto fora do JSON.'
  ].join('\n');

  const AI_SCHEMA = {
    reformulatedQuestion: 'string — pergunta verificável equivalente',
    assumptions: ['string — pressupostos da pergunta original que não estão provados'],
    claims: [{
      id: 'string', text: 'string', kind: 'facto|alegacao|inferencia|hipotese',
      sources: [{ name: 'string', url: 'string|null', date: 'YYYY-MM-DD|null', quote: 'string|null', sourceType: 'primaria|secundaria|registo|judicial' }],
      status: 'nao_verificado|confirmado|refutado|parcial',
      verification: 'string — como confirmar em concreto',
      disconfirming: 'string|null — que documento a refutaria'
    }],
    negativeResults: [{ source: 'string', query: 'string', date: 'YYYY-MM-DD', result: 'nao_encontrado|sem_acesso|nao_publicado' }],
    limits: ['string'],
    nextSteps: ['string']
  };

  function buildAIPrompt(question, opts) {
    opts = opts || {};
    const plan = opts.plan || buildPlan(question, opts);
    const entCtx = (opts.entities || []).map((e) => ({
      id: e.id, nome: e.name, tipo: e.type, nota: e.short || ''
    }));
    return {
      system: AI_SYSTEM,
      user: [
        'PERGUNTA DO INVESTIGADOR:',
        question,
        '',
        'PLANO DE FONTES JÁ DEFINIDO (usa-o como estrutura; podes acrescentar fontes, nunca remover verificações):',
        plan.steps.map((s) => s.n + '. [' + s.phase + '] ' + s.title + ' — ' + s.actions.join(' ')).join('\n'),
        '',
        'ENTIDADES JÁ NO GRAFO (não inventes dados sobre elas; se precisares de dados, indica que têm de ser recolhidos):',
        JSON.stringify(entCtx, null, 2),
        '',
        'FORMATO DE SAÍDA (JSON estrito, todos os campos):',
        JSON.stringify(AI_SCHEMA, null, 2),
        '',
        'Se não tiveres acesso a fontes verificáveis, devolve claims: [] e explica em limits. Não preenchas com conhecimento geral.',
        'Toda a claim sem pelo menos uma fonte com nome e data de consulta será rejeitada pelo validador.'
      ].join('\n')
    };
  }

  /* Validação estrita da resposta da IA. Devolve {ok, accepted, rejected, reasons}. */
  function validateAIResponse(text) {
    let data;
    try {
      const cleaned = String(text).replace(/^```(json)?/i, '').replace(/```$/, '').trim();
      data = JSON.parse(cleaned);
    } catch (e) {
      return { ok: false, error: 'JSON inválido: ' + e.message };
    }
    const accepted = [], rejected = [];
    (data.claims || []).forEach((c) => {
      const reasons = [];
      if (!c.text || String(c.text).length < 8) reasons.push('afirmação vazia');
      if (!Array.isArray(c.sources) || !c.sources.length) reasons.push('sem fonte');
      (c.sources || []).forEach((s) => {
        if (!s.name) reasons.push('fonte sem nome');
        if (!s.date) reasons.push('fonte sem data de consulta');
        if (!s.quote && s.sourceType === 'primaria') reasons.push('fonte primária sem excerto');
      });
      if (['facto', 'alegacao', 'inferencia', 'hipotese'].indexOf(c.kind) < 0) reasons.push('tipo de afirmação inválido');
      if (c.status === 'confirmado' && !(c.sources || []).some((s) => s.sourceType === 'primaria' && s.quote)) {
        reasons.push('confirmação sem fonte primária citada');
      }
      if (/\b(culpado|corrupto|conspira|encobriu|esconde intencionalmente)\b/i.test(c.text || '')) {
        reasons.push('linguagem de imputação não sustentada');
      }
      if (reasons.length) rejected.push({ claim: c, reasons: reasons }); else accepted.push(c);
    });
    return {
      ok: rejected.length === 0,
      data: data,
      accepted: accepted,
      rejected: rejected,
      summary: accepted.length + ' afirmações aceites, ' + rejected.length + ' rejeitadas',
      checkedAt: new Date().toISOString()
    };
  }

  /* ---------------- conversão em registos do grafo ---------------- */
  /* Uma claim aceite NUNCA entra como relação confirmada: entra como alegação
     com fonte, para revisão humana. */
  function claimToLedgerEntry(claim, question) {
    return {
      type: 'alegacao',
      subject: claim.id || null,
      payload: {
        question: question, text: claim.text, kind: claim.kind, status: claim.status,
        sources: (claim.sources || []).map((s) => ({ name: s.name, url: s.url || null, date: s.date || null, quote: s.quote || null, sourceType: s.sourceType || null })),
        verification: claim.verification || null, disconfirming: claim.disconfirming || null
      },
      note: 'Registada por IA e sujeita a verificação humana antes de qualquer uso'
    };
  }

  VN.research = {
    SOURCES, classify, sourcesFor, buildPlan, buildHypotheses,
    buildAIPrompt, validateAIResponse, claimToLedgerEntry, AI_SYSTEM, AI_SCHEMA
  };
})(typeof window !== 'undefined' ? window : globalThis);
