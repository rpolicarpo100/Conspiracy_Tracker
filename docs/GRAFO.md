# Grafo a partir de provas

Versão: 2026-10-21 · Código: `server/graph.mjs` (regras), `src/ui/evidence-graph.js` (desenho), rotas em `server/api.mjs` · Testes: `tests/graph.mjs` (13/13) e `tests/account-ui.mjs` (12/12)

O grafo da área de conta não é decorativo nem ilustrativo: **só existe o que está registado**, e cada
linha abre a proveniência. As três regras abaixo são impostas pelo servidor, não pela interface.

## 1. Uma linha não é prova

- Uma aresta só é criada se indicar pelo menos um `evidenceId` de uma prova **activa** (não retirada).
  Sem prova: `400 — «uma relação sem prova registada não entra no grafo»`.
- Prova inexistente ou retirada: `400 — «prova inexistente ou retirada: …»`.
- Cada aresta devolve `evidenceIds[]`, `evidenceCount`, `origins[]` e uma confiança **justificada**:

| `confidence.level` | Quando | Racional devolvido |
| --- | --- | --- |
| `corroborada` | ≥2 origens independentes e nenhuma prova contrária | «2 origens independentes» |
| `uma-so-origem` | uma só origem | «uma só origem: não sustenta conclusão, só a existência documentada da relação» |
| `contraditoria` | há prova contrária activa | «há prova contrária ligada (n)» |
| `sem-prova` | nenhuma prova acessível | «nenhuma prova acessível ligada a esta relação» |

A aresta contraditória é desenhada a vermelho e mais grossa; a inferida é tracejada. Não há gradiente
de «suspeita»: a cor da linha representa a **família da relação**, não uma opinião.

## 2. Co-ocorrência não é relação

- O servidor calcula pares de entidades que aparecem no mesmo documento e devolve-os em
  `candidates[]` com `kind: "co-ocorrencia"`, `notARelation: true` e a nota
  «aparecem no mesmo documento; isso não prova relação, direcção, nem intenção».
- Esses pares **não** entram em `edges`. Na interface só aparecem se o utilizador marcar
  «mostrar co-ocorrências», e aparecem como linhas pontilhadas cinzentas.
- Quando uma relação real é registada entre as duas entidades, o candidato desaparece (já não é uma
  hipótese em aberto).

## 3. Homónimos não são fundidos

- A chave de um nó é o **desambiguador** quando existe (`id:nipc 500000000`) e o nome normalizado
  quando não existe (`name:joao silva`).
- Dois «João Silva» com desambiguadores diferentes ficam **dois nós** (testado).
- Entidades sem desambiguador são contadas em `stats.entitiesWithoutDisambiguator` e assinaladas no
  painel («sem desambiguador: pode ser homónimo de outra entidade com o mesmo nome»).
- A relação transporta os desambiguadores dos extremos (`fromDisambiguator`/`toDisambiguator`), para
  que a aresta ligue exactamente os nós que as provas descrevem — sem criar cópias.

## 4. Relações inferidas

- `inferred: true` **exige** `reasoning` escrito; declarar raciocínio sem marcar `inferred` faz o
  servidor marcar a relação como inferida (não se aceita uma inferência disfarçada de facto).
- Aresta inferida: estilo tracejado, `style: "tracejada"`, legenda «relação inferida (não é prova)».
- `stats.inferred` conta-as separadamente.

## 5. Tipos

- **16 tipos de entidade**: pessoa, empresa, fundação, organização, Estado/organismo, instituição
  religiosa, tribunal, órgão de comunicação, documento, acontecimento, transacção, bem/activo,
  endereço, conta/veículo, contrato, tipo por determinar.
- **24 tipos de relação** em 7 famílias (propriedade, governança, financeiro, contratual, judicial,
  afiliação, documental), cada um com etiqueta direccional e `directed: true|false`.
- Relações simétricas (`transacted_with`, `contracted_with`, `public_contract_with`,
  `litigated_against`) são forçadas a `direction: "mutual"`: não se inventa uma direcção.
- Um tipo desconhecido é recusado com a lista de tipos válidos.

## 6. Retirar, nunca apagar

`DELETE /api/relations/{id}` exige motivo escrito (mínimo 5 caracteres), grava `retractedAt`/
`retractReason` e mantém o histórico. A relação sai do grafo e do relatório; o registo fica na
auditoria (`relation_retracted` com o motivo).

## 7. Interface

- Desenho em SVG próprio (sem bibliotecas novas): zoom com a roda, deslocamento por arrasto, procura
  por entidade, filtro por tipo de entidade, alternância de co-ocorrências.
- Clicar num nó ou numa linha mostra a proveniência: confiança, racional, provas pelo título,
  raciocínio (se inferida) e limitações.
- Legenda permanente com quatro avisos: linha sólida vs tracejada, vermelho = prova contrária,
  co-ocorrência ≠ relação, e «uma linha não é prova».
- A disposição é determinística (círculo inicial + relaxamento com distância mínima), para o mesmo
  grafo sair sempre igual.

## 8. Rotas

| Método e rota | Efeito |
| --- | --- |
| `GET /api/projects/{id}/graph` | nós, arestas, candidatos, legenda e estatísticas |
| `POST /api/projects/{id}/relations` | cria relação (exige prova; valida tipo, laço, inferência) |
| `PATCH /api/relations/{id}` | período, limitações, raciocínio, provas ligadas |
| `DELETE /api/relations/{id}` | retira com motivo |

Todas exigem sessão (CSRF nas que alteram estado); grafos e relações de outro utilizador devolvem
`404` sem revelar conteúdo (testado).

## 9. Caminhos, cronologia e contradições (implementados)

- **Caminho entre entidades** — `GET /api/projects/{id}/graph?from=<chave>&to=<chave>` faz BFS sobre
  as arestas registadas e devolve cada passo com tipo, confiança e provas. A resposta inclui sempre:
  «um caminho é uma sequência de relações registadas, **não prova de coordenação, intenção ou
  controlo comum**». Sem caminho: `found: false` com o motivo.
- **Cronologia** — `timeline.eventos` ordena acontecimentos e publicações das provas e os períodos
  das relações; cada evento aponta a prova (ou a relação) que o sustenta. Sem datas, a lista fica
  vazia com nota — não se inventam datas.
- **Contradições** — `contradicoes[]` reúne (a) arestas com prova contrária e (b) conclusões com
  provas favoráveis **e** contrárias, com a posição de cada prova. A ausência de contradições é
  apresentada como lacuna por preencher, não como confirmação.

## 10. Filtro temporal (implementado)

`GET /api/projects/{id}/graph?periodFrom=2021&periodTo=2023` recorta o grafo pelas datas
**declaradas** nas relações. Regras:

- os parâmetros chamam-se `periodFrom`/`periodTo` (ou `desde`/`ate`) para nunca colidirem com
  `from`/`to`, que no grafo são ids de entidades do cálculo de caminho;
- datas aceites: `AAAA`, `AAAA-MM`, `AAAA-MM-DD`; datas impossíveis (`2020-02-30`, mês 13) e
  janelas invertidas devolvem `400` — não são ignoradas em silêncio;
- uma relação **sem período** não pode ser excluída por data: fica incluída e é contada em
  `filter.relationsWithoutPeriod`;
- um período **aberto** («desde 2019») não tem fim inventado: sobrepõe-se à janela e é contado em
  `filter.relationsOpenPeriod`;
- a resposta traz `filter` com `relationsIncluded`, `relationsExcludedByPeriod`,
  `relationsWithoutPeriod`, `relationsOpenPeriod` e a nota que explica a inclusão;
- a cronologia acompanha o filtro (`timeline.filter.excludedByPeriod`).

## 11. Exportação (implementada)

| Formato | Onde é gerado | O que leva |
| --- | --- | --- |
| JSON | servidor (`/graph/export?format=json`) | nós, arestas com provas, confiança justificada, origens, candidatos, avisos, filtro aplicado, autoria |
| SVG | servidor (`?format=svg`) | desenho determinístico + legenda + avisos «uma linha não é prova» e o filtro aplicado |
| DOT | servidor (`?format=dot`) | grafo com `evidence_ids`, `style=dashed` nas inferências, cor por família |
| PNG | browser (botão «PNG») | rasteriza o desenho visível a 2×, com o fundo do serviço |

Todas exigem sessão; cada exportação é registada em auditoria (`graph_exported`, com formato,
nós, arestas e filtro). O SVG escapa conteúdo hostil (testado com `<script>` num nome).

Exemplo gerado pelo servidor: `docs/exemplo-exportacao-grafo.svg` — **captura histórica feita sobre
o conjunto fictício, hoje retirado** (filtro 2021–2023, 1 relação fora do período). Serve para mostrar
o formato do ficheiro, não o conteúdo actual; com o conjunto real as datas são as das decisões
(2010–2023) e não há relações de transacção.

## 12. Caminhos com restrições (implementado)

`GET /api/projects/{id}/graph?from=<chave>&to=<chave>` aceita ainda:

| parâmetro | efeito |
| --- | --- |
| `pathTypes=financed,subsidiary_of` | só atravessa relações destes tipos |
| `pathExcludeInferred=1` | não atravessa relações inferidas |
| `pathNotBefore` / `pathNotAfter` | janela temporal (AAAA / AAAA-MM / AAAA-MM-DD) |

A resposta traz `caminho.restricoes` com `arestasNoGrafo`, `arestasUsadas` e `arestasExcluidas`, e
`semPeriodo` quando algum passo não tem período declarado — esse passo é incluído e o aviso di-lo.
Quando não há caminho sob restrições, a razão distingue «não existe» de «não existe com estas
restrições». O aviso de sempre: um caminho não é prova de coordenação, intenção ou controlo comum.

## 13. Homónimos com identificador (implementado)

`POST /api/projects/{id}/entities/link` declara que duas entradas são a mesma entidade:

```json
{ "from": {"name": "A. Silva"}, "to": {"name": "Ana Silva"},
  "identifier": "NIPC 500000000", "identifierType": "NIPC",
  "reason": "mesmo registo comercial consultado em 2026-10" }
```

- **sem identificador (mínimo 4 caracteres) a operação é recusada** — é a diferença entre fundir e
  adivinhar;
- o identificador declarado passa a ser o desambiguador canónico do nó; o outro nome fica como alias;
- a ligação é **reversível** (`DELETE /api/entity-links/{id}` com motivo) e fica na auditoria
  (`entity_link_created`, `entity_link_retracted`);
- o grafo devolve `entityLinks` activos e `stats.mergedByLink`.

## 14. O que ainda não está feito

- **Extracção automática de entidades**: as entidades são declaradas por quem regista a prova (ou
  devolvidas como candidatos pelo passo 9/10 do motor, que ainda não as escreve).
- **Filtro por tipo de entidade/relação no servidor**: hoje é feito na interface, escondendo nós.
- **Sugestão automática de fusões**: o servidor não propõe candidatos a homónimos; só aceita ligações
  declaradas com identificador.
