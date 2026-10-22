/* =====================================================================
   FASE 3E — documentos, texto de PDF e revisão humana.

   O que se testa é sobretudo o que NÃO pode acontecer:
   · nenhuma prova nasce de uma extracção automática;
   · um PDF cifrado não é aberto e um digitalizado não é inventado (sem OCR);
   · uma fonte inacessível fica registada como inacessível, não desaparece;
   · o texto extraído não viaja inteiro no detalhe do projecto (só a pedido);
   · extractos e documentos de outra conta dão 404, não 403;
   · a recolha tem tecto por hora e recusa endereços privados (SSRF);
   · o passo 8 do motor declara o método de extracção e a revisão obrigatória.

   O PDF usado é real (tests/fixtures/relatorio-chromium.pdf, gerado pelo
   motor do Chromium). O `fetchDoc` é injectado para servir esse ficheiro:
   nenhum teste depende da internet nem de terceiros.
   ===================================================================== */
import './_env.mjs';   // opt-in explícito: registo aberto só nos testes (ver tests/_env.mjs)
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { createApi, fetchDocument, localFetchAllowed } from '../server/api.mjs';
import { createStore } from '../server/store.mjs';
import { runResearch, STEPS } from '../server/research.mjs';

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { const d = await fn(); pass++; console.log('PASS ' + name + (d ? ' → ' + d : '')); }
  catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

const PDF = fs.readFileSync('tests/fixtures/relatorio-chromium.pdf');
const HASH = crypto.createHash('sha256').update(PDF).digest('hex');

/* ---------- recolha injectada: o mesmo contrato que a recolha real ---------- */
const fakeFetch = async (url) => {
  const u = new URL(url);
  if (u.pathname === '/relatorio.pdf') {
    const { extractPdfText } = await import('../server/pdftext.mjs');
    const ex = extractPdfText(PDF);
    return {
      ok: true, status: 200, kind: 'pdf', finalUrl: url, bytes: PDF.length, hash: HASH,
      text: ex.text,
      extraction: { method: ex.method, pages: ex.pages, chars: ex.chars, usedToUnicode: ex.usedToUnicode,
        streams: ex.streams, imageOnly: false, encrypted: false, streamFailures: 0,
        warnings: ex.warnings, needsHumanReview: true },
      error: null
    };
  }
  if (u.pathname === '/pagina') {
    return {
      ok: true, status: 200, kind: 'html', finalUrl: url, bytes: 220, hash: 'b'.repeat(64),
      text: 'Comunicado da empresa: o apoio foi confirmado em 2019.',
      extraction: { method: 'html-sem-marcacao', needsHumanReview: true, warnings: [] }, error: null
    };
  }
  if (u.pathname === '/cifrado.pdf') {
    return {
      ok: false, status: 200, kind: 'pdf', finalUrl: url, bytes: 900, hash: 'c'.repeat(64), text: '',
      extraction: { method: 'nenhum', encrypted: true, needsHumanReview: true,
        warnings: ['documento cifrado: a extracção parou em vez de tentar quebrar a protecção'],
        reason: 'PDF protegido por cifra: não se extrai texto (não se contorna protecção)' },
      error: 'PDF protegido por cifra: não se extrai texto (não se contorna protecção)'
    };
  }
  return { ok: false, status: 404, kind: 'html', finalUrl: url, bytes: 0, hash: null, text: '', error: 'HTTP 404' };
};

const DIR = '/tmp/vn-3e-' + crypto.randomBytes(4).toString('hex');
const api = await createApi({
  dataDir: DIR, appSecret: 'segredo-de-teste-fase3e-1234567890',
  adminEmail: 'admin@exemplo.pt', secure: false, fetchDoc: fakeFetch
});
const server = http.createServer((req, res) => api.handle(req, res, new URL(req.url, 'http://127.0.0.1')));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

function session() {
  let cookie = '', csrf = '';
  async function call(method, path, body, opts) {
    const headers = { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    if (csrf && !(opts && opts.noCsrf)) headers['x-csrf-token'] = csrf;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
      const [pair] = c.split(';'); const [k, v] = pair.split('=');
      if (k === 'vn_sid') cookie = 'vn_sid=' + v;
      if (k === 'vn_csrf') { csrf = v; cookie += '; vn_csrf=' + v; }
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* não JSON */ }
    return { status: res.status, json, text };
  }
  return { call, get csrf() { return csrf; } };
}

async function signup(ses, email) {
  const r = await ses.call('POST', '/api/auth/register', { email, password: 'Segredo-forte-2026!', acceptTerms: true });
  ok(r.status === 201 || r.status === 200, 'registo falhou: ' + r.status + ' ' + r.text.slice(0, 120));
  return r.json.user;
}

/* ---------- 1. guardas da recolha (função real, sem injecção) ---------- */
await t('recolha real: recusa endereço privado e loopback (SSRF)', async () => {
  for (const u of ['http://127.0.0.1:9/x', 'http://localhost/x', 'http://10.0.0.1/x', 'http://169.254.169.254/latest/meta-data/']) {
    const r = await fetchDocument(u);
    ok(!r.ok, 'aceitou ' + u);
    ok(/SSRF|privado/i.test(r.error), u + ' → ' + r.error);
  }
  return '4 endereços internos recusados antes de qualquer pedido';
});

await t('recolha real: recusa protocolos que não são http(s)', async () => {
  const r1 = await fetchDocument('file:///etc/passwd');
  const r2 = await fetchDocument('ftp://exemplo.pt/x.pdf');
  ok(!r1.ok && /só http/.test(r1.error), r1.error);
  ok(!r2.ok && /só http/.test(r2.error), r2.error);
  return 'file:// e ftp:// recusados';
});

await t('recolha real: URL inválida não lança excepção', async () => {
  const r = await fetchDocument('não é um url');
  ok(!r.ok && /inválida/i.test(r.error), r.error);
  return r.error;
});

await t('excepção de leitura local: fechada por omissão e fechada em produção', async () => {
  const antes = { local: process.env.VN_ALLOW_LOCAL_FETCH, env: process.env.NODE_ENV, render: process.env.RENDER };
  try {
    delete process.env.VN_ALLOW_LOCAL_FETCH; delete process.env.NODE_ENV; delete process.env.RENDER;
    ok(localFetchAllowed() === false, 'sem variável não devia permitir');
    process.env.VN_ALLOW_LOCAL_FETCH = '1';
    ok(localFetchAllowed() === true, 'em teste local devia permitir');
    process.env.RENDER = 'true';
    ok(localFetchAllowed() === false, 'no Render não pode permitir');
    delete process.env.RENDER;
    process.env.NODE_ENV = 'production';
    ok(localFetchAllowed() === false, 'em produção não pode permitir');
    const r = await fetchDocument('http://127.0.0.1:' + server.address().port + '/x');
    ok(!r.ok && /SSRF|privado/i.test(r.error), 'a guarda não voltou a fechar: ' + JSON.stringify(r).slice(0, 120));
  } finally {
    if (antes.local === undefined) delete process.env.VN_ALLOW_LOCAL_FETCH; else process.env.VN_ALLOW_LOCAL_FETCH = antes.local;
    if (antes.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = antes.env;
    if (antes.render === undefined) delete process.env.RENDER; else process.env.RENDER = antes.render;
  }
  return 'fechada por omissão, aberta só em teste local, fechada com RENDER/NODE_ENV=production';
});

/* ---------- 2. fluxo completo: recolher, ler, revisto, remover ---------- */
const admin = session();
let adminUser = null, project = null;

await t('registo do administrador e criação do projecto', async () => {
  adminUser = await signup(admin, 'admin@exemplo.pt');
  ok(adminUser.role === 'ADMIN', 'primeiro registo devia ser ADMIN, veio ' + adminUser.role);
  const r = await admin.call('POST', '/api/projects', { title: 'Caso do PDF', question: 'O apoio de 250 000 euros existiu?' });
  ok(r.status === 201, 'projecto: ' + r.status + ' ' + r.text.slice(0, 120));
  project = r.json.project;
  return project.id;
});

let docPdf = null;

await t('recolher PDF: extrai texto, declara método e exige revisão', async () => {
  const r = await admin.call('POST', '/api/projects/' + project.id + '/documents', { url: 'https://exemplo.pt/relatorio.pdf' });
  ok(r.status === 201, 'estado ' + r.status + ' ' + r.text.slice(0, 200));
  ok(r.json.ok === true, 'devia obter o documento');
  const ex = r.json.extraction;
  ok(ex.method === 'texto-extraído', 'método ' + ex.method);
  ok(ex.pages === 2, 'páginas ' + ex.pages);
  ok(ex.usedToUnicode >= 1, 'sem ToUnicode: ' + ex.usedToUnicode);
  ok(ex.needsHumanReview === true, 'devia exigir revisão humana');
  ok(r.json.document.hash === HASH, 'hash do ficheiro não corresponde');
  ok(r.json.document.reviewed === false, 'não devia nascer revisto');
  ok(r.json.revisaoObrigatoria, 'falta a instrução de revisão');
  ok(!('text' in r.json.document), 'a resposta não deve arrastar o texto todo');
  docPdf = r.json.document;
  return ex.pages + ' páginas, ' + r.json.document.textChars + ' caracteres, hash ' + HASH.slice(0, 12) + '…';
});

await t('a recolha NÃO cria provas', async () => {
  const r = await admin.call('GET', '/api/projects/' + project.id + '/evidence');
  ok(r.json.count === 0, 'apareceram ' + r.json.count + ' provas sem ninguém as registar');
  return '0 provas após recolher o documento';
});

await t('detalhe do projecto leva só pré-visualização (não o texto inteiro)', async () => {
  const r = await admin.call('GET', '/api/projects/' + project.id);
  const d = r.json.project.documents[0];
  ok(d, 'documento ausente do detalhe');
  ok(d.text === undefined, 'o detalhe traz o texto inteiro');
  ok(typeof d.preview === 'string' && d.preview.length <= 300, 'pré-visualização com ' + String(d.preview).length);
  ok(d.textChars > 400, 'textChars ' + d.textChars);
  return 'pré-visualização de ' + d.preview.length + ' caracteres, ' + d.textChars + ' no total';
});

await t('texto do documento, a pedido: legível e com avisos', async () => {
  const r = await admin.call('GET', '/api/documents/' + docPdf.id);
  ok(r.status === 200, 'estado ' + r.status);
  const txt = r.json.document.text;
  ok(/Relatório de teste/.test(txt), 'falta «Relatório de teste»');
  ok(/250 000 euros/.test(txt), 'falta «250 000 euros»');
  ok(/Segunda página/.test(txt), 'falta «Segunda página»');
  ok(r.json.document.extraction.warnings.some((w) => /revisão humana/i.test(w)), 'faltam os avisos da extracção');
  return txt.split('\n')[0];
});

await t('marcar como revisto fica registado (sem alterar o texto)', async () => {
  const r = await admin.call('PATCH', '/api/documents/' + docPdf.id, { reviewed: true, reviewNote: 'excerto confirmado no PDF' });
  ok(r.status === 200, 'estado ' + r.status);
  ok(r.json.document.reviewed === true, 'não ficou revisto');
  ok(r.json.document.reviewedAt, 'sem data de revisão');
  const g = await admin.call('GET', '/api/documents/' + docPdf.id);
  ok(g.json.document.reviewed === true && /Relatório/.test(g.json.document.text), 'a revisão alterou o texto');
  return 'revisto em ' + r.json.document.reviewedAt.slice(0, 10);
});

await t('página HTML: método declarado e texto recolhido', async () => {
  const r = await admin.call('POST', '/api/projects/' + project.id + '/documents', { url: 'https://exemplo.pt/pagina' });
  ok(r.status === 201 && r.json.ok, 'estado ' + r.status);
  ok(r.json.document.kind === 'html', 'tipo ' + r.json.document.kind);
  ok(r.json.extraction.method === 'html-sem-marcacao', 'método ' + r.json.extraction.method);
  ok(/apoio foi confirmado/.test(r.json.document.preview), 'texto não veio');
  return r.json.document.preview;
});

await t('PDF cifrado: recusado e registado como inacessível', async () => {
  const r = await admin.call('POST', '/api/projects/' + project.id + '/documents', { url: 'https://exemplo.pt/cifrado.pdf' });
  ok(r.json.ok === false, 'não devia extrair de um PDF cifrado');
  ok(r.json.extraction.encrypted === true, 'não marcou cifrado');
  ok(r.json.document.ok === false, 'documento devia ficar marcado como falhado');
  ok(/cifra/i.test(r.json.document.error), 'erro: ' + r.json.document.error);
  const list = await admin.call('GET', '/api/projects/' + project.id + '/documents');
  ok(list.json.documents.some((d) => d.extraction && d.extraction.encrypted), 'a fonte cifrada desapareceu da lista');
  return r.json.document.error;
});

await t('fonte que devolve 404: fica registada como inacessível', async () => {
  const r = await admin.call('POST', '/api/projects/' + project.id + '/documents', { url: 'https://exemplo.pt/desaparecido' });
  ok(r.json.ok === false && /404/.test(r.json.document.error || ''), 'erro: ' + JSON.stringify(r.json.document.error));
  return 'HTTP 404 guardado com o endereço e a data';
});

await t('lista de documentos: pré-visualizações, sem texto inteiro', async () => {
  const r = await admin.call('GET', '/api/projects/' + project.id + '/documents');
  ok(r.status === 200 && r.json.count === 4, 'contei ' + r.json.count + ' documentos');
  ok(r.json.documents.every((d) => d.text === undefined), 'a lista traz texto');
  ok(r.json.documents.every((d) => typeof d.preview === 'string'), 'falta pré-visualização');
  ok(/não é prova/.test(r.json.nota), 'falta a nota de que o texto não é prova');
  return r.json.count + ' documentos listados';
});

/* ---------- 3. limites, CSRF e fronteira entre contas ---------- */
await t('recolha sem token CSRF é recusada', async () => {
  const r = await admin.call('POST', '/api/projects/' + project.id + '/documents', { url: 'https://exemplo.pt/pagina' }, { noCsrf: true });
  ok(r.status === 403, 'estado ' + r.status);
  return '403';
});

await t('URL em falta ou inválida é recusada com 400', async () => {
  const a = await admin.call('POST', '/api/projects/' + project.id + '/documents', {});
  const b = await admin.call('POST', '/api/projects/' + project.id + '/documents', { url: 'sem-http' });
  ok(a.status === 400, 'sem URL: ' + a.status);
  ok(b.status === 400, 'URL inválida: ' + b.status);
  return '400 nos dois casos';
});

await t('outra conta: documento e projecto inacessíveis (404, não 403)', async () => {
  const outro = session();
  await signup(outro, 'outra-pessoa@exemplo.pt');
  const g = await outro.call('GET', '/api/documents/' + docPdf.id);
  const p = await outro.call('GET', '/api/projects/' + project.id);
  const del = await outro.call('DELETE', '/api/documents/' + docPdf.id, {});
  const post = await outro.call('POST', '/api/projects/' + project.id + '/documents', { url: 'https://exemplo.pt/pagina' });
  ok(g.status === 404, 'GET documento: ' + g.status);
  ok(p.status === 404, 'GET projecto: ' + p.status);
  ok(del.status === 404, 'DELETE: ' + del.status);
  ok(post.status === 404, 'POST: ' + post.status);
  ok(!/Relatório/.test(g.text), 'a resposta revelou conteúdo');
  return '404 nos quatro pedidos, sem revelar conteúdo';
});

await t('administração: acessos e recolhas ficam em auditoria', async () => {
  const r = await admin.call('GET', '/api/admin/audit?limit=200');
  ok(r.status === 200, 'auditoria: ' + r.status);
  const types = (r.json.events || []).map((e) => e.type);
  ok(types.includes('document_fetched'), 'sem registo de recolha');
  ok(types.includes('document_reviewed'), 'sem registo de revisão');
  return [...new Set(types.filter((x) => x.startsWith('document')))].join(', ');
});

await t('limite por hora: a recolha para com 429 em vez de correr sem fim', async () => {
  let last = null, feitos = 0;
  for (; feitos < 42; feitos++) {
    last = await admin.call('POST', '/api/projects/' + project.id + '/documents', { url: 'https://exemplo.pt/pagina' });
    if (last.status === 429) break;
  }
  ok(last && last.status === 429, 'nunca devolveu 429 (último ' + (last && last.status) + ')');
  ok(/demasiadas recolhas/i.test(last.json.error.message), last.json.error.message);
  return '429 ao fim de ' + (feitos + 1) + ' recolhas na mesma hora';
});

/* ---------- 4. remoção do documento ---------- */
await t('remover documento: sai da lista e o registo de provas não é tocado', async () => {
  const antes = await admin.call('GET', '/api/projects/' + project.id + '/evidence');
  const r = await admin.call('DELETE', '/api/documents/' + docPdf.id, {});
  ok(r.status === 200, 'estado ' + r.status);
  const depois = await admin.call('GET', '/api/documents/' + docPdf.id);
  ok(depois.status === 404, 'ainda existe: ' + depois.status);
  const ev = await admin.call('GET', '/api/projects/' + project.id + '/evidence');
  ok(ev.json.count === antes.json.count, 'o número de provas mudou');
  return 'documento removido; provas inalteradas (' + ev.json.count + ')';
});

/* ---------- 5. o passo 8 do motor declara a extracção ---------- */
await t('passo 8 do motor regista método, páginas e revisão obrigatória', async () => {
  const store = await createStore('/tmp/vn-3e-run-' + crypto.randomBytes(3).toString('hex')).init();
  const u = await store.createUser({ email: 'motor-pdf@ex.pt', passwordHash: 'x', salt: 'y' });
  const p = await store.createProject(u.id, { title: 'Caso com PDF', question: 'O apoio existiu?' });
  /* os passos 1–7 são de IA e não há chave neste teste: entram já concluídos,
     para se testar só o passo 8 (recolha), que é local. Nada é simulado
     sobre o resultado: o passo 8 corre a sério com a recolha injectada. */
  const feitos = STEPS.filter((x) => x.n < 8).map((x) => ({
    n: x.n, id: x.id, phase: x.phase, title: x.title, kind: x.kind,
    status: 'concluido', output: [], counts: { itens: 0 }
  }));
  const run = await store.createRun(p.id, {
    profile: 'rapida', userId: u.id, createdBy: u.id, steps: feitos, step: 7,
    budget: { maxCalls: 5, maxDocuments: 3, maxMinutes: 5, maxCost: 0 },
    candidates: { urls: ['https://exemplo.pt/relatorio.pdf'] }
  });
  const out = await runResearch({ store, ai: null, fetchDoc: fakeFetch }, run.id, { ai: null });
  const step = (out.run.steps || []).find((s) => s.id === 'recolher');
  ok(step, 'passo 8 ausente');
  ok(step.output && step.output.length === 1, 'saída do passo 8 vazia');
  const d = step.output[0];
  ok(d.kind === 'pdf', 'tipo ' + d.kind);
  ok(d.extraction && d.extraction.pages === 2, 'páginas não registadas');
  ok(d.extraction.needsHumanReview === true, 'não exige revisão');
  ok(d.hash && d.hash.length === 64, 'hash ausente');
  return d.kind + ' · ' + d.extraction.pages + ' páginas · ' + d.extraction.method;
});

/* ---------- fecho ---------- */
server.close();
await api.close();
console.log('\n' + pass + ' testes passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
