# FASE E — APIs sem chave e selecção automática (entrega)

**Data:** 2026-10-23 · **Versão:** `2.4.0-faseE` · **Esquema da base:** v9 (migração que só cria a colecção)
**Origem:** achados G5/G6 e tarefas E1–E5 de `docs/PLANO-MELHORIA.md` e `docs/ESTADO-FUNCIONALIDADES.md`.

> Nada foi alterado à mão em produção. O deploy continua a ser o automático do Render. As leituras de
> produção ficam em §60 de `docs/TEST-RESULTS.txt`, feitas **depois** do deploy.

---

## 1. O que estava errado

| antes | consequência |
|---|---|
| o catálogo de APIs era um **relatório** de sonda (`docs/APIS-sem-chave.json`) com veredictos derivados | «sem chave» era uma etiqueta de um ficheiro, não um estado de uma API: sem data de decisão, sem histórico, sem forma de dizer «esta entrou em uso» |
| validar não existia como operação | não havia rota nem botão; validar era correr um workflow no GitHub e reler um ficheiro |
| nada impedia uma API de ser considerada utilizável por ter respondido 200 no catálogo de modelos | uma lista pública de modelos era lida como permissão de geração |
| a cascata de IA era uma ordem única, igual para todos os perfis | uma triagem de 2 minutos podia acabar no fornecedor mais lento e uma investigação exaustiva no mais barato — sem decisão registada |
| o fornecedor sem chave (texto livre, medido) era tentado em **todos** os passos | o passo gastava a chamada, recebia texto e registava «resposta-invalida-de-ia»: uma lacuna verdadeira produzida por uma tentativa sabidamente inútil |

---

## 2. O que mudou

### E1 — máquina de estados do catálogo (`server/apis-catalogo.mjs`, novo)

```
descoberto → em-analise → validado → em-uso
                    ↘ degradado ↗            ↘ descontinuado → em-analise
```

- Seis estados com significado escrito; lista de transições **fechada** (o que não está lá é recusado).
- `validado` exige **prova de geração** com pedido (método, URL https, modelo, `maxTokens`), resposta
  (código HTTP + excerto ou hash), data e **latência medida**. Uma lista de modelos pública não valida nada.
- `em-uso` exige estar validado, a prova existente, **confirmação explícita** e o passo onde é usada
  (`usaEm`). Validar não põe nada em uso.
- `degradado` exige falha observada e datada; `descontinuado` exige motivo.
- Cada transição guarda `{de, para, em, por, motivo, provaEm, falha}` no histórico — e é **reversível**
  (`revertLast`), inclusive voltando a `validado` (a prova que já existe continua a ser exigida).
- O varrimento externo importa entradas para **`em análise`**, com a prova marcada `varrimento-externo`,
  e **não reescreve** decisões tomadas por uma pessoa.

Rotas novas (sessão obrigatória; as de escrita exigem CSRF):

| rota | o que faz |
|---|---|
| `GET /api/apis/catalogo` | estados, transições, regras, resumo e entradas com última prova e último passo |
| `POST /api/apis/catalogo/sincronizar` | importa `docs/APIS-sem-chave.json` (nunca para `validado`) |
| `POST /api/apis/:id/validar` | faz uma **sonda real** (1 pedido, `max_tokens:1`) e registra a prova |
| `POST /api/apis/:id/uso` | passa a `em-uso` — exige `confirmar:true` e `usaEm` |
| `POST /api/apis/:id/reverter` | desfaz o último passo (fica no histórico) |

Na interface («Chaves de IA») há uma tabela com estado, última prova (data · HTTP · latência · excerto),
último passo do histórico e os botões **Validar**, **Pôr em uso** e **Reverter**.

### E2 — validação como operação de primeira classe

`validar` é uma rota + botão com resultado guardado e reversível. A prova diz sempre a **origem**:
`sonda` (medição real) ou `ensaio` (sonda substituída em testes) — nunca se apresenta um ensaio como
medição de produção. Uma sonda que **não** confirma geração fica registada na mesma e a entrada **não**
passa a `validado`; a resposta traz o aviso.

### E3 — router por perfil (`server/router-perfis.mjs`, novo)

```
rapida    → critério «latência», tecto 8 000 ms, degradado não
normal    → critério «custo»,    tecto 15 000 ms, degradado não
profunda  → critério «qualidade», tecto 30 000 ms, degradado sim
exaustiva → critério «qualidade», tecto 60 000 ms, degradado sim
```

`routeProvider({perfil, passo, candidatos})` decide e **escreve a razão**: critério, escolhido,
alternativa (e por que não venceu), rejeitados com motivo. Não escolhe quando não deve: sem estado
validado na aplicação, sem latência medida, sem passo ou com perfil inventado, a resposta é «não há
candidata» com a lista do que falta. Desempate determinístico pelo id.

`GET /api/ia/rotas` publica a política, os passos de IA, os candidatos com o que foi medido e a decisão
(por perfil, por passo, ou a tabela inteira). O registo do passo de pesquisa guarda agora `rota`
(cadeia e exclusões) — quem lê uma execução sabe quem podia ter servido.

### E4/E5 — texto livre nunca serve um passo que exige JSON

`PROVIDERS.pollinations` passa a declarar `produzJson:false` **com a prova** (execução real de
2026-10-23: HTTP 200 sem JSON utilizável). A cascata exclui-o dos passos que exigem JSON e **diz porquê**
(`emRota.excluidos` em `/api/ai/estado` e `rota.excluidos` no resultado da IA).

Consequência assumida e declarada: **sem chave de operador, os passos de IA ficam «não executado»** com
a lacuna `sem-fornecedor-de-ia-validado` — em vez de gastar a chamada para receber texto. A recolha de
documentos, os passos locais e o relatório continuam (FASE B). Não há IA inventada nem lacuna escondida:
há menos uma tentativa inútil.

---

## 3. Testado

| suite | resultado |
|---|---|
| `tests/apis-estado.mjs` (novo) | **18/18** — 6 estados, transições fechadas, 8 provas incompletas recusadas, `em-uso` com confirmação, degradar com falha datada, reversão com histórico, importação que nunca valida, servidor: sincronizar → validar → usar → reverter, sonda falhada registada |
| `tests/router-perfis.mjs` (novo) | **12/12** — mesma pergunta em 3 perfis escolhe 3 fornecedores diferentes, texto livre recusado em passo JSON, 4 recusas honestas, degradado só sem alternativa, determinismo, exclusão de pollinations com prova, rotas do servidor |
| `npm test` (38 ficheiros) | **613 PASS · 0 FAIL · saída 0** |
| `npm run test:ui` (9 suites) | **101/101 verificações · saída 0** (o `account-ui` ganhou a verificação da tabela do catálogo) |

Testes existentes ajustados por mudança de contrato (não desactivados):

- `tests/evidence.mjs`, `tests/agents-p3.mjs`, `tests/provider-os.mjs`, `tests/fontes.mjs` — versão de
  esquema 8 → 9 e cadeia de migração `…→8→9`; `tests/evidence.mjs` passou também a exigir que a
  colecção `apiCatalog` exista **vazia** depois da migração.

---

## 4. Riscos

| risco | avaliação |
|---|---|
| sem chave de operador deixa de haver IA (pollinations excluído dos passos JSON) | é a consequência declarada de E4/E5; a recolha e o relatório continuam e a lacuna é nomeada |
| a sonda de validação faz um pedido real ao fornecedor | 1 pedido, `max_tokens:1`, sem credenciais, com limite de tempo; o utilizador vê o resultado e pode reverter |
| validar e usar são operações de utilizador autenticado | exigem sessão + CSRF; a confirmação para `em-uso` é explícita |
| o router não decide nada hoje em produção (sem medições na aplicação) | é a resposta honesta: mostra o que falta (correr os testes de fornecedor) em vez de escolher por analogia |
| migração v9 | só cria a colecção `apiCatalog` vazia: não inventa APIs nem converte dados |

---

## 5. Fase seguinte (F — arquivo e persistência)

1. **F1** arquivo como destino do fluxo: `GET /api/projects/:id/archive` + separador «Arquivo», com
   versões e hash por documento e dossiê exportável.
2. **F2** durabilidade: ensaio com base descartável, `/ready` a dizer a verdade.
3. **F3** purga real com auditoria (depois de autorização) e **F4** suíte «Quem é José Sócrates?».
