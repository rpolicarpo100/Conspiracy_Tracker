# APIs de IA «sem chave» — o que foi medido

Relatório gerado por `node tools/keyless-scan.mjs` em **2026-11-09** (2026-11-09T13:03:19.796Z). Dados completos: [`docs/APIS-sem-chave.json`](APIS-sem-chave.json).

Este ficheiro é **gerado automaticamente** pelo workflow `.github/workflows/keyless-scan.yml`.
Não editar à mão: a próxima execução substitui-o.

## Método

| etapa | pedido | o que prova |
|---|---|---|
| 1 | `GET <base>/models`, sem `Authorization`, sem cookies, 8 s de limite | que a **lista de modelos** é pública |
| 2 (confirmar) | `POST <base>/chat/completions`, `max_tokens: 1`, sem `Authorization` | que a **geração** é aberta — só esta etapa conclui «gera sem chave» |

Fonte dos candidatos: `https://models.dev/api.json`. Nada de CAPTCHA, paywall ou *user-agent* falsificado.

## Resultado

| etapa 1 — catálogo público | nº |
|---|---|
| candidatos sondados | 46 |
| `200` na lista de modelos («sem-chave») | 20 |
| `401`/`403` («exige-chave») | 18 |
| indeterminado | 8 |

| etapa 2 — geração sem chave | nº |
|---|---|
| endpoints confirmados na etapa 2 | 20 |
| **geram sem chave** | **1** |
| recusaram | 19 |

### Geram sem chave (confirmado por geração real)

| fornecedor | endpoint | modelo |
|---|---|---|
| pollinations-control | `https://text.pollinations.ai/openai` | `openai-fast` |

### Catálogo público mas geração fechada

| fornecedor | HTTP |
|---|---|
| hyper | 401 |
| cortecs | 401 |
| neuralwatt | 401 |
| inception | 401 |
| pioneer | 401 |
| orcarouter | 401 |
| cline-pass | 401 |
| above | 401 |
| standardcompute | 401 |
| commandcode | 401 |
| friendli | 401 |
| opencode | 429 |
| coralbricks | 401 |
| sarvam | 403 |
| submodel | — |
| inco | 401 |
| nearai | 401 |
| lucidquery | 401 |
| freemodel | 403 |

## Conclusão

**Uma lista de modelos pública não é uma API de geração aberta.** 20 endpoints responderam `200` na lista de modelos e apenas 1 aceitaram gerar sem credencial. A conclusão «gera sem chave» só é tirada quando há uma resposta gerada.

O único endpoint usado pela aplicação para analisar documentos é o declarado em
`server/providers.mjs` (`pollinations`), com o prompt publicado em `docs/PRIVACIDADE.md`.
Este relatório **não** acrescenta fornecedores automaticamente: um endpoint novo exige
revisão humana e declaração de privacidade antes de receber qualquer conteúdo.
