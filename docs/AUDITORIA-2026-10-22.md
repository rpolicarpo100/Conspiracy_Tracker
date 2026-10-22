# Auditoria de 22 de outubro de 2026 — ponto de partida medido

Este documento não é um plano de intenções: é o registo do que foi **medido**
antes de tocar em código, e do que ficou feito a seguir. Cada afirmação tem
uma etiqueta:

| etiqueta | significado |
| --- | --- |
| **MEDIDO** | observado directamente em execução (HTTP, ficheiro, teste), com o número ao lado |
| **PARCIAL** | foi observado parte do que se afirma; o resto não é observável a partir daqui |
| **BLOQUEADO** | exige acesso, autorização ou decisão que não está disponível |
| **NÃO MEDIDO** | ainda não foi observado; não se escreve nada sobre isso |

Regra que este documento segue à letra: quando não há prova, escreve-se
«não medido» ou «bloqueado» — nunca uma frase que soe a resultado.

---

## 1. Alvo

| campo | valor | prova |
| --- | --- | --- |
| Produção | `https://conspiracy-aitracker.onrender.com/` | **MEDIDO** |
| Commit em produção no início da auditoria | `f1536bd` · versão `2.0.0-fase7` | **MEDIDO** — `/health` e `/api/meta` |
| Repositório | `git@github.com:rpolicarpo100/Conspiracy_Tracker.git` | **MEDIDO** — `git remote -v` |
| Branch de arranque | `main` (`f1536bd`) | **MEDIDO** — `git fetch` + `git reset --hard origin/main` |
| Stack | Node 20, servidor HTTP próprio (`node:http`), sem framework; UI em JS sem build; Playwright nos testes de interface | **MEDIDO** — `package.json`, `server/*.mjs` |
| Persistência | ficheiro JSON no disco do contentor (`DATA_DIR`), esquema v7, checksums e cópias rotativas | **MEDIDO** — `server/store.mjs`, `/ready` |
| Plano de alojamento | gratuito (`persistence.durableBetweenDeploys: false`) | **MEDIDO** — `/ready` |

O git do sandbox estava desactualizado em relação ao `origin`. Antes de
`git reset --hard origin/main` foi feita uma cópia da árvore (`tar` para
`/tmp/wt-backup`, 219 ficheiros) e um `diff -rq` depois da reposição: **0
diferenças**. Nada se perdeu.

---

## 2. O HTTP 503 relatado — o que se pode e não se pode concluir

**Observado:** `/` respondeu **200** (15 610 bytes, ~0,24 s, duas vezes
seguidas), `/health` **200** com o commit `f1536bd`, `/ready` **200**. O 503
**não se reproduziu** em nenhuma destas chamadas.

**O que fica por provar:** a causa do 503 original. A explicação mais
provável é o arranque a frio do plano gratuito do Render (a instância dorme
sem tráfego e a primeira chamada apanha o arranque), mas **sem os registos do
serviço isso é uma hipótese, não um facto**. Fica classificado **PARCIAL**.

Para fechar o ponto é preciso: *Logs* do serviço no painel do Render, entre a
hora do erro e 10 minutos depois, com as linhas de arranque e o primeiro
pedido. Não foi pedido acesso a nada além disso.

---

## 3. Rotas e autorização (sondagem real, sem sessão)

Sondagem GET a 50 rotas em produção sem cookie de sessão:

| resultado | quantidade | leitura |
| --- | --- | --- |
| 401 (sessão exigida) | 24 | as rotas privadas recusam antes de devolver dados |
| 200 | 3 | `/api/auth/me` (devolve `user:null` por desenho), `/api/meta` (catálogo público de capacidades), e uma terceira rota pública de saúde |
| 404 | 23 | método errado na sonda (a rota existe com outro verbo) — não é falha de autorização |

Análise estática das **100** rotas do servidor (contagem actual, `tools/status.mjs`):
51 blocos de rota, dos quais apenas **4** não chamam `requireUser` —
`POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/mfa/verify`
e `POST /api/provider-os/cron/run` (autenticada por token de serviço com
`timingSafeEqual`, não por sessão). Todas legítimas.

**Classificação: TESTADO (amostra) / PARCIAL (não exaustivo)** — a sondagem
externa cobre 50 de 100 rotas.

---

## 4. Achados P0 (impedem chamar «plataforma privada» ao que está publicado)

### P0-1 · registo público aberto em produção — **CORRIGIDO neste ramo**

`/api/meta` publicava `registration.open: true`. Qualquer pessoa podia criar
conta e ficar com acesso às rotas autenticadas. Contradiz o requisito
«registo público desactivado por omissão».

Correcção aplicada:

- `server/auth.mjs`: `registrationOpen()` — **fechado quando a variável
  `REGISTER_OPEN` está ausente**; só abre com `REGISTER_OPEN=true` escrito de
  propósito. É lida a cada chamada para poder ser verificada sem reiniciar.
- `server/api.mjs`: `POST /api/auth/register` responde **403
  `REGISTRATION_CLOSED`** e registra `registration_refused` na auditoria;
  `/api/meta` publica `open`, `source`, `policy` e `firstAdminNote` reais.
- `src/ui/account.js`: o ecrã de entrada deixa de oferecer «Criar conta»
  quando o servidor diz que está fechado, e explica como se obtém uma conta.
- `tests/_env.mjs`: opt-in explícito que liga o registo **só** nas suites que
  precisam de criar contas descartáveis (23 ficheiros importam-no). Nenhum
  ficheiro de produção o lê.

### P0-2 · primeiro administrador sem credenciais no código — **CORRIGIDO**

`tools/create-admin.mjs`: cria o primeiro administrador **no servidor**, com
a palavra-passe pedida no terminal sem eco (ou por `--stdin` /
`--password-env`, para automatismos). Recusa `--password` na linha de
comando (ficaria no histórico da shell e visível em `ps`), recusa um segundo
administrador sem `--force`, escreve só o hash scrypt com sal e registra
`admin_user_created` na auditoria. A palavra-passe nunca é impressa.

### P0-3 · contas criadas por administrador — **NOVO**

Com o registo fechado é preciso um caminho para dar acesso a alguém:
`POST /api/admin/users` (administrador + CSRF) cria a conta, devolve uma
**palavra-passe temporária uma única vez** e marca `mustChangePassword`.
Enquanto não for trocada, `requireUser` responde **403
`PASSWORD_CHANGE_REQUIRED`** a tudo excepto `/api/auth/me`, `/api/auth/logout`,
`/api/auth/password` e `/api/meta` — a troca é possível, o resto não.

### P0-4 · dados efémeros no plano gratuito — **BLOQUEADO (decisão do utilizador)**

`/ready` diz `persistence.durableBetweenDeploys: false`. Um redeploy apaga o
`DATA_DIR`. Não há forma de tornar o disco durável no plano gratuito do
Render: as opções são disco persistente (plano pago) ou base de dados externa
(Postgres/Neon e afins). **Não foi implementada nenhuma das duas** porque
ambas mudam custo/arquitectura e exigem decisão e credenciais do utilizador.
O que fica dito, sem maquilhagem: hoje, um deploy apaga contas, projectos,
evidências e chaves. Exportação/restauro documentados são o passo seguinte,
não um substituto.

---

## 5. Achados P1 (corrigidos neste ramo)

### P1-1 · a descoberta no GitHub pedia uma ordenação que esvazia a resposta

`GET /api/provider-os/discover` (adaptador `github_coding_agents`) construía
`?q=topic:coding-agent+topic:coding-assistant&sort=stars&order=desc`. Medido
em 22-10-2026, repetidamente:

| consulta | `total_count` |
| --- | --- |
| `q=topic:coding-agent+topic:coding-assistant` | **177** |
| a mesma + `sort=stars` | **0** |
| a mesma + `sort=updated` | 177 |
| `q=topic:coding-agent` sozinho | 0 (índice externo instável) |

Ou seja: o parâmetro `sort=stars` fazia a fonte devolver zero resultados com
HTTP 200, e a aplicação gravava «0 criadas» como se fosse um resultado. Duas
correcções: a ordenação por estrelas passou a ser calculada **localmente**
sobre os itens recebidos, e uma resposta com zero registos passa a vir marcada
`emptyResponse`/`sourcesEmpty` com a explicação — não é evidência de que o
catálogo esteja vazio. `server/discovery.mjs` deixou também de reconstruir o
URL com `sort=stars` na evidência (ficava um URL que nunca foi pedido).

### P1-2 · a decisão do selector aparecia tarde

O clique em «Escolher fornecedor» só repintava o painel depois de duas idas ao
servidor; até lá o ecrã mostrava o estado anterior e a recusa do selector não
era visível. Passou a repintar imediatamente e a recarregar a seguir. O teste
`tests/provedores-ui.mjs` deixou de falhar por corrida, não por mudança de
expectativa.

---

## 6. Testes — antes e depois (medido, não inferido)

| momento | suites de servidor | verificações | suites de UI | verificações |
| --- | --- | --- | --- | --- |
| início da auditoria (`f1536bd`) | 23 | 428 | 7 | 69 · **1 falha** |
| fim deste ramo | **24** | **437 · 0 falhas · 4 SKIP externos declarados** | 7 | **69 · 0 falhas** |

Os SKIP são de rede externa (CourtListener sem resposta, GitHub a devolver
zero registos por índice/limite). São declarados como SKIP, não contados como
sucesso nem como falha.

Nova suite: `tests/auth-privacidade.mjs` (**13/13**) — registo fechado e
mensagem pública, registo aberto só com a variável, 401 sem sessão em 11
rotas privadas, 403 sem CSRF sem efeito nenhum, isolamento entre contas (lista,
leitura directa e eliminação), palavra-passe temporária bloqueada até à troca,
cookies `HttpOnly`/`Secure`/`SameSite=Lax`, logout a revogar sessão, cookie
anterior e cookie inventado recusados, limite de tentativas (429 após 4) e
eventos de auditoria presentes.

---

## 7. O que continua por fazer (ordenado, com o motivo)

| # | ponto | prioridade | estado |
| --- | --- | --- | --- |
| 1 | Disco durável: Postgres externo ou plano pago + exportação/restauro ensaiada | P0 | **BLOQUEADO** — decisão + credenciais do utilizador |
| 2 | Cron activo: `CRON_TOKEN` no Render e no GitHub Actions | P0 | **BLOQUEADO** — passo do utilizador no painel |
| 3 | Página de login minimalista a substituir a aplicação quando não há sessão | P1 | por fazer |
| 4 | Recuperação de palavra-passe por email | P1 | por fazer — exige serviço de envio |
| 5 | Interface em 9 áreas (Dashboard, Pesquisar, Investigações, Mapa, Cronologias, Agentes, Fontes, Arquivo, Administração) | P1 | por fazer |
| 6 | Adaptadores de fornecedores com métricas de latência/erro e 6 tipos de falha | P1 | parcial (existe o mapa de falhas; faltam métricas por adaptador) |
| 7 | Testes das 12 categorias obrigatórias (incluindo recuperação e carga) | P1 | parcial |
| 8 | Staging separado da produção | P2 | por fazer — exige segundo serviço no Render |

---

## 8. Limitações desta auditoria

- Não houve acesso aos **registos do Render** (o 503 fica **PARCIAL**).
- Não houve autorização para **alterar produção**: tudo o que está descrito
  está no ramo `fase8-login-privacidade`, por publicar.
- A sonda externa cobriu 50 rotas; a cobertura de autorização é **amostra**,
  não prova exaustiva.
- O disco efémero não foi medido por observação de um deploy real — foi lido
  da resposta de `/ready` e do código. Um teste destrutivo em produção está
  proibido por decisão do utilizador.
- As falhas de rede externas foram declaradas SKIP, não investigadas até à
  causa (não são nossas).
