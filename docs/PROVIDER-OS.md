# PROVIDER OS — catálogo com evidência, ranking, arquivo e motor de testes (fases 1–3)

Versão `2.0.0-fase4a` · esquema **v7** · código: `server/provider-catalog.mjs`, `server/store.mjs`,
rotas em `server/api.mjs` · testes: `tests/provider-os.mjs`, `tests/provider-tests.mjs`

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

Suite completa: **19 suites · 352 asserções · 0 falhas** no servidor e **6 suites · 53 · 0** na
interface (`docs/TEST-RESULTS.txt` §37–§38).

## 10. O que **não** está feito (declarado)

1. **Testes de geração (níveis 4–6) contra fornecedores reais** — exigem uma chave do utilizador. Sem
   ela, `BLOCKED`, não `PASS`. O caminho está provado com servidor sintético (marcado como tal), o que
   valida o nosso código mas **não** atribui nota a nenhum fornecedor.
2. **Selector automático e fallback** (fase 4): o ranking existe, a escolha por tarefa com
   justificação ainda não.
3. **Interface** (fase 7): dashboard de fornecedores, descoberta e benchmarks não têm ecrã próprio.
4. **Scheduler**: reavaliação periódica continua a não existir (nenhum timer no servidor).
5. **Ferramentas externas**: `opencode` está catalogado como ferramenta, **não integrado**; nada é
   instalado automaticamente.
6. **Terceiro olho por IA**: só existe o auditor determinístico.
7. **Custos agregados por utilizador**: o custo por tarefa é calculável; a soma mensal por fornecedor
   ainda não é apresentada.
