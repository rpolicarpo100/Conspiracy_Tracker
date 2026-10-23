# Ferramentas de auditoria (FASE A)

Scripts usados para produzir os números de `docs/AUDITORIA-INTEGRAL.md`,
`docs/ESTADO-FUNCIONALIDADES.md` e `docs/MATRIZ-TESTES.md`.

Não fazem parte de `npm test` nem do servidor: nenhum ficheiro de produção os
importa. Todos correm numa cópia temporária de dados (`os.tmpdir()`), nunca na
base da aplicação, e nenhum toca em produção.

| script | o que mede |
|---|---|
| `matriz-testes.mjs` | corre cada ficheiro de `npm test` isoladamente e regista PASS/FAIL, duração e código de saída |
| `fluxo-pergunta-arquivo.mjs` | fluxo completo pergunta → execução → provas → relatório, com `fetchDoc` simulado (sem rede) e reinício do processo a meio |
| `perf-carga.mjs` | latência das leituras principais com 300 provas e 100 relações |

Uso:

```bash
node tools/auditoria/matriz-testes.mjs            # escreve /tmp/matriz.json
node tools/auditoria/fluxo-pergunta-arquivo.mjs   # imprime o resultado do fluxo
node tools/auditoria/perf-carga.mjs               # imprime as latências
```
