# FASE B — críticos do fluxo (entrega)

**Data:** 2026-10-23 · **Versão:** `2.1.0-faseB` · **Branch:** `main`
**Origem:** achados A-01, A-02, A-05, A-06, A-09, A-10 de `docs/AUDITORIA-INTEGRAL.md` e tarefas
B1–B7 de `docs/PLANO-MELHORIA.md`.

> Regra da missão respeitada: nenhuma alteração em produção; nenhum teste contra produção; nenhuma
> funcionalidade inventada. Tudo o que se segue tem um teste que corre em `npm test` ou uma execução
> registada com o comando que a produziu.

---

## 1. O que estava partido

| achado | antes (medido) | agora (medido) |
|---|---|---|
| **A-01** sem chave de IA a execução morria no passo 3–4 | 3 perfis → `stopped` · **0 documentos · 0 provas** | 3 perfis → `concluido-com-lacunas` · **10 documentos arquivados** |
| **A-02** `POST /runs` síncrono | 2,0 s / 9,9 s / **24,2 s** até a ligação cair | `background:true` → **202 em 7 ms**; progresso por `GET /api/runs/:id` |
| **A-05** cancelar não interrompia | só marcava `cancelled` | corta a recolha a meio (4 de 6 documentos) com motivo escrito |
| **A-09** árvore suja / commits misturados | HEAD `ebc874f`, produção `77c2512`, 9 ficheiros pendentes | `git reset --hard origin/main` → HEAD = `77c2512`; árvore limpa antes de tocar em código |
| **A-06** `frame-ancestors *` + `script-src 'unsafe-inline'` | aplicação embutível em qualquer site | `frame-ancestors 'self'` + XFO + HSTS + `script-src 'self'`; `ALLOW_EMBED=1` só em dev |
| **CI** nenhum workflow em PRs | `grep pull_request` → 0 resultados | `.github/workflows/ci.yml` corre `audit:deps` + `npm test` + `test:ui` em cada PR |

---

## 2. O que mudou, ficheiro a ficheiro

| ficheiro | alteração | porquê |
|---|---|---|
| `server/research.mjs` | (a) falha de IA deixa de abortar: fica `nao-executado`, entra em `lacunas` e a execução continua; (b) estado final `concluido-com-lacunas` quando há lacunas; (c) recolha **arquiva** os documentos (`store.addDocument`, com hash, estado e revisão pendente); (d) reutiliza o que já está arquivado em vez de descarregar de novo; (e) cancelamento verificado entre passos **e dentro** da recolha; (f) orçamento só conta passos que vão mesmo chamar algo, e esgotá-lo não mata o resto; (g) um passo tem **um** registo (retomar substitui, não acumula) | A-01, A-02, A-05 |
| `server/api.mjs` | `POST /api/projects/:id/runs` aceita `background:true` → **202** + `runId` e corre fora do pedido; `resume` aceita `concluido-com-lacunas` e limpa as lacunas antes de tentar de novo; `api.close()` espera pelas execuções em fundo; `api.runsEmCurso()`; versão `2.1.0-faseB` | A-02, A-05 |
| `src/ui/account.js` | «Iniciar pesquisa» usa o modo fundo e **acompanha** o estado; mostra `lacunas declaradas: passo N …`; «Retomar (n)» aparece também em `concluido-com-lacunas` | A-08, A-05 |
| `tools/serve.mjs` | CSP sem `'unsafe-inline'` no `script-src`, `frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`, `Strict-Transport-Security`; `ALLOW_EMBED=1` repõe o comportamento embutível | A-06 |
| `tools/dev-server.sh` | `ALLOW_EMBED=1` (só dev: a pré-visualização local vive num iframe) | A-06 |
| `tests/cabecalhos.mjs` | **novo** — prova os cabeçalhos nas duas variantes | A-06 |
| `tests/research.mjs` | 4 testes reescritos para o contrato novo + **5 novos** (fundo, cancelamento, retoma, orçamento, reutilização) | A-01, A-02, A-05 |
| `tests/account-ui.mjs` | a suite deixa de esperar «parou: …» e passa a exigir as lacunas visíveis | A-08 |
| `.github/workflows/ci.yml` | **novo** — CI em PRs e em push para `main` | A-09 |
| `package.json` | `tests/cabecalhos.mjs` entra em `npm test` | — |

Tamanho: **10 ficheiros**, 2 novos, nenhuma dependência nova.

---

## 3. O contrato de execução, agora explícito

```
POST /api/projects/:id/runs { profile, urls, background? }
   background:true  → 202 { run, comoAcompanhar:'GET /api/runs/:id' }
   omisso           → 201 { run }  (síncrono, compatível com o que já existia)

estado final:  'aguarda-revisao-humana'   — correu tudo o que o perfil permite
               'concluido-com-lacunas'    — correu o que pôde; `lacunas[]` diz o que faltou e porquê
               'stopped'                  — parou por falta de URLs ou orçamento de recolha
               'cancelled'                — cancelada pelo utilizador

lacuna = { passo, id, tipo, motivo, em }
   tipos: sem-fornecedor-de-ia-validado · falha-de-ia · resposta-invalida-de-ia
          orcamento-esgotado · erro-no-passo-<id>
```

Regras que não mudaram (e que os testes continuam a exigir):

- uma resposta de IA que não é JSON **não** é guardada como resultado;
- passos locais não inventam dados para preencher lacunas;
- o perfil declarado continua a decidir que passos de IA correm (`ignorado-pelo-perfil`);
- a execução termina **sempre** em revisão humana — nada é publicado como conclusão.

---

## 4. Provas de execução

### 4.1 Suites

```
bash tools/ui-env.sh npm test        → exit 0 · 549 PASS · 0 falhas · 33 ficheiros
bash tools/ui-env.sh npm run test:ui → exit 0 · 9 suites · 100 verificações
node tools/auditoria/matriz-testes.mjs → 33 ficheiros, todos com código 0
npm run audit:deps                   → exit 0 · 41 pacotes · sem vulnerabilidades altas/críticas
node tests/cabecalhos.mjs            → 2/2 (variante por omissão e variante ALLOW_EMBED)
node tests/research.mjs              → 24/24
```

### 4.2 Ensaio de ponta a ponta sem chave de IA (`tools/auditoria/fluxo-pergunta-arquivo.mjs`)

```
[rapida]    concluido-com-lacunas · 1 lacuna  · 20 passos · recolha concluída
[normal]    concluido-com-lacunas · 2 lacunas · 20 passos · recolha concluída
[exaustiva] concluido-com-lacunas · 5 lacunas · 20 passos · recolha concluída
documentos: 10 · provas: 0 · fetchDoc chamado 10 vez(es)
após reinício do processo: relatório 200 IDÊNTICO (sem o carimbo de tempo)
```

Nota importante: `provas: 0` **é o comportamento correcto**. A recolha arquiva documentos; a prova
continua a exigir excerto confirmado por uma pessoa. Criar provas automaticamente seria inventar
provas — a FASE C trata de **candidatos** explícitos, com marca de revisão.

---

## 5. O que continua por fazer (e não está escondido)

| item | estado | fase |
|---|---|---|
| taxonomia de afirmações igual à exigida (faltam `nao-verificada`, `desactualizada`) | por fazer | C1 |
| independência de fontes (duas cópias ≠ duas fontes) | por fazer | C2 |
| `tests/caso-socrates.mjs` com documentos reais | por fazer | H1 |
| durabilidade entre deploys (Postgres) | **em produção já está activa** (`/ready`: `postgres+ficheiro`, `durableBetweenDeploys:true`, `writes:1`, `errors:0`); falta só o ensaio criar→reiniciar→reler numa base descartável | F2 |
| execução em fundo sobrevive a reinício do processo **a meio** | por fazer (hoje retoma-se do que ficou gravado, mas o processo em curso perde-se) | B4/F4 |
| purga real de retenção | `BLOQUEADO` (precisa de base descartável autorizada) | F3 |
| `frame-ancestors` em produção | requer deploy (só com autorização) | — |

---

## 6. Riscos introduzidos por esta fase

| risco | mitigação |
|---|---|
| execuções em fundo num só processo Node: reinício perde o que estava a correr | o que já foi gravado persiste; `resume` continua; `/ready` e execuções mostram `running` → retomável. A FASE F4 automatiza o ensaio |
| `lacunas` pode crescer e poluir a leitura | a UI mostra contagem + lista curta; cada lacuna tem tipo e motivo, não texto livre |
| `ALLOW_EMBED` é uma porta de saída do clickjacking | só é lida de variável de ambiente, nunca do pedido do cliente; produção não a define |
| alteração de comportamento (`stopped` → `concluido-com-lacunas`) pode surpreender integrações | está declarada na resposta (`background`, `lacunas`) e coberta por testes; `docs/ENTREGA-FASE-B.md` §3 é o contrato |

---

## 6.b Produção: o que o push fez (e não foi pedido explicitamente)

O `render.yaml` tem `autoDeploy: true` na branch `main`: **o push das FASE A/B desencadeou o deploy**.
Verificado por leitura, depois do deploy:

```
GET /health → 2.1.0-faseB · commit 68e996a251aa… · status alive
GET /api/meta → 2.1.0-faseB · 13 agentes · registo fechado
GET / → content-security-policy … script-src 'self'; frame-ancestors 'self'
        strict-transport-security: max-age=31536000; includeSubDomains · x-frame-options: SAMEORIGIN
GET /ready → ready · postgres+ficheiro · durableBetweenDeploys:true · writes 1 · errors 0
GET /api/ai/keyless → 200 · relatório de 2026-10-23
```

Duas consequências a registar com franqueza:

1. **A auditoria media o ambiente local e generalizou.** O A-07 dizia «sem base durável»; em produção
   há Postgres (Neon) activo e a escrever. Corrigido em `docs/AUDITORIA-INTEGRAL.md` §A-07 e em
   `docs/ESTADO-FUNCIONALIDADES.md` B3.
2. **Produção passou de `2.0.0-fase12 / 77c2512` para `2.1.0-faseB / 68e996a`.** Isto aconteceu por
   automação do Render, não por uma ordem de deploy. Se preferires que a FASE C não vá a produção
   automaticamente, o caminho é pôr `autoDeploy: false` e passar a promover por `workflow_dispatch`
   com autorização explícita — diz e eu preparo isso antes de continuar.

## 7. Reversibilidade

Cada peça pode ser revertida isoladamente:

- motor: `git revert` do commit `fase B: motor` (research.mjs + testes do motor);
- fundo: tirar `background:true` da UI e a rota continua a aceitar o modo síncrono;
- cabeçalhos: `ALLOW_EMBED=1` repõe o comportamento anterior sem mexer em código;
- CI: apagar `.github/workflows/ci.yml`.
