# Agentes de recolha · o que podem e não podem fazer

Pedido original: *usar agentes/IA para recolher dados de forma real, fiável e segura*. A resposta
implementada não é «um bot que navega na internet»: é um **agente de recolha com provas**. Tudo o que
ele faz deixa rasto verificável; tudo o que faria mal está bloqueado no código, não apenas nas
instruções.

## Regra central

> Um agente pode **obter** um documento e **provar** que o obteve. Não pode **escrever no grafo**.
> A passagem de documento para relação é um acto humano, com fonte, excerto, data e estado de
> verificação — validado pelo portão de dados reais (`src/core/realdata.js`).

## Onde está

| Ficheiro | Papel |
| --- | --- |
| `src/core/agents.js` | Núcleo: validação de tarefas, guardas, extractores, execução, registo no livro |
| `tools/fetch-api.mjs` | **Agente local** (`POST /api/fetch`): as mesmas guardas, executadas no servidor, para ler `robots.txt` e contornar a ausência de CORS |
| `tools/serve.mjs` | Expõe `/api/fetch` e publica o próprio `robots.txt` |
| Consola → **Agentes de recolha** | Interface: selecção de tarefas, simulação vs execução real, resultados, exportação da prova |
| `tests/agents.mjs` · `tests/agents-ui.mjs` | 15 + 5 verificações automáticas |

## Guardas (aplicadas no código)

| Guarda | Detalhe |
| --- | --- |
| Simulação por omissão | Sem confirmação explícita, **nenhum pedido sai** — nem o `robots.txt`. Cada tentativa fica registada com o plano declarado |
| `robots.txt` | Obrigatório: o caminho é verificado antes do pedido; se proibido, a tarefa é **recusada** e o motivo apresentado |
| Apenas `http`/`https` | Outros esquemas (`file:`, `data:`, `ftp:`) são rejeitados |
| Anti-SSRF | Endereços locais/privados, `localhost`, `.internal`, `169.254.169.254` (metadados de nuvem) e IPv6 privados são recusados |
| Ritmo | Intervalo mínimo de 1500 ms por servidor, no máximo 20 pedidos por execução |
| Limites de resposta | 2 MB e 15 s por resposta; respostas maiores são rejeitadas com o motivo |
| Identificação | `user-agent: VN-Agent/1.0` — o operador é identificável, como manda a prática |
| Sem credenciais | Nenhuma chave, cookie ou token é guardado; sem sessões autenticadas |
| Sem escrita no grafo | O resultado de uma recolha nunca altera o modelo (verificado por teste) |

## Extractores determinísticos

`json` (caminho `a.b.0.c`), `csv` (separador e colunas), `html-table` (primeira tabela, com aviso de que
tabelas geradas em JavaScript não aparecem) e `regex` (com limite de correspondências). São
**determinísticos de propósito**: se a extracção falhar, o resultado diz «falhou»; não há tentativa de
adivinhar conteúdo — que é como um agente se torna uma fonte de invenções.

## O que fica registado

Para cada pedido: URL pedido, URL final, data/hora, estado HTTP, `content-type`, tamanho, `ETag`,
`Last-Modified`, **SHA-256 do corpo** e um recorte de 400 caracteres. No modo de agente local, o
navegador **recalcula o hash** do corpo recebido e compara com o do servidor
(`hash confirmado` / `hash diverge` na interface). Cada recolha é uma entrada `recolha` no livro de
provas com hash encadeado — a cadeia continua verificável depois de acrescentar recolhas.

Estados: `simulada` · `recolhida` · `recusada` · `erro-http` · `erro-extracao` · `falhou`.

## Prova real executada (2026-10-21)

```
fonte            dados.gov.pt — catálogo de dados abertos (API pública)
estado           recolhida
HTTP             200 · application/json · 10 311 bytes
sha256           789bc75cb95c1f5ac36b91a1bcfe76ac1e2fab29e1d8458e3e251709bcbb0b78
hash cliente     confere com o do agente (verificado no navegador)
extracção        {"total":20960,"primeiroTitulo":"Custo do empregador em Portugal: TSU da
                  entidade empregadora e 14 prestações (outubro 2026)"}
livro de provas  entrada «recolha» · cadeia intacta
grafo            inalterado (69 entidades / 126 relações)
```

Captura: `docs/shot-14-recolha-real.png`. Reproduzir: `node tests/real-fetch.mjs` (requer internet).

## Recusas reais observadas — e porque são a prova de que funciona

| Fonte | Resultado | Leitura |
| --- | --- | --- |
| `arquivo.pt/wayback/cdx` | `recusada` — `robots.txt` proíbe `/wayback/cdx` (e, por HTTP directo, 403) | O agente não insiste nem contorna |
| `api.ted.europa.eu/v3/notices/search` (GET) | `erro-http` 405 | A API exige POST; o agente não inventa um método |
| `diariodarepublica.pt/dr/pesquisa` | `recolhida` 200, extracção 0 correspondências | A listagem é construída no cliente: prova-se a obtenção, **não** se finge extracção |
| `base.gov.pt` | `recolhida` 200, extracção inútil | Idem; o URL final e o hash ficam guardados para revisão humana |

Estes quatro casos são preferíveis a «tudo verde»: mostram que o resultado de uma recolha é uma
afirmação verificável, não uma promessa.

## Como usar

1. Abrir a consola (*Investigar*) → separador **Agentes de recolha**.
2. Manter **Simulação**: vê o plano, os limites e o registo, sem contactar nenhum servidor.
3. Para executar a sério, confirmar **Execução real** (pede confirmação), com o **agente local**
   ligado (`/api/fetch`) — é ele que lê o `robots.txt` e devolve o corpo para verificação do hash.
4. Exportar «prova de recolha (JSON)» e anexar ao dossiê; ou abrir o **Livro de provas** e verificar a
   cadeia.
5. Levar o excerto à importação de **Dados reais**: aí é obrigatório indicar fonte, localização,
   excerto, estado de verificação e revisor.

## Limites e responsabilidades

- **`robots.txt` não é licença.** Permite rastejar; não autoriza reutilização. Os termos de utilização e
  os direitos de base de dados de cada fonte continuam a aplicar-se.
- Sem execução de JavaScript: páginas dinâmicas devolvem apenas o esqueleto. Não há tentativa de
  contornar isso com técnicas furtivas.
- Sem autenticação, sem *scraping* de áreas reservadas, sem recolha massiva de dados pessoais. Para
  dados pessoais aplica-se o RGPD: finalidade, minimização, prazo e base legal são decisões do
  investigador, não do agente.
- O agente não classifica culpas, não gera conclusões e não escreve alegações: os extractores devolvem
  campos; a interpretação é humana e fica assinada no livro de provas.
