# Provas, alegações e corroboração independente

Versão: 2026-10-21 · Código: `server/evidence.mjs` (regras) e `server/api.mjs` (rotas) · Testes: `tests/evidence.mjs` (17/17) e `tests/account-ui.mjs` (10/10)

Este documento descreve o que o servidor **garante** hoje sobre provas e conclusões, e onde ainda
não chega. As garantias são aplicadas no servidor: a interface pode pedir, mas não decide.

## 1. Os nove estados de uma conclusão

| Estado | Requisitos verificados pelo servidor |
| --- | --- |
| `confirmada` | ≥2 origens independentes **e** ≥1 prova primária favorável **e** nenhuma prova contrária activa |
| `corroborada-independente` | ≥2 origens independentes, sem prova contrária activa |
| `alegacao-atribuida` | ≥1 prova de que a alegação **foi feita** (o que fica provado é a atribuição, não o conteúdo) |
| `inferencia-suportada` | ≥1 prova favorável, e a conclusão declara-se como inferência |
| `hipotese` | nada exigido: uma hipótese pode não ter prova nenhuma |
| `contraditoria` | ≥1 prova favorável **e** ≥1 prova contrária |
| `insuficiente` | provas que não chegam ao limiar de um estado mais forte |
| `refutada` | ≥1 prova contrária **primária ou documental** |
| `fonte-inacessivel` | a prova existe mas está marcada inacessível ou foi retirada |

Regras de comportamento:

- Uma conclusão **nasce fraca** (`hipotese`, `insuficiente` ou `alegacao-atribuida`). Pedir um estado
  forte no momento da criação devolve `409`.
- Mudar de estado é validado: se as provas não sustentam o pedido, a resposta é `409` com
  `reasons` (texto legível) e `suggested` (o estado que as provas sustentam).
- O servidor **sugere**, mas não aplica: `suggested` aparece na interface e só muda com um clique
  explícito — a aplicação nunca promove uma conclusão sozinha.
- A interface não oferece um botão «marcar como verdadeiro»: não existe estado «100%».
- Cada alteração de estado grava `from`/`to`/`by`/data no histórico da própria conclusão.

## 2. Registo de provas

Campos guardados por prova: `id`, `title`, `author`, `originalUrl`, `canonicalUrl`, `archiveUrl`,
`excerpt`, `location`, `language`, `sourceType`, `stance`, `publicationDate`, `eventDate`,
`collectionDate`, `verificationDate`, `entities[]`, `extractionMethod`, `validationState`,
`limitations`, `contentHash`, `originKey`, `syndicationOf`, `claimIds[]`, `history[]`, `createdAt`,
`retractedAt`, `retractReason`.

Regras:

1. **Excerto obrigatório.** Sem excerto não há o que verificar: a prova é recusada (`400`) com a
   mensagem correspondente.
2. **Hash SHA-256** do excerto normalizado (espaços colapsados, minúsculas) — permite comparar
   documentos sem os guardar por inteiro.
3. **URL canónico** (sem `utm_*`, `fbclid`, `gclid`, fragmento, `www.`, barra final). O URL original
   fica intacto; o canónico é o que serve para comparar.
4. **Duplicados não inflacionam contagens**: enviar a mesma prova (mesmo conteúdo e mesmo URL
   canónico) devolve a prova existente com `duplicate: true` e a explicação.
5. **Nada é apagado**: retirar uma prova exige `reason` (mínimo 5 caracteres), grava
   `retractedAt`/`retractReason`, mantém o registo na lista e anota a retirada no histórico das
   alegações que dependiam dela.
6. **Toda a alteração tem autor e data** (`history[]`), e a auditoria guarda `evidence_added`,
   `evidence_updated`, `evidence_retracted`, `claim_created`, `claim_updated`,
   `claim_evidence_link`.

## 3. Corroboração: origens, não ficheiros

`originKey` de uma prova é, por ordem:

1. `sind:<url canónica>` se a prova declarar `syndicationOf` (é cópia/sindicada de outra);
2. `host:<domínio>` do URL canónico;
3. `hash:<hash do excerto>` se não houver URL.

Consequência prática, medida nos testes: **10 reproduções do mesmo comunicado em 10 sítios
diferentes com `syndicationOf` comum contam como 1 origem independente**. O servidor recusa
`corroborada-independente` nesse caso (`409`) e a interface mostra `cópias redundantes: 9`.

Fórmula de `corroboration()` (devolvida em cada consulta de alegação):

```
origens independentes  = nº de originKey distintas (provas activas)
favoráveis / contrárias= contagem por stance
primárias favoráveis   = sourceType ∈ {primaria, documento-oficial} e stance favorável
cópias redundantes     = favoráveis − origens favoráveis distintas
```

Uma prova retirada ou marcada `fonte-inacessivel` **deixa de contar** para os factores.

## 4. Percurso de uma conclusão (exemplo real dos testes)

1. Conclusão «O valor divulgado é exacto» → criada como `hipotese`.
2. Liga-se uma prova primária favorável → `confirmada` é **recusado**: «exige pelo menos 2 origens
   independentes (tem 1)».
3. Liga-se uma notícia independente → `confirmada` aceite (2 origens, 1 primária, sem contradição).
4. Liga-se uma auditoria que contradiz → `confirmada` passa a ser recusado: «existe prova contrária
   activa: o estado correcto é «contraditória»»; `contraditoria` é aceite.
5. A prova contrária é retirada com motivo → fica registada, não apagada, e o histórico da alegação
   assinala a retirada.

## 5. Rotas

| Método e rota | Efeito |
| --- | --- |
| `GET /api/projects/{id}/evidence` | lista de provas do projecto (inclui retiradas) |
| `POST /api/projects/{id}/evidence` | regista prova (validação, hash, canónico, duplicados) |
| `PATCH /api/evidence/{id}` | limitações, data de verificação, estado de validação, posição, arquivo |
| `DELETE /api/evidence/{id}` | retira com motivo (nunca apaga) |
| `GET /api/projects/{id}/claims` | conclusões com factores e estado sugerido |
| `POST /api/projects/{id}/claims` | cria conclusão (nasce fraca) |
| `GET /api/claims/{id}` | conclusão + provas ligadas + factores |
| `PATCH /api/claims/{id}` | muda estado (validado), confiança, texto; liga/desliga prova |

Todas exigem sessão e CSRF quando alteram estado; provas e conclusões de outro utilizador devolvem
`404` sem revelar conteúdo (verificado em `tests/evidence.mjs`).

## 6. O que ainda não está feito (declarado, não simulado)

- **Verificação automática de acessibilidade**: o servidor não vai buscar o URL para confirmar que o
  excerto lá está. O campo `verificationDate` é declarado por quem verifica; uma verificação
  automática com prova de conteúdo é o passo seguinte.
- **Extracção de PDF/OCR e verificação de assinaturas**: não implementadas; `extractionMethod` só
  registra como a prova foi obtida, não a valida.
- **Pesos entre provas**: hoje conta-se origem e tipo; não há pontuação de fiabilidade por fonte.
- **Verificação cruzada entre fornecedores de IA**: o estado é decidido por regras sobre provas, não
  por votos de modelos — de propósito. Dois modelos concordarem não é prova.
- **Grafo e relatório a partir das provas**: as provas ainda não alimentam o grafo nem o relatório de
  18 secções do serviço; a ligação está desenhada mas não implementada.
- **Cronologia automática** (`eventDate` → linha temporal) e **vista de contradições** no grafo:
  pendentes.
