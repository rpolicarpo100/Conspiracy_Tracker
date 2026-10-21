/* ========================== 1. PESSOAS ============================== */
(function (g) { 'use strict';
  const { E, R, AV } = g.VN_KIT;
  const D = g.VN_DATA;

  E({ id: 'p-vitor', type: 'person', name: 'Vítor Samaniego Rocha',
      short: 'Fundador e presidente do Grupo Aldevaran',
      ctx: 'Empresário (n. 1954). Fundou o grupo em 1998; presidente do conselho de administração desde 2003.',
      status: 'confirmed', juris: 'PT', date: '1954', precision: 'year',
      aliases: ['V. S. Rocha', 'Vítor S. Rocha'], tags: ['núcleo', 'controlo'],
      visual: AV('VS'),
      facts: [
        'Presidente do conselho de administração do Grupo Aldevaran desde 2003 (certidão comercial).',
        'Detém 41,5% do capital do grupo a título pessoal e 12% através da Samaniego Family Office.',
        'Assinou o contrato de concessão de 2016 em representação da Meridiano Infraestruturas.'
      ],
      alleges: [
        'A acusação do Ministério Público (2022) descreve-o como "beneficiário último" de um alegado esquema de favorecimento no concurso de 2015; nunca foi constituído arguido.'
      ],
      contradictions: [
        'O parecer forense independente (d-forense) conclui que a decisão de adjudicação foi tomada em reunião de 9 de Setembro de 2015, na qual Vítor Samaniego não esteve presente.'
      ] });

  E({ id: 'p-helena', type: 'person', name: 'Helena Vasconcelos Braga',
      short: 'Presidente executiva da Aldevaran Capital Partners',
      ctx: 'Gestora de fundos (n. 1968). Dirige a sociedade gestora do Fundo Aurora II desde 2017.',
      status: 'confirmed', juris: 'PT', date: '1968', precision: 'year',
      aliases: [], tags: ['núcleo', 'gestão'],
      visual: AV('HB'),
      facts: [
        'Nomeada presidente executiva da Aldevaran Capital Partners em Março de 2017.',
        'Assinou o prospecto do Fundo Aurora II (2018) como representante da sociedade gestora.',
        'Membro do conselho consultivo da Associação Empresarial do Vale do Tejo desde 2019.'
      ],
      alleges: [],
      contradictions: [] });

  E({ id: 'p-iris', type: 'person', name: 'Íris Samaniego Vasconcelos',
      short: 'Accionista e administradora não executiva',
      ctx: 'Filha do fundador (n. 1985). Administradora não executiva do Grupo Aldevaran e da Meridiano.',
      status: 'confirmed', juris: 'PT', date: '1985', precision: 'year',
      aliases: ['Í. S. Vasconcelos'], tags: ['família', 'controlo'],
      visual: AV('IV'),
      facts: [
        'Administradora não executiva do Grupo Aldevaran desde 2018.',
        'Detém 18% do capital através da Samaniego Family Office.',
        'Representou o grupo na reunião documentada com a Câmara Municipal em 2022 (acta d-acta-2022).'
      ],
      alleges: ['Notícia de 2021 sugere que teria participado em reuniões não registadas com o director municipal; a alegação não foi confirmada.'],
      contradictions: [] });

  E({ id: 'p-tomas', type: 'person', name: 'Tomás Queirós Falcão',
      short: 'Director financeiro da Meridiano Infraestruturas',
      ctx: 'Financeiro (n. 1972). CFO da Meridiano desde 2014; assinou o empréstimo sindicado de 2020.',
      status: 'confirmed', juris: 'PT', date: '1972', precision: 'year',
      aliases: [], tags: ['gestão'],
      visual: AV('TF'),
      facts: [
        'Director financeiro da Meridiano Infraestruturas desde Janeiro de 2014.',
        'Assinou o contrato de financiamento de 180 M€ em 2020 em nome da Meridiano.',
        'Responsável pela informação financeira trimestral enviada à Agência Reguladora de Energia.'
      ], alleges: [], contradictions: [] });

  E({ id: 'p-amelia', type: 'person', name: 'Amélia Sottomayor Vilar',
      short: 'Sócia da Sottomayor & Vilar, advogados',
      ctx: 'Advogada (n. 1961). Sócia fundadora da sociedade que assessora o grupo em contratos públicos.',
      status: 'confirmed', juris: 'PT', date: '1961', precision: 'year',
      aliases: ['Dra. Amélia Sottomayor'], tags: ['assessoria'],
      visual: AV('AS'),
      facts: [
        'Sócia fundadora da Sottomayor & Vilar — Sociedade de Advogados (1998).',
        'Consta como subscritora do parecer jurídico que sustentou a Adenda 1 ao contrato de concessão (2018).',
        'Registada como representante de interesses do grupo no Registo de Transparência desde 2022.'
      ],
      alleges: ['A plataforma Transparência Já alega "porta giratória" por ter integrado um grupo de trabalho do governo em 2014 e, em 2016, assessorado a Meridiano.'],
      contradictions: ['O registo de incompatibilidades de 2016 não identifica qualquer impedimento formal.'] });

  E({ id: 'p-rui', type: 'person', name: 'Rui Pellicano',
      short: 'Gestor do Fundo Aurora II',
      ctx: 'Gestor de investimento (n. 1979). Responsável pelas participações em Cascata Digital e Solaris.',
      status: 'confirmed', juris: 'PT', date: '1979', precision: 'year',
      aliases: [], tags: ['gestão', 'fundos'],
      visual: AV('RP'),
      facts: [
        'Gestor de investimento do Fundo Aurora II desde a sua constituição (2018).',
        'Membro do conselho de administração da Cascata Digital entre 2021 e 2024.',
        'Assinou o termo de investimento de 35 M€ na Cascata Digital.'
      ], alleges: [], contradictions: [] });

  E({ id: 'p-nadia', type: 'person', name: 'Nadia Krasniqi',
      short: 'Nomeada administradora da Atlântico 7 (Luxemburgo)',
      ctx: 'Administradora de sociedades (n. 1981). Figura como beneficiária efectiva registada da Atlântico 7.',
      status: 'probable', juris: 'LU', date: '1981', precision: 'year',
      aliases: [], tags: ['offshore', 'controlo'],
      visual: AV('NK'),
      facts: [
        'Registada como beneficiária efectiva da Atlântico 7 S.à r.l. no registo luxemburguês (2017).',
        'É administradora de 27 sociedades veículo, segundo o registo público consolidado.',
        'Não foi possível localizar declaração de rendimentos ou nexo económico documentado com o grupo.'
      ],
      alleges: ['O artigo de 2021 sugere que actua como testa-de-ferro de accionistas portugueses; a sociedade gestora nega.'],
      contradictions: ['Um contrato de mandato de 2018 (não disponibilizado integralmente) indicaria Krasniqi como administradora nomeada, sem participação económica — o que contradiz a qualificação de beneficiária efectiva.'] });

  E({ id: 'p-joaquim', type: 'person', name: 'Joaquim Bandeira',
      short: 'Ex-director municipal de obras (arguido)',
      ctx: 'Dirigente municipal (n. 1966) entre 2012 e 2017. Arguido no Processo Meridiano; condenado em 2025.',
      status: 'confirmed', juris: 'PT', date: '1966', precision: 'year',
      aliases: [], tags: ['judicial'],
      visual: AV('JB'),
      facts: [
        'Director municipal de obras da Câmara de Vila Franca do Vale entre 2012 e 2017.',
        'Membro da comissão de avaliação do concurso de concessão de 2015.',
        'Condenado em 1.ª instância (2025) por tráfico de influência, pena de 4 anos suspensa.'
      ],
      alleges: ['A acusação alega recebimento de 300 mil euros através da Argos Partners.'],
      contradictions: ['A defesa apresentou registos de despesas que, segundo o tribunal, não afastaram a acusação.'] });

  E({ id: 'p-lurdes', type: 'person', name: 'Lurdes Antunes',
      short: 'Ex-presidente da Câmara de Vila Franca do Vale',
      ctx: 'Autarca (n. 1959) entre 2013 e 2021. Não foi acusada; prestou declarações como testemunha.',
      status: 'confirmed', juris: 'PT', date: '1959', precision: 'year',
      aliases: [], tags: ['política'],
      visual: AV('LA'),
      facts: [
        'Presidente da Câmara Municipal de Vila Franca do Vale entre 2013 e 2021.',
        'Assinou o contrato de concessão de 2016 e as duas adendas (2018 e 2020).',
        'Prestou declarações como testemunha no julgamento de 2024.'
      ],
      alleges: ['A plataforma Transparência Já pediu em 2020 a sua inquirição por alegado conflito de interesses; o pedido não teve seguimento.'],
      contradictions: ['A acta de 2015 (d-acta-2015) regista a sua abstenção na votação da adjudicação.'] });

  E({ id: 'p-fausto', type: 'person', name: 'Fausto Melicias',
      short: 'Consultor da Argos Partners (arguido)',
      ctx: 'Consultor (n. 1974). Intermediário entre o município e o grupo, segundo a acusação; arguido.',
      status: 'probable', juris: 'PT', date: '1974', precision: 'year',
      aliases: [], tags: ['judicial', 'intermediação'],
      visual: AV('FM'),
      facts: [
        'Sócio-gerente da Argos Partners Consultoria, Lda.',
        'Prestou serviços de "apoio à estruturação de candidaturas" à Meridiano entre 2014 e 2016.',
        'Foi constituído arguido em 2021 e absolvido em 2025 por falta de prova.'
      ],
      alleges: ['A acusação descreve pagamentos da Meridiano à Argos como forma de canalizar vantagens ao director municipal.'],
      contradictions: ['A sentença de 2025 considera não provados os pagamentos descritos na acusação e absolve Melicias.'] });

  E({ id: 'p-alvaro', type: 'person', name: 'D. Álvaro Cintra',
      short: 'Bispo da Diocese de São Bento do Sul',
      ctx: 'Bispo (n. 1957). Presidente da Fundação Eclesiástica Nossa Senhora da Luz e membro do conselho consultivo da Fundação Aldevaran.',
      status: 'confirmed', juris: 'PT', date: '1957', precision: 'year',
      aliases: [], tags: ['religioso'],
      visual: AV('AC'),
      facts: [
        'Bispo da Diocese de São Bento do Sul desde 2011.',
        'Presidente do conselho de administração da Fundação Eclesiástica N. S. da Luz.',
        'Integrou o conselho consultivo da Fundação Aldevaran para a Ciência a partir de 2019.'
      ], alleges: [], contradictions: [] });

  E({ id: 'p-ines', type: 'person', name: 'Inês Torre',
      short: 'Jornalista de investigação da Nova Rota Media',
      ctx: 'Jornalista (n. 1987). Autora da série "Os donos da autoestrada" (2021).',
      status: 'confirmed', juris: 'PT', date: '1987', precision: 'year',
      aliases: [], tags: ['media'],
      visual: AV('IT'),
      facts: [
        'Jornalista na Nova Rota Media desde 2016.',
        'Autora da investigação publicada em Outubro de 2021.',
        'Recorreu a pedidos de acesso a documentos administrativos em 2019 e 2020.'
      ], alleges: [], contradictions: [] });

  E({ id: 'p-goncalo', type: 'person', name: 'Gonçalo Sá Pereira',
      short: 'Director de licenciamento da ARE',
      ctx: 'Regulador (n. 1970). Director de licenciamento da Agência Reguladora de Energia desde 2018.',
      status: 'confirmed', juris: 'PT', date: '1970', precision: 'year',
      aliases: [], tags: ['regulador'],
      visual: AV('GS'),
      facts: [
        'Director de licenciamento da ARE desde 2018.',
        'Subscreveu a decisão sancionatória de 2019 contra a Lusovenus.',
        'A ARE recusou comentar a relação com o grupo.'
      ], alleges: [], contradictions: [] });

  E({ id: 'p-marta', type: 'person', name: 'Marta Zuzarte',
      short: 'Sócia revisora oficial de contas (Prazos & Cia)',
      ctx: 'Auditora (n. 1975). Sócia responsável pela auditoria do grupo entre 2018 e 2022.',
      status: 'confirmed', juris: 'PT', date: '1975', precision: 'year',
      aliases: [], tags: ['auditoria'],
      visual: AV('MZ'),
      facts: [
        'Sócia da Prazos & Cia — SROC desde 2014.',
        'Assinou o relatório de auditoria de 2020 com opinião qualificada.',
        'Cessou funções na auditoria do grupo em 2022 (rotação obrigatória).'
      ], alleges: [], contradictions: [] });

  E({ id: 'p-samuel', type: 'person', name: 'Samuel Krasniqi',
      short: 'Advogado luxemburguês, administrador de veículos',
      ctx: 'Advogado (n. 1977). Sócio da fiduciária que administra a Atlântico 7.',
      status: 'probable', juris: 'LU', date: '1977', precision: 'year',
      aliases: [], tags: ['offshore'],
      visual: AV('SK'),
      facts: [
        'Sócio da fiduciária inscrita no registo luxemburguês que administra a Atlântico 7.',
        'Consta como mandatário em 14 constituições de sociedades veículo entre 2016 e 2020.'
      ], alleges: ['A investigação jornalística sugere ligação familiar com Nadia Krasniqi; não foi possível confirmar.'],
      contradictions: [] });
})(typeof window !== 'undefined' ? window : globalThis);
