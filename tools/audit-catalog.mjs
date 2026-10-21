/* Auditoria real do catálogo de APIs, através do agente local (/api/fetch).
   Uso: node tools/audit-catalog.mjs [--attempts=2] > resultado */
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { console, URL, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout, crypto: globalThis.crypto, performance, fetch };
vm.createContext(ctx);
vm.runInContext(readFileSync('src/core/agents.js', 'utf8'), ctx);
vm.runInContext(readFileSync('src/core/apis.js', 'utf8'), ctx);
const VN = ctx.VN;

const arg = process.argv.find((a) => a.startsWith('--attempts='));
const attempts = arg ? Number(arg.split('=')[1]) : 2;
const proxyUrl = (process.env.PROXY || 'http://127.0.0.1:8080') + '/api/fetch';
const runner = VN.agents.createRunner({ transport: 'proxy', proxyUrl: proxyUrl, limits: { minIntervalMs: 600 } });

const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const entries = VN.apis.CATALOG.filter((e) => !only || only.includes(e.id));
const started = Date.now();
const results = [];
for (const e of entries) {
  process.stderr.write('· ' + e.id.padEnd(14) + ' ');
  const a = await VN.apis.auditOne(e, runner, { attempts: attempts });
  results.push(a);
  process.stderr.write('S ' + String(a.scores.security).padStart(3) + ' F ' + String(a.scores.reliability).padStart(3) + ' U ' + String(a.scores.usefulness).padStart(3) + '  ' + a.verdict + '\n');
}
const report = {
  generatedAt: new Date().toISOString(),
  method: 'auditoria automática via agente local; 3 dimensões com pesos declarados em src/core/apis.js',
  attempts, durationMs: Date.now() - started,
  weights: VN.apis.WEIGHTS,
  results
};
writeFileSync('docs/APIS-auditoria.json', JSON.stringify(report, null, 2));
console.log('\nid              seg fia uti  veredicto   http  latência  tipo');
results.forEach((a) => {
  const lat = (a.reasons.reliability.find((r) => r.key === 'latency') || {}).text || '';
  const r0 = a.runs[0] || {};
  console.log(
    a.id.padEnd(15) + String(a.scores.security).padStart(4) + String(a.scores.reliability).padStart(5) + String(a.scores.usefulness).padStart(5) +
    '  ' + a.verdict.padEnd(11) + ' ' + String(r0.http == null ? '—' : r0.http).padStart(4) + '  ' + lat.padEnd(16) + String(r0.type || '').slice(0, 32)
  );
});
console.log('\nrelatório: docs/APIS-auditoria.json · ' + ((Date.now() - started) / 1000).toFixed(1) + ' s');
