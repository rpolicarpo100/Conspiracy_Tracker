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
const SO_GRATUITOS = temFlag('free-only');

const catalogo = await (await fetch('https://models.dev/api.json', { headers: { accept: 'application/json' } })).json();
const todos = Object.values(catalogo).filter((p) => p && p.id && p.api && /^https:\/\//.test(String(p.api)));
const comGratis = todos.filter((p) => Object.values(p.models || {}).some((m) => m && m.cost && Number(m.cost.input) === 0 && Number(m.cost.output) === 0));
const alvos = (SO_GRATUITOS ? comGratis : todos).slice(0, LIMITE);

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
