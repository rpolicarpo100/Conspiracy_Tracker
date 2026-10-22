# APIs de IA «sem chave» — o que foi medido

Relatório gerado por `node tools/keyless-scan.mjs --limit=45 --confirmar` em
**2026-10-22**. Dados completos, com data e método por linha:
[`docs/APIS-sem-chave.json`](APIS-sem-chave.json).

## Método

| etapa | pedido | o que prova |
|---|---|---|
| 1 | `GET <base>/models`, sem `Authorization`, sem cookies, 8 s de limite, 300 ms entre pedidos | que a **lista de modelos** é pública |
| 2 (`--confirmar`) | `POST <base>/chat/completions`, `max_tokens: 1`, sem `Authorization` | que a **geração** é aberta — só esta etapa conclui «gera sem chave» |

Fonte da lista de candidatos: `https://models.dev/api.json` (232 fornecedores com
API https). Nada de CAPTCHA, paywall ou *user-agent* falsificado.

## Resultado

| etapa 1 — catálogo público | nº |
|---|---|
| candidatos sondados (45 + 1 controlo) | 46 |
| `200` na lista de modelos («sem-chave») | 13 |
| `401`/`403` («exige-chave») | 23 |
| indeterminado (`5xx`, sem JSON, rede) | 10 |

| etapa 2 — geração sem chave | nº |
|---|---|
| endpoints confirmados | 13 |
| **geram sem chave** | **1 — o controlo (Pollinations)** |
| recusaram (`401`/`403`) | 11 |
| limite de pedidos (`429`, Chutes) | 1 |

## Conclusão

**Uma lista de modelos pública não é uma API de geração aberta.** Os 12
candidatos que responderam `200` na etapa 1 recusaram a geração com
`401`/`403`/`429`. O único endpoint que gerou sem chave foi aquele que já se
sabia funcionar — e é por isso que ele estava na lista como **controlo**: se a
sonda não o detectasse, o «0» seria suspeito, não conclusivo.

Consequência para a aplicação: existe **um** fornecedor sem chave utilizável
(Pollinations, com limite de 1 pedido/30 s por IP e sem SLA). Para uso sério,
uma chave gratuita de outro fornecedor é melhor — ver
[`docs/IA-FORNECEDORES.md`](IA-FORNECEDORES.md).

## Como repetir

```
node tools/keyless-scan.mjs --limit=45 --confirmar
node tools/keyless-scan.mjs --limit=20 --free-only        # só fornecedores com modelos a preço 0
```

O varrimento **não** corre no arranque da aplicação nem em produção: é uma
ferramenta de auditoria, corrida a pedido, com um pedido por endpoint.
