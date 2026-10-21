# Os 13 agentes

Versão: 2026-10-21 · Código: `server/agents.mjs` · Rotas: `GET /api/agents`, `GET|POST /api/projects/{id}/agent-runs|agents/{agent}/run` · Testes: `tests/agents-p3.mjs` (16/16)

## Princípio

Um agente é uma função com **contrato declarado**, não um assistente com iniciativa. Cada agente diz
o que recebe, o que devolve, quando se considera concluído e quanto tempo pode correr. E nenhum
agente — nem o de IA — escreve conclusões, provas ou relações: o resultado é uma **análise** ou uma
**proposta** que fica registada em `agentRuns`. A decisão continua humana.

## Registo dos agentes

| Agente | Tipo | Recebe | Devolve | Critério de conclusão | Limite |
| --- | --- | --- | --- | --- | --- |
| Orquestrador | local | projecto, provas, conclusões, relações, execuções | próximos passos em falta | cada sugestão aponta ao que falta | 5 s |
| Planeador de investigação | IA | pergunta, âmbito | subperguntas, consultas, critérios | JSON válido, sem nomes inventados | 30 s, 12 itens |
| Pesquisa web (consultas) | IA | pergunta, entidades | consultas + operadores + motivo | sem nomes fora da pergunta/provas | 30 s, 20 itens |
| Caça a documentos | IA | entidades, âmbito | tipos de documento, registos, jurisdições | cada sugestão nomeia registo e jurisdição | 30 s, 15 itens |
| Extracção de excertos | IA | documentos, pergunta | excertos literais + posição | excerto literal com URL | 30 s, 30 itens |
| Resolução de entidades | local | entidades das provas | colisões, entidades sem desambiguador | nenhuma fusão sem identificador | 5 s |
| Mapeamento de relações | IA | excertos | relações **propostas** (nunca gravadas) | cada proposta cita excerto e tipo | 30 s, 20 itens |
| Societário e financeiro | IA | entidades, provas | cadeia declarada, lacunas, inferências separadas | distingue documentado de inferido | 30 s, 20 itens |
| Cronologia | local | provas com datas | eventos ordenados, anomalias | cada evento aponta prova e tipo de data | 5 s |
| Contra-provas | local | conclusões, provas | conclusões sem contra-prova procurada | cada lacuna diz o que procurar | 5 s |
| Verificador de factos | local | conclusões, provas | conclusões cujo estado não é sustentado | aplica os nove estados do servidor | 5 s |
| Auditor adversário | local | provas, conclusões, relações, citações | achados com gravidade e sujeito | cada achado indica a regra violada | 8 s |
| Gerador de relatório | IA | provas, conclusões, relações | texto por secção, só a partir dos dados | não acrescenta factos, declara o que falta | 30 s, 18 itens |

**6 agentes locais** (determinísticos, correm sempre) e **7 de IA** (exigem chave validada do
utilizador e cofre activo). Sem isso, o agente fica `nao-executado` com o motivo escrito
(«sem fornecedor de IA validado: configure e valide uma chave em «Chaves de IA»») e **saída nula** —
nunca um resultado fictício.

## As 10 regras do auditor adversário

O auditor não opina sobre a verdade das conclusões: verifica se o que está registado respeita as
regras da aplicação. Achados têm código, gravidade e sujeito (`claim`, `evidence`, `relation`, `citation`).

| Código | Gravidade | O que detecta |
| --- | --- | --- |
| `citacao-sem-prova` | alta | citação sem prova registada correspondente |
| `citacao-divergente` | alta | excerto citado que não aparece na prova |
| `conclusao-sem-prova` | alta | conclusão sem qualquer prova ligada |
| `estado-acima-das-provas` | alta | estado mais forte do que o sugerido pelas provas |
| `copias-como-corroboracao` | alta | estado forte assente em cópias da mesma origem |
| `confirmada-com-contraprova` | alta | «confirmada» com prova contrária ligada |
| `relacao-sem-prova-activa` | alta | aresta cujas provas foram retiradas |
| `inferencia-sem-raciocinio` | alta | relação inferida sem raciocínio escrito |
| `prova-sem-excerto-util` | media | excerto inexistente ou demasiado curto |
| `prova-sem-localizacao` | media | prova sem URL nem localização física |
| `comunicado-sem-origem` | media | comunicado sem `syndicationOf` (pode contar como origem) |
| `confianca-inflacionada` | media | «alta» com menos de 2 origens independentes |
| `linguagem-absoluta` | media | «100%», «provado sem dúvida», «inquestionável» |
| `prova-sem-data` | baixa | sem data de publicação nem de acontecimento |
| `relacao-so-uma-origem` | baixa | várias provas, uma só origem |

## Execuções

Cada execução guarda: `id`, `agentId`, `kind`, `phase`, `promptVersion` (IA), `status`
(`concluido`, `nao-executado`, `falhou`), `startedAt`/`finishedAt`, `latencyMs`, `provider`, `model`,
`output`, `findings`, `reason`, e um `seq` por projecto. Listagem: `GET /api/projects/{id}/agent-runs`
(ordenada, isolada por dono — outra conta recebe `404`). Auditoria: evento `agent_run` com agente,
estado e número de achados.

Estados possíveis, e o que significam:

- `concluido` — correu e devolveu saída estruturada (os agentes locais devolvem sempre estrutura).
- `nao-executado` — não podia correr (sem IA validada). **Não é falha nem sucesso**: é ausência.
- `falhou` — correu e falhou (resposta não JSON, 401, timeout). A saída **não** é guardada.

## O que ainda não está feito

- **`agent_runs` na versão de prompt por agente**: existe uma versão global (`a1`); cada agente deverá
  ter a sua, com histórico de alterações.
- **Orçamento por agente** (tokens/custo) e **fila**: as execuções correm dentro do pedido HTTP.
- **Encadeamento automático** (o orquestrador a decidir a ordem): hoje o utilizador escolhe o agente.
- **Agentes locais a escreverem sugestões no projecto** (por exemplo subperguntas propostas): hoje só
  devolvem o resultado no histórico, sem tocar no objecto de investigação.


## 7. Orçamento de execuções (implementado)

Cada agente tem um tecto por projecto e por janela de 24 h: **40 execuções** para agentes locais e
**8** para agentes de IA (que custam dinheiro); a conta tem ainda um tecto global de **120**.

- a verificação acontece **antes** de executar: esgotado o orçamento, a API responde `429` com
  `quota` (limite, usado, restante, `resetsAt`) e o evento `agent_run_blocked` fica na auditoria;
- a partir de 2 execuções restantes, a resposta traz um aviso (`warn`) e a interface mostra-o na
  coluna «orçamento»;
- `GET /api/projects/{id}/agent-runs` devolve `quotas` para os 13 agentes e as regras
  (`quotaRules`), para que a interface não invente números.
