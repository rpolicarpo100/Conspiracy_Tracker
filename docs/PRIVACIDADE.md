# Política de privacidade e tratamento de dados (RGPD)

Versão: 2026-10-22 · Aplica-se à aplicação publicada em https://conspiracy-aitracker.onrender.com

Este documento descreve **o que a aplicação guarda na realidade**, onde, durante quanto tempo e
quem lhe pode aceder. Não é uma declaração de intenções: cada afirmação abaixo corresponde a
comportamento implementado em `server/store.mjs`, `server/auth.mjs` e `server/api.mjs`.
O que ainda **não** está implementado está marcado como tal na secção 8.

---

## 1. Responsável e âmbito

- A aplicação é uma ferramenta de investigação visual: o utilizador cria projectos de investigação,
  recolhe fontes, constrói um grafo de entidades/relações e produz relatórios.
- O conjunto incluído (`data/real/`) é **real e público**: 17 decisões judiciais de tribunais dos
  EUA (domínio público federal), 46 entidades nomeadas nessas decisões e 82 relações processuais com
  excerto literal, hash do PDF e URL canónico. Não há dados de demonstração inventados.
- Sobre pessoas singulares: são figuras públicas ou partes identificadas em decisões judiciais
  publicadas; o tratamento limita-se ao que o documento diz (nome, papel processual, tribunal, data),
  com excerto citável. Não há perfilagem, nem inferência de conduta, nem categorias especiais
  (artigo 9.º) para além do que o próprio documento judicial contém.
- Direitos: qualquer pessoa nomeada pode pedir rectificação ou remoção através do endereço de
  contacto indicado na aplicação; o pedido é registado e respondido (artigos 15.º a 22.º).
- Não há perfis publicitários, nem venda, nem cedência de dados a terceiros para marketing.

## 2. Base legal (artigo 6.º RGPD)

| Finalidade | Base legal |
| --- | --- |
| Criação de conta, autenticação e funcionamento do serviço | Execução do contrato (6.1.b) |
| Registo de auditoria de segurança (entradas falhadas, acessos administrativos) | Interesse legítimo em segurança (6.1.f) |
| Exportação e eliminação de conta a pedido do titular | Obrigação legal / exercício de direitos (6.1.c) |
| Chamadas a fornecedores de IA com chaves do próprio utilizador | Execução do contrato; o utilizador escolhe o fornecedor |

Não há tratamento baseado em categorias especiais (artigo 9.º). A aplicação **não** permite
investigações cujo objecto único seja religião, etnia, nacionalidade ou associação social: a
interface pede sempre o objecto de investigação e o âmbito, e os relatórios distinguem facto de
alegação (ver `docs/IA-E-EVIDENCIA.md`).

## 3. Que dados são guardados

| Categoria | Conteúdo concreto | Onde |
| --- | --- | --- |
| Conta | email (normalizado, minúsculas), papel (USER/ADMIN), estado (active/suspended), data de criação, versão da política aceite, data de aceitação | `DATA_DIR/store.json` |
| Credencial de acesso | `scrypt(password, salt)` — N=32768, r=8, p=1, salt aleatório de 16 bytes; **nunca** a palavra-passe | idem |
| Sessão | SHA-256 do token de sessão, data de criação, expiração, IP e user-agent truncados | idem |
| Projectos | título, pergunta, objectivo, descrição, âmbito, palavras-chave, datas | idem |
| Chaves de IA do utilizador | texto cifrado com AES-256-GCM (`APP_SECRET`), IV e tag; máscara pública (`chav…123`) | idem |
| Uso de IA | fornecedor, modelo, latência, estado, contagem — sem prompt nem resposta completos | idem |
| Auditoria | tipo de evento, actor (id), recurso, data, motivo declarado pelo administrador | idem |

Não são guardados: palavras-passe em claro, chaves de API completas em claro, conteúdo integral de
documentos descarregados, cookies de terceiros, dados biométricos, geolocalização precisa.

## 4. Cookies e armazenamento local

| Nome | Tipo | Finalidade | Duração |
| --- | --- | --- | --- |
| `vn_sid` | HttpOnly, SameSite=Lax, Secure em HTTPS | identifica a sessão no servidor | 12 horas (`SESSION_TTL`) |
| `vn_csrf` | legível por JS (double-submit) | protege pedidos que alteram estado | idem |

O `localStorage` do navegador guarda apenas o estado da interface (projecto aberto, filtros). Limpar
o navegador não apaga a conta; terminar sessão invalida o token no servidor.

## 5. Acesso administrativo às pesquisas

Um administrador **pode** consultar a lista de projectos de outro utilizador, mas:

1. o acesso exige um **motivo escrito** (`?reason=…`) que fica no registo de auditoria;
2. cada acesso grava um evento `admin_access` com actor, recurso, data, acção e motivo;
3. administradores **não** vêem palavras-passe, nem chaves de API (apenas a máscara), nem o histórico
   de sessões de outro utilizador;
4. o acesso é registado mesmo quando o administrador é o próprio titular dos dados consultados.

Eventos de auditoria efectivamente emitidos pelo servidor: `user_registered`, `login_succeeded`,
`login_failed`, `login_blocked`, `logout`, `logout_all`, `session_created`, `session_revoked`,
`password_changed`, `data_exported`, `account_deleted`, `project_created`, `project_updated`,
`project_deleted`, `credential_saved`, `credential_deleted`, `provider_tested`, `ai_call`,
`admin_access`, `admin_user_status`.

## 6. Fornecedores de IA (subcontratantes)

- As chaves de IA são **do utilizador** (ou, quando configuradas pelo operador, chaves de
  administração). A aplicação envia o pedido directamente ao fornecedor escolhido
  (Gemini, Groq, OpenRouter, Cerebras, Mistral, Hugging Face, Cloudflare Workers AI ou endpoint
  compatível com OpenAI indicado pelo utilizador).
- Cada fornecedor tem a sua própria política de retenção; a aplicação declara explicitamente qual
  foi usado em cada chamada e mostra o estado real da validação (`docs/FORNECEDORES.md`).
- Não há treino de modelos com dados do utilizador por parte desta aplicação.
- Não são enviadas chaves de um utilizador em pedidos de outro: as credenciais vivem por
  utilizador e o servidor resolve-as pelo id da sessão, nunca por parâmetro do pedido.

## 6-A. Subcontratantes de infraestrutura

| Subcontratante | Papel | Onde | Que dados vê |
| --- | --- | --- | --- |
| Render Services, Inc. | alojamento da aplicação (plano gratuito, região Frankfurt) | `onrender.com` | recebe os pedidos HTTP; não tem acesso lógico à base de dados |
| Neon, Inc. | alojamento da base de dados PostgreSQL | região AWS `eu-central-1` (Frankfurt, UE) | guarda a base de dados da aplicação (contas, projectos, provas, auditoria) cifrada em repouso |

- O `DATABASE_URL` do Neon só existe nas variáveis de ambiente do serviço no Render. Não está no
  repositório, nem na documentação, nem é devolvido por nenhuma rota pública (`/api/meta` diz apenas
  `storage.mode`: `postgres`, nunca o endereço).
- **Transferências para fora da UE**: os fornecedores de IA da secção 6 podem estar nos EUA; só são
  contactados quando o utilizador configura uma chave e pede uma operação que os use, e o fornecedor
  efectivamente usado é declarado em cada chamada. O Neon e o Render estão na UE (Frankfurt).
- Não existe subcontratante de análise, publicidade, nem de correio electrónico: a aplicação não
  envia emails (a recuperação de palavra-passe é feita por um administrador).

## 7. Direitos do titular (artigo 15.º–20.º)

| Direito | Como é exercido hoje | Estado |
| --- | --- | --- |
| Acesso e portabilidade | botão **Exportar os meus dados** → `GET /api/auth/export` devolve JSON com conta, sessões (sem tokens), projectos, máscaras de chaves e eventos de auditoria do próprio; grava `data_exported` | implementado e testado |
| Rectificação | alteração de palavra-passe e de dados do projecto | implementado |
| Eliminação | botão **Eliminar conta** → `DELETE /api/auth/account` remove utilizador, sessões, projectos, chaves e uso; conserva **apenas** o evento `account_deleted` sem dados pessoais (prova de que a eliminação ocorreu) | implementado e testado (`tests/server.mjs`) |
| Oposição/limitação | suspensão de conta pelo administrador revoga todas as sessões de imediato | implementado |
| Reclamação | autoridade de controlo nacional (CNPD, Portugal) | informativo |

## 8. Retenção e limitações actuais (honestidade sobre o que falta)

- **Retenção automática**: implementada como purga selectiva em
  `POST /api/service/maintenance` (token de serviço obrigatório), com prazos configuráveis
  `RETENTION_AUDIT_DAYS` (180), `RETENTION_SESSION_DAYS` (30) e `RETENTION_USAGE_DAYS` (90):
  remove auditoria antiga (excepto `account_deleted` e o próprio `retention_purged`), sessões
  expiradas ou revogadas e registos de uso de IA. **Nunca** remove contas, projectos, provas,
  conclusões ou memória. O agendamento diário está em `.github/workflows/manutencao.yml` e corre
  primeiro em simulação (`GET`, `dryRun`) antes de aplicar. Enquanto `CRON_TOKEN` não estiver
  definido no servidor, a rota responde `503` e declara-se desligada — `/api/meta` → `retention`
  mostra o estado real (`automated: false`). Coberto por `tests/retencao.mjs` (10 testes).
- **Backups**: a base de dados está num PostgreSQL gerido (Neon, Frankfurt) e **sobrevive aos
  deploys** — verificado em produção: `/ready` devolve `storage.mode: postgres`, e o administrador
  manteve o mesmo identificador depois de três deploys seguidos (`docs/TEST-RESULTS.txt` §45).
  Existem instantâneos do Neon do lado do fornecedor e uma cópia lógica por dia gerada pela própria
  aplicação (`db-backup-*.json`, com soma de verificação). **Não está implementada** rotação
  automática dessas cópias: depende de `CRON_TOKEN`, que ainda não foi definido em produção. O
  utilizador pode sempre descarregar a sua própria cópia em `GET /api/auth/backup`.
- **Registo de incidentes**: existe evento de auditoria, mas não existe procedimento formal de
  notificação em 72 h documentado fora deste repositório.
- **Cifra de chaves**: se `APP_SECRET` for perdido, as chaves guardadas tornam-se irrecuperáveis
  (comportamento pretendido; a aplicação recusa arrancar em modo de cofre sem segredo ≥24 caracteres).

## 9. Segurança aplicada

- `scrypt` com parâmetros explícitos e `maxmem` suficiente; comparação em tempo constante.
- Tokens de sessão aleatórios de 32 bytes, guardados apenas como SHA-256.
- Cookies `HttpOnly` + `SameSite=Lax` + `Secure` em HTTPS; CSRF por double-submit obrigatório em
  todos os pedidos que alteram estado (sem cabeçalho → 403).
- Limitação de tentativas: 8 falhas por chave/janela no login, 10 registos por IP/hora
  (`tests/server.mjs` verifica 429).
- Registo público **fechado por omissão**: as contas são criadas por um administrador
  (`POST /api/admin/users`) ou pelo procedimento local `tools/create-admin.mjs`; cada recusa de
  registo fica na auditoria (`registration_refused`). O primeiro administrador nunca tem
  credenciais no código nem no repositório.
- Palavra-passe temporária: obriga a troca antes de qualquer outra operação
  (`403 PASSWORD_CHANGE_REQUIRED`), e a troca revoga as outras sessões.
- Anti-enumeração: email desconhecido e palavra-passe errada devolvem o mesmo 401.
- Verificação de permissões sempre no servidor; projectos de outro utilizador devolvem 404 sem
  revelar conteúdo.
- Protecção SSRF nos adaptadores de IA e em `/api/fetch` (IPs privados/link-local recusados).
- Cabeçalhos: CSP sem `unsafe-eval`, `referrer-policy: no-referrer`, `x-content-type-options: nosniff`.

## 10. Contacto

Pedidos de titular: através da conta (exportar/eliminar) ou por contacto directo com o operador da
instância publicada. Este documento será actualizado quando a retenção automática e os backups
forem implementados.


## Memória da investigação e cópias de segurança (v5)

- **Memória da investigação**: notas, decisões, glossário, lacunas e correcções escritas pelo
  utilizador dentro de um projecto. É dado pessoal do titular: faz parte da exportação
  (`/api/auth/export` e `/api/auth/backup`) e é eliminada com a conta.
- **Cópia de segurança** (`GET /api/auth/backup`): inclui projectos, provas, conclusões, relações,
  memória e ligações de entidades. **Não inclui** chaves de IA, palavras-passe, hashes, sessões nem
  auditoria de terceiros — o ficheiro diz isso no campo `notIncluded`. Fica registada a operação
  (`backup_exported`) e a reposição (`backup_restored`), ambas com data e autoria.
- **Reposição** (`POST /api/auth/restore`): cria sempre projectos novos do próprio titular, com
  identificadores remapeados; não permite adoptar dados de outra conta (o projecto original
  continua a responder `404` a quem não é dono).
- **Base legal**: execução do contrato e interesse legítimo na conservação do trabalho do titular.
  A cópia é uma medida de segurança contra a perda de dados no plano gratuito (disco efémero), não
  uma transferência para terceiros.
