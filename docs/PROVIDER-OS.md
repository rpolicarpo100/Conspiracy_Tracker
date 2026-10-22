# PROVIDER OS — catálogo com evidência, ranking, testes, selector e fallback (fases 1–4)

Versão `2.0.0-fase4a` · esquema **v7** · código: `server/provider-catalog.mjs`, `server/store.mjs`,
rotas em `server/api.mjs` · testes: `tests/provider-os.mjs`, `tests/provider-tests.mjs`, `tests/selector.mjs`, `tests/provedores-ui.mjs`

Este documento descreve **o que está implementado e medido** e, com o mesmo cuidado, o que ainda não
existe. A regra que governa tudo: uma afirmação no catálogo tem de trazer a evidência que a sustenta
(URL, data, método) ou fica marcada como «o fornecedor afirma» — nunca como facto.

## 1. O que mudou nesta fase

| antes | agora |
| --- | --- |
| «gratuitidade» escrita à mão em `providers.mjs` («sim (com limites)») | `access.class` com 7 classes + evidência datada por afirmação; `ANONYMOUS_PUBLIC` só com medição |
| nenhuma memória de testes de fornecedor (só `status` na credencial) | colecção `providerTests` imutável (nível, resultado, latência, método, motivo) |
| escolha do modelo = «a primeira credencial operacional» | ranking por tarefa com 8 dimensões, exclusões por risco e nota **provisória** quando falta prova |
| checkpoints `{label, contagens}` | `checkpoints` versionados com objectivo, contexto, decisões, artefactos, fontes, hipóteses abertas, próxima acção e critérios de conclusão + concorrência optimista (409) |
| esquema v6 | **v7** (5 colecções novas, migração aditiva; código antigo ignora-as) |

## 2. Catálogo: o que entra e porquê

7 classes de acesso (`ANONYMOUS_PUBLIC`, `FREE_API_KEY`, `FREE_TRIAL`, `PAID`, `LOCAL_RUNTIME`,
`UNKNOWN_ACCESS`, `UNAVAILABLE`), 10 estados (`DISCOVERED` → `DOCUMENTED` → `LINK_TESTED` →
`GENERATION_TESTED` → `RANKED` → `APPROVED`, e as descidas `DEGRADED`, `SUSPENDED`, `REJECTED`,
`DEPRECATED`), 4 estados de evidência:

- `DECLARED` — o fornecedor afirma, na fonte indicada (URL obrigatório). Não medimos.
- `MEASURED` — medido por esta aplicação, com **data e método** (obrigatórios).
- `STALE` — medido, mas com mais de 90 dias.
- `CONTRADICTED` — uma medição posterior desmentiu a afirmação.

Validação mecânica (`validateEntry`), testada: sem evidência, a entrada é **recusada**; `MEASURED`
sem data ou sem método é recusada; `ANONYMOUS_PUBLIC` sem medição de acesso sem chave é recusada;
qualquer cadeia que pareça uma chave (`sk-…`, `gsk_…`, `Bearer …`) é recusada.

### Semente medida em 2026-10-22

| entrada | classe | o que foi medido |
| --- | --- | --- |
| `providers/groq` | FREE_API_KEY | `GET /openai/v1/models` → **401**; `GET /chat/completions` → **404 «Unknown request URL»** (erro de caminho ≠ modelo inexistente) |
| `providers/openrouter` | FREE_API_KEY | catálogo público **200** (468 modelos, 21 com preço 0); a geração exige chave |
| `providers/gemini` | FREE_API_KEY | `GET /v1beta/models` → **403** «unregistered callers» |
| `providers/cerebras` | FREE_API_KEY | `GET /v1/models` → **403** «Not authenticated» |
| `providers/mistral` | FREE_API_KEY | `GET /v1/models` → **401** «Invalid API Key» |
| `providers/huggingface` | FREE_API_KEY | catálogo do hub **200**; **a lista do router responde 200 sem chave** — registado com essa distinção, e a inferência anónima **não foi tentada** |
| `providers/cloudflare` | FREE_API_KEY | apenas documentação (1 evidência `DECLARED`) — é a única entrada sem nada medido, e a interface diz isso |
| `tools/opencode` | LOCAL_RUNTIME | `GET https://opencode.ai/docs/` → **200** (99 209 B); registado como **ferramenta**, não como endpoint |

## 3. Descoberta real (sem chave)

| adaptador | fonte | resultado medido |
| --- | --- | --- |
| `openrouter_models` | `https://openrouter.ai/api/v1/models` | **468 modelos**, 21 com preço 0, **120 gravados** por execução (lote limitado; o resto é contado como `truncated`), ~100 ms |
| `hf_models` | `https://huggingface.co/api/models?limit=20&sort=downloads` | pesos de modelo — registados com `kind: weights` e acesso `UNKNOWN_ACCESS`, porque **um peso não é um serviço** |

Preços: o agregador publica USD **por token**; o catálogo converte para **USD por 1M** com fórmula
explícita (`preço × 1e6`) e guarda o valor original na evidência. Preço 0 é classificado
`FREE_API_KEY` e marcado como «promoção declarada pelo agregador» — não é anunciado como gratuito
para sempre.

## 4. Ranking: pesos explícitos, exclusões e provisório

Pesos do pedido, configuráveis por tipo de tarefa (`conversa`, `codigo`, `raciocinio`,
`investigacao`, `documentos`, `ferramentas`). Dimensões: qualidade 25 · fiabilidade 20 · segurança 15
· integração 10 · latência 10 · custo 10 · continuidade 5 · manutenção 5 (variam por tarefa).

- **Sem métrica não há nota.** A nota exige **≥40 % dos pesos medidos**. Sem testes de geração,
  `score: null` e «Classificação provisória — evidência insuficiente (só N% dos pesos medidos)»,
  com a lista do que falta. Há uma razão medida para o limiar: com uma única dimensão medida entre
  oito, o cálculo dava **20/100** e isso era lido como má nota; hoje devolve `null` e o motivo.
  (Correcção vinda dos testes: `scoreCandidate` passou a devolver `coveragePct`.)
- **Risco crítico exclui da produção** mesmo com nota 100 (testado).
- **Evidência com mais de 90 dias exclui** da recomendação até ser reavaliada (testado com 294 dias).
- **Não há vencedor universal**: a mesma candidata obtém 80 em `codigo` e 79 em `ferramentas`
  (testado) — a nota depende da tarefa, como deve ser.

## 5. Custo: calculado, nunca estimado

`POST /api/provider-os/cost` recebe os tokens **medidos** e usa o **preço publicado**:
1M de entrada + 0,5M de saída a 0,30/1,20 USD por 1M = **0,90 USD** (testado). Sem preço, ou sem
tokens reportados, devolve `usd: null` **com o motivo** — não inventa.

## 6. Arquivo de trabalho (checkpoints)

`POST /api/projects/:id/work` grava uma versão; `GET .../work` lista; `GET .../work/:versão` lê uma
versão antiga (imutável). Campos: `objective`, `state`, `context`, `decisions`, `artifacts`
(caminho+hash), `sources`, `verified`, `open`, `nextAction`, `doneCriteria`, `model`, `provider`.

Concorrência: enviar `ifVersion` com uma versão que já não é a actual devolve **409** com a versão
corrente — dois agentes não se sobrepõem em silêncio (testado em módulo e por HTTP).

> Nota de rota: o caminho é `/work` e não `/archive` porque `/api/projects/:id/archive` já existia
> (arquivar o projecto) e **a primeira rota ganha** — a colisão devolvia 200 com o projecto arquivado
> em vez do checkpoint. Foi detectada pelo próprio teste, não em produção.

## 7. Rotas novas

| rota | método | o que faz |
| --- | --- | --- |
| `/api/provider-os/meta` | GET | classes, estados, evidência, tipos de tarefa, pesos, exclusões, adaptadores |
| `/api/provider-os/catalog` | GET | catálogo com `?kind=`, `?access=`, `?q=` |
| `/api/provider-os/seed` | POST | carrega a semente validada (idempotente) |
| `/api/provider-os/discover` | POST | descoberta real (10/hora por utilizador) |
| `/api/provider-os/ranking` | GET | ranking por tarefa, com o que falta a cada linha |
| `/api/provider-os/cost` | POST | custo por tarefa com base medida |
| `/api/provider-os/test` | POST | motor de testes níveis 1–6 (níveis ≥4 exigem `confirmCost`) |
| `/api/provider-os/tests?key=` | GET | histórico imutável de testes por fornecedor |
| `/api/provider-os/selector/meta` | GET | 13 passos e política de fallback (fase 4) |
| `/api/provider-os/select` | POST | decisão do selector, gravada e auditada (fase 4) |
| `/api/provider-os/decisions` | GET | histórico de decisões (fase 4) |
| `/api/provider-os/fallback/plan` | POST | plano de fallback simulado, custo zero (fase 4) |
| `/api/projects/:id/work[/:versão]` | GET/POST | arquivo versionado com concorrência optimista |

Todas exigem sessão; as mutações exigem CSRF; descoberta e semente ficam em auditoria
(`provider_discovered`, `catalog_seeded`, `checkpoint_saved`).

## 8. Motor de testes em 6 camadas (fase 3)

`server/provider-tests.mjs` mede, nível a nível, e **nunca transforma ausência de prova em sucesso**:

| nível | nome | o que faz | resultado sem chave |
| --- | --- | --- | --- |
| 1 | existencia | pede a documentação: HTTP, latência, data | mede (não precisa de chave) |
| 2 | acesso | pede o endpoint sem chave: 200 / 401 / 403 classificado | mede |
| 3 | ligacao | com chave: autentica, lista modelos, confirma o modelo pedido | `BLOCKED` «sem chave» |
| 4 | geracao | uma geração real mínima (`max_tokens: 8`): conteúdo não vazio + tokens | `BLOCKED` (+ exige `confirmCost`) |
| 5 | capacidades | testa **só** o que o fornecedor declara (JSON, ferramentas); o resto `NOT_TESTED` | `BLOCKED` |
| 6 | fiabilidade | N amostras (≤5, pausa 350 ms): taxa de sucesso, p50/p95 medidos | `BLOCKED` |

Resultados: `PASS · FAIL · BLOCKED · NOT_TESTED · STALE`. Diagnósticos (12): `credencial-recusada`,
`sem-credencial`, `conta-sem-quota`, `caminho-errado`, `modelo-inexistente`, `nao-encontrado`,
`pedido-invalido`, `limite-utilizacao`, `erro-do-fornecedor`, `timeout`, `rede`, `proibido`.

Regras que os testes fixam:
- **404 de caminho ≠ 404 de modelo.** «Unknown request URL» é `caminho-errado` com a dica de corrigir o
  endpoint; só «model … not found» é `modelo-inexistente`. Um auditor que confunde os dois condena
  fornecedores bons.
- **Só 429, 5xx, timeout e rede são repetíveis.** 401/403 nunca: insistir com credencial recusada é
  ruído (e, em alguns serviços, risco de bloqueio).
- **Orçamento medido, não previsto**: o contador incrementa no instante em que o pedido sai para a
  rede. Padrão 4 pedidos (10 com geração), máximo 20; ao esgotar, os níveis seguintes ficam
  `BLOCKED` com o número exacto.
- **Redacção antes de guardar**: `Bearer`, `sk-`, `gsk_`, `hf_` e a chave usada desaparecem do registo.
- **Sem chave não se testa geração.** Fica `BLOCKED`, com motivo; o motivo sobrevive ao reinício.
- **SSRF**: o motor ignora `allowInsecure` das entradas; endereços privados só com
  `VN_TEST_PROVIDERS=1` e `127.0.0.1` (servidor de teste). Um catálogo público não pode ser usado
  para sondar a rede interna.
- **Sintético não pontua**: registos com `synthetic: true` são gravados (para provar o código) mas o
  ranking de produção ignora-os — verificado por teste.

Rotas: `POST /api/provider-os/test` (sessão + CSRF; `confirmCost: true` obrigatório para níveis ≥4;
resolve a chave em `providers/<id>` no cofre; grava por nível em `providerTests`; promove o estado
apenas com `PASS` — 1/2→`DOCUMENTED`, 3→`LINK_TESTED`, 4→`GENERATION_TESTED`; audita
`provider_tested`; regista consumo) e `GET /api/provider-os/tests?key=` (histórico imutável, últimas
100 de 200). O ranking passou a usar estes registos: taxa de sucesso e p50 do nível 4/6 entram como
métricas **medidas**.

## 9. Testes (resultado real de 2026-10-22)

`node tests/provider-os.mjs` → **25 asserções · 0 falhas**, em três camadas: módulo (13), base de
dados com reinício real (4), servidor HTTP real (8, incluindo descoberta real de 468 modelos em
~100 ms).

`node tests/provider-tests.mjs` → **18 asserções · 0 falhas**: módulo (6: níveis, diagnósticos,
404 duplo, redacção, sem chave, orçamento), servidor sintético em `127.0.0.1` (6: 401, chave boa/má,
geração vazia, capacidades declaradas, percentis, 429) e servidor real (6: `confirmCost`, BLOCKED
gravado, ligação real ao OpenRouter, limiar de 40 %, sintético fora do ranking, ferramenta sem
endpoint).

`node tests/selector.mjs` → **24 asserções · 0 falhas** (13 passos, restrições duras, fixação com
conflito, cobertura, orçamento/latência, capacidades, desempate determinístico, validade, plano
determinístico, tecto de tentativas, 429 vs 401, efeito externo, orçamento do fallback, PRNG, e 6
rotas HTTP).

Suite completa: **20 suites · 376 asserções · 0 falhas** no servidor e **7 suites · 61 · 0** na
interface (`docs/TEST-RESULTS.txt` §37–§39).

## 10. Selector automático com fallback (fase 4)

`server/selector.mjs` decide **quem** e **o que fazer quando falha**, em duas partes separadas de
propósito. Nenhuma das duas faz pedidos por si: quem chama injecta a função de chamada e de espera —
é o que permite testar as regras de dinheiro sem gastar um cêntimo.

### 10.1 Selecção em 13 passos (a ordem é a decisão)

| # | passo | o que faz | porquê |
| --- | --- | --- | --- |
| 1 | tarefa | classifica e escolhe os pesos | a mesma candidata vale notas diferentes por tarefa |
| 2 | restrições | elimina por privacidade, região, execução local | restrição dura elimina, não penaliza |
| 3 | fixação | honra o modelo fixado pelo pedido | trocar em silêncio um modelo fixado é desonesto |
| 4 | exclusões | risco crítico, sem geração, suspenso, evidência > 90 dias | há falhas que uma nota alta não apaga |
| 5 | evidência | exige ≥ 40 % dos pesos medidos | uma dimensão entre oito não é ranking |
| 6 | classificação | ordena pela nota da tarefa | só métricas medidas |
| 7 | orçamento | elimina quando o custo **medido** excede o máximo | custo desconhecido não é custo zero (fica assinalado) |
| 8 | latência | elimina quando o p50 medido excede o máximo | p50 medido, não promessa comercial |
| 9 | capacidades | exige PASS no nível 5 | declarado não é testado |
| 10 | disponibilidade | exige credencial e estado operacional | sem chave não executa |
| 11 | desempate | nota → fiabilidade → custo → chave | ordem estável: o resultado não depende da ordem do array (testado) |
| 12 | alternativa | nomeia a 2.ª e diz por que perdeu | uma escolha sem alternativa é uma imposição |
| 13 | registo | validade, data de reavaliação, o que a faria mudar | uma decisão sem prazo envelhece em silêncio |

Cada execução devolve os 13 passos com o que aconteceu em cada um, a lista de eliminadas **com
motivo e etapa**, a justificação legível, a alternativa com a razão da derrota e o que mudaria a
decisão. Se nada passar, **não há escolha**: `chosen: null` e `noChoiceReason` escrito.

Conflito declarado: se o fornecedor fixado for eliminado, o sistema **não** escolhe outro em
silêncio — devolve conflito com a etapa e o motivo.

### 10.2 Fallback: backoff + jitter, e o que nunca se repete

- **Plano puro** (`planFallback`): calcula tentativas e esperas sem fazer nada. A primeira
  tentativa de cada fornecedor não espera; as repetições usam backoff exponencial (500 → 1000 → …)
  com *jitter* completo (`[0, exp]`), tecto de 8 s, máximo de tentativas por fornecedor e total.
- **PRNG determinístico** (mulberry32): com `seed`, o mesmo plano sai igual — sem isto, «jitter»
  não seria testável e a alegação ficaria por provar.
- **Classificação do desfecho**: transitório (429, 5xx, timeout, rede) repete; **permanente**
  (401, 403, 404 de caminho, modelo inexistente, 400, quota) não repete e salta para o seguinte;
  **indeterminado** (o efeito externo pode já ter acontecido) **pára tudo** e exige confirmação.
  Princípio: repete-se uma leitura, não um pagamento.
- **Orçamento**: se o custo acumulado ultrapassar o limite, a execução pára no momento exacto e diz
  quanto gastou. Não há tentativas «só mais uma».

Testado: 24 asserções (`tests/selector.mjs`) — 12 no módulo de selecção, 6 na política de fallback
e 6 nas rotas HTTP, incluindo o caso honesto: catálogo carregado mas sem teste de geração → **não
escolhe** e regista a recusa.

### 10.3 Rotas novas

| rota | método | o que faz |
| --- | --- | --- |
| `/api/provider-os/selector/meta` | GET | 13 passos, restrições aceites, política de fallback por omissão |
| `/api/provider-os/select` | POST | selecção (catálogo ou candidatos explícitos), grava decisão + auditoria |
| `/api/provider-os/decisions` | GET | histórico imutável de decisões com justificação e alternativas |
| `/api/provider-os/fallback/plan` | POST | plano calculado, **sem pedidos e sem custo** |

### 10.4 Interface

Novo separador **Fornecedores de IA** na consola (`src/ui/provedores.js`): catálogo com evidência
datada, ranking por tarefa (com aviso quando não há nota), decisão do selector com justificação,
alternativa, eliminações e os 13 passos, e o plano de fallback com a política à vista. O botão de
testes **1–2 é grátis** (não usa chave); os níveis 3–4 pedem confirmação explícita porque gastam a
chave do utilizador. Captura: `docs/shot-30-provedores.png`.

## 11. O que **não** está feito (declarado)

1. **Testes de geração (níveis 4–6) contra fornecedores reais** — exigem uma chave do utilizador. Sem
   ela, `BLOCKED`, não `PASS`. O caminho está provado com servidor sintético (marcado como tal), o que
   valida o nosso código mas **não** atribui nota a nenhum fornecedor. Consequência visível: hoje o
   selector recusa escolher (nenhuma entrada tem nível 4) — é o comportamento correcto, não uma avaria.
2. **Executor real do fallback**: a política está implementada e testada (`runWithFallback`) mas **não
   está ligada a nenhum fluxo de produção** — de propósito, porque sem chave não há execução real e
   ligá-la antes disso seria um caminho pago sem prova. Quando houver chave, é uma chamada.
3. **Interface**: o separador «Fornecedores de IA» existe (catálogo, ranking, selector, plano); falta o
   painel de descoberta contínua e os benchmarks comparativos (fase 7).
4. **Scheduler**: reavaliação periódica continua a não existir (nenhum timer no servidor).
5. **Ferramentas externas**: `opencode` está catalogado como ferramenta, **não integrado**; nada é
   instalado automaticamente.
6. **Terceiro olho por IA**: só existe o auditor determinístico.
7. **Custos agregados por utilizador**: o custo por tarefa é calculável; a soma mensal por fornecedor
   ainda não é apresentada.
