# Fornecedores de IA e chaves — como se configura no Render

Documento operacional da fase 11. Responde a três perguntas concretas:

1. **Onde colo as chaves** para a aplicação passar a ter IA?
2. **O que é gratuito** e onde se obtém cada chave?
3. **O que acontece** se a chave faltar, estiver errada ou o fornecedor recusar?

Tudo o que está aqui foi medido. A coluna «sonda» diz o que o servidor recebeu
quando falou com o fornecedor **sem chave** em 2026-10-22: `401` e `403` provam
que o sítio existe e pede credencial; `200` numa lista de modelos prova apenas
que a lista é pública (ver §5 — não é a mesma coisa que gerar sem chave).

---

## 1. Onde colar as chaves (Render)

1. No painel do Render, abrir o serviço `conspiracy-aitracker`.
2. **Environment → Add Environment Variable**.
3. Nome: o da coluna «variável» da tabela (§2). Valor: a chave colada tal e qual.
4. **Save Changes** — o Render reinicia o serviço sozinho.

As variáveis também estão declaradas em `render.yaml` com `sync: false`, o que
faz aparecer no painel o nome certo e o valor vazio, sem nada no repositório.
Se o Blueprint for sincronizado, os nomes aparecem lá; os valores são sempre
colados por ti, no painel.

**Não é preciso reiniciar nada à mão e não é preciso pôr mais do que uma chave.**
Basta uma. A aplicação usa a primeira que encontrar, por esta ordem:

```
AI_OPERATOR_ORDER = groq,gemini,cerebras,openrouter,mistral,github,nvidia,sambanova,huggingface,cohere,cloudflare
```

(predefinida; podes mudar a ordem na mesma variável).

### O nome da variável não precisa de ser o que está no exemplo

A aplicação aceita o nome escrito de qualquer destas maneiras — **caixa e
separadores são indiferentes**, e tanto serve `AI_` como `API_`:

```
AI_KEY_GEMINI      AI_KEY_GROQ        AI_KEY_OPENROUTER
API_KEY_GEMINI     API_KEY_GROQ       API_KEY_OPENROUTER
api_key_gemini     API_KEY_Groq       apiKeyOpenRouter … (e as variantes com
                                      ou sem underscore, em qualquer caixa)
```

O mesmo vale para os modelos: `AI_MODEL_GEMINI`, `API_MODEL_GEMINI`, … Se a
chave do modelo não for indicada, usa-se o primeiro modelo do catálogo.

Porque é que isto importa: em Linux o ambiente **distingue maiúsculas**. Uma
chave colada como `API_KEY_Groq` era invisível para um código que procurava
`AI_KEY_GROQ` — a variável aparecia no painel, a aplicação dizia «sem IA», e não
havia erro nenhum a apontar o motivo. As duas convenções passaram a ser lidas.

Se quiseres saber qual foi o nome que a aplicação encontrou, `GET /api/ai/estado`
não o diz (é inventário de infraestrutura), mas *Conta → Chaves de IA* mostra o
estado de cada fornecedor: `configurada`, `por preencher` ou `ausente`.

### Marcador de «ainda não preenchido»

Se uma variável começar por `SUBSTITUIR`, `<` ou `COLA`, é tratada como **não
configurada**. Serve para criares os nomes todos de uma vez e ires preenchendo,
sem que a aplicação envie uma chave falsa para o fornecedor. O painel
*Conta → Chaves de IA* mostra o estado de cada uma: `configurada`, `por preencher`
ou `ausente`. **O valor nunca é mostrado**, nem a administradores.

### Saber se a instância tem IA, sem entrar na conta

`GET /api/ai/estado` (público) responde em três palavras: `modo`
(`operador` · `sem-chave` · `nenhum`), o `fornecedor` e o `modelo` que seriam
usados, e quantas chaves de operador estão preenchidas. **Não devolve valores
nem a lista de nomes configurados** — só o que é preciso para responder a
«a aplicação tem IA neste momento?». Exemplo:

```bash
curl -s https://conspiracy-aitracker.onrender.com/api/ai/estado
{"ok":true,"modo":"sem-chave","fornecedor":"pollinations","modelo":"openai",
 "semChave":true,"chavesDoOperador":0,"cofrePorUtilizador":true,
 "aviso":"IA pelo fornecedor público sem chave: mais lenta e partilhada; ..."}
```

`modo:"nenhum"` é o único caso em que a análise por IA não corre de todo — e
acontece só quando não há chave nenhuma **e** `AI_KEYLESS_FALLBACK=false`.

### Se o modelo sugerido já não existir

Os fornecedores mudam o catálogo sem avisar. Quando o erro é «esse modelo não
existe / não tens acesso», a aplicação pede a lista real (`GET /models`, um
pedido autenticado que só envia a chave), escolhe um modelo de conversa dessa
lista e repete **uma** vez — o mesmo texto, sem conteúdo novo. A lista fica em
cache uma hora. Nunca se tenta um nome inventado: se a lista não servir, falha
e diz porquê.

A resposta da sondagem mostra os dois nomes, para não haver dúvida sobre o que
foi usado:

```json
"verificado":{"ok":true,"modelo":"llama-3.1-8b-instant",
  "modeloPedido":"llama-3.3-70b-versatile","modeloCorrigido":"llama-3.1-8b-instant", ...}
```

Se preferires fixar um modelo teu, define `AI_MODEL_GROQ` (ou `API_MODEL_GROQ`)
com o nome exacto — a partir daí esse é o primeiro a ser tentado.

### Provar que a IA responde de facto (sondagem real)

`modo:"sem-chave"` diz que há um caminho configurado — não diz que o fornecedor
respondeu. Para ter a prova:

```bash
curl -s "https://conspiracy-aitracker.onrender.com/api/ai/estado?probe=1"
# → "verificado":{"ok":true,"ms":2416,"amostra":"ok"}
```

Para verificar **uma chave concreta** (e não só a primeira da ordem), pede-se
o fornecedor pelo nome:

```bash
curl -s ".../api/ai/estado?probe=gemini"
curl -s ".../api/ai/estado?probe=openrouter"
```

Se a variável desse fornecedor estiver ausente ou com marcador, a resposta diz
qual é o nome que falta — sem gastar a sondagem do minuto, porque não há
chamada externa nenhuma.

Se a chave do operador estiver errada, a resposta diz isso **e** mede a
alternativa, para responder logo à pergunta seguinte:

```json
"verificado":{"ok":false,"via":"operador","fornecedor":"gemini","motivo":"HTTP 400",
  "chaveFalhou":true,
  "alternativaSemChave":{"ok":true,"ms":314,
    "nota":"a chave do operador falhou, mas a aplicação continua a ter IA pelo fornecedor sem chave"}}
```

O que é enviado é uma frase fixa e pública — `«Responda apenas: ok»` —, nenhum
documento, nenhum excerto e nenhum dado de conta. Limites: **1 sondagem por
minuto no servidor todo** e **3 por hora por IP**; a partir daí responde `429`
com o tempo de espera. Sem `?probe=1` este endereço não faz chamada externa
nenhuma (há teste que o confirma, medindo o tempo).

### Chave do utilizador vs. chave do operador

| | onde fica | quem paga | quando é usada |
|---|---|---|---|
| **Chave do utilizador** | cofre AES-256-GCM, por conta (`APP_SECRET`), em *Conta → Chaves de IA* | o utilizador | primeiro, se existir e estiver validada |
| **Chave do operador** | variável de ambiente do Render | o dono da instância | a seguir, para quem não tem chave |
| **Sem chave (Pollinations)** | nada a configurar | ninguém (serviço público) | por último; desliga-se com `AI_KEYLESS_FALLBACK=false` |

---

## 2. Fornecedores com nível gratuito — variável, onde obter, o que foi medido

| Fornecedor | Variável | Onde obter a chave | Nível gratuito anunciado | Sonda sem chave (2026-10-22) |
|---|---|---|---|---|
| Groq | `AI_KEY_GROQ` | https://console.groq.com/keys | sim, com limites | `401` · endpoint existe |
| Google Gemini | `AI_KEY_GEMINI` | https://aistudio.google.com/apikey | sim, com limites | `403` · endpoint existe |
| Cerebras | `AI_KEY_CEREBRAS` | https://cloud.cerebras.ai | sim, com limites | `403` · endpoint existe |
| OpenRouter | `AI_KEY_OPENROUTER` | https://openrouter.ai/keys | modelos `:free` (17 na lista pública) | `200` na lista de modelos |
| Mistral AI | `AI_KEY_MISTRAL` | https://console.mistral.ai/api-keys | experimental | `401` · endpoint existe |
| GitHub Models | `AI_KEY_GITHUB` | https://github.com/settings/tokens (PAT com `models:read`) | sim, incluído no GitHub | `200` na lista de modelos |
| NVIDIA NIM | `AI_KEY_NVIDIA` | https://build.nvidia.com | créditos gratuitos de programador | `200` na lista de modelos |
| SambaNova | `AI_KEY_SAMBANOVA` | https://cloud.sambanova.ai | sim, com limites | `200` na lista de modelos |
| Hugging Face Router | `AI_KEY_HUGGINGFACE` | https://huggingface.co/settings/tokens | créditos limitados | `200` na lista de modelos |
| Cohere | `AI_KEY_COHERE` | https://dashboard.cohere.com/api-keys | trial limitado | `401` · endpoint existe |
| Cloudflare Workers AI | `AI_KEY_CLOUDFLARE` (+ `conta` no painel da app) | https://dash.cloudflare.com/profile/api-tokens | sim, por neurónios/dia | não sondado (URL depende da conta) |
| **Pollinations (sem chave)** | — | — | serviço público, sem garantia | `POST` completou · **HTTP 200 real** |

Modelo por fornecedor (opcional): `AI_MODEL_GROQ`, `AI_MODEL_GEMINI`,
`AI_MODEL_OPENROUTER`, `AI_MODEL_POLLINATIONS`. Sem isto usa-se o primeiro
modelo declarado no catálogo (`server/providers.mjs`).

> «Nível gratuito anunciado» é o que o fornecedor publica. Não é uma promessa
> nossa: os limites mudam sem aviso. A sonda datada é o que conseguimos provar.

---

## 3. O que acontece quando a chave está mal

1. Tenta-se o fornecedor da chave.
2. Se ele responder `401`/`403` (chave inválida) **e** o fallback sem chave estiver
   ligado, a chamada passa para o fornecedor sem chave **e a resposta diz isso**:
   `fallbackFrom: "groq"`, `aviso` sobre a qualidade.
3. A utilização fica registada com o fornecedor e o modelo **reais**, com
   `viaOperador: true` e `semChave: true|false`.
4. Se não houver chave nenhuma nem fallback, os agentes e o motor de pesquisa
   **param** e escrevem o motivo (`sem-fornecedor-de-ia-validado`). Não se inventa
   um resultado.

`AI_KEYLESS_FALLBACK=false` desliga o passo 2 e o passo do fornecedor sem chave.

---

## 4. Limite real do fornecedor sem chave (importante)

O serviço público responde, quando é rápido demais:

```
Free limit reached: 1 reply every 30 seconds per IP
```

Por isso o adaptador **serializa** os pedidos sem chave (fila) e, quando o
fornecedor pede espera, espera o tempo indicado — no máximo 35 s, uma só vez.
Consequências honestas:

* uma execução rápida de pesquisa (6–8 passos de IA) pode levar alguns minutos;
* o limite é **por IP**: o IP é o do servidor Render, partilhado por todos os
  utilizadores da instância. Com vários utilizadores a usar IA ao mesmo tempo,
  uns esperam pelos outros;
* para uso sério, uma chave gratuita (Groq, Gemini, Cerebras…) é melhor em tudo:
  mais rápida, mais estável e com limites explícitos.

## 5. Privacidade do fornecedor sem chave

Os pedidos passam por um serviço público de terceiros. A interface diz isso e a
regra mantém-se: **não enviar dados pessoais nem provas privadas**. Nada é
enviado automaticamente — só quando o utilizador carrega em «Analisar com IA» ou
corre um agente, e só com `confirmCost: true`.

---

## 6. Descobrir mais fornecedores sem chave (e porque quase não há)

Ferramenta auditada do repositório: `tools/keyless-scan.mjs`.

```
node tools/keyless-scan.mjs --limit=45 --confirmar
```

Duas etapas, e a distinção é o ponto principal:

* **etapa 1** — `GET <base>/models` sem `Authorization`. Um `200` prova só que o
  **catálogo de modelos é público**;
* **etapa 2** (`--confirmar`) — `POST /chat/completions` com `max_tokens:1` e sem
  `Authorization`. Só esta etapa pode concluir «gera sem chave».

Resultado medido (2026-10-22, 45 fornecedores do catálogo models.dev + 1 controlo):
13 com catálogo público, **0 dos 12 candidatos reais aceitaram geração sem chave**
(`401`/`403`/`429`), e o controlo (Pollinations) foi detectado correctamente —
o que mostra que a sonda não está a dar falsos negativos.
Relatório completo: `docs/APIS-sem-chave.json`; resumo em `docs/APIS-sem-chave.md`.

A sonda recusa `http://` e endereços privados (SSRF), faz um único pedido por
endpoint, não envia cookies nem chaves e nunca corre no arranque da aplicação.

---

## 7. Verificação rápida em produção

```
curl -s https://conspiracy-aitracker.onrender.com/api/providers   # → 401 sem sessão
```

Com sessão, `GET /api/providers` devolve `operatorKeys`:

```json
{ "providers": { "groq": { "estado": "ok", "env": "AI_KEY_GROQ" }, … },
  "activo": { "provider": "groq", "modelo": "llama-3.3-70b-versatile", "keyless": false },
  "keylessFallback": true }
```

Os valores das chaves **nunca** aparecem — nem aqui, nem na interface, nem nos
registos. Há um teste que verifica que o corpo da resposta não contém a chave
(`tests/ia-fornecedores.mjs`).
