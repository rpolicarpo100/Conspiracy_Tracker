# Estado das funcionalidades — Conspiracy Tracker (FASE A)

> Registo de inspecção, 2026-10-23. Cada linha tem **resultado executado**, não intenção.
> Estados possíveis: `IMPLEMENTADO_E_TESTADO`, `IMPLEMENTADO_SEM_TESTE`, `PARCIAL`, `FALHOU`,
> `NAO_IMPLEMENTADO`, `BLOQUEADO`, `NAO_VERIFICADO`.
> «Testes executados» refere-se a suites que correram **nesta sessão** e passaram; o detalhe
> (ficheiro, PASS, duração, código de saída) está em `docs/MATRIZ-TESTES.md`.

Prioridades: **P0** impede o objectivo central (investigação documental fiável) · **P1** quebra
requisito explícito da missão · **P2** qualidade/robustez · **P3** cosmético/arrumação.

---

## A. Identidade, acesso e privacidade

| id | funcionalidade | estado | ficheiros | testes executados | limitação observada | risco | prio | critério de aceitação |
|---|---|---|---|---|---|---|---|---|
| A1 | Registo fechado por omissão; criação de contas por administrador; política de senha (10+, maiúscula, minúscula, dígito) | `IMPLEMENTADO_E_TESTADO` | `server/auth.mjs`, `server/api.mjs`, `tools/create-admin.mjs` | `tests/server.mjs` (26), `tests/auth-privacidade.mjs` (15), `tests/seguranca.mjs` (25) | — | — | P2 | registo público sem `REGISTER_OPEN` responde 403; senha fraca é recusada com os quatro motivos |
| A2 | Sessões com cookie `HttpOnly`+`SameSite=Lax`+`Secure` em https; CSRF obrigatório nas escritas | `IMPLEMENTADO_E_TESTADO` | `server/auth.mjs:65-111`, `server/api.mjs` | `tests/research.mjs` («403 sem cabeçalho CSRF»), `tests/server.mjs` | — | — | P2 | escrita sem `x-csrf-token` → 403; cookie de sessão ilegível por JavaScript |
| A3 | MFA (segundo factor) | `IMPLEMENTADO_E_TESTADO` | `server/mfa.mjs`, `src/ui/account.js` | `tests/mfa-ui.mjs` (6 de interface), `tests/seguranca.mjs` | provas contra produção (`tests/mfa-publico.mjs`) não corridas — `BLOQUEADO` | médio | P2 | activar/validar/desactivar em ciclo completo sem aceitar código errado |
| A4 | Isolamento por conta; eliminação de conta remove projectos e sessões | `IMPLEMENTADO_E_TESTADO` | `server/store.mjs`, `server/api.mjs` | `tests/server.mjs` («conta, projectos e sessões removidos»), `tests/fase3d.mjs` (18) | eliminação real em produção não ensaiada | alto | P1 | conta A não lê nada de B em todas as rotas de projecto (verificado por lista de rotas, não por amostra) |
| A5 | Exportação de dados da própria conta | `IMPLEMENTADO_E_TESTADO` | `server/api.mjs` (`/api/auth/export`) | `tests/auth-privacidade.mjs`, `tests/fase3d.mjs`, `tests/server.mjs` | — | — | P2 | export contém projectos, provas e documentos do titular e nada de terceiros |
| A6 | Retenção/purga com simulação autenticada | `PARCIAL` | `server/scheduler.mjs`, `server/api.mjs` | `tests/retencao.mjs` (10, `dryRun`) | só o **dry-run** está provado; a purga real não foi executada por não haver autorização | alto (dados a mais) | P1 | purga real numa base descartável remove o que declara e regista auditoria; simulação continua a não apagar nada |

---

## B. Armazenamento, integridade e durabilidade

| id | funcionalidade | estado | ficheiros | testes executados | limitação observada | risco | prio | critério de aceitação |
|---|---|---|---|---|---|---|---|---|
| B1 | Armazenamento em ficheiro com escrita atómica, verificações de integridade, 3 cópias de segurança | `IMPLEMENTADO_E_TESTADO` | `server/store.mjs`, `server/pg.mjs` | `tests/seguranca.mjs` («recusa prontidão com base bloqueada» → 503), `/ready` com `checksumVerified:true`, `backups:3` | — | — | P2 | corromper um ficheiro de dados → `/ready` 503 com `integrity` a dizer o motivo |
| B2 | Continuidade após reinício do processo | `IMPLEMENTADO_E_TESTADO` | `server/store.mjs` | `tools/auditoria/fluxo-pergunta-arquivo.mjs` — relatório **idêntico** antes/depois do reinício | só com o **mesmo `dataDir`**; não cobre reinício a meio de uma execução | médio | P1 | execução interrompida por `kill` retoma no passo seguinte, sem repetir documentos já arquivados |
| B3 | Postgres durável entre deploys | `PARCIAL` | `server/pg.mjs`, `server/store.mjs` | `tests/persistencia-pg.mjs` → **SKIP** localmente (sem `DATABASE_URL`); **produção**: `GET /ready` → `postgres+ficheiro`, `durableBetweenDeploys:true`, `writes:1`, `errors:0`, `ssl:verify-full` | local sem base: `durableBetweenDeploys:false`; em produção falta o ensaio criar→reiniciar→reler | médio | P1 | ensaio numa base descartável autorizada: criar → reiniciar → reler tudo, e `/ready` a declarar o que mediu |

---

## C. Recolha de fontes e documentos

| id | funcionalidade | estado | ficheiros | testes executados | limitação observada | risco | prio | critério de aceitação |
|---|---|---|---|---|---|---|---|---|
| C1 | Recolha de um URL com extracção, hash e registo de falhas | `IMPLEMENTADO_E_TESTADO` | `server/api.mjs:2554`, `server/documents` (via `fetchDocument`), `server/store.mjs` | `tests/fase3e.mjs` (21), `tests/fase3d.mjs` | cada recolha exige acção manual; não há recolha em lote por execução sem IA (ver D1) | médio | P1 | fonte inacessível fica registada com `ok:false`, `status` e `error`, e nunca desaparece do arquivo |
| C2 | Extracção de PDF (texto nativo) | `IMPLEMENTADO_E_TESTADO` | `server/pdftext.mjs`, `server/pdf.mjs` | `tests/pdftext.mjs` (19) | — | — | P2 | PDF com texto devolve `text` não vazio e `method` declarado; PDF sem texto não inventa texto |
| C3 | OCR de digitalizações com declaração do método e confiança | `IMPLEMENTADO_E_TESTADO` | `server/ocr.mjs` | `tests/ocr.mjs` (15) — «cai para OCR e declara o método» | provas contra produção (`tests/ocr-publico.mjs`) não corridas — `BLOQUEADO` | médio | P2 | imagem digitalizada devolve `method:'ocr'`, `confidence` numérica e o original preservado |
| C4 | Respeito por `robots.txt` e bloqueio de destinos privados (SSRF) | `IMPLEMENTADO_E_TESTADO` | `server/sources.mjs`, `server/api.mjs` | `tests/agents.mjs` («endereço privado/local proibido (SSRF)») | — | — | P1 | `127.0.0.1`, `10.0.0.0/8`, `169.254.169.254` e nomes internos recusados com motivo |
| C5 | Importação de fontes SSRN/Crossref com limite de cortesia | `IMPLEMENTADO_E_TESTADO` | `server/ssrn.mjs`, `server/sources.mjs` | `tests/ssrn.mjs` (18), `tests/fontes.mjs` (23) | — | — | P3 | duplicado → 409; limite por utilizador/hora respeitado |
| C6 | Descoberta automática de novos candidatos (models.dev) | `IMPLEMENTADO_E_TESTADO` | `server/discovery.mjs` | `tests/discovery.mjs` (13) | candidatos entram como catálogo, nunca em uso automático | — | P2 | candidato descoberto não altera a semente medida nem a rota em uso |

---

## D. Investigação (o núcleo da missão)

| id | funcionalidade | estado | ficheiros | testes executados | limitação observada | risco | prio | critério de aceitação |
|---|---|---|---|---|---|---|---|---|
| D1 | Fluxo pergunta → interpretação → candidatos → recolha → relatório (com lacunas) | `IMPLEMENTADO_E_TESTADO` (**era `FALHOU`**) | `server/research.mjs` (20 passos), `server/api.mjs:2957` | `tests/research.mjs` (19) **passa** (testa a rota, não o resultado); `tools/auditoria/fluxo-pergunta-arquivo.mjs` **falha** | uma falha de IA aborta a execução inteira: 3 perfis tentados com 10 URLs → **0 documentos, 0 provas**, paragem no passo 3–4 | **crítico** | **P0** | com 10 URLs fornecidas e IA indisponível, a execução arquiva os 10 documentos e produz relatório marcado «sem IA», sem passar por `stopped` |
| D2 | `POST /api/projects/:id/runs` responde em tempo aceitável | `IMPLEMENTADO_E_TESTADO` (**era `FALHOU`**: modo fundo 202) | `server/api.mjs:2957-2980` | medido: 2,0 s / 9,9 s / 24,2 s (execuções que morreram cedo) | chamada síncrona; orçamentos declarados de 10–60 min | **crítico** | **P0** | `POST /runs` devolve `202` + `runId` em < 500 ms; o progresso lê-se por `GET /api/runs/:id` |
| D3 | Perfis RAPIDA/NORMAL/PROFUNDA/EXAUSTIVA com limites explícitos | `IMPLEMENTADO_E_TESTADO` | `server/research.mjs:46-49` | `tests/fase3c.mjs` (28) («devolve o orçamento e a API recusa quando esgotado») | limites de chamadas/documentos/minutos declarados, mas o perfil só escolhe **passos de IA**; não escolhe fornecedor | médio | P1 | cada perfil declara e respeita os três tectos; esgotar → paragem com `stopReason:'orcamento-esgotado'` |
| D4 | Cancelar execução | `IMPLEMENTADO_E_TESTADO` (**era `PARCIAL`**) | `server/api.mjs:2988`, `src/ui/account.js:1280` | `tests/research.mjs`; botão «Cancelar» na UI | marca `cancelled` mas o fluxo não verifica o estado entre passos, por isso não interrompe a meio | alto | P1 | cancelar durante uma execução faz o passo seguinte não arrancar em ≤ 1 passo, com `stopReason:'cancelado-pelo-utilizador'` |
| D5 | Retomar execução interrompida por falha | `IMPLEMENTADO_E_TESTADO` (**era `PARCIAL`**) | `server/api.mjs:2988` | `tests/research.mjs` | não há retoma a partir de checkpoint de **passo** com estado parcial de documentos; retoma não repete o trabalho já feito | alto | P1 | retomar após reinício continua no passo seguinte e não re-recolhe documentos já arquivados (hash igual não duplica) |
| D6 | Agentes com contrato, orçamento, timeout, retry, cancelamento | `PARCIAL` | `server/agents.mjs` (13 agentes), `server/api.mjs` (`agentAiRunner`) | `tests/agents.mjs` (18), `tests/agents-p3.mjs` (16), `tests/agents-ui.mjs` (5) | `limits.timeoutMs`/`maxItems` existem no catálogo; **não há orçamento por agente, retry por agente nem cancelamento a meio** | alto | P1 | cada agente declara `maxCalls`, `timeoutMs`, `retries`, e o executor aplica-os; esgotar o orçamento de um agente não mata os outros |
| D7 | Registo por agente consultável (quem fez o quê, com que modelo e resultado) | `IMPLEMENTADO_E_TESTADO` | `server/api.mjs` (`/api/projects/:id/agent-runs`) | `tests/agents-p3.mjs`, `tests/provider-os.mjs` (25) | na execução real estudada o registo ficou **vazio** porque a execução morreu antes de qualquer agente de IA concluir | médio | P1 | execução completa tem ≥ 1 registo por agente executado, com `ok`, `modelo`, `latencyMs` |
| D8 | Contraprovas (contra-evidence) | `IMPLEMENTADO_SEM_TESTE` | `server/research.mjs` passo 15 (ia), agente `counter-evidence` (local) | nenhum teste dedicado | passo é `ia` e, nos perfis em que corre, morre com o resto | alto (viés de confirmação) | P1 | para uma afirmação com prova favorável, a execução procura e arquiva activamente fonte contrária e marca `contraditoria`/`corroborada` |
| D9 | Fact-checker e red-team | `IMPLEMENTADO_SEM_TESTE` | agentes `fact-checker`, `red-team` (locais) | nenhum teste dedicado | sem prova de que classificam e de que recusam publicar sem proveniência | alto | P1 | alegação sem excerto verificável nunca sai como `confirmada`; red-team produz lista de lacunas |

---

## E. Prova, classificação e grafo

| id | funcionalidade | estado | ficheiros | testes executados | limitação observada | risco | prio | critério de aceitação |
|---|---|---|---|---|---|---|---|---|
| E1 | Provas com hash encadeado e detecção de adulteração | `IMPLEMENTADO_E_TESTADO` | `server/evidence.mjs` | `tests/evidence.mjs` (17), `tests/flow.mjs` («Livro de provas com hash encadeado … detectou:true») | — | — | P0 | alterar um byte de uma prova é detectado e reportado no livro |
| E2 | Taxonomia única de estados de afirmação | `IMPLEMENTADO_E_TESTADO` | `server/evidence.mjs` (fonte única), `server/store.mjs` (migração v8), `server/api.mjs`, `src/ui/account.js` | `tests/afirmacoes.mjs` (14), `tests/evidence.mjs` (17), migração legada v7→v8 | — (**era `PARCIAL`**: faltavam `nao-verificada` e `desactualizada`, e «fonte-inacessivel» misturava estados de fonte com estados de afirmação) | médio | P0 | **feito**: 9 estados exigidos, lista de fonte à parte, nomes antigos com mapa declarado e migração registada |
| E3 | Independência de fontes (cópias não contam como confirmação) | `IMPLEMENTADO_E_TESTADO` | `server/evidence.mjs` (`originsOf`, `originKey`), passo 14 `corroborar` | `tests/afirmacoes.mjs` («duas cópias do MESMO texto… 1 origem», «syndicationOf leva a cópia à origem») | — (**era `PARCIAL`**) | médio | P0 | **feito**: texto idêntico em domínios diferentes funde numa origem; `syndicationOf` seguido até à origem; cópias contadas como redundantes |
| E6 | **C3** Proveniência por afirmação (excerto, localização, hash, data) | `IMPLEMENTADO_E_TESTADO` | `server/evidence.mjs` (`provenanceOf`), rota `GET /api/claims/:id/provenance`, UI «Proveniência» | `tests/afirmacoes.mjs` («proveniência lista o rasto…», «nada é publicado como facto sem proveniência completa») | o servidor avisa mas não bloqueia a promoção; bloquear fica para a fase H | médio | P1 | cada prova da afirmação tem rasto completo e o que falta é apontado por nome |
| E7 | **C4** Contraprova obrigatória antes de «facto documentado» | `IMPLEMENTADO_E_TESTADO` | `server/evidence.mjs` (`contraprovaRegistada`), rota `POST /api/claims/:id/counter-evidence`, UI «Registar contraprova» | `tests/afirmacoes.mjs` (2 testes) | — | médio | P0 | promoção a facto documentado recusada (409) sem procura datada e com método declarado |
| E8 | **C5** Caducidade: `desactualizada` só com marca explícita | `IMPLEMENTADO_E_TESTADO` | `server/evidence.mjs` (`isStale`), `validityUntil`/`supersededBy` | `tests/afirmacoes.mjs` (2 testes) | sem marca explícita nada é dado como desactualizado | baixo | P1 | prova caducada impede «facto documentado» e a sugestão passa a `desactualizada` |
| E4 | Grafo só a partir de registos documentais; sem inferência por co-presença; sem fundir homónimos; sem culpa por associação | `IMPLEMENTADO_E_TESTADO` | `server/graph.mjs`, `server/graph-export.mjs` | `tests/graph.mjs` (13) («estatísticas do grafo dizem o que não está provado»), `tests/flow.mjs` (testes 3–5, 8) | o grafo é relacional e declarativo; a ligação tem de vir de uma prova registada | médio | P0 | aresta sem `evidenceIds` é recusada; duas pessoas com o mesmo nome ficam em nós distintos até haver prova de identidade |
| E5 | Cronologia de acontecimentos | `IMPLEMENTADO_E_TESTADO` | `server/research.mjs` (timeline), `src/ui/timeline.js` | `tests/flow.mjs` («Inspeccionar cronologia → anos 12, min 2015, max 2026, semData 82») | 82 de 82 relações do corpus de teste ficaram **sem data** — a cronologia é frágil quando a data não vem explícita | médio | P2 | cada relação datada mostra a data e a proveniência da data; sem data fica explicitamente «sem data», nunca inventada |

---

## F. Relatório e saída

| id | funcionalidade | estado | ficheiros | testes executados | limitação observada | risco | prio | critério de aceitação |
|---|---|---|---|---|---|---|---|---|
| F1 | Relatório com 18 secções, referências e excertos | `IMPLEMENTADO_E_TESTADO` | `server/report.mjs`, `src/ui/report.js` | `tests/flow.mjs` («Exportar relatório com provas → refsRel 164, refsDoc 181, excertos 164»), `/report` 200 em 15 ms | é aberto como acção; não é área de trabalho persistente | médio | P1 | todo o relatório tem por afirmação: estado, excerto literal, localização e ligação à prova |
| F2 | Exportação (JSON do livro, grafo) | `IMPLEMENTADO_E_TESTADO` | `server/graph-export.mjs`, `src/ui/report.js` | `tests/flow.mjs`, `tests/graph.mjs` | — | — | P2 | export reproduzível: mesmo estado → mesmo ficheiro (fora carimbos de tempo) |
| F3 | «Arquivo» como destino do fluxo (pergunta → … → arquivo) | `NAO_IMPLEMENTADO` | — | — | não existe vista nem rota de arquivo de investigação; existe repositório de documentos e provas | alto | P1 | existe `/api/projects/:id/archive` e uma vista «Arquivo» com dossiê por investigação, versões e integridade |
| F4 | Teste funcional obrigatório «Quem é José Sócrates?» como suite | `NAO_IMPLEMENTADO` (corrido à mão: **`FALHOU`**) | `tools/auditoria/fluxo-pergunta-arquivo.mjs` (provisório) | execução manual: 0 documentos, paragem no passo 3–4 nos 3 perfis | não existe em `tests/` nem em `npm test` | **crítico** | **P0** | existe `tests/caso-socrates.mjs` em `npm test`, que exige: ≥ 3 documentos arquivados, ≥ 3 afirmações classificadas, ≥ 1 fonte contrária procurada, relatório com proveniência, registo por agente, e recuperação após reinício |

---

## G. IA, fornecedores e APIs sem chave

| id | funcionalidade | estado | ficheiros | testes executados | limitação observada | risco | prio | critério de aceitação |
|---|---|---|---|---|---|---|---|---|
| G1 | Catálogo de provedores com níveis, testes sintéticos e ranking | `IMPLEMENTADO_E_TESTADO` | `server/provider-catalog.mjs`, `server/provider-tests.mjs`, `server/providers.mjs` | `tests/provider-os.mjs` (25), `tests/provider-tests.mjs` (18) | — | — | P2 | teste sintético não entra no ranking de produção (provado) |
| G2 | Selecção de provedor por tarefa com fallback | `IMPLEMENTADO_E_TESTADO` | `server/selector.mjs` | `tests/selector.mjs` (24) | a selecção usa a **tarefa**, não o **perfil de investigação** | médio | P1 | `ProviderRouter` escolhe por `perfil` × `passo` e regista a razão da escolha |
| G3 | Rotação por quota/crédito, saída de fornecedor sem crédito | `IMPLEMENTADO_E_TESTADO` | `server/quota.mjs`, `server/api.mjs` (`quotasIA`) | `tests/quota-ia.mjs` (10) («4 fornecedores»), `tests/benchmark.mjs` (18) | — | — | P2 | fornecedor sem crédito sai da rota e o seguinte serve, sem repetir o pedido inválido |
| G4 | Cofre de chaves (`aes-256-gcm`), chaves por conta | `IMPLEMENTADO_E_TESTADO` | `server/crypto-keys.mjs`, `server/api.mjs` | `tests/ia-fornecedores.mjs` (21), `tests/provider-os.mjs` | — | — | P1 | chave nunca é devolvida em claro; chave inválida não entra em uso |
| G5 | Cascata do operador + alternância sem chave (`pollinations`) | `PARCIAL` | `server/api.mjs:519-540` | execução real: `200` sem JSON (→ `resposta-invalida-de-ia`) e limite «1 resposta/30 s por IP» | é o único caminho disponível sem chave e **não sustenta** o fluxo (D1) | **crítico** | **P0** | a cascata só inclui fornecedores validados; um fornecedor que devolva texto não-JSON nunca é usado para passos que exigem JSON, e a falta de IA não impede a recolha |
| G6 | Catálogo persistente de APIs sem chave, com estados e operação de validação | `PARCIAL` | `tools/keyless-scan.mjs`, `docs/APIS-sem-chave.{json,md}`, `GET /api/ai/keyless` | `tests/keyless.mjs` (10); execução real 2026-10-23: 46 sondados, 18 públicos, 24 exigem chave, 4 indeterminados, **1 gera** (o controlo) | estados actuais são derivados da sonda, não a máquina de estados exigida (DESCOBERTO→…→DESCONTINUADO); validação não é operação de primeira classe na UI | alto | P1 | cada API tem estado explícito, data de última prova, e a UI permite validar e ver a evidência da validação |
| G7 | Workflow de varrimento keyless com controlo obrigatório | `IMPLEMENTADO_E_TESTADO` | `.github/workflows/keyless-scan.yml` | teste nos dois sentidos executado (controlo real → 0; relatório adulterado → `::error::A SONDA ESTÁ AVARIADA`, 1) | não corre em PRs | médio | P2 | workflow falha se o controlo não gerar; commit só se o relatório mudar |
| G8 | Modelos alternativos/nomes de modelo tratados com rigor | `IMPLEMENTADO_E_TESTADO` | `server/modelos.mjs`, `server/api.mjs` | `tests/modelos.mjs` (12), `tests/ia-fornecedores.mjs` (21) | — | — | P3 | sugestão do fornecedor é seguida tal e qual e registada |

---

## H. Interface

| id | funcionalidade | estado | ficheiros | testes executados | limitação observada | risco | prio | critério de aceitação |
|---|---|---|---|---|---|---|---|---|
| H1 | Porta de entrada, login, paleta, consola | `IMPLEMENTADO_E_TESTADO` | `src/ui/login.js`, `palette.js`, `console.js`, `dom.js` | `tests/entrada-ui.mjs` (10), `tests/simples-ui.mjs` (15), `tests/console-tabs.mjs` (diagnóstico, sem asserções) | `console-tabs` imprime e sai com 0 — não é teste | baixo | P3 | todos os separadores abrem sem erro de consola e sem pedidos falhados |
| H2 | Conta: separadores Conta/Projectos/Chaves de IA/Administração | `IMPLEMENTADO_E_TESTADO` | `src/ui/account.js:121` | `tests/account-ui.mjs` (**19/19**) | granularidade grosseira: detalhe da investigação vive dentro de «Projectos» | médio | P1 | cada área do trabalho tem separador próprio e estado navegável por URL |
| H3 | Detalhe do projecto com execuções, passos, cancelar/retomar/relatório | `PARCIAL` | `src/ui/account.js:1265-1300` | `tests/account-ui.mjs` | mostra `n/20 passos` e `fontes consultadas`; **não mostra proveniência por afirmação** nem o resultado por agente no mesmo ecrã | alto | P1 | ver uma afirmação abre as provas com excerto e localização, sem sair do ecrã |
| H4 | Grafo interactivo (nós, arestas, caminhos, filtros, legenda) | `IMPLEMENTADO_E_TESTADO` | `src/ui/evidence-graph.js`, `graph.mjs`, `vendor/cytoscape` | `tests/flow.mjs` (8 testes: expandir, significado, fonte, filtro, caminhos), `tests/smoke.mjs` (diagnóstico: `ERRORS: 0`, `canvas:true`) | — | — | P2 | nenhuma aresta sem fonte clicável; filtros por período e categoria consistentes com o servidor |
| H5 | Pesquisa com filtros (`tipo:`, `estado:`, `ano:`, `-termo`), gralhas assinaladas, excertos com destaque | `IMPLEMENTADO_E_TESTADO` | `server/api.mjs:2065` + `server/search.mjs` (`parseQuery`, `pontuarItem`), `src/ui/searchpage.js` | `tests/pesquisa-servidor.mjs` (18), `tests/search.mjs` (11 testes de interface) | índice construído em memória por pedido (20 ms a 128 documentos) | baixo | P2 | filtros nunca devolvem resultados fora do filtro; correcção de gralha é sempre anunciada |
| H6 | Sem botões sem função nem dados fictícios | `PARCIAL` | `src/ui/*.js` | `tests/*-ui.mjs` (9 suites, 100 verificações) | não há teste que varra a UI à procura de botões inertes ou de valores de exemplo em produção | médio | P2 | um teste percorre cada separador e falha se houver botão sem handler ou texto de exemplo visível |

---

## I. Operação

| id | funcionalidade | estado | ficheiros | testes executados | limitação observada | risco | prio | critério de aceitação |
|---|---|---|---|---|---|---|---|---|
| I1 | Saúde e prontidão (`/health`, `/ready`) com integridade | `IMPLEMENTADO_E_TESTADO` | `server/api.mjs`, `server/store.mjs` | `tests/seguranca.mjs` («503 com base bloqueada»), `curl /ready` → `status:ready` | — | — | P2 | `/ready` distingue «pronto», «degradado» e «bloqueado» com motivo legível |
| I2 | Agendador e saúde de fornecedores | `IMPLEMENTADO_E_TESTADO` | `server/scheduler.mjs` | `tests/scheduler.mjs` (21) | — | — | P2 | estado «sem dados» nunca é apresentado como «operacional» (provado) |
| I3 | Auditoria de acções sensíveis | `IMPLEMENTADO_E_TESTADO` | `server/store.mjs` (`audit`), `server/api.mjs` | `tests/evidence.mjs` («registou provas e alegações sem conteúdo sensível») | — | — | P1 | toda a acção destrutiva deixa evento com actor, alvo e resultado, sem conteúdo sensível |
| I4 | Workflows agendados (4): quota, keyless, manutenção, reavaliação | `IMPLEMENTADO_E_TESTADO` (`benchmark`), restantes `IMPLEMENTADO_SEM_TESTE` | `.github/workflows/*.yml` | `tests/benchmark.mjs` (18) | só `keyless-scan` foi validado fora do CI; os outros três nunca correram nesta sessão | médio | P2 | cada workflow tem um modo `workflow_dispatch` seco que corre verde e não altera dados |
| I5 | CI em pull requests | `NAO_IMPLEMENTADO` | — | `grep pull_request .github/workflows/*.yml` → **nenhum resultado**; os 4 workflows são `schedule`+`workflow_dispatch` | nenhum teste corre em PRs | alto | P1 | abrir um PR dispara `npm test` + `test:ui` e falha o merge se houver falha |
| I6 | Dependências auditadas | `IMPLEMENTADO_E_TESTADO` | `tools/audit-deps.mjs`, `docs/DEPENDENCIAS-DADOS.json` | `npm run audit:deps` → 41 pacotes, sem vulnerabilidades altas/críticas | não é executado em CI | médio | P2 | `audit:deps` corre em cada PR e falha em alta/crítica |

---

## J. Resumo (contagem das 56 linhas acima, estado a seguir à FASE C)

| estado | n.º | quais |
|---|---|---|
| `IMPLEMENTADO_E_TESTADO` | **39** | A1–A5, B1–B2, C1–C6, D1–D5, D7, E1–E8, F1–F2, G1–G4, G7–G8, H1–H2, H4–H5, I1–I3, I6 |
| `PARCIAL` | **9** | A6 (retenção: só dry-run), B3 (durável em produção, falta ensaio numa base descartável), D6 (agentes sem orçamento/retry por agente), E6/E7 (avisam mas não bloqueiam a promoção), G5, G6, H3, H6 |
| `FALHOU` | **0** | D1 e D2 corrigidos na FASE B |
| `IMPLEMENTADO_SEM_TESTE` | **2** | D8 (o passo 15 de contraprovas continua a ser `ia`; a rota C4 é outra coisa), D9 |
| `NAO_IMPLEMENTADO` | **3** | F3 (arquivo), F4 (suite «Quem é José Sócrates?» com documentos reais), I5 (CI: `ci.yml` existe, ainda não correu num PR real) |
| misto | **1** | I4: `benchmark` testado, os outros três workflows sem teste |

Fora da tabela: **4 `BLOQUEADO`** (testes contra produção e ensaio de durabilidade com base
descartável) e **3 `NAO_VERIFICADO`** (conteúdo de produção vs HEAD, fiabilidade do pollinations,
comportamento com uma chave de IA válida).

**Leitura:** a base, o fluxo e a classificação estão provados com execução. O que resta concentra-se
em três sítios — **arquivo** (F3), **caso real** (F4) e **orçamento/retry por agente** (D6).
