# Matriz de testes — Conspiracy Tracker (FASE A)

> Só entram aqui execuções feitas nesta sessão, com o resultado que a máquina produziu.
> Onde está «não executado», não há opinião sobre se passaria.

**Ambiente:** Node `v20.20.2` · `npm install` completo · Chromium (`playwright chromium-headless-shell-1248`)
instalado nesta sessão, mais bibliotecas de sistema `libnspr4`, `libnss3`, `libatk*`, `libgtk-3`, `libgbm1`,
`libasound2` via `sudo apt-get` (sem elas, as suites de interface falham com
`error while loading shared libraries` — é ambiente, não produto).
**Comando de referência:** os testes que criam contas precisam de `tools/ui-env.sh`
(`REGISTER_OPEN=true` e perfil de testes); sem isso `tests/flow.mjs` e `tests/search.mjs` saem com
código 1.

---

## 1. `npm test` — 38 ficheiros, um a um (FASES B, C, D e E aplicadas)

Gerado por `bash tools/ui-env.sh node tools/auditoria/matriz-testes.mjs` (cada ficheiro em processo
próprio, sessão de 2026-10-23, servidor de testes em `127.0.0.1:8080`).

Total: **38 ficheiros · 613 PASS · 0 FAIL · 0 ficheiros com código de saída ≠ 0**.

| ficheiro | PASS | FAIL | duração | código | veredicto |
|---|---|---|---|---|---|
| `tests/afirmacoes.mjs` | 14 | 0 | 1.2 s | 0 | ok |
| `tests/agentes-contrato.mjs` | 10 | 0 | 0.1 s | 0 | ok |
| `tests/agents-p3.mjs` | 16 | 0 | 2.3 s | 0 | ok |
| `tests/agents.mjs` | 18 | 0 | 4.7 s | 0 | ok |
| `tests/apis-estado.mjs` | 18 | 0 | 0.4 s | 0 | ok |
| `tests/apis.mjs` | 13 | 0 | 0.2 s | 0 | ok |
| `tests/auth-privacidade.mjs` | 15 | 0 | 6.2 s | 0 | ok |
| `tests/benchmark.mjs` | 18 | 0 | 3.2 s | 0 | ok |
| `tests/cabecalhos.mjs` | 2 | 0 | 1.8 s | 0 | ok |
| `tests/discovery.mjs` | 13 | 0 | 1.5 s | 0 | ok |
| `tests/evidence.mjs` | 17 | 0 | 4.1 s | 0 | ok |
| `tests/fase3c.mjs` | 28 | 0 | 3.1 s | 0 | ok |
| `tests/fase3d.mjs` | 18 | 0 | 2.4 s | 0 | ok |
| `tests/fase3e.mjs` | 21 | 0 | 0.7 s | 0 | ok |
| `tests/flow.mjs` | 14 | 0 | 7.8 s | 0 | ok |
| `tests/fontes.mjs` | 23 | 0 | 1.3 s | 0 | ok |
| `tests/graph.mjs` | 13 | 0 | 2.2 s | 0 | ok |
| `tests/ia-fornecedores.mjs` | 21 | 0 | 1.9 s | 0 | ok |
| `tests/keyless.mjs` | 10 | 0 | 0.3 s | 0 | ok |
| `tests/modelos.mjs` | 12 | 0 | 0.0 s | 0 | ok |
| `tests/ocr.mjs` | 15 | 0 | 5.6 s | 0 | ok |
| `tests/pdftext.mjs` | 19 | 0 | 0.1 s | 0 | ok |
| `tests/persistencia-pg.mjs` | 0 | 0 | 0.1 s | 0 | ok |
| `tests/pesquisa-servidor.mjs` | 18 | 0 | 1.5 s | 0 | ok |
| `tests/provider-os.mjs` | 25 | 0 | 0.7 s | 0 | ok |
| `tests/provider-tests.mjs` | 18 | 0 | 4.2 s | 0 | ok |
| `tests/quota-ia.mjs` | 10 | 0 | 0.6 s | 0 | ok |
| `tests/realdata-bundle.mjs` | 7 | 0 | 0.1 s | 0 | ok |
| `tests/research.mjs` | 24 | 0 | 3.7 s | 0 | ok |
| `tests/retencao.mjs` | 10 | 0 | 1.2 s | 0 | ok |
| `tests/router-perfis.mjs` | 12 | 0 | 0.3 s | 0 | ok |
| `tests/scheduler.mjs` | 21 | 0 | 2.1 s | 0 | ok |
| `tests/search.mjs` | 17 | 0 | 6.1 s | 0 | ok |
| `tests/seguranca.mjs` | 25 | 0 | 5.0 s | 0 | ok |
| `tests/selector.mjs` | 24 | 0 | 0.4 s | 0 | ok |
| `tests/server.mjs` | 26 | 0 | 4.3 s | 0 | ok |
| `tests/ssrn.mjs` | 18 | 0 | 0.8 s | 0 | ok |
| `tests/workflows-investigacao.mjs` | 10 | 0 | 0.2 s | 0 | ok |

> **`tests/persistencia-pg.mjs` continua a ser o único ficheiro com 0 asserções:** imprime
> `SKIP persistência: DATABASE_URL não está definida` e sai com 0. Um «verde» aqui **não prova
> durabilidade nenhuma**.

### Diferença face à cadeia `npm test`

`npm test` encadeia os 38 ficheiros com `&&`. Numa cadeia assim, um ficheiro que rebente no
arranque aparece como falha global sem dizer qual foi — e um ficheiro que não corre passa
despercebido se estiver fora da cadeia. A matriz existe precisamente para separar as duas coisas.
A soma coincide com a cadeia completa: **613 PASS / 0 falhas** (542 da FASE A + 7 da FASE B +
14 de `tests/afirmacoes.mjs` na FASE C + 10 de `tests/agentes-contrato.mjs` e 10 de
`tests/workflows-investigacao.mjs` na FASE D + 18 de `tests/apis-estado.mjs` e 12 de
`tests/router-perfis.mjs` na FASE E). A cadeia `npm test` foi também corrida de ponta a ponta nesta
sessão, com o mesmo resultado (613 PASS · saída 0).

---

## 2. `npm run test:ui` — 9 suites (FASES D e E)

Corrido com `bash tools/ui-env.sh npm run test:ui` → **código de saída 0**, 9 suites · 101 verificações.

A suite `tests/account-ui.mjs` ganhou em E1/E2 a verificação do catálogo de APIs sem chave: estados por
linha, prova visível e operações reais (o teste sincroniza o relatório guardado — não toca a internet —
e confirma que não há botões inertes).

| suite | verificações | resultado |
|---|---|---|
| `tests/entrada-ui.mjs` | 10 | 10/10 |
| `tests/agents-ui.mjs` | 5 | 5/5 |
| `tests/apis-ui.mjs` | 7 | 7/7 |
| `tests/account-ui.mjs` | 20 | 20/20 |
| `tests/documents-ui.mjs` | 6 | 6/6 |
| `tests/mfa-ui.mjs` | 10 | 10/10 |
| `tests/fontes-ui.mjs` | 12 | 12/12 |
| `tests/provedores-ui.mjs` | 16 | 16/16 |
| `tests/simples-ui.mjs` | 15 | 15/15 |
| **total** | **101** | **101/101** |

---

## 3. Dependências

```
$ npm run audit:deps
=== DEPENDÊNCIAS INSTALADAS: 41 (directas: 4, de desenvolvimento: 3) ===
sem vulnerabilidades altas/críticas e sem licenças proibidas nas versões instaladas
```
Código de saída 0 · dados em `docs/DEPENDENCIAS-DADOS.json`.

---

## 4. Ficheiros de `tests/` fora de qualquer cadeia (13)

| ficheiro | corre? | resultado desta sessão | nota |
|---|---|---|---|
| `tests/_env.mjs`, `tests/_ui-entrada.mjs` | não | — | auxiliares, não são testes |
| `tests/smoke.mjs` | sim | **sem asserções** · imprime `ERRORS: 0`, `canvas: true` | diagnóstico útil, veredicto «ok» seria falso |
| `tests/console-tabs.mjs` | sim | **sem asserções** · imprime `erros: 0 []` e o conteúdo de cada separador | idem |
| `tests/perf.mjs` | sim | **sem asserções** · imprime um JSON de medições | idem |
| `tests/scale-diag.mjs` | sim | **sem asserções** · `{semImagens: 2, …, heapMB: 45}` | idem |
| `tests/shots.mjs`, `tests/shots2.mjs`, `tests/shot-search.mjs` | não | — | produção de capturas para `docs/` |
| `tests/deployed.mjs` | não | `BLOQUEADO` | sonda de produção autenticada — precisa de autorização |
| `tests/mfa-publico.mjs` | não | `BLOQUEADO` | idem |
| `tests/ocr-publico.mjs` | não | `BLOQUEADO` | idem |
| `tests/real-fetch.mjs` | não | `BLOQUEADO` | sai para a rede aberta |

Consequência: **13 dos 60 ficheiros de `tests/` nunca correm em CI** (38 estão em `npm test`, 9 em
`npm run test:ui`) e quatro dos que correm à mão não têm
asserções. A cobertura real é a da §1 e §2, não a contagem de ficheiros em `tests/`.

---

## 4.b FASE B — provas novas (o que mudou e como se prova)

| garantia | teste | resultado |
|---|---|---|
| sem IA a execução **não** aborta: declara lacuna e continua | `tests/research.mjs` «sem fornecedor de IA a execução não pára…» | lacuna registada · passos locais correram · parou só por falta de URLs |
| recolha arquiva documentos (antes: 0) | `tests/research.mjs` «POST /runs sem chave de IA conclui com lacunas…» | `concluido-com-lacunas` · recolha executada · motivo da recusa SSRF escrito |
| execução em fundo responde `202` | `tests/research.mjs` «background:true responde 202…» | **202 em 7 ms** · terminou · 20 passos |
| cancelar corta a recolha a meio | `tests/research.mjs` «cancelar a meio interrompe a recolha…» | parou em 4 de 6 documentos · motivo escrito |
| retomar não repete passos nem descarrega de novo | `tests/research.mjs` «retomar uma execução com lacunas…» | lacunas 5 → 0 · recolha não repetida · 20 passos (sem duplicados) |
| orçamento esgotado não mata a execução | `tests/research.mjs` «orçamento esgotado não mata…» | 6 lacunas · locais correram · zero chamadas externas |
| cabeçalhos | `tests/cabecalhos.mjs` | `script-src 'self'` · `frame-ancestors 'self'` · XFO SAMEORIGIN · HSTS · `ALLOW_EMBED=1` só em dev |

Ensaio de ponta a ponta (`tools/auditoria/fluxo-pergunta-arquivo.mjs`, 10 URLs, **sem chave de IA**):

```
[rapida]    concluido-com-lacunas · 1 lacuna  · 20 passos · recolha concluída
[normal]    concluido-com-lacunas · 2 lacunas · 20 passos · recolha concluída
[exaustiva] concluido-com-lacunas · 5 lacunas · 20 passos · recolha concluída
documentos: 10 · provas: 0 · fetchDoc chamado 10 vez(es)
após reinício do processo: relatório 200 IDÊNTICO (sem o carimbo de tempo)
```

Comparação directa com a FASE A: **antes 0 documentos e `stopped` nos três perfis; agora 10
documentos arquivados e estado honesto nos três.** As provas continuam a **0 por desenho**: nenhuma
prova nasce de texto recolhido sem confirmação humana (é a FASE C que trata disso com candidatos
explícitos, nunca automáticos).

---

## 5. Experiências executadas fora das suites

### 5.1 Fluxo pergunta → arquivo (`node tools/auditoria/fluxo-pergunta-arquivo.mjs`)

10 URLs fornecidas, `fetchDoc` simulado (sem rede), três perfis, reinício do processo a meio:

```
[rapida]    POST /runs → 201 em 2,0 s · status=stopped · parou: resposta-invalida-de-ia
  passos: 1.interpretar=concluido | 2.ambito=concluido | 3.entidades=ignorado-pelo-perfil | 4.variantes=falhou
[normal]    POST /runs → 201 em 9,9 s · status=stopped · parou: resposta-invalida-de-ia
  passos: 1.interpretar=concluido | 2.ambito=concluido | 3.entidades=concluido | 4.variantes=falhou
[exaustiva] POST /runs → 201 em 4,5 s · status=stopped · parou: resposta-invalida-de-ia
documentos: 0 · provas: 0 · fetchDoc chamado 0 vez(es)
após reinício do processo: relatório 200 IDÊNTICO (sem o carimbo de tempo)
```

Numa execução anterior do mesmo guião registou-se também
`falha-de-ia` com o motivo literal do fornecedor: *«Free limit reached: 1 reply every 30 seconds
per IP…»*. Veredicto: **o fluxo central falha**; a persistência em ficheiro, por outro lado,
sobrevive ao reinício com relatório idêntico.

### 5.2 Desempenho (`node tools/auditoria/perf-carga.mjs`)

Corpus 300 provas + 100 relações: detalhe 2 ms · provas 10 ms · grafo 13 ms · relatório 15 ms ·
resumo 22 ms · pesquisa 21 ms/7 ms · payload do grafo 108 KB · escrita ≈13 ms por prova.

### 5.3 Cabeçalhos e CORS (`curl -D -` no servidor local)

Presentes: `cache-control: no-store`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`,
`permissions-policy: geolocation=(), camera=(), microphone=()`, CSP.
CSP: `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline';
script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors *` → **`frame-ancestors *`**
e **`script-src 'unsafe-inline'`** são fragilidades reais (achado A-06). Sem `strict-transport-security`.
Pedido com `Origin: https://evil.example` não devolve `access-control-*` (sem CORS aberto).

### 5.4 Registo público e limite de tentativas

`POST /api/auth/register` sem `REGISTER_OPEN` → `403 REGISTRATION_CLOSED`; com a variável →
conta criada e sessão válida. `tests/auth-privacidade.mjs` → `401 · 401 · 401 · 401` (limite por IP
e por conta a funcionar).

### 5.5 Varrimento de APIs sem chave (herdado, reconfirmado no relatório)

46 sondados · 18 catálogo público · 24 exigem chave · 4 indeterminados · etapa de geração:
**1 gera** (`pollinations-control`, o próprio controlo). `tests/keyless.mjs`: 10/10.
Workflow validado nos dois sentidos: controlo real → 0; relatório adulterado →
`::error::A SONDA ESTÁ AVARIADA`, 1.

### 5.6 Produção (leitura apenas, sem escritas)

`GET /health` → `{"ok":true,"status":"alive","version":"2.0.0-fase12","commit":"77c25126…"}`
`GET /api/meta` → `schemaVersion 7`, 13 agentes (6 local / 7 IA), `registration.open=false`.

---

## 6. Cobertura por área — onde há e onde não há prova

| área | prova executada | lacuna |
|---|---|---|
| autenticação/sessões/CSRF/limites | `server`, `auth-privacidade`, `seguranca`, 9 suites de UI | — |
| provas/hash/auditoria | `evidence` (17), `flow` (livro encadeado) | — |
| grafo | `graph` (13), `flow` (testes 2–5, 8) | — |
| relatório/exportação | `flow` (teste 10), `/report` 200 | — |
| pesquisa | `pesquisa-servidor` (18), `search` (11) | — |
| documentos/PDF/OCR | `fase3e`, `pdftext`, `ocr` | nenhum teste de recolha **em lote** dentro de uma execução |
| classificação de afirmações | `evidence`, `flow` (facto/alegação/não verificado) | **nenhum** teste de cópias da mesma fonte (E3) nem dos 9 estados exigidos (E2) |
| fluxo de investigação | `research` (19, só a rota) | **nenhum** teste de resultado fim-a-fim → é o buraco maior |
| agentes | `agents` (18), `agents-p3` (16) | orçamento/retry/cancelamento por agente |
| fornecedores/quota/selecção | `provider-os` (25), `provider-tests` (18), `selector` (24), `quota-ia` (10) | nenhuma prova com chave real |
| APIs sem chave | `keyless` (10) + varrimento real + workflow | utilização efectiva dentro da investigação (falha) |
| persistência | reinício com mesmo `dataDir` (idêntico) | Postgres/durabilidade entre deploys — `SKIP` |
| retenção | `retencao` (10, dry-run) | purga real |
| MFA | `mfa-ui` (10) | provas contra produção |

---

## 7. Não executado (e porquê)

| item | motivo |
|---|---|
| `tests/deployed.mjs`, `mfa-publico.mjs`, `ocr-publico.mjs`, `real-fetch.mjs` | tocam produção ou a rede aberta — **precisa de autorização explícita** |
| `tests/persistencia-pg.mjs` com base real | não há `DATABASE_URL`; `SKIP` é o comportamento correcto |
| ensaio de reinício a meio de uma execução | a execução não chega a meio (aborta no passo 3–4); fica para a FASE B/F |
| comportamento com chave de IA válida | não existe nenhuma chave neste ambiente — `NAO_VERIFICADO` |
| concorrência (dois `POST /runs` no mesmo projecto) | fora do âmbito declarado da FASE A |
| promoção para produção / deploy | proibido sem autorização |

---

## 8. Leitura honesta da matriz

- **O verde é real no que cobre**: 542 + 100 verificações, todas com resultado impresso, código de
  saída 0, e reproduzíveis com um comando.
- **O verde passou a cobrir o produto principal.** Com a FASE B, o ensaio pergunta→investigação→
  arquivo conclui com lacunas declaradas nos três perfis e arquiva os 10 documentos (antes: 0 e
  `stopped`). O que continua fora é a passagem de documento a **prova**: exige excerto confirmado
  por uma pessoa (FASE C).
- **Um «SKIP» não é um «PASS»** (Postgres) e **um script sem asserções não é um teste**
  (`smoke`, `console-tabs`, `perf`, `scale-diag`).
- Já fechado na FASE B: cancelamento efectivo (D4), retoma por checkpoint (D5), CI em PR
  (`.github/workflows/ci.yml`, que corre esta mesma matriz).
- Continua a faltar para a FASE H: `tests/caso-socrates.mjs` (pergunta real, com documentos reais e
  cache determinística) e o teste de independência de fontes (E3).
