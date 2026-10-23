/* Fluxo pergunta → execução → provas → relatório, sem rede: fetchDoc é
   simulado. Faz duas coisas que os testes normais não fazem:
   1) mede quanto tempo POST /api/projects/:id/runs segura a ligação HTTP;
   2) desliga e volta a ligar a API sobre o MESMO dataDir e compara o relatório
      (sem o carimbo de tempo) — é o teste de recuperação após reinício. */
process.env.REGISTER_OPEN = 'true';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApi } from '../../server/api.mjs';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxo-'));
const TEXTO = 'Autos de inquérito n.º 12/2014 do DCIAP. José Sócrates Carvalho Pinto de Sousa é arguido. '
  + 'Decisão instrutória de 2017 pronuncia o arguido. Sentença de 2021 absolveu o arguido; o Ministério Público recorreu.';
let nDocs = 0;
const fetchDoc = async (url) => {
  nDocs++;
  await new Promise((r) => setTimeout(r, 120));
  return { ok: true, kind: 'html', status: 200, bytes: TEXTO.length,
    hash: crypto.createHash('sha256').update(TEXTO).digest('hex'), text: TEXTO, finalUrl: url,
    extraction: { method: 'texto-simples', chars: TEXTO.length, confidence: 0.9 } };
};

const arrancar = async () => {
  const api = await createApi({ dataDir: DIR, appSecret: 'y'.repeat(32), secure: false, fetchDoc });
  const srv = http.createServer((q, r) => api.handle(q, r, new URL(q.url, 'http://x')));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, B: 'http://127.0.0.1:' + srv.address().port };
};

let { srv, B } = await arrancar();
let cookie = '';
let csrf = '';
const call = async (m, p, b) => {
  const h = { 'content-type': 'application/json' };
  if (cookie) h.cookie = cookie;
  if (csrf) h['x-csrf-token'] = csrf;
  const t0 = Date.now();
  const r = await fetch(B + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
  for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) {
    const [par] = c.split(';');
    const [k, v] = par.split('=');
    if (k === 'vn_sid') cookie = 'vn_sid=' + v;
    if (k === 'vn_csrf') { csrf = v; cookie = 'vn_csrf=' + v + (cookie ? '; ' + cookie : ''); }
  }
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, ms: Date.now() - t0 };
};

await call('POST', '/api/auth/register', { email: 'fluxo@ex.pt', password: 'SuiteForte-2026', acceptTerms: true });
const pj = await call('POST', '/api/projects', { title: 'Quem é José Sócrates?', question: 'Quem é José Sócrates e em que processos foi arguido?' });
const pid = pj.json.project.id;

const urls = Array.from({ length: 10 }, (_, i) => 'https://arquivo.exemplo.pt/autos/pagina-' + i);
for (const perfil of ['rapida', 'normal', 'exaustiva']) {
  const run = await call('POST', '/api/projects/' + pid + '/runs', { profile: perfil, urls });
  const r = run.json && run.json.run;
  console.log('\n[' + perfil + '] POST /runs → ' + run.status + ' em ' + (run.ms / 1000).toFixed(1) + ' s'
    + (r ? ' · status=' + r.status + ' · parou: ' + (r.stopReason || 'nada') : ''));
  if (r) {
    console.log('  detalhe: ' + String(r.stopDetail || '').slice(0, 150));
    console.log('  passos: ' + r.steps.map((s) => s.n + '.' + s.id + '=' + s.status).join(' | '));
  }
}
const docs = await call('GET', '/api/projects/' + pid + '/documents');
const ev = await call('GET', '/api/projects/' + pid + '/evidence');
const rep = await call('GET', '/api/projects/' + pid + '/report');
console.log('\ndocumentos: ' + (docs.json.documents || []).length + ' · provas: ' + (ev.json.evidence || []).length
  + ' · fetchDoc chamado ' + nDocs + ' vez(es)');

const limpar = (j) => { const c = JSON.parse(JSON.stringify(j || {})); delete (c.project || {}).generatedAt; delete c.geradoEm; return c; };
const h1 = crypto.createHash('sha256').update(JSON.stringify(limpar(rep.json))).digest('hex');
srv.close();
await new Promise((r) => setTimeout(r, 300));
({ srv, B } = await arrancar());
const rep2 = await call('GET', '/api/projects/' + pid + '/report');
const h2 = crypto.createHash('sha256').update(JSON.stringify(limpar(rep2.json))).digest('hex');
console.log('após reinício do processo: relatório ' + rep2.status + ' ' + (h1 === h2 ? 'IDÊNTICO (sem o carimbo de tempo)' : 'DIFERENTE'));
srv.close();
await new Promise((r) => setTimeout(r, 200));
try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {}
