/* Testes dos agentes de recolha, contra um servidor local controlado. */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { console, URL, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout, crypto: globalThis.crypto, performance, fetch };
vm.createContext(ctx);
vm.runInContext(readFileSync('src/core/ledger.js', 'utf8'), ctx);
vm.runInContext(readFileSync('src/core/agents.js', 'utf8'), ctx);
const VN = ctx.VN;

let hits = [];
const server = createServer((req, res) => {
  hits.push({ url: req.url, at: Date.now(), ua: req.headers['user-agent'] });
  if (req.url === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('User-agent: *\nDisallow: /proibido\nCrawl-delay: 0.2\n');
  }
  if (req.url === '/proibido/pagina') { res.writeHead(200); return res.end('não devia ser pedido'); }
  if (req.url === '/json') {
    res.writeHead(200, { 'content-type': 'application/json', etag: '"abc123"' });
    return res.end(JSON.stringify({ total: 42, items: [{ id: 7, nome: 'Contrato X' }] }));
  }
  if (req.url === '/tabela') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end('<html><body><table><tr><th>NIF</th><th>Valor</th></tr><tr><td>500000000</td><td>1 200 000</td></tr></table></body></html>');
  }
  if (req.url === '/csv') {
    res.writeHead(200, { 'content-type': 'text/csv' });
    return res.end('id;entidade;valor\n1;X, Lda;1000\n2;Y, S.A.;2000\n');
  }
  if (req.url === '/404') { res.writeHead(404); return res.end('não encontrado'); }
  if (req.url === '/grande') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('x'.repeat(3 * 1024 * 1024));
  }
  if (req.url === '/lento') { setTimeout(() => { res.writeHead(200); res.end('tarde'); }, 4000); return; }
  if (req.url === '/texto') { res.writeHead(200); return res.end('Sentença do tribunal, processo n.º 214/19.5T9VFR.'); }
  res.writeHead(200); res.end('ok');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

const L = VN.ledger.create('teste-agentes');
const runner = VN.agents.createRunner({ ledger: L, allowPrivateHosts: true, limits: { minIntervalMs: 120, timeoutMs: 1200 } });
const results = [];
const t = async (name, fn) => { try { const d = await fn(); results.push({ name, ok: true, detail: d }); } catch (e) { results.push({ name, ok: false, detail: e.message }); } };

await t('simulação por omissão: nada é pedido', async () => {
  hits = [];
  const r = await runner.run([{ id: 't1', url: base + '/json', source: 'teste' }]);
  if (hits.length) throw new Error('fez ' + hits.length + ' pedidos em simulação (nem o robots.txt deve ser pedido)');
  if (r.results[0].status !== 'simulada') throw new Error('estado ' + r.results[0].status);
  return 'estado simulada · 0 pedidos · plano com ' + r.results[0].plan.checks.length + ' verificações declaradas';
});

await t('execução real: evidência com hash SHA-256 e tipo', async () => {
  hits = [];
  const r = await runner.run([{ id: 't2', url: base + '/json', source: 'teste' }], { dryRun: false });
  const ev = r.results[0].evidence;
  if (r.results[0].status !== 'recolhida') throw new Error(r.results[0].status + ': ' + r.results[0].error);
  const expected = createHash('sha256').update(JSON.stringify({ total: 42, items: [{ id: 7, nome: 'Contrato X' }] })).digest('hex');
  if (ev.sha256 !== expected) throw new Error('hash não corresponde ao corpo recebido');
  if (!/json/.test(ev.contentType)) throw new Error('content-type não registado');
  if (!ev.etag) throw new Error('etag não registado');
  if (!/VN-Agent/.test(hits.find((h) => h.url === '/json').ua)) throw new Error('user-agent do agente não identificado');
  return 'sha256 ' + ev.sha256.slice(0, 16) + '… · ' + ev.contentLength + ' B · etag ' + ev.etag;
});

await t('robots.txt respeitado (não pede caminho proibido)', async () => {
  hits = [];
  const r = await runner.run([{ id: 't3', url: base + '/proibido/pagina', source: 'teste' }], { dryRun: false });
  const pediu = hits.some((h) => h.url === '/proibido/pagina');
  if (pediu) throw new Error('pediu o caminho proibido');
  if (r.results[0].status !== 'recusada') throw new Error('estado ' + r.results[0].status);
  return r.results[0].error;
});

await t('limite de ritmo entre pedidos ao mesmo servidor', async () => {
  hits = [];
  await runner.run([
    { id: 't4a', url: base + '/texto', source: 'teste' },
    { id: 't4b', url: base + '/csv', source: 'teste' }
  ], { dryRun: false });
  const dois = hits.filter((h) => ['/texto', '/csv'].includes(h.url));
  const delta = dois[1].at - dois[0].at;
  if (delta < 110) throw new Error('intervalo de ' + delta + ' ms (mínimo 120)');
  return delta + ' ms entre pedidos';
});

await t('HTTP 404 registado como erro de fonte', async () => {
  const r = await runner.run([{ id: 't5', url: base + '/404', source: 'teste' }], { dryRun: false });
  if (r.results[0].status !== 'erro-http') throw new Error('estado ' + r.results[0].status);
  return r.results[0].status + ' · ' + r.results[0].error;
});

await t('resposta acima do limite é rejeitada', async () => {
  const r = await runner.run([{ id: 't6', url: base + '/grande', source: 'teste' }], { dryRun: false });
  if (r.results[0].status !== 'falhou') throw new Error('estado ' + r.results[0].status);
  if (!/limite/.test(r.results[0].error)) throw new Error(r.results[0].error);
  return r.results[0].error;
});

await t('tempo limite respeitado', async () => {
  const r = await runner.run([{ id: 't7', url: base + '/lento', source: 'teste' }], { dryRun: false });
  if (r.results[0].status !== 'falhou') throw new Error('estado ' + r.results[0].status);
  if (!/tempo limite/.test(r.results[0].error)) throw new Error(r.results[0].error);
  return r.results[0].error;
});

await t('extractores: json, html-table, csv, regex', async () => {
  const r = await runner.run([
    { id: 'e1', url: base + '/json', source: 'teste', extract: { type: 'json', fields: [{ name: 'total', path: 'total' }, { name: 'primeiro', path: 'items.0.nome' }] } },
    { id: 'e2', url: base + '/tabela', source: 'teste', extract: { type: 'html-table', table: 0 } },
    { id: 'e3', url: base + '/csv', source: 'teste', extract: { type: 'csv', separator: ';', fields: [{ name: 'entidade', column: 'entidade' }] } },
    { id: 'e4', url: base + '/texto', source: 'teste', extract: { type: 'regex', pattern: '\\d{3}/\\d{2}\\.\\dT\\d[A-Z]{3}' } }
  ], { dryRun: false });
  const [a, b, c, d] = r.results.map((x) => x.extraction);
  if (a.total !== 42 || a.primeiro !== 'Contrato X') throw new Error('json: ' + JSON.stringify(a));
  if (!b.firstTable.length || b.firstTable[1][0] !== '500000000') throw new Error('tabela: ' + JSON.stringify(b));
  if (c.sample[0].entidade !== 'X, Lda') throw new Error('csv: ' + JSON.stringify(c));
  if (!d.values.length || d.values[0] !== '214/19.5T9VFR') throw new Error('regex: ' + JSON.stringify(d));
  return 'json + tabela + csv + regex correctos';
});

await t('livro de provas: entradas de recolha com hash encadeado', async () => {
  const v = await L.verify();
  const rec = L.ledger.entries.filter((e) => e.type === 'recolha');
  if (!v.ok) throw new Error('cadeia quebrada: ' + JSON.stringify(v.problems));
  if (!rec.length) throw new Error('sem entradas de recolha');
  const comHash = rec.filter((e) => e.payload && e.payload.sha256).length;
  return rec.length + ' recolhas registadas, ' + comHash + ' com SHA-256, cadeia intacta (' + L.ledger.entries.length + ' entradas)';
});

await t('endereço privado recusado quando a guarda está activa', async () => {
  const strict = VN.agents.createRunner({ allowPrivateHosts: false });
  const r = await strict.run([{ id: 'x', url: base + '/json', source: 'teste' }], { dryRun: false });
  if (r.results[0].status !== 'recusada') throw new Error('estado ' + r.results[0].status);
  return r.results[0].error;
});

await t('metadados internos (cloud metadata) recusados', async () => {
  const strict = VN.agents.createRunner({ allowPrivateHosts: false });
  const errs = strict.validateTask({ id: 'x', url: 'http://169.254.169.254/latest/meta-data/', source: 's' });
  if (!errs.length) throw new Error('aceitou endereço de metadados');
  return errs.join('; ');
});

await t('limite de pedidos por execução', async () => {
  const r = await runner.run(Array.from({ length: 25 }, (_, i) => ({ id: 'm' + i, url: base + '/texto?' + i, source: 'teste' })), { dryRun: false });
  const rec = r.results.filter((x) => x.status === 'recusada' && /limite de/.test(x.error || '')).length;
  if (!rec) throw new Error('não aplicou o limite');
  return rec + ' pedidos recusados por limite de ' + runner.LIMITS.maxRequestsPerRun;
});

await t('robots: política «api-terms» sem justificação continua recusada', async () => {
  const r = await runner.run([{ id: 'rp1', url: base + '/proibido/pagina', source: 'teste', robotsPolicy: 'api-terms' }], { dryRun: false });
  if (r.results[0].status !== 'recusada') throw new Error('estado ' + r.results[0].status);
  if (!/sem justificação/.test(r.results[0].error)) throw new Error(r.results[0].error);
  return r.results[0].error;
});

await t('robots: política «api-terms» justificada é registada, não silenciada', async () => {
  const L2 = VN.ledger.create('teste-robots');
  const r2 = VN.agents.createRunner({ ledger: L2, allowPrivateHosts: true, limits: { minIntervalMs: 20 } });
  const res = await r2.run([{ id: 'rp2', url: base + '/proibido/pagina', source: 'teste', robotsPolicy: 'api-terms', robotsJustification: 'fonte publica política própria para clientes de API (teste)' }], { dryRun: false });
  const out = res.results[0];
  if (out.status !== 'recolhida') throw new Error(out.status + ': ' + out.error);
  if (!out.robotsPolicy || out.robotsPolicy.policy !== 'api-terms') throw new Error('política não registada no resultado');
  const entry = L2.ledger.entries.find((e) => e.type === 'recolha' && e.subject === 'rp2');
  if (!entry || !entry.payload.robotsPolicy) throw new Error('política não registada no livro de provas');
  if (!/api-terms/.test(entry.note)) throw new Error('nota do livro não menciona a política');
  return 'recolhida · política e justificação guardadas no livro de provas';
});

/* ---------- agente local (proxy) ---------- */
const { handleFetchApi } = await import('../tools/fetch-api.mjs');
const proxyOpen = createServer((req, res) => handleFetchApi(req, res, { allowPrivateHosts: true })); // só para o destino local de teste
await new Promise((r) => proxyOpen.listen(0, '127.0.0.1', r));
const proxyUrl = 'http://127.0.0.1:' + proxyOpen.address().port + '/api/fetch';
const proxyStrict = createServer((req, res) => handleFetchApi(req, res)); // guardas completas (produção)
await new Promise((r) => proxyStrict.listen(0, '127.0.0.1', r));
const strictUrl = 'http://127.0.0.1:' + proxyStrict.address().port + '/api/fetch';

await t('agente local: recolha com hash verificado do lado do cliente', async () => {
  const r2 = VN.agents.createRunner({ ledger: L, transport: 'proxy', proxyUrl: proxyUrl });
  const r = await r2.run([{ id: 'p1', url: base + '/json', source: 'teste', extract: { type: 'json', fields: [{ name: 'total', path: 'total' }] } }], { dryRun: false });
  const out = r.results[0];
  if (out.status !== 'recolhida') throw new Error(out.status + ': ' + out.error);
  if (!out.viaProxy) throw new Error('não passou pelo agente local');
  if (out.evidence.sha256Agrees !== true) throw new Error('hash do cliente não coincide com o do agente');
  if (out.extraction.total !== 42) throw new Error('extracção server-side falhou');
  if ('bodyText' in out.evidence) throw new Error('corpo completo não deve ficar na evidência');
  return 'HTTP ' + out.evidence.httpStatus + ' · sha256 confirmado nos dois lados · ' + out.evidence.contentLength + ' B';
});

await t('agente local recusa endereço privado (SSRF) mesmo com pedido directo ao endpoint', async () => {
  const res = await fetch(strictUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/', source: 'x' }) });
  const data = await res.json();
  if (data.result.status !== 'recusada') throw new Error('aceitou: ' + JSON.stringify(data.result));
  return data.result.error;
});

await t('agente local respeita robots.txt do destino', async () => {
  const res = await fetch(strictUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: base + '/proibido/pagina', source: 'x' }) });
  const data = await res.json();
  if (data.result.status !== 'recusada') throw new Error('estado ' + data.result.status);
  return data.result.error;
});

/* ---------- orçamento de pedidos do agente local (antiabuso) ---------- */
const proxyBudget = createServer((req, res) => handleFetchApi(req, res, { allowPrivateHosts: true, budget: { windowMs: 60000, max: 2 } }));
await new Promise((r) => proxyBudget.listen(0, '127.0.0.1', r));
const budgetUrl = 'http://127.0.0.1:' + proxyBudget.address().port + '/api/fetch';
await t('agente local: orçamento por IP devolve 429 ao ultrapassar', async () => {
  const codes = [];
  for (let i = 0; i < 4; i++) {
    const res = await fetch(budgetUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: base + '/json', source: 'x' }) });
    codes.push(res.status);
  }
  proxyBudget.close();
  if (codes[0] !== 200 || codes[3] !== 429) throw new Error('códigos: ' + codes.join(','));
  return 'códigos ' + codes.join(' · ') + ' (2 permitidos, depois 429)';
});

proxyOpen.close(); proxyStrict.close();
server.close();
console.log('AGENTES DE RECOLHA');
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + String(r.detail).slice(0, 200));
const fails = results.filter((r) => !r.ok).length;
console.log('\n' + (results.length - fails) + '/' + results.length + ' passaram');
process.exit(fails ? 1 : 0);
