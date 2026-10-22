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

25. **2026-10-21 · TOTP implementado no repositório, não importado.**
    ~60 linhas com `node:crypto` contra quatro bibliotecas avaliadas (`otplib`, `speakeasy`,
    `@otplib/preset-default`): duas desactualizadas, e a validação exigível é a mesma — os vectores
    do RFC 6238. Foi essa a régua: a implementação passa-os a todos, a cada execução.
    Motivo: cada dependência é superfície; para um algoritmo que se valida com vectores públicos,
    a dependência não compensa. O que compensa é o teste.

26. **2026-10-21 · Uma palavra-passe deixou de bastar: a sessão nasce depois do segundo factor.**
    `POST /api/auth/login` devolve `{mfaRequired, challenge}`, não um cookie. MFA é opcional por
    conta (quem liga é que decide), obrigatório em espírito para administradores — ainda não imposto,
    e isso está declarado como lacuna.
    Motivo: um ecrã de segundo passo que emite sessão primeiro é decoração; o teste confirma
    `/api/auth/me` vazio entre os dois passos.

27. **2026-10-21 · Escrita com `fsync` + `sha256` + cópia da última gravação boa; recuperação sempre declarada.**
    Antes: `rename` atómico mas sem `fsync` (bytes podiam faltar) e JSON truncado recomeçava a base
    **em silêncio**. Agora há `db.json.sha256`, `db.json.ultima-copia.json`, até 3 cópias datadas, e
    `/ready` diz de onde se recuperou. Sem cópia válida: base vazia **declarada**, ficheiro danificado
    preservado.
    Motivo: perder dados é grave; perdê-los sem o dizer é imperdoável num sistema que sustenta
    alegações sobre pessoas.

28. **2026-10-21 · Duas instâncias na mesma pasta: a segunda entra em só-de-leitura.**
    `db.lock` com pid vivo → 503 em `/ready`, 503 `retryable` nas escritas, leituras intactas. A
    gravação falhada desfaz a mutação em memória a partir da última gravação boa.
    Motivo: um deploy do Render pode sobrepor instâncias por alguns segundos; duas escritas cegas
    corrompem o ficheiro. Recusar escrever é preferível a escrever mal, e o cliente sabe que pode
    tentar de novo.

29. **2026-10-21 · OCR com `tesseract.js` (WASM), dados locais descarregados no build com integridade npm.**
    Alternativas rejeitadas com motivo em `docs/DEPENDENCIAS.md` §2: `node-tesseract-ocr` (2021 +
    vulnerabilidade + `shell`), `mupdf` (AGPL), `@napi-rs/canvas` (segfault comprovado neste
    ambiente). Em runtime **não há rede**: os dados de língua estão em disco, com `sha256` no
    manifesto; sem eles o OCR está indisponível e diz porquê.
    Motivo: sem rede em runtime, o OCR não pode ser um canal por onde entram modelos de terceiros.

30. **2026-10-21 · OCR é pista, não transcrição — e nunca cria provas.**
    Confiança por página; abaixo de 55/100 a página é assinalada e o resultado declara-se «pista».
    Tudo entra com `method: 'ocr'` e revisão humana obrigatória; digitalizações com CCITT/JBIG2/JPX
    são declaradas não suportadas em vez de adivinhadas.
    Motivo: um OCR que erra um nome próprio numa prova sobre uma pessoa real é um dano, não um bug.

31. **2026-10-21 · Dependências auditadas com evidência, não com opinião.**
    `tools/audit-deps.mjs` consulta o registo npm e o OSV, verifica licenças proibidas e **falha**
    (código 1) perante vulnerabilidade alta/crítica. `docs/DEPENDENCIAS.md` regista, para cada
    candidato, versão/licença/tamanho/descarregamentos/vulnerabilidades e a decisão com motivo —
    incluindo as rejeições.
    Motivo: adotar uma biblioteca é uma decisão de segurança; tem de ficar escrita e reproduzível.

32. **2026-10-21 · O conjunto fictício foi removido; a aplicação passa a abrir com dados reais.**
    Os sete ficheiros do «Caso Meridiano» (69 entidades, 126 relações inventadas) foram apagados e
    substituídos por `data/real/10-epstein.js`, gerado por `tools/import-epstein.mjs` a partir de
    decisões judiciais reais.
    Motivo: uma ferramenta que sustenta alegações sobre pessoas não deve abrir com um mundo
    inventado — o risco de alguém confundir o exemplo com um caso real não compensa a conveniência
    da demonstração. O que era útil do conjunto fictício (estados de verificação, contraditórios,
    alegações) continua definido no esquema e testado; simplesmente não há dados inventados.

33. **2026-10-21 · Importação real com três condições de entrada: texto do PDF, hash e cross-check.**
    Cada documento tem de (a) ser descarregado pelo caminho normal da aplicação (`fetchDocument`,
    com guarda SSRF), (b) conter literalmente «Jeffrey Epstein» no texto extraído — não no título
    nem no excerto do motor de busca, que produzia homónimos — e (c) ter o SHA-1 publicado pelo
    CourtListener igual ao SHA-1 do ficheiro descarregado. Falhar qualquer uma exclui o documento,
    com o motivo registado em `PROVENIENCIA.json`.
    Motivo: «é do tribunal» não é prova de que o ficheiro é o que diz ser; e um homónimo no título
    criaria relações falsas entre pessoas diferentes.

34. **2026-10-21 · Relações reais são processuais, não imputações.**
    O grafo liga partes ao processo (`litigation_with`, `documented_in`), tribunal e documento
    (`ruled_on`) e a menção literal do nome (`mentioned_in`), sempre com excerto e com a frase «é
    um facto processual; não é uma conclusão sobre conduta» escrita na própria aresta.
    Motivo: a regra do projecto — uma linha não é prova — tem de estar no dado, não na esperança de
    que quem lê se lembre dela.

35. **2026-10-21 · Registo de fontes com nota provisória em vez de nota inventada.**
    Sem amostra verificada, sem transparência observada e sem independência avaliada, `rateSource`
    devolve `score: null`, `band: null` e «Classificação provisória — evidência insuficiente», com a
    lista do que falta. O risco é medido à parte (100 = elevado) e **limita** a nota global.
    Motivo: uma média de dois critérios apresentada como «B» é o mesmo erro que inventar um dado,
    só que mais difícil de detectar.

36. **2026-10-21 · Aprovar exige classificação não provisória e motivo escrito.**
    `POST /api/sources/:id/decision` devolve 409 sem classificação ou com classificação provisória;
    qualquer decisão exige motivo com pelo menos 10 caracteres e fica em auditoria.
    Motivo: o caminho mais curto para um catálogo grande é aprovar tudo. O código tem de tornar esse
    caminho impossível, não apenas desaconselhado.

37. **2026-10-21 · Descoberta só a partir de catálogos públicos documentados, com limites respeitados.**
    O primeiro adaptador usa a API REST v4 do CourtListener (sem chave). Em 429 espera o
    `Retry-After` (máximo 3 s), tenta uma vez e, se continuar limitado, falha com o motivo — nunca
    devolve resultados parciais como se fossem completos. Verificações: 6/hora por fonte; descoberta:
    6/hora por utilizador.
    Motivo: um motor de expansão que se comporta como um rastreador abusivo destrói a possibilidade
    de usar as fontes que encontra.

38. **2026-10-22 · Chaves de IA: do utilizador primeiro, do operador depois, sem chave por último.**
    Ordem: cofre da conta → variável do operador (`AI_KEY_*`) → fornecedor público sem chave.
    Uma chave de operador começada por `SUBSTITUIR`/`<`/`COLA` conta como ausente, para se poderem
    criar os nomes no Render antes de ter os valores. O valor nunca sai do servidor: a API devolve
    apenas `estado` e `env`, e há um teste que verifica que o corpo da resposta não contém a chave.
    Motivo: a instância tem de ter IA sem obrigar cada pessoa a criar contas em cinco sítios, mas
    sem transformar o painel numa lista de segredos.

39. **2026-10-22 · Se a chave do operador falhar, cai-se para o sem chave — e diz-se que se caiu.**
    `401`/`403` do fornecedor com chave → uma tentativa no fornecedor sem chave, com
    `fallbackFrom` e um aviso de qualidade na resposta e na utilização registada. `400` não cai
    (é erro do nosso pedido, repetir noutro lado não ajuda).
    Motivo: uma chave colada mal não pode deixar a aplicação sem IA em silêncio, nem pode passar por
    «está tudo bem» — quem lê a execução tem de ver de onde veio a resposta.

40. **2026-10-22 · Fornecedor sem chave: com fila e com o limite do fornecedor respeitado.**
    O serviço público impõe «1 resposta por 30 s por IP». Os pedidos sem chave são serializados e,
    em `429`, espera-se o tempo pedido (máximo 35 s, uma vez). Declara-se o custo real: execuções
    mais lentas, limite partilhado pelo IP do servidor. Para uso sério recomenda-se chave gratuita.
    Motivo: sem isto, um motor de 20 passos falhava com `falha-de-ia` a meio — um erro nosso
    disfarçado de avaria externa.

41. **2026-10-22 · «Lista de modelos pública» não é «gera sem chave».**
    A sonda `tools/keyless-scan.mjs` tem duas etapas: `GET /models` (prova que o catálogo é público)
    e `POST /chat/completions` com `max_tokens:1` (prova que a geração é aberta). Dos 12 candidatos
    com catálogo público, **0** aceitaram gerar sem chave. Há sempre um controlo positivo na lista —
    se o controlo não for detectado, o «0» não vale.
    Motivo: a diferença entre as duas coisas é exactamente onde nasceriam resultados inventados.

42. **2026-10-22 · SSRN: metadados sim (Crossref), texto completo não.**
    A página e o PDF do SSRN devolvem `403` (bloqueio técnico). Não se contorna. A ficha vem do
    Crossref (`10.2139/ssrn.<id>`), é registada como fonte `DISCOVERED` com adaptador
    `ssrn-crossref` e uma nota que diz, por palavras, que o texto completo não foi obtido e que o
    resumo é do autor.
    Motivo: era a única forma de responder «é possível extrair informação do SSRN?» com um sim e um
    não ao mesmo tempo — e ambos verdadeiros.

43. **2026-10-23 · Pesquisa: termos independentes, ordem explicável, alargamento declarado.**
    A consulta deixa de ser uma cadeia única e passa a ser analisada: termos soltos (E entre eles),
    `"frases exactas"`, `-exclusões` e prefixo a partir de 3 letras; acentos e caixa indiferentes
    (dobra 1:1, para o recorte cair exactamente sobre o texto original). Dentro de cada item os
    campos têm pesos, e a ordem é o número de pontos — que a interface pode mostrar.
    Motivo: medido em `tools/bench-antigo.mjs`, a substring encontrava **3/23** consultas com o
    próprio documento no dossiê (**2/19** nas de dois termos). Uma aplicação de investigação onde
    «financiou 2019» devolve zero não é uma aplicação de investigação.

44. **2026-10-23 · Quando nada casa com todos os termos, alarga-se — e diz-se.**
    O alargamento a OU só acontece quando o resultado com E é vazio; a resposta leva
    `widened:true`, os itens levam `parcial:true` e uma frase explica o que se fez. A ordem do
    alargamento usa a raridade do termo: `clamp(1+ln(total/df),1,4)`, para um código que existe
    em 2 documentos valer mais do que uma palavra que existe em 50.
    Motivo: uma lista de ecos apresentada como resposta é pior do que não responder. E a raridade
    resolveu um erro real de ordenação («banca zq7x9» punha o projecto à frente da prova certa).

45. **2026-10-23 · Palavras vazias fora dos termos soltos, dentro das frases.**
    `de`, `a`, `o`, `da`, `para`, `que`… não entram como termos independentes (não distinguem nada
    e fariam casar tudo); dentro de uma `"frase"` continuam a contar, porque aí a ordem é a
    informação. Uma consulta que só tenha palavras vazias é recusada com `400` e motivo.
    Motivo: procurar «de a o» e receber o dossiê inteiro é ruído com aparência de resultado.

46. **2026-10-23 · Grafo também é trabalho do utilizador: relações e entidades entram na pesquisa.**
    Uma relação devolve sempre o par nomeado («A → B») como excerto, mesmo quando o termo casou no
    tipo de relação («Financiou») — quem lê quer saber quem com quem.
    Motivo: um resultado que mostra só «Financiou» não diz nada e ocupa o lugar de um que diz.

47. **2026-10-23 · Escrita coalescente e saúde de escrita visível.**
    `persist()` junta pedidos durante uma escrita em curso; `STORE_WRITE_DEBOUNCE_MS` por omissão
    **0** (20 ms por lote tornou a criação de corpus 2,4× mais lenta sem ganho: 60 escritas → 9 já
    acontece sem espera). `/ready` passa a expor `writeOk`, `failedWrites`, `lastWriteError` e
    `dirRecreations`, e marca `storage.ok:false` quando uma escrita falha. Pasta de dados apagada
    com o processo vivo é recriada, com uma repetição registada em log.
    Motivo: «pronto» tem de significar «grava». Dizer `ok` com todas as escritas a falhar por
    `ENOENT` foi o pior defeito encontrado nesta fase, porque era silencioso.

48. **2026-10-23 · Depois de qualquer patch em `server/api.mjs`, procurar rotas apagadas.**
    `git diff server/api.mjs | grep '^-'` e verificar se alguma linha removida casa com
    `p === '/api/...'` ou `p.match(/^\/api\/...`. Substituições de texto já apagaram 53 linhas
    (incluindo `GET` e `POST /api/sources`) com sintaxe válida e todos os testes de fumo a passar.
    Motivo: um ficheiro de 4 000 linhas com rotas é precisamente onde uma remoção passa despercebida;
    o `node --check` não apanha ausência de código.

49. **2026-10-23 · Diagnóstico de IA público — modo sim, chaves não.**
    `GET /api/ai/estado` é público e devolve `modo`, `fornecedor`, `modelo`,
    número de chaves preenchidas e um aviso quando se está no fornecedor sem chave. Não devolve
    valores, nem a lista de nomes preenchidos, nem sequer quantas faltam.
    Motivo: a pergunta «a instância em produção tem IA?» tinha de se responder sem a palavra-passe
    do dono e sem abrir o painel do Render — e sem transformar um endpoint público num inventário
    de infraestrutura. Há teste que verifica que o corpo não contém chaves.

    Segunda metade: `?probe=1` faz **uma** chamada real, com o texto fixo «Responda apenas: ok».
    1 por minuto no servidor e 3 por hora por IP; sem o parâmetro não há chamada externa nenhuma
    (o teste mede o tempo para provar que não houve). Motivo: «configurado» e «a responder» são
    coisas diferentes — e a diferença entre as duas é exactamente onde se mente sem querer.
