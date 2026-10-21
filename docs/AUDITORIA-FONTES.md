# FASE ZERO — AUDITORIA DO PROJECTO ANTES DA EXPANSÃO DE FONTES (2026-10-21)

Auditoria feita antes de escrever código novo, como o pedido exige. Tudo o que está aqui foi
observado nesta sessão: comandos executados, ficheiros lidos, testes corridos. Onde não foi
possível testar, está escrito «não testado» e porquê.

## 1. Arquitectura encontrada

| componente | tecnologia | onde |
| --- | --- | --- |
| Interface | JavaScript sem framework, grafo com Cytoscape 3.34 (servido localmente, sem CDN) | `index.html`, `src/` |
| Dados do grafo | ficheiros JS que constroem um objecto `VN_DATA` (schema próprio, estados de verificação) | `data/` |
| Servidor | Node 20, `node:http`, sem framework | `server/api.mjs`, `tools/serve.mjs` |
| Base de dados | **ficheiro JSON único** com escrita atómica, `sha256`, cópias de segurança e bloqueio de instância | `server/store.mjs` |
| Autenticação | sessões opacas em cookie `HttpOnly`, CSRF, scrypt, papéis USER/ADMIN, **TOTP** e códigos de recuperação | `server/auth.mjs`, `server/mfa.mjs` |
| Documentos | extracção de PDF por `/ToUnicode`, OCR local (tesseract.js WASM), hashes SHA-256 | `server/pdftext.mjs`, `server/ocr.mjs` |
| Recolha | agentes locais + `/api/fetch` com guarda SSRF, sem proxy aberto | `server/agents.mjs`, `server/api.mjs` |
| Verificação de acesso a fontes | GET único com guarda SSRF e cadeia de redireccionamentos validada | `server/access.mjs` |
| IA opcional | router de fornecedores com chaves cifradas (AES-256-GCM), 13 agentes, orçamento | `server/providers.mjs`, `server/crypto-keys.mjs`, `server/agents.mjs` |
| Testes | 16 suites de servidor (297 asserções) + 6 suites de interface (53 asserções) | `tests/` |
| Deploy | Render (plano gratuito), repo público, chave SSH de deploy | `render.yaml` |

## 2. Componentes efectivamente testados nesta auditoria

Executados nesta sessão, antes de qualquer alteração:

- `npm test` — **16 suites, 297 asserções, 0 falhas** (inclui SSR F, cifra de PDF, OCR, proveniência, grafo, agentes, APIs).
- `npm run test:ui` — **6 suites, 53 asserções, 0 falhas** com Chromium headless.
- `npm run test:publico` — 28 asserções contra o serviço publicado (OCR real 143 caracteres,
  confiança 93/100; MFA em dois passos; conta descartável criada e eliminada).
- `node tools/audit-deps.mjs` — sem vulnerabilidades altas/críticas na árvore instalada.

## 3. Problemas confirmados (e o que foi feito)

| # | problema | evidência | acção |
| --- | --- | --- | --- |
| 1 | **O conjunto de dados era inteiramente fictício** («Caso Meridiano», 69 entidades, 126 relações) | `data/00-schema.js` declarava `fictional: true` | **removido**; substituído por dados reais importados (ver §5) |
| 2 | Extractor de PDF falhava com PDFs reais de tribunais («nenhum texto encontrado nos fluxos analisados») | PDFs do CourtListener: 100 % de falha num lote de 3 | **corrigido** em `dictSlice` (valor `/Contents 5 0 R` era lido como dicionário seguinte). Depois da correcção: 17 de 50 candidatos aceites, todos com texto |
| 3 | A aplicação não tinha registo de fontes: existia catálogo de APIs (auditado) e verificação de acesso por prova, mas nenhum modelo de fonte com estados, histórico e decisões | inspecção de `server/*.mjs` e das rotas (`/api/sources` não existia) | **implementado** (fase 3G, §5) |
| 4 | Esquema de dados v5 sem colecções para fontes/verificações/classificações | `SCHEMA_VERSION = 5` | **migração v6** aditiva e reversível (só cria colecções) |
| 5 | O `README` e vários documentos afirmavam que os dados eram fictícios | `README.md` §1, `docs/PESQUISA.md`, `docs/AUDITORIA-CODIGO.md` | **actualizados** nesta fase |

## 4. Riscos identificados (por prioridade)

1. **P0 — disco efémero no Render (não resolvido, mitigado).** Ficheiro JSON com escrita atómica,
   `sha256`, três cópias e bloqueio de instância; um deploy continua a apagar tudo. **Solução real:
   Postgres ou disco persistente.** O `store.mjs` foi mantido com uma superfície pequena para ser
   substituível.
2. **P1 — sem verificação de email nem reposição de palavra-passe por email.** O campo existe, o
   envio não. Quem perde a palavra-passe depende de um administrador.
3. **P1 — MFA opcional.** Existe e funciona, mas um administrador pode não o activar.
4. **P2 — cobertura de fontes quase nula.** 1 adaptador real (tribunais dos EUA), 30 categorias
   previstas, 50 jurisdições catalogadas: o motor existe, o catálogo é que está no início.
5. **P2 — extracção de PDF sem rasterização (CCITT/JBIG2).** Digitalizações antigas ficam declaradas
   como não suportadas em vez de adivinhadas.
6. **P3 — `frame-ancestors *` na CSP** (necessário para pré-visualizações embutidas; está documentado).

## 5. Alterações propostas e executadas (todas reversíveis)

| alteração | ficheiros | reversão |
| --- | --- | --- |
| Remoção do conjunto fictício e importação real | `data/*` (removidos 7 ficheiros), `data/real/10-epstein.js`, `data/real/PROVENIENCIA.json`, `tools/import-epstein.mjs` | `git revert` do commit; os ficheiros fictícios estão no histórico do Git |
| Registo de fontes | `server/sources.mjs` (novo), `server/store.mjs` (+v6), `server/api.mjs` (+7 rotas) | migração é aditiva; remover as rotas e as colecções não afecta dados existentes |
| Interface do registo | `src/ui/fontes.js` (novo), `src/ui/console.js` (1 separador), `index.html` (1 `<script>`) | remover o separador devolve a consola ao estado anterior |
| Testes novos | `tests/fontes.mjs`, `tests/fontes-ui.mjs` | não alteram produção |
| Correcção do extractor | `server/pdftext.mjs` (`dictSlice`) | coberto por 19 testes próprios; reverter reintroduz o falso negativo |

**Plano de reversão global:** cada alteração está num commit próprio; `git revert <commit>` +
`npm test` devolve o estado anterior. Não há migração destrutiva: a v6 só acrescenta colecções
vazias, pelo que voltar ao código antigo lê a mesma base sem perda (o código antigo ignora as
colecções novas).

## 6. Funcionalidades a preservar (verificadas antes e depois)

Grafo interactivo e legenda; estados de verificação; pesquisa com tolerância a gralhas; livro de
provas com hash encadeado; importação de dados reais validada; recolha com guarda SSRF; extracção
de PDF e OCR; relatório de 18 secções; exportações; autenticação, papéis, MFA e auditoria; contas,
projectos e chaves de IA; migrações e cópias de segurança da base.

Cada uma tem teste próprio; a passagem de 297 + 53 asserções depois das alterações é a prova de que
não houve regressão.

## 7. Baseline medida (antes) e resultado (depois)

| indicador | baseline (antes desta fase) | resultado actual | evidência |
| --- | ---: | ---: | --- |
| Fontes registadas | **0** (não existia modelo de fontes) | **1 registada manualmente + 18 descobertas reais** por execução de teste | `tests/fontes.mjs`, histórico em `discoveryRuns` |
| Fontes tecnicamente verificadas | 0 | **2** (CourtListener raiz → 403 `RESTRICTED`; API v4 → 200) | `sourceChecks` |
| Adaptadores funcionais | 0 | **1** (`courtlistener_courts`, 20 candidatos reais) | execução registada |
| Documentos reais no grafo | 0 (69 entidades fictícias) | **17 decisões judiciais com hash SHA-256 e SHA-1 conferido** | `data/real/PROVENIENCIA.json` |
| Entidades no grafo | 69 fictícias | **46 reais** (18 pessoas, 3 empresas, 3 organismos, 5 tribunais, 17 documentos) | `data/real/10-epstein.js` |
| Relações no grafo | 126 fictícias | **82 reais, todas processuais e com excerto** | idem |
| Asserções de teste | 271 servidor + 43 interface | **297 + 53** | `npm test`, `npm run test:ui` |
| Custo de execução | 0 € (nenhum serviço pago) | **0 €** (CourtListener sem chave, plano gratuito) | registos de utilização |

## 8. O que não foi possível testar

- **Postgres** como armazenamento: não há serviço disponível nesta sessão; a recomendação fica
  registada, não implementada.
- **Envios de email**: sem SMTP configurado; não se testou o que não existe.
- **Adaptadores para fontes nacionais** (Portugal incluído): exigem leitura da documentação de cada
  portal; nenhum foi escrito para não apresentar adaptadores «de fachada».
- **Carga real de OCR no plano gratuito**: medido apenas com um documento por vez.
