# Auditoria integral — Conspiracy Tracker (FASE A)

> **Natureza deste documento.** É um registo de inspecção. Só entra aqui o que foi
> executado e observado nesta sessão, com o comando ou a rota que o produziu. Onde não
> houve execução, o estado é `NAO_VERIFICADO` ou `BLOQUEADO` — nunca «deve funcionar».
> Nenhuma alteração foi feita ao código de produção durante a FASE A; as únicas
> escritas foram nos quatro documentos desta fase e em `tools/auditoria/` (ferramentas
> de medição, não importadas por nenhum ficheiro de produção nem incluídas em testes).

- **Data da inspecção:** 2026-10-23
- **Repositório:** `github.com/rpolicarpo100/Conspiracy_Tracker`, branch `main`
- **HEAD local:** `ebc874f` — *«docs: §55 (rotação por tokens), §8 em IA-FORNECEDORES e decisões 54-55»*, árvore de trabalho **com alterações não commitadas**
- **Produção (`conspiracy-aitracker.onrender.com`)**: `GET /health` → `version 2.0.0-fase12 · commit 77c25126c06b…` (leitura apenas)
- **Ambiente de teste:** Node `v20.20.2`, `npm install` completo (41 pacotes instalados: 4 directos, 3 de desenvolvimento), Chromium do Playwright instalado nesta sessão

Estados permitidos: `IMPLEMENTADO_E_TESTADO`, `IMPLEMENTADO_SEM_TESTE`, `PARCIAL`, `FALHOU`,
`NAO_IMPLEMENTADO`, `BLOQUEADO`, `NAO_VERIFICADO`.

---

## 1. Método

| passo | como |
|---|---|
| estrutura | `ls`/`wc -l` por directoria; contagem de entradas de rota por análise estática de `server/api.mjs` |
| comportamento | arranque real da API em `:8080` (`tools/dev-server.sh`) e por `createApi()` em `dataDir` temporário |
| testes | matriz ficheiro-a-ficheiro (`tools/auditoria/matriz-testes.mjs`), `npm run test:ui`, `npm run audit:deps` |
| fluxo crítico | `tools/auditoria/fluxo-pergunta-arquivo.mjs` — execução real da API com `fetchDoc` simulado (sem rede), três perfis, reinício do processo a meio |
| desempenho | `tools/auditoria/perf-carga.mjs` — 300 provas + 100 relações |
| segurança | pedidos `curl` locais aos cabeçalhos e rotas públicas; leitura do código de sessão, CSRF, limitadores e cofre |
| produção | apenas `GET /health`, `GET /api/meta`, `GET /api/ai/keyless` — **nenhuma escrita, nenhum pedido autenticado** |

Tudo o que envolve a base de produção, dados de utilizadores reais ou um deploy ficou marcado
`BLOQUEADO` (falta autorização explícita).

---

## 2. Estado do repositório e divergência com produção

```
$ git log --oneline -3
ebc874f docs: §55 (rotação por tokens), §8 em IA-FORNECEDORES e decisões 54-55
a792832 fase 12: rotação automática de IA por tokens disponíveis + workflow horário
d952e5c docs: estado medido das três chaves em produção (§54.13), regras de nomes/modelos e decisão 53
```

`git status --porcelain` mostra alterações **não commitadas** em `package.json`, `server/api.mjs`,
`src/ui/account.js`, `tests/account-ui.mjs`, `tools/keyless-scan.mjs`, `docs/ESTADO-ATUAL.md`,
`docs/TEST-RESULTS.txt`, `docs/APIS-sem-chave.{json,md}`, `docs/DEPENDENCIAS-DADOS.json` e em
19 capturas `docs/shot-*.png`.

Consequências a registar (nenhuma delas é uma opinião):

1. **Produção não corre o HEAD.** Produção declara `77c2512`; o HEAD local é `ebc874f`. O código
   que está a servir os utilizadores é anterior ao último commit do repositório.
2. **Parte do trabalho da fase 12 não está commitada** (ex.: o `server/api.mjs` modificado).
   Antes de qualquer commit da missão é obrigatório `git diff` para não arrastar alterações
   alheias para dentro de um commit de auditoria.
3. As capturas `shot-*.png` aparecem modificadas sem alteração de código correspondente — não se
   apurou a causa; tratá-las como ruído até prova em contrário.

---

## 3. Estrutura medida

| directoria | ficheiros | nota |
|---|---|---|
| `server/` | 30 | `api.mjs` é o monólito de rotas; `research.mjs` o fluxo; `agents.mjs` o catálogo de agentes |
| `src/ui/` | 17 | `account.js` tem 1 700 linhas (o maior); soma da interface: 7 265 linhas |
| `tests/` | 54 `.mjs` (+ `_env.mjs`/`_ui-entrada.mjs` como auxiliares) | 32 em `npm test`, 9 suites em `test:ui`, **13 fora de ambas as cadeias** |
| `tools/` | 18 (+3 de auditoria criados nesta fase) | |
| `docs/` | 81 ficheiros (32 documentos `.md` segundo `tools/status.mjs`, o resto capturas) | |
| `vendor/` | 9 | dependências vendorizadas (`cytoscape`, `d3-force`, `graphology`, …) |
| `server/` + `src/` | — | **24 789 linhas** |

Dependências directas: `cytoscape`, `cytoscape-fcose`, `pg`, `tesseract.js`; desenvolvimento:
`d3-force`, `graphology`, `playwright`. `engines.node >=18`.
`npm run audit:deps` → **41 pacotes, «sem vulnerabilidades altas/críticas e sem licenças proibidas»**
(código de saída 0; dados em `docs/DEPENDENCIAS-DADOS.json`).

---

## 4. Agentes (13)

`server/agents.mjs` expõe 13 agentes, cada um com `id`, `name`, `phase`, `kind`, `contract`,
`criteria` e `limits`. Tipos: **6 `local`, 7 `ai`** (confirmado em produção por `GET /api/meta`:
`{"total":13,"promptVersion":"a1","local":6,"ai":7}`).

| agente | tipo | limites declarados |
|---|---|---|
| `orchestrator` | local | timeout 5 000 ms · 50 itens |
| `research-planner` | ai | 30 000 ms · 12 itens |
| `web-search` | ai | 30 000 ms · 20 itens |
| `document-hunter` | ai | 30 000 ms · 15 itens |
| `extraction` | ai | 30 000 ms · 30 itens |
| `entity-resolution` | local | 5 000 ms · 200 itens |
| `relationship-mapper` | ai | 30 000 ms · 20 itens |
| `corporate-financial` | ai | 30 000 ms · 20 itens |
| `timeline` | local | 5 000 ms · 500 itens |
| `counter-evidence` | local | 5 000 ms · 200 itens |
| `fact-checker` | local | 5 000 ms · 300 itens |
| `red-team` | local | 8 000 ms · 500 itens |
| `report-generator` | ai | 30 000 ms · 18 itens |

**O que os agentes têm:** contrato textual, critérios de aceitação, timeout e tecto de itens.
**O que não têm:** orçamento próprio em chamadas/custo, política de *retry* por agente,
ponto de cancelamento a meio de um agente, e retoma ao nível do agente. Os limites são
declarados no catálogo, mas o fluxo `research.mjs` não os usa por agente — usa apenas o
orçamento global da execução.

---

## 5. Fluxo de investigação (20 passos) e perfis

`server/research.mjs` define 20 passos sequenciais:

```
 1.interpretar(ia)      2.ambito(local)        3.entidades(ia)      4.variantes(ia)
 5.multilingue(ia)      6.primarias(local)     7.secundarias(local) 8.recolher(fetch)
 9.excertos(ia)        10.alegacoes(ia)       11.resolver(local)   12.deduplicar(local)
13.verificar(local)    14.corroborar(local)   15.contraprovas(ia)  16.lacunas(local)
17.expandir(ia)        18.grafo(local)        19.relatorio(local)  20.revisao(local)
```

Perfis e orçamentos (lidos do módulo em execução, `PROFILES`):

| perfil | chamadas | documentos | minutos | passos de IA activos |
|---|---|---|---|---|
| `rapida` | 4 | 3 | 2 | interpretar, variantes |
| `normal` | 12 | 8 | 10 | interpretar, entidades, variantes, excertos, alegacoes |
| `profunda` | 30 | 20 | 30 | + multilingue, contraprovas |
| `exaustiva` | 60 | 40 | 60 | + expandir |

Observações estruturais (do código, confirmadas por execução):

- **Só o passo 8 é que recolhe documentos.** Os passos 1–7 são interpretação, âmbito e listas de
  candidatos; nada é arquivado antes do passo 8.
- O fluxo é **estritamente sequencial**: uma falha de IA chama `stop(...)` e termina a execução
  inteira (ver §7 e achado **A-01**).
- `POST /api/projects/:id/runs` **espera o fluxo completo** antes de responder (achado **A-02**).
- Passos saltados por perfil ficam `ignorado-pelo-perfil` com justificação explícita — isto está
  bem feito e é o comportamento correcto.
- Há `POST /api/runs/:id/{resume,cancel}` e o `run` guarda `steps`, `stopReason`, `stopDetail`,
  `budget` — ou seja, a **estrutura** para cancelar/retomar existe (ver §7, achado A-05, sobre o
  alcance real).

---

## 6. Rotas (97 padrões distintos, 23 prefixos)

Análise estática de `server/api.mjs` (comparações `p === '…'` e `p.match(/^…$/)`):
**97 padrões distintos**, distribuídos por:

```
21 /api/provider-os   19 /api/auth        19 /api/projects     6 /api/sources
 5 /api/admin          4 /api/providers    2 /api/runs          2 /api/ai
 2 /api/discovery      2 /api/service      2 /api/ssrn          2 /api/evidence
 1 /api/search · /api/agents · /api/meta · /api/coverage · /api/memory · /api/claims
 1 /api/documents · /api/relations · /api/entity-links · /health · /ready
```

Nota de contagem: o número «111 rotas» que aparece em `tools/status.mjs` conta **entradas de
código** (a mesma rota com `GET` e `POST` conta duas vezes, e há ramos com dois métodos na mesma
entrada). O número de **padrões** é 97 e o de **prefixos** 23. As duas contagens não são
contraditórias, mas o rótulo «rotas» deve ser lido com cuidado em relatórios futuros.

Exemplos de cobertura funcional verificada por testes: `POST /api/projects/:id/{evidence,relations,documents,runs}`,
`GET /api/projects/:id/{graph,report,summary,claims,agent-runs}`, `POST /api/runs/:id/{resume,cancel}`,
`GET /api/search`, `GET /api/ai/keyless`, `GET /ready`.

---

## 7. Achados críticos (com evidência)

### A-01 — Uma falha de IA mata a execução inteira, mesmo com URLs fornecidas pelo utilizador `FALHOU`

`server/research.mjs:143-160`: se o passo de IA não devolver resultado válido, faz-se
`return stop('resposta-invalida-de-ia' | 'falha-de-ia', …)`. Não há retry, não há degradação para
um passo local, não há continuação «com o que já se sabe».

Execução real (`tools/auditoria/fluxo-pergunta-arquivo.mjs`, 2026-10-23), mesmo com **10 URLs
fornecidas** pelo utilizador:

```
[rapida]    POST /runs → 201 em 2,0 s · status=stopped · parou: resposta-invalida-de-ia
  passos: 1.interpretar=concluido | 2.ambito=concluido | 3.entidades=ignorado-pelo-perfil | 4.variantes=falhou
[normal]    POST /runs → 201 em 9,9 s · status=stopped · parou: resposta-invalida-de-ia
[exaustiva] POST /runs → 201 em 4,5 s · status=stopped · parou: resposta-invalida-de-ia
documentos: 0 · provas: 0 · fetchDoc chamado 0 vez(es)
```

O passo 8 («recolher») nunca é alcançado. Noutra execução com o mesmo fluxo registou-se também
`falha-de-ia` com o motivo do fornecedor: *«Free limit reached: 1 reply every 30 seconds per IP»*
(pollinations). Conclusão factual: **sem uma chave de IA que responda JSON válido, a aplicação não
recolhe um único documento** — o que colide com o objectivo «APIs sem chave» e com o fluxo
pergunta→arquivo.

### A-02 — `POST /runs` é síncrono; um perfil longo excede o tempo de qualquer proxy `FALHOU`

`server/api.mjs:2957-2980`: `const out = await runResearch(...)` **antes** do `json(res, 201, …)`.
Medições: 2,0 s (paragem no passo 4, perfil rápido) e **24,2 s** numa execução que morreu no passo 4
com um perfil `profunda`. Com orçamentos declarados de 10/30/60 minutos (`normal`/`profunda`/
`exaustiva`), uma execução que corra até ao fim segura a ligação HTTP durante dezenas de minutos:
proxies e plataformas cortam-na, e o utilizador perde a resposta mesmo que o trabalho tenha
acontecido. Não existe `POST` que devolva `202` + id e deixe o trabalho em segundo plano.

### A-03 — O caminho «sem chave» em uso é um fornecedor com limite de 1 resposta/30 s e sem JSON `PARCIAL`

`cadeiaDeFornecedores()` (`server/api.mjs:519-540`) constrói a cadeia a partir de
`AI_OPERATOR_ORDER` (11 fornecedores) e só inclui os que têm chave; no fim acrescenta
`pollinations` como alternância sem chave (`AI_KEYLESS_FALLBACK`, por omissão `true`). Neste
ambiente não existe nenhuma chave de operador: a única fonte é o pollinations, que respondeu
(a) `200` com texto que não é JSON — motivo `resposta-invalida-de-ia`; e (b) limite por IP.
O relatório `docs/APIS-sem-chave.*` (18 catálogos públicos, 1 geração real, só o controlo) já dizia
o essencial: encontrar um endpoint aberto não o torna utilizável neste fluxo. **A conclusão
operacional é nova e material: o «modo sem chave» não sustenta a investigação.**

### A-04 — Taxonomia de estados de afirmação não coincide com a exigida `PARCIAL`

`GET /api/meta` publica 9 estados: `confirmada`, `corroborada-independente`, `alegacao-atribuida`,
`inferencia-suportada`, `hipotese`, `contraditoria`, `insuficiente`, `refutada`, `fonte-inacessivel`.
A missão exige: FACTO DOCUMENTADO, ALEGAÇÃO ATRIBUÍDA, INFERÊNCIA, HIPÓTESE, CONTRADITÓRIA,
REFUTADA, **NÃO VERIFICADA**, INFORMAÇÃO INSUFICIENTE/NÃO ENCONTRADA, **DESACTUALIZADA**.
Faltam duas categorias (`nao-verificada`, `desactualizada`); `confirmada` e
`corroborada-independente` não têm equivalente literal na lista pedida; `fonte-inacessivel` é um
estado de fonte, não de afirmação. Enquanto isto não for resolvido, servidor, interface, grafo e
relatórios não podem classificar de forma consistente.

### A-05 — Cancelar e retomar existem, mas não interrompem nada a meio `PARCIAL`

`POST /api/runs/:id/cancel` marca `status: 'cancelled'` e `cancel` só é aceite em
`pending|running`; como a execução corre **dentro** do pedido HTTP (A-02), «cancelar» só é
possível a partir de outro pedido — e não há verificação do estado entre passos que faça o fluxo
parar. `resume` recusa execuções `cancelled` (`409`), aceita `stopped` e continua. O teste
`tests/research.mjs` (19 PASS) cobre a rota; não cobre a interrupção efectiva.

### A-06 — Cabeçalhos de segurança com duas fragilidades reais `PARCIAL`

Medido com `curl -D -` no servidor local (e o mesmo CSP é escrito por `tools/serve.mjs:43`):

```
cache-control: no-store
x-content-type-options: nosniff
referrer-policy: no-referrer
permissions-policy: geolocation=(), camera=(), microphone=()
content-security-policy: default-src 'self'; img-src 'self' data: blob:;
  style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';
  connect-src 'self'; frame-ancestors *
```

- `frame-ancestors *` — a aplicação aceita ser embutida em qualquer site (clickjacking). Num
  produto com acções destrutivas (apagar conta, apagar chaves) isto é um risco concreto.
- `script-src 'unsafe-inline'` — anula boa parte da defesa XSS da CSP.
- Não há `strict-transport-security` (em produção o TLS é do Render; ainda assim, HSTS é gratuito).
- CORS: pedido com `Origin: https://evil.example` a `/api/meta` **não devolve** cabeçalhos
  `access-control-*` (bom: não há CORS aberto).
- Cookies: `vn_sid` com `HttpOnly` + `SameSite=Lax` + `Secure` em https; `vn_csrf` legível pelo
  JavaScript por desenho (é o token CSRF). CSRF é exigido nas escritas (`tests/research.mjs`:
  «403 sem cabeçalho CSRF»).
- Limitadores presentes: recolha de fontes 30/h, Crossref 20/h, verificação 6/h, descoberta 6/h,
  bootstrap por IP, e limite de tentativas de autenticação por IP e por conta
  (`tests/auth-privacidade.mjs`: «401 · 401 · 401 · 401»).
- Segredos: cofre `aes-256-gcm` (`/ready` → `keyVault.mode: "aes-256-gcm"`), chaves nunca
  devolvidas em claro nas listagens.

### A-07 — Persistência: **correcção posterior** — em produção a base é Postgres e declara-se durável `PARCIAL`

> **Correcção (2026-10-23, depois do deploy da FASE B).** A medição abaixo foi feita no servidor
> **local**, que não tem `DATABASE_URL`. Em produção o `/ready` responde
> `mode: "postgres+ficheiro"`, `durableBetweenDeploys: true`, `postgres: {configured: true, active: true,
> ready: true, version: 1046, host: ep-green-sound-…neon.tech, ssl: "verify-full", writes: 1, errors: 0}`.
> Ou seja: **a produção tem base durável configurada e a escrever**. O que continua sem prova é o
> ciclo completo criar → reiniciar → reler numa base descartável (exigiria autorização). O erro da
> primeira medição foi medir o ambiente local e generalizar — fica registado como tal.

#### Medição local (mantém-se válida para o ambiente sem `DATABASE_URL`)

`GET /ready` local: `persistence: {mode: "ficheiro", durableBetweenDeploys: false, postgres: {configured: false, active: false}}`.
`tests/persistencia-pg.mjs` **não testa nada** sem `DATABASE_URL` (imprime `SKIP … sem base real
não se testa durabilidade`). O que **está** provado: com o mesmo `dataDir`, um reinício do processo
devolve o relatório **idêntico byte a byte** (fora o carimbo de tempo) — ver §9. O que **não**
está provado: que os dados sobrevivem a um deploy do Render (disco efémero), salvo com Postgres
configurado — e essa configuração não existe hoje em produção segundo `/ready`.

### A-08 — Interface: separadores existem, mas a granularidade é grosseira `PARCIAL`

`src/ui/account.js:121`: separadores `Conta`, `Projectos`, `Chaves de IA`, `Administração`
(só para `ADMIN`). O detalhe do projecto lista execuções com `perfil`, `n/20 passos`,
`fontes consultadas`, `Cancelar`, `Retomar`, `Relatório`. Existem vistas próprias para provas,
grafo, cronologia, fontes, documentos, agentes, APIs e provedores (17 módulos em `src/ui/`, e
`tests/console-tabs.mjs` percorre separadores e conta «erros: 0»). **Não existe** um separador
«Arquivo» nem uma vista de proveniência por afirmação; o relatório é aberto como acção
(`openReport`), não como área de trabalho persistente.

### A-09 — Duplicações e material inacessível `PARCIAL`

- `tools/` tem 18 ficheiros, vários de uso único (`pg-snapshot.mjs`, `audit-catalog.mjs`,
  `setup-ui-env.sh`, `dev-server.sh`, `serve.mjs`) sobrepostos em função com `tools/status.mjs`;
  não se apurou quais são usados pelo *workflow* e quais são histórico.
- `tests/` tem **13 ficheiros fora de qualquer cadeia** (`deployed`, `mfa-publico`, `ocr-publico`,
  `perf`, `real-fetch`, `scale-diag`, `shots`, `shots2`, `shot-search`, `smoke`, `console-tabs`,
  mais os dois auxiliares `_env`/`_ui-entrada`): quatro deles (`smoke`, `console-tabs`, `perf`,
  `scale-diag`) correm localmente e **não têm asserções** — imprimem diagnóstico e saem com 0, o
  que é indistinguível de sucesso num CI.
- `tests/flow.mjs` e `tests/search.mjs` **falham com código 1 quando corridos fora de
  `tools/ui-env.sh`** (`TypeError` ao ler o ambiente). Não é uma falha do produto, é uma
  dependência de ambiente não declarada — mas é uma armadilha para quem correr a cadeia à mão.

### A-10 — Produção corre um commit diferente do HEAD `NAO_VERIFICADO` (quanto a conteúdo)

Produção (`/health`) declara `77c2512`; o HEAD local é `ebc874f`. Não se comparou ficheiro a
ficheiro o que está em produção (exigiria autenticação e deploy — fora do âmbito autorizado).
Sem autorização não se afirma nem que produção está actualizada nem que está atrasada em conteúdo:
apenas que **os hashes não coincidem**.

---

## 8. Inventário de funcionalidades — visão de conjunto

Detalhe completo, com critérios de aceitação, em `docs/ESTADO-FUNCIONALIDADES.md`. Resumo por
estado:

| estado | n.º | onde está o detalhe |
|---|---|---|
| `IMPLEMENTADO_E_TESTADO` | 34 | autenticação/sessões/CSRF, isolamento por conta, exportação, MFA, cofre de chaves, provas com hash encadeado, grafo declarativo, relatório com 18 secções, pesquisa com filtros, PDF/OCR, SSRN/Crossref, descoberta, perfis com orçamento, registo por agente, catálogo de provedores, selecção por tarefa, rotação por quota, rota keyless, workflow keyless, modelos, entrada/consola, conta, grafo interactivo, saúde/prontidão, agendador, auditoria, dependências |
| `PARCIAL` | 11 | retenção (só dry-run), persistência durável, cancelar, retomar, agentes (sem orçamento/retry), taxonomia de afirmações, independência de fontes, cascata do operador, catálogo de APIs com estados, detalhe do projecto, botões sem função |
| `FALHOU` | 2 | D1 — recolha sem chave de IA; D2 — execução por HTTP síncrono |
| `IMPLEMENTADO_SEM_TESTE` | 2 | contraprovas, fact-checker/red-team |
| `NAO_IMPLEMENTADO` | 3 | arquivo como destino do fluxo, suite «Quem é José Sócrates?», CI em PRs |
| misto | 1 | os 4 workflows agendados: só o de benchmark tem teste |
| `BLOQUEADO` | 4 | testes contra produção e ensaio de durabilidade com Postgres |
| `NAO_VERIFICADO` | 3 | conteúdo de produção vs HEAD, fiabilidade do pollinations, comportamento com chave válida |

Contagem exacta, linha a linha, em `docs/ESTADO-FUNCIONALIDADES.md` (53 funcionalidades).

## 9. Persistência — o que foi efectivamente provado

Experiência: `createApi({dataDir})` → recolha de documentos → relatório → `srv.close()` →
novo `createApi` sobre o **mesmo** `dataDir` → `GET /api/projects/:id/report`.

```
após reinício do processo: relatório 200 IDÊNTICO (sem o carimbo de tempo)
```

(Na experiência de carga da §10, o mesmo tipo de relatório com 300 provas e 100 relações
devolveu 200 em 15 ms e um grafo de 108 KB — útil como referência de escala, não como prova
de durabilidade.)

Isto prova três coisas e nenhuma delas é a durabilidade entre deploys:

1. O armazenamento em ficheiro **é consistente** entre reinícios do mesmo processo/disco.
2. O relatório é **determinístico** dado o mesmo conteúdo (não muda por reinício).
3. `durableBetweenDeploys: false` é uma declaração honesta de `/ready`, não um bug escondido.

O que falta provar e exige autorização: Postgres real (`DATABASE_URL`), migração de dados e
sobrevivência a um deploy do Render.

---

## 10. Desempenho medido (antes de qualquer optimização)

`tools/auditoria/perf-carga.mjs`, corpus de 300 provas + 100 relações, Node 20, sem rede:

| leitura | latência |
|---|---|
| `GET /api/projects/:id` | 2 ms |
| `GET .../evidence` (300 provas) | 10 ms |
| `GET .../graph` | 13 ms |
| `GET .../report` | 15 ms |
| `GET .../summary` | 22 ms |
| `GET /api/search?q=financiamento` | 21 ms |
| `GET /api/search?q=entidade a7` | 7 ms |
| payload do grafo | 108 KB |

Criação do corpus: 300 provas + 100 relações em ~4 s (≈13 ms por escrita).
Conclusão: **as leituras não são o problema nesta escala**. O problema de desempenho percebido é
o tempo de resposta de `POST /runs` (A-02), que é tempo de IA, não de base de dados.

---

## 11. Tarefas agendadas (4 workflows)

| workflow | conteúdo observado |
|---|---|
| `.github/workflows/keyless-scan.yml` | cron `23 4 * * 1`, `workflow_dispatch`; sonda 46 endpoints, exige que o controlo gere texto, faz commit só se `docs/APIS-sem-chave.*` mudar; valida nos dois sentidos (testado fora do CI nesta sessão, §12) |
| `ai-quota.yml` | rotação/quota de IA |
| `manutencao.yml` | manutenção periódica |
| `reevaluate.yml` | reavaliação de níveis de provedores |

`tests/benchmark.mjs` cobre o cron de reavaliação («cron · token certo reavalia níveis 1–2 sem
chave e sem custo → 6 reavaliados») — o único dos quatro com teste executado nesta sessão.

---

## 12. Validação do workflow keyless (contexto herdado, reconfirmado)

Os passos `Controlo obrigatório` e `Resumo` do `keyless-scan.yml` foram extraídos do YAML e
corridos como shell: controlo real → `exit 0`; relatório adulterado → `::error::A SONDA ESTÁ
AVARIADA`, `exit 1`. Relatório actual: **46 sondados · 18 no catálogo público · 24 exigem chave ·
4 indeterminados**; etapa de geração: **1 gera sem chave** (`pollinations-control`).
Este achado é a base do A-03: a única geração real é o próprio controlo.

---

## 13. Riscos (ordenados por impacto)

| # | risco | impacto | probabilidade | onde |
|---|---|---|---|---|
| R1 | utilizador pede investigação e recebe execução «stopped» sem um único documento | perda de confiança total no produto | alta (é o comportamento actual sem chave) | A-01 |
| R2 | pedido HTTP cortado em execuções longas; trabalho perdido sem retorno ao utilizador | perda de trabalho e custo de IA pago duas vezes | alta | A-02 |
| R3 | dados desaparecem num deploy (disco efémero) | perda de arquivo de investigação | média-alta | A-07 |
| R4 | clickjacking sobre acções destrutivas (`frame-ancestors *`) | conta e chaves expostas a engano | média | A-06 |
| R5 | classificação de afirmações inconsistente entre servidor/UI/relatório | conclusões erradas com aparência de rigor | alta se as fases seguintes construírem sobre a taxonomia actual | A-04 |
| R6 | testes sem asserções contados como sucesso | falsa sensação de cobertura | média | A-09 |
| R7 | árvore suja + produção noutro commit | commits a arrastar trabalho alheio; dificuldade de reverter | alta | §2 / A-10 |

---

## 14. Bloqueado e não verificado

**Bloqueado (precisa de autorização explícita):** qualquer escrita em produção; `tests/deployed.mjs`,
`tests/mfa-publico.mjs`, `tests/ocr-publico.mjs`, `tests/real-fetch.mjs` (tocam a aplicação em
produção ou a rede aberta); ensaio de durabilidade com `DATABASE_URL` real; deploy do Render.

**Não verificado:** comportamento com uma chave de IA válida (não existe neste ambiente —
nenhuma variável de IA está definida); fiabilidade do pollinations ao longo do tempo;
conteúdo servido em produção face ao HEAD; comportamento sob concorrência (dois `POST /runs` no
mesmo projecto); limites de memória em execuções exaustivas.

---

## 15. Conclusão da FASE A

A aplicação é **sólida naquilo que é verificável sem IA**: autenticação, isolamento de contas,
provas com hash encadeado, grafo construído a partir de registos, relatório determinístico,
pesquisa com filtros, cofre de chaves, retenção, OCR, quotas, catálogo de provedores e o
varrimento de APIs sem chave estão implementados **com testes que efectivamente passam**
(542 PASS, 0 falhas, 32 ficheiros, 100 verificações de interface em 9 suites).

O que **não funciona** é exactamente o que a missão coloca no centro: pergunta → investigação →
arquivo. Sem uma chave de IA que devolva JSON, o fluxo morre no passo 3–4 com zero documentos;
e quando funciona, segura o pedido HTTP até ao fim. Estes dois pontos, mais a taxonomia de
estados e a durabilidade, são os alvos naturais da FASE B.

Nenhuma linha de código de produção foi alterada nesta fase.
