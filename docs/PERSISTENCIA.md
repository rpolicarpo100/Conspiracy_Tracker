# Persistência durável (Postgres)

Este documento diz o que está feito, o que foi **provado em execução** e o que
continua a faltar. Foi escrito depois dos testes, não antes.

## 1. O problema, em números

| | antes | agora (com `DATABASE_URL`) |
| --- | --- | --- |
| Onde vivem os dados | `db.json` no disco do contentor | base Postgres gerida + cópia de trabalho local |
| Sobrevive a reinício do processo | sim | sim |
| Sobrevive a um deploy | **não** (disco apagado) | **sim** |
| Sobrevive à troca de instância / escala | não | sim |
| `/ready` → `durableBetweenDeploys` | `false` | `true` (só depois de a base confirmar escrita) |
| Cópia de segurança | 3 ficheiros rotativos | + 14 pontos guardados na base (`vn_snapshot`) |
| Auditoria | dentro do documento | + tabela append-only `vn_audit` |

## 2. Como funciona

- `server/pg.mjs` — cliente mínimo (`pg` 8.23.1, MIT, `npm audit` sem
  vulnerabilidades) com TLS **verificado** (`sslmode=verify-full`), 4 ligações,
  `connectionTimeoutMillis: 12000` e `application_name`.
- Tabelas criadas na primeira ligação (`CREATE TABLE IF NOT EXISTS`):
  - `vn_state(id text pk, version bigint, doc jsonb, updated_at, written_by)` — um
    documento por base; a forma do documento é a mesma do ficheiro, por isso não
    há migrações de esquema a cada campo novo;
  - `vn_audit(seq bigserial, at, type, actor_id, subject_id, action, ip, detail jsonb)`
    — registo append-only, independente do documento;
  - `vn_snapshot(id bigserial, version, at, doc jsonb)` — pontos de recuperação
    (mantidos os 14 mais recentes).
- **Ordem de escrita**: base primeiro, ficheiro depois. Se a base recusar (rede,
  conflito), a operação falha e a memória volta ao último estado bom. Nunca se
  responde «gravado» a partir de uma escrita que só existiu em disco local.
- **Concorrência optimista**: cada gravação leva a versão que leu; se outra
  instância escreveu entretanto, a gravação falha com `PG_VERSION_CONFLICT` em
  vez de sobrepor dados alheios.
- **Arranque**: se a base tiver documento, é ele que manda e substitui o local.
  Se estiver vazia e houver dados locais, o documento local é publicado nela
  (migração única, registada em `/ready.checks.persistence`).
- **Base configurada mas inacessível**: a aplicação continua a servir com o
  ficheiro, `/ready` responde **503** e diz o erro. Não se finge durabilidade.

## 3. O que foi provado (teste real, 22-10-2026)

`tests/persistencia-pg.mjs` corre contra uma base Neon real
(PostgreSQL 17.11, `aws-eu-central-1`). Resultado: **8/8**.

1. esquema criado e primeira gravação confirmada (`modo postgres+ficheiro`,
   `durabilidade true`);
2. registo de utilizador gravado;
3. projecto criado pela API presente no `jsonb` (verificado por leitura directa
   à base, não pelo ficheiro);
4. **processo do servidor morto + `DATA_DIR` novo e vazio** → login aceite,
   projecto visível: é o equivalente a um deploy que apaga o disco;
5. conflito de duas instâncias recusado (`PG_VERSION_CONFLICT`), versão a
   avançar 16 → 17;
6. cópia de segurança criada e restaurada, com os projectos idênticos;
7. auditoria em tabela append-only com os eventos reais
   (`user_registered`, `session_created`, `project_created`, `login_succeeded`);
8. limpeza dos dados de teste no fim.

O teste **declara SKIP** (não PASS) quando `DATABASE_URL` não está definida:
sem base real não se prova durabilidade.

## 4. Comandos

```bash
# criar uma cópia (ponto de recuperação)
DATABASE_URL=... node tools/pg-snapshot.mjs
# listar
DATABASE_URL=... node tools/pg-snapshot.mjs --listar
# restaurar uma cópia (avança a versão; não apaga nada)
DATABASE_URL=... node tools/pg-snapshot.mjs --restaurar 12
# correr só a suite de persistência
DATABASE_URL=... npm run test:pg
```

## 5. Projecto Neon criado

| | |
| --- | --- |
| Nome | `conspiracy-tracker` |
| Id | `curly-thunder-73546075` |
| Região | `aws-eu-central-1` (Frankfurt — a mesma do serviço no Render) |
| Motor | PostgreSQL 17.11 |
| Tabelas | `vn_state`, `vn_audit`, `vn_snapshot` (criadas pelo código na 1.ª ligação) |

A conta tinha outros dois projectos (`GOD`, `aci-platform`); **não foram
tocados** — este é isolado e pode ser apagado sem afectar nada.

## 6. Activo em produção (22-10-2026)

Configurado pela API do Render no serviço `conspiracy-aitracker`
(`srv-dbcefpmktt5c73f55h50`): `DATABASE_URL` escritas nas variáveis de
ambiente, deploy `dep-dbd3clnavr4c739adbng` e seguintes.

Provas recolhidas em produção, por esta ordem:

| verificação | resultado |
| --- | --- |
| `/ready` | `ready` · `mode: postgres+ficheiro` · `durableBetweenDeploys: true` · latência 5 ms · 0 erros |
| administrador criado por `POST /api/auth/bootstrap` | `rubenpolicarpo@hotmail.com` · papel `ADMIN` · `mustChangePassword: true` |
| login com a palavra-passe temporária | 200 · todas as outras rotas → 403 `PASSWORD_CHANGE_REQUIRED` |
| **deploy forçado com limpeza de cache** | o administrador continuou a existir (mesmo `id`), login 200 |
| segundo e terceiro deploys | administrador intacto · versão da base a avançar 57 → 63 → 68 |
| `ADMIN_BOOTSTRAP_TOKEN` removido do Render | `/api/meta` → `bootstrap.configured: false`; a rota de arranque deixou de existir |
| registo público | 403 `REGISTRATION_CLOSED` |

Antes desta configuração, cada deploy apagava tudo: o mesmo teste (deploy e
voltar a entrar) falhava sempre. Agora passa. A prova não é a configuração
existir — é o administrador sobreviver a três deploys seguidos.

## 7. Limitações que continuam a existir

- Um documento por base: a escrita reescreve o documento inteiro. Para o volume
  actual (dezenas de KB a poucos MB) é adequado; a partir de alguns MB por
  documento, o passo seguinte é normalizar as colecções grandes (`runs`,
  `evidence`, `audit`) em tabelas próprias.
- Uma só região: perda total da região `aws-eu-central-1` significa indisponibilidade
  (há 14 pontos na tabela de cópias, dentro da mesma base — não é geo-redundância).
- A rotação de cópias é feita quando alguém a pede (`tools/pg-snapshot.mjs`); não
  há agendamento automático enquanto o cron não estiver ligado (`CRON_TOKEN`).
- RGPD: os dados estão agora num subcontratante adicional (Neon). A página de
  privacidade tem de o dizer antes de o serviço ser usado por terceiros.
