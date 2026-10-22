# Conspiracy Tracker · Rede de investigação visual

Aplicação de investigação **visual-first**: um grafo interactivo de pessoas, empresas, fundações,
organizações, organismos públicos, instituições religiosas, tribunais, documentos, acontecimentos e
transacções — em que **cada ligação é uma relação tipificada com fonte, excerto, estado de verificação
e data**. Painéis de detalhe, caminhos, cronologia e exportação com provas são complementares ao mapa.

> **Os dados incluídos são reais.** A aplicação abre com 17 decisões judiciais públicas (46 entidades,
> 82 relações processuais), descarregadas de uma API pública de documentos judiciais, com SHA-256 do
> ficheiro, SHA-1 conferido contra o publicado pela fonte e excerto literal em cada relação. Não há
> dados de demonstração inventados: ver `data/real/PROVENIENCIA.json` e `docs/DADOS-REAIS.md`.
>
> **Uma ligação no grafo não é prova de nada.** Todas as arestas do conjunto real são processuais
> (`litigation_with`, `documented_in`, `ruled_on`, `mentioned_in`) e dizem-no na própria descrição.
> Nenhuma aresta afirma crime, coordenação ou culpa.

**Instância pública:** https://conspiracy-aitracker.onrender.com (Render, plano gratuito — o primeiro
acesso após inactividade pode demorar ~30 s).
Repositório: https://github.com/rpolicarpo100/Conspiracy_Tracker

## Como abrir

```bash
npm install
APP_SECRET='segredo-com-pelo-menos-24-caracteres' DATA_DIR="$PWD/.data" \
  node tools/create-admin.mjs            # pergunta email e palavra-passe (sem eco)
APP_SECRET='segredo-com-pelo-menos-24-caracteres' DATA_DIR="$PWD/.data" \
  node tools/serve.mjs                   # http://localhost:8080
```

Depois disso a entrada faz-se com essa conta. **O registo público está fechado por omissão**: sem
`REGISTER_OPEN=true` escrito de propósito, `POST /api/auth/register` responde `403 REGISTRATION_CLOSED`.
As contas seguintes são criadas por um administrador em `/api/admin/users` (interface «Conta e
administração»), que devolve uma palavra-passe temporária **uma única vez** e obriga à troca no
primeiro acesso.

`APP_SECRET` é obrigatório para guardar chaves de IA (cofre AES-256-GCM); `DATA_DIR` guarda o
`store.json` fora do código. `ADMIN_EMAIL` já não cria administradores por si: com o registo fechado
não há «primeiro registo» a promover — serve apenas para diagnóstico em `/api/meta`.

### Porta de entrada e servidor local de testes

A aplicação **não arranca sem sessão**: `index.html` mostra a porta (email, palavra-passe, segundo
passo e troca obrigatória de palavra-passe temporária) e só depois de `/api/auth/me` devolver um
utilizador é que o resto é iniciado. Um fim de sessão — botão, expiração ou revogação noutro
dispositivo — devolve a pessoa à porta com o motivo escrito.

Para desenvolvimento e testes de interface há um servidor local que **nunca** deve ser usado em
produção (`REGISTER_OPEN=true` só aqui, dados em `.data-dev`, `APP_SECRET` gerado por sessão):

```bash
bash tools/dev-server.sh                     # http://localhost:8080
bash tools/ui-env.sh npm run test:ui         # 8 suites, 81 testes de interface
```

Ou, numa sessão Arena, abrir o `index.html` com o servidor de pré-visualização.
Dependências visuais: Cytoscape.js + fcose (MIT), servidas localmente em `node_modules` — nada de CDN.

## O que a aplicação faz

**Mapa** — nós com avatar/logótipo procedimental e selo de verificação; arestas com tipo, família,
estado (contínua / tracejada / pontilhada / vermelha) e espessura por confiança. Zoom, deslocação,
pesquisa, selecção, expansão por níveis, recolha de ramos, fixar, ocultar, isolar, agrupar vizinhos
não carregados (`+N`), filtros de tipo/relação/estado/fonte/período/texto, realce de caminhos,
histórico e anulação.

**Pesquisa profunda** — paleta de comandos (`⌘K`) e página de resultados completa: tolerância a
acentos, maiúsculas e gralhas (`accionsta` → `accionista`), frases exactas, filtros estruturados
(`tipo:`, `estado:`, `ano:`, `fonte:`, exclusões), excertos com o termo realçado, *porque casou* em cada
resultado, **ligações entre resultados** (o que une dois resultados, e a que distância), fachas,
ordenação por qualidade de prova, e registo da ausência quando não há resultados. Ver `docs/PESQUISA.md`.

**Detalhes** — identidade, proveniência da imagem, factos documentados, **alegações atribuídas**,
**contra-provas**, ligações por família, fluxos financeiros (montantes explícitos), documentos
associados com excertos, cronologia e limitações. Ao seleccionar uma ligação: relação exacta, fonte,
localização, excerto, confiança justificada, data de verificação e «o que esta ligação não prova».

**APIs externas** (consola → **APIs**) — catálogo de 12 fontes com licença, autenticação, o que
respondem e o que **não** provam; auditoria automática que mede **segurança, fiabilidade e utilidade**
com razões explícitas e veredicto; agente de descoberta que procura APIs no catálogo APIs.guru, lê a
especificação OpenAPI e deriva um pedido de teste — ou diz que não consegue; formulário para acrescentar
APIs próprias (guardadas apenas no navegador). Ver `docs/APIS.md` e `docs/APIS-auditoria.json`.

**Caminhos** — até 6 passos, ordenados por qualidade de evidência (elo mais fraco, confiança média,
cobertura documental, número de passos), com fontes por passo, sinalização de ligações incertas ou
contraditadas, ligações comuns e aviso metodológico permanente.

**Cronologia sincronizada** — selecção de intervalo por arrasto ou teclado; distingue datas exactas de
estimativas; relações sem data são listadas à parte e **nunca projectadas** em períodos anteriores.

**Consola de investigação** (botão *Investigar*):
1. **Investigar** — pergunta → plano de fontes verificáveis (planeador local, sem IA), hipóteses com o
   teste que as refutaria, registo negativo obrigatório.
2. **Fontes** — directório com tipo de acesso e **limitação de cada fonte**.
3. **Livro de provas** — registo append-only com hash SHA-256 encadeado; detecta alterações;
   exportável; inclui resultados negativos («não encontrado em X, em data Y»).
4. **Dados reais** — importação validada: rejeita relações sem fonte, excerto ou revisor;
   calcula taxas de cobertura documental.
5. **Agentes de recolha** — recolha documental com provas: `robots.txt` respeitado, anti-SSRF, limites
   de ritmo/tamanho/tempo, simulação por omissão, **SHA-256 do corpo verificado dos dois lados** e
   registo no livro de provas. Um agente obtém e prova documentos; **nunca escreve no grafo**. Ver
   `docs/AGENTES.md`.
6. **Configuração de IA** — endpoint/modelo/chave locais, consentimento explícito por envio,
   contrato de evidência imposto ao modelo e validador que rejeita afirmações sem fonte, confirmações
   sem fonte primária e linguagem de imputação. Sem chave: copiar prompt → colar resposta → validar.

**Exportação** — relatório HTML com referências `[r-nnn]`/`[d-nnn]` e impressão digital do conteúdo,
ficha de entidade, caminhos, CSV de relações, JSON do modelo, impressão/PDF. Vista em tabela
equivalente ao grafo para leitura acessível.

## Princípios de método aplicados no código

- Não se infere relação por co-presença em página, fotografia ou lista de contactos.
- Relação confirmada exige fonte primária + excerto + revisor (validado no modo real).
- Alegação ≠ facto; contradição não é apagada: fica visível e assinalada.
- Sem imagem fiável e licenciada → avatar declarado; nunca fotografia inventada.
- Um caminho é a existência de relações registadas, não prova de coordenação.
- O que não foi encontrado é registado com fonte, termos e data.

## Estrutura

```
index.html                 interface
src/styles.css             sistema visual (tema escuro/claro, responsivo, impressão)
src/core/model.js          modelo, índices, validação, temporalidade
src/core/index.js          índice invertido: tokens, sinónimos, Dice, sugestão por gralha
src/core/search.js         linguagem de consulta, excertos, «porque casou», ligações entre resultados
src/core/query.js          pesquisa, filtros, caminhos, ligações comuns, séries
src/core/agents.js         agentes de recolha: guardas, extractores, prova com SHA-256
src/core/apis.js           catálogo de APIs, auditoria com pesos, agente de descoberta
src/ui/apis.js             separador APIs: tabela, detalhe, formulário, descoberta
tools/fetch-api.mjs        agente local (POST /api/fetch) com as mesmas guardas
src/core/store.js          estado, histórico, carregamento progressivo, grupos +N
src/core/ledger.js         livro de provas com hash encadeado
src/core/research.js       planeador de investigação, contrato de IA, validador
src/core/realdata.js       portão de importação de dados reais
src/graph/adapter.js       único ficheiro que conhece Cytoscape (substituível)
src/graph/avatars.js       avatares/logótipos procedimentais + proveniência
src/ui/*.js                painéis, detalhes, caminhos, cronologia, relatório, consola,
                           paleta de comandos (palette.js), página de pesquisa (searchpage.js)
src/ui/account.js          área de conta: entrar/registar, sessões, palavra-passe, exportar,
                           eliminar conta, projectos, chaves de IA e administração
server/store.mjs           persistência atómica (DATA_DIR): utilizadores, sessões, projectos,
                           credenciais, uso, auditoria, contadores
server/auth.mjs            scrypt, tokens de sessão com SHA-256, cookies, CSRF, rate limiting
server/crypto-keys.mjs     cofre AES-256-GCM para as chaves de IA (exige APP_SECRET)
server/providers.mjs       8 adaptadores de IA (compatíveis com OpenAI), retry, timeout, disjuntor
server/api.mjs             rotas, permissões no servidor, auditoria de acessos administrativos
data/real/*.js             conjunto real importado (17 documentos, 46 entidades, 82 relações)
data/real/PROVENIENCIA.json proveniência conferida documento a documento (hash, fonte, data)
data/00-schema.js          esquema do conjunto (VN_DATA/VN_KIT), sem dados inventados
tests/                     testes funcionais, de servidor e de interface (Playwright)
tools/                     servidor (estático + API) e comparação de bibliotecas
docs/                      aceitação, esquema, benchmarks, capturas
```

## Documentação

- `docs/ACEITACAO.md` — os 10 critérios, como foram testados e o resultado obtido.
- `docs/BENCHMARKS.md` — comparação de bibliotecas e medições de escala (com limites assumidos).
- `docs/SCHEMA.md` — modelo de dados, estados, temporalidade, livro de provas, importação real.
- `docs/PESQUISA.md` — como a pesquisa funciona, sintaxe, garantias, desempenho medido e limites.
- `docs/AGENTES.md` — guardas dos agentes de recolha, provas obtidas, recusas reais e responsabilidades.
- `docs/APIS.md` — catálogo, método de pontuação, auditoria real (com recusas) e agente de descoberta.
- `docs/IA-E-EVIDENCIA.md` — contrato imposto à IA, o que o validador rejeita, como ligar um modelo,
  privacidade, e que agentes faz sentido automatizar (e quais nunca).
- `docs/PRIVACIDADE.md` — política de privacidade e RGPD: o que é guardado, base legal, cookies,
  acesso administrativo auditado, direitos, retenção e o que ainda não está feito.
- `docs/PERMISSOES.md` — papéis, matriz completa de permissões, isolamento entre utilizadores,
  limites de abuso.
- `docs/FORNECEDORES.md` — os 8 fornecedores de IA, cofre de chaves, como validar, resiliência e
  limites.
- `docs/EVIDENCIA.md` — registo de provas, os nove estados das conclusões e as regras que impedem
  tratar dez cópias de um comunicado como dez confirmações.
- `docs/MOTOR-PESQUISA.md` — os 20 passos do motor, perfis de esforço, motivos de paragem, defesas
  contra injecção de instruções e o relatório de 18 secções.
- `docs/GRAFO.md` — grafo a partir de provas: uma linha não é prova, co-ocorrência não é relação,
  homónimos não se fundem sem identificador, caminhos, contradições, filtro temporal e exportação.
- `docs/AGENTES-P3.md` — os 13 agentes: contrato, critérios, limites, versão de prompt, o que
  analisam e o que nunca escrevem, e as 10 regras do auditor adversário.
- `docs/ESTADO-ATUAL.md` — estado real do trabalho (gerado em parte por `tools/status.mjs`): o que
  está concluído e testado, o que é parcial, o que não existe e o que está bloqueado.
- `docs/DECISOES.md` — registo de decisões com data, motivo e o que foi recusado.
- `docs/ACESSO-FONTES.md` — verificação de acessibilidade das fontes e as suas guardas.
- `docs/AUDITORIA-CODIGO.md` — matriz de auditoria (componente, estado real, evidência, risco,
  acção) e diagnóstico da disponibilidade.
- `docs/TEST-RESULTS.txt` — saída integral dos testes.

## Contas, papéis e chaves de IA

A aplicação passou a ter contas (opcional): sem sessão, os dados continuam a viver apenas no
navegador; com sessão, projectos e chaves ficam associados ao utilizador e isolados de outros.

- **Registo/entrada** com verificação de força de palavra-passe no servidor, `scrypt`, sessões de
  12 h revogáveis e CSRF por *double-submit*.
- **USER** vê apenas os seus projectos, as suas chaves e o seu histórico; **ADMIN** acrescenta
  utilizadores, métricas reais, auditoria e consulta de projectos **com motivo registado**.
- **Chaves de IA por utilizador** (Gemini, Groq, OpenRouter, Cerebras, Mistral, Hugging Face,
  Cloudflare Workers AI e endpoint compatível com OpenAI): cifradas com AES-256-GCM, mostradas
  apenas em máscara (`chav…123`) e validadas por uma chamada real antes de serem dadas como
  operacionais. Uma chave inválida é reportada como inválida (ex.: «credencial recusada (HTTP 401)»).
- **Exportar** e **eliminar** a conta fazem-se na própria interface.
- **Projectos de investigação** com pergunta, âmbito, data de referência, hipóteses (nunca promovidas
  a facto), critérios de conclusão, orçamento, checkpoints, duplicação, arquivo e cancelamento.
- **Registo de provas** por projecto: excerto obrigatório, hash SHA-256, URL canónico, tipo de fonte,
  posição, estado de validação e limitações. Cópias do mesmo comunicado contam como **uma** origem.
- **Motor de pesquisa de 20 passos** com perfis de esforço (rápida/normal/profunda/exaustiva),
  orçamento de chamadas/documentos/tempo, execuções persistentes, **retomáveis e canceláveis**. Se
  não houver chave de IA validada ou não houver URLs, a execução **pára e diz porquê** — não inventa
  interpretações nem excertos.
- **13 agentes** com contrato declarado e execuções guardadas: orquestrador, planeador, pesquisa,
  documentos, extracção, resolução de entidades, relações, societário/financeiro, cronologia,
  contra-provas, verificação de factos, **auditor adversário** e relatório. Nenhum agente escreve
  conclusões: propõem ou apontam problemas, e a decisão fica com quem investiga.
- **Grafo das provas**: 16 tipos de entidade e 24 tipos de relação; **sem prova registada não há
  aresta**; a confiança é calculada por origens independentes e justificada; relações inferidas são
  tracejadas e exigem raciocínio; pares que só co-ocorrem aparecem como candidatos marcados «não é
  relação»; homónimos ficam separados sem desambiguador. Clicar mostra a proveniência.
- **Relatório de 18 secções** em JSON e Markdown, com «Não disponível» explícito no que não está
  instrumentado e com as provas contrárias sempre à vista.
- **Conclusões com nove estados** validados no servidor: «confirmada» exige duas origens
  independentes e uma prova primária, sem prova contrária activa; uma prova contrária obriga a
  «contraditória»; retirar uma prova exige motivo e não apaga o histórico.

Variáveis de ambiente relevantes (nunca com segredos no repositório): `APP_SECRET` (≥24 caracteres,
obrigatório para guardar chaves), `DATABASE_URL` (base Postgres: é o que torna os dados duráveis —
ver `docs/PERSISTENCIA.md`), `DATA_DIR` (pasta de dados), `REGISTER_OPEN` (ausente = registo
fechado; `true` abre-o e tem de ser uma decisão escrita), `ADMIN_BOOTSTRAP_TOKEN` (arranque do
primeiro administrador por HTTPS), `ADMIN_EMAIL` (diagnóstico: se ainda não existe administrador,
`/api/meta` diz que é preciso correr `tools/create-admin.mjs`), `LOGIN_MAX_ATTEMPTS`,
`REGISTER_MAX`, `AGENT_BUDGET`, `PORT`.

## Publicar (Render, plano gratuito)

O repositório traz um `render.yaml` (serviço web Node, `plan: free`, região Frankfurt, health check `/`).

```bash
# 1. repositório público
git remote add origin https://github.com/<utilizador>/meridiano.git
git push -u origin main

# 2. Render → New → Blueprint → escolher o repositório
#    (ou, por API: POST https://api.render.com/v1/services com repo público + startCommand "node tools/serve.mjs")
```

Notas de produção já aplicadas no servidor (`tools/serve.mjs`):

- cabeçalhos de segurança (CSP sem `unsafe-eval`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`);
- `/api/fetch` (agente local) recusa origens externas com **403** e aplica orçamento por IP
  (`AGENT_BUDGET`, 60 pedidos/10 min por omissão → **429**), além das guardas anti-SSRF, `robots.txt`,
  limites de 2 MB/15 s;
- ficheiros ocultos não são servidos; nenhum segredo está no código.

O plano gratuito do Render **adormece** a instância após inactividade: o primeiro acesso pode demorar
13–30 s (medido: 13,46 s no primeiro pedido da sessão, ~0,22 s depois). O estado da investigação
continua no `localStorage` do navegador quando não há sessão; com sessão, o que a API guarda fica em
`DATA_DIR` — e **o plano gratuito não tem disco persistente**, pelo que esses dados se perdem em cada
deploy. `/api/meta` declara essa limitação (`durableBetweenDeploys`).

## Estado da V2 (fase 1) em produção

Publicado em `main` (commit verificado em `/health`) e verificado por pedidos HTTP reais:
registo/login, projecto criado com CSRF e recusado sem ele, `/api/admin/*` a 403 para USER,
exportação, eliminação de conta (com confirmação de palavra-passe) e o cofre de chaves a recusar
guardar quando falta `APP_SECRET`.

**Acção necessária do operador**: definir `APP_SECRET` (≥24 caracteres) nas variáveis de ambiente do
serviço no Render. Sem isso, `/ready` reporta `keyVault.ok:false` e a aplicação devolve
`503 needsEnv=APP_SECRET` em vez de guardar chaves — é o comportamento correcto, mas as chaves de IA
ficam indisponíveis.

O administrador cria-se **sem registo público**, por dois caminhos — nenhum deles com credenciais no
repositório:

1. **Instância nova sem consola (Render, plano gratuito)** — arranque por HTTPS com um segredo do
   operador:

   ```bash
   # 1) definir ADMIN_BOOTSTRAP_TOKEN no painel do Render (valor longo e aleatório)
   # 2) criar o administrador (a palavra-passe é escolhida por si, neste pedido)
   curl -X POST https://conspiracy-aitracker.onrender.com/api/auth/bootstrap \
     -H 'content-type: application/json' -H "x-bootstrap-token: $TOKEN" \
     -d '{"email":"o-seu@email.pt","password":"A-Sua-Palavra-Passe-Forte1"}'
   ```

   A rota responde `503` sem a variável, `401` com segredo errado, `429` acima de 3 tentativas por
   hora e `403` logo que exista um administrador activo — é uma porta que se fecha sozinha.

2. **Com acesso ao disco** — `node tools/create-admin.mjs` (pede a palavra-passe sem eco).

Depois de criar o administrador, **retire `ADMIN_BOOTSTRAP_TOKEN`** do ambiente. Excepção: enquanto o
disco for efémero (plano gratuito), um redeploy apaga as contas e o token é o único caminho de volta —
mantenha-o até a persistência ser durável e depois remova-o. Ver `docs/AUDITORIA-2026-10-22.md` §4.

## Persistência

Sem `DATABASE_URL`, os dados vivem apenas no disco do serviço — e no plano gratuito do Render esse
disco é **apagado em cada deploy**. Com `DATABASE_URL` (Postgres gerido: Neon, Supabase, outro), o
mesmo documento é gravado numa base e sobrevive a deploy, reinício e troca de instância. O modo
activo, a versão do documento e os erros de gravação estão sempre visíveis em `/ready`
(`checks.persistence`), e `durableBetweenDeploys` só é `true` depois de a base confirmar a escrita.
Cópias pontuais e restauro: `node tools/pg-snapshot.mjs`. Detalhes e provas em
`docs/PERSISTENCIA.md`.

## Limitações

O que continua por fazer, dito sem rodeios:

- **Recuperação de palavra-passe por email** — não existe. Quem perde a palavra-passe depende de um
  administrador, que a repõe (operação registada na auditoria).
- **Retenção automática** — a purga está implementada e testada
  (`POST /api/service/maintenance`, `tests/retencao.mjs`), mas só corre quando `CRON_TOKEN` existir:
  em produção `/api/meta` → `retention.automated` mostra `false` enquanto isso não for feito.
- **Rotação das cópias de segurança** — idem: depende do mesmo segredo.
- **Assinatura digital do livro de provas** — o encadeamento de hashes detecta alteração, mas não há
  assinatura externa.
- **Escala do grafo** — acima de ~500 nós visíveis é preciso trocar o adaptador por WebGL.
- **Política de privacidade publicada** — já nomeia os subcontratantes (Render e Neon, ambos na UE);
  falta a revisão jurídica por quem opera a instância.

Persistência: em produção a base é PostgreSQL gerido (Neon, Frankfurt) e sobrevive a deploy —
`/ready` devolve `storage.mode: postgres` e `durableBetweenDeploys: true`. Sem `DATABASE_URL` o
servidor cai para ficheiro local e declara-o (`durableBetweenDeploys: false`), em vez de fingir.

Nada disto é substituído por confiança: está listado, com classificação por item, em
`docs/AUDITORIA-CODIGO.md` e em `docs/ACEITACAO.md` §«O que não está feito».
