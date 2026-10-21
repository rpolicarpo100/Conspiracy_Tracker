/* Verificação AO VIVO do OCR no serviço público, com conta descartável.
   Uso: node tests/ocr-publico.mjs [URL]

   Usa dois ficheiros reais do repositório, servidos pelo GitHub em HTTPS:
     · tests/fixtures/scan-jpeg.pdf        — digitalização (só imagem) → tem de cair para OCR
     · tests/fixtures/relatorio-chromium.pdf — com camada de texto → extrator nativo
   A conta é criada, usada e eliminada no fim. Nada é inventado: se a recolha falhar,
   o teste falha e diz porquê. */
const BASE = process.argv[2] || 'https://conspiracy-aitracker.onrender.com';
const EMAIL = 'ocr-live-' + Date.now().toString(36) + '@exemplo-qa.pt';
const PASSWORD = 'SenhaForte-2026!';
const SCAN = 'https://raw.githubusercontent.com/rpolicarpo100/Conspiracy_Tracker/main/tests/fixtures/scan-jpeg.pdf';
const TEXTO = 'https://raw.githubusercontent.com/rpolicarpo100/Conspiracy_Tracker/main/tests/fixtures/relatorio-chromium.pdf';
let cookie = '', csrf = '';
async function call(m, p, b) {
  const h = { 'content-type': 'application/json' };
  if (cookie) h.cookie = cookie;
  if (csrf) h['x-csrf-token'] = csrf;
  const res = await fetch(BASE + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
  (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
    const [pair] = c.split(';'); const [k, v] = pair.split('=');
    if (k === 'vn_sid') cookie = 'vn_sid=' + v;
    if (k === 'vn_csrf') { csrf = v; cookie += '; vn_csrf=' + v; }
  });
  const txt = await res.text();
  let json = null; try { json = JSON.parse(txt); } catch { /* não JSON */ }
  return { status: res.status, json, text: txt };
}
const out = [];
const ok = (c, m) => { out.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

const meta = await call('GET', '/api/meta');
ok(meta.json?.documents?.ocr?.available === true, 'serviço público declara OCR disponível · ' + meta.json?.documents?.ocr?.dataSource);
ok((meta.json?.documents?.ocr?.languages || []).join(',') === 'eng,por', 'línguas: ' + (meta.json?.documents?.ocr?.languages || []).join(','));

const reg = await call('POST', '/api/auth/register', { email: EMAIL, password: PASSWORD, acceptTerms: true });
ok(reg.status === 201 || reg.status === 200, 'conta descartável criada (' + EMAIL + ')');
const pr = await call('POST', '/api/projects', { title: 'Verificação OCR pública', description: 'conta descartável' });
const pid = pr.json?.project?.id || pr.json?.id;
ok(!!pid, 'projecto criado');

const doc = await call('POST', '/api/projects/' + pid + '/documents', { url: SCAN });
ok(doc.status === 201 || doc.status === 200, 'recolha da digitalização: HTTP ' + doc.status + ' ' + (doc.json?.error || ''));
const d = doc.json?.document || doc.json || {};
const method = d.extraction?.method;
ok(method === 'ocr', 'método de extração: ' + method);
ok(d.textChars > 0 && (d.preview || '').length > 0, 'texto presente · ' + d.textChars + ' caracteres · pré-visualização «' + String(d.preview || '').slice(0, 40) + '…»');
ok(d.extraction?.confidence > 0, 'confiança declarada: ' + d.extraction?.confidence + '/100');
ok(d.extraction?.needsHumanReview === true, 'revisão humana obrigatória');

const docs = await call('GET', '/api/projects/' + pid + '/documents');
ok(!JSON.stringify(docs.json).includes('"text"'), 'lista não devolve o texto integral');
const ev = await call('GET', '/api/projects/' + pid + '/evidence');
ok(((ev.json?.evidence || ev.json || []).length || 0) === 0, 'provas criadas automaticamente: 0');

const pdf = await call('POST', '/api/projects/' + pid + '/documents', { url: TEXTO });
ok((pdf.json?.document?.extraction?.method) === 'texto-extraído', 'PDF com camada de texto continua a usar o extrator nativo');

const del = await call('DELETE', '/api/auth/account', { password: PASSWORD });
ok(del.status === 200, 'conta descartável eliminada');
console.log(out.join('\n'));
console.log('\n' + out.filter((l) => l.startsWith('PASS')).length + '/' + out.length + ' passaram');
