# Critérios de aceitação — verificação com resultados

Executado em Chromium 130 headless (1600×950) com `node tests/flow.mjs`.
Saída integral: `docs/TEST-RESULTS.txt`. Última execução (2026-10-21): **14/14 passaram, 0 erros de consola**,
mais 17/17 da pesquisa e 20/20 dos agentes de recolha.

| # | Critério | Como foi verificado | Resultado |
|---|---|---|---|
| 1 | Pesquisar uma entidade | `#search` → «Epstein» → (execução original: «Meridiano» → 13 resultados, conjunto fictício hoje retirado; com o conjunto real: 55 resultados) (entidades e ligações) com pontuação, motivo e excerto; abrir resultado centra o mapa | **PASS** (1,8 s incluindo animação) |
| 2 | Ver o nó com fotografia ou representação alternativa | nó tem `data:image/svg+xml` (avatar/logótipo) e o painel declara a proveniência (tipo, crédito, licença, fonte) | **PASS** |
| 3 | Expandir relações documentadas | tecla `E` → 14 → 28 entidades carregadas, com recálculo incremental | **PASS** (1,5 s, 23 ms de cálculo) |
| 4 | Identificar o significado de cada ligação | cada aresta tem `relLabel` tipificado (ex. `r-126 = "Foi assessorada por"`), espessura por confiança e estilo por estado | **PASS** |
| 5 | Consultar a fonte de uma relação | painel «Ligação» mostra fonte, localização (cláusula/página), excerto, data de verificação e acções | **PASS** |
| 6 | Distinguir factos, alegações e relações não verificadas | 58 entidades com factos com fonte; 3 alegadas; 6 não verificadas; 5 contraditadas; 5 estados distintos na legenda | **PASS** |
| 7 | Filtrar o grafo por período e categoria | período 2016–2018 → 27 arestas, **0** fora do intervalo; família `financial` → 8 arestas, **0** fora da família | **PASS** |
| 8 | Encontrar caminhos entre duas entidades | Vítor ↔ Joaquim, até 4 passos → 12 caminhos, nota de evidência, elo mais fraco assinalado, aviso «não prova coordenação» | **PASS** (2 ms, 1 017 nós explorados) |
| 9 | Inspeccionar a cronologia | 77 anos no domínio; selecção por arrasto; datas exactas vs mês/ano; 8 relações sem data listadas à parte como não projectadas | **PASS** |
| 10 | Exportar relatório que preserve as referências às provas | (execução original sobre o conjunto fictício) HTML com 252 referências `[r-nnn]`, 203 referências `[d-nnn]`, 250 excertos citados, secção de metodologia, aviso de dados fictícios, impressão digital do conteúdo | **PASS** (245 KB) |

## Verificações adicionais (além dos 10 critérios)

| Verificação | Resultado |
|---|---|
| Livro de provas detecta alteração de uma entrada antiga | **PASS** — cadeia quebrada, problema identificado na entrada 1 |
| Validador de IA rejeita afirmação sem fonte e confirmação sem fonte primária | **PASS** — 1 rejeitada com motivos, 1 aceite com fonte primária citada |
| Portão de dados reais recusa relações sem fonte/excerto | **PASS** — 4 erros de proveniência; esqueleto fornecido passa |
| Zero erros de runtime na consola | **PASS** |
| Acessibilidade: vista em tabela equivalente, `aria-*`, atalhos, foco visível, `prefers-reduced-motion` | implementado; vista em tabela testada manualmente |

## Testes de desempenho

Resumo em `docs/BENCHMARKS.md`; dados brutos em `docs/BENCHMARKS-raw.json` e
`docs/BENCHMARKS-perf.json`.

- Rede real (69 nós / 126 ligações): 39 fps em execução headless (47–50 em janela visível); filtros 26 ms;
  caminhos 2 ms; pesquisa de texto 0,3–0,4 ms por consulta.
- Escala (modo leve): 500 nós 25 fps · 1 000 nós 6 fps · 2 000 nós 3 fps · 5 000 nós 1 fps.
- **Limite assumido**: acima de ~420 nós o grafo degrada automaticamente e o produto usa carregamento
  progressivo + agrupamento para manter a interacção utilizável.

## Provas adicionais acrescentadas depois da entrega inicial

| Suite | Resultado | O que cobre |
|---|---|---|
| `tests/search.mjs` | **17/17 PASS, 0 erros** | Índice, acentos, gralhas, frases, filtros estruturados, excertos, ligações entre resultados, não-fusão de homónimos, sugestão, paleta, página de resultados, desempenho |
| `tests/agents.mjs` | **15/15 PASS** | Agentes de recolha: simulação sem contactos, hash SHA-256, `robots.txt`, ritmo, limites de tamanho e tempo, extractores, anti-SSRF, limite por execução, agente local |
| `tests/agents-ui.mjs` | **5/5 PASS, 0 erros** | Separador «Agentes de recolha»: guardas visíveis, simulação sem pedidos externos, recusa SSRF na interface, registo no livro de provas, grafo inalterado |
| `tests/real-fetch.mjs` | recolha real 200 / 10 311 B, hash confirmado | Fonte pública (`dados.gov.pt`), com prova exportável |
| `tests/console-tabs.mjs` | 6 separadores, validador OK | Consola completa, incluindo «Agentes de recolha» |

Capturas: `docs/shot-10-palette.png` (paleta), `shot-11-fuzzy.png` (pesquisa com gralha),
`shot-12-searchpage.png` (página de resultados com ligações entre resultados),
`shot-13-agentes.png` (guarda SSRF a recusar um endereço interno na interface) e `shot-14-recolha-real.png`
(recolha real de fonte pública com hash confirmado dos dois lados).

## O que não está feito (e não foi escondido)

- Sem back-end: tudo corre no navegador; não há sincronização multiutilizador nem assinatura digital
  das entradas do livro (apenas hash encadeado).
- Sem extracção automática de documentos (OCR/PDF): a recolha de provas é manual e validada.
- Os agentes de recolha **não escrevem no grafo** e não executam JavaScript de páginas dinâmicas;
  fontes que exigem POST autenticado ou renderização no cliente ficam fora do alcance automático
  (está registado em `docs/AGENTES.md`, com as recusas reais observadas).
- A ligação a uma IA é opcional e não é usada para preencher o grafo: as respostas entram como
  alegações sujeitas a verificação humana.
- Acima de ~500 nós visíveis, é necessário trocar o adaptador por WebGL (Sigma) — caminho previsto,
  não implementado.
