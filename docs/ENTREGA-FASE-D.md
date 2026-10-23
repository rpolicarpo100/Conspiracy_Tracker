# FASE D — agentes e workflows (entrega)

**Data:** 2026-10-23 · **Versão:** `2.3.0-faseD` · **Esquema da base:** v8 (sem migração nesta fase)
**Origem:** achados D6/D7 (§5) de `docs/AUDITORIA-INTEGRAL.md`, tarefas D1–D5 de `docs/PLANO-MELHORIA.md`
e o âmbito pedido pelo utilizador para a fase D: contrato completo de agente, orçamento **por agente**,
retry por agente, registo por agente visível no ecrã da execução, workflows de investigação nomeados
e `workflow_dispatch` seco nos quatro workflows.

> Nada foi alterado à mão em produção. O deploy é o automático do Render (`autoDeploy:true`), ligado
> pelo utilizador e que ele pode desligar. As leituras de produção ficam registadas em §59.10 de
> `docs/TEST-RESULTS.txt` **só depois** de acontecerem — não se antecipa resultado.

---

## 1. O que estava errado

| antes | consequência |
|---|---|
| 13 agentes declaravam `timeoutMs`/`maxItems`, e mais nada | sem `maxCalls`, `retries` nem cancelamento: um agente podia repetir indefinidamente e nada o parava |
| a saída de um agente era aceite desde que o fornecedor respondesse `ok` | resposta vazia, JSON inválido ou fora do contrato podia entrar como sucesso |
| orçamento só global (execução) | esgotar um agente caro parava **todos**, mesmo os locais que não custam nada |
| nenhum registo de tentativas | «falhou» não dizia se foi o fornecedor, o formato ou o contrato |
| cancelamento inexistente no executor de agentes | cancelar a execução não impedia a chamada seguinte de um agente |
| o passo 15 (contraprovas) era `ia` | sem chave, a verificação mais importante do produto ficava vazia |
| workflows de investigação não existiam como definição | os 20 passos corriam sempre todos; nenhum plano era verificável antes de correr |
| os quatro workflows de operação não tinham disparo manual | não se podia ensaiar sem esperar pelo `schedule` |

---

## 2. O que mudou

### D1 — contrato aplicado, não declarado (`server/agents.mjs`)

Cada um dos 13 agentes passou a declarar cinco limites e a saída obrigatória:

```
limits:   { timeoutMs, maxItems, maxCalls, retries, cancelavel }
contract: { in, out, outRequired: [...] }
```

| agente | timeoutMs | maxItems | maxCalls | retries |
|---|---|---|---|---|
| `orchestrator` | 5000 | 50 | 1 | 0 |
| `web-search` | 30000 | 20 | 3 | 2 |
| `extraction` | 30000 | 30 | 3 | 1 |
| `research-planner` | 30000 | 12 | 2 | 2 |
| `timeline` | 5000 | 500 | 1 | 0 |
| `red-team` | 8000 | 500 | 1 | 0 |

…e os restantes com o mesmo formato (`cancelavel:true` em todos). Tentativas = `min(1 + retries, maxCalls)`.

`validateAgentOutput()` verifica `outRequired`: um campo em falta é **falha de contrato**, não sucesso
vazio; um array acima de `maxItems` é **cortado** e o corte fica registado (`truncado: {campo:{tinha,ficou}}`).

### D2 — orçamento por agente

`run.chamadas` conta as chamadas **daquele** agente. Esgotar as chamadas termina em
`orcamento-esgotado` e o motivo diz quantas foram e qual o último erro. Os outros agentes da execução
não são afectados (provado em `tests/agentes-contrato.mjs`).

Estados de execução de agente: `concluido` · `falhou` · `orcamento-esgotado` · `cancelado` · `nao-executado`.
Falta de chave num agente com `outRequired` é **`falhou`**, nunca sucesso vazio.

### D3 — registo por agente, visível onde a execução acontece

Cada execução guarda:

```
contrato{timeoutMs,maxItems,maxCalls,retries,cancelavel}
tentativas[{n, ok, provider, model, latencyMs, erro}]
chamadas · truncado · cancelado
```

Na interface (`src/ui/account.js`) a lista de execuções ganhou a coluna **«contrato aplicado»** e, por
execução, tentativas/chamadas/modelo/corte; abaixo, a secção **«Registos de agente guardados neste
projecto»** mostra as últimas 12 execuções com o mesmo detalhe — no ecrã da execução, não noutro sítio.

### D4 — workflows de investigação nomeados (`server/workflows.mjs`, novo)

Quatro definições versionadas (`WORKFLOW_VERSION = 'w1'`), todas nomeando passos **reais** do motor:

| workflow | perfil | passos | IA | limites |
|---|---|---|---|---|
| `triagem-rapida` | rapida | âmbito · primárias · secundárias · recolher (4) | não | 0 chamadas · 3 documentos · 2 min |
| `recolha-documental` | normal | + resolver · deduplicar · verificar · lacunas (8) | não | 0 · 8 · 10 min |
| `verificacao-cruzada` | profunda | resolver · deduplicar · verificar · corroborar · contraprovas · lacunas · grafo (7) | sim (contraprovas) | 6 · 20 · 20 min |
| `relatorio-rastreavel` | normal | verificar · corroborar · lacunas · grafo · relatório · revisão (6) | não | 0 · 0 · 5 min |

`validateWorkflow()` recusa: passo inexistente, passo repetido, ordem fora da ordem do motor, perfil
desconhecido, limite acima do perfil, passo de IA fora do perfil, e «diz sem IA mas usa IA» (ou o
contrário). `skeleton(id)` é **cálculo puro** — nenhum `fetch`, nenhum acesso ao store, nenhuma chave.

Rotas novas (com sessão obrigatória):

- `GET /api/workflows` — definições + validação + necessidades (`precisa.chave`, `precisa.urls`) + limites efectivos;
- `GET /api/workflows/:id` — esqueleto do plano (passos, fase, tipo, o que cada um precisa) + validação.

### D5 — passo 15 sem depender de IA (`server/research.mjs`)

O passo `contraprovas` tem agora cálculo local equivalente (`case 'contraprovas'`): devolve
`{semProcura[{conclusao,texto,estado,falta}], comContra, totalAaProcurar, nota}`. Quando a IA falha
nesse passo, o passo **corre na mesma**, o registo diz «calculado sem IA» e é acrescentada a lacuna
`calculado-sem-ia`. Não se inventa contraprova: diz-se o que falta procurar.

### D5b — `workflow_dispatch` seco

- `manutencao.yml`: input booleano `seco` (por omissão `true`); a purga só corre com
  `if: github.event_name == 'schedule' || inputs.seco == false`.
- `reevaluate.yml`: passo «Verificar o serviço (modo seco)» que só lê `/health`.
- `ai-quota.yml` e `keyless-scan.yml`: já tinham `workflow_dispatch`; verificado por teste.

---

## 3. Testado (execução desta sessão)

| suite | resultado |
|---|---|
| `tests/agentes-contrato.mjs` (novo) | **10/10** — contrato, saída fora do contrato, corte de itens, retry, orçamento por agente, cancelamento antes e entre tentativas, contraprovas sem IA, modos secos |
| `tests/workflows-investigacao.mjs` (novo) | **10/10** — definições válidas, passos reais e ordenados, limites dentro do perfil, 7 definições erradas recusadas, esqueleto com **0 chamadas de rede**, necessidades declaradas, limites efectivos, workflow inventado recusado, rotas com sessão |
| `npm test` (36 ficheiros) | **583 PASS · 0 FAIL · saída 0** |
| `npm run test:ui` (9 suites) | **100/100 verificações · saída 0** |

Duas asserções antigas de `tests/agents-p3.mjs` foram **corrigidas, não desactivadas**: com orçamento
por agente, três respostas inválidas seguidas esgotam `web-search` (estado `orcamento-esgotado` em vez
de `falhou`) — o teste passou a aceitar os dois estados **e** a exigir que nenhuma saída inválida seja
guardada e que as tentativas inválidas fiquem registadas como inválidas.

Além dos testes, verificação manual na API local: `GET /api/workflows` (4 workflows, todos `valido:true`),
`GET /api/workflows/recolha-documental` (8 passos, limites efectivos `0/8/10`), `GET /api/workflows/inventado`
→ 404 com a lista do que existe; `/health` → `2.3.0-faseD`.

---

## 4. Falhas encontradas durante a fase (e o que se fez)

| falha | causa | correcção |
|---|---|---|
| o corte de itens não aparecia nas execuções | `(truncado || {})[k] = …` escrevia num objecto temporário | atribuição explícita `truncado = truncado || {}; truncado[k] = …` |
| tentativas inválidas apareciam com `ok:true` | o registo era criado antes de validar a saída e nunca corrigido | o registo passou a ser marcado `ok:false` com o erro concreto («resposta não é JSON válido», «saída fora do contrato: falta …», erro do fornecedor) |
| `tests/agents-p3.mjs` passou a falhar | esperava `falhou` onde agora há orçamento esgotado | teste ajustado ao contrato novo, com exigências adicionais (ver §3) |
| `npm test` não arrancava neste ambiente | faltava `node_modules` e o Chromium sem bibliotecas de sistema (`libnspr4.so`) | `npm install` + `npx playwright install chromium` + `bash tools/setup-ui-env.sh` (ambiente, não produto) |

---

## 5. Riscos

| risco | avaliação |
|---|---|
| retry por agente gasta mais chamadas do que antes | contido por `maxCalls` por agente e pelo orçamento global; o estado diz quando foi o orçamento que parou |
| `verificacao-cruzada` depende de IA para contraprovas | se não houver chave, o passo corre localmente e é marcado «calculado sem IA» (lacuna explícita) |
| workflows nomeados não executam um subconjunto (correm o motor inteiro) | **declarado**: hoje são definição + plano verificável; a execução selectiva por workflow é trabalho da fase E/G — não se anuncia o que não existe |
| produção continua em `2.2.0-faseC` até o Render reconstruir | `/health` publicado dirá a versão; ver §59.10 de `docs/TEST-RESULTS.txt` |

---

## 6. Fase seguinte (E — APIs sem chave e selecção automática)

1. **E1** máquina de estados do catálogo (`DESCOBERTO → EM_ANALISE → VALIDADO → EM_USO → DEGRADADO → DESCONTINUADO`) com data e evidência de cada transição.
2. **E2** validação de primeira classe: rota + botão, resultado guardado e reversível.
3. **E3** `ProviderRouter` por perfil × passo, com a razão da escolha registada.
4. **E4/E5** nunca tratar texto livre como JSON; só fornecedores validados entram na cascata.

Por fazer fora da fase E, e já escrito para não parecer esquecimento: **F3** arquivo/dossiê,
**F4** suíte «Quem é José Sócrates?» com documentos reais (fase H) e **I5** CI a correr num PR real.
