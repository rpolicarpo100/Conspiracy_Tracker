/* Latência das leituras principais com um corpus sintético: 300 provas e 100
   relações num projecto. Serve para medir ANTES e DEPOIS (fases G). */
process.env.REGISTER_OPEN = 'true';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../../server/api.mjs';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-'));
const api = await createApi({ dataDir: DIR, appSecret: 'x'.repeat(32), secure: false });
const srv = http.createServer((q, r) => api.handle(q, r, new URL(q.url, 'http://x')));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const B = 'http://127.0.0.1:' + srv.address().port;
let cookie = ''; let csrf = '';
const call = async (m, p, b) => {
  const h = { 'content-type': 'application/json' };
  if (cookie) h.cookie = cookie;
  if (csrf) h['x-csrf-token'] = csrf;
  const t0 = Date.now();
  const r = await fetch(B + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
  for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) {
    const [par] = c.split(';'); const [k, v] = par.split('=');
    if (k === 'vn_sid') cookie = 'vn_sid=' + v;
    if (k === 'vn_csrf') { csrf = v; cookie = 'vn_csrf=' + v + (cookie ? '; ' + cookie : ''); }
  }
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, ms: Date.now() - t0 };
};
await call('POST', '/api/auth/register', { email: 'perf@ex.pt', password: 'SuiteForte-2026', acceptTerms: true });
const pj = await call('POST', '/api/projects', { title: 'Perf', question: 'q' });
const pid = pj.json.project.id;
const t0 = Date.now();
for (let i = 0; i < 300; i++) {
  await call('POST', '/api/projects/' + pid + '/evidence', { title: 'Prova ' + i, originalUrl: 'https://ex.pt/' + i,
    excerpt: 'Excerto número ' + i + ' sobre financiamento e contrato público.', occurredAt: '2019-01-01T00:00:00Z', stance: 'favoravel' });
}
const ids = (await call('GET', '/api/projects/' + pid + '/evidence')).json.evidence.slice(0, 100).map((e) => e.id);
for (let i = 0; i < 100; i++) {
  await call('POST', '/api/projects/' + pid + '/relations', { from: 'Entidade A' + i, to: 'Entidade B' + i,
    type: 'financed', reasoning: 'x', evidenceIds: [ids[i % ids.length]] });
}
console.log('corpus criado em ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s · 300 provas + 100 relações\n');
const m = async (rotulo, f) => { const a = await f(); console.log(rotulo.padEnd(42) + String(a.ms).padStart(5) + ' ms   HTTP ' + a.status); return a; };
await m('GET /api/projects/:id (detalhe)', () => call('GET', '/api/projects/' + pid));
await m('GET .../evidence (300 provas)', () => call('GET', '/api/projects/' + pid + '/evidence'));
await m('GET .../graph', () => call('GET', '/api/projects/' + pid + '/graph'));
await m('GET .../report', () => call('GET', '/api/projects/' + pid + '/report'));
await m('GET .../summary', () => call('GET', '/api/projects/' + pid + '/summary'));
await m('GET /api/search?q=financiamento', () => call('GET', '/api/search?q=financiamento'));
await m('GET /api/search?q=entidade a7', () => call('GET', '/api/search?q=' + encodeURIComponent('entidade a7')));
const g = await call('GET', '/api/projects/' + pid + '/graph');
console.log('\npayload do grafo: ' + (JSON.stringify(g.json).length / 1024).toFixed(0) + ' KB');
srv.close();
await new Promise((r) => setTimeout(r, 200));
try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {}
