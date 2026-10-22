# FASE 1 — AUDITORIA PARA O «AI PROVIDER OS» (fase zero do pedido de 2026-10-22)

Este documento é a **Fase 1** do prompt master «AI Discovery, Provider OS, Autonomous Router &
Continuous Audit». Não é um plano abstracto: cada linha resulta de código lido, comando executado ou
teste corrido nesta sessão. Onde não houve verificação, está escrito `NÃO VERIFICADO`.

Data: 2026-10-22 · versão em produção `2.0.0-fase3g` (commit `aa5cfc6`) · esquema v6 · 76 rotas.

---

## 1. Stack real e pontos de entrada

| item | valor medido |
| --- | --- |
| Runtime | Node **v20.20.2**, npm 10.8.2 (`node -v`) |
| Servidor | `node:http` puro, sem framework — `tools/serve.mjs` → `server/api.mjs` (2 356 linhas, 76 rotas) |
| Ficheiros de dados do grafo | JS que preenchem `VN_DATA` no browser — `data/00-schema.js`, `data/real/10-epstein.js` |
| Persistência | **ficheiro JSON único** com escrita atómica + checksum + 3 cópias — `server/store.mjs` (816 linhas, esquema v6) |
| Autenticação | sessões opacas + CSRF + scrypt + papéis + TOTP — `server/auth.mjs`, `server/mfa.mjs` |
| Interface | JS sem framework, 14 módulos em `src/ui/`, Cytoscape local (sem CDN) |
| Dependências de produção | 3 (`cytoscape`, `cytoscape-fcose`, `tesseract.js`); dev: `playwright`, `d3-force`, `graphology` |
| Deploy | Render plano gratuito; disco **efémero** (`/ready` → `durableBetweenDeploys: false`) |

## 2. O que já existe e está comprovado (com o teste que o comprova)

| componente | onde | estado | prova |
| --- | --- | --- | --- |
| Router de fornecedores com 8 adaptadores OpenAI-compatíveis | `server/providers.mjs` | **existe e funciona** | `tests/server.mjs` (validação com/sem chave, 401≠avaria, timeout, circuit breaker, SSRF) |
| Cofre de chaves AES-256-GCM por utilizador, máscara, sem fuga | `server/crypto-keys.mjs` | **existe e testado** | `tests/server.mjs` «chave guardada é cifrada…», «administrador não vê chaves em claro» |
| Validação de fornecedor por chamada real (lista de modelos + geração mínima) | `providers.validateProvider` | **existe** | `tests/server.mjs` 4 casos |
| Circuit breaker + retry limitado + timeout | `providers.complete` | **existe** (em memória) | `tests/server.mjs` |
| Separação instrução/conteúdo e detecção de injecção em documentos | `research.mjs` (`SYS`, `injectionSignals`) | **existe** | `tests/research.mjs` |
| 13 agentes com contrato, orçamento por execução e histórico | `server/agents.mjs`, colecção `agentRuns` | **existe** | `tests/agents.mjs` 18/18, `agents-p3` 16/16 |
| Auditor adversarial **determinístico** (red-team local) | `agents.mjs::redTeamAudit` | **existe** | `tests/agents.mjs` |
| Registo de fontes com estados, verificações, classificações e decisões | `server/sources.mjs`, v6 | **existe** | `tests/fontes.mjs` 23/23, `fontes-ui` 10/10 |
| Catálogo + auditoria de APIs (segurança/fiabilidade/utilidade) com descoberta por OpenAPI | `src/core/apis.js`, `src/ui/apis.js` | **existe** | `tests/apis.mjs` 13/13; `docs/APIS-auditoria.json` |
| Utilização registada por chamada (`usage`: tokens, latência, ok) | `store.addUsage`, `store.usageSummary` | **existe** | `tests/server.mjs`, `/api/admin/metrics` |
| Checkpoints de projecto | `store.addCheckpoint` | **parcial** (ver §3) | `tests/fase3c.mjs` |
| Auditoria de eventos (50 000 máx.) | `store.audit` | **existe** | `tests/server.mjs` |

Baseline executada hoje, antes de qualquer alteração desta fase:

- `npm test` → **17 suites · 308 asserções · 0 falhas** (49 s).
- `npm run test:ui` → **6 suites · 53 asserções · 0 falhas** (84 s).
- `node tools/status.mjs --check` → coerente (2.0.0-fase3g · v6 · 13 agentes · 76 rotas).

## 3. O que existe mas é insuficiente para o pedido

| # | lacuna | evidência |
| --- | --- | --- |
| 1 | **Um só fornecedor por utilizador.** `aiRunner`/`agentAiRunner` escolhem a **primeira** credencial com `status === 'operational'`. Não há escolha por tarefa, nem alternativa, nem razão registada. | `server/api.mjs:375,405` |
| 2 | **Sem fallback.** Se essa credencial falhar a meio de uma investigação, o passo falha e a execução pára (`stop('resposta-invalida-de-ia')`). | `research.mjs:160-168` |
| 3 | **Custo sempre `null`.** Nenhum preço por token é conhecido nem calculado; `usageSummary` conta `costKnown` mas nada o preenche. | `store.mjs:762`, `api.mjs` (`cost: null`) |
| 4 | **Nenhum registo persistente de *testes de fornecedor*.** Guarda-se `status` e `lastError` na credencial; o resultado detalhado (etapas, latências, amostra) só existe na resposta HTTP e desaparece. Reiniciar a aplicação perde a evidência. | `store.setCredentialStatus` |
| 5 | **Circuit breaker só em memória** e indexado por `provider:model` global — reinício limpa-o; utilizadores partilham o mesmo estado. | `providers.mjs:85` |
| 6 | **Checkpoints rasos**: `{id, at, label, by, evidenceCount, claimCount}`. Não guardam objectivo, decisões, artefactos, hipóteses, próxima acção nem versão — não permitem retomar trabalho. | `store.mjs:525` |
| 7 | **Sem scheduler.** Nenhum `setInterval`/timer no servidor (grep): a reavaliação periódica não existe. | `grep -rn setInterval server/` → 0 |
| 8 | **Sem «terceiro olho» por IA.** O auditor existente é determinístico (regras). Não há revisão cruzada por um segundo modelo com contexto e critérios. | `agents.mjs::redTeamAudit` |
| 9 | **«Gratuitidade» declarada sem evidência datada.** `PROVIDERS[*].freeTier` é uma frase escrita à mão ("sim (com limites)") — não tem fonte, data nem teste. É exactamente o tipo de afirmação que o pedido proíbe. | `providers.mjs:34-70`, `docs/FORNECEDORES.md` §1 |
| 10 | **Sem ranking.** Não há pontuação por tarefa, nem exclusões por risco; a escolha é «a primeira credencial que existe». | — |
| 11 | **Sem perfis de prompt por tarefa.** Existem prompts fixos por passo (`promptFor`) e por agente, com versão em constante; não há biblioteca de perfis, nem registo do prompt renderizado que foi usado. | `research.mjs:336`, `agents.mjs:238` |
| 12 | **Sem orçamento de custo real**: `AGENT_BUDGET` limita chamadas, `project.budget` tem `maxCost` mas ninguém o verifica (não há preços). | `api.mjs`, `research.mjs` |

## 4. O que não existe de todo

- Catálogo de fornecedores/modelos com **evidência** (fonte oficial, data, versão) e histórico.
- Descoberta automática de fornecedores/ferramentas (o `discoverCatalog` existente descobre **APIs
  OpenAPI genéricas**, não fornecedores de IA nem modelos).
- Motor de testes em camadas (níveis 1–10 do pedido) com resultados persistidos `PASS/FAIL/BLOCKED/NOT_TESTED/STALE`.
- Ranking multidimensional com exclusões por risco e pesos por tipo de tarefa.
- Selector automático com justificação, alternativas e histórico de decisão.
- Adaptadores para ferramentas externas (`CodingAgentAdapter`, `SearchProviderAdapter`, …).
- Arquivamento de tarefas/checkpoints com contexto recuperável e concorrência optimista.
- Painel de dashboard/descoberta/benchmarks na interface (existem: Fontes, APIs, Agentes, IA).

## 5. Falhas reproduzíveis encontradas nesta auditoria

| # | falha | reprodução | estado |
| --- | --- | --- | --- |
| F1 | `tools/setup-ui-env.sh` **sobrescrevia** `tools/ui-env.sh` (o executor dos testes de interface) com um ficheiro para `source`. Resultado: `bash tools/ui-env.sh npm test` **não corria nada e saía com código 0** — pior do que falhar, porque parece sucesso. | `bash tools/setup-ui-env.sh && bash tools/ui-env.sh npm test` → 0 linhas, exit 0 | **corrigido** nesta fase: o setup escreve `tools/ui-env.generated.sh`; `ui-env.sh` carrega-o se existir. Re-testado: o runner volta a correr a suite |
| F2 | Num contentor novo, `npm test` falha com `ERR_MODULE_NOT_FOUND: playwright` e, sem servidor em `:8080`, `ERR_CONNECTION_REFUSED`. Não há pré-condição declarada no `package.json`. | contentor limpo → `npm test` | **documentado** (não é bug de produto; é pré-condição) |
| F3 | `docs/FORNECEDORES.md` afirma gratuitidade por fornecedor sem data nem fonte verificável. | leitura + `providers.mjs:34-70` | **a corrigir na fase de catálogo** (coluna «evidência» obrigatória) |

## 6. Riscos por prioridade

**P0 — impedem o objectivo ou a segurança**
1. **Disco efémero**: qualquer catálogo, teste ou checkpoint vive num ficheiro que um deploy apaga. Sem isto, «arquivo permanente» é uma promessa vazia. Mitigação possível sem custo: exportação/restauro testados e documentados; solução real: disco persistente ou Postgres (decisão do utilizador).
2. **Escolha de modelo sem critério nem alternativa**: qualquer trabalho de IA depende de uma única credencial. Uma falha transitória perde o trabalho do passo.

**P1 — funcionalidade real em falta**
3. Sem evidência persistida de testes de fornecedor (critérios 5 e 7 do pedido).
4. Sem ranking nem exclusões por risco (critérios 6 e 8).
5. Checkpoints que não permitem retomar (critérios 10–12).
6. `freeTier` sem prova (viola a regra «não afirmar gratuitidade sem verificar»).

**P2 — qualidade e operação**
7. Breaker em memória e global por `provider:model`.
8. Sem custo calculado (critério «custos e limites conhecidos» fica vazio).
9. Sem scheduler: reavaliação só manual.
10. Painel de operação inexistente para fornecedores/modelos.

**P3 — manutenção**
11. Dois módulos de auditoria com pesos diferentes (`apis.js` vs `sources.mjs`) sem nota de compatibilidade.
12. `api.mjs` com 2 356 linhas (extrair rotas seria refactor de risco; não fazer agora).

## 7. Mapa de dependências (existente → novo)

```
credenciais (cofre)  ──┐
                       ├─► aiRunner / agentAiRunner ──► research.mjs, agents.mjs, /complete
providers.mjs (8)   ───┘                                   │
                                                           ▼
                         ┌──────────── NOVO ────────────────────────────┐
                         │ providers-catalog (evidência + estados)      │ ← reutiliza vault, SSRF guard
                         │ provider-tests (níveis 1–10, persistidos)    │ ← reutiliza httpJson/complete
                         │ ranking (pesos, exclusões)                   │ ← lê testes + usage
                         │ selector (escolha + fallback + razão)        │ ← substitui a escolha «primeira credencial»
                         │ checkpoints profundos (contexto recuperável)  │ ← estende projects.checkpoints
                         │ prompt profiles + registo do prompt usado    │ ← reutiliza promptFor como base
                         │ third-eye (revisão por 2.º modelo)           │ ← reutiliza red-team determinístico
                         └─────────────────────────────────────────────┘
persistência (store v6) ──► migração v7 (aditiva) ──► novas colecções
```

## 8. Plano de implementação (ordenado por impacto × risco ÷ custo)

| fase | entrega | risco | reversível |
| --- | --- | --- | --- |
| **2 (agora)** | esquema **v7** aditivo: `providerCatalog`, `providerTests`, `providerRankings`, `selectionDecisions`, `checkpoints` profundos; catálogo com evidência datada; testes persistidos | baixo (só cria colecções) | sim (código antigo ignora) |
| 3 | motor de testes em camadas 1–6 com resultados `PASS/FAIL/BLOCKED/NOT_TESTED/STALE`, executável **sem chave** (existência/ligação) e **com chave** (geração/capacidades) | médio (rede) | sim |
| 4 | ranking + selector + fallback + limites de custo; razão da escolha gravada e visível | médio | sim |
| 5 | adaptadores de ferramentas (começar por leitura de repositórios/documentação; **nada instalado**) | médio | sim |
| 6 | perfis de prompt + terceiro olho (2.º modelo, contexto + critérios) | médio | sim |
| 7 | interface: dashboard, fornecedores, descoberta, benchmarks, selector, checkpoints | baixo | sim |
| 8 | auditoria final, regressões, relatório 20 pontos | baixo | — |

Regra de custo: **toda a fase 3–4 é testável sem chave** (endpoints públicos, catálogo OpenRouter
anónimo: 468 modelos, 18 `:free` — medido hoje). Sem orçamento de IA, o sistema continua a
descobrir, catalogar, testar ligação e ordenar por regras; o que fica limitado é a **geração**.

## 9. Critérios de aceitação verificáveis (20, do pedido) — estado inicial

| # | critério | estado inicial |
| --- | --- | --- |
| 1 | fornecedor no catálogo com fontes e estado | **NÃO IMPLEMENTADO** (existe catálogo de *fontes de dados*, não de fornecedores de IA com evidência) |
| 2 | classificação de acesso correcta | **PARCIAL** (`freeTier` sem evidência; sem `ANONYMOUS_PUBLIC`/`LOCAL_RUNTIME`) |
| 3 | distinguir descoberta/ligação/geração/integração | **PARCIAL** (`validateProvider` distingue `auth`/`model`/`generation`, mas não persiste) |
| 4 | falha de endpoint não confundida com modelo inexistente | **VERIFICADO** (`stage` explícito; teste `401 ≠ avaria`) |
| 5 | resultados persistidos e consultáveis após reinício | **NÃO IMPLEMENTADO** |
| 6 | rankings a partir de métricas e regras documentadas | **NÃO IMPLEMENTADO** (existem 3 dimensões para APIs, não para modelos) |
| 7 | recursos não testados não aparecem como verificados | **PARCIAL** (credencial `unverified` existe; catálogo não) |
| 8 | selector compatível com tarefa e restrições | **NÃO IMPLEMENTADO** |
| 9 | fallback seguro em falha transitória | **NÃO IMPLEMENTADO** |
| 10 | projecto retomável do último checkpoint | **PARCIAL** (checkpoint raso) |
| 11 | contexto transferido sem perder decisões | **NÃO IMPLEMENTADO** |
| 12 | concorrência não sobrescreve estado | **NÃO IMPLEMENTADO** (sem versão/`If-Match`) |
| 13 | arquivo restaurável de cópia | **VERIFICADO** (`/api/auth/backup` + `/restore`, teste em `fase3d.mjs`) |
| 14 | segredos fora de logs e respostas | **VERIFICADO** (`tests/server.mjs`, `seguranca.mjs`) |
| 15 | workflows canceláveis/retomáveis | **PARCIAL** (projecto: archive/cancel/resume; workflow: não) |
| 16 | regressões sem quebras | **VERIFICADO** hoje: 308 + 53 asserções, 0 falhas |
| 17 | erros e limitações explícitos | **VERIFICADO** (padrão `nao-executado` + motivo) |
| 18 | alterações críticas com rollback | **PARCIAL** (migrações aditivas + commits por fase; sem rollback automático) |
| 19 | dashboard com dados reais | **NÃO IMPLEMENTADO** |
| 20 | documentação reproduzível | **PARCIAL** (forte em fontes/PDF/OCR; ausente para provider OS) |

## 10. Limitações desta auditoria

- Não inspeccionei o código do Render, nem a conta GitHub (só o remoto por chave de deploy).
- Não testei nenhum fornecedor **com chave real**: não há chaves válidas nesta sessão e o pedido
  proíbe usar chaves alheias. Tudo o que envolve geração fica `BLOCKED` até o utilizador fornecer
  uma chave descartável ou autorizar as suas.
- Não medi custos: não há preços verificados no código e o pedido proíbe inventá-los.
- O ambiente de interface teve de ser reconstruído nesta sessão (`npx playwright install` +
  `tools/setup-ui-env.sh`), o que revelou a falha F1.
