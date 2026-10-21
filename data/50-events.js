/* ============== 5. ACONTECIMENTOS E TRANSACÇÕES ===================== */
(function (g) { 'use strict';
  const { E, R, AV } = g.VN_KIT;

  const EV = (id, name, short, ctx, date, prec, extra) => E(Object.assign({
    id: id, type: 'event', name: name, short: short, ctx: ctx,
    status: 'confirmed', juris: 'PT', date: date, precision: prec || 'day',
    aliases: [], tags: ['acontecimento'], visual: AV('EV')
  }, extra || {}));

  EV('e-concurso', 'Lançamento do concurso de concessão da A-31',
     'Aviso de concurso publicado pelo município',
     'Publicação do aviso de concurso para a concessão rodoviária da A-31.',
     '2015-02-16', 'day');
  EV('e-adjudicacao', 'Adjudicação da concessão à Meridiano',
     'Deliberação camarária de adjudicação',
     'Reunião de Câmara que adjudicou a concessão; 4 votos a favor, 3 abstenções.',
     '2015-09-09', 'day');
  EV('e-conferencia', 'Conferência anual do Vale do Tejo',
     'Encontro patronal documentado',
     'Conferência organizada pela Associação Empresarial do Vale do Tejo.',
     '2019-05-23', 'day');
  EV('e-busca', 'Buscas domiciliárias no âmbito do Processo Meridiano',
     'Diligências de investigação criminal',
     'Buscas na Câmara Municipal, na Meridiano e na Argos Partners.',
     '2021-02-11', 'day');
  EV('e-julgamento', 'Início do julgamento do Processo Meridiano',
     'Abertura da audiência de julgamento',
     'Início do julgamento no Tribunal Judicial da Comarca do Vale do Tejo.',
     '2023-11-06', 'day');
  EV('e-donativo', 'Donativo do Grupo Aldevaran à Fundação N. S. da Luz',
     'Acto de mecenato documentado',
     'Entrega de donativo de 600 mil euros para obras sociais.',
     '2020-06-30', 'month');
  EV('e-suspensao', 'Suspensão de pagamentos pela ARE',
     'Decisão regulatória interina',
     'A ARE suspendeu temporariamente a aprovação de tarifas à Meridiano durante a auditoria.',
     '2023-04-12', 'day');

  const TX = (id, name, short, ctx, date, amount, currency, extra) => E(Object.assign({
    id: id, type: 'transaction', name: name, short: short, ctx: ctx,
    status: 'confirmed', juris: 'PT', date: date, precision: 'month',
    aliases: [], tags: ['financeiro'], visual: AV('TX')
  }, extra || {}));

  TX('t-invest-cascata', 'Investimento do Fundo Aurora II na Cascata Digital',
     'Aquisição de 30% por 35 M€',
     'Operação de capital de risco documentada em acta do fundo.',
     '2019-04-01', 35000000, 'EUR',
     { facts: ['30% do capital da Cascata Digital por 35 M€.'] });
  TX('t-invest-solaris', 'Investimento do Fundo Aurora II na Solaris Renováveis',
     'Aquisição de 45% por 48 M€',
     'Operação de capital de risco documentada em acta do fundo.',
     '2019-10-01', 48000000, 'EUR');
  TX('t-financiamento', 'Financiamento sindicado de 180 M€ à Meridiano',
     'Empréstimo liderado pelo Banco Atlântico Ibérico',
     'Contrato de financiamento estruturado com garantia de receitas de portagem.',
     '2020-11-30', 180000000, 'EUR',
     { facts: ['180 M€, 12 anos, garantia sobre receitas de portagem.'] });
  TX('t-donativo', 'Donativo de 600 mil euros à Fundação N. S. da Luz',
     'Donativo declarado pelo Grupo Aldevaran',
     'Transferência documentada e recibo emitido pela fundação.',
     '2020-06-01', 600000, 'EUR');
  TX('t-argos', 'Pagamentos da Meridiano à Argos Partners',
     'Contrato de consultoria (2014–2016)',
     'Conjunto de pagamentos por serviços de apoio a candidaturas. A sentença de 2025 considerou não provados os valores descritos na acusação.',
     '2015-06-01', 1300000, 'EUR',
     { status: 'contradicted',
       facts: ['Facturação total de 1,3 M€ entre 2014 e 2016 (contabilidade da Argos).'],
       alleges: ['A acusação descreve 300 mil euros canalizados para o director municipal.'],
       contradictions: ['A sentença de 2025 considerou não provados esses pagamentos.'] });
  TX('t-contrato-cascata', 'Contrato da Cascata Digital com o município',
     'Contrato-quadro de serviços digitais (1,2 M€)',
     'Contrato-quadro para plataforma de gestão urbanística.',
     '2022-04-01', 1200000, 'EUR');
  TX('t-venda-participacao', 'Venda de 12% da Solaris à Meridiano',
     'Transacção intragrupo',
     'Transacção entre o fundo e a concessionária, documentada em acta.',
     '2021-07-01', 9000000, 'EUR');
})(typeof window !== 'undefined' ? window : globalThis);
