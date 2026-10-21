/* ========= 7. TRANSACÇÕES COMO NÓS E FLUXOS ADICIONAIS ============== */
(function (g) { 'use strict';
  const { R } = g.VN_KIT;
  const P = (id, tx, name, date, extra) => R(id, tx, 'participated_in', Object.assign({
    start: date, startPrec: 'month', status: 'confirmed', conf: 4,
    src: tx, loc: 'registo da operação', lv: '2025-09-30',
    ex: 'Registo da operação «' + name + '» identificando a entidade participante.'
  }, extra || {}));

  P('c-aurora2', 't-invest-cascata', 'Investimento na Cascata Digital', '2019-04-01');
  P('c-cascata', 't-invest-cascata', 'Investimento na Cascata Digital', '2019-04-01');
  P('c-aurora2', 't-invest-solaris', 'Investimento na Solaris', '2019-10-01');
  P('c-solaris', 't-invest-solaris', 'Investimento na Solaris', '2019-10-01');
  P('c-meridiano', 't-financiamento', 'Financiamento sindicado', '2020-11-01');
  P('c-banco', 't-financiamento', 'Financiamento sindicado', '2020-11-01');
  P('c-aldevaran', 't-donativo', 'Donativo à Fundação', '2020-06-01');
  P('f-luz', 't-donativo', 'Donativo à Fundação', '2020-06-01');
  P('c-meridiano', 't-argos', 'Pagamentos à Argos', '2015-06-01', { status: 'contradicted', conf: 1 });
  P('c-argos', 't-argos', 'Pagamentos à Argos', '2015-06-01', { status: 'contradicted', conf: 1 });
  P('c-cascata', 't-contrato-cascata', 'Contrato com o município', '2022-04-01');
  P('g-municipio', 't-contrato-cascata', 'Contrato com o município', '2022-04-01');
  P('c-solaris', 't-venda-participacao', 'Venda de participação', '2021-07-01');
  P('c-meridiano', 't-venda-participacao', 'Venda de participação', '2021-07-01');

  R('c-banco', 'c-solaris', 'lent_to', { start: '2021-02-01', startPrec: 'month', end: '2031-02-01', endPrec: 'month',
    status: 'probable', conf: 3, why: 'Empréstimo referido no relatório regulatório; contrato não obtido.',
    src: 'd-pgr', loc: 'anexo V', lv: '2024-06-30', amount: 60000000, currency: 'EUR',
    ex: '«A Solaris Renováveis beneficia de financiamento bancário de 60 M€, com o Banco Atlântico Ibérico como agente.»' });
  R('c-meridiano', 'c-solaris', 'transacted_with', { start: '2021-07-01', startPrec: 'month', status: 'confirmed', conf: 4,
    src: 't-venda-participacao', loc: 'acta, ponto 3', lv: '2025-09-30', amount: 9000000, currency: 'EUR',
    ex: '«Aquisição, pela Meridiano, de 12% do capital da Solaris, pelo preço de 9 000 000 EUR.»' });
  R('c-banco', 'p-tomas', 'documented_meeting', { start: '2020-11-30', startPrec: 'day', status: 'confirmed', conf: 4,
    why: 'Reunião de assinatura documentada no contrato; não implica relação pessoal para além do acto.',
    src: 'd-contrato-fin', loc: 'p. 96', lv: '2025-09-30',
    ex: '«Assinado na sede do Banco, em 30 de Novembro de 2020, pelos representantes das partes.»' });
  R('p-helena', 'c-meridiano', 'advised_by', { start: '2018-07-04', startPrec: 'day', status: 'unverified', conf: 1,
    why: 'A gestora do fundo é referida numa nota de imprensa como tendo "acompanhado" a negociação da adenda, mas não há documento que a vincule à Meridiano. Assinalada como não verificada.',
    src: 'd-investigacao', loc: 'artigo 4, §7', lv: '2022-01-10',
    ex: '«Segundo duas fontes, a gestora acompanhou a negociação da adenda em 2018.»' });
})(typeof window !== 'undefined' ? window : globalThis);
