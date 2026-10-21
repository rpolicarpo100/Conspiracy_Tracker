/* ================ 6. RELAÇÕES DOCUMENTADAS ==========================
   Regra do projecto: nenhuma relação é criada apenas porque duas
   entidades aparecem na mesma página. Cada aresta exige fonte + excerto
   (ou é explicitamente marcada como não verificada / alegada).
   ================================================================== */
(function (g) { 'use strict';
  const { R } = g.VN_KIT;

  /* ---------- Propriedade e controlo ---------- */
  R('p-vitor', 'c-aldevaran', 'shareholder_of', { start: '1998-04-17', startPrec: 'day', status: 'confirmed', conf: 5,
    why: 'Certidão do registo comercial e relatório de contas de 2025 coincidem na percentagem.',
    src: 'd-certidao', loc: 'p. 6, quadro de accionistas', lv: '2025-09-30', amount: 41.5, currency: '%',
    ex: '«Accionista: Vítor Samaniego Rocha, NIF ***, 41 500 acções ordinárias, correspondentes a 41,5% do capital social.»' });
  R('p-iris', 'c-aldevaran', 'shareholder_of', { start: '2018-05-01', startPrec: 'month', status: 'confirmed', conf: 5,
    src: 'd-certidao', loc: 'p. 6', lv: '2025-09-30', amount: 18, currency: '%',
    ex: '«Accionista: Íris Samaniego Vasconcelos, 18 000 acções, 18% do capital.»' });
  R('p-iris', 'c-family-office', 'held_position', { start: '2012-12-06', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'd-certidao', loc: 'p. 9', lv: '2025-09-30',
    ex: '«Administradores: Vítor Samaniego Rocha e Íris Samaniego Vasconcelos.»' });
  R('p-vitor', 'c-family-office', 'held_position', { start: '2012-12-06', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'd-certidao', loc: 'p. 9', lv: '2025-09-30',
    ex: '«Administradores: Vítor Samaniego Rocha e Íris Samaniego Vasconcelos.»' });
  R('c-family-office', 'c-aldevaran', 'shareholder_of', { start: '2013-01-15', startPrec: 'month', status: 'confirmed', conf: 5,
    src: 'd-certidao', loc: 'p. 6', lv: '2025-09-30', amount: 12, currency: '%',
    ex: '«Samaniego Family Office, S.A.: 12% do capital social.»' });
  R('c-aldevaran', 'c-acp', 'subsidiary_of', { start: '2015-11-03', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-certidao', loc: 'p. 11', lv: '2025-09-30',
    ex: '«Aldevaran Capital Partners, SCR — sócio único: Grupo Aldevaran, SGPS.»' });
  R('c-aldevaran', 'c-meridiano', 'shareholder_of', { start: '2016-12-19', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-certidao', loc: 'p. 14', lv: '2025-09-30', amount: 75, currency: '%',
    ex: '«Meridiano Infraestruturas, S.A.: Grupo Aldevaran, SGPS (75%); Atlântico 7 S.à r.l. (25%).»' });
  R('c-atlantico7', 'c-meridiano', 'shareholder_of', { start: '2016-12-19', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-certidao', loc: 'p. 14', lv: '2025-09-30', amount: 25, currency: '%',
    ex: '«Meridiano Infraestruturas, S.A.: Atlântico 7 S.à r.l. (25%).»' });
  R('c-acp', 'c-aurora2', 'held_position', { start: '2018-06-12', startPrec: 'day', status: 'confirmed', conf: 5,
    why: 'A gestora é a sociedade gestora do fundo, conforme prospecto e registo da CMVM.',
    src: 'd-prospecto', loc: 'p. 4, §1.2', lv: '2025-06-30',
    ex: '«A Fundo Aurora II, FCR é gerido pela Aldevaran Capital Partners, SCR, sociedade gestora registada na CMVM.»' });
  R('c-aurora2', 'c-cascata', 'shareholder_of', { start: '2019-04-01', startPrec: 'month', status: 'confirmed', conf: 5,
    src: 't-invest-cascata', loc: 'acta do fundo, deliberação n.º 3/2019', lv: '2025-09-30', amount: 30, currency: '%',
    ex: '«O Fundo adquire 30% do capital social da Cascata Digital, S.A. pelo montante de 35 000 000 EUR.»' });
  R('c-aurora2', 'c-solaris', 'shareholder_of', { start: '2019-10-01', startPrec: 'month', status: 'confirmed', conf: 5,
    src: 't-invest-solaris', loc: 'acta do fundo, deliberação n.º 9/2019', lv: '2025-09-30', amount: 45, currency: '%',
    ex: '«Aquisição de 45% da Solaris Renováveis, S.A. por 48 000 000 EUR.»' });
  R('p-helena', 'c-acp', 'held_position', { start: '2017-03-01', startPrec: 'month', status: 'confirmed', conf: 5,
    src: 'd-prospecto', loc: 'p. 9', lv: '2025-09-30',
    ex: '«Presidente do Conselho de Administração: Helena Vasconcelos Braga, desde 1 de Março de 2017.»' });
  R('p-vitor', 'c-aldevaran', 'held_position', { start: '2003-01-01', startPrec: 'year', status: 'confirmed', conf: 5,
    src: 'd-certidao', loc: 'p. 8', lv: '2025-09-30',
    ex: '«Presidente do Conselho de Administração: Vítor Samaniego Rocha (desde 2003).»' });
  R('p-iris', 'c-meridiano', 'board_member', { start: '2018-09-01', startPrec: 'month', status: 'confirmed', conf: 4,
    src: 'd-certidao', loc: 'p. 16', lv: '2025-09-30',
    ex: '«Administradores não executivos: Íris Samaniego Vasconcelos (desde Setembro de 2018).»' });
  R('p-tomas', 'c-meridiano', 'held_position', { start: '2014-01-15', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-certidao', loc: 'p. 16', lv: '2025-09-30',
    ex: '«Director Financeiro: Tomás Queirós Falcão, desde 15 de Janeiro de 2014.»' });
  R('p-rui', 'c-cascata', 'board_member', { start: '2021-02-01', startPrec: 'month', end: '2024-03-31', endPrec: 'day',
    status: 'confirmed', conf: 4, src: 'd-prospecto', loc: 'p. 22, nota de participações', lv: '2025-09-30',
    ex: '«O Fundo indicou Rui Pellicano para o conselho de administração da participada entre Fevereiro de 2021 e Março de 2024.»' });
  R('p-rui', 'c-aurora2', 'held_position', { start: '2018-06-12', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-prospecto', loc: 'p. 10', lv: '2025-09-30',
    ex: '«Gestor de investimento responsável: Rui Pellicano.»' });
  R('p-nadia', 'c-atlantico7', 'beneficial_owner_of', { start: '2017-03-08', startPrec: 'day', status: 'probable', conf: 3,
    why: 'Registo oficial identifica-a como beneficiária efectiva, mas um contrato de mandato não divulgado sugere ausência de interesse económico próprio — daí não ser "confirmado".',
    src: 'd-registo-be', loc: 'p. 2, campo 4', lv: '2025-05-20',
    ex: '«Beneficiário efectivo registado: Nadia Krasniqi, n. 1981, residente no Luxemburgo, 100% dos interesses.»' });
  R('p-samuel', 'c-atlantico7', 'nominee_for', { start: '2016-09-22', startPrec: 'day', status: 'alleged', conf: 2,
    why: 'Apenas a investigação jornalística descreve o papel de nomeado; nenhum documento primário obtido.',
    src: 'd-investigacao', loc: 'artigo 2, §5', lv: '2022-01-10',
    ex: '«A sociedade é administrada pela fiduciária de Samuel Krasniqi, que assina como mandatário.»' });
  R('p-samuel', 'p-nadia', 'family_of', { start: null, status: 'unverified', conf: 1,
    why: 'Apenas referida como "possível ligação familiar"; sem certidão ou registo.',
    src: 'd-investigacao', loc: 'artigo 2, nota 12', lv: '2022-01-10',
    ex: '«Não foi possível confirmar a relação familiar entre ambos.»' });
  R('c-solaris', 'c-meridiano', 'supplied', { start: '2021-07-01', startPrec: 'month', status: 'confirmed', conf: 4,
    src: 't-venda-participacao', loc: 'acta, ponto 3', lv: '2025-09-30',
    ex: '«A Solaris fornecerá 40 GWh/ano à Meridiano durante 10 anos.»' });
  R('c-aurora2', 'c-meridiano', 'paid_amount_to', { start: '2021-07-01', startPrec: 'month', status: 'confirmed', conf: 4,
    src: 't-venda-participacao', loc: 'acta, ponto 3', lv: '2025-09-30', amount: 9000000, currency: 'EUR',
    ex: '«Transacção de 12% da Solaris, no valor de 9 000 000 EUR, entre o Fundo e a Meridiano.»' });

  /* ---------- Governança e mandato ---------- */
  R('p-lurdes', 'g-municipio', 'held_position', { start: '2013-10-01', startPrec: 'month', end: '2021-10-01', endPrec: 'month',
    status: 'confirmed', conf: 5, src: 'd-contrato', loc: 'preâmbulo, p. 2', lv: '2025-09-30',
    ex: '«...representada pela Presidente da Câmara Municipal, Dr.ª Lurdes Antunes...»' });
  R('p-joaquim', 'g-municipio', 'held_position', { start: '2012-01-01', startPrec: 'year', end: '2017-12-31', endPrec: 'year',
    status: 'confirmed', conf: 5, src: 'd-acusacao', loc: '§12', lv: '2025-09-30',
    ex: '«O arguido exerceu funções de Director Municipal de Obras entre 2012 e 2017.»' });
  R('p-joaquim', 'e-adjudicacao', 'participated_in', { start: '2015-09-09', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-acta-2015', loc: 'p. 3, lista de presentes', lv: '2025-09-30',
    ex: '«Presentes: ... Director Municipal de Obras, Dr. Joaquim Bandeira (membro da comissão de avaliação).»' });
  R('p-lurdes', 'd-acta-2015', 'documented_in', { status: 'confirmed', conf: 5, src: 'd-acta-2015', loc: 'p. 5',
    lv: '2025-09-30', ex: '«A Senhora Presidente declarou abster-se da votação, por razões de prudência.»' });
  R('p-vitor', 'd-contrato', 'documented_in', { start: '2016-12-21', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-contrato', loc: 'p. 42, assinaturas', lv: '2025-09-30',
    ex: '«Pela concessionária, Vítor Samaniego Rocha, na qualidade de Presidente do Conselho de Administração da Meridiano Infraestruturas, S.A.»' });
  R('c-meridiano', 'g-municipio', 'contract_with', { start: '2016-12-21', startPrec: 'day', end: '2046-12-21', endPrec: 'day',
    status: 'confirmed', conf: 5, why: 'Contrato assinado por ambas as partes, disponível na plataforma de contratos públicos.',
    src: 'd-contrato', loc: 'cl. 1.ª e 9.ª', lv: '2025-09-30', amount: 412000000, currency: 'EUR',
    ex: '«O concessionário obriga-se a projectar, construir, explorar e manter a A-31, pelo prazo de 30 anos, mediante o preço global de 412 000 000 EUR.»' });
  R('g-municipio', 'e-concurso', 'participated_in', { start: '2015-02-16', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-relatorio-tdc', loc: '§2.1', lv: '2025-09-30',
    ex: '«O concurso foi lançado por aviso publicado em 16 de Fevereiro de 2015.»' });
  R('c-meridiano', 'e-concurso', 'tendered_for', { start: '2015-05-04', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'd-relatorio-tdc', loc: '§2.3', lv: '2025-09-30',
    ex: '«Apresentaram-se três concorrentes, entre os quais a Meridiano Infraestruturas, S.A.»' });
  R('c-meridiano', 'e-adjudicacao', 'participated_in', { start: '2015-09-09', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-acta-2015', loc: 'p. 4', lv: '2025-09-30',
    ex: '«Deliberado adjudicar a concessão à Meridiano Infraestruturas, S.A., com 4 votos a favor e 3 abstenções.»' });
  R('c-meridiano', 'd-adenda1', 'documented_in', { start: '2018-07-04', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-adenda1', loc: 'assinaturas, p. 22', lv: '2025-09-30',
    ex: '«Adenda n.º 1 ao contrato de concessão, celebrada entre o Município e a Meridiano Infraestruturas, S.A.»' });
  R('p-lurdes', 'd-adenda2', 'documented_in', { start: '2020-10-15', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-adenda2', loc: 'assinaturas, p. 31', lv: '2025-09-30',
    ex: '«Pela Câmara Municipal, a Presidente, Dr.ª Lurdes Antunes.»' });
  R('c-sottomayor', 'p-amelia', 'held_position', { start: '1998-10-01', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-parecer', loc: 'p. 1, nota de autoria', lv: '2025-09-30',
    ex: '«Parecer elaborado pela sócia fundadora da Sottomayor & Vilar, Dr.ª Amélia Sottomayor Vilar.»' });
  R('c-sottomayor', 'c-aldevaran', 'advised_by', { start: '2014-01-01', startPrec: 'year', status: 'confirmed', conf: 4,
    src: 'd-parecer', loc: 'p. 2', lv: '2025-09-30',
    ex: '«A Sociedade presta assessoria jurídica continuada ao Grupo Aldevaran desde 2014.»' });
  R('p-amelia', 'd-parecer', 'authored', { start: '2018-06-20', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-parecer', loc: 'p. 1', lv: '2025-09-30', ex: '«Autora: Amélia Sottomayor Vilar.»' });
  R('p-amelia', 'c-aldevaran', 'advised_by', { start: '2014-01-01', startPrec: 'year', status: 'probable', conf: 3,
    why: 'Relação individual inferida da assessoria da sociedade ao grupo; não há contrato pessoal obtido.',
    src: 'd-parecer', loc: 'p. 2', lv: '2024-11-02',
    ex: '«A sócia subscreve os pareceres emitidos para o Grupo Aldevaran.»' });
  R('p-amelia', 'g-direcao', 'participated_in', { start: '2014-03-01', startPrec: 'month', end: '2014-12-31', endPrec: 'year',
    status: 'confirmed', conf: 3, why: 'Participação num grupo de trabalho consta de lista de composição; não implica relação contratual.',
    src: 'd-investigacao', loc: 'artigo 4, §2', lv: '2022-01-10',
    ex: '«A advogada integrou, em 2014, o grupo de trabalho que preparou o novo regime de licenciamento.»' });
  R('p-marta', 'c-prazos', 'held_position', { start: '2014-01-01', startPrec: 'year', status: 'confirmed', conf: 4,
    src: 'd-pgr', loc: 'anexo II', lv: '2024-06-30', ex: '«Sócia responsável: Marta Zuzarte.»' });
  R('p-marta', 'c-aldevaran', 'audited_by', { start: '2018-01-01', startPrec: 'year', end: '2022-12-31', endPrec: 'year',
    status: 'confirmed', conf: 4, src: 'd-pgr', loc: 'anexo II', lv: '2024-06-30',
    ex: '«A revisão legal de contas do grupo foi assegurada pela Prazos & Cia — SROC entre 2018 e 2022, com rotação do sócio responsável em 2022.»' });
  R('c-prazos', 'c-aldevaran', 'audited_by', { start: '2018-01-01', startPrec: 'year', end: '2022-12-31', endPrec: 'year',
    status: 'confirmed', conf: 4, src: 'd-relatorio-tdc', loc: '§4.2', lv: '2024-06-30',
    ex: '«A sociedade foi auditada pela Prazos & Cia — SROC.»' });
  R('p-helena', 'o-assoc', 'member_of', { start: '2019-02-01', startPrec: 'month', status: 'confirmed', conf: 3,
    src: 'e-conferencia', loc: 'programa, p. 2', lv: '2024-09-12',
    ex: '«Conselho consultivo: Helena Vasconcelos Braga (Aldevaran Capital Partners).»' });
  R('c-aldevaran', 'o-assoc', 'member_of', { start: '2018-01-01', startPrec: 'year', status: 'probable', conf: 3,
    why: 'Associado consta em lista de associados de 2023; data de adesão não confirmada.',
    src: 'e-conferencia', loc: 'lista de associados, p. 18', lv: '2024-09-12',
    ex: '«Associados: ... Grupo Aldevaran, SGPS.»' });
  R('p-helena', 'e-conferencia', 'participated_in', { start: '2019-05-23', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'e-conferencia', loc: 'programa, p. 3', lv: '2024-09-12',
    ex: '«14h30 — Painel "Financiar a transição": Helena Vasconcelos Braga.»' });
  R('p-vitor', 'e-conferencia', 'participated_in', { start: '2019-05-23', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'e-conferencia', loc: 'programa, p. 1', lv: '2024-09-12',
    ex: '«Sessão de abertura: Vítor Samaniego Rocha.»' });
  R('p-iris', 'g-municipio', 'documented_meeting', { start: '2022-03-14', startPrec: 'day', status: 'confirmed', conf: 4,
    why: 'Reunião registada em acta oficial; a acta não indica decisões tomadas.',
    src: 'd-acta-2022', loc: 'p. 2', lv: '2025-01-15',
    ex: '«Reunião com representantes do Grupo Aldevaran e da Cascata Digital; presente Íris Samaniego Vasconcelos.»' });
  R('c-cascata', 'g-municipio', 'documented_meeting', { start: '2022-03-14', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'd-acta-2022', loc: 'p. 2', lv: '2025-01-15',
    ex: '«A Cascata Digital apresentou a plataforma de gestão urbanística.»' });
  R('p-iris', 'd-acta-2022', 'documented_in', { start: '2022-03-14', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'd-acta-2022', loc: 'p. 2', lv: '2025-01-15', ex: '«...presente Íris Samaniego Vasconcelos.»' });
  R('p-helena', 'p-vitor', 'documented_meeting', { start: '2019-05-23', startPrec: 'day', status: 'probable', conf: 3,
    why: 'Ambos constam do programa do mesmo evento; o programa não prova interacção directa.',
    src: 'e-conferencia', loc: 'programa, pp. 1–3', lv: '2024-09-12',
    ex: '«Sessão de abertura: Vítor Samaniego Rocha. Painel: Helena Vasconcelos Braga.»' });

  /* ---------- Fluxos financeiros ---------- */
  R('c-banco', 'c-meridiano', 'financed', { start: '2020-11-30', startPrec: 'day', end: '2032-11-30', endPrec: 'day',
    status: 'confirmed', conf: 5, src: 'd-contrato-fin', loc: 'cl. 2.ª, p. 5', lv: '2025-09-30', amount: 180000000, currency: 'EUR',
    ex: '«O Banco, na qualidade de banco agente, concede ao mutuário um financiamento no montante de 180 000 000 EUR.»' });
  R('p-tomas', 'd-contrato-fin', 'documented_in', { start: '2020-11-30', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-contrato-fin', loc: 'p. 96, assinaturas', lv: '2025-09-30',
    ex: '«Pelo mutuário, Tomás Queirós Falcão, Director Financeiro.»' });
  R('g-municipio', 'c-meridiano', 'paid_amount_to', { start: '2021-01-01', startPrec: 'year', end: '2024-12-31', endPrec: 'year',
    status: 'probable', conf: 3, why: 'Pagamentos de disponibilidade registados em execução orçamental; valores anuais não individualizados por documento primário obtido.',
    src: 'd-relatorio-tdc', loc: '§5.3', lv: '2024-12-31', amount: 38000000, currency: 'EUR',
    ex: '«Os encargos anuais com o contrato de concessão ascenderam, em média, a 9,5 M€.»' });
  R('c-aldevaran', 'f-luz', 'donated_to', { start: '2020-06-30', startPrec: 'month', status: 'confirmed', conf: 5,
    src: 't-donativo', loc: 'recibo n.º 47/2020', lv: '2024-02-20', amount: 600000, currency: 'EUR',
    ex: '«Recebemos do Grupo Aldevaran, SGPS a importância de 600 000 EUR, a título de donativo para obras sociais.»' });
  R('f-luz', 'e-donativo', 'participated_in', { start: '2020-06-01', startPrec: 'month', status: 'confirmed', conf: 4,
    src: 't-donativo', loc: 'recibo n.º 47/2020', lv: '2024-02-20',
    ex: '«Donativo destinado ao projecto de reabilitação do centro paroquial.»' });
  R('c-meridiano', 'c-argos', 'contract_with', { start: '2014-03-01', startPrec: 'month', end: '2016-12-31', endPrec: 'year',
    status: 'contradicted', conf: 1, why: 'A existência do contrato é documentada; o montante e a finalidade descritos na acusação foram considerados não provados na sentença de 2025.',
    src: 'd-sentenca', loc: '§§ 214–231', lv: '2025-06-27', amount: 1300000, currency: 'EUR',
    ex: '«Considera-se provada a celebração de contrato de prestação de serviços; não se provou que os pagamentos tenham sido canalizados para o arguido Joaquim Bandeira.»' });
  R('c-meridiano', 'c-argos', 'paid_amount_to', { start: '2014-03-01', startPrec: 'month', end: '2016-12-31', endPrec: 'year',
    status: 'contradicted', conf: 1, why: 'Montantes descritos na acusação não provados; apenas a facturação contabilística é documentada.',
    src: 't-argos', loc: 'contabilidade da Argos, extracto 2014–2016', lv: '2025-06-27', amount: 1300000, currency: 'EUR',
    ex: '«Facturação emitida à Meridiano entre 2014 e 2016: 1 300 000 EUR.»' });
  R('p-fausto', 'c-argos', 'held_position', { start: '2012-07-19', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-acusacao', loc: '§8', lv: '2025-06-27', ex: '«O arguido Fausto Melicias é sócio-gerente da Argos Partners Consultoria, Lda.»' });
  R('p-fausto', 'c-meridiano', 'supplied', { start: '2014-03-01', startPrec: 'month', end: '2016-12-31', endPrec: 'year',
    status: 'confirmed', conf: 3, why: 'Prestação de serviços provada; a natureza exacta dos serviços é descrita de forma genérica.',
    src: 'd-sentenca', loc: '§ 218', lv: '2025-06-27',
    ex: '«A Argos prestou serviços de apoio à estruturação de candidaturas a financiamentos.»' });
  R('p-fausto', 'p-joaquim', 'documented_meeting', { start: '2015-04-10', startPrec: 'day', status: 'alleged', conf: 2,
    why: 'Encontro descrito apenas na acusação; a sentença considerou-o não provado.',
    src: 'd-acusacao', loc: '§ 57', lv: '2025-06-27',
    ex: '«O arguido encontrou-se com o Director Municipal de Obras em Abril de 2015, conforme referido por uma testemunha.»' });
  R('p-joaquim', 'c-argos', 'received_financing_from', { start: '2015-06-01', startPrec: 'month', status: 'alleged', conf: 2,
    why: 'A acusação afirma pagamentos de 300 mil euros; a sentença de 2025 absolveu o gestor da Argos e não provou os pagamentos.',
    src: 'd-acusacao', loc: '§§ 61–66', lv: '2025-06-27', amount: 300000, currency: 'EUR',
    ex: '«Entre Junho de 2015 e Setembro de 2016 terão sido entregues cerca de 300 000 EUR ao arguido.»' });
  R('c-cascata', 'g-municipio', 'contract_with', { start: '2022-04-01', startPrec: 'month', status: 'confirmed', conf: 5,
    src: 't-contrato-cascata', loc: 'cl. 1.ª', lv: '2025-09-30', amount: 1200000, currency: 'EUR',
    ex: '«Contrato-quadro para fornecimento e manutenção de plataforma de gestão urbanística, pelo valor de 1 200 000 EUR.»' });
  R('c-meridiano', 'c-solaris', 'contract_with', { start: '2021-07-01', startPrec: 'month', status: 'confirmed', conf: 4,
    src: 't-venda-participacao', loc: 'acta, ponto 4', lv: '2025-09-30', amount: 40000000, currency: 'kWh',
    ex: '«Contrato de aquisição de energia: 40 GWh/ano, prazo de 10 anos.»' });
  R('c-banco', 'c-aldevaran', 'supplied', { start: '2015-01-01', startPrec: 'year', status: 'probable', conf: 3,
    why: 'Serviços de tesouraria referidos em nota de contas; contrato não obtido.',
    src: 'd-relatorio-tdc', loc: '§4.4', lv: '2024-06-30',
    ex: '«O grupo recorre a uma única instituição para serviços de tesouraria desde 2015.»' });
  R('c-solaris', 'g-are', 'regulated_by', { start: '2016-03-14', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'd-pgr', loc: '§1.2', lv: '2024-06-30', ex: '«A Solaris exerce actividade sujeita a licenciamento pela ARE.»' });
  R('c-lusovenus', 'g-are', 'sanctioned_by', { start: '2019-11-20', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-pgr', loc: 'anexo IV', lv: '2024-06-30', amount: 1200000, currency: 'EUR',
    ex: '«Coima de 1 200 000 EUR aplicada à Lusovenus Energia, S.A. por práticas de mercado restritivas.»' });
  R('c-lusovenus', 'c-argos', 'contract_with', { start: '2017-02-01', startPrec: 'month', status: 'probable', conf: 3,
    why: 'Contrato referido em nota de imprensa da própria empresa; documento não obtido.', src: 'd-investigacao', loc: 'artigo 5, §3',
    lv: '2022-01-10', ex: '«A Lusovenus confirmou ter contratado a Argos em 2017.»' });
  R('p-goncalo', 'g-are', 'held_position', { start: '2018-06-01', startPrec: 'month', status: 'confirmed', conf: 4,
    src: 'd-pgr', loc: 'folha de rosto', lv: '2024-06-30', ex: '«Direcção de Licenciamento: Gonçalo Sá Pereira.»' });

  /* ---------- Judicial ---------- */
  R('j-mp', 'c-meridiano', 'investigated_by', { start: '2019-05-01', startPrec: 'month', status: 'confirmed', conf: 5,
    src: 'd-acusacao', loc: 'p. 1', lv: '2025-06-27', ex: '«Inquérito n.º 214/19.5T9VFR — arguidos e sociedades identificadas.»' });
  R('j-mp', 'p-joaquim', 'charged_by', { start: '2022-02-18', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-acusacao', loc: 'p. 3', lv: '2025-06-27', ex: '«Acusa-se Joaquim Bandeira pela prática de um crime de tráfico de influência.»' });
  R('j-mp', 'p-fausto', 'charged_by', { start: '2022-02-18', startPrec: 'day', status: 'contradicted', conf: 1,
    why: 'A acusação existiu, mas o tribunal absolveu o arguido em 2025 — o estado da relação reflecte o desfecho.',
    src: 'd-sentenca', loc: 'dispositivo, p. 305', lv: '2025-06-27',
    ex: '«Absolvo o arguido Fausto Melicias da acusação que lhe foi deduzida.»' });
  R('j-tribunal', 'd-sentenca', 'authored', { start: '2025-06-27', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-sentenca', loc: 'p. 312', lv: '2025-06-27', ex: '«Tribunal Judicial da Comarca do Vale do Tejo, Processo n.º 214/19.5T9VFR.»' });
  R('j-tribunal', 'p-joaquim', 'ruled_on', { start: '2025-06-27', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-sentenca', loc: 'dispositivo, p. 306', lv: '2025-06-27',
    ex: '«Condeno o arguido Joaquim Bandeira na pena de 4 anos de prisão, suspensa na execução.»' });
  R('j-tribunal', 'e-julgamento', 'participated_in', { start: '2023-11-06', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-sentenca', loc: 'p. 2', lv: '2025-06-27', ex: '«Audiência de julgamento iniciada em 6 de Novembro de 2023.»' });
  R('p-joaquim', 'e-julgamento', 'participated_in', { start: '2023-11-06', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-sentenca', loc: 'p. 2', lv: '2025-06-27', ex: '«Arguidos presentes: Joaquim Bandeira e Fausto Melicias.»' });
  R('p-fausto', 'e-julgamento', 'participated_in', { start: '2023-11-06', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-sentenca', loc: 'p. 2', lv: '2025-06-27', ex: '«Arguidos presentes: Joaquim Bandeira e Fausto Melicias.»' });
  R('j-tcontas', 'd-relatorio-tdc', 'authored', { start: '2021-04-30', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-relatorio-tdc', loc: 'folha de rosto', lv: '2024-11-30', ex: '«Relatório n.º 12/2021 — Secção Regional do Vale do Tejo.»' });
  R('j-tcontas', 'g-municipio', 'ruled_on', { start: '2021-04-30', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-relatorio-tdc', loc: '§7.1', lv: '2024-11-30',
    ex: '«O procedimento de formação do contrato observou, em geral, as normas aplicáveis, com reservas quanto à fundamentação do preço base.»' });
  R('j-tcontas', 'c-meridiano', 'audited_by', { start: '2020-01-01', startPrec: 'year', end: '2021-04-30', endPrec: 'day',
    status: 'confirmed', conf: 4, src: 'd-relatorio-tdc', loc: '§1.3', lv: '2024-11-30',
    ex: '«A auditoria incidiu sobre o contrato de concessão e a concessionária Meridiano Infraestruturas, S.A.»' });
  R('c-meridiano', 'e-busca', 'participated_in', { start: '2021-02-11', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'd-acusacao', loc: '§3', lv: '2025-06-27', ex: '«Foram realizadas buscas nas instalações da concessionária.»' });
  R('g-municipio', 'e-busca', 'participated_in', { start: '2021-02-11', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'd-acusacao', loc: '§3', lv: '2025-06-27', ex: '«...bem como nos serviços municipais.»' });
  R('g-are', 'e-suspensao', 'participated_in', { start: '2023-04-12', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'd-pgr', loc: '§2.4', lv: '2024-06-30', ex: '«A ARE suspendeu a aprovação de tarifas durante o período de auditoria.»' });
  R('c-meridiano', 'e-suspensao', 'participated_in', { start: '2023-04-12', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'd-pgr', loc: '§2.4', lv: '2024-06-30', ex: '«A suspensão afectou a concessionária Meridiano.»' });

  /* ---------- Fundações, igreja, media, cívico ---------- */
  R('c-aldevaran', 'f-aldevaran', 'appointed', { start: '2013-06-05', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-certidao', loc: 'p. 12, nota 4', lv: '2025-09-30',
    ex: '«A Fundação Aldevaran para a Ciência foi instituída pelo Grupo Aldevaran, que designa a maioria dos membros do conselho de administração.»' });
  R('p-alvaro', 'f-aldevaran', 'held_position', { start: '2019-01-01', startPrec: 'year', status: 'confirmed', conf: 4,
    src: 'd-investigacao', loc: 'artigo 3, §4', lv: '2022-01-10',
    ex: '«O conselho consultivo da fundação integra o bispo D. Álvaro Cintra desde 2019.»' });
  R('p-alvaro', 'f-luz', 'held_position', { start: '2011-09-01', startPrec: 'month', status: 'confirmed', conf: 5,
    src: 't-donativo', loc: 'recibo, assinatura', lv: '2024-02-20',
    ex: '«Pelo conselho de administração da Fundação, D. Álvaro Cintra, presidente.»' });
  R('r-diocese', 'f-luz', 'appointed', { start: '1952-05-15', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 't-donativo', loc: 'estatutos, art. 1.º', lv: '2024-02-20',
    ex: '«A Fundação é instituída pela Diocese de São Bento do Sul, que designa o presidente do conselho de administração.»' });
  R('p-alvaro', 'r-diocese', 'held_position', { start: '2011-09-01', startPrec: 'month', status: 'confirmed', conf: 5,
    src: 'd-investigacao', loc: 'artigo 3, §1', lv: '2022-01-10',
    ex: '«D. Álvaro Cintra é bispo da Diocese de São Bento do Sul desde 2011.»' });
  R('f-luz', 'c-argos', 'litigation_with', { start: '2013-05-01', startPrec: 'month', status: 'unverified', conf: 1,
    why: 'A investigação refere uma cedência de imóvel; a escritura não foi localizada e a fundação nega.',
    src: 'd-investigacao', loc: 'artigo 3, §7', lv: '2022-01-10',
    ex: '«Segundo três fontes, a fundação terá cedido um imóvel à Argos em 2013; não foi possível obter a escritura.»' });
  R('p-ines', 'o-novareta', 'held_position', { start: '2016-01-01', startPrec: 'year', status: 'confirmed', conf: 5,
    src: 'd-investigacao', loc: 'assinatura do artigo', lv: '2022-01-10', ex: '«Por Inês Torre, Nova Rota Media.»' });
  R('p-ines', 'd-investigacao', 'authored', { start: '2021-10-11', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-investigacao', loc: 'cabeçalho', lv: '2022-01-10', ex: '«Investigação de Inês Torre.»' });
  R('o-novareta', 'd-investigacao', 'authored', { start: '2021-10-11', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-investigacao', loc: 'cabeçalho', lv: '2022-01-10', ex: '«Publicado por Nova Rota Media.»' });
  R('o-observatorio', 'g-municipio', 'lobbied', { start: '2020-06-01', startPrec: 'month', status: 'confirmed', conf: 4,
    src: 'd-investigacao', loc: 'artigo 6, §2', lv: '2022-01-10',
    ex: '«O observatório requereu a inquirição da presidente da câmara e a abertura de inquérito.»' });
  R('o-observatorio', 'c-meridiano', 'mentioned_in', { start: '2020-09-01', startPrec: 'month', status: 'probable', conf: 2,
    why: 'O observatório publicou alertas sobre a concessão, mas não há relação directa documentada com a empresa.',
    src: 'd-investigacao', loc: 'artigo 6, §4', lv: '2022-01-10',
    ex: '«O alerta n.º 41/2020 identifica a concessão da A-31 como caso de risco.»' });

  /* ---------- Vínculos documentais (prova de leitura) ---------- */
  R('c-meridiano', 'd-certidao', 'documented_in', { status: 'confirmed', conf: 5, src: 'd-certidao', loc: 'capa',
    lv: '2025-09-30', ex: '«Certidão permanente n.º 2016/44812 — Meridiano Infraestruturas, S.A.»' });
  R('c-atlantico7', 'd-registo-be', 'documented_in', { status: 'confirmed', conf: 5, src: 'd-registo-be', loc: 'p. 1',
    lv: '2025-05-20', ex: '«Registre des bénéficiaires effectifs — Atlantico 7 S.à r.l.»' });
  R('c-acp', 'd-prospecto', 'documented_in', { status: 'confirmed', conf: 5, src: 'd-prospecto', loc: 'p. 1',
    lv: '2025-06-30', ex: '«Prospecto — Fundo Aurora II, FCR.»' });
  R('c-aurora2', 'd-prospecto', 'documented_in', { status: 'confirmed', conf: 5, src: 'd-prospecto', loc: 'p. 1',
    lv: '2025-06-30', ex: '«Prospecto — Fundo Aurora II, FCR.»' });
  R('p-vitor', 'd-acusacao', 'mentioned_in', { start: '2022-02-18', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-acusacao', loc: '§§ 88–95', lv: '2025-06-27',
    ex: '«...considera-se Vítor Samaniego Rocha como beneficiário último do esquema descrito.»' });
  R('p-helena', 'd-acusacao', 'mentioned_in', { start: '2022-02-18', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'd-acusacao', loc: 'nota 34', lv: '2025-06-27',
    ex: '«A administradora Helena Vasconcelos Braga é referida a propósito da assinatura do prospecto, sem imputação de factos.»' });
  R('p-nadia', 'd-investigacao', 'mentioned_in', { start: '2021-10-11', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'd-investigacao', loc: 'artigo 2, §3', lv: '2022-01-10',
    ex: '«A beneficiária registada da Atlântico 7 é Nadia Krasniqi, administradora de 27 sociedades.»' });
  R('p-iris', 'd-contrato', 'mentioned_in', { start: '2016-12-21', startPrec: 'day', status: 'confirmed', conf: 3,
    why: 'Aparece apenas como administradora na lista de órgãos sociais em anexo ao contrato; não assina.',
    src: 'd-contrato', loc: 'anexo III, p. 118', lv: '2025-09-30',
    ex: '«Anexo III — órgãos sociais da concessionária: ... Íris Samaniego Vasconcelos, administradora.»' });
  R('p-lurdes', 'd-adenda1', 'mentioned_in', { start: '2018-07-04', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'd-adenda1', loc: 'preâmbulo', lv: '2025-09-30', ex: '«...representada pela Presidente da Câmara Municipal.»' });
  R('p-joaquim', 'd-acta-2015', 'documented_in', { start: '2015-09-09', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-acta-2015', loc: 'p. 3', lv: '2025-09-30', ex: '«...Director Municipal de Obras (membro da comissão de avaliação).»' });
  R('f-luz', 'd-investigacao', 'mentioned_in', { start: '2021-10-11', startPrec: 'day', status: 'confirmed', conf: 4,
    src: 'd-investigacao', loc: 'artigo 3', lv: '2022-01-10', ex: '«A Fundação N. S. da Luz recebeu 600 mil euros do grupo em 2020.»' });
  R('g-are', 'd-pgr', 'authored', { start: '2023-09-18', startPrec: 'day', status: 'confirmed', conf: 5,
    src: 'd-pgr', loc: 'folha de rosto', lv: '2024-06-30', ex: '«Relatório de auditoria regulatória — Meridiano Infraestruturas, S.A.»' });

  /* ---------- Ligações explicitamente não verificadas ---------- */
  R('p-iris', 'p-joaquim', 'documented_meeting', { start: '2021-01-15', startPrec: 'month', status: 'unverified', conf: 1,
    why: 'Referida apenas por "fonte próxima do processo" numa notícia; nenhum registo, acta ou depoimento localizado. Não deve ser lida como facto.',
    src: 'd-investigacao', loc: 'artigo 6, §6', lv: '2022-01-10',
    ex: '«Segundo uma fonte, terá havido encontros não registados entre a administradora e o director municipal.»' });
  R('c-atlantico7', 'c-aldevaran', 'shareholder_of', { start: null, status: 'unverified', conf: 1,
    why: 'Hipótese sugerida na investigação jornalística (participação cruzada), sem qualquer documento societário que a sustente. Mantida no grafo por transparência, marcada como não verificada.',
    src: 'd-investigacao', loc: 'artigo 2, §9', lv: '2022-01-10',
    ex: '«Não foi possível apurar se a Atlântico 7 detém, directa ou indirectamente, capital do próprio grupo.»' });
  R('p-samuel', 'c-aldevaran', 'advised_by', { status: 'unverified', conf: 1,
    why: 'Apenas coincidência de apelido e de jurisdição; nenhuma fonte documental. Mantida para demonstrar que o grafo não esconde hipóteses — mas assinalada.',
    src: null, loc: null, lv: null, ex: null });
})(typeof window !== 'undefined' ? window : globalThis);
