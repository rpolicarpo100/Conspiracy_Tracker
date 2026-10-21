# Modelo de dados

O modelo está separado da biblioteca visual: `src/core/model.js` e `src/core/query.js` não conhecem
Cytoscape. O único ficheiro que conhece a biblioteca é `src/graph/adapter.js`.

## Entidade

```js
{
  id: 'c-meridiano',            // identificador estável e legível (prefixo de tipo)
  type: 'company',              // person | company | foundation | organization | government |
                                // religious | court | document | event | transaction
  name: 'Meridiano Infraestruturas, S.A.',
  short: 'Concessionária de infraestruturas rodoviárias e energia',
  ctx: 'Concessionária da autoestrada A-31…',
  status: 'confirmed',          // estado da identidade (não da culpa)
  juris: 'PT',
  date: '2010-02-08', precision: 'day',   // day | month | year | unknown
  aliases: ['Meridiano'],
  disambiguation: { registryId: '…', birthYear: 1954, nifHash: 'sha256…' },  // anti-homónimo
  facts: ['Facto com fonte…'],
  alleges: ['Alegação atribuída a uma parte identificada…'],
  contradictions: ['Documento que contradiz…'],
  visual: {
    kind: 'image' | 'logo' | 'procedural',
    src: 'URL ou data URI',
    credit: 'atribuição obrigatória',
    licence: 'licença obrigatória',
    source: 'origem',
    verified: false
  }
}
```

**Regra das imagens.** Sem `credit` + `licence` + `source`, a imagem não entra: é usado um avatar
procedimental gerado localmente (SVG com iniciais, cor do tipo de entidade e selo de verificação),
declarado como tal no painel de detalhes. Nunca se inventa uma fotografia.

## Relação

```js
{
  id: 'r-079',
  from: 'c-banco', to: 'c-meridiano',
  kind: 'financed',                 // chave de relationTypes (tipo tipificado, não linha decorativa)
  directed: true,
  start: '2020-11-30', startPrec: 'day', end: '2032-11-30', endPrec: 'day',
  status: 'confirmed',              // confirmed | probable | alleged | unverified | contradicted
  conf: 5,                          // 0–5
  why: 'Justificação da confiança atribuída',
  src: 'd-contrato-fin',            // documento-fonte (nó do grafo)
  loc: 'cl. 2.ª, p. 5',             // localização exacta na fonte
  ex: '«O Banco … concede … 180 000 000 EUR.»',   // excerto literal
  lv: '2025-09-30',                 // última verificação
  reviewer: 'nome', method: 'leitura do documento primário',   // exigido no modo real
  amount: 180000000, currency: 'EUR'
}
```

### Famílias e tipos

`ownership` (participação accionista, subsidiária, beneficiário efectivo, nomeado), `governance`
(cargo, órgão social, nomeação, assessoria, auditoria), `financial` (financiou, emprestou, pagou,
transaccionou, doou), `contractual` (contrato, procedimento, fornecimento), `legal` (regulada por,
investigada por, litígio, sanção, pronúncia, acusação), `affiliation` (membro, reunião documentada,
família, lobbying, participação), `documental` (mencionada em, documentada em, autoria).

### Estados de verificação

| Chave | Etiqueta | Exige | Traço no grafo |
|---|---|---|---|
| `confirmed` | Confirmado | fonte primária + excerto + revisor | linha contínua |
| `probable` | Provável | fonte fiável indirecta + justificação | tracejada |
| `alleged` | Alegado | parte identificada + justificação | tracejada |
| `unverified` | Não verificado | justificação da ausência | pontilhada |
| `contradicted` | Contraditado | documento que contradiz | tracejada vermelha |

A cor representa **sempre** categoria ou estado definido na legenda. Nunca culpa, perigosidade ou suspeita.

## Temporalidade

- `precision` distingue data exacta, mês, ano e desconhecida.
- Relações sem data **não são projectadas** em períodos anteriores: ficam visíveis com a marca
  «data desconhecida».
- Uma relação é válida num intervalo se os seus limites o intersectam; contratos futuros são truncados
  em `actual+2` no domínio da cronologia.

## Livro de provas (`src/core/ledger.js`)

Registo append-only, com SHA-256 de cada entrada e encadeamento `prev → hash`.
Tipos: `abertura`, `plano`, `recolha`, `verificacao`, `refutacao`, `resultado_negativo`,
`resposta_ia`, `alegacao`. Qualquer alteração posterior a uma entrada antiga quebra a cadeia e é
detectada por `verify()`. Não substitui assinatura digital; torna a manipulação evidente.

## Registo negativo

```js
{ type: 'resultado_negativo',
  payload: { source: 'Portal BASE', query: 'concessão A-31 2015', result: 'nao_encontrado',
             observedAt: '2026-10-21' } }
```

Guarda **o que não foi encontrado, onde e quando**. É a diferença entre diligência demonstrada e
acusação de omissão.

## Importação de dados reais (`src/core/realdata.js`)

Validação dura antes de qualquer carregamento. Rejeita: relação sem fonte, sem excerto, confirmada sem
revisor/método/data, ficheiro que se declara fictício, imagem sem licença. Aceita com aviso: entidade
sem identificador de desambiguação (risco de homónimo), documentos sem hash.

---

# Esquema do servidor (v2)

O servidor deixou de ser um simples guarda de contas: tem esquema versionado, migrações por passo e
registos de provas e conclusões. Ficheiro único `DATA_DIR/db.json`, escrita atómica
(`write` + `rename`), modo `0600`.

## Versão e migrações

```json
{ "version": 2,
  "migrations": [ { "from": 1, "to": 2, "at": "2026-10-21T…", "changes": ["criada a colecção evidence", "…"] } ] }
```

- `version: 1` → `2` cria `evidence`, `claims`, `runs`, `migrations` e completa cada projecto com
  `status`, `hypotheses`, `subquestions`, `completionCriteria`, `checkpoints`, `notes`,
  `referenceDate`, `timeLimit`, `budget` e `scope`.
- A migração corre no arranque, antes de qualquer pedido; o que mudou fica em `migrations` e é
  exposto em `GET /api/meta` (`schemaVersion`, `migrations`).
- Um ficheiro ilegível **não é apagado**: é renomeado para `db.json.broken-<timestamp>` e a base
  recomeça vazia (comportamento registado na consola do servidor).
- `GET /ready` verifica escrita no disco e informa se os dados são duráveis entre deploys.

## Colecções

| Colecção | Conteúdo |
| --- | --- |
| `users`, `sessions` | contas (scrypt) e sessões (token em SHA-256, expiração 12 h) |
| `projects` | objecto de investigação (ver abaixo) |
| `evidence` | registo de provas (ver `docs/EVIDENCIA.md`) |
| `claims` | conclusões com estado de 9 valores, provas ligadas e histórico |
| `credentials` | chaves de IA cifradas (AES-256-GCM) + máscara |
| `runs` | execuções de pesquisa (perfil, passo, estado, motivo de paragem, fontes consultadas) |
| `usage` | uso de IA reportado pelo fornecedor (sem prompt nem resposta) |
| `audit` | eventos de auditoria (append-only, últimos 50 000) |
| `metrics` | contadores agregados |

## Projecto (objecto de investigação)

```json
{ "id": "prj-…", "ownerId": "usr-…", "title": "…",
  "question": "…", "objective": "…", "description": "…",
  "scope": { "geo": "PT", "languages": ["pt","en"], "period": { "from": "2020-01-01", "to": null } },
  "referenceDate": "2024-12-31", "timeLimit": "30 dias",
  "keywords": [], "entities": [],
  "prioritySources": [], "excludedSources": [],
  "hypotheses": [ { "id": "h1", "text": "…", "status": "a-testar", "state": "hipotese" } ],
  "subquestions": [], "completionCriteria": [],
  "budget": { "maxCalls": 50, "maxDocuments": 100, "maxMinutes": 30, "maxCost": 0 },
  "status": "draft | active | archived | cancelled",
  "notes": [], "checkpoints": [ { "id": "chk-…", "at": "…", "label": "…", "evidenceCount": 3, "claimCount": 1 } ],
  "createdAt": "…", "updatedAt": "…", "archivedAt": null }
```

- Uma hipótese só pode estar em `hipotese`, `insuficiente` ou `alegacao-atribuida`: o cliente não a
  promove a facto (testado). O campo `status` (`a-testar`, `suportada`, `refutada`, `inconclusiva`)
  descreve o andamento do teste, não a verdade da hipótese.
- Acções: `POST /api/projects/{id}/duplicate | archive | resume | cancel | checkpoints`.
- `DELETE /api/projects/{id}` remove o projecto; provas, alegações e execuções são removidas com ele
  e com a conta (`deleteUser` limpa as quatro colecções).

## Execuções (`runs`) — registo, ainda sem motor

```json
{ "id": "run-…", "projectId": "prj-…", "profile": "rapida|normal|profunda|exaustiva",
  "status": "pending|running|done|stopped|failed|cancelled", "step": 0, "steps": [],
  "stopReason": null, "startedAt": "…", "finishedAt": null, "sourcesConsulted": [], "budget": {} }
```

As colecções e métodos existem e são apagados com o projecto; a escrita de passos pelo motor de
pesquisa ainda não está ligada (o motor de 20 passos é trabalho da fase seguinte). Não há, por isso,
execuções reais registadas — e nenhuma é simulada.

## Relações (v3)

```json
{ "id": "rel-…", "projectId": "prj-…",
  "from": "Sociedade X", "to": "Y Participações",
  "fromDisambiguator": "NIPC 500000000", "toDisambiguator": "NIPC 500000001",
  "type": "subsidiary_of", "direction": "directed | mutual",
  "period": { "from": "2018-01-01", "to": null },
  "evidenceIds": ["ev-…", "ev-…"],
  "inferred": false, "reasoning": null, "limitations": null,
  "validationState": "insuficiente | confirmada | contraditoria",
  "lastChecked": "…", "retractedAt": null, "retractReason": null,
  "history": [ { "at": "…", "action": "criada", "by": "usr-…" } ] }
```

- `evidenceIds` não pode ser vazio: uma relação sem prova é recusada pelo servidor.
- `fromDisambiguator`/`toDisambiguator` viajam com a relação para que a aresta ligue os nós certos.
- `direction` é forçado a `mutual` nos tipos simétricos.
- `inferred: true` exige `reasoning`; declarar `reasoning` implica `inferred`.
- Retirar não apaga: `retractedAt` + `retractReason`, histórico e auditoria.
- A confiança (`corroborada`, `uma-so-origem`, `contraditoria`, `sem-prova`) é **calculada** a cada
  leitura a partir das provas ligadas; não é guardada como opinião.
- `version: 3` acrescenta a colecção `relations`; a migração `2 → 3` regista apenas o que o ficheiro
  não tinha (uma base criada já na v3 declara-o explicitamente em `migrations`).
