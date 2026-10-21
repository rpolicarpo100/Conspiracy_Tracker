/* Auditoria de APIs: servidor controlado (casos-limite) + catálogo real. */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { console, URL, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout, crypto: globalThis.crypto, performance, fetch };
vm.createContext(ctx);
vm.runInContext(readFileSync('src/core/agents.js', 'utf8'), ctx);
vm.runInContext(readFileSync('src/core/apis.js', 'utf8'), ctx);
const VN = ctx.VN;
const R = [];
const t = async (name, fn) => { try { R.push({ name, ok: true, detail: await fn() }); } catch (e) { R.push({ name, ok: false, detail: e.message }); } };

/* --- servidor de teste com três personalidades --- */
const T0 = Date.now();
const server = createServer((req, res) => {
  const u = req.url;
  if (u === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nAllow: /\n'); }
  if (u === '/boa') {
    res.writeHead(200, { 'content-type': 'application/json', 'strict-transport-security': 'max-age=63072000', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
    return res.end(JSON.stringify({ total: 3, data: [{ id: 'X1' }] }));
  }
  if (u === '/instavel') {
    const n = (globalThis.__n = (globalThis.__n || 0) + 1);
    if (n % 2) { res.writeHead(500, { 'content-type': 'text/plain' }); return res.end('erro'); }
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}');
  }
  if (u === '/mentiroso') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>erro interno</html>'); }
  if (u === '/espec') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      openapi: '3.0.0', info: { title: 'API de Teste', version: '1.0.0', license: { name: 'MIT' } },
      servers: [{ url: 'http://127.0.0.1:' + server.address().port }],
      paths: {
        '/items/{id}': { get: { parameters: [{ in: 'path', name: 'id', required: true }] } },
        '/saude': { get: { summary: 'estado do serviço', parameters: [] } }
      }
    }));
  }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('não encontrado');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const runner = VN.agents.createRunner({ allowPrivateHosts: true, transport: 'direct', limits: { minIntervalMs: 10, timeoutMs: 3000 } });

await t('catálogo: entradas completas e datadas', async () => {
  const need = ['id', 'name', 'group', 'url', 'licence', 'auth', 'answers', 'limits', 'usefulness', 'probe'];
  const bad = [];
  VN.apis.CATALOG.forEach((e) => need.forEach((k) => { if (e[k] == null) bad.push(e.id + '.' + k); }));
  if (bad.length) throw new Error('campos em falta: ' + bad.join(', '));
  if (!VN.apis.CATALOG.every((e) => /^https:\/\//.test(e.url))) throw new Error('há URLs sem TLS');
  return VN.apis.CATALOG.length + ' APIs · todas com limite declarado, licença e https';
});

await t('resposta boa → pontuações altas nas três dimensões', async () => {
  const entry = { id: 'boa', name: 'Boa', group: 'nacional', url: base + '/boa', usefulness: { score: 90, why: 'dados de teste' }, probe: { url: base + '/boa', json: true, hasPath: 'data.0.id', badUrl: base + '/inexistente' } };
  const a = await VN.apis.auditOne(entry, runner, { attempts: 2, allowHttp: true }); // servidor de teste local sem TLS
  if (a.scores.reliability < 70) throw new Error('fiabilidade ' + a.scores.reliability + ' — ' + JSON.stringify(a.reasons.reliability));
  if (a.verdict === 'rejeitada') throw new Error('rejeitou uma API saudável: ' + a.verdictWhy);
  return 'S ' + a.scores.security + ' · F ' + a.scores.reliability + ' · U ' + a.scores.usefulness + ' → ' + a.verdict;
});

await t('servidor instável é penalizado na fiabilidade (e explicado)', async () => {
  const entry = { id: 'inst', name: 'Instável', group: 'nacional', url: base + '/instavel', usefulness: { score: 60 }, probe: { url: base + '/instavel', json: true } };
  const a = await VN.apis.auditOne(entry, runner, { attempts: 3 });
  const avail = a.reasons.reliability.find((r) => r.key === 'availability');
  if (!avail || avail.points > 40 * 0.6) throw new Error('não penalizou disponibilidade: ' + JSON.stringify(avail));
  if (!/pedidos com a resposta esperada/.test(avail.text)) throw new Error('razão ilegível');
  return avail.text + ' → fiabilidade ' + a.scores.reliability;
});

await t('200 com corpo de erro não conta como estrutura válida', async () => {
  const entry = { id: 'ment', name: 'Mentiroso', group: 'nacional', url: base + '/mentiroso', usefulness: { score: 70 }, probe: { url: base + '/mentiroso', json: true, hasPath: 'total' } };
  const a = await VN.apis.auditOne(entry, runner, { attempts: 1 });
  const st = a.reasons.usefulness.find((r) => r.key === 'structure');
  if (st.points > 10) throw new Error('deu ' + st.points + ' pontos a uma resposta não interpretável');
  return st.text + ' (estrutura ' + st.points + '/20)';
});

await t('HTTP 401 com chave declarada não é tratado como avaria', async () => {
  const s3 = createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(200); return res.end('User-agent: *\nAllow: /\n'); }
    res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"chave em falta"}');
  });
  await new Promise((r) => s3.listen(0, '127.0.0.1', r));
  const b3 = 'http://127.0.0.1:' + s3.address().port;
  const entry = { id: 'k', name: 'Com chave', group: 'nacional', url: b3 + '/v1/dados', auth: 'chave', usefulness: { score: 80 }, probe: { url: b3 + '/v1/dados', json: true } };
  const a = await VN.apis.auditOne(entry, runner, { attempts: 2, allowHttp: true });
  s3.close();
  const avail = a.reasons.reliability.find((r) => r.key === 'availability');
  if (!/exige credenciais/.test(avail.text)) throw new Error('razão errada: ' + avail.text);
  if (avail.points < 20) throw new Error('penalizou como avaria (' + avail.points + ')');
  return avail.text + ' → fiabilidade ' + a.scores.reliability;
});

await t('HTTP sem TLS é penalizado na segurança', async () => {
  const entry = { id: 'http', name: 'Sem TLS', group: 'nacional', url: base + '/boa', usefulness: { score: 70 }, probe: { url: base + '/boa', json: true } };
  const a = await VN.apis.auditOne(entry, runner, { attempts: 1 });
  if (a.scores.security >= 80) throw new Error('segurança ' + a.scores.security + ' para um URL http (deveria perder os 35 pontos de TLS)');
  if (a.verdict !== 'rejeitada') throw new Error('veredicto ' + a.verdict + ' para um URL sem TLS');
  if (!a.fatal.join(' ').includes('TLS')) throw new Error('não marcou falha bloqueante de TLS: ' + JSON.stringify(a.fatal));
  return 'segurança ' + a.scores.security + ' · veredicto ' + a.verdict + ' · ' + a.verdictWhy;
});

await t('robots.txt proibitivo bloqueia a auditoria', async () => {
  const s2 = createServer((req, res) => {
    if (req.url === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nDisallow: /privado\n'); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":1}');
  });
  await new Promise((r) => s2.listen(0, '127.0.0.1', r));
  const b2 = 'http://127.0.0.1:' + s2.address().port;
  const entry = { id: 'rob', name: 'Robots', group: 'nacional', url: b2 + '/privado/dados', usefulness: { score: 80 }, probe: { url: b2 + '/privado/dados', json: true } };
  const a = await VN.apis.auditOne(entry, runner, { attempts: 1 });
  s2.close();
  if (a.verdict !== 'rejeitada') throw new Error('veredicto ' + a.verdict);
  return 'rejeitada: ' + a.verdictWhy;
});

await t('descoberta: extrai candidatos por termo sem inventar endpoints', async () => {
  const list = {
    'exemplo.com': { preferred: '1.0', versions: { '1.0': { swaggerUrl: 'https://x/exemplo.json', info: { title: 'Exemplo Contratos', description: 'contratos públicos', 'x-apisguru-categories': ['open data'] } } } },
    'outro.com': { preferred: '2.0', versions: { '2.0': { swaggerUrl: 'https://x/outro.json', info: { title: 'Outro Serviço', description: 'tempo' } } } }
  };
  const c = VN.apis.candidatesFromList(list, 'contratos', 10);
  if (c.length !== 1 || c[0].provider !== 'exemplo.com') throw new Error(JSON.stringify(c.map((x) => x.provider)));
  if (!c[0].openapiUrl) throw new Error('sem URL de especificação');
  const none = VN.apis.candidatesFromList(list, '', 10);
  return c.length + ' candidato para «contratos» · ' + none.length + ' sem termo · endpoint só a partir de swaggerUrl';
});

await t('deriveProbe escolhe GET sem parâmetros obrigatórios', async () => {
  const spec = { openapi: '3.0.0', servers: [{ url: 'https://api.exemplo.pt/v1' }], info: { title: 'T', version: '1' },
    paths: { '/a/{id}': { get: { parameters: [{ in: 'path', name: 'id', required: true }] } }, '/estado': { get: {} } },
    components: { securitySchemes: { key: { type: 'apiKey' } } } };
  const p = VN.apis.deriveProbe(spec);
  if (p.path !== '/estado') throw new Error('escolheu ' + p.path);
  if (p.url !== 'https://api.exemplo.pt/v1/estado') throw new Error('url ' + p.url);
  if (!p.requiresAuth) throw new Error('não detectou autenticação');
  return p.url + ' · auth declarada: ' + p.authTypes.join(',');
});

await t('deriveProbe: Swagger 2.0 com parâmetros no item de caminho', async () => {
  const spec = { swagger: '2.0', host: 'api.exemplo.pt', basePath: '/v2', schemes: ['https'], info: { title: 'S', version: '2' },
    paths: {
      '/doc/{documentId}': { parameters: [{ in: 'path', name: 'documentId', required: true }], get: { operationId: 'a' } },
      '/estado': { get: { operationId: 'b' } }
    } };
  const p = VN.apis.deriveProbe(spec);
  if (p.path !== '/estado') throw new Error('escolheu ' + p.path);
  if (p.url !== 'https://api.exemplo.pt/v2/estado') throw new Error('url ' + p.url);
  return 'ignorou o caminho com parâmetro obrigatório · ' + p.url;
});

await t('deriveProbe: segurança global impede sonda (não inventa pedido anónimo)', async () => {
  const spec = { openapi: '3.0.0', servers: [{ url: 'https://x.exemplo/v1' }], info: { title: 'X', version: '1' },
    security: [{ key: [] }], paths: { '/a': { get: {} } },
    components: { securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'X-Key' } } } };
  const p = VN.apis.deriveProbe(spec);
  if (p.path !== null) throw new Error('derivou ' + p.path + ' apesar de exigir chave');
  if (!p.requiresAuth || !p.authTypes.length) throw new Error('não registou a autenticação exigida');
  return 'sem pedido testável · auth: ' + p.authTypes.join(',');
});

await t('auditoria de candidato: especificação + pedido derivado', async () => {
  const cand = { provider: 'local', version: '1.0', title: 'API de Teste', description: 'teste', openapiUrl: base + '/espec', docs: null };
  const res = await VN.apis.auditCandidate(cand, VN.agents.createRunner({ allowPrivateHosts: true, transport: 'direct', limits: { minIntervalMs: 10 } }));
  if (!res.spec || res.spec.pathCount !== 2) throw new Error('especificação não lida: ' + JSON.stringify(res.spec));
  if (!res.probe || res.probe.path !== '/saude') throw new Error('pedido derivado errado: ' + JSON.stringify(res.probe));
  if (!/GET \/saude/.test(res.notes.join(' '))) throw new Error('notas: ' + res.notes.join(' | '));
  return 'spec ' + res.spec.pathCount + ' caminhos · pedido derivado GET /saude · estado ' + (res.audit ? res.audit.verdict : 'sem auditoria');
});

await t('entrada personalizada: validação e metadados', async () => {
  const ok = VN.apis.makeCustom({ name: 'Minha API', url: 'https://api.exemplo.pt/x?q=1' });
  if (ok.errors.length) throw new Error(ok.errors.join('; '));
  if (!ok.entry.custom || ok.entry.host !== 'api.exemplo.pt') throw new Error('metadados em falta');
  const mau = VN.apis.makeCustom({ name: '', url: 'ftp://x/y' });
  if (mau.errors.length < 2) throw new Error('não validou: ' + JSON.stringify(mau.errors));
  const comChave = VN.apis.makeCustom({ name: 'K', url: 'https://api.exemplo.pt/?api_key=abc' });
  if (!comChave.entry.keyed) throw new Error('não detectou chave na URL');
  return 'válida aceite · inválida recusada com ' + mau.errors.length + ' motivos · chave na URL detectada';
});

server.close();
console.log('APIs — NÚCLEO');
for (const r of R) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + ' → ' + String(r.detail).slice(0, 190));
const fails = R.filter((r) => !r.ok).length;
console.log('\n' + (R.length - fails) + '/' + R.length + ' passaram');
process.exit(fails ? 1 : 0);
