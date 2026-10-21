/* =====================================================================
   ESTADO DO PROJECTO — gera e verifica a fotografia do que existe.

   Porque existe: nenhuma pessoa (nem nenhum assistente) deve ter de
   «lembrar-se» do que está feito. Este script lê o código e os testes e
   escreve factos; o que ele não consegue provar (decisões, prioridades)
   fica escrito à mão em docs/ESTADO-ATUAL.md.

   Uso:
     node tools/status.mjs            → mostra a fotografia
     node tools/status.mjs --write     → actualiza o bloco automático do doc
     node tools/status.mjs --check     → sai com código 1 se houver incoerência
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
const count = (s, re) => (s.match(re) || []).length;

const api = read('server/api.mjs');
const store = read('server/store.mjs');
const agents = read('server/agents.mjs');
const pkg = JSON.parse(read('package.json'));

const version = (api.match(/const APP_VERSION = '([^']+)'/) || [])[1] || 'desconhecida';
const schema = Number((store.match(/const SCHEMA_VERSION = (\d+)/) || [])[1] || 0);
const collections = (store.match(/const EMPTY = \(\) => \(\{([\s\S]*?)\}\)/) || [])[1] || '';
const collectionNames = [...collections.matchAll(/(\w+): \[\]/g)].map((m) => m[1]);
/* cada rota começa por «if (p === …» ou «if (p.match(…)» */
const routes = (api.match(/if \(p(?: ===|\.match\()/g) || []).length;
const agentList = [...agents.matchAll(/id: '([a-z-]+)', name: '[^']+', phase: '([^']+)', kind: '(local|ai)'/g)]
  .map((m) => ({ id: m[1], phase: m[2], kind: m[3] }));
const states = [...(read('server/evidence.mjs').match(/export const STATES = \[([\s\S]*?)\]/) || [])[1]?.matchAll(/'([^']+)'/g) || []]
  .map((m) => m[1]);

const testFiles = fs.readdirSync(path.join(root, 'tests')).filter((f) => f.endsWith('.mjs')).sort();
const suites = testFiles.map((f) => {
  const src = read('tests/' + f);
  return { file: f, asserts: count(src, /await t\(/g), runner: /playwright/.test(src) };
});

const git = (cmd) => { try { return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
const commit = git('git log --oneline -1');
const dirty = git('git status --porcelain');
const lastResults = (() => {
  if (!exists('docs/TEST-RESULTS.txt')) return null;
  const src = read('docs/TEST-RESULTS.txt');
  const blocks = [...src.matchAll(/== (\d+)\. ([^\n]+)/g)];
  return blocks.length ? { n: blocks[blocks.length - 1][1], title: blocks[blocks.length - 1][2] } : null;
})();

const docs = fs.readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md')).sort();

const problems = [];
if (!version || version === 'desconhecida') problems.push('versão da aplicação não encontrada em server/api.mjs');
if (schema < 1) problems.push('versão de esquema não encontrada em server/store.mjs');
if (agentList.length !== 13) problems.push('esperados 13 agentes, encontrados ' + agentList.length);
if (states.length !== 9) problems.push('esperados 9 estados, encontrados ' + states.length);
const declaredTests = (pkg.scripts.test || '').split('&&').map((x) => x.trim().replace(/^node /, ''));
declaredTests.forEach((f) => { if (!exists(f)) problems.push('script de teste aponta para ficheiro inexistente: ' + f); });
['docs/ESTADO-ATUAL.md', 'docs/DECISOES.md', 'docs/AUDITORIA-CODIGO.md', 'docs/TEST-RESULTS.txt'].forEach((d) => {
  if (!exists(d)) problems.push('documento em falta: ' + d);
});
if (exists('docs/ESTADO-ATUAL.md')) {
  const estado = read('docs/ESTADO-ATUAL.md');
  if (estado.includes('## Versão')) {
    const docVersion = (estado.match(/versão publicada: \*\*([^*]+)\*\*/) || [])[1];
    if (docVersion && docVersion !== version) problems.push('docs/ESTADO-ATUAL.md diz versão ' + docVersion + ' mas o código é ' + version);
  }
}

const generated = [
  '## Versão',
  '',
  '- versão da aplicação: **' + version + '**',
  '- esquema de dados: **v' + schema + '** · colecções: ' + collectionNames.join(', '),
  '- estados de validação: ' + states.length + ' (' + states.join(', ') + ')',
  '- agentes: ' + agentList.length + ' (' + agentList.filter((a) => a.kind === 'local').length + ' locais, ' +
    agentList.filter((a) => a.kind === 'ai').length + ' de IA)',
  '- rotas de API: ' + routes,
  '- ficheiros de teste: ' + testFiles.length + ' · blocos de teste declarados (`await t`): ' + suites.reduce((n, s) => n + s.asserts, 0) +
    ' (os ficheiros de interface usam outro executor e contam 0 aqui)',
  '',
  '### Suites',
  '',
  '| ficheiro | asserções | tipo |',
  '| --- | --- | --- |',
  ...suites.map((s) => '| `tests/' + s.file + '` | ' + s.asserts + ' | ' + (s.runner ? 'interface (Playwright)' : 'servidor/módulo') + ' |'),
  '',
  '### Registo',
  '',
  '- último commit: ' + (commit || 'sem git'),
  '- árvore de trabalho: ' + (dirty ? 'com alterações locais' : 'limpa'),
  '- último bloco de resultados: ' + (lastResults ? '§' + lastResults.n + ' — ' + lastResults.title.slice(0, 80) : 'sem registo'),
  '- documentação: ' + docs.length + ' documentos (' + docs.join(', ') + ')',
  '',
  '### Coerência',
  '',
  problems.length ? problems.map((p) => '- ❌ ' + p).join('\n') : '- ✅ versão, esquema, agentes, estados, testes e documentos coerentes',
  ''
].join('\n');

if (process.argv.includes('--write')) {
  const file = path.join(root, 'docs/ESTADO-ATUAL.md');
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('<!-- GERADO:AUTO -->');
  const end = src.indexOf('<!-- /GERADO:AUTO -->');
  if (start < 0 || end < 0) {
    console.error('marcadores GERADO:AUTO ausentes em docs/ESTADO-ATUAL.md');
    process.exit(1);
  }
  const out = src.slice(0, start) + '<!-- GERADO:AUTO -->\n' + generated + '<!-- /GERADO:AUTO -->' + src.slice(end + '<!-- /GERADO:AUTO -->'.length);
  fs.writeFileSync(file, out);
  console.log('docs/ESTADO-ATUAL.md actualizado (' + version + ', esquema v' + schema + ')');
}

if (process.argv.includes('--check')) {
  if (problems.length) { console.error('incoerências:\n- ' + problems.join('\n- ')); process.exit(1); }
  console.log('estado coerente: ' + version + ' · esquema v' + schema + ' · ' + agentList.length + ' agentes · ' + routes + ' rotas');
  process.exit(0);
}

if (!process.argv.includes('--write')) console.log(generated);
