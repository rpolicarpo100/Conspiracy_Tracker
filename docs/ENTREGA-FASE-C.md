# FASE C — pesquisa e proveniência (entrega)

**Data:** 2026-10-23 · **Versão:** `2.2.0-faseC` · **Esquema da base:** v8
**Origem:** achados A-04 (taxonomia), E2/E3 de `docs/ESTADO-FUNCIONALIDADES.md` e tarefas C1–C5 de
`docs/PLANO-MELHORIA.md`.

> Nenhuma alteração em produção foi feita à mão; o deploy é o automático do Render (ver
> `docs/ENTREGA-FASE-B.md` §6.b). Nada aqui inventa estados, provas ou fontes: o que não existe é
> declarado como falta.

---

## 1. O que estava errado

| antes | consequência |
|---|---|
| 9 estados, mas **não** os exigidos: faltavam `nao-verificada` e `desactualizada` | afirmações «por verificar» e «caducadas» não tinham nome — eram forçadas a «insuficiente» |
| «fonte-inacessivel» era um estado de **afirmação** | misturava o estado do documento com o da conclusão |
| «confirmada» e «corroborada-independente» | nomes que fingiam de contador: a força estava no nome, não nos factores |
| independência de fontes só por domínio/sindicação | o mesmo texto copiado em cinco jornais contava cinco origens |
| nenhuma verificação de proveniência | uma afirmação podia ser publicada sem excerto, localização ou hash |
| nenhuma contraprova obrigatória | dava-se «confirmada» sem nunca ter procurado o contrário |
| nada sobre caducidade | um documento de 2019 sustentava um facto de 2026 |

---

## 2. O que mudou

### C1 — taxonomia única (`server/evidence.mjs`)

```
afirmação: facto-documentado · alegacao-atribuida · inferencia · hipotese · contraditoria
           refutada · nao-verificada · insuficiente · desactualizada
fonte:     acessivel · fonte-inacessivel · retirada
```

- `STATES` é a lista fechada; `EVIDENCE_STATES` é a das provas. Uma afirmação **recusa** um estado de
  fonte (400) — testado.
- `STATE_MIGRATION` declara cada nome antigo com destino **e motivo**; `migrateState()` converte.
- **Migração v8** da base: converte provas, afirmações e hipóteses legadas e grava
  `estadoMigradoDe`/`estadoMigradoMotivo`, com o resumo no registo de migrações.
- `/api/meta` publica `claimStates`, `evidenceStates`, `stateMigration` e `claimRules`.
- Servidor, interface (`src/ui/account.js`), grafo e relatório leem a **mesma** lista (teste dedicado).

### C2 — independência de fontes

`originsOf()` agrupa provas por origem e **funde textos idênticos** (mesmo `contentHash`) vindos de
domínios diferentes. `syndicationOf` continua a levar a cópia à peça original. Os factores passam a
expor o detalhe auditável:

```
originGroups: [{ origem:'src:empresa.example', provas:['ev-1','ev-2','ev-3'],
                 hosts:['empresa.example','jornal-a.example','jornal-b.example'],
                 via:{ 'origem':1, 'texto-identico':2 } }]
```

### C3 — proveniência por afirmação

`provenanceOf()` devolve, por prova: excerto, localização, documento/URL, hash, data de recolha,
tipo, postura e estado — e a lista de **faltas** pelo nome. Rota nova
`GET /api/claims/:id/provenance` e botão «Proveniência» na interface.

### C4 — contraprova obrigatória

`evaluate('facto-documentado')` exige `claim.contraprova` com `procuradaEm`, `metodo` e
`resultado ∈ {encontrada, nao-encontrada}`; se `encontrada`, exige a prova indicada. Rota nova
`POST /api/claims/:id/counter-evidence` (CSRF) e botão «Registar contraprova».

### C5 — caducidade

`isStale()` reconhece `supersededBy`, `validityUntil` (da afirmação ou de **todas** as provas) e
impede `facto-documentado` com prova caducada; a sugestão passa a `desactualizada`. Prova nova pode
declarar `validityUntil`.

### Contrato de estados (novo)

```
hipotese · insuficiente · alegacao-atribuida · nao-verificada ──(provas + contraprova)──▶ facto-documentado
provas a favor + contra ──▶ contraditoria        só contra primária ──▶ refutada
validade terminada ──▶ desactualizada
```

---

## 3. Provas de execução

```
bash tools/ui-env.sh npm test        → exit 0 · 563 PASS · 0 falhas · 34 ficheiros
bash tools/ui-env.sh npm run test:ui → exit 0 · 9 suites · 100 verificações
node tests/afirmacoes.mjs            → 14/14 (novo)
node tests/evidence.mjs              → 17/17 (contrato novo)
node tools/auditoria/matriz-testes.mjs → 34 ficheiros, todos com código 0
```

Destaques da suite nova:

| garantia | resultado |
|---|---|
| 3 cópias do mesmo texto em 3 domínios | **1 origem**, 2 cópias redundantes assinaladas |
| 2 textos diferentes em domínios diferentes | 2 origens independentes, 1 primária |
| `syndicationOf` com texto reescrito | 1 origem (segue a peça original) |
| base v7 com nomes antigos → v8 | prova e afirmação convertidas, origem guardada, 4 alterações descritas |
| «facto documentado» sem contraprova | **409** com motivo nomeado |
| contraprova sem método / «encontrada» sem prova | **400** nos dois casos |
| prova caducada em 2020 | facto recusado (409), sugestão `desactualizada` |
| estado de fonte numa afirmação | **400** com a lista permitida |

---

## 4. Uma decisão que precisa de ser dita

O servidor **avisa mas não bloqueia** a promoção quando a proveniência está incompleta (falta
localização, por exemplo): devolve a proveniência com `completa:false` e o relatório menciona a falta,
mas não recusa o estado. Foi uma escolha conservadora para não destruir dados existentes nem impedir
trabalho legítimo em curso; o endurecimento (recusar sempre) está na FASE H. **Se preferires que
bloqueie já, é uma linha em `evaluate()`** — diz e faço.

---

## 5. O que continua por fazer

| item | fase |
|---|---|
| arquivo como destino do fluxo (dossiê por investigação) | F |
| `tests/caso-socrates.mjs` com documentos reais | H |
| orçamento/retry/cancelamento por agente | D |
| catálogo de APIs com máquina de estados + operação de validação na UI | E |
| endurecer: proveniência incompleta **recusa** o estado forte | H |
| interface: separadores por área de trabalho com estado por URL | G |

## 6. Reversibilidade

- `git revert` do commit «fase C: taxonomia» devolve os nomes antigos (**mas a base já migrada fica
  na v8**: reverter exige reconverter os estados, o que a migração v8 faz no sentido inverso apenas
  com um mapa novo — dito aqui para não haver surpresa).
- C2/C3/C4/C5 são funções puras + rotas novas: desligá-las não afecta dados antigos.
- A migração v8 é **de só-ida**: `docs/ENTREGA-FASE-C.md` §2 documenta o mapa completo, o que permite
  escrever o inverso se for preciso.
