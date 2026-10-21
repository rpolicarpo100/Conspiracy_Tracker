/* ====== 3. FUNDAÇÕES, ORGANIZAÇÕES, ESTADO, IGREJA, TRIBUNAIS ======= */
(function (g) { 'use strict';
  const { E, R, AV } = g.VN_KIT;

  E({ id: 'f-aldevaran', type: 'foundation', name: 'Fundação Aldevaran para a Ciência',
      short: 'Fundação privada com fins científicos',
      ctx: 'Fundação privada, Lisboa. Constituída em 2013. Dotação de 25 M€. Financia investigação em energia.',
      status: 'confirmed', juris: 'PT', date: '2013-06-05', precision: 'day',
      aliases: ['Fundação Aldevaran'], tags: ['fundação'],
      visual: AV('FA'),
      facts: ['Constituída em 2013 pelo Grupo Aldevaran com dotação de 25 M€.',
              'Conselho consultivo integra D. Álvaro Cintra desde 2019.',
              'Atribuiu 4,1 M€ em bolsas entre 2019 e 2025.'],
      alleges: [], contradictions: [] });

  E({ id: 'f-luz', type: 'foundation', name: 'Fundação Eclesiástica Nossa Senhora da Luz',
      short: 'Fundação de direito canónico com obra social',
      ctx: 'Fundação eclesiástica, São Bento do Sul. Obra social e património diocesano. Orçamento anual de 2,3 M€.',
      status: 'confirmed', juris: 'PT', date: '1952-05-15', precision: 'day',
      aliases: ['Fundação N. S. da Luz'], tags: ['religioso', 'fundação'],
      visual: AV('NS'),
      facts: ['Dotação anual de 2,3 M€ para obra social.',
              'Recebeu 600 mil euros do Grupo Aldevaran em 2020 (donativo declarado).',
              'Cedeu um imóvel à Argos Partners em 2013, segundo escritura pública.'],
      alleges: ['A investigação de 2021 sugere que o donativo de 2020 teria contrapartidas de influência; a diocese nega.'],
      contradictions: ['O recibo e a acta da fundação documentam o donativo como apoio a obras sociais, sem qualquer contrapartida mencionada.'] });

  E({ id: 'o-assoc', type: 'organization', name: 'Associação Empresarial do Vale do Tejo',
      short: 'Associação patronal regional',
      ctx: 'Associação patronal com 340 associados. Organiza a conferência anual do Vale do Tejo.',
      status: 'confirmed', juris: 'PT', date: '1994-03-22', precision: 'day',
      aliases: ['AEVT'], tags: ['patronal'],
      visual: AV('AE'),
      facts: ['340 empresas associadas.', 'Helena Vasconcelos Braga integra o conselho consultivo desde 2019.'],
      alleges: [], contradictions: [] });

  E({ id: 'o-observatorio', type: 'organization', name: 'Observatório Cívico Transparência Já',
      short: 'Organização cívica de transparência',
      ctx: 'Organização não governamental, Lisboa. Publica alertas sobre contratação pública.',
      status: 'confirmed', juris: 'PT', date: '2017-01-30', precision: 'day',
      aliases: ['Transparência Já'], tags: ['cívico'],
      visual: AV('TJ'),
      facts: ['Publicou 62 alertas sobre contratação pública entre 2018 e 2025.',
              'Apresentou 4 pedidos de inquirição à Câmara de Vila Franca do Vale.'],
      alleges: [], contradictions: [] });

  E({ id: 'o-novareta', type: 'organization', name: 'Nova Rota Media',
      short: 'Publicação de jornalismo de investigação',
      ctx: 'Órgão de comunicação social independente. Autora da série "Os donos da autoestrada".',
      status: 'confirmed', juris: 'PT', date: '2015-09-01', precision: 'day',
      aliases: ['Nova Rota'], tags: ['media'],
      visual: AV('NR'),
      facts: ['Publicou a investigação de Outubro de 2021.', 'Recebeu o prémio de jornalismo económico em 2022.'],
      alleges: [], contradictions: [] });

  E({ id: 'g-municipio', type: 'government', name: 'Câmara Municipal de Vila Franca do Vale',
      short: 'Autarquia concessionante da A-31',
      ctx: 'Município com 48 mil habitantes. Concedente do contrato de 2016.',
      status: 'confirmed', juris: 'PT', date: '1976-04-25', precision: 'day',
      aliases: ['CMVFV'], tags: ['público'],
      visual: AV('CM'),
      facts: ['Lançou o concurso de concessão em 2015 e assinou o contrato em 2016.',
              'Apreciou e aprovou duas adendas (2018, 2020).',
              'Contratou a Cascata Digital em 2022 (1,2 M€).'],
      alleges: ['O Observatório Transparência Já alega favorecimento no concurso de 2015.'],
      contradictions: ['O Tribunal de Contas considerou o procedimento formalmente regular (2021).'] });

  E({ id: 'g-are', type: 'government', name: 'Agência Reguladora de Energia (ARE)',
      short: 'Regulador sectorial da energia',
      ctx: 'Autoridade reguladora independente. Supervisiona concessões e mercados de energia.',
      status: 'confirmed', juris: 'PT', date: '1997-11-12', precision: 'day',
      aliases: ['ARE'], tags: ['regulador'],
      visual: AV('AR'),
      facts: ['Sancionou a Lusovenus em 2019.', 'Auditou a Meridiano em 2023 (sem conclusões públicas até 2025).'],
      alleges: [], contradictions: [] });

  E({ id: 'g-direcao', type: 'government', name: 'Direcção-Geral do Território (DGT)',
      short: 'Serviço central com competências de licenciamento',
      ctx: 'Serviço da administração central. Emitiu pareceres sobre o traçado da A-31.',
      status: 'confirmed', juris: 'PT', date: '2007-05-01', precision: 'day',
      aliases: ['DGT'], tags: ['público'],
      visual: AV('DG'),
      facts: ['Emitiu o parecer prévio de 2015 sobre o traçado.',
              'Em 2014, um grupo de trabalho incluiu Amélia Sottomayor Vilar.'],
      alleges: [], contradictions: [] });

  E({ id: 'r-diocese', type: 'religious', name: 'Diocese de São Bento do Sul',
      short: 'Circunscrição eclesiástica; instituidora da Fundação N. S. da Luz',
      ctx: 'Diocese com 210 paróquias. Instituidora da Fundação Eclesiástica N. S. da Luz.',
      status: 'confirmed', juris: 'PT', date: '1540', precision: 'year',
      aliases: ['Diocese'], tags: ['religioso'],
      visual: AV('DS'),
      facts: ['Instituiu a Fundação N. S. da Luz.', 'D. Álvaro Cintra é bispo desde 2011.'],
      alleges: [], contradictions: [] });

  E({ id: 'j-tribunal', type: 'court', name: 'Tribunal Judicial da Comarca do Vale do Tejo',
      short: 'Tribunal de 1.ª instância do Processo Meridiano',
      ctx: 'Tribunal de comarca. Julgou o Processo Meridiano (2023–2025).',
      status: 'confirmed', juris: 'PT', date: null, precision: 'unknown',
      aliases: ['TJCVT'], tags: ['judicial'],
      visual: AV('TJ'),
      facts: ['Proferiu a sentença de 2025 no Processo Meridiano.'],
      alleges: [], contradictions: [] });

  E({ id: 'j-mp', type: 'court', name: 'Ministério Público — DIAP do Vale do Tejo',
      short: 'Autoridade de investigação criminal',
      ctx: 'Departamento de investigação e acção penal. Deduziu a acusação de 2022.',
      status: 'confirmed', juris: 'PT', date: null, precision: 'unknown',
      aliases: ['DIAP'], tags: ['judicial'],
      visual: AV('MP'),
      facts: ['Deduziu acusação em 2022 contra 4 arguidos.', 'Recorreu da absolvição de Fausto Melicias em 2025.'],
      alleges: [], contradictions: [] });

  E({ id: 'j-tcontas', type: 'court', name: 'Tribunal de Contas — Secção Regional',
      short: 'Controlo financeiro externo',
      ctx: 'Tribunal de Contas. Auditou o contrato de concessão em 2021.',
      status: 'confirmed', juris: 'PT', date: null, precision: 'unknown',
      aliases: ['TdC'], tags: ['judicial', 'auditoria'],
      visual: AV('TC'),
      facts: ['Relatório de 2021: procedimento formalmente regular, com reservas sobre o preço.'],
      alleges: [], contradictions: [] });
})(typeof window !== 'undefined' ? window : globalThis);
