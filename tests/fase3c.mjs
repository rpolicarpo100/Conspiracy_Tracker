/* =====================================================================
   FASE 3C — filtro temporal do grafo, exportação e acessibilidade das fontes.

   O que se testa é sobretudo o que estas funcionalidades RECUSAM:
   · o verificador de acesso não vai a endereços internos (SSRF), não segue
     esquemas estranhos, não segue redireccionamentos para a rede local;
   · paywall/CAPTCHA/403 não são «acessíveis» nem tentados por outro caminho;
   · verificar acesso NÃO muda o estado de validação de nenhuma prova;
   · o filtro temporal não esconde relações sem período (conta-as à parte);
   · a exportação leva a proveniência e os avisos, e fica registada na auditoria;
   · o orçamento de agentes pára antes de executar e diz quando reinicia;
   · outra conta não exporta nem verifica provas alheias.
   ===================================================================== */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import { checkAccess, isBlockedAddress, validateTarget, accessSuggestion } from '../server/access.mjs';
import { graphToSvg, graphToDot, layoutDeterministic } from '../server/graph-export.mjs';
import { buildGraph, periodWindow, relationInWindow } from '../server/graph.mjs';
import { quotaState, QUOTAS } from '../server/agents.mjs';

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { const d = await fn(); pass++; console.log('PASS ' + name + (d ? ' → ' + d : '')); }
  catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

/* ---------------- servidor local para o teste ponta a ponta ---------------- */
const PORT = 9100 + Math.floor(Math.random() * 90);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = '/tmp/vn-3c-' + crypto.randomBytes(4).toString('hex');
const srv = spawn(process.execPath, ['tools/serve.mjs'], {
  cwd: process.cwd(),
  env: Object.assign({}, process.env, {
    PORT: String(PORT), DATA_DIR: DATA, APP_SECRET: 'segredo-de-teste-fase3c-1234567890',
    ADMIN_EMAIL: 'c3-a@exemplo.pt', REGISTER_MAX: '200', LOGIN_MAX_ATTEMPTS: '200'
  }),
  stdio: 'ignore'
});
await new Promise((r) => setTimeout(r, 1700));

function session() {
  let cookie = '', csrf = '';
  async function call(method, path, body) {
    const headers = { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    if (csrf) headers['x-csrf-token'] = csrf;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
      const [pair] = c.split(';'); const [k, v] = pair.split('=');
      if (k === 'vn_sid') cookie = 'vn_sid=' + v;
      if (k === 'vn_csrf') { csrf = v; cookie += '; vn_csrf=' + v; }
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* não-JSON (exportações) */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  return {
    call,
    async register(email) {
      const r = await call('POST', '/api/auth/register', { email, password: 'SenhaForte123', acceptTerms: true });
      ok(r.status === 201, 'registo ' + r.status);
      return r.json.user;
    }
  };
}

const A = session(), B = session();
await A.register('c3-a@exemplo.pt');
await B.register('c3-b@exemplo.pt');

const prj = (await A.call('POST', '/api/projects', { title: 'Fase 3C', question: 'Quem financiou a fundação?', objective: 'mapear' })).json.project;
const pid = prj.id;

async function addEvidence(sess, over) {
  const r = await sess.call('POST', '/api/projects/' + pid + '/evidence', Object.assign({
    title: 'Documento do registo', sourceType: 'primaria', stance: 'favoravel',
    originalUrl: 'https://exemplo.pt/doc/' + crypto.randomBytes(3).toString('hex'),
    excerpt: 'A fundação recebeu 250 000 euros da empresa em 2019, segundo o registo oficial.',
    publicationDate: '2020-03-01', extractionMethod: 'manual', location: 'registo oficial'
  }, over || {}));
  ok(r.status === 201, 'prova ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160));
  return r.json.evidence;
}

const evA = await addEvidence(A, {});
const evB = await addEvidence(A, {
  title: 'Segunda fonte independente', originalUrl: 'https://outro-exemplo.pt/noticia',
  excerpt: 'O mesmo apoio de 250 mil euros é confirmado por uma segunda redacção.'
});

/* ======================= 1. guardas do verificador de acesso ======================= */

await t('endereços internos são reconhecidos e recusados', async () => {
  const blocked = ['127.0.0.1', '10.1.2.3', '192.168.1.10', '172.16.5.4', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1'];
  blocked.forEach((ip) => ok(isBlockedAddress(ip).blocked, 'deveria bloquear ' + ip));
  ok(!isBlockedAddress('8.8.8.8').blocked, '8.8.8.8 é público');
  ok(!isBlockedAddress('2001:4860:4860::8888').blocked, 'IPv6 público');
});

await t('esquema file:// é recusado antes de qualquer pedido', async () => {
  const r = await checkAccess('file:///etc/passwd');
  ok(r.status === 'bloqueado', 'esperava bloqueado, veio ' + r.status);
  ok(/esquema não permitido/.test(r.reason), r.reason);
});

await t('URL com credenciais incorporadas é recusada', async () => {
  const r = await checkAccess('https://user:pass@exemplo.pt/x');
  ok(r.status === 'bloqueado' && /credenciais/.test(r.reason), JSON.stringify(r).slice(0, 160));
});

await t('nome que resolve para endereço interno é recusado (SSRF por DNS)', async () => {
  const v = await validateTarget('https://interno.exemplo.pt/', { lookup: async () => [{ address: '10.0.0.7', family: 4 }] });
  ok(!v.ok && /interno|privado/i.test(v.reason), JSON.stringify(v));
});

await t('redireccionamento para a rede interna não é seguido', async () => {
  const r = await checkAccess('https://publico.exemplo.pt/artigo', {
    lookup: async (h) => [{ address: h === 'publico.exemplo.pt' ? '93.184.216.34' : '10.0.0.7', family: 4 }],
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.7/painel' } })
  });
  ok(r.status === 'bloqueado', 'estado: ' + r.status + ' razão: ' + r.reason);
  ok(r.redirects.length === 1, 'o salto ficou registado');
});

await t('HTTP 403 é «inacessível», não «acessível» e não se contorna', async () => {
  const r = await checkAccess('https://jornal.exemplo.pt/assine', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => new Response('subscreva para ler', { status: 403, headers: { 'content-type': 'text/html' } })
  });
  ok(r.status === 'inacessivel', 'estado ' + r.status);
  ok(/acesso restrito/.test(r.reason), r.reason);
  const sug = accessSuggestion(r);
  ok(sug.suggestion === 'fonte-inacessivel' && sug.requiresHuman === true, 'sugestão tem de exigir decisão humana');
});

await t('HTTP 200 é «acessível» mas não valida o conteúdo', async () => {
  const r = await checkAccess('https://exemplo.pt/doc', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } })
  });
  ok(r.status === 'acessivel' && r.httpStatus === 200, JSON.stringify(r).slice(0, 140));
  const sug = accessSuggestion(r);
  ok(sug.suggestion === null && /não valida o conteúdo/.test(sug.note), sug.note);
});

await t('tempo esgotado é reportado como inacessível com a razão', async () => {
  const r = await checkAccess('https://lento.exemplo.pt/', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    timeoutMs: 120, fetchImpl: () => new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), 20))
  });
  ok(r.status === 'inacessivel' && /tempo esgotado/.test(r.reason), r.reason);
});

await t('o corpo é cortado no limite: uma fonte não arrasta ficheiros', async () => {
  const chunk = new Uint8Array(8192);
  const stream = new ReadableStream({
    start(c) { for (let i = 0; i < 200; i++) c.enqueue(chunk); c.close(); }   // 1,6 MB
  });
  const r = await checkAccess('https://grande.exemplo.pt/f.pdf', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    maxBytes: 32768,
    fetchImpl: async () => new Response(stream, { status: 200, headers: { 'content-type': 'application/pdf' } })
  });
  ok(r.truncated === true, 'não marcou truncado');
  ok(r.bytes <= 32768 + 8192, 'bytes lidos: ' + r.bytes);
  ok(r.status === 'acessivel', r.status);
});

await t('ficheiro declarado enorme nem é transferido', async () => {
  let readStarted = false;
  const stream = new ReadableStream({ start(c) { readStarted = true; c.close(); } });
  const r = await checkAccess('https://arquivo.exemplo.pt/enorme.zip', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    maxBytes: 1024,
    fetchImpl: async () => new Response(stream, { status: 200, headers: { 'content-type': 'application/zip', 'content-length': String(500 * 1024 * 1024) } })
  });
  ok(r.downloadSkipped === true, 'não saltou a transferência');
  ok(r.bytes === 0, 'bytes: ' + r.bytes);
});

/* ======================= 2. filtro temporal ======================= */

await t('janela inválida é recusada (mês 13, 30 de Fevereiro, texto)', async () => {
  ok(!periodWindow({ from: '2020-13' }).ok, 'mês 13');
  ok(!periodWindow({ from: '2020-02-30' }).ok, '30 de Fevereiro');
  ok(!periodWindow({ from: 'ontem' }).ok, 'texto');
  ok(periodWindow({ from: '2020', to: '2021-06' }).ok, 'parcial é válido');
  ok(!periodWindow({ from: '2021', to: '2020' }).ok, 'início depois do fim');
});

await t('relação fora do período sai; relação sem período fica e é contada', async () => {
  const win = { from: '2020', to: '2020', applied: true };
  ok(relationInWindow({ from: '2021-01-01', to: '2021-12-31' }, win) === false, 'fora');
  ok(relationInWindow({ from: '2019-06-01', to: null }, win) === true, 'período aberto sobrepõe-se (não se inventa o fim)');
  ok(relationInWindow({ from: null, to: null }, win) === null, 'sem período é indeterminado');
  const g = buildGraph({
    project: { id: 'p', title: 't' },
    evidence: [{ id: 'e1', title: 'x', entities: [{ name: 'Ana' }, { name: 'Beta SA' }], stance: 'favoravel' }],
    relations: [
      { id: 'r1', from: 'Ana', to: 'Beta SA', type: 'financed', evidenceIds: ['e1'], period: { from: '2020-01-01', to: '2020-12-31' } },
      { id: 'r2', from: 'Ana', to: 'Beta SA', type: 'held_position', evidenceIds: ['e1'], period: { from: '2015-01-01', to: '2016-12-31' } },
      { id: 'r3', from: 'Beta SA', to: 'Ana', type: 'owns', evidenceIds: ['e1'], period: { from: null, to: null } }
    ],
    claims: [],
    window: win
  });
  ok(g.edges.length === 2, 'arestas: ' + g.edges.length);
  ok(g.filter.relationsExcludedByPeriod === 1, 'excluídas: ' + g.filter.relationsExcludedByPeriod);
  ok(g.filter.relationsWithoutPeriod === 1, 'sem período: ' + g.filter.relationsWithoutPeriod);
  ok(typeof g.filter.relationsOpenPeriod === 'number', 'contagem de períodos abertos');
  ok(/não podem ser excluídas/.test(g.filter.note), 'a nota explica a inclusão');
});

/* ======================= 3. exportação ======================= */

const demoGraph = {
  project: { id: 'prj-demo', title: 'Grafo de demonstração (fictício)' },
  nodes: [
    { id: 'name:ana silva', name: 'Ana Silva', type: 'person', typeLabel: 'Pessoa', color: '#38bdf8', degree: 1, evidenceIds: ['e1'] },
    { id: 'name:beta sa', name: 'Beta SA', type: 'company', typeLabel: 'Empresa', color: '#818cf8', degree: 1, evidenceIds: ['e1'] }
  ],
  edges: [{
    id: 'r1', from: 'name:ana silva', to: 'name:beta sa', fromName: 'Ana Silva', toName: 'Beta SA',
    type: 'financed', label: 'Financiou', family: 'financeiro', direction: 'directed',
    period: { from: '2019-01-01', to: '2019-12-31' }, evidenceIds: ['e1'], evidenceCount: 1,
    origins: ['src:exemplo.pt'], confidence: { level: 'uma-so-origem', rationale: 'uma só origem' },
    inferred: false, style: 'solida'
  }],
  candidates: [], stats: { nodes: 2, edges: 1, edgesCorroborated: 0, edgesWithSingleOrigin: 1, inferred: 0 },
  legend: { warnings: ['uma linha não é prova: abra a aresta para ver as provas'] },
  filter: { applied: true, from: '2019', to: '2019', relationsIncluded: 1, relationsExcludedByPeriod: 2, relationsWithoutPeriod: 1 }
};

await t('SVG exportado leva legenda, aviso de prova e filtro aplicado', async () => {
  const svg = graphToSvg(demoGraph, { width: 800, height: 500 });
  ok(svg.startsWith('<?xml'), 'cabeçalho XML');
  ok(svg.includes('uma linha não é prova'), 'aviso central');
  ok(svg.includes('Ana Silva') && svg.includes('Beta SA'), 'nós com nome');
  ok(svg.includes('Financiou'), 'rótulo da aresta');
  ok(/filtro temporal: 2019 a 2019/.test(svg), 'filtro declarado no desenho');
  ok(svg.trim().endsWith('</svg>'), 'fecha');
});

await t('SVG escapa conteúdo hostil (não injeta marcação)', async () => {
  const evil = JSON.parse(JSON.stringify(demoGraph));
  evil.nodes[0].name = '<script>alert(1)</script>';
  const svg = graphToSvg(evil, {});
  ok(!svg.includes('<script>'), 'script injectado');
  ok(svg.includes('&lt;script&gt;'), 'escapado');
});

await t('DOT leva ids de prova e estilo de inferência', async () => {
  const g2 = JSON.parse(JSON.stringify(demoGraph));
  g2.edges[0].inferred = true;
  const dot = graphToDot(g2);
  ok(dot.startsWith('digraph'), 'cabeçalho');
  ok(/evidence_ids="e1"/.test(dot), 'proveniência');
  ok(/style=dashed/.test(dot), 'inferência tracejada');
});

await t('disposição é determinística: mesmo grafo, mesmas posições', async () => {
  const a = layoutDeterministic(demoGraph.nodes, demoGraph.edges, 800, 500);
  const b = layoutDeterministic(demoGraph.nodes.slice().reverse(), demoGraph.edges, 800, 500);
  ok(Math.abs(a.get('name:ana silva').x - b.get('name:ana silva').x) < 1e-9, 'posição mudou');
});

/* ======================= 4. ponta a ponta na API ======================= */

await t('exportação JSON exige sessão e fica registada na auditoria', async () => {
  const anon = await fetch(BASE + '/api/projects/' + pid + '/graph/export?format=json');
  ok(anon.status === 401, 'sem sessão: ' + anon.status);
  const r = await A.call('GET', '/api/projects/' + pid + '/graph/export?format=json');
  ok(r.status === 200, 'exportação ' + r.status);
  ok(/attachment; filename="conspiracy-tracker-/.test(r.headers.get('content-disposition') || ''), 'descarregamento com nome');
  const body = JSON.parse(r.text);
  ok(body.warnings.length >= 3, 'avisos no ficheiro');
  ok(body.generatedBy, 'autoria da exportação');
  const audit = await A.call('GET', '/api/admin/audit');
  ok(audit.json.events.some((e) => e.type === 'graph_exported'), 'auditoria sem evento de exportação');
});

await t('formato e filtro inválidos são recusados, não ignorados', async () => {
  const a = await A.call('GET', '/api/projects/' + pid + '/graph/export?format=pdf');
  ok(a.status === 400, 'formato: ' + a.status);
  const b = await A.call('GET', '/api/projects/' + pid + '/graph?periodFrom=2020-13');
  ok(b.status === 400 && /filtro temporal/.test(b.json.error.message), 'filtro: ' + b.status);
  const c = await A.call('GET', '/api/projects/' + pid + '/graph?periodFrom=2020&periodTo=2020');
  ok(c.status === 200 && c.json.filter.applied === true, 'filtro válido aplicado');
});

await t('filtro aplicado no grafo devolve contagens e cronologia recortada', async () => {
  const r = await A.call('GET', '/api/projects/' + pid + '/graph?periodFrom=2021&periodTo=2021');
  ok(r.status === 200, r.status);
  ok(r.json.filter.applied === true && r.json.filter.from === '2021', 'janela');
  ok(r.json.timeline.filter.applied === true, 'cronologia acompanha o filtro');
  ok(typeof r.json.timeline.filter.excludedByPeriod === 'number', 'contagem de eventos fora');
});

await t('SVG e DOT saem pelos endpoints com o tipo certo', async () => {
  const svg = await A.call('GET', '/api/projects/' + pid + '/graph/export?format=svg');
  ok(svg.status === 200 && /svg/.test(svg.headers.get('content-type')), 'svg ' + svg.status);
  ok(svg.text.includes('<svg'), 'conteúdo svg');
  const dot = await A.call('GET', '/api/projects/' + pid + '/graph/export?format=dot');
  ok(dot.status === 200 && /graphviz/.test(dot.headers.get('content-type')), 'dot ' + dot.status);
  ok(dot.text.startsWith('digraph'), 'conteúdo dot');
});

await t('verificar acesso a prova alheia devolve 404 (isolamento)', async () => {
  const r = await B.call('POST', '/api/evidence/' + evA.id + '/check-access', {});
  ok(r.status === 404, 'outra conta: ' + r.status);
  const r2 = await B.call('GET', '/api/projects/' + pid + '/graph/export?format=svg');
  ok(r2.status === 404, 'exportação de projecto alheio: ' + r2.status);
});

await t('verificação de acesso guarda o estado e NÃO muda o estado da prova', async () => {
  const before = (await A.call('GET', '/api/projects/' + pid + '/evidence')).json.evidence.find((e) => e.id === evA.id);
  const r = await A.call('POST', '/api/evidence/' + evA.id + '/check-access', {});
  ok(r.status === 200, 'verificação ' + r.status);
  ok(['acessivel', 'inacessivel', 'bloqueado'].includes(r.json.check.status), 'estado: ' + r.json.check.status);
  ok(r.json.check.checkedAt, 'com data de verificação');
  const after = (await A.call('GET', '/api/projects/' + pid + '/evidence')).json.evidence.find((e) => e.id === evA.id);
  ok(after.validationState === before.validationState,
    'o estado mudou sozinho: ' + before.validationState + ' → ' + after.validationState);
  ok(after.access && after.access.status, 'estado de acesso registado');
});

await t('verificação em lote limita a 10 e conta as provas sem URL', async () => {
  const r = await A.call('POST', '/api/projects/' + pid + '/check-access', { limit: 50 });
  ok(r.status === 200, 'lote ' + r.status);
  ok(r.json.checked <= 10, 'excedeu o limite: ' + r.json.checked);
  ok(/não altera o estado/.test(r.json.note), 'nota de honestidade');
});

await t('prova retirada não é verificada', async () => {
  await A.call('DELETE', '/api/evidence/' + evB.id, { reason: 'duplicado da mesma origem' });
  const r = await A.call('POST', '/api/evidence/' + evB.id + '/check-access', {});
  ok(r.status === 409, 'retirada: ' + r.status);
});

/* ======================= 5. orçamento de agentes ======================= */

await t('quota bloqueia antes de executar e diz quando reinicia', async () => {
  const runs = [];
  for (let i = 0; i < QUOTAS.localPerAgentPerProject; i++) {
    runs.push({ projectId: 'p', agentId: 'red-team', startedAt: new Date(Date.now() - 3600e3).toISOString(), createdBy: 'u' });
  }
  const q = quotaState({ runs, userId: 'u', projectId: 'p', agentId: 'red-team' });
  ok(!q.allowed, 'deveria bloquear');
  ok(/esgotado/.test(q.reason), q.reason);
  ok(q.resetsAt && !isNaN(Date.parse(q.resetsAt)), 'reinício declarado');
});

await t('aviso antes de parar quando restam poucas execuções', async () => {
  const runs = [];
  for (let i = 0; i < QUOTAS.localPerAgentPerProject - 2; i++) {
    runs.push({ projectId: 'p', agentId: 'timeline', startedAt: new Date().toISOString(), createdBy: 'u' });
  }
  const q = quotaState({ runs, userId: 'u', projectId: 'p', agentId: 'timeline' });
  ok(q.allowed && q.remaining === 2, 'restantes: ' + q.remaining);
  ok(/restam 2/.test(q.warn || ''), 'sem aviso: ' + q.warn);
});

await t('execução real devolve o orçamento e a API recusa quando esgotado', async () => {
  const r = await A.call('POST', '/api/projects/' + pid + '/agents/timeline/run', {});
  ok(r.status === 201 && r.json.quota, 'execução ' + r.status);
  ok(r.json.quota.remaining < r.json.quota.limits.perAgentPerProject, 'contagem não desceu');
  const list = await A.call('GET', '/api/projects/' + pid + '/agent-runs');
  ok(Object.keys(list.json.quotas || {}).length === 13, 'orçamento por agente na listagem');
});

await t('meta publica a política de verificação de acesso', async () => {
  const r = await A.call('GET', '/api/meta');
  ok(r.json.accessChecks && r.json.accessChecks.states.acessivel === 'acessível', 'estados');
  ok(/sem contornar/.test(r.json.accessChecks.policy), 'política');
  ok(/^2\.0\.0-fase(3|4)/.test(r.json.version), 'versão: ' + r.json.version);
});

srv.kill('SIGKILL');
console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
