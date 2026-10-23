/* =====================================================================
   VARRIMENTO «SEM CHAVE» — que APIs de IA respondem sem credencial?

   Uso:
     node tools/keyless-scan.mjs [--limit=60] [--free-only] [--interval=400]
                                 [--confirmar] [--out=docs/APIS-sem-chave.json]

   Duas etapas, e a distinção importa:
     · etapa 1 (sempre) — GET <base>/models sem Authorization. Um 200 prova
       apenas que o CATÁLOGO de modelos é público. Não prova geração aberta.
     · etapa 2 (só com --confirmar) — POST /chat/completions com max_tokens:1,
       sem Authorization, para cada endpoint que passou a etapa 1. Só esta etapa
       pode concluir «gera sem chave». Custa 1 token ao fornecedor.

   O que faz, exactamente:
     1. lê o catálogo público models.dev (232 fornecedores) — um pedido só;
     2. escolhe os fornecedores com URL base https;
     3. faz UM pedido GET <base>/models a cada um, sem Authorization, sem cookies,
        com 8 s de limite e 400 ms entre pedidos;
     4. classifica cada resultado em «sem-chave» / «exige-chave» / «indeterminado»
        e guarda tudo em docs/APIS-sem-chave.json com data e método.

   O que NÃO faz: não contorna CAPTCHA nem paywall, não envia chaves, não
   escreve no servidor de produção, não corre no arranque da aplicação.
   ===================================================================== */
import { writeFileSync } from 'node:fs';
import { probeSemChave, probeGeracaoSemChave, KEYLESS_VERDICTS } from '../server/discovery.mjs';

const arg = (nome, omissao) => {
  const a = process.argv.find((x) => x.startsWith('--' + nome + '='));
  return a ? a.split('=').slice(1).join('=') : omissao;
};
const temFlag = (nome) => process.argv.includes('--' + nome);
const LIMITE = Number(arg('limit', '60'));
const INTERVALO = Number(arg('interval', '400'));
const OUT = arg('out', 'docs/APIS-sem-chave.json');
const MD = arg('md', '');                       /* resumo em Markdown, gerado dos dados */
const SO_IDS = String(arg('ids', '')).split(',').map((x) => x.trim()).filter(Boolean);
const SO_GRATUITOS = temFlag('free-only');

const catalogo = await (await fetch('https://models.dev/api.json', { headers: { accept: 'application/json' } })).json();
const todos = Object.values(catalogo).filter((p) => p && p.id && p.api && /^https:\/\//.test(String(p.api)));
const comGratis = todos.filter((p) => Object.values(p.models || {}).some((m) => m && m.cost && Number(m.cost.input) === 0 && Number(m.cost.output) === 0));
let alvos = (SO_GRATUITOS ? comGratis : todos);
if (SO_IDS.length) alvos = alvos.filter((p) => SO_IDS.includes(p.id));
alvos = alvos.slice(0, LIMITE);

process.stderr.write('catálogo: ' + todos.length + ' com API https · ' + comGratis.length + ' com modelos a preço 0\n');
process.stderr.write('a sondar: ' + alvos.length + ' · ' + INTERVALO + ' ms entre pedidos\n');

/* Testemunho de controlo: um endpoint que SABEMOS responder sem chave (foi
   verificado à mão). Se a sonda não o detectar, a sonda está avariada — é
   assim que se evita um «0 sem chave» falso. */
const CONTROLOS = [{ id: 'pollinations-control', name: 'Pollinations (controlo)', api: 'https://text.pollinations.ai/openai' }];
const resultados = [];
for (const p of CONTROLOS.concat(alvos)) {
  const r = await probeSemChave({ id: p.id, base: p.api }, { timeoutMs: 8000 });
  r.name = p.name || p.id;
  r.freeModels = Object.values(p.models || {}).filter((m) => m && m.cost && Number(m.cost.input) === 0 && Number(m.cost.output) === 0).length;
  r.modelsTotal = Object.keys(p.models || {}).length;
  resultados.push(r);
  process.stderr.write('· ' + String(p.id).padEnd(22).slice(0, 22) + ' ' + r.verdict.padEnd(14) + ' HTTP ' + String(r.status || '-').padEnd(4) + ' ' + String(r.ms || '-').padStart(5) + ' ms\n');
  await new Promise((res) => setTimeout(res, INTERVALO));
}

/* etapa 2: só para quem passou a etapa 1 */
const geracao = [];
if (temFlag('confirmar')) {
  const alvos2 = resultados.filter((r) => r.verdict === KEYLESS_VERDICTS.semChave);
  process.stderr.write('\netapa 2 (geração, max_tokens:1): ' + alvos2.length + ' endpoint(s)\n');
  for (const r of alvos2) {
    const g = await probeGeracaoSemChave({ id: r.id, base: r.base, firstModel: r.firstModel }, { timeoutMs: 20000 });
    geracao.push(g);
    process.stderr.write('· ' + String(r.id).padEnd(22).slice(0, 22) + ' ' + g.verdict.padEnd(16) + ' HTTP ' + String(g.status || '-') + '\n');
    await new Promise((res) => setTimeout(res, INTERVALO));
  }
}

const conta = {};
Object.values(KEYLESS_VERDICTS).forEach((v) => { conta[v] = resultados.filter((r) => r.verdict === v).length; });
const relatorio = {
  generatedAt: new Date().toISOString(),
  metodo: 'GET <base>/models sem Authorization, sem cookies; 8 s de limite; ' + INTERVALO + ' ms entre pedidos; sem contornar CAPTCHA/paywall',
  fonte: 'https://models.dev/api.json',
  limiteAplicado: LIMITE,
  resumo: conta,
  geracao: geracao.length ? {
    metodo: 'POST <base>/chat/completions com max_tokens:1 e sem Authorization',
    veredictos: geracao.reduce((a, g) => { a[g.verdict] = (a[g.verdict] || 0) + 1; return a; }, {}),
    resultados: geracao
  } : null,
  resultados
};
writeFileSync(OUT, JSON.stringify(relatorio, null, 2));

/* Resumo em Markdown gerado A PARTIR DOS DADOS, para nunca haver um documento
   escrito à mão a envelhecer ao lado de um JSON actualizado. */
if (MD) {
  const g = relatorio.geracao;
  const linhas = [];
  linhas.push('# APIs de IA «sem chave» — o que foi medido');
  linhas.push('');
  linhas.push('Relatório gerado por `node tools/keyless-scan.mjs` em **' + relatorio.generatedAt.slice(0, 10) +
    '** (' + relatorio.generatedAt + '). Dados completos: [`docs/APIS-sem-chave.json`](APIS-sem-chave.json).');
  linhas.push('');
  linhas.push('Este ficheiro é **gerado automaticamente** pelo workflow `.github/workflows/keyless-scan.yml`.');
  linhas.push('Não editar à mão: a próxima execução substitui-o.');
  linhas.push('');
  linhas.push('## Método');
  linhas.push('');
  linhas.push('| etapa | pedido | o que prova |');
  linhas.push('|---|---|---|');
  linhas.push('| 1 | `GET <base>/models`, sem `Authorization`, sem cookies, 8 s de limite | que a **lista de modelos** é pública |');
  linhas.push('| 2 (confirmar) | `POST <base>/chat/completions`, `max_tokens: 1`, sem `Authorization` | que a **geração** é aberta — só esta etapa conclui «gera sem chave» |');
  linhas.push('');
  linhas.push('Fonte dos candidatos: `https://models.dev/api.json`. Nada de CAPTCHA, paywall ou *user-agent* falsificado.');
  linhas.push('');
  linhas.push('## Resultado');
  linhas.push('');
  linhas.push('| etapa 1 — catálogo público | nº |');
  linhas.push('|---|---|');
  linhas.push('| candidatos sondados | ' + relatorio.resultados.length + ' |');
  linhas.push('| `200` na lista de modelos («sem-chave») | ' + (conta['sem-chave'] || 0) + ' |');
  linhas.push('| `401`/`403` («exige-chave») | ' + (conta['exige-chave'] || 0) + ' |');
  linhas.push('| indeterminado | ' + (conta.indeterminado || 0) + ' |');
  linhas.push('');
  if (g) {
    const geram = g.resultados.filter((x) => x.verdict === KEYLESS_VERDICTS.geraSemChave);
    const recusaram = g.resultados.filter((x) => x.verdict !== KEYLESS_VERDICTS.geraSemChave);
    linhas.push('| etapa 2 — geração sem chave | nº |');
    linhas.push('|---|---|');
    linhas.push('| endpoints confirmados na etapa 2 | ' + g.resultados.length + ' |');
    linhas.push('| **geram sem chave** | **' + geram.length + '** |');
    linhas.push('| recusaram | ' + recusaram.length + ' |');
    linhas.push('');
    if (geram.length) {
      linhas.push('### Geram sem chave (confirmado por geração real)');
      linhas.push('');
      linhas.push('| fornecedor | endpoint | modelo |');
      linhas.push('|---|---|---|');
      geram.forEach((x) => linhas.push('| ' + x.id + ' | `' + x.base + '` | `' + (x.model || '—') + '` |'));
      linhas.push('');
    }
    if (recusaram.length) {
      linhas.push('### Catálogo público mas geração fechada');
      linhas.push('');
      linhas.push('| fornecedor | HTTP |');
      linhas.push('|---|---|');
      recusaram.forEach((x) => linhas.push('| ' + x.id + ' | ' + (x.status == null ? '—' : x.status) + ' |'));
      linhas.push('');
    }
  }
  linhas.push('## Conclusão');
  linhas.push('');
  const semChave = relatorio.resultados.filter((r) => r.verdict === KEYLESS_VERDICTS.semChave).length;
  const geramN = g ? g.resultados.filter((x) => x.verdict === KEYLESS_VERDICTS.geraSemChave).length : 0;
  linhas.push(semChave === geramN
    ? 'Todos os endpoints com catálogo público confirmaram a geração sem chave.'
    : '**Uma lista de modelos pública não é uma API de geração aberta.** ' + semChave +
      ' endpoints responderam `200` na lista de modelos e apenas ' + geramN +
      ' aceitaram gerar sem credencial. A conclusão «gera sem chave» só é tirada quando há uma resposta gerada.');
  linhas.push('');
  linhas.push('O único endpoint usado pela aplicação para analisar documentos é o declarado em');
  linhas.push('`server/providers.mjs` (`pollinations`), com o prompt publicado em `docs/PRIVACIDADE.md`.');
  linhas.push('Este relatório **não** acrescenta fornecedores automaticamente: um endpoint novo exige');
  linhas.push('revisão humana e declaração de privacidade antes de receber qualquer conteúdo.');
  linhas.push('');
  writeFileSync(MD, linhas.join('\n'));
}

const sem = resultados.filter((r) => r.verdict === KEYLESS_VERDICTS.semChave);
console.log('\nsem chave (' + sem.length + '):');
sem.forEach((r) => console.log('  ' + (r.name || r.id).padEnd(28) + r.base + '  · ' + (r.modelsCount == null ? 'modelos não contados' : r.modelsCount + ' modelos')));
const geram = geracao.filter((g) => g.verdict === KEYLESS_VERDICTS.geraSemChave);
if (geracao.length) {
  console.log('\ngeram sem chave (' + geram.length + ' de ' + geracao.length + ' confirmados):');
  geram.forEach((g) => console.log('  ' + g.id + '  ' + g.base + '  · modelo ' + g.model));
  const nao = geracao.filter((g) => g.verdict !== KEYLESS_VERDICTS.geraSemChave);
  if (nao.length) console.log('  recusaram a geração sem chave: ' + nao.map((g) => g.id + '(' + g.status + ')').join(', '));
}
console.log('\netapa 1 — catálogo público: ' + conta['sem-chave'] + ' · exige chave: ' + conta['exige-chave'] + ' · indeterminados: ' + conta.indeterminado);
console.log('relatório: ' + OUT);
