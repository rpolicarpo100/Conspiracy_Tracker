# APIs externas · catálogo, auditoria e agente de descoberta

A app não deve depender de APIs: deve **saber quais pode usar, com que provas e com que limites**.
Este módulo existe para isso — e para impedir a tentação de «ligar a tudo o que responde 200».

## Três partes

| Parte | Onde | O que faz |
| --- | --- | --- |
| **Catálogo curado** | `src/core/apis.js` → `CATALOG` | 12 APIs com licença, autenticação, o que respondem e — sobretudo — o que **não** provam |
| **Auditoria** | `auditOne` / `auditAll` | Faz pedidos reais pelo agente de recolha, mede e pontua segurança, fiabilidade e utilidade **com razões** |
| **Descoberta** | `discoverCatalog` / `auditCandidate` | Procura APIs no catálogo APIs.guru (metadados OpenAPI, CC0), obtém a especificação e deriva um pedido GET seguro — ou diz que não consegue |
| **Interface** | Consola → separador **APIs** (`src/ui/apis.js`) | Tabela, detalhe por dimensão, formulário «Adicionar API», exportação do relatório, registo no livro de provas |
| **CLI** | `node tools/audit-catalog.mjs --attempts=3` | Audita o catálogo inteiro e grava `docs/APIS-auditoria.json` |

## Como se pontua (pesos explícitos em `src/core/apis.js`)

**Segurança (0–100)** — TLS (25) · sem downgrade de protocolo (10) · HSTS (10) · CORS seguro ou ausente
(10) · `robots.txt` permite (10) · sem chave na query string (15) · CSP/XCTO/Referrer-Policy (10) ·
nenhuma credencial introduzida (10). Falhas bloqueantes: TLS ausente ou não verificável, `robots.txt`
proibitivo, CORS wildcard **com** credenciais.

**Fiabilidade (0–100)** — 3 pedidos: disponibilidade (40) · latência mediana (25) · tipo de conteúdo
estável (15) · erros honestos: recurso inexistente devolve 4xx (15). Se a resposta for `401/403` com
autenticação declarada, não é tratada como avaria: é registada como «exige credenciais».

**Utilidade (0–100)** — valor curado e justificado (60) · estrutura da resposta: JSON válido e campo
esperado presente (20) · cobertura: descreve entidades/ligações vs. agregados (20).

Veredictos: `aprovada` (todas as dimensões ≥ 75) · `condicional` (≥ 55) · `rejeitada` · `fora-do-âmbito`
(tecnicamente sólida, mas descreve agregados) · `nao-auditada` (demasiado grande para o agente).

## Auditoria real (2026-10-21, via agente local, 3 tentativas)

| API | seg | fia | uti | veredicto | HTTP | latência mediana |
|---|---|---|---|---|---|---|
| GLEIF — LEI | 100 | 95 | 93 | **aprovada** | 200 | 284 ms |
| VIES — NIF intracomunitário | 80 | 80 | 83 | **aprovada** | 200 | 327 ms |
| Diário da República — pesquisa | 100 | 80 | 85 | **aprovada** | 200 | 161 ms |
| TED — contratação UE | 100 | 80 | 87 | **aprovada** | 405 (exige POST) | 219 ms |
| Wikidata — REST search | 95 | 80 | 74 | condicional | 200 | 165 ms |
| dados.gov.pt — catálogo | 100 | 74 | 90 | condicional | 200 | 507 ms |
| data.europa.eu — hub | 95 | 74 | 66 | condicional | 200 | 580 ms |
| APIs.guru — catálogo | 80 | 80 | 72 | condicional | 200 | 269 ms |
| Eurostat — estatísticas | 80 | 80 | 53 | fora do âmbito | 200 | 196 ms |
| World Bank — indicadores | 85 | 64 | 29 | fora do âmbito | 403 | 28 ms |
| Portal BASE — contratos | 80 | 15 | 75 | **rejeitada** | — | — |
| EU — sanções (XML) | 65 | 15 | 74 | não auditada (≈19,5 MB) | — | — |

Metodologia e razões completas por API: `docs/APIS-auditoria.json`.

### O que estas recusas ensinam

- **Portal BASE**: o certificado TLS do portal não valida com a cadeia fornecida
  (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`). O agente **recusa** — é o comportamento correcto, mesmo que o
  browser consiga abrir a página. Para citar contratos do BASE: obtê-los manualmente, guardar o PDF e
  registar a data de consulta no livro de provas.
- **Wikidata**: o `robots.txt` proíbe `/w/` a rastreadores. A tarefa declara a política `api-terms`
  (cliente de API com UA identificado, 1 pedido pontual) e essa decisão fica **escrita** no livro de
  provas. Sem justificação escrita, a recolha é recusada.
- **TED** devolve 405 a GET: um 4xx correcto é sinal de API viva, não de avaria — e a auditoria
  distingue os dois casos.
- **World Bank** devolve 403 ao nosso user-agent: legítimo, registado, e por isso a fiabilidade cai.

## Agente de descoberta

1. Lê o catálogo `apis.guru` (≈8,8 MB, `purpose=catalogue` — o único caso em que o limite de 2 MB do
   agente sobe, até 24 MB, e fica registado).
2. Filtra por termos (`contracts`, `registry`, `sanctions`, `funding`…).
3. Para o candidato escolhido: obtém a especificação OpenAPI/Swagger, conta caminhos, lê licença e
   esquemas de autenticação.
4. **Deriva um pedido GET sem parâmetros obrigatórios e sem autenticação** (aceita `parameters` ao nível
   do caminho, como no Swagger 2.0). Se não existir, **não inventa**: diz «auditoria funcional
   impossível sem chave».
5. Audita esse pedido com as mesmas três dimensões, marcando a utilidade como «não avaliada por humano».

Exemplo real: `frankiefinancial.io` → 42 caminhos, autenticação declarada, sonda derivada `GET /ruok`
em `https://api.demo.frankiefinancial.io/compliance/v1.2/ruok`.

## Garantias (não negociáveis)

- Nenhuma auditoria ou descoberta **escreve no grafo**: só o livro de provas (entradas
  `auditoria_api` e `descoberta_api`).
- Uma API personalizada fica **no navegador** (`localStorage['vn-apis-custom']`); não é publicada.
- Chaves na URL são detectadas e penalizadas; o agente não guarda credenciais.
- `robots.txt` só é ultrapassado com política declarada e justificação registada.
- No servidor público: `/api/fetch` recusa origens externas (403), tem orçamento de pedidos por IP
  (`AGENT_BUDGET`, 60/10 min por omissão, resposta 429), limites de 2 MB/15 s, anti-SSRF e não aceita
  credenciais.

## Limites

- Sem autenticação: APIs com chave só são avaliadas até ao 401.
- Sem execução de JavaScript: portais que renderizam no cliente (DR, BASE) provam a obtenção, não o
  conteúdo.
- A utilidade é julgada por humano (campo curado). O agente mede estrutura e disponibilidade — não
  decide se uma API é «boa para investigar».
- As pontuações são **datadas**: uma API muda. `auditedAt` vai em cada resultado.
