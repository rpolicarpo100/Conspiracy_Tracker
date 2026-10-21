# ENTREGA — FASE 3G · DESCOBERTA, REGISTO E AUDITORIA DE FONTES + DADOS REAIS

Data: 2026-10-21 · versão `2.0.0-fase3g` · esquema v6 · commit `4f245c7` · publicado em
https://conspiracy-aitracker.onrender.com

Regra deste documento: **um valor que não foi medido não aparece como número**. Tudo o que está
abaixo foi lido do código, produzido por uma execução real ou devolvido pela aplicação publicada.
O que não foi feito está na §17 e diz «não implementado», sem eufemismos.

---

## 1. Fase 0 — auditoria antes de alterar (feito)

`docs/AUDITORIA-FONTES.md`. Antes de escrever código: inventário dos componentes, o que estava
testado (271 asserções de servidor + 43 de interface, todas verdes no início), 5 problemas
confirmados com evidência, 6 riscos por prioridade, plano de reversão e a baseline medida.
Nada foi reconstruído de raiz.

## 2. Funcionalidades preservadas (verificado, não prometido)

Grafo interactivo, legendas, estados de verificação, pesquisa com correcção de gralhas, livro de
provas com hash encadeado, importação validada, recolha com guarda SSRF, PDF e OCR, relatório,
exportações, autenticação + papéis + MFA + auditoria, contas/projectos/chaves de IA, migrações e
cópias de segurança. A prova é a suite: **17 suites de servidor (308 asserções) e 6 de interface
(53 asserções), 0 falhas** — as mesmas suites que passavam antes.

## 3. Catálogo de fontes (implementado)

`server/sources.mjs`: **12 estados**, **30 categorias** de fonte, **50 jurisdições em 8 regiões**
(Europa, América do Norte, América Latina, Caraíbas, África, Ásia, Médio Oriente, Oceânia).
É um catálogo de *referência* para classificar e medir cobertura — não uma afirmação de que cada
país está coberto. A aplicação nunca declara cobertura completa: a cobertura é calculada
(`coverageFrom`) e aparece com a nota «não fontes validadas».

## 4. Estratégias de descoberta (1 de 7 implementada, com adaptador real)

Implementada: **catálogos públicos documentados**, através do adaptador `courtlistener_courts`
(API REST v4 do CourtListener, sem chave). Execução real: 20 candidatos, 18 novas, 0 duplicadas,
~130–200 ms, com o URL da consulta guardado em `discoveryRuns`.

Não implementadas: pesquisa web multilingue, portais oficiais por rascunho, referências cruzadas a
partir de documentos, extracção de metadados de documentos, priorização de lacunas como motor de
descoberta, e submissão humana com fila de moderação própria (existe registo manual por qualquer
utilizador autenticado). A interface diz isto; o código não finge o contrário.

## 5. Validação técnica (implementada e executada ao vivo)

Cinco testes, executados por `POST /api/sources/:id/check` sobre HTTP real: existência/domínio
(DNS), TLS/redireccionamentos (cada salto revalidado contra SSRF), acessibilidade (código HTTP),
estrutura (content-type declarado) e reprodutibilidade (cada verificação fica datada no histórico).
Resultado real observado: `HTTP 403 · ~110 ms · «exige autenticação ou pagamento (HTTP 403): não se
contorna»` para a raiz do CourtListener, e `HTTP 200` para a API v4. **Uma falha de acesso não é
apresentada como sucesso, e 429 é «limite de utilização», não avaria.**

## 6. Auditoria multidimensional (implementada)

8 dimensões medidas separadamente: autoridade/proveniência, qualidade factual, transparência,
independência, utilidade, actualidade, acessibilidade técnica e **risco (100 = risco elevado)**.
O risco não entra em média: **limita** a nota (≥70 → tecto 30; ≥40 → tecto 55), e o limite é escrito
em `cappedBy` e mostrado na interface. Não há média que esconda risco crítico.

## 7. Nota global A–E com critérios, evidência, data e limitações

Faixas: A ≥ 85 · B 70–84 · C 50–69 · D 25–49 · E 0–24. Cada classificação guarda quem, quando,
com que amostra, que dimensões ficaram por avaliar e que limites foram aplicados.

## 8. Quando não há evidência, não há nota (implementado)

`rateSource` devolve `score: null`, `band: null` e «Classificação provisória — evidência
insuficiente (falta: qualidade factual; independência; utilidade; actualidade)». Sem amostra
verificada a nota não passa de 70; com `n < 5`, de 60; com `n < 20`, de 70. **E aprovar exige
classificação não provisória: 409** (testado na API e na interface).

## 9. Deduplicação e canonicidade (implementada e testada)

URL canónico: sem `www`, sem parâmetros de rastreio, sem barra final, fragmento removido,
`https://www.example.gov/path/?a=1&b=2` → chave `example.gov|/path?a=1`. Duplicado → **409** com a
fonte existente; na interface o catálogo continua com 1. Também se recusam 7 formas de SSRF
(localhost, 127/8, 10/8, 172.16/12, 192.168/16, 169.254.169.254, credenciais embutidas).

## 10. Adaptadores (1 real)

`ADAPTERS.courtlistener_courts` com ficha completa: id, categoria, método, esquema de resposta,
limites (429 + `Retry-After`, máx. 3 s, uma tentativa), condições de uso, versão, estado. Não existe
nenhum adaptador simulado no produto: um adaptador que não funcione não entra.

## 11. Ciclo de estados (implementado; automação periódica não)

Estados: `DISCOVERED`, `TECHNICAL_TESTING`, `TECHNICALLY_VALIDATED`, `CONTENT_AUDIT`,
`RESTRICTED`, `TEMPORARILY_UNAVAILABLE`, `PENDING_REVIEW`, `APPROVED`, `ACTIVE`, `DEGRADED`,
`REJECTED`, `DEPRECATED`. Transições só por verificação, classificação ou decisão humana auditada.
Modos: manual, descoberta real, **simulação (dry-run, não grava)** e por fonte. Agendamento
automático, reavaliação periódica e recuperação — **não implementados**.

## 12. Cobertura e lacunas (calculada; priorização não)

`GET /api/coverage` devolve países aprovados, categorias cobertas e **quantas categorias ficam por
cobrir** (execução real: «1 fonte · 0 países aprovados · 29 categorias por cobrir»). A priorização
por lacunas (que diria *o que investigar a seguir*) **não está implementada**.

## 13. Agentes especializados (não implementados — de propósito)

O pedido prevê até 11 agentes. Nesta fase aplicou-se a regra do próprio projecto: **quando uma regra
determinística basta, não se cria um agente**. Estados, limites de nota, deduplicação e decisões são
regras determinísticas e testáveis; transformá-las em agentes de IA tornaria o resultado menos
reprodutível e mais caro. Ficam como trabalho futuro, para o que exige julgamento (ex.: avaliar
independência editorial), não para o que exige aritmética.

## 14. Interface de gestão (implementada como um separador com seis blocos)

`Consola → «Registo de fontes»`: (1) painel com contagens, (2) catálogo, (3) detalhe com verificação/
classificação/decisão, (4) cobertura, (5) histórico de descobertas, (6) registo manual e descoberta
real/simulada. Não são seis separadores distintos — é um separador com seis blocos, e é isso que os
testes verificam (10/10). Mapa mundial, fila de auditoria dedicada e histórico visual completo
**não implementados**.

## 15. Modelo de dados (implementado na base existente)

Esquema **v6** por migração aditiva: `sources`, `sourceChecks`, `sourceRatings`, `sourceDecisions`,
`discoveryRuns` (+ os já existentes). Reversível: o código anterior ignora as colecções novas;
voltar atrás não perde dados. Testado com base criada de fresco e com base v5 migrada.

## 16. Segurança (implementada e testada)

Guarda SSRF em cada salto de redireccionamento; verificação é leitura (sem cookies, sem
credenciais, sem executar scripts, com limite de bytes e tempo); limitadores (30 submissões/h,
6 verificações/h por fonte, 6 descobertas/h); autenticação em todas as rotas e CSRF em todas as
mutações; decisões, verificações e descobertas em auditoria. Conteúdo de terceiros nunca é
interpretado como instrução: é metadado. MIME avaliado, não executado. Paywall/403/CAPTCHA →
`RESTRICTED`, sem tentativa de contorno.

## 17. O que **não** foi feito (declarado, sem maquilhagem)

1. Pesquisa web multilingue e descoberta por referências cruzadas.
2. Adaptadores nacionais (incluindo Portugal): contratos, registos comerciais, beneficiários efectivos.
3. Priorização automática por lacunas; agendamento, reavaliação periódica e recuperação.
4. Auditoria de conteúdo por amostragem em escala (a classificação aceita amostra; a comparação com
   os originais é manual).
5. Revisão humana independente com conflito de interesses (agente 11).
6. Postgres ou disco persistente: no plano gratuito do Render o disco é efémero — `/ready` di-lo
   («durableBetweenDeploys: false») e um deploy apaga os dados de utilizador.
7. Mapa mundial e fila de auditoria na interface.
8. Revisão humana das 82 relações do conjunto real: estão `probable`, com `reviewPending: true`.

## 18. Tabela baseline → actual → evidência → estado

| # | indicador | baseline (antes de 3G) | actual | evidência (medida) | estado |
| --- | --- | --- | --- | --- | --- |
| 1 | Versão publicada | `2.0.0-fase3f` (`3cfa48e`) | `2.0.0-fase3g` (`4f245c7`) | `/health` público | ✅ feito |
| 2 | Esquema | v5 | **v6** (5 colecções novas) | `/api/meta` → `schemaVersion: 6` | ✅ feito |
| 3 | Rotas de API | 67 | **76** | `tools/status.mjs --check` | ✅ feito |
| 4 | Dados no grafo | 69 entidades / 126 relações **fictícias** | **46 / 82 reais** | `validateBundle` → `data/real/PROVENIENCIA.json` | ✅ feito |
| 5 | Documentos com hash conferido | 0 | **17** (SHA-1 do CourtListener = SHA-1 local) | `PROVENIENCIA.json` → `sha1Check: "confere"` ×17 | ✅ feito |
| 6 | Relações com excerto | 250 (fictícias) | **82 / 82 reais** | `tests/realdata-bundle.mjs` | ✅ feito |
| 7 | Relações «confirmadas» sem revisor | 126 (fictícias) | **0** (82 `probable`, `reviewPending`) | inspecção + teste | ✅ corrigido |
| 8 | Fontes registadas no produto | não existia modelo | modelo + UI + API; **0 registadas em produção** (base apagada a cada deploy) | `GET /api/sources` (autenticado) | ⚠️ existe, sem uso real |
| 9 | Adaptadores de descoberta | 0 | **1** (`courtlistener_courts`) | execução real: 20 candidatos / 18 novas | ✅ feito |
| 10 | Verificações técnicas reais | 0 | por fonte, com histórico datado | `HTTP 403` e `HTTP 200` registados em `sourceChecks` | ✅ feito |
| 11 | Classificação de fontes | inexistente | 8 dimensões + risco com tecto + provisória | `tests/fontes.mjs` (88/A com amostra 25; amostra 3 → 60) | ✅ feito |
| 12 | Cobertura | inexistente | calculada por país/região/categoria | «1 fonte · 0 países · 29 categorias por cobrir» | ✅ feito |
| 13 | Asserções de teste (servidor) | 271 | **308** em 17 suites | `npm test` | ✅ feito |
| 14 | Asserções de teste (interface) | 43 | **53** em 6 suites | `npm run test:ui` | ✅ feito |
| 15 | Testes ao vivo no serviço publicado | 6 | **6 + 13 (OCR) + 15 (MFA)** | `tests/deployed.mjs`, `ocr-publico`, `mfa-publico` | ✅ feito |
| 16 | Pesquisa sobre dados reais | não medida (dados fictícios) | **24 ms** índice · 741 termos · **0,48 ms**/consulta · 55 resultados | Chromium headless, 40 execuções | ✅ medido |
| 17 | Custo externo | 0 € | **0 €** (CourtListener sem chave, plano gratuito) | registos de utilização | ✅ medido |
| 18 | Priorização por lacunas, agentes especializados, agendamento, Postgres | — | **não implementado** | §17 | ⛔ pendente |

## Como repetir a verificação

```bash
bash tools/ui-env.sh npm test          # 17 suites · 308 asserções
bash tools/ui-env.sh npm run test:ui   # 6 suites · 53 asserções
node tests/realdata-bundle.mjs         # lote real: 7 asserções
node tools/status.mjs --check          # coerência versão/esquema/rotas
node tests/deployed.mjs                # serviço publicado: 6 asserções
node tests/ocr-publico.mjs             # OCR real em produção: 13 asserções
node tests/mfa-publico.mjs             # MFA em produção: 15 asserções
npm run dados:epstein -- --dry         # repete a importação sem escrever
```
