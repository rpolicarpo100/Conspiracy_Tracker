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
