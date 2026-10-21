# REGISTO DE FONTES — descoberta, verificação e classificação (fase 3G)

Este documento descreve o que foi **implementado e testado** para descobrir, verificar,
classificar e monitorizar fontes — e, igualmente importante, o que **não** foi implementado.
Cada afirmação abaixo tem um teste ou uma execução real por trás; quando não tem, está escrito.

## 1. O que existe

| peça | onde | estado |
| --- | --- | --- |
| Modelo de fontes: 12 estados, 30 categorias, 50 jurisdições | `server/sources.mjs` | **implementado e testado** (determinístico) |
| Normalização e deduplicação de URLs | `server/sources.mjs` (`canonicalUrl`, `dedupeKey`) | **implementado e testado** |
| Verificação técnica real (HTTP, TLS, tipo, redireccionamentos) | `src`/`server/access.mjs` + `POST /api/sources/:id/check` | **implementado e testado ao vivo** |
| Classificação em 8 dimensões, com justificação e «o que falta» | `server/sources.mjs` (`rateSource`) | **implementado e testado** |
| Decisão (aprovar/rejeitar/revisão) com motivo obrigatório e auditoria | `server/api.mjs` + `server/store.mjs` | **implementado e testado** |
| Descoberta automática a partir de um catálogo público real | `ADAPTERS.courtlistener_courts` + `POST /api/discovery/run` | **implementado e testado ao vivo** |
| Histórico de execuções de descoberta com a consulta exacta | colecção `discoveryRuns` | **implementado e testado** |
| Cobertura e lacunas por país, região e categoria | `coverageFrom` + `GET /api/coverage` | **implementado e testado** |
| Interface: painel, catálogo, detalhe, verificação, classificação, decisão, cobertura, histórico | `src/ui/fontes.js` (consola → «Registo de fontes») | **implementado e testado** (10 asserções com Playwright) |
| Persistência e migração do esquema (v5 → v6) | `server/store.mjs` | **implementado e testado** |

Testes: `tests/fontes.mjs` (23 asserções: 20 determinísticas/HTTP + 3 de rede) e
`tests/fontes-ui.mjs` (10 asserções na interface). Resultados reais em
`docs/TEST-RESULTS.txt` §34.

## 2. Como se evita mentir

Estas regras estão no código, não num slide:

1. **Sem evidência não há nota.** `rateSource` devolve `score: null` e
   `verdict: "Classificação provisória — evidência insuficiente (falta: …)"`. A nota parcial
   aparece como `provisionalScore`, nunca como classificação.
2. **Risco não é credibilidade.** A dimensão `risk` é 0–100 com 100 = risco elevado. Um risco ≥ 70
   **limita** a nota global a 30; ≥ 40 limita a 55. O limite é escrito em `cappedBy` e mostrado.
3. **Amostra pequena não sustenta confiança.** Sem amostra verificada a nota não passa de 70; com
   menos de 5 registos, de 60; com menos de 20, de 70. O limite aparece na resposta.
4. **Não se aprova sem classificação.** `POST /api/sources/:id/decision` devolve **409** se não
   houver classificação, ou se ela for provisória.
5. **Um bloqueio não é um sucesso.** 401/402/403/407 → `RESTRICTED`; CAPTCHA/robots → `RESTRICTED`;
   429 → `TEMPORARILY_UNAVAILABLE` («limite de utilização, não avaria»); 404/410 →
   `TEMPORARILY_UNAVAILABLE` («pode ter mudado de endereço»); SSRF → `REJECTED`.
6. **Uma falha de hoje não apaga a de ontem.** Cada verificação é um registo datado em
   `sourceChecks`; o histórico das classificações nunca é substituído.
7. **Duplicados não entram.** O mesmo URL canónico (sem `www`, sem rastreio, sem barra final) devolve
   **409** com a fonte existente. Cinco «fontes» iguais não são cinco fontes.
8. **A descoberta declara a consulta.** Cada execução guarda o URL consultado, a data, quantos
   candidatos vieram, quantos eram duplicados e quanto tempo demorou.

## 3. Descoberta: o que é real e o que não é

**Implementado (real, sem chave):** `courtlistener_courts` consulta
`GET https://www.courtlistener.com/api/rest/v4/courts/?page_size=N` (API REST v4 do Free Law
Project) e transforma cada tribunal com página oficial num candidato a fonte, com nome,
organização, jurisdição, URL e o identificador de origem (`resource_uri`).

Verificado ao vivo: 20 candidatos, 18 novos, 0 duplicados, ~200 ms (execução registada no
histórico; o histórico real fica na base, não neste documento).

**Não implementado** (e declarado como tal na interface e em `/api/sources/meta`): pesquisa na web
por motores externos, leitura de catálogos CKAN genéricos, descoberta por referências cruzadas a
partir de documentos, pesquisa por lacunas com priorização automática, submissão por utilizadores
comum (existe para qualquer utilizador autenticado, mas sem fila de moderação separada) e
reavaliação periódica automática. A estrutura (`ADAPTERS`, `discoveryRuns`, estados) já os suporta.

Limites encontrados na prática, e como se lida com eles:

| limite | observação real | como é tratado |
| --- | --- | --- |
| 429 da API pública | aconteceu em execuções seguidas | espera o `Retry-After` (máx. 3 s), tenta uma vez, e se continuar limitado devolve erro explícito e **não** marca nada como descoberto |
| 403 na raiz do site | `https://www.courtlistener.com/` respondeu **403** à verificação | fica `RESTRICTED`; a API é que é acessível, não a raiz — distinção preservada |
| paginação | `page_size` até 100 | cada execução pede uma página; a próxima pode continuar de onde ficou (não implementado) |

## 4. Segurança

- **SSRF**: `parseUrl` recusa `localhost`, `127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`
  (metadados de cloud), `::1`, `fc00::/7` e URL com credenciais embutidas. A verificação repete a
  guarda em **cada** salto de redireccionamento (`server/access.mjs`).
- **Verificação é leitura, não recolha**: um GET, sem cookies, sem credenciais, sem executar
  scripts, com limite de bytes e tempo; o conteúdo não é guardado (só o estado observado).
- **Limitadores próprios**: submissão 30/h, verificação 6/h por fonte, descoberta 6/h — a descoberta
  faz pedidos externos e não pode ser um amplificador.
- **Autenticação**: todas as rotas do registo exigem sessão; as mutações exigem CSRF.
- **Auditoria**: `source_discovered`, `source_checked`, `source_rated`, `source_decision`,
  `discovery_run`.

## 5. O que ficou por fazer (com ordem de valor)

1. **Pesquisa por lacunas com priorização** (Fase I): hoje a lacuna é *calculada* (`/api/coverage`)
   mas não *priorizada*; falta uma pontuação que ordene o que investigar a seguir.
2. **Adaptadores para fontes nacionais** (contratos públicos, registos comerciais): exigem leitura
   da documentação de cada portal e um adaptador por família — é trabalho por fonte, não por linha
   de código mágica.
3. **Reavaliação periódica** (Fase O): os estados existem, o agendador não.
4. **Auditoria de conteúdo por amostragem** (Fase E): a classificação já aceita `sample`, mas a
   comparação com os documentos originais é manual.
5. **UI de revisão independente** (agente 11): as decisões têm motivo e autor; falta a revisão
   separada com conflito de interesses declarado.

Nada disto está apresentado como concluído em lado nenhum.
