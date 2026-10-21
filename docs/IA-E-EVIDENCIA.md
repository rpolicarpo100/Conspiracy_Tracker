# IA, agentes e evidência: o que o sistema aceita e o que recusa

## Princípio

A IA não é uma fonte. É um assistente de organização. Neste sistema ela **não pode**
introduzir factos no grafo, não pode elevar uma relação a *confirmada* e não pode escrever
acusações. Tudo o que devolve entra como **alegação com fonte**, sujeita a verificação humana
e registada no livro de provas com hash.

## Fluxo completo

```
pergunta do investigador
   ↓ (planeador local, sem IA — src/core/research.js)
plano de fontes verificáveis + hipóteses + teste de refutação
   ↓ (opcional) contrato de evidência → modelo de linguagem
resposta JSON
   ↓ (validador estrito — validateAIResponse)
aceites → registo de alegação (livro de provas)
rejeitadas → listadas com o motivo, nada é aproveitado
   ↓ (humano)
verificação: fonte primária + excerto + revisor + data → só então "confirmado"
```

## Contrato imposto ao modelo

`src/core/research.js → AI_SYSTEM`. Resumo:

1. Nenhuma afirmação sem fonte identificável (nome, URL ou referência, data de consulta).
2. Distinguir sempre facto documentado, alegação, inferência e hipótese.
3. Se não encontrou, escrever «não encontrado em <fonte> em <data>» — **nunca** «não existe».
4. Não atribuir crimes, intenções ou coordenação a pessoas com base em relações ou proximidade.
5. Sem linguagem de culpa, perigosidade ou suspeita.
6. Identificar homónimos e exigir identificadores antes de fundir entidades.
7. Apresentar a hipótese alternativa e o teste que a refutaria.
8. Se a pergunta pressupõe uma conclusão («o que os media escondem»), reformulá-la como pergunta
   verificável e dizê-lo explicitamente.
9. Todos os campos obrigatórios; desconhecido = `null` + explicação em `limits`.
10. JSON válido, sem texto fora do JSON.

## O validador rejeita automaticamente

| Situação | Motivo de rejeição |
|---|---|
| Afirmação sem `sources` | «sem fonte» |
| Fonte sem data de consulta | «fonte sem data de consulta» |
| Fonte primária sem excerto | «fonte primária sem excerto» |
| `status: confirmado` sem fonte primária citada | «confirmação sem fonte primária citada» |
| `kind` fora de facto/alegação/inferência/hipótese | «tipo de afirmação inválido» |
| Texto com imputação («culpado», «corrompeu», «escondeu intencionalmente») | «linguagem de imputação não sustentada» |

Teste automatizado: `tests/flow.mjs`, passo 12 (rejeita 1, aceita 1 com fonte primária citada).

## Como ligar um modelo real

1. Botão **Investigar** → separador **Configuração de IA**.
2. Endpoint compatível com o formato `/chat/completions`, nome do modelo e chave.
   A chave fica apenas no `localStorage` deste navegador; não é enviada para mais nenhum sítio.
3. **Testar ligação** verifica o endpoint. Se a API bloquear pedidos do browser (CORS) ou não
   quiser expor a chave, use o **modo manual**: *Investigar → Copiar prompt* → usar em qualquer
   assistente → colar a resposta em *Validar resposta de uma IA*.

O envio exige **consentimento explícito** por pedido e mostra o endpoint de destino.

## Privacidade e deveres

- Não envie dados pessoais sensíveis, fontes protegidas, material sob segredo de justiça ou
  identidades de denunciantes para APIs externas.
- Registe no livro de provas que houve auxílio de IA (`resposta_ia`) — incluindo o modelo e o
  endpoint. A rastreabilidade inclui as ferramentas usadas.
- Uma alegação veiculada por IA continua a ser uma alegação. Se não houver fonte primária, não
  deve ser publicada.

## Agentes / bots: o que faz sentido automatizar

Automatizar **recolha**, nunca **julgamento**:

| Tarefa automatizável | Porquê é segura | Estado |
|---|---|---|
| Consultar o Portal BASE por NIF/adjudicante e arquivar o resultado com URL e data | dados públicos, resultado verificável | planeado (interface de importação pronta) |
| Submeter pedidos de acesso a documentos (Lei n.º 46/2007) e registar prazo/resposta | acto formal, com prova documental | planeado |
| Monitorizar o Diário da República por nomes/NIF e registar publicações | fonte oficial | planeado |
| Guardar versões de páginas (Arquivo.pt) antes que desapareçam | preserva prova | planeado |
| Detectar contradições entre o que foi noticiado e o documento original | comparação textual com excerto | parcialmente implementado (contras-provas no modelo) |
| Atribuir culpa, intenção ou «conspiração» | não é verificável e difama | **nunca** |

O sistema está preparado para receber estes agentes: qualquer um deles só pode escrever no livro de
provas entradas tipificadas (`recolha`, `verificacao`, `resultado_negativo`), com fonte, URL, data de
recolha e hash do excerto. Um agente não pode escrever directamente no grafo.

## Sobre «encontrar tudo o que os media escondem»

Essa formulação não é verificável e por isso não pode ser um objectivo de engenharia honesto:

- **«Tudo»** é indefinido: nenhuma investigação esgota o universo documental.
- **«Escondem»** pressupõe intenção — que exige prova própria, não inferência.
- O que *é* mensurável e fazível: ampliar a base de fontes para lá do que a imprensa citou
  (registos, contratos, actas, decisões, registos de interesses), **documentar o que não foi
  encontrado e onde**, e detectar contradições entre a narrativa pública e o documento.

É isso que o sistema faz. E é isso que permite publicar sem ser desmentido: cada afirmação leva a
prova atrás, e o que não está provado aparece como alegação.
