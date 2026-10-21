# DADOS REAIS — «Epstein files» (o que foi obtido, e como se sabe que é verdade)

Documento de proveniência do conjunto que a aplicação abre hoje. Todos os números foram medidos
por `tools/import-epstein.mjs` e estão gravados em `data/real/PROVENIENCIA.json`.

## 1. Resumo

| item | valor |
| --- | ---: |
| Documentos aceites | **17** (decisões e despachos judiciais) |
| Candidatos rejeitados | **33** (com motivo registado) |
| Entidades | **46** (18 pessoas · 17 documentos · 5 tribunais · 3 organismos · 3 empresas) |
| Relações | **82**, todas com excerto literal |
| Consulta | `GET /api/rest/v4/search/?q="Jeffrey Epstein"&type=o` → 49 resultados |
| Fonte | CourtListener / Free Law Project (`courtlistener.com`), API REST v4, acesso anónimo |
| Custo | **0 €** |
| Data de recolha | 2026-10-21 (21:50 UTC) |

## 2. As três condições de entrada

Um documento só entra se **passar nas três**. Isto está no código, não é uma intenção:

1. **Foi descarregado pelo caminho normal da aplicação** (`fetchDocument`, com guarda SSRF, limite de
   tamanho, `robots.txt` e `User-Agent` identificado) — não veio de um proxy nem de um link colado.
2. **O texto extraído contém literalmente «Jeffrey Epstein».** A pesquisa por título e por excerto do
   motor de busca era insuficiente: apanhava homónimos (pessoas diferentes chamadas Epstein) e casos
   em que o nome só aparecia no título do processo. A menção tem de estar no texto do PDF.
3. **O SHA-1 conferido.** O CourtListener publica o SHA-1 de cada PDF; o importador calcula o SHA-1 do
   ficheiro que recebeu e compara. Se não coincidir, o documento é rejeitado. O SHA-256 é guardado
   sempre, como identidade do documento dentro da aplicação.

Consequência das 33 rejeições: maioritariamente documentos sem PDF publicado (`sem caminho de PDF
publicado`), alguns sem menção no texto, e alguns com limite de taxa atingido — os motivos estão um a
um em `PROVENIENCIA.json` → `rejected[]`.

## 3. O que as relações dizem — e o que não dizem

Quatro tipos, todos **processuais**:

| tipo | significado | quantas |
| --- | --- | ---: |
| `mentioned_in` | o nome ocorre no texto deste documento, com o excerto em volta | maioria |
| `documented_in` | o documento é a prova de que a entidade existe tal como é descrita | — |
| `ruled_on` | este tribunal proferiu esta decisão | — |
| `litigation_with` | as duas partes estão no mesmo processo | — |

Nenhuma aresta diz que alguém cometeu um crime, que houve coordenação, ou que duas pessoas se
conhecem. Uma aresta `litigation_with` significa exactamente «nomeadas no mesmo processo» — e é isso
que está escrito no campo `why` da aresta, na própria aplicação.

## 4. Verificação que qualquer pessoa pode repetir

```bash
npm run dados:epstein          # repete a importação (pedido a pedido)
node -e "console.log(require('./data/real/PROVENIENCIA.json').counts)"
```

Para conferir um documento à mão: abrir `canonicalUrl` no CourtListener, descarregar o PDF, e comparar
`sha1sum` com o valor em `publishedSha1`. O `sha256` é o do ficheiro que a aplicação guardou.

## 5. Limitações declaradas

- **17 documentos não são «os ficheiros do caso».** É o que a API pública devolveu com PDF acessível na
  data da recolha; o próprio resultado indicava 49 itens, e 33 não passaram. A cobertura é parcial e
  está descrita como parcial.
- **Só jurisdição dos EUA.** Não há processos de outras jurisdições neste conjunto.
- **Texto extraído, não interpretado.** As entidades foram obtidas das partes nomeadas e dos nomes
  mencionados; não há resolução de homónimos além do contexto do processo, e nomes repetidos em
  processos diferentes podem não corresponder à mesma pessoa — a aplicação não o afirma.
- **Nenhuma suspeita colectiva.** Não se agrupam pessoas por nacionalidade, religião ou etnia; não se
  criam «redes» por co-ocorrência.
- **OCR não foi usado neste conjunto**: todos os 17 PDFs tinham camada de texto. O OCR existe na
  aplicação (13 testes contra o serviço publicado) e é accionado quando o texto não é extraível.
