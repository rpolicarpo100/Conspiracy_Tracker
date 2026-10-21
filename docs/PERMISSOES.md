# Modelo de permissões

Versão: 2026-10-21 · Verificado por `tests/server.mjs` (26/26) e `tests/account-ui.mjs` (9/9)

Princípio: **o servidor decide sempre**. A interface esconde o que o utilizador não pode fazer, mas
nenhuma decisão depende dela. Todos os pedidos passam por `requireUser` / `requireAdmin` /
`requireCsrf` em `server/api.mjs`.

## 1. Papéis

| Papel | Descrição | Como se obtém |
| --- | --- | --- |
| `USER` | utilizador autenticado; vê e gere apenas os seus dados | registo normal |
| `ADMIN` | acrescenta gestão de utilizadores, métricas reais e auditoria | promoção do primeiro registo cujo email coincide com `ADMIN_EMAIL`; **não** existe rota de auto-promoção |

Não existe papel `ANALYST` nesta versão (previsto como opcional; não implementado).

`role` enviado no corpo de um pedido é **ignorado**: `tests/server.mjs` envia `role:"ADMIN"` no
registo e confirma que a conta fica `USER`.

## 2. Matriz de permissões

| Recurso / acção | Anónimo | USER (próprio) | USER (outro) | ADMIN |
| --- | --- | --- | --- | --- |
| `GET /health`, `/ready`, `/api/meta` | sim | sim | sim | sim |
| `POST /api/auth/register`, `/login` | sim (com rate limit) | — | — | — |
| `GET /api/auth/me` | 401 | sim | — | sim |
| `POST /api/auth/logout`, `/logout-all` | 401 | sim | — | sim |
| `GET /api/auth/sessions` | 401 | sim | — | sim |
| `DELETE /api/auth/sessions/{id}` | 401 | sim (só as suas) | 404 | sim (só as suas) |
| `POST /api/auth/password` | 401 | sim | — | sim |
| `GET /api/auth/export` | 401 | sim (só os seus dados) | — | sim |
| `DELETE /api/auth/account` | 401 | sim | — | sim |
| `GET/POST /api/projects` | 401 | sim | — | sim (os seus) |
| `GET/PATCH/DELETE /api/projects/{id}` | 401 | sim | **404** (sem revelar conteúdo) | 404 salvo se for o dono |
| `GET /api/providers` | 401 | sim | — | sim |
| `POST/DELETE /api/providers/{p}/key` | 401 | sim | — | sim |
| `POST /api/providers/{p}/test`, `/complete` | 401 | sim | — | sim |
| `GET /api/admin/metrics` | 401 | **403** | 403 | sim |
| `GET /api/admin/users` | 401 | 403 | 403 | sim |
| `GET /api/admin/audit` | 401 | 403 | 403 | sim |
| `GET /api/admin/users/{id}/projects?reason=` | 401 | 403 | 403 | sim, **com motivo registado em `admin_access`** |
| `POST /api/admin/users/{id}/status` | 401 | 403 | 403 | sim (não pode suspender a própria conta) |

Regras verificadas pelos testes:

- **Isolamento**: dois utilizadores, o mesmo id de projecto pedido pelo outro → `404` e o conteúdo
  do dono permanece intacto no ficheiro de dados.
- **Anti-enumeração**: email desconhecido e palavra-passe errada → resposta idêntica (`401`, mesma
  mensagem).
- **CSRF**: qualquer verbo que altera estado sem `x-csrf-token` → `403`, mesmo com sessão válida.
- **Suspensão**: `status: 'suspended'` revoga todas as sessões do utilizador de imediato; os pedidos
  seguintes recebem `401`.
- **Segredos**: a auditoria e as respostas nunca contêm palavras-passe nem chaves completas; só a
  máscara (`chav…123`).

## 3. Acesso do administrador a dados de investigação

1. `?reason=…` é gravado no evento; **se faltar** fica registado como «não indicado» (limitação
   conhecida: deve passar a exigir motivo com `400`, ver secção 5);
2. grava `admin_access` com `actorId`, `subjectId`, recurso, data, acção e motivo;
3. devolve apenas o **resumo** dos projectos (id, título, datas, contagem), nunca chaves ou sessões;
4. o mesmo registo é feito quando o administrador consulta os seus próprios dados, para que a
   auditoria não tenha zonas cegas.

## 4. Limites e abusos

| Limite | Valor por omissão | Configurável |
| --- | --- | --- |
| Falhas de login por chave/janela | 8 → `429` + evento `login_blocked` | `LOGIN_MAX_ATTEMPTS` |
| Registos por IP/hora | 10 | `REGISTER_MAX` |
| Pedidos `/api/fetch` por minuto | limiter próprio em `tools/fetch-api.mjs` | — |
| Tamanho de corpo | 512 KB (`MAX_BODY`), acima disso `413` | — |
| Chamada a fornecedor | 20 s (validação) e 30 s (`/complete`) | — |

## 5. O que ainda falta neste modelo

- **MFA** (TOTP): prioritário, não implementado. Recomendação: activar obrigatoriamente para `ADMIN`.
- **Permissões finas por recurso** (partilha de projecto com outro utilizador, papel `ANALYST` com
  âmbito restrito): não implementado.
- **Reautenticação para acções sensíveis** (eliminar conta, ver auditoria): hoje basta sessão válida.
- **Lista de sessões administrativas activas e expiração curta para ADMIN**: apenas a expiração
  comum de 12 h.
- **Motivo obrigatório** no acesso administrativo: hoje um valor ausente é aceite como «não
  indicado»; deve ser recusado com `400` para que a auditoria não perca a justificação.
- **Suspender outro administrador**: permitido hoje (só a própria conta está protegida); deve exigir
  confirmação adicional e ficar marcado como acção de alto impacto.
