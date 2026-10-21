# Fornecedores de IA: configuração, chaves e estado real

Versão: 2026-10-21 · Código: `server/providers.mjs`, `server/crypto-keys.mjs`, rotas em `server/api.mjs`

A aplicação **não** embute chaves e não afirma gratuitidade que não tenha confirmado. Cada fornecedor
tem um adaptador e cada chave é validada por uma chamada real antes de ser dada como operacional.

## 1. Fornecedores suportados (8 adaptadores)

| id | Nome | Base URL | Chave necessária | Estilo de auth | Gratuitidade declarada na app |
| --- | --- | --- | --- | --- | --- |
| `gemini` | Google Gemini | `generativelanguage.googleapis.com/v1beta/openai` | API key | `Bearer` | «sim (com limites)» |
| `groq` | Groq | `api.groq.com/openai/v1` | API key | `Bearer` | «sim (com limites)» |
| `openrouter` | OpenRouter | `openrouter.ai/api/v1` | API key | `Bearer` | «modelos gratuitos e pagos» |
| `cerebras` | Cerebras | `api.cerebras.ai/v1` | API key | `Bearer` | «sim (com limites)» |
| `mistral` | Mistral AI | `api.mistral.ai/v1` | API key | `Bearer` | «experimental» |
| `huggingface` | Hugging Face Router | `router.huggingface.co/v1` | token | `Bearer` | «créditos limitados» |
| `cloudflare` | Cloudflare Workers AI | `api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1` | API token + `account_id` | `Bearer` | «sim (neurons/dia)» |
| `custom` | Compatível com OpenAI | indicado pelo utilizador | conforme | `Bearer` | «desconhecido» |

Notas de honestidade:

- Todos os fornecedores acima expõem uma superfície compatível com OpenAI `/chat/completions`
  **excepto** diferenças de caminho; o adaptador usa um único caminho de código e não duplica lógica.
- **Não** se assume que todos suportam *tools*, JSON estruturado, *streaming* ou visão. Cada
  capacidade só é usada depois de declarada na configuração do fornecedor; caso contrário o pedido
  é feito sem essas opções.
- O `account_id` da Cloudflare é obrigatório: sem ele o fornecedor aparece como «necessita
  configuração» e a validação falha com mensagem explícita, em vez de fingir sucesso.
- «Gratuitidade» é a informação publicada pelo fornecedor no momento da escrita; **não** é medida
  por esta aplicação nem garantida.

## 2. Chaves: onde vivem e como são protegidas

- Cofre `keyVault` (`server/crypto-keys.mjs`): AES-256-GCM com chave derivada do `APP_SECRET`
  (mínimo 24 caracteres; a aplicação **recusa** arrancar em modo cofre sem ele).
- Guardado por utilizador e por fornecedor: `{ iv, tag, ciphertext, mask, savedAt, lastCheck }`.
- A interface e a API só devolvem a **máscara** (`chav…123`). Chave completa: nunca em resposta,
  nunca em log, nunca em auditoria (`tests/server.mjs` verifica-o inspeccionando o ficheiro de dados).
- Isolamento: a chave é resolvida pelo `userId` da sessão; não existe rota que aceite um `userId`
  no corpo do pedido.
- Chaves de administração a nível de plataforma **não** estão implementadas nesta versão: cada
  utilizador configura as suas. Uma chamada nunca usa a chave de outro utilizador.

## 3. Configuração (variáveis de ambiente, sem segredos neste documento)

| Variável | Obrigatória | Efeito |
| --- | --- | --- |
| `APP_SECRET` | sim, para guardar chaves | cifra das chaves; ≥24 caracteres |
| `ADMIN_EMAIL` | não | o **primeiro** registo com este email é promovido a ADMIN (uma única vez) |
| `DATA_DIR` | recomendada | pasta do `store.json`; sem ela os dados não sobrevivem a um deploy |
| `AGENT_BUDGET` | não | tecto de chamadas de recolha automática |
| `LOGIN_MAX_ATTEMPTS`, `REGISTER_MAX` | não | limites de tentativas (8 / 10 por defeito) |
| `PORT` | Render define | porta HTTP |

As chaves dos fornecedores **não** são variáveis de ambiente globais nesta versão: são guardadas por
utilizador através da interface (aba «Chaves de IA»). Um operador que queira chaves de plataforma
deve configurá-las como chaves de administração no `DATA_DIR`, não em código.

## 4. Como validar um fornecedor (procedimento testado)

1. Conta → **Chaves de IA** → escolher fornecedor → colar a chave → **Guardar** (máscara devolvida).
2. Premir **Testar** na linha do fornecedor. O servidor faz uma chamada real mínima:
   - sucesso → estado `ok`, latência medida, `lastCheck` actualizado;
   - credencial inválida → estado `auth` com «credencial recusada (HTTP 401)»;
   - modelo inexistente → recusado **antes** de gerar texto;
   - tempo excedido → estado `timeout` (20 s por omissão);
   - rede/host privado → recusado pela verificação SSRF.
3. Só depois de um teste bem-sucedido o fornecedor é marcado como operacional para esse utilizador.

Evidência real desta sessão: com a chave `chav…123` o Groq respondeu
«falhou em `auth`: credencial recusada (HTTP 401)» — o teste **não** foi apresentado como sucesso.
Um fornecedor sem teste continua listado como **«necessita configuração»**.

## 5. Resiliência (implementada)

- *Timeout* por chamada: 20 s (`DEFAULT_TIMEOUT`).
- *Retry*: até 2 tentativas (máximo configurável 3) em falhas transitórias; nunca se repete um
  401/403 (credencial recusada) nem um 400 (pedido inválido).
- *Circuit breaker*: após 3 falhas na mesma chave, o fornecedor fica 60 s em aberto e a resposta
  indica `retryInMs` — `tests/server.mjs` verifica a abertura após a 3.ª falha.
- *Fornecedor por pedido*: cada pedido nomeia um fornecedor concreto; uma falha devolve o erro real
  desse fornecedor e nunca é apresentada como resultado de outro. A cadeia automática de *fallback*
  entre fornecedores (**modelo preferido por agente → alternativas**) ainda **não** existe.
- *Custos*: guarda-se fornecedor, modelo, latência e estado; **custo em dinheiro não é estimado**
  quando o fornecedor não o reporta — aparece como «não reportado», nunca como 0,00 €.

## 6. O que ainda não está feito

- **Perfis de modelo por tarefa** (planeamento, extracção, classificação, revisão crítica…) e
  **verificação cruzada entre fornecedores independentes**: desenhados, ainda não configuráveis na
  interface.
- **Quotas por utilizador/projecto** e *warn-before-stop*: apenas o tecto global `AGENT_BUDGET`
  existe; o uso por utilizador é **registado** (fornecedor, modelo, tokens, latência, estado).
- **Fallback automático entre fornecedores** e **preferência de modelo por agente**: registado como
  próximo passo, não implementado.
- **Endpoint `/api/providers/{p}/models`**: a lista de modelos é hoje uma sugestão (`modelsHint`),
  validada apenas na chamada real — não há listagem dinâmica por fornecedor.
- **Cloudflare com `account_id`** está implementado no adaptador mas não foi validado com uma conta
  real (testado apenas o caminho de erro por falta de configuração).
