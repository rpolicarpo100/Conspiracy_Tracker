/* ================ 2. EMPRESAS, FUNDOS E VEÍCULOS ==================== */
(function (g) { 'use strict';
  const { E, R, AV } = g.VN_KIT;

  E({ id: 'c-aldevaran', type: 'company', name: 'Grupo Aldevaran, SGPS',
      short: 'Holding familiar do sector da energia e infraestruturas',
      ctx: 'Sociedade gestora de participações sociais, Matosinhos. Capital social 250 M€. Constituída em 1998.',
      status: 'confirmed', juris: 'PT', date: '1998-04-17', precision: 'day',
      aliases: ['Aldevaran SGPS'], tags: ['núcleo', 'holding'],
      visual: { kind: 'logo', mark: 'hex', monogram: 'GA', src: null, credit: 'Marca fictícia criada para o protótipo — não é um logótipo real.', licence: 'CC0-1.0', source: 'vn-avatar-generator', verified: false },
      facts: ['41,5% de Vítor Samaniego Rocha; 18% de Íris Samaniego Vasconcelos; 12% via Samaniego Family Office; 28,5% free float.',
              'Consolidou 14 participações em 2025; volume de negócios de 1,7 mil milhões de euros.',
              'Sociedade-mãe da Meridiano Infraestruturas e da Aldevaran Capital Partners.'],
      alleges: [], contradictions: [] });

  E({ id: 'c-acp', type: 'company', name: 'Aldevaran Capital Partners, SCR',
      short: 'Sociedade gestora de fundos de capital de risco',
      ctx: 'Gestora registada na CMVM. Administra o Fundo Aurora II (210 M€). Sede no Porto.',
      status: 'confirmed', juris: 'PT', date: '2015-11-03', precision: 'day',
      aliases: ['ACP'], tags: ['fundos'],
      visual: { kind: 'logo', mark: 'orbit', monogram: 'AC', src: null, credit: 'Marca fictícia criada para o protótipo — não é um logótipo real.', licence: 'CC0-1.0', source: 'vn-avatar-generator', verified: false },
      facts: ['Constituída em Novembro de 2015; registo de gestora em 2016.',
              'Administra o Fundo Aurora II, com 210 M€ de capital comprometido (2018).',
              'Participada a 100% pelo Grupo Aldevaran.'],
      alleges: [], contradictions: [] });

  E({ id: 'c-aurora2', type: 'company', name: 'Fundo Aurora II, FCR',
      short: 'Fundo de capital de risco fechado (210 M€)',
      ctx: 'Fundo gerido pela Aldevaran Capital Partners. Investidores: fundos de pensões e family offices.',
      status: 'confirmed', juris: 'PT', date: '2018-06-12', precision: 'day',
      aliases: ['Aurora II'], tags: ['fundos'],
      visual: { kind: 'logo', mark: 'orbit', monogram: 'A2', src: null, credit: 'Marca fictícia criada para o protótipo — não é um logótipo real.', licence: 'CC0-1.0', source: 'vn-avatar-generator', verified: false },
      facts: ['Capital comprometido de 210 M€; 38% subscrito por investidores institucionais estrangeiros.',
              'Participações documentadas: Cascata Digital (35 M€), Solaris Renováveis (48 M€).',
              'Período de investimento 2018–2024.'],
      alleges: ['A investigação de 2021 questiona a ausência de co-investimento do grupo em duas operações.'],
      contradictions: [] });

  E({ id: 'c-meridiano', type: 'company', name: 'Meridiano Infraestruturas, S.A.',
      short: 'Concessionária de infraestruturas rodoviárias e energia',
      ctx: 'Concessionária da autoestrada A-31 (Vale do Tejo). Capital 120 M€. 240 trabalhadores.',
      status: 'confirmed', juris: 'PT', date: '2010-02-08', precision: 'day',
      aliases: ['Meridiano'], tags: ['núcleo', 'concessionária'],
      visual: { kind: 'logo', mark: 'arch', monogram: 'MI', src: null, credit: 'Marca fictícia criada para o protótipo — não é um logótipo real.', licence: 'CC0-1.0', source: 'vn-avatar-generator', verified: false },
      facts: ['Concessionária da A-31 desde 2016, contrato assinado com o município de Vila Franca do Vale.',
              '75% detidos pelo Grupo Aldevaran; 25% pela Atlântico 7 S.à r.l.',
              'Financiamento sindicado de 180 M€ contratado em 2020 com o Banco Atlântico Ibérico.'],
      alleges: ['A acusação de 2022 alega que a concessão foi obtida com vantagens indevidas.'],
      contradictions: ['A auditoria do Tribunal de Contas (2021) considerou o procedimento "formalmente regular", com reservas quanto à fundamentação do preço.'] });

  E({ id: 'c-atlantico7', type: 'company', name: 'Atlântico 7 S.à r.l.',
      short: 'Veículo luxemburguês que detém 25% da Meridiano',
      ctx: 'Sociedade de responsabilidade limitada, Luxemburgo. Constituída em 2016. Administração fiduciária.',
      status: 'probable', juris: 'LU', date: '2016-09-22', precision: 'day',
      aliases: ['Atlantico 7'], tags: ['offshore', 'veículo'],
      visual: AV('A7'),
      facts: ['Constituída em Setembro de 2016, três meses antes da assinatura do contrato de concessão.',
              'Detém 25% da Meridiano Infraestruturas desde Dezembro de 2016.',
              'Beneficiária efectiva registada: Nadia Krasniqi (registo luxemburguês, 2017).'],
      alleges: ['A investigação jornalística alega que o veículo oculta accionistas portugueses; a sociedade gestora nega.'],
      contradictions: ['O registo de beneficiários efectivos não identifica qualquer accionista português.'] });

  E({ id: 'c-cascata', type: 'company', name: 'Cascata Digital, S.A.',
      short: 'Plataforma de serviços digitais para municípios',
      ctx: 'Empresa tecnológica, Braga. 96 trabalhadores. Participada pelo Fundo Aurora II.',
      status: 'confirmed', juris: 'PT', date: '2013-05-30', precision: 'day',
      aliases: ['Cascata'], tags: ['tecnologia'],
      visual: { kind: 'logo', mark: 'bars', monogram: 'CD', src: null, credit: 'Marca fictícia criada para o protótipo — não é um logótipo real.', licence: 'CC0-1.0', source: 'vn-avatar-generator', verified: false },
      facts: ['Fundo Aurora II detém 30% desde 2019 (investimento de 35 M€).',
              'Contrato-quadro com a Câmara de Vila Franca do Vale assinado em 2022 (1,2 M€).',
              'Rui Pellicano integrou o conselho de administração entre 2021 e 2024.'],
      alleges: [], contradictions: [] });

  E({ id: 'c-solaris', type: 'company', name: 'Solaris Renováveis, S.A.',
      short: 'Produtor independente de energia solar',
      ctx: 'Produtor de energia, Évora. Fundo Aurora II detém 45%. Capacidade instalada de 240 MW.',
      status: 'confirmed', juris: 'PT', date: '2016-03-14', precision: 'day',
      aliases: ['Solaris'], tags: ['energia'],
      visual: { kind: 'logo', mark: 'wave', monogram: 'SR', src: null, credit: 'Marca fictícia criada para o protótipo — não é um logótipo real.', licence: 'CC0-1.0', source: 'vn-avatar-generator', verified: false },
      facts: ['Investimento de 48 M€ do Fundo Aurora II em 2019.',
              'Contrato de fornecimento de energia com a Meridiano assinado em 2021.',
              'Financiamento bancário de 60 M€ em 2021.'],
      alleges: [], contradictions: [] });

  E({ id: 'c-banco', type: 'company', name: 'Banco Atlântico Ibérico, S.A.',
      short: 'Banco comercial; líder do sindicato de financiamento',
      ctx: 'Banco com sede em Lisboa. Liderou o financiamento de 180 M€ à Meridiano.',
      status: 'confirmed', juris: 'PT', date: '1987-01-20', precision: 'day',
      aliases: ['BAI'], tags: ['financeiro'],
      visual: { kind: 'logo', mark: 'ring', monogram: 'BA', src: null, credit: 'Marca fictícia criada para o protótipo — não é um logótipo real.', licence: 'CC0-1.0', source: 'vn-avatar-generator', verified: false },
      facts: ['Líder do sindicato de financiamento de 180 M€ (2020).',
              'Presta serviços de tesouraria ao Grupo Aldevaran desde 2015.',
              'Distribuiu 45 M€ de dividendos em 2024.'],
      alleges: [], contradictions: [] });

  E({ id: 'c-argos', type: 'company', name: 'Argos Partners Consultoria, Lda.',
      short: 'Consultora de estruturação de candidaturas',
      ctx: 'Consultora, Lisboa. Sócio-gerente: Fausto Melicias. Facturação de 1,8 M€ em 2015.',
      status: 'probable', juris: 'PT', date: '2012-07-19', precision: 'day',
      aliases: ['Argos'], tags: ['intermediação', 'judicial'],
      visual: AV('AP'),
      facts: ['Prestou serviços à Meridiano entre 2014 e 2016 (faturação de 1,3 M€).',
              'Sócio-gerente Fausto Melicias foi arguido e absolvido em 2025.',
              'Encerrou a actividade em 2023.'],
      alleges: ['A acusação descreve pagamentos da Meridiano à Argos como canal de vantagens para o director municipal.'],
      contradictions: ['A sentença de 2025 considerou não provados esses pagamentos.'] });

  E({ id: 'c-sottomayor', type: 'company', name: 'Sottomayor & Vilar — Sociedade de Advogados',
      short: 'Sociedade de advogados, assessoria contratual do grupo',
      ctx: 'Sociedade de advogados, Lisboa. Sócia fundadora: Amélia Sottomayor Vilar.',
      status: 'confirmed', juris: 'PT', date: '1998-10-01', precision: 'day',
      aliases: ['S&V'], tags: ['assessoria'],
      visual: AV('SV'),
      facts: ['Assessora o Grupo Aldevaran em contratos públicos desde 2014.',
              'Subscreveu o parecer jurídico que sustentou a Adenda 1 (2018).',
              'Registada no Registo de Transparência como representante de interesses (2022).'],
      alleges: [], contradictions: [] });

  E({ id: 'c-prazos', type: 'company', name: 'Prazos & Cia — SROC',
      short: 'Sociedade revisora oficial de contas',
      ctx: 'Auditora registada na OROC. Auditou o grupo entre 2018 e 2022.',
      status: 'confirmed', juris: 'PT', date: '2004-02-11', precision: 'day',
      aliases: ['Prazos & Cia'], tags: ['auditoria'],
      visual: AV('PC'),
      facts: ['Relatório de 2020 com opinião qualificada sobre a valorização de participações.',
              'Rotação do sócio responsável em 2022 (Marta Zuzarte).'],
      alleges: [], contradictions: [] });

  E({ id: 'c-family-office', type: 'company', name: 'Samaniego Family Office, S.A.',
      short: 'Veículo familiar de gestão de participações',
      ctx: 'Family office da família fundadora. Detém 12% do Grupo Aldevaran.',
      status: 'confirmed', juris: 'PT', date: '2012-12-06', precision: 'day',
      aliases: ['SFO'], tags: ['família', 'holding'],
      visual: AV('SF'),
      facts: ['Detém 12% do Grupo Aldevaran.', 'Administradores: Vítor Samaniego Rocha e Íris Samaniego Vasconcelos.'],
      alleges: [], contradictions: [] });

  E({ id: 'c-lusovenus', type: 'company', name: 'Lusovenus Energia, S.A.',
      short: 'Comercializadora de energia (sancionada em 2019)',
      ctx: 'Comercializadora, Setúbal. Sancionada pela ARE em 2019 por práticas de mercado.',
      status: 'confirmed', juris: 'PT', date: '2009-09-09', precision: 'day',
      aliases: ['Lusovenus'], tags: ['regulatório'],
      visual: AV('LE'),
      facts: ['Sancionada pela ARE em 2019 (coima de 1,2 M€).', 'Adquiriu serviços de consultoria à Argos em 2017.'],
      alleges: [], contradictions: [] });
})(typeof window !== 'undefined' ? window : globalThis);
