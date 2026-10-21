# DECISÕES — registo do que ficou decidido e porquê

Cada linha existe para que a decisão não seja reaberta por esquecimento nem invertida por acidente.
Formato: data · decisão · motivo · o que foi recusado.

## Arquitectura

1. **2026-10-20 · Servidor Node sem dependências de framework.**
   Motivo: o serviço corre no plano gratuito; menos peças é menos superfície de falha e de
   vulnerabilidade. Recusado: Express/Fastify (nenhuma necessidade real) e bases de dados geridas
   (sem disco persistente no plano actual, um Postgres seria mais uma credencial a perder).

2. **2026-10-20 · Persistência em ficheiro JSON com escrita atómica, atrás de uma interface de store.**
   Motivo: substituível por Postgres sem tocar na API. Recusado: SQLite nativo (compilação na
   plataforma) e ORM.

3. **2026-10-20 · Esquema versionado com migrações por passo registadas.**
   Motivo: cada arranque diz exactamente o que mudou na base (`migrations[].changes`); nada é
   migrado em silêncio. Estado actual: **versão 5**.

4. **2026-10-21 · Índice de origem (`originKey`) segue a sindicação até à peça original.**
   Motivo: duas cópias do mesmo comunicado não são duas confirmações. Recusado: contar por URL ou
   por domínio da cópia (dava corroboração falsa). Consequência assumida: por vezes conta **menos**
   origens do que as que existem — o erro seguro.

5. **2026-10-21 · Co-ocorrência nunca vira aresta.**
   Motivo: aparecer no mesmo documento não é relação, direcção nem intenção. Fica como candidato
   marcado «não é relação», só visível a pedido.

6. **2026-10-21 · Homónimos só se fundem com identificador declarado, e a fusão é reversível.**
   Motivo: `Ana Silva` e `A. Silva` podem ser duas pessoas. A ligação exige NIPC/LEI/registo, motivo
   escrito, fica em auditoria e pode ser desfeita com motivo. Recusado: fusão automática por nome.

7. **2026-10-21 · Relações sem prova registada são recusadas pelo servidor (400).**
   Motivo: «uma linha não é prova» deixa de ser uma frase e passa a ser uma regra executável.

8. **2026-10-21 · Períodos abertos contam como abertos.**
   Motivo: «desde 2019» não tem fim; tratá-lo como um ponto excluía relações que podiam estar dentro
   da janela — isso afirmaria um fim que as provas não declaram. Ficam incluídas e contadas em
   `relationsOpenPeriod`.

## Segurança e privacidade

9. **2026-10-21 · Chaves de IA cifradas em repouso (AES-256-GCM) com `APP_SECRET` de ≥24 caracteres.**
   Sem segredo válido, o cofre fica desactivado e a aplicação diz isso (`/ready`), em vez de guardar
   chaves em claro. Recusado: guardar chaves em ficheiro sem cifra.

10. **2026-10-21 · Verificação de acessibilidade a fontes com guardas SSRF e sem contornar barreiras.**
    Motivo: conveniência nunca justifica um proxy aberto nem violar paywalls. Recusado: seguir
    redireccionamentos automaticamente e ignorar resolução DNS.

11. **2026-10-21 · Verificar o acesso NÃO altera o estado de validação de uma prova.**
    Motivo: um 200 diz que a página responde, não que o excerto lá esteja. A sugestão
    `fonte-inacessivel` exige decisão humana.

12. **2026-10-21 · Auditoria registada no servidor, com quem/quando/recurso/acção/motivo.**
    Acesso administrativo a projectos alheios obriga a motivo escrito e fica registado.

## Produto e honestidade

13. **2026-10-21 · Nenhum agente escreve conclusões nem promove hipóteses a facto.**
    Os 13 agentes analisam e propõem; a escrita exige uma pessoa. Verificado por teste: estados e
    arestas não mudam depois de correr agentes locais.

14. **2026-10-21 · «Não disponível» é uma resposta, não uma falha.**
    O relatório de 18 secções e o resumo mostram o que falta com o motivo, em vez de preencher vazios.

15. **2026-10-21 · Resumo descarregável em MD/JSON/CSV/PDF, gerado só a partir dos dados registados.**
    O PDF é escrito sem dependências (texto, Helvetica/WinAnsi). Cada conclusão traz o estado
    atribuído **e** o estado que as provas sustentam, com sinalização quando o primeiro excede o segundo.

16. **2026-10-21 · Memória da investigação separada das provas.**
    Notas, decisões (com motivo obrigatório), glossário, lacunas e correcções. Append-only: editar
    guarda histórico, arquivar exige motivo. Proibição explícita: a memória não muda estados nem
    cria provas.

17. **2026-10-21 · Cópia de segurança e reposição, porque o disco é efémero.**
    A cópia não inclui chaves, palavras-passe nem sessões; a reposição remapeia todos os
    identificadores e ligações. Sem isto, um deploy apaga trabalho sem retorno.

18. **2026-10-21 · Interface, dados e documentação em português (pt-PT); dados de demonstração
    marcados como fictícios.**

## Operação

19. **2026-10-21 · Verificação em produção depois de cada fase**, com conta descartável criada e
    eliminada, e resultados registados em `docs/TEST-RESULTS.txt`. Sem isso, «testado» significa
    apenas «testado aqui».

20. **2026-10-21 · O estado do trabalho vive em `docs/ESTADO-ATUAL.md`, gerado em parte por
    `tools/status.mjs`.**
    Motivo: a memória de quem escreve o código não é um mecanismo de persistência. O que está feito,
    o que falta e o que está bloqueado tem de estar escrito e verificável.

21. **2026-10-21 · Extração de PDF só com mapa de caracteres; sem OCR e sem contornar cifra.**
    Um PDF com fontes subconjuntas codifica *índices de glifo*, não letras: ler os bytes como Latin-1
    produzia texto deslocado («+2E» em vez de «R»). Passou a resolver-se o `/ToUnicode` de cada
    fonte, por página, com entrada nos `XObject` de formulário. Documento cifrado pára com motivo
    escrito; digitalizado declara que não há OCR.
    Motivo: um extrator que adivinha é pior do que um extrator que se declara incompleto.

22. **2026-10-21 · Ligaduras resolvidas e texto comparado com o `pdftotext`.**
    `ﬁ`/`ﬂ` passam a `fi`/`fl` e o resultado é comparado, palavra a palavra, com o poppler nos dois
    PDFs de referência. Se o poppler não estiver instalado, o teste diz isso mesmo.
    Motivo: «parece bem» não é um critério; um texto sem acentos quebra a pesquisa e a citação.

23. **2026-10-21 · Nenhuma prova nasce de uma extração automática.**
    O documento recolhido guarda texto, hash, método e avisos; a interface só **pré-preenche** o
    formulário de prova e a prova só existe depois de um ato humano. Uma fonte inacessível fica
    registada como inacessível (com HTTP e erro), em vez de desaparecer do registo.
    Motivo: o registo de provas é o sítio onde a investigação responde por si; automatizar a entrada
    é automatizar a credibilidade.

24. **2026-10-21 · Exceção de leitura local fechada por omissão e fechada em produção.**
    `VN_ALLOW_LOCAL_FETCH=1` permite ler `127.0.0.1` só para os testes de interface servirem um PDF
    verdadeiro; desliga-se com `NODE_ENV=production` ou com a variável `RENDER` presente, e o estado
    aparece em `/api/meta`. Testada aberta e fechada.
    Motivo: testar extração contra a internet real seria instável e contra conteúdo de terceiros;
    abrir a guarda SSRF sem travão seria pior do que não ter teste.
