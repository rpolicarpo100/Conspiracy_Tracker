# Política de privacidade e tratamento de dados (RGPD)

Versão: 2026-10-21 · Aplica-se à aplicação publicada em https://conspiracy-aitracker.onrender.com

Este documento descreve **o que a aplicação guarda na realidade**, onde, durante quanto tempo e
quem lhe pode aceder. Não é uma declaração de intenções: cada afirmação abaixo corresponde a
comportamento implementado em `server/store.mjs`, `server/auth.mjs` e `server/api.mjs`.
O que ainda **não** está implementado está marcado como tal na secção 8.

---

## 1. Responsável e âmbito

- A aplicação é uma ferramenta de investigação visual: o utilizador cria projectos de investigação,
  recolhe fontes, constrói um grafo de entidades/relações e produz relatórios.
- Dados de demonstração (`data/*.json`, 69 entidades / 126 relações) são **fictícios** e estão
  identificados como tal na interface. Não descrevem pessoas, empresas ou factos reais.
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

## 7. Direitos do titular (artigo 15.º–20.º)

| Direito | Como é exercido hoje | Estado |
| --- | --- | --- |
| Acesso e portabilidade | botão **Exportar os meus dados** → `GET /api/auth/export` devolve JSON com conta, sessões (sem tokens), projectos, máscaras de chaves e eventos de auditoria do próprio; grava `data_exported` | implementado e testado |
| Rectificação | alteração de palavra-passe e de dados do projecto | implementado |
| Eliminação | botão **Eliminar conta** → `DELETE /api/auth/account` remove utilizador, sessões, projectos, chaves e uso; conserva **apenas** o evento `account_deleted` sem dados pessoais (prova de que a eliminação ocorreu) | implementado e testado (`tests/server.mjs`) |
| Oposição/limitação | suspensão de conta pelo administrador revoga todas as sessões de imediato | implementado |
| Reclamação | autoridade de controlo nacional (CNPD, Portugal) | informativo |

## 8. Retenção e limitações actuais (honestidade sobre o que falta)

- **Retenção automática**: não está implementada. Não existe purga programada de eventos de
  auditoria nem de sessões expiradas (as sessões expiradas deixam de ser aceites, mas o registo
  permanece). Está previsto: auditoria 180 dias, sessões expiradas 30 dias, uso de IA 90 dias.
- **Backups**: o plano gratuito do Render não oferece disco persistente. Sem `DATA_DIR` apontado
  para um volume, os dados **perdem-se em cada deploy**: a interface mostra essa limitação em
  `/api/meta` (`durableBetweenDeploys: false`). Não há, por isso, rotina de backup testada em
  produção; localmente o backup é copiar `DATA_DIR/store.json` com a aplicação parada.
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
