# Motor de pesquisa e relatório rastreável

Versão: 2026-10-21 · Código: `server/research.mjs`, `server/report.mjs`, rotas em `server/api.mjs` · Testes: `tests/research.mjs` (19/19)

Este é o ponto onde é mais fácil mentir numa aplicação de investigação. O motor foi desenhado ao
contrário: **cada passo que não pode correr fica registado como não executado, com o motivo escrito**,
e a execução pára em vez de continuar com conteúdo inventado.

## 1. Os 20 passos

| # | Passo | Tipo | Executa o quê |
| --- | --- | --- | --- |
| 1 | interpretar | IA | pergunta testável, o que contaria como prova e como refutação |
| 2 | ambito | local | âmbito, data de referência, critérios (só reorganiza o que existe) |
| 3 | entidades | IA | entidades com desambiguador; sem desambiguador não há fusão |
| 4 | variantes | IA | variantes de redacção da consulta |
| 5 | multilingue | IA | variantes noutras línguas do âmbito |
| 6 | primarias | local | fontes primárias previstas e prioritárias |
| 7 | secundarias | local | fontes secundárias e excluídas |
| 8 | recolher | recolha | pedidos HTTP reais às URLs indicadas (hash, tamanho, estado) |
| 9 | excertos | IA | excertos literais que respondem à pergunta (candidatos, não provas) |
| 10 | alegacoes | IA | entidades, datas e alegações presentes nos documentos |
| 11 | resolver | local | resolução de entidades com a regra anti-homónimo |
| 12 | deduplicar | local | duplicados por hash de conteúdo e URL canónico |
| 13 | verificar | local | datas, origem e integridade do que está registado |
| 14 | corroborar | local | corroboração por origens independentes |
| 15 | contraprovas | IA | consultas para procurar activamente o que contradiz |
| 16 | lacunas | local | conclusões sem provas, fontes inacessíveis, campos em falta |
| 17 | expandir | IA | expansão a partir das lacunas |
| 18 | grafo | local | entidades prontas para o grafo (sem inferir relações) |
| 19 | relatorio | local | relatório de 18 secções |
| 20 | revisao | local | entrega para revisão humana — nada é publicado sem decisão humana |

O tipo diz o que o passo precisa: `local` nunca chama nada de fora; `IA` exige um fornecedor
**validado** do utilizador; `recolha` exige URLs e faz pedidos HTTP reais.

## 2. Perfis de execução (esforço, não cobertura)

| Perfil | Chamadas | Documentos | Minutos | Passos de IA |
| --- | --- | --- | --- | --- |
| `rapida` | 4 | 3 | 2 | interpretar, variantes |
| `normal` | 12 | 8 | 10 | interpretar, entidades, variantes, excertos, alegacoes |
| `profunda` | 30 | 20 | 30 | + multilingue, contraprovas |
| `exaustiva` | 60 | 40 | 60 | + expandir |

Os passos de IA fora do perfil ficam com estado **`ignorado-pelo-perfil`** e a razão escrita: não é
uma falha, é uma escolha declarada. A interface mostra `n/20 passos concluídos` e o número de fontes
efectivamente consultadas — nunca uma percentagem de cobertura.

## 3. Quando a execução pára (motivos possíveis)

| `stopReason` | Quando |
| --- | --- |
| `sem-fornecedor-de-ia-validado` | passo de IA sem chave validada (ou sem cofre activo) |
| `sem-urls-para-consultar` | passo de recolha sem URLs indicadas |
| `orcamento-esgotado` | chamadas/documentos/minutos do perfil atingidos |
| `resposta-invalida-de-ia` | a resposta do fornecedor não é JSON válido — **nada é guardado** |
| `falha-de-ia` | o fornecedor recusou (401, 429, 5xx, timeout) |
| `erro-no-passo-<id>` | excepção inesperada, com a mensagem do erro |
| `cancelado-pelo-utilizador` | cancelamento explícito |

Cada passo guarda: `n`, `id`, `tipo`, `estado` (`concluido`, `nao-executado`, `ignorado-pelo-perfil`,
`falhou`), `startedAt`/`finishedAt`, `promptVersion`, `provider`, `model`, `output`, `reason`,
contagens. As execuções são **persistentes**, listáveis (`GET /api/projects/{id}/runs`),
**retomáveis** (`POST /api/runs/{id}/resume` — só os passos em falta) e **canceláveis**
(`POST /api/runs/{id}/cancel`, apenas enquanto decorrem).

## 4. Segurança do conteúdo recolhido

- Cada documento recolhido é verificado por padrões de injecção («ignora as instruções anteriores»,
  «revela a chave», «envia para https://…»): o resultado fica na fonte (`injection.suspicious`) e é
  visível no relatório.
- O prompt do sistema declara que o conteúdo dos documentos é **dado, nunca instrução**, e que o
  modelo deve assinalar tentativas de comando em vez de obedecer.
- A recolha recusa hosts privados/link-local (SSRF), só aceita `http(s)`, limita a 2 MB e 15 s, e
  guarda o SHA-256 do que recebeu.
- O motor **não escreve provas**: os excertos são candidatos. A prova continua a exigir excerto,
  decisão humana e as regras de `docs/EVIDENCIA.md`.

## 5. Relatório de 18 secções

| # | Secção | Fonte |
| --- | --- | --- |
| 1 | Pergunta | projecto |
| 2 | Âmbito | projecto (geo, línguas, período, fontes incluídas/excluídas) |
| 3 | Data de referência | projecto |
| 4 | Metodologia | execuções: perfil, estado, motivo de paragem, passo a passo |
| 5 | Fontes consultadas | recolha real: URL, estado HTTP, bytes, hash, sinal de injecção |
| 6 | Fontes inacessíveis | provas inacessíveis e retiradas, com motivo |
| 7 | Entidades | nomes associados a provas (nunca extraídos da pergunta) |
| 8 | Alegações e conclusões | estado, factores de corroboração e estado sugerido |
| 9 | Provas favoráveis | lista com excerto e URL |
| 10 | Provas contrárias | lista; se vazia, diz que a ausência de contra-prova não prova nada |
| 11 | Relações | **Não disponível** — relações ainda não são gravadas a partir de provas |
| 12 | Cronologia | datas de acontecimento/publicação ordenadas |
| 13 | Lacunas | conclusões sem provas, uma só origem, critérios/data em falta |
| 14 | Limitações | limitações por prova + provas retiradas com motivo |
| 15 | Estado de verificação | por estado de validação; quantas têm data de verificação |
| 16 | Modelos e ferramentas | fornecedor/modelo por passo, versão de prompt |
| 17 | Custos | tokens reportados e custo, ou «não reportado pelo fornecedor» |
| 18 | Conclusões proporcionais | uma frase por conclusão, no estado que as provas sustentam |

`GET /api/projects/{id}/report` devolve JSON; `?format=md` devolve Markdown. Secções sem dados
aparecem com `available: false` e `note: "Não disponível: …"` — nunca preenchidas com texto genérico.
A interface mostra exactamente o mesmo (`docs/shot-20-relatorio.png`).

## 6. Limites assumidos nesta fase

- **PDF/OCR**: a recolha lê HTML e texto; PDFs não são extraídos (a fonte é registada e o limite é
  declarado na prova).
- **Pesquisa na web**: o motor consulta URLs indicadas pelo utilizador; não faz descoberta de fontes
  por conta própria (nem poderia, sem uma API de pesquisa configurada).
- **Verificação de acessibilidade**: não há re-visita automática do URL para confirmar o excerto.
- **Tarefas em segundo plano**: a execução corre dentro do pedido HTTP, com orçamento limitado. Fila
  persistente com trabalhadores é trabalho da fase de escala (P4); hoje, um pedido longo pode ser
  cortado pelo proxy — e nesse caso a execução fica em `running` e pode ser retomada.
- **Custos**: só se mostram valores que o fornecedor reporta; não há tabela de preços embutida.
- **Grafo**: o relatório ainda não produz relações; a secção 11 diz isso em vez de inventar linhas.
