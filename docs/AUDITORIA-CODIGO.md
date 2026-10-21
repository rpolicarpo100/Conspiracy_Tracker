# Auditoria de código — matriz de estado real

Data: 2026-10-21 · Repositório: `rpolicarpo100/Conspiracy_Tracker` (público) · Instância: https://conspiracy-aitracker.onrender.com
Método: leitura do código, execução das suites locais e sondagens HTTP reais ao serviço publicado.
Classificação por item: **TESTADO E CONFIRMADO** · **POR INSPECÇÃO** · **OBSERVADO NO AMBIENTE PÚBLICO** ·
**IMPLEMENTADO MAS NÃO TESTADO EM PRODUÇÃO** · **HIPÓTESE** · **NÃO TESTADO** · **BLOQUEADO**.

## Parte A — Estabilidade e diagnóstico do 503

| Componente | Estado real | Evidência | Risco | Acção |
| --- | --- | --- | --- | --- |
| Disponibilidade do serviço publicado | Disponível; 503 **não** reproduzido | 10 sondagens HTTP (`curl`) a `/` e `/api/meta`: todas 200; primeira após *cold start* em 13,46 s, seguintes ~0,22 s | P2 | Documentar que o plano gratuito do Render suspende a instância por inactividade e que a primeira resposta é lenta; não confundir com erro de aplicação |
| Causa provável do 503 relatado | **HIPÓTESE**: instância adormecida / arranque a frio durante o *health check* | Histórico de deploys do Render: 5 deploys, 0 falhas; nenhuma resposta 5xx observada nas sondagens | P2 | Manter `/health` e `/ready` baratos; não fazer I/O pesado no arranque |
| Rotas de diagnóstico | `/health`, `/ready`, `/api/meta` respondem | `tools/serve.mjs` monta-as antes do estático; `tests/server.mjs` e sondagens públicas | P3 | — |
| Diagnóstico administrativo protegido | Só ADMIN vê métricas e auditoria | `GET /api/admin/*` → 403 para USER (medido no browser) | P3 | — |
| Fuga de credenciais/stack traces nas respostas | Não observada | Erros devolvem `{ok:false,error:{code,message}}`; 500 genérico | P1 | Rever mensagens de erro de fornecedores (já truncadas a 300 chars) |

## Parte B — Autenticação e sessões

| Componente | Estado real | Evidência | Risco | Acção |
| --- | --- | --- | --- | --- |
| Registo/login/logout | Funcionam; logout invalida a sessão no servidor | `tests/server.mjs` 26/26; `tests/account-ui.mjs` 9/9 (após terminar sessão, `GET /api/auth/me` → `user:null`) | P0 concluído | — |
| Política de palavra-passe | Aplicada no servidor | UI com «123» → 400 «palavra-passe fraca…» | P1 concluído | — |
| Hash de credenciais | `scrypt` N=32768, r=8, p=1, salt 16 B, `maxmem` explícito | `server/auth.mjs`; inspecção do `store.json` | P0 concluído | — |
| Sessões: listar e revogar | Sim, por sessão e todas | `GET /api/auth/sessions`, `DELETE /api/auth/sessions/{id}`, `POST /api/auth/logout-all` | P1 concluído | — |
| Token de sessão | 32 bytes aleatórios; guardado apenas como SHA-256 | `server/auth.mjs` | P0 concluído | — |
| Rate limiting | 8 falhas/login, 10 registos/hora por IP; evento `login_blocked` | Teste 429 em `tests/server.mjs` | P1 concluído | — |
| Anti-enumeração | 401 idêntico para email desconhecido e palavra-passe errada | `tests/server.mjs` | P1 concluído | — |
| CSRF | Double-submit obrigatório; sem cabeçalho → 403 | `tests/server.mjs` | P0 concluído | — |
| Cookies | `HttpOnly`, `SameSite=Lax`, `Secure` em HTTPS, 12 h | `server/auth.mjs` | P1 concluído | — |
| Alteração de palavra-passe | Sim, exige a actual e revoga as outras sessões | `POST /api/auth/password` | P1 concluído | — |
| Exportar dados próprios | JSON completo, sem segredos | `GET /api/auth/export`; evento `data_exported` | P1 concluído | — |
| Eliminar conta | Remove utilizador, sessões, projectos, chaves, uso; guarda `account_deleted` sem dados pessoais | `tests/server.mjs` (asserção sobre o ficheiro de dados) | P1 concluído | — |
| **MFA (TOTP)** | **Não implementado** | — | P1 | Prioridade seguinte; obrigatório para ADMIN |
| Recuperação de palavra-passe por email | **Não implementada** (não há envio de email configurado) | — | P1 | Requer serviço de email; declarar como pendente, não simular |
| Reautenticação para acções sensíveis | Não existe | — | P2 | Adicionar em eliminar-conta/alterações de chave |

## Parte C — Papéis e isolamento

| Componente | Estado real | Evidência | Risco | Acção |
| --- | --- | --- | --- | --- |
| Papéis USER/ADMIN | Implementados; `ADMIN` só por `ADMIN_EMAIL` no primeiro registo | `tests/server.mjs`; UI mostra separador só a ADMIN | P0 concluído | — |
| Auto-promoção | Impossível: `role` no corpo é ignorado | Teste dedicado | P0 concluído | — |
| Isolamento entre utilizadores | Projecto de outro → 404 sem revelar conteúdo | Teste dedicado com verificação do ficheiro | P0 concluído | — |
| Acesso administrativo auditado | Evento `admin_access` com actor/recurso/data/motivo | Teste dedicado | P1 concluído | Exigir motivo com 400 quando ausente (hoje aceita «não indicado») |
| Suspensão de conta | Revoga sessões de imediato | Teste dedicado | P1 concluído | Exigir confirmação extra ao suspender outro ADMIN |
| Métricas reais no painel | Utilizadores, admins, sessões, projectos, chamadas, falhas; 3 métricas marcadas «Não disponível» | UI (`tests/account-ui.mjs`) + `tests/server.mjs` | P2 | Instrumentar custo e tarefas em fila antes de os mostrar |
| Papel ANALYST | **Não implementado** | — | P3 | Opcional; decidir se entra |

## Parte D — Projectos e dados

| Componente | Estado real | Evidência | Risco | Acção |
| --- | --- | --- | --- | --- |
| CRUD de projectos | Criar, listar, ler, actualizar, eliminar, por dono | `server/api.mjs`; suite 26/26 e UI | P1 concluído | — |
| Modelo de investigação completo | **Implementado**: título, pergunta, objectivo, descrição, âmbito (geo/período/línguas), data de referência, limite temporal, palavras-chave, entidades, fontes prioritárias/excluídas, hipóteses (com estado testado), subperguntas, critérios de conclusão, orçamento, notas, checkpoints. Provas, alegações e execuções passaram a colecções próprias | `tests/evidence.mjs` («projecto guarda o objecto de investigação completo»); `docs/SCHEMA.md` §Projecto | P2 concluído | Ligar `runs` ao motor de pesquisa |
| Duplicar/arquivar/retomar/cancelar | **Implementado e testado**: `POST …/duplicate` (título «(cópia)», checkpoint), `archive`/`resume`/`cancel` com `archivedAt`, `checkpoints` com contagens reais; outro utilizador recebe 404 | `tests/evidence.mjs` | P2 concluído | — |
| Exportar projecto/relatório | **Não implementado** (só exportação da conta em JSON) | — | P2 | Relatório de 18 secções em PDF/CSV/JSON |
| Persistência | Atómica (ficheiro JSON + `rename`), `DATA_DIR` configurável | `server/store.mjs` | P1 | — |
| **Persistência em produção** | **Não garantida**: plano gratuito sem disco; dados perdem-se em cada deploy, `/api/meta` reporta `durableBetweenDeploys:false` | `server/api.mjs` | **P0 em produção** | Montar disco persistente (plano pago) ou base de dados externa; declarar a limitação na interface (já declarada) |
| Backups/rollback | Rollback por deploy do Render (funciona); backup de dados **não** existe em produção | — | P1 | Copiar `store.json` de forma agendada para fora da instância |
| Migrações | **Implementadas**: `version: 1 → 2` com migradores por passo, registo do que mudou em `migrations`, exposto em `/api/meta`; ficheiro ilegível é preservado (`db.json.broken-*`) | `tests/evidence.mjs` («esquema v1 é migrado para v2») | P2 concluído | Próximo passo exige migrador para o motor de pesquisa |
| Retenção | **Não implementada** (sem purga de auditoria, sessões expiradas ou uso) | — | P1 | Definir prazos (auditoria 180 d, sessões 30 d, uso 90 d) e implementar |

## Parte E — Fornecedores de IA e chaves

| Componente | Estado real | Evidência | Risco | Acção |
| --- | --- | --- | --- | --- |
| 8 adaptadores | gemini, groq, openrouter, cerebras, mistral, huggingface, cloudflare, custom | `server/providers.mjs`; UI lista os 8 | P1 concluído | — |
| Caminho único compatível com OpenAI | Um só `/chat/completions`, sem duplicação | `urlFor()` + `complete()` | P2 concluído | — |
| Cifra das chaves | AES-256-GCM, `APP_SECRET` ≥24 caracteres obrigatório | Teste de ficheiro em disco: só texto cifrado | P0 concluído | — |
| Máscara e não exposição | Só `chav…123` em respostas e auditoria | `tests/server.mjs` | P0 concluído | — |
| Validação antes de operacional | `POST /api/providers/{p}/test` real; `complete` antes de validar → 409 | Teste: groq → `auth`, «credencial recusada (HTTP 401)» | P1 concluído | — |
| Modelo inexistente | Recusado antes de gerar | Teste dedicado | P2 concluído | — |
| Timeout / retry / circuit breaker | 20 s, 2 tentativas, abre após 3 falhas (60 s) | Testes dedicados | P2 concluído | — |
| SSRF | Hosts privados/link-local recusados; `169.254.169.254` → refused | Teste + sondagem pública | P0 concluído | Rever lista de IPs periodicamente |
| Custos | Uso e latência registados; custo marcado «não reportado» quando o fornecedor não o envia | `store.addUsage` | P2 | Não estimar sem tabela de preços verificada |
| Modelo preferido por agente, fallback, quotas por utilizador | **Não implementado** | — | P2 | Fase seguinte do router |
| Chaves de administração (plataforma) | **Não implementado** | — | P2 | Só com consentimento explícito e contabilização por utilizador |

## Parte F — Pesquisa, provas e agentes (V2)

| Componente | Estado real | Evidência | Risco | Acção |
| --- | --- | --- | --- | --- |
| Pesquisa local sobre o conjunto fictício | Funciona, com correcção ortográfica | `tests/search.mjs` 17/17 | P3 concluído | — |
| Recolha real de páginas | `/api/fetch` com limites de tamanho, timeout e bloqueio SSRF | `tests/real-fetch.mjs`; sondagem pública 6 771 B com hash | P2 concluído | — |
| 13 agentes com I/O estruturado | **Implementado no servidor**: contrato de entrada/saída, critérios de conclusão, limites (tempo, itens), versão de prompt (`a1`), estado por execução, `agentRuns` persistidas e ordenadas. Agentes locais determinísticos; agentes de IA exigem chave validada e ficam «nao-executado» sem ela | `tests/agents-p3.mjs` 16/16 | P2/P3 concluído | Filas e orçamento por agente (P4) |
| Auditor adversário (red team) | **Implementado**: 10 regras explícitas (citação sem prova, excerto divergente, prova sem excerto/localização/data, comunicado sem origem, conclusão sem prova, estado acima das provas, confiança inflacionada, linguagem absoluta, cópias como corroboração, relação sem prova, inferência sem raciocínio, confirmada com contraprova); achados com gravidade e sujeito | `tests/agents-p3.mjs` e auditoria real na interface (`docs/shot-22-agentes.png`) | **P0 concluído** | — |
| Agentes não escrevem conclusões | Verificado: após executar orquestrador, auditor e mapeador, estados e relações ficam intactos | `tests/agents-p3.mjs` («nenhum agente alterou conclusões…») | P0 concluído | — |
| Caminho entre entidades | BFS sobre arestas registadas, com provas por passo e aviso de que não é prova de coordenação | `tests/agents-p3.mjs`; interface com a vista | P2 concluído | Caminhos com restrições |
| Cronologia sincronizada | Eventos de provas + períodos de relações, ordenados, com anomalias de data | `tests/agents-p3.mjs` | P2 concluído | Filtro por período no grafo |
| Vista de contradições | Arestas com prova contrária + conclusões com provas dos dois lados | `tests/agents-p3.mjs` | P2 concluído | Filtro por período |
| Pipeline de 20 passos (pesquisa profunda) | **Implementado no servidor**: 20 passos tipados (local/IA/recolha), perfis de esforço, orçamento, paragem com motivo escrito, retoma e cancelamento, execuções persistentes | `tests/research.mjs` 19/19 · `docs/MOTOR-PESQUISA.md` | P2 concluído (falta descoberta automática de fontes e extracção de PDF) | Fila em segundo plano (P4) |
| Relatório rastreável de 18 secções | **Implementado**: JSON e Markdown, com `available:false` e «Não disponível: …» no que não está instrumentado; provas contrárias e fontes inacessíveis sempre presentes | `tests/research.mjs` (18 secções, markdown, secção de relações declaradamente em falta) | P2 concluído | Secção 11 (relações) depende do grafo |
| Execuções (`runs`) persistentes e retomáveis | **Implementado** (runner síncrono com orçamento; retoma só passos em falta) | `tests/research.mjs` | P2 concluído | Mover para fila persistente e *worker* |
| Conteúdo web como não confiável | **Implementado no motor**: regra no prompt de sistema + detecção de padrões de injecção por documento recolhido | `tests/research.mjs` («conteúdo que dá ordens ao agente») | P0 concluído para HTML | Revalidar com PDF/OCR |
| Custos instrumentados | Parcial: tokens reportados pelo fornecedor; custo marcado «não reportado» | secção 17 do relatório | P2 | Tabela de preços verificada |
| Registo de provas (ID único, hash, datas, excerto, estado) | **Implementado e testado**: excerto obrigatório, SHA-256 do excerto, URL canónico (sem UTM/fragmento), datas de publicação/acontecimento/recolha/verificação, tipo de fonte, posição, método de extracção, limitações, histórico por prova | `tests/evidence.mjs` 17/17 · `docs/EVIDENCIA.md` | P2 concluído | Extracção de PDF/OCR |
| Verificação de acesso às fontes | **Implementada e testada**: GET sem cookies/credenciais, guardas SSRF (IPv4/IPv6 internos, DNS, redireccionamentos revalidados), sem contornar paywall/CAPTCHA, conteúdo não guardado, 60 verificações/hora, estado em `evidence.access`, sugestão `fonte-inacessivel` exige decisão humana | `tests/fase3c.mjs` (8 testes) · `docs/ACESSO-FONTES.md` | P2 concluído | — |
| Corroboração independente e duplicados | **Implementado e testado**: `originKey` por `syndicationOf`/domínio/hash; 10 cópias de um comunicado = 1 origem; duplicado exacto devolvido em vez de contado; factores expostos em cada conclusão | `tests/evidence.mjs` («dez cópias… dão UMA origem») | P2 concluído | Pesos de fiabilidade por fonte |
| Estados das conclusões (9) e recusa de promoção | **Implementado e testado**: `confirmada` exige 2 origens + 1 primária + sem contradição; prova contrária activa força «contraditória»; conclusão nasce fraca; sugestão nunca é aplicada automaticamente | `tests/evidence.mjs`; interface em `docs/shot-18-provas.png` | P2 concluído | — |
| Retirada de provas sem perda de histórico | **Implementado e testado**: `DELETE` exige motivo, marca `retractedAt`, mantém a prova na lista e anota a retirada nas alegações dependentes | `tests/evidence.mjs` | P2 concluído | — |
| Perfis de profundidade Rápida/Normal/Profunda/Exaustiva | Parcial (limites por perfil no motor local); sem exposição do motivo de paragem na UI | `src/core/agents.js` | P2 | Mostrar «parou porque…» e fontes efectivamente consultadas |
| Conectores declarados (cobertura, licença, limites…) | Catálogo real auditado (12 APIs, 3 tentativas) | `docs/APIS-auditoria.json`; `docs/APIS.md` | P2 concluído | — |
| Conteúdo web/PDF como não confiável | Guardas de injecção no motor de agentes (testes locais) | `tests/agents.mjs` | P0 na fase P2 | Revalidar quando a extracção de PDF entrar |
| Grafo visual sobre o conjunto fictício | Funciona, com estados de validação e legenda | `tests/deployed.mjs` 6/6 no serviço publicado | P2 concluído | — |
| **Grafo a partir de provas (servidor)** | **Implementado**: 16 tipos de entidade, 24 tipos de relação em 7 famílias, aresta só com prova, confiança calculada por origens independentes, inferência declarada com raciocínio, co-ocorrência devolvida como candidato marcado, homónimos não fundidos sem desambiguador | `tests/graph.mjs` 13/13 | **P0 concluído** | Caminhos, cronologia sincronizada, vista de contradições |
| Grafo na interface | SVG próprio: zoom, arrasto, procura, filtros por tipo, co-ocorrências a pedido, proveniência ao clicar, legenda com 4 avisos | `tests/account-ui.mjs` («grafo das provas desenha…») · `docs/shot-21-grafo.png` | P2 concluído | — |
| Filtro temporal do grafo | **Implementado e testado**: `periodFrom`/`periodTo`, datas validadas (impossíveis → 400), relações sem período e com período aberto ficam incluídas e contadas na resposta | `tests/fase3c.mjs` · `docs/GRAFO.md` §10 | P3 concluído | Caminhos com restrições |
| Exportação do grafo | **Implementada e testada**: JSON/SVG/DOT no servidor com proveniência e avisos, PNG no browser; cada exportação auditada | `tests/fase3c.mjs` (5 testes) · `docs/exemplo-exportacao-grafo.svg` · `docs/shot-24-exportacao-svg.png` | P3 concluído | — |
| Memória da investigação | **Implementada e testada**: 5 tipos, decisões e correcções com motivo obrigatório, append-only, arquivar com motivo, não altera estados, exportação MD | `tests/fase3d.mjs` · `docs/ESTADO-ATUAL.md` | P3 concluído | — |
| Resumo descarregável | **Implementado e testado**: JSON, MD, CSV (BOM, «;»), PDF próprio sem dependências; marca conclusões acima do sustentado | `tests/fase3d.mjs` · `docs/exemplo-resumo.pdf` | P3 concluído | — |
| Cópia de segurança e reposição | **Implementadas e testadas**: exportação sem chaves/hashes, reposição com remapeamento de ligações | `tests/fase3d.mjs` | P1 concluído | Cópia automática agendada (exige disco) |
| Homónimos com identificador | **Implementado e testado**: ligação declarada, reversível, auditada; sem identificador recusada | `tests/fase3d.mjs` · `docs/GRAFO.md` | P3 concluído | — |
| Caminhos com restrições | **Implementado e testado**: por tipo, sem inferências, por janela; conta as arestas excluídas | `tests/fase3d.mjs` | P3 concluído | — |
| Estado do trabalho documentado | `docs/ESTADO-ATUAL.md` com bloco gerado por `tools/status.mjs --check` | `npm run status:check` | P0 concluído | — |
| Documentos e texto de PDF | **Implementados e testados**: extração com `/ToUnicode` e XObjects (igual ao `pdftotext` nos dois PDFs de referência), recusa de cifra, OCR de digitalizados com confiança declarada, ligaduras resolvidas, hash SHA-256, fonte inacessível registada; **nenhuma prova nasce da extração** (revisão humana obrigatória) | `tests/pdftext.mjs` 19 · `tests/fase3e.mjs` 21 · `tests/documents-ui.mjs` 6 · `docs/DOCUMENTOS.md` · `docs/DEPENDENCIAS.md` | P2 concluído | rasterização CCITT/JBIG2 |
| Orçamento dos agentes | **Implementado e testado**: 40 execuções/projecto/dia (locais), 8 (IA), 120 por conta; `429` antes de executar, aviso a 2 restantes, `resetsAt` | `tests/fase3c.mjs` · `docs/AGENTES-P3.md` §7 | P3 concluído | Fila persistente de execuções |
| Secção 11 do relatório (Relações) | Deixou de estar «indisponível» quando há relações: lista-as com provas, origens e avisos | `tests/graph.mjs` e `tests/research.mjs` | P2 concluído | — |

## Parte G — Interface, acessibilidade e higiene

| Componente | Estado real | Evidência | Risco | Acção |
| --- | --- | --- | --- | --- |
| Área de conta na interface | Login/registo, conta, sessões, palavra-passe, exportar, eliminar, projectos, chaves, administração | `tests/account-ui.mjs` 9/9, captura `docs/shot-17-conta.png` | P1 concluído | — |
| Repintagem destrutiva de formulários | Corrigida (estado `DRAFT` + mensagens sem repintar) | Regressão coberta pelo teste de chaves | P2 concluído | Manter regra para novos painéis |
| Rotulagem de dados fictícios | Presente na interface e nos documentos | inspecção + capturas | P0 concluído | — |
| Cabeçalhos de segurança | CSP sem `unsafe-eval`, `no-referrer`, `nosniff` | `tools/serve.mjs` | P1 concluído | `frame-ancestors` explícito em vez de `*` |
| Erros de runtime na UI | 0 nas suites de interface | `tests/account-ui.mjs` | P2 concluído | — |
| Testes de regressão | flow 14/14, search 17/17, agents 18/18, apis 13/13, smoke 0 erros, server 26/26, conta-UI 9/9, publicado 6/6 | logs desta sessão | P0 concluído | Incluir `server`/`account-ui` no `npm test` |

## Prioridades resultantes

- **P0**: persistência em produção (sem disco ⇒ perda de dados em cada deploy); MFA ausente para ADMIN.
- **P1**: recuperação de palavra-passe; retenção/purga; backups; motivo obrigatório no acesso
  administrativo; reautenticação em acções sensíveis.
- **P2 (feito nesta fase)**: esquema completo de investigação, registo de provas, corroboração por
  origens independentes, nove estados validados no servidor, retirada com motivo, duplicar/arquivar/
  retomar/cancelar, migração v1→v2.
- **P2 (feito agora)**: motor de 20 passos com orçamento, paragem declarada, retoma e cancelamento;
  relatório de 18 secções em JSON e Markdown; detecção de injecção no conteúdo recolhido.
- **P3 (feito agora)**: grafo alimentado por provas com regras duras (sem prova não há aresta,
  co-ocorrência não é relação, homónimos não fundidos) e secção 11 do relatório ligada.
- **P3 (feito agora)**: 13 agentes com execuções persistidas, auditor adversário com 10 regras,
  caminho entre entidades, cronologia e vista de contradições. Corrigida a chave de origem: uma cópia
  sindicada deixa de contar como origem independente (era um furo real na corroboração).
- **P3 (em falta)**: extracção automática de entidades, fila persistente de execuções.
- **P2 (em falta)**: extracção de PDF/OCR; descoberta
  automática de fontes; router com preferências/quotas; `frame-ancestors`.
- **P3**: papel ANALYST; listagem dinâmica de modelos; instrumentação de custos e de tarefas em fila.
