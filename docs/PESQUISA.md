# Pesquisa profunda · como funciona e o que garante

A pesquisa é a porta de entrada do mapa. Tem de ser rápida e tolerante (nomes mal escritos, acentos,
grafias diferentes), mas **não pode inventar**: cada resultado é uma entidade ou uma relação que existe
no modelo, com identificador estável; o que aparece realçado é texto que está guardado no registo, não
texto gerado.

## Onde está o quê

| Ficheiro | Papel |
| --- | --- |
| `src/core/index.js` | Índice invertido: tokenização (minusculização, remoção de acentos, radicais), sinónimos, Dice, distância de edição, `suggest()` |
| `src/core/search.js` | Linguagem de consulta (`parse`), execução (`run`), excertos com `<mark>` (`snippet`, `highlight`), *porque casou* (`why`), ligações entre resultados (`connections`), fachas (`facets`) |
| `src/core/query.js` | `search()` delega em `VN.search.simple`; filtros, caminhos, vizinhos comuns, séries temporais |
| `src/ui/palette.js` | Paleta de comandos (`⌘K` / `Ctrl+K`): resultados agrupados, teclado, histórico recente, realce no mapa |
| `src/ui/searchpage.js` | Página de resultados completa: fachas, ordenação, ligações entre resultados, exportação, ajuda de sintaxe |

O índice é construído **uma vez, à primeira pesquisa** (`model._searchIndex`) e vive em memória. Não há
servidor de pesquisa, nem serviço externo: os dados não saem da máquina.

## O que se pode escrever

| Exemplo | Efeito |
| --- | --- |
| `aldevaran` | Termos em qualquer campo (nome, alias, identificador, factos, tipo de relação, excerto) |
| `VITOR SAMANIEGO` | Maiúsculas e acentos são irrelevantes: igual a `vítor samaniego` |
| `"beneficiário efectivo"` | Frase exacta: só resultados que contenham a expressão inteira |
| `aldevaran tipo:pessoa` | Filtro estruturado por tipo de entidade ou de relação |
| `estado:alegado` | Estado de verificação (`confirmado`, `alegado`, `não-verificado`, `contraditado`) |
| `ano:2016-2018` | Período (datas exactas ou estimadas dentro do intervalo) |
| `fonte:certidao` | Fonte/diploma referido na relação ou no documento |
| `aldevaran -documento` | Exclusão de termos ou de tipos |
| `financiamento sindicado bispo` | Vários termos: resultados ordenados por cobertura, com aviso quando a pesquisa foi alargada por sinónimos |

Tolerância a erros: `accionsta` → `accionista` (78 % de semelhança, assinalado como *aproximado*);
`aldoeravam` → `aldevaran` (sugestão apresentada quando não há resultados). O utilizador vê sempre
porque é que um resultado apareceu: as etiquetas dizem `encontrado em: nome, alias` ou
`aproximado: «accionsta» → accionista`.

## Três grupos de resultados

1. **Entidades** — pessoas, empresas, fundações, organismos, documentos, acontecimentos, transacções.
2. **Ligações e excertos** — relações tipificadas com fonte e excerto; abrir mostra a relação exacta.
3. **Ligações entre resultados** *(novo)* — quando dois resultados da mesma pesquisa estão ligados no
   modelo, a paleta mostra a relação que os une e a distância mínima. Isto responde a «o que é que estes
   dois têm a ver um com o outro?» sem sair da pesquisa.

## O que a pesquisa **não** faz

- Não funde entidades parecidas. `krasniqi` devolve 5 entidades distintas; homónimos ficam separados e
  o utilizador decide. A desambiguação é humana, documentada no `docs/SCHEMA.md`.
- Não infere relações a partir de co-ocorrência: se dois nomes aparecem no mesmo documento e o modelo
  não tem relação registada, a pesquisa diz exactamente isso.
- Não esconde o vazio: zero resultados é um resultado. A página de pesquisa mostra a cobertura real
  («procurado em 195 registos, 1146 termos indexados») e oferece **registar a ausência** no livro de
  provas, com termos, fonte e data.
- Não apresenta «o mais relevante» como «o mais importante»: a ordenação é explicável e alternativa
  (relevância, qualidade de prova, data, nome).

## Desempenho medido

Ambiente: Chromium headless, 1680×1000, **conjunto real** (46 entidades, 82 relações, 17 documentos).

| Operação | Resultado (medido em 2026-10-21) |
| --- | --- |
| Construção do índice | **24 ms · 128 documentos · 741 termos** |
| Pesquisa «Jeffrey Epstein» (média de 40) | **0,48 ms · 55 resultados** |
| Pesquisa «Epstein» / «Court» | 55 · 87 resultados |
| Pesquisa «deferred» | 0 resultados (a ausência é mostrada, não escondida) |

> Valores anteriores (67 ms · 195 documentos · 1146 termos · 0,3–0,4 ms) foram medidos sobre o
> conjunto fictício de 69 entidades e 126 relações, hoje retirado; ficam registados como histórico,
> não como estado actual.
| Pesquisa (média de 40) | **0,3–0,4 ms** |
| ~~`aldevaran`~~ (termo do conjunto fictício) | 41 resultados → 17 entidades + 24 ligações |
| `aldevaran -documento` | 39 resultados |
| `estado:alegado` / `estado:não-verificado` | 3 / 6 |
| `ano:2016-2018` | 33 resultados, todos dentro do intervalo |
| `financiamento sindicado bispo` | 19 resultados com aviso de alargamento por sinónimos |
| Ligações entre resultados | 3 directas + 8 vizinhos comuns, distância 2 |
| `aldoeravam` | 0 resultados + sugestão `aldevaran` |

Verificação automática: `node tests/search.mjs` → **17/17 PASS, 0 erros de consola**.

## Teclado

`⌘K` / `Ctrl+K` abre a paleta · `↑` `↓` percorrem · `Enter` abre o detalhe · `⇧Enter` carrega no mapa ·
`⌥Enter` abre a página completa · `Tab` filtra por tipo · `Esc` fecha. As pesquisas recentes ficam em
`localStorage['vn-recent-searches']` — apenas termos, nunca resultados nem dados de entidades.

## Limites assumidos

Sem radicais morfológicos completos (usa sinónimos declarados em `index.js`), sem pesquisa semântica por
embeddings, e o índice é reconstruído a cada carregamento. Se o modo real crescer para dezenas de
milhares de registos, o índice deve passar a incremental — a API (`build`, `run`, `suggest`) já está
separada da construção, pelo que a troca não afecta a interface.
