# Plano de melhoria — Conspiracy Tracker (FASE A → H)

> Derivado **apenas** dos achados de `docs/AUDITORIA-INTEGRAL.md` e dos estados de
> `docs/ESTADO-FUNCIONALIDADES.md`. Cada tarefa tem critério de aceitação objectivo e
> uma experiência que a prova. Nenhuma tarefa deste plano autoriza alterações em produção:
> deploy e testes contra produção exigem autorização explícita do utilizador.

## Princípios que governam a ordem

1. **Primeiro o fluxo, depois a decoração.** Enquanto D1/D2 estiverem vermelhos, nada mais conta:
   um produto de investigação que não arquiva um documento não tem defeitos secundários.
2. **Cada alteração é pequena, reversível e provada por um teste que falha antes e passa depois.**
3. **Nada de funcionalidades novas enquanto a taxonomia (E2) e a independência de fontes (E3) não
   estiverem fechadas** — construir sobre elas agora propagaria o erro ao grafo, à UI e ao relatório.
4. **Zero invenções:** nenhuma resposta de IA sem JSON validado entra em registo; nenhuma relação
   sem prova registada; nenhum estado «confirmada» sem fonte independente.

---

## FASE B — Críticos (o fluxo tem de existir)

Objectivo: **pergunta → documentos arquivados → provas → relatório, sem depender de IA.**

| id | tarefa | achado | critério de aceitação (objectivo) | risco | tamanho |
|---|---|---|---|---|---|
| B1 | **Desacoplar recolha de IA**: se um passo de IA falhar, os passos `local`/`fetch` seguintes continuam; a execução termina em `concluido-com-lacunas` com lista explícita do que faltou | A-01, D1 | com 10 URLs e IA a devolver texto não-JSON, a execução arquiva 10 documentos, cria ≥ 10 provas e produz relatório marcado «sem IA nos passos X» — teste `tests/fluxo-sem-ia.mjs` | médio: altera o motor de execução | M |
| B2 | **Execução assíncrona**: `POST /runs` cria a execução, responde `202`+`runId` em < 500 ms e corre o fluxo fora do pedido; progresso por `GET /api/runs/:id` | A-02, D2 | medição: `POST` < 500 ms em todos os perfis; execução `exaustiva` corre 5 min sem cortar a ligação; teste com `sleep` injectado | médio (concorrência, um só processo Node) | M |
| B3 | **Cancelamento efectivo** entre passos e dentro de passos longos | A-05, D4 | `POST /cancel` durante uma execução faz o passo seguinte não arrancar; `steps` mostra onde parou; ≤ 1 passo de latência | baixo | S |
| B4 | **Retoma por checkpoint**: gravar `run.steps` + documentos já arquivados; `resume` continua no passo seguinte e não re-recolhe o que já tem hash igual | A-05, D5, B2 | matar o processo a meio, reiniciar, `resume` → termina; contagem de documentos não duplica | médio | M |
| B5 | **Cabeçalhos**: `frame-ancestors 'none'`, remover `'unsafe-inline'` do `script-src` (com nonce ou ficheiros externos), acrescentar `strict-transport-security` | A-06 | `curl -D -` mostra os três; as 9 suites de UI continuam verdes | baixo para `frame-ancestors`; **médio** para o nonce (mexe em HTML/JS) | S/M |
| B6 | **CI em PRs**: workflow `ci.yml` com `npm test` + `test:ui` + `audit:deps` em `pull_request` | I5, A-09 | abrir um PR com um teste partido → CI vermelho; PR limpo → CI verde ≤ 15 min | baixo (só CI) | S |
| B7 | **Arrumar a árvore**: commit separado do trabalho pendente da fase 12 antes de tocar no motor; `git diff` revisto | §2, A-10 | `git status` limpo antes da primeira alteração da missão; commits pequenos, um por assunto | baixo | S |

**Fecho da FASE B:** `npm test` verde com os novos testes; matriz actualizada; fluxo demonstrado em
execução real (não simulada) com e sem chave de IA.

---

## FASE C — Pesquisa e proveniência

| id | tarefa | achado | critério de aceitação | risco | tamanho |
|---|---|---|---|---|---|
| C1 | **Taxonomia única** de estados de afirmação, definida num só módulo e usada por servidor, UI, grafo e relatório: `facto-documentado`, `alegacao-atribuida`, `inferencia`, `hipotese`, `contraditoria`, `refutada`, `nao-verificada`, `insuficiente`, `desactualizada` (+ estados de fonte separados) | A-04, E2 | `GET /api/meta` publica exactamente esta lista; migração dos valores antigos com mapa explícito; teste percorre as 4 superfícies e falha se uma delas usar valor fora da lista | **alto** (migração de dados existentes) | M |
| C2 | **Independência de fontes**: agrupar por original (hash canónico, agência, DOI, título+data) e contar apoios *distintos* | E3 | duas páginas com o mesmo original → **1** apoio, com nota «reprodução de X»; teste injecta 3 cópias e exige 1 | alto (toca na classificação) | M |
| C3 | **Proveniência por afirmação**: cada afirmação guarda `{excerto, localização (página/parágrafo), documento, hash, data de recolha}`; o relatório imprime isso | F1, H3 | relatório de uma afirmação abre o excerto e a localização; nenhuma afirmação publicada sem os cinco campos | médio | M |
| C4 | **Procura activa de contraprovas** como passo obrigatório (não opcional por perfil) | D8 | para cada afirmação favorável, existe tentativa registada de contraprova; se nada for encontrado, `insuficiente`/`nao-verificada` — nunca `facto-documentado` | médio | M |
| C5 | **Desactualização**: campo de validade/data-limite por documento e regra de `desactualizada` | A-04 | documento com data-limite ultrapassada nunca sustenta `facto-documentado` | baixo | S |

---

## FASE D — Agentes e workflows

| id | tarefa | achado | critério de aceitação | risco | tamanho |
|---|---|---|---|---|---|
| D1 | Contrato de agente completo: `maxCalls`, `timeoutMs`, `maxItems`, `retries`, `cancelavel`, `entradas/saídas` tipadas e validadas | D6 | catálogo publica os seis campos; executor aplica-os; teste com agente que rebenta 2× e passa à 3.ª | médio | M |
| D2 | Orçamento por agente independente do global; esgotar um não mata os outros | D6 | execução com agente esgotado continua e regista `orcamento-esgotado` só nesse agente | médio | M |
| D3 | Registo por agente obrigatório (modelo, latência, tokens, resultado, erro) e visível na UI | D7, H3 | execução completa tem ≥ 1 registo por agente executado; a UI mostra-os no mesmo ecrã da execução | baixo | S |
| D4 | Workflows de investigação nomeados (ex.: `recolha-documental`, `verificacao-cruzada`) com passos, perfis e limites explícitos | §5 | cada workflow tem definição versionada e teste que corre o esqueleto sem rede | médio | M |
| D5 | `workflow_dispatch` seco para os 4 workflows existentes | I4 | cada workflow tem modo seco verde que não escreve dados | baixo | S |

---

## FASE E — APIs sem chave e selecção automática

| id | tarefa | achado | critério de aceitação | risco | tamanho |
|---|---|---|---|---|---|
| E1 | **Máquina de estados** do catálogo: `DESCOBERTO → EM_ANALISE → VALIDADO → EM_USO → DEGRADADO → DESCONTINUADO`, com data e evidência de cada transição | G6 | nenhuma API passa a `EM_USO` sem uma prova de geração registada (data, pedido, resposta, latência); a UI mostra a evidência | médio | M |
| E2 | **Operação de validação** de primeira classe: rota + botão, com resultado guardado e reversível | G6 | validar uma API na UI produz registo consultável e não altera a rota em uso sem confirmação | médio | M |
| E3 | **ProviderRouter por perfil**: rápido/normal/profundo/exaustivo × passo → fornecedor, com a razão registada | G2 | mesma pergunta em dois perfis escolhe fornecedores diferentes e justifica; teste com catálogo fixo | médio | M |
| E4 | **Nunca usar como JSON** um fornecedor que devolve texto livre; e nunca deixar a falta de IA bloquear a recolha | A-03, G5, B1 | passo que exige JSON e recebe texto → `nao-executado` com motivo, execução continua | baixo | S |
| E5 | Só fornecedores validados entram na cascata do operador; o pollinations fica como último recurso declarado | G5 | catálogo diz quem é «sem chave» e a UI avisa que é limitado | baixo | S |

---

## FASE F — Arquivo e persistência

| id | tarefa | achado | critério de aceitação | risco | tamanho |
|---|---|---|---|---|---|
| F1 | **Arquivo** como destino do fluxo: dossiê por investigação (pergunta, execuções, documentos com versões, provas, afirmações, relatórios, integridade) | F3 | `GET /api/projects/:id/archive` + separador «Arquivo»; cada documento tem versões e hash; o dossiê é exportável | médio | M |
| F2 | Durabilidade: Postgres activo com migração e `/ready` a dizer a verdade; ou declaração explícita e visível na UI de que o disco é efémero | B3, A-07 | com `DATABASE_URL`: criar → reiniciar → reler tudo; `durableBetweenDeploys:true` só quando for verdade | **alto** (dados) | L |
| F3 | Purga real com auditoria (depois de autorização) | A6 | numa base descartável, a purga remove exactamente o que declara e deixa rasto | alto | M |
| F4 | Ensaio de reinício a meio de execução, automatizado | B4 | teste que mata o processo e retoma, verde em CI | médio | M |

---

## FASE G — Interface e desempenho

| id | tarefa | achado | critério de aceitação | risco | tamanho |
|---|---|---|---|---|---|
| G1 | Separadores funcionais por área de trabalho: Investigação · Execuções · Documentos · Provas · Afirmações · Grafo · Relatório · Arquivo · APIs · Agentes · Administração; estado por URL | H2, H3, A-08 | cada separador abre directo por URL, mostra dados reais da sessão e passa no teste de «sem botões inertes» | médio | M |
| G2 | Vista de afirmação com proveniência lado a lado (excerto + localização + documento + contraprovas) | C3, H3 | dois cliques até ao excerto literal de qualquer afirmação | baixo | M |
| G3 | Teste que varre a UI à procura de botões sem função e de dados de exemplo | H6 | falha se encontrar botão sem handler ou texto de demonstração | baixo | S |
| G4 | Desempenho antes/depois com o mesmo corpus (`tools/auditoria/perf-carga.mjs`, já criado) | §10 | números antes/depois registados; nenhuma leitura acima de 100 ms a 300 provas; grafo paginado acima de 1 000 nós | baixo | S |

---

## FASE H — Regressão e validação

| id | tarefa | achado | critério de aceitação | risco | tamanho |
|---|---|---|---|---|---|
| H1 | **`tests/caso-socrates.mjs`** em `npm test`: «Quem é José Sócrates?» com documentos reais arquivados | F4 | ≥ 3 documentos arquivados com hash; ≥ 3 afirmações classificadas; ≥ 1 contraprova procurada; relatório com proveniência por afirmação; registo por agente; **recuperação após reinício**; passa sem chave de IA | médio (depende da rede: usar cache local de respostas para ser determinístico) | M |
| H2 | Suites novas: independência de fontes, cancelamento efectivo, retoma por checkpoint, taxonomia nas 4 superfícies | C1–C3, B3–B4 | cada defeito corrigido tem teste que falha na versão anterior (verificado por `git stash`) | baixo | M |
| H3 | Matriz de testes regenerada e publicada em `docs/MATRIZ-TESTES.md`; `TEST-RESULTS.txt` com bloco novo | — | matriz mostra 0 ficheiros com código ≠ 0 e 0 suites fora da cadeia sem justificação | baixo | S |
| H4 | Medição final antes/depois (desempenho, passos concluídos por perfil, documentos arquivados por perfil) | §10 | tabela comparativa com os números da FASE A | baixo | S |

---

## Dependências entre fases

```
B1 ─┬─> B2 ─> B3 ─> B4            (motor)
    └─> C1 ─> C2 ─> C3 ─> C4 ─> F1      (rigor documental e arquivo)
B6, B7 (higiene) podem correr em paralelo com B1
D* depende de B2 (execuções fora do pedido)
E* depende de C1 (classificação) e de D1 (contrato de agente)
G* depende de C3 e F1 (há onde mostrar proveniência e arquivo)
H* fecha: corre tudo o que antes falhava
```

## Autorizações necessárias (não incluídas neste plano como trabalho automático)

1. **Escritas em produção** (qualquer deploy, migração de dados, purga real).
2. **`DATABASE_URL`** para provar durabilidade com Postgres.
3. **Testes contra produção** (`deployed`, `mfa-publico`, `ocr-publico`, `real-fetch`).
4. **Chave de IA válida** para medir o fluxo com fornecedor real.

## O que este plano deliberadamente **não** faz

- Não acrescenta funcionalidades novas antes de B e C (nem «mais agentes», nem «mais vistas»).
- Não substitui a taxonomia por sinónimos nem mantém duas listas em paralelo.
- Não promete independência de fontes por heurística de título: exige chave canónica.
- Não converte o pollinations em solução: fica como último recurso declarado e limitado.
- Não mexe em produção sem autorização escrita do utilizador.

## Ordem recomendada de execução (primeira entrega)

`B7` (árvore limpa) → `B1` (recolha desacoplada) → `B6` (CI) → `B2`+`B3`+`B4` (execução assíncrona,
cancelamento, retoma) → `C1`+`C2` (taxonomia e independência) → `H1` (caso Sócrates) —
momento em que o produto passa a fazer, de ponta a ponta, o que a missão pede.
