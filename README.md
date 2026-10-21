# Meridiano · Rede de investigação visual

Aplicação de investigação **visual-first**: um grafo interactivo de pessoas, empresas, fundações,
organizações, organismos públicos, instituições religiosas, tribunais, documentos, acontecimentos e
transacções — em que **cada ligação é uma relação tipificada com fonte, excerto, estado de verificação
e data**. Painéis de detalhe, caminhos, cronologia e exportação com provas são complementares ao mapa.

> **Os dados incluídos são fictícios** (caso «Meridiano», marcado em todo o lado). Servem para testar
> a plataforma. O modo real aceita apenas dados com proveniência verificável — ver `docs/SCHEMA.md`.

**Instância pública:** https://conspiracy-aitracker.onrender.com (Render, plano gratuito — o primeiro
acesso após inactividade pode demorar ~30 s).
Repositório: https://github.com/rpolicarpo100/Conspiracy_Tracker

## Como abrir

```bash
npm install
APP_SECRET='segredo-com-pelo-menos-24-caracteres' ADMIN_EMAIL='admin@exemplo.pt' \
DATA_DIR="$PWD/.data" node tools/serve.mjs   # http://localhost:8080
```

`APP_SECRET` é obrigatório para guardar chaves de IA (cofre AES-256-GCM); `ADMIN_EMAIL` promove o
primeiro registo com esse email; `DATA_DIR` guarda o `store.json` fora do código.

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
data/*.js                  conjunto fictício (69 entidades, 126 relações)
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

Variáveis de ambiente relevantes (nunca com segredos no repositório): `APP_SECRET` (≥24 caracteres,
obrigatório para guardar chaves), `ADMIN_EMAIL` (promove o primeiro registo com esse email),
`DATA_DIR` (pasta de dados), `LOGIN_MAX_ATTEMPTS`, `REGISTER_MAX`, `AGENT_BUDGET`, `PORT`.

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
ficam indisponíveis. `ADMIN_EMAIL` deve ser definido no painel (nunca no repositório) para haver
administrador.

## Limitações

Persistência garantida em produção **não existe** enquanto o serviço correr no plano gratuito (sem
disco): um deploy apaga contas, projectos e chaves guardadas no servidor. Não há MFA, recuperação de
palavra-passe por email, retenção automática nem backups de dados. Não há OCR nem assinatura digital
do livro de provas, e acima de ~500 nós visíveis é necessário trocar o adaptador por WebGL.

Nada disto é substituído por confiança: está listado, com classificação por item, em
`docs/AUDITORIA-CODIGO.md` e em `docs/ACEITACAO.md` §«O que não está feito».
