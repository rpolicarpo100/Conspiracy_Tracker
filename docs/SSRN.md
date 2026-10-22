# SSRN — o que é possível extrair, e o que não é

Medido em **2026-10-22**, a partir do servidor, sem contornar nada. Este
documento existe para não haver dúvida sobre o que a aplicação faz e não faz.

## Resultado da verificação

| Alvo | Resultado | Leitura |
|---|---|---|
| `https://www.ssrn.com/robots.txt` | `200` | permite acesso geral. `Disallow` só para `GPTBot`, `ChatGPT-User` e para `/admin/`, `/tasks/`, `/config/`. `Crawl-delay: 5` |
| Página de resumo `papers.ssrn.com/sol3/papers.cfm?abstract_id=…` | `403` | duas respostas: «Content Blocked» (pedido com cabeçalho de navegador) e «Just a moment…» (desafio JavaScript, pedido do servidor). **Bloqueio técnico, não paywall** |
| PDF `papers.ssrn.com/sol3/Delivery.cfm/…` | `403` | mesmo bloqueio |
| `https://doi.org/10.2139/ssrn.<id>` | `302` → `ssrn.com/abstract=<id>` | o destino devolve o mesmo `403` |
| `api.crossref.org/works/10.2139/ssrn.<id>` | `200` | **título, autores, filiação, data, editora, tipo e resumo do autor** |
| `api.openalex.org` (fonte `S4210172589` = SSRN Electronic Journal) | `200` | existência, ano, DOI, contagens; **resumo não publicado**; 1 375 448 obras indexadas |
| `api.unpaywall.org/v2/10.2139/ssrn.<id>` | `200` | `is_oa:true` mas a única localização é a própria DOI: **não há cópia aberta** |

## Conclusão

* **Metadados: sim.** O SSRN deposita a ficha no Crossref com o prefixo `10.2139`.
  É por aí que a aplicação lê — não pelo sítio bloqueado.
* **Texto completo: não.** A página e o PDF devolvem `403`. Não se resolve o
  desafio, não se falsifica o utilizador, não se usa proxy. Quem quiser o texto
  pede ao autor ou procura a versão publicada.
* **O resumo do autor não é o artigo.** A ficha diz isso explicitamente; um
  resumo nunca é tratado como prova do conteúdo.

## O que a aplicação faz com isto

Duas rotas (sessão obrigatória; CSRF na escrita; 20 pedidos/hora por utilizador —
cortesia com o Crossref):

```
GET  /api/ssrn/:id            → ficha do Crossref + estado do texto completo
GET  /api/ssrn/:id?sonda=1    → acrescenta UMA sonda à página e relata o HTTP recebido
POST /api/ssrn/:id/import     → registar a obra como fonte DISCOVERED
```

Identificadores aceites: `4461514`, `ssrn.4461514`, `10.2139/ssrn.4461514`,
`https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4461514`,
`https://doi.org/10.2139/ssrn.4461514`.

A fonte entra como **`DISCOVERED`** (descoberta), com adaptador
`ssrn-crossref` na proveniência e uma nota que inclui autores, data, DOI, o
resumo do autor e a frase «Texto completo NÃO acessível (SSRN devolve 403; não se
contorna)». Verificar, classificar e aprovar continuam a ser passos humanos.

Na interface: *Consola → Fontes → caixa «SSRN (metadados por Crossref)»*.

## Exemplo real (verificado agora)

```
GET /api/ssrn/4461514?sonda=1

Título ............ Dark Money and Voter Learning
Autores ........... Keith E. Schnakenberg · Collin Schumock · Ian R. Turner
Data .............. 2023-5-31
DOI ............... https://doi.org/10.2139/ssrn.4461514
Resumo ............ «We provide a model of dark money in elections…» (autor, via Crossref)
Texto completo .... NÃO acessível — SSRN devolve 403
Sonda à página .... desafio anti-robô (Cloudflare) na resposta: não se resolve nem se contorna (HTTP 403)
```

## Testes

`tests/ssrn.mjs` — 18 verificações, incluindo: identificadores, mapeamento do
Crossref com HTML removido, `404` do Crossref tratado como «não depositado»,
`429` declarado, detecção de bloqueio **sem** cabeçalhos de disfarce, recusa de
`http://` e de endereços privados (SSRF, com zero pedidos), e o par de rotas
reais com CSRF e duplicados (`409`).
