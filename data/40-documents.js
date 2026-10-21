/* ===================== 4. DOCUMENTOS ================================ */
(function (g) { 'use strict';
  const { E, R, AV } = g.VN_KIT;
  const DOC = (id, name, short, ctx, date, extra) => E(Object.assign({
    id: id, type: 'document', name: name, short: short, ctx: ctx,
    status: 'confirmed', juris: 'PT', date: date, precision: 'day',
    aliases: [], tags: ['prova'], visual: AV('DOC')
  }, extra));

  DOC('d-certidao', 'Certidão permanente comercial n.º 2016/44812',
      'Certidão do registo comercial da Meridiano',
      'Certidão emitida pela Conservatória do Registo Comercial de Matosinhos. 14 páginas; identifica accionistas e órgãos sociais.',
      '2016-12-19',
      { facts: ['Identifica o Grupo Aldevaran (75%) e a Atlântico 7 (25%) como accionistas da Meridiano.'],
        visual: AV('C1', { src: null }) });

  DOC('d-prospecto', 'Prospecto do Fundo Aurora II',
      'Prospecto informativo do fundo (88 páginas)',
      'Documento de oferta do Fundo Aurora II, publicado em 2018. Descreve política de investimento e comissões.',
      '2018-06-12',
      { facts: ['Descreve a política de investimento em infraestruturas e tecnologia.',
                'Omite qualquer referência a co-investimento do Grupo Aldevaran.'] });

  DOC('d-contrato', 'Contrato de concessão da A-31 (2016)',
      'Contrato de concessão celebrado com o município',
      'Contrato de concessão rodoviária, 142 páginas, celebrado em 2016 entre o município e a Meridiano.',
      '2016-12-21',
      { facts: ['Objecto: exploração da A-31 por 30 anos.',
                'Preço base de 412 M€; prazo de 30 anos.',
                'Assinado por Lurdes Antunes e Vítor Samaniego Rocha.'] });

  DOC('d-adenda1', 'Adenda n.º 1 ao contrato de concessão',
      'Adenda de 2018 (prorrogação de prazo)',
      'Adenda que prorroga o prazo em 7 anos e revê o mecanismo de remuneração. 22 páginas.',
      '2018-07-04',
      { facts: ['Prorrogação por 7 anos, sem novo concurso.',
                'Parecer jurídico subscrito por Amélia Sottomayor Vilar.'] });

  DOC('d-adenda2', 'Adenda n.º 2 ao contrato de concessão',
      'Adenda de 2020 (reequilíbrio financeiro)',
      'Adenda relativa ao reequilíbrio financeiro após quebra de tráfego. 31 páginas.',
      '2020-10-15',
      { facts: ['Reequilíbrio de 26 M€ a favor da concessionária.'] });

  DOC('d-acta-2015', 'Acta da reunião de Câmara de 9 de Setembro de 2015',
      'Acta que regista a adjudicação da concessão',
      'Acta n.º 34/2015. Regista a votação da adjudicação e as declarações de voto.',
      '2015-09-09',
      { facts: ['Adjudicação à Meridiano aprovada por 4 votos a favor e 3 abstenções.',
                'Regista a abstenção da presidente Lurdes Antunes.',
                'Não regista a presença de Vítor Samaniego Rocha.'] });

  DOC('d-relatorio-tdc', 'Relatório de auditoria do Tribunal de Contas n.º 12/2021',
      'Auditoria ao contrato de concessão',
      'Relatório de 71 páginas sobre a legalidade e economicidade do contrato e das adendas.',
      '2021-04-30',
      { facts: ['Conclui que o procedimento foi formalmente regular.',
                'Formula reservas quanto à fundamentação do preço base e à prorrogação de 2018.'] });

  DOC('d-acusacao', 'Acusação do Ministério Público (Processo Meridiano)',
      'Acusação de 2022 contra quatro arguidos',
      'Peça processual de 214 páginas. Deduz acusação por tráfico de influência e participação económica em negócio.',
      '2022-02-18',
      { facts: ['Descreve pagamentos da Meridiano à Argos entre 2014 e 2016.',
                'Qualifica Vítor Samaniego Rocha como beneficiário último do alegado esquema.',
                'Não imputa crimes a Helena Vasconcelos Braga nem a Íris Samaniego.'] });

  DOC('d-sentenca', 'Sentença do Tribunal Judicial (Processo Meridiano)',
      'Sentença de 1.ª instância (2025)',
      'Sentença de 312 páginas. Condena Joaquim Bandeira e absolve Fausto Melicias.',
      '2025-06-27',
      { facts: ['Condena Joaquim Bandeira a 4 anos, suspensa, por tráfico de influência.',
                'Absolve Fausto Melicias por falta de prova.',
                'Considera não provados os pagamentos da Meridiano à Argos descritos na acusação.'] });

  DOC('d-investigacao', 'Série jornalística "Os donos da autoestrada"',
      'Investigação publicada pela Nova Rota Media',
      'Série de 6 artigos publicada em Outubro de 2021. Baseia-se em documentos obtidos por acesso a documentos administrativos.',
      '2021-10-11',
      { facts: ['Primeira referência pública à Atlântico 7 e a Nadia Krasniqi.',
                'Sugere ligações não documentadas entre a família fundadora e o director municipal.'] });

  DOC('d-parecer', 'Parecer jurídico sobre a Adenda n.º 1',
      'Parecer da Sottomayor & Vilar',
      'Parecer de 34 páginas que sustenta a legalidade da prorrogação.',
      '2018-06-20',
      { facts: ['Sustenta que a prorrogação dispensa novo concurso.'] });

  DOC('d-registo-be', 'Registo de beneficiários efectivos — Atlântico 7',
      'Extracto do registo luxemburguês',
      'Extracto de 3 páginas do registo de beneficiários efectivos do Luxemburgo.',
      '2017-03-08',
      { facts: ['Identifica Nadia Krasniqi como beneficiária efectiva registada.'] });

  DOC('d-contrato-fin', 'Contrato de financiamento sindicado (2020)',
      'Contrato de 180 M€ liderado pelo Banco Atlântico Ibérico',
      'Contrato de financiamento estruturado, 96 páginas, com garantias sobre receitas de portagem.',
      '2020-11-30',
      { facts: ['Montante de 180 M€, prazo de 12 anos.',
                'Assinado por Tomás Queirós Falcão em nome da Meridiano.'] });

  DOC('d-acta-2022', 'Acta da reunião de 14 de Março de 2022',
      'Reunião entre o grupo e o município sobre mobilidade digital',
      'Acta n.º 8/2022. Regista a reunião com representantes do grupo e da Cascata Digital.',
      '2022-03-14',
      { facts: ['Regista a presença de Íris Samaniego Vasconcelos.',
                'Discute a contratação da Cascata Digital.'] });

  DOC('d-pgr', 'Relatório de auditoria da ARE sobre a Meridiano',
      'Auditoria regulatória de 2023',
      'Relatório interno de 2023, parcialmente público. Conclui sem sanções; recomenda reforço de reporte.',
      '2023-09-18',
      { facts: ['Sem sanções aplicadas.', 'Recomenda reforço do reporte trimestral.'] });
})(typeof window !== 'undefined' ? window : globalThis);
