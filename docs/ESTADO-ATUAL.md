# ESTADO ATUAL — o que existe, o que falta, o que está bloqueado

Este ficheiro é o ponto único de verdade sobre o estado do trabalho. Foi escrito para que ninguém
(eu incluído, numa sessão futura) tenha de reconstruir o contexto de memória.

Regras: nada aqui é aspiracional. Se uma linha diz «testado», o teste está identificado. Se diz
«não implementado», não há código que o faça. O bloco entre marcadores é gerado por
`node tools/status.mjs --write` a partir do código — se divergir, o script falha com `--check`.

<!-- GERADO:AUTO -->
## Versão

- versão da aplicação: **2.0.0-fase3d**
- esquema de dados: **v5** · colecções: users, sessions, projects, credentials, usage, evidence, claims, runs, relations, agentRuns, notes, entityLinks, audit, migrations
- estados de validação: 9 (confirmada, corroborada-independente, alegacao-atribuida, inferencia-suportada, hipotese, contraditoria, insuficiente, refutada, fonte-inacessivel)
- agentes: 13 (6 locais, 7 de IA)
- rotas de API: 56
- ficheiros de teste: 23 · blocos de teste declarados (`await t`): 218 (os ficheiros de interface usam outro executor e contam 0 aqui)

### Suites

| ficheiro | asserções | tipo |
| --- | --- | --- |
| `tests/account-ui.mjs` | 15 | interface (Playwright) |
| `tests/agents-p3.mjs` | 16 | servidor/módulo |
| `tests/agents-ui.mjs` | 5 | interface (Playwright) |
| `tests/agents.mjs` | 18 | servidor/módulo |
| `tests/apis-ui.mjs` | 7 | interface (Playwright) |
| `tests/apis.mjs` | 13 | servidor/módulo |
| `tests/console-tabs.mjs` | 0 | interface (Playwright) |
| `tests/deployed.mjs` | 6 | interface (Playwright) |
| `tests/evidence.mjs` | 17 | servidor/módulo |
| `tests/fase3c.mjs` | 28 | servidor/módulo |
| `tests/fase3d.mjs` | 18 | servidor/módulo |
| `tests/flow.mjs` | 0 | interface (Playwright) |
| `tests/graph.mjs` | 13 | servidor/módulo |
| `tests/perf.mjs` | 0 | interface (Playwright) |
| `tests/real-fetch.mjs` | 0 | interface (Playwright) |
| `tests/research.mjs` | 19 | servidor/módulo |
| `tests/scale-diag.mjs` | 0 | interface (Playwright) |
| `tests/search.mjs` | 17 | interface (Playwright) |
| `tests/server.mjs` | 26 | servidor/módulo |
| `tests/shot-search.mjs` | 0 | interface (Playwright) |
| `tests/shots.mjs` | 0 | interface (Playwright) |
| `tests/shots2.mjs` | 0 | interface (Playwright) |
| `tests/smoke.mjs` | 0 | interface (Playwright) |

### Registo

- último commit: ded33c4 Estado actualizado (registo §30)
- árvore de trabalho: com alterações locais
- último bloco de resultados: §30 — FASE 3D NO SERVIÇO PÚBLICO (commit 971145a, versão 2.0.0-fase3d)
- documentação: 18 documentos (ACEITACAO.md, ACESSO-FONTES.md, AGENTES-P3.md, AGENTES.md, APIS.md, AUDITORIA-CODIGO.md, BENCHMARKS.md, DECISOES.md, ESTADO-ATUAL.md, EVIDENCIA.md, FORNECEDORES.md, GRAFO.md, IA-E-EVIDENCIA.md, MOTOR-PESQUISA.md, PERMISSOES.md, PESQUISA.md, PRIVACIDADE.md, SCHEMA.md)

### Coerência

- ✅ versão, esquema, agentes, estados, testes e documentos coerentes
<!-- /GERADO:AUTO -->

## Como verificar em 3 minutos

```bash
npm test                      # suites de servidor e módulos
npm run test:ui               # interface (Playwright)
node tools/status.mjs --check # coerência entre código e documentação
node tools/serve.mjs          # aplicação local em http://127.0.0.1:8080
```

Em produção: `https://conspiracy-aitracker.onrender.com` — `/health` devolve a versão e o commit em
execução; `/ready` diz se o armazenamento e o cofre de chaves estão operacionais.

## Funcionalidades — estado real

### Concluídas e testadas

| Área | O que faz | Prova |
| --- | --- | --- |
| Contas e sessões | registo, entrada, saída, sessões revogáveis, alteração de palavra-passe, exportação, eliminação, aceitação de política | `tests/server.mjs` 26/26 · `tests/account-ui.mjs` |
| Papéis e auditoria | USER/ADMIN, isolamento por dono, acesso administrativo com motivo, eventos registados sem segredos | `tests/server.mjs` · `docs/PERMISSOES.md` |
| Chaves de IA | 8 fornecedores, cifra AES-256-GCM, máscara, validação por chamada real, disjuntor, custos | `tests/apis.mjs` · `docs/FORNECEDORES.md` |
| Projectos | objecto de investigação completo, duplicar, arquivar, checkpoints, histórico | `tests/flow.mjs` 14/14 |
| Motor de pesquisa | 20 passos, 4 perfis de esforço, motivos de paragem, fontes consultadas | `tests/research.mjs` 19/19 · `docs/MOTOR-PESQUISA.md` |
| Registo de provas | ID único, hash, datas, excerto obrigatório, URL canónico, origem por sindicação, retirada com motivo | `tests/evidence.mjs` 17/17 |
| Conclusões | 9 estados, recusa de estados acima das provas (409), factores de corroboração | `tests/evidence.mjs` |
| Grafo | 16 tipos de entidade, 24 tipos de relação, aresta só com prova, candidatos de co-ocorrência, contradições, caminhos | `tests/graph.mjs` 13/13 |
| Filtro temporal do grafo | `periodFrom`/`periodTo`, datas validadas, períodos abertos declarados | `tests/fase3c.mjs` |
| Exportação do grafo | JSON/SVG/DOT no servidor, PNG no browser, auditoria por exportação | `tests/fase3c.mjs` |
| Acessibilidade das fontes | GET único com guardas SSRF, sem contornar barreiras, sem guardar conteúdo, não altera estados | `tests/fase3c.mjs` (8 testes) |
| 13 agentes | 6 locais + 7 de IA, contrato e limites declarados, orçamento 24 h, execuções persistidas | `tests/agents-p3.mjs` 16/16 · `docs/AGENTES-P3.md` |
| Auditor adversário | 10+ regras com gravidade e sujeito | `tests/agents-p3.mjs` |
| Caminhos com restrições | por tipo, sem inferências, por janela de datas; diz quantas arestas excluiu | `tests/fase3d.mjs` |
| Homónimos com identificador | fusão declarada, reversível, auditada; sem identificador é recusada | `tests/fase3d.mjs` |
| Memória da investigação | notas, decisões (motivo obrigatório), glossário, lacunas, correcções; append-only; exportação MD | `tests/fase3d.mjs` |
| Resumo descarregável | JSON, MD, CSV (Excel pt-PT), PDF (gerador próprio, sem dependências) | `tests/fase3d.mjs` · `docs/exemplo-resumo.pdf` |
| Cópia de segurança | exportação completa sem segredos e reposição com remapeamento de identificadores | `tests/fase3d.mjs` |

### Implementadas mas não testadas em produção

- Reposição de cópias com muitos projectos (limite 50) — testado localmente, não em produção.
- PDF do resumo em produção — o gerador é o mesmo, mas só o serviço local foi inspeccionado com
  `pdfinfo`.

### Parciais

- **Agentes de IA**: o caminho existe e é testado com stub; em produção ficam `nao-executado` até
  existir uma chave de fornecedor validada (o cofre já está operacional).
- **Custos**: só se reporta o que o fornecedor reporta; chamadas sem custo são contadas à parte e o
  total é declarado como «igual ou superior».
- **Perfis de pesquisa**: medem esforço, não cobertura — a cobertura é sempre declarada ao fim.

### Não implementadas (declaradas)

- Extracção de texto de PDF e OCR (o motor detecta PDF e declara que não extrai).
- Descoberta automática de fontes a partir de uma pergunta (hoje: URLs candidatas fornecidas).
- Fila persistente com trabalhador para execuções longas (as execuções retomam, mas correm na
  mesma instância).
- Retenção automática com purga por idade e backups agendados (dependem de disco persistente).
- MFA (TOTP) — existe a estrutura do utilizador, não a verificação em dois passos.
- `frame-ancestors` restritivo — deliberadamente permissivo para o serviço poder ser embutido na
  pré-visualização; deve ser fechado quando o produto for só servido directamente.

### Bloqueadas por ambiente

- **Disco efémero no plano gratuito do Render**: os dados não sobrevivem a um deploy. Mitigação
  implementada: cópia de segurança e reposição. Solução real: disco persistente ou Postgres.
- **Nada mais bloqueia**: `APP_SECRET` e `ADMIN_EMAIL` estão configurados em produção (verificado
  em `/ready` e `/api/meta`).

## Riscos abertos, por prioridade

1. **P0 — perda de dados em deploy** (disco efémero). Mitigado, não resolvido.
2. **P1 — sem MFA** e sem verificação de email activa (o campo existe, o envio não).
3. **P2 — sem extracção de PDF/OCR**: metade das fontes primárias reais são PDF.
4. **P2 — sem fila persistente**: uma execução longa perde-se se o processo reiniciar (fica o
   registo do que aconteceu, não o trabalho).
5. **P3 — `frame-ancestors` permissivo** (ver acima).

## Memória: três camadas, para não depender de ninguém se lembrar

1. **No produto** — «Memória da investigação» por projecto (notas, decisões com motivo, lacunas,
   correcções), append-only, exportável em Markdown, e incluída no resumo PDF/JSON.
2. **No repositório** — este ficheiro, `docs/DECISOES.md` (o porquê de cada decisão) e
   `docs/TEST-RESULTS.txt` (o que foi realmente observado, com datas).
3. **Na máquina** — `tools/status.mjs` lê o código e os testes e escreve os factos do bloco
   automático; `--check` falha quando a documentação diverge do código.

## Próximos passos sugeridos (ordem de valor)

1. Ligar uma chave de fornecedor válida e correr um agente de IA real de ponta a ponta.
2. Extracção de texto de PDF (sem OCR primeiro) para o passo 8 do motor.
3. Disco persistente no Render ou Postgres — resolve o P0.
4. Fila de execuções com um trabalhador único e retoma idempotente.
5. MFA e verificação de email.
