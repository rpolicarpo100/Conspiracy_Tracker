# Desempenho e escolha de biblioteca

Todos os números abaixo foram **medidos nesta máquina** (2 vCPU, 1 GB RAM, Chromium 130 headless,
renderização por software, sem GPU). Os ficheiros brutos estão em
`docs/BENCHMARKS-raw.json` e `docs/BENCHMARKS-perf.json`; podem ser reproduzidos com
`node tools/bench-libs.mjs` e `node tests/perf.mjs`.

> Aviso de leitura: em renderização por software os valores de FPS são pessimistas face a um
> portátil normal com GPU. As conclusões usam a **ordem de grandeza relativa**, não o valor absoluto.

## 1. Bibliotecas avaliadas

| Biblioteca | Versão | Licença | Manutenção | Milhares de nós | Imagens/logótipos por nó | Interacção | Acessibilidade | Veredicto |
|---|---|---|---|---|---|---|---|---|
| **Cytoscape.js** | 3.34.4 | MIT | activa (2025) | sim, com degradação | nativo (`background-image`, data URI) | zoom, selecção, eventos, layouts | DOM/ARIA adicional necessário; alternativa em tabela implementada | **adoptada** |
| cytoscape-fcose | 2.2.0 | MIT | activa | ~2000 nós em Node, muito lento | — | layout de qualidade | — | adoptada só para subgrafos pequenos |
| Sigma.js | 4.0.3 | MIT | activa | **sim** (WebGL) | WebGL: requer atlas/ícones | zoom/pan excelentes | fraca sem trabalho extra | **reservada** para >500 nós simultâneos |
| d3-force | 3.0.0 | ISC | activa | sim (cálculo) | não desenha | — | — | usada apenas como referência de layout |
| G6 (AntV) | 5.x | MIT | activa | sim | sim | rica, ecossistema chinês | média | avaliada, não adoptada (peso/empacotamento) |
| vis-network | 10.1.2 | Apache-2.0/MIT | activa | limitada | sim | média | fraca | rejeitada |
| react-force-graph | 1.48 | MIT | activa | sim (WebGL) | sprite atlas | boa | requer React | rejeitada (imporia React a uma app sem framework) |

Critérios que decidiram: (a) o módulo de dados está isolado num adaptador, pelo que a escolha é
substituível; (b) precisamos de **imagem/logótipo por nó com selo de verificação** — Cytoscape faz isto
sem atlas; (c) o volume simultâneo é controlado por desenho (carregamento progressivo), não por força bruta.

## 2. Comparação de layout (Node, sem renderização)

Rede sintética com distribuição em cauda longa (como redes de influência), 2,5 arestas/nó.

| Nós | Arestas | cytoscape + fcose | cytoscape + cose | d3-force (300 ticks) |
|---|---|---|---|---|
| 500 | 1 249 | **2,19 s** | 4,89 s | **0,74 s** |
| 2 000 | 4 999 | 33,2 s | 82,1 s | 3,99 s |
| 5 000 | 12 499 | não terminou em 15 min | não terminou em 15 min | 12,0 s |

**Consequência de desenho (a mais importante deste relatório):** recalcular a disposição de toda a rede
a cada acção é inviável. O adaptador passou a fazer **disposição incremental**: só os nós novos são
posicionados junto do contexto (`adapter.js → relayout`), com `fcose` limitado a subgrafos ≤ 420 nós e
recurso a `concentric` fora desse limite.

## 3. Aplicação real (69 entidades, 126 relações, imagens e etiquetas)

Medição de 2026-10-21, já com o índice de pesquisa em memória (`src/core/index.js`).

| Operação | Tempo |
|---|---|
| Carregar semente (14 nós) | 84 ms |
| Carregar rede completa (69 nós / 126 ligações) | 377 ms |
| Expandir ligações directas | 23 ms |
| Aplicar filtro (período ou família) | 26 ms |
| Procurar caminhos (até 5 passos) | 2 ms |
| Pesquisa de texto (média de 40, índice construído em 67 ms) | **0,3–0,4 ms** |
| FPS durante deslocamento contínuo | 39 (execução headless; em janela visível estabiliza em 47–50) |
| Heap JS | 10 MB |

A sincronização da rede completa subiu de 299 ms para 377 ms por causa do índice: a construção é
preguiçosa (só na primeira pesquisa) e não afecta o arranque do mapa.

## 4. Escala: limite real, medido

Contentor visível 1600×950, imagens SVG por nó, etiquetas activas.

| Nós | Ligações | Sincronização | Layout concêntrico | FPS modo completo | FPS modo leve (sem imagens/etiquetas) |
|---|---|---|---|---|---|
| 500 | 1 249 | 614 ms | 316 ms | 9 | **25** |
| 1 000 | 2 499 | 1 205 ms | 551 ms | 3 | **6** |
| 2 000 | 4 999 | 2 684 ms | 1 330 ms | 0 | 3 |
| 5 000 | 12 499 | 7 466 ms | 3 939 ms | 0 | 1 |

Comparação directa do efeito da degradação, 1000 nós (ensaio isolado):
com imagens **4 fps** → com classe `lite` (formas simples) **27 fps** → sem etiquetas 22 fps.
Ou seja: as imagens por nó são o factor dominante, não o número de arestas.

### Conclusões assumidas no produto

1. **Acima de ~420 nós o grafo degrada-se automaticamente** (`node.lite`): sem imagens nem etiquetas.
   O utilizador é avisado por mensagem, não silenciosamente.
2. **O caminho para redes grandes é o carregamento progressivo + agrupamento `+N`**, não mostrar tudo.
   Implementado: semente por grau, expansão por níveis, limite configurável por expansão, grupos de
   vizinhos não carregados, filtros por máscara (sem reconstruir o modelo).
3. **Acima de ~500 nós visíveis simultaneamente**, a solução correcta é trocar o adaptador por
   Sigma.js/WebGL ou por agregação prévia no servidor. O adaptador (`src/graph/adapter.js`) foi escrito
   para isso: a interface `init/sync/relayout/focusOn/highlight` não expõe Cytoscape ao resto da aplicação.
4. Não é honesto prometer "milhares de nós interactivos" com esta pilha neste hardware. É por isso que
   o produto **não** carrega a base de dados inteira no browser: a semente tem 14 nós e a rede cresce por
   pedido explícito do investigador.

## 5. Como reproduzir

```bash
npm install
node tools/bench-libs.mjs     # comparação de layouts (Node)
node tools/serve.mjs &        # servidor local em :8080
node tests/perf.mjs           # medições no browser (FPS, tempos)
node tests/flow.mjs           # testes funcionais dos 10 critérios de aceitação
```
