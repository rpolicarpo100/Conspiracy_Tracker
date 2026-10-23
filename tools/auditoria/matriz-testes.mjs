/* Corre cada ficheiro de `npm test` isoladamente. Um ficheiro que não arranca
   passa despercebido numa cadeia `a && b && c`: aqui fica com código de saída
   próprio. Escreve /tmp/matriz.json. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import pkg from '../../package.json' with { type: 'json' };

const ficheiros = [...new Set([...String(pkg.scripts.test).matchAll(/node (tests\/[\w.-]+\.mjs)/g)].map((m) => m[1]))];
const linhas = [];
for (const f of ficheiros) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [f], { encoding: 'utf8', timeout: 600000, env: process.env });
  const out = String(r.stdout || '') + String(r.stderr || '');
  const pass = (out.match(/^PASS /gm) || []).length;
  const fail = (out.match(/^(FAIL|FALHA) /gm) || []).length;
  linhas.push({ ficheiro: f, pass, fail, ms: Date.now() - t0, code: r.status, ok: r.status === 0 && fail === 0 });
  console.log((linhas.at(-1).ok ? 'OK   ' : 'FALHA') + ' ' + f.padEnd(34) + ' pass=' + pass + ' fail=' + fail);
}
fs.writeFileSync('/tmp/matriz.json', JSON.stringify(linhas, null, 2));
const t = linhas.reduce((s, x) => s + x.pass, 0);
console.log('\n' + linhas.length + ' ficheiros · ' + t + ' PASS · ' + linhas.reduce((s, x) => s + x.fail, 0) + ' FAIL · ' + linhas.filter((x) => !x.ok).length + ' ficheiros com código ≠ 0');
