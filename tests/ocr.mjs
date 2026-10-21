/* =====================================================================
   OCR — digitalizações lidas, com confiança declarada e sem invenções.

   Ficheiros reais usados (gerados por scripts reprodutíveis, não descarregados):
   · tests/fixtures/scan-jpeg.pdf  — página com uma imagem JPEG (DCTDecode),
     o caso normal de um digitalizado;
   · tests/fixtures/scan-flate.pdf — página com imagem RGB crua (FlateDecode),
     que obriga a construir um PNG em memória sem dependências.

   Se o motor (tesseract.js) ou os dados de língua não estiverem presentes, os
   testes NÃO fingem passar: verificam o que a aplicação promete nesse estado
   (dizer «indisponível» e nunca devolver texto inventado) e marcam os testes
   de reconhecimento como «não executados».
   ===================================================================== */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ocrStatus, ocrPdf, ocrImage, pngFromRaw, OCR_LIMITS } from '../server/ocr.mjs';
import { extractPdfText, pdfPageImages } from '../server/pdftext.mjs';

let pass = 0, fail = 0, skipped = 0;
const t = async (name, fn) => {
  try {
    const d = await fn();
    if (d === 'SKIP') { skipped++; console.log('NÃO EXECUTADO ' + name); return; }
    pass++; console.log('PASS ' + name + (d ? ' → ' + d : ''));
  } catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

const JP = 'tests/fixtures/scan-jpeg.pdf';
const FL = 'tests/fixtures/scan-flate.pdf';
const TXT = 'tests/fixtures/relatorio-chromium.pdf';

/* ---------- preparação: dados de língua locais, sem CDN ---------- */
const LANG_DIR = process.env.OCR_LANG_PATH || '/tmp/meridiano-ocr-data';
let provision = null;
if (!fs.existsSync(path.join(LANG_DIR, 'por.traineddata.gz'))) {
  try {
    execFileSync(process.execPath, ['tools/fetch-ocr-data.mjs', '--out=' + LANG_DIR], { stdio: 'ignore', timeout: 120000 });
    provision = 'dados de língua obtidos no teste (integridade npm conferida)';
  } catch (e) { provision = 'não foi possível obter dados de língua: ' + String(e.message).slice(0, 80); }
}
process.env.OCR_LANG_PATH = LANG_DIR;
const st = ocrStatus(true);
const engine = st.available;

console.log('motor: ' + st.engine + ' ' + (st.version || '?') + ' · disponível: ' + st.available +
  ' · línguas: ' + st.languages.join(',') + ' · dados: ' + st.dataSource + (provision ? ' · ' + provision : ''));

/* ---------- 1. estado declarado, sem rede ---------- */
await t('estado do OCR: motor, versão, línguas e origem dos dados', () => {
  ok(st.engine === 'tesseract.js', 'motor ' + st.engine);
  ok(Array.isArray(st.languages), 'línguas não declaradas');
  if (engine) {
    ok(st.languages.includes('por'), 'sem português: ' + st.languages.join(','));
    ok(/^local:/.test(st.dataSource), 'os dados deviam ser locais, vieram de ' + st.dataSource);
  }
  return (st.version || 'sem motor') + ' · ' + (engine ? st.languages.join('+') : st.reason.slice(0, 70));
});

await t('sem dados de língua o OCR declara-se indisponível (não vai a um CDN)', async () => {
  const antes = process.env.OCR_LANG_PATH, antesCdn = process.env.OCR_ALLOW_CDN;
  const vazio = '/tmp/ocr-vazio-' + Date.now();
  fs.mkdirSync(vazio, { recursive: true });
  process.env.OCR_LANG_PATH = vazio;
  delete process.env.OCR_ALLOW_CDN;
  try {
    const s2 = ocrStatus(true);
    ok(s2.available === false, 'disse que estava disponível sem dados');
    ok(/OCR_ALLOW_CDN|traineddata|dados de língua/i.test(s2.reason), 'razão pouco clara: ' + s2.reason);
    const r = await ocrPdf(fs.readFileSync(JP));
    ok(r.ok === false, 'reconheceu texto sem motor/dados');
    ok(r.text === '', 'devolveu texto sem motor');
    ok(/indisponível/i.test(r.reason), 'razão: ' + r.reason);
    ok(r.needsHumanReview === true, 'não exige revisão humana');
    return s2.reason.slice(0, 90);
  } finally {
    process.env.OCR_LANG_PATH = antes;
    if (antesCdn === undefined) delete process.env.OCR_ALLOW_CDN; else process.env.OCR_ALLOW_CDN = antesCdn;
    ocrStatus(true);
  }
});

/* ---------- 2. PNG construído em memória (sem dependências) ---------- */
await t('pngFromRaw: PNG válido com IHDR/IDAT/IEND e píxeis intactos', () => {
  const w = 4, h = 3;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7) % 256;
  const png = pngFromRaw({ width: w, height: h, colorSpace: 'DeviceRGB', data: raw });
  ok(png, 'devolveu null');
  ok(png.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])), 'assinatura PNG');
  ok(png.slice(12, 16).toString() === 'IHDR', 'sem IHDR');
  ok(png.readUInt32BE(16) === w && png.readUInt32BE(20) === h, 'dimensões');
  ok(png[24] === 8 && png[25] === 2, 'bits/cor');
  const idatStart = png.indexOf('IDAT') + 4;
  const len = png.readUInt32BE(idatStart - 8);
  const rows = zlib.inflateSync(png.subarray(idatStart, idatStart + len));
  ok(rows.length === (w * 3 + 1) * h, 'linhas ' + rows.length);
  for (let y = 0; y < h; y++) {
    ok(rows[y * (w * 3 + 1)] === 0, 'filtro da linha ' + y);
    ok(rows.subarray(y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1)).equals(raw.subarray(y * w * 3, (y + 1) * w * 3)), 'píxeis da linha ' + y);
  }
  return w + '×' + h + ' RGB → ' + png.length + ' B';
});

await t('pngFromRaw recusa o que não sabe representar (CMYK, dados curtos)', () => {
  const a = pngFromRaw({ width: 2, height: 2, colorSpace: 'DeviceCMYK', data: Buffer.alloc(16) });
  const b = pngFromRaw({ width: 10, height: 10, colorSpace: 'DeviceRGB', data: Buffer.alloc(10) });
  ok(a === null, 'aceitou CMYK');
  ok(b === null, 'aceitou dados insuficientes');
  return 'null nos dois casos';
});

/* ---------- 3. imagens de página ---------- */
await t('scan JPEG: uma imagem DCTDecode por página', () => {
  const r = pdfPageImages(fs.readFileSync(JP));
  ok(r.pages === 1, 'páginas ' + r.pages);
  ok(r.images.length === 1 && r.images[0].mime === 'image/jpeg', 'imagens ' + JSON.stringify(r.images.map((i) => i.mime)));
  ok(r.images[0].data.slice(0, 2).equals(Buffer.from([0xFF, 0xD8])), 'não começa com SOI de JPEG');
  ok(r.unsupported.length === 0, 'declarou ' + r.unsupported.length + ' não suportada(s)');
  return r.images[0].width + '×' + r.images[0].height + ' · ' + r.images[0].data.length + ' B';
});

await t('scan Flate: imagem crua identificada como RGB de 8 bits', () => {
  const r = pdfPageImages(fs.readFileSync(FL));
  ok(r.images.length === 1 && r.images[0].mime === 'raw', 'mime ' + (r.images[0] && r.images[0].mime));
  ok(r.images[0].colorSpace === 'DeviceRGB', 'cor ' + r.images[0].colorSpace);
  ok(r.images[0].bitsPerComponent === 8, 'bits ' + r.images[0].bitsPerComponent);
  return r.images[0].width + '×' + r.images[0].height + ' cru';
});

await t('PDF com camada de texto não é OCR: não tem imagens', () => {
  const r = pdfPageImages(fs.readFileSync(TXT));
  ok(r.images.length === 0, 'encontrou ' + r.images.length + ' imagem(ns)');
  const t1 = extractPdfText(fs.readFileSync(TXT));
  ok(t1.ok === true, 'o texto devia ser extraído normalmente');
  return 'texto extraído com /ToUnicode, 0 imagens';
});

/* ---------- 4. reconhecimento real ---------- */
await t('OCR de digitalização JPEG: texto legível e confiança medida', async () => {
  if (!engine) return 'SKIP';
  const r = await ocrPdf(fs.readFileSync(JP));
  ok(r.ok, 'falhou: ' + r.reason);
  ok(/250 000 euros/.test(r.text), 'não leu o valor: ' + JSON.stringify(r.text.slice(0, 120)));
  ok(/digitalizado/i.test(r.text), 'não leu o título');
  ok(r.confidenceAvg >= OCR_LIMITS.minConfidence, 'confiança baixa: ' + r.confidenceAvg);
  ok(r.method === 'ocr' && r.needsHumanReview === true, 'metadados do método');
  ok(r.warnings.some((w) => /OCR/.test(w)), 'falta aviso de OCR');
  return r.chars + ' caracteres · confiança ' + r.confidenceAvg + '/100 · ' + r.imagesRecognized + ' imagem';
});

await t('OCR de digitalização Flate (PNG em memória): mesmo texto', async () => {
  if (!engine) return 'SKIP';
  const r = await ocrPdf(fs.readFileSync(FL));
  ok(r.ok, 'falhou: ' + r.reason);
  ok(/250 000 euros/.test(r.text), 'não leu o valor: ' + JSON.stringify(r.text.slice(0, 120)));
  ok(r.perPage[0] && r.perPage[0].mime === 'raw', 'a página devia vir de imagem crua');
  return r.chars + ' caracteres · confiança ' + r.confidenceAvg + '/100';
});

await t('OCR de uma imagem em branco não inventa texto', async () => {
  if (!engine) return 'SKIP';
  const raw = Buffer.alloc(600 * 200 * 3, 255);
  const png = pngFromRaw({ width: 600, height: 200, colorSpace: 'DeviceRGB', data: raw });
  const r = await ocrImage(png, 'image/png');
  ok(r.ok === true, 'devia reconhecer sem erro: ' + r.reason);
  ok(String(r.text).trim().length < 12, 'inventou ' + JSON.stringify(r.text));
  return 'texto vazio (' + JSON.stringify(String(r.text).trim()) + ') · confiança ' + r.confidence;
});

await t('limite de imagens por pedido é respeitado', async () => {
  const r = await ocrPdf(fs.readFileSync(JP), { maxImages: 0 });
  ok(r.ok === false, 'processou imagens com maxImages=0');
  ok(/nenhuma imagem/i.test(r.reason), 'razão: ' + r.reason);
  return r.reason;
});

await t('imagem com assinatura errada é recusada antes de chegar ao motor', async () => {
  const r1 = await ocrImage(fs.readFileSync('tests/fixtures/scan-jpeg.pdf'), 'image/png');
  const r2 = await ocrImage(Buffer.from('nao sou uma imagem'), 'image/jpeg');
  ok(r1.ok === false && /PNG ou JPEG/.test(r1.reason), 'aceitou um PDF como imagem: ' + JSON.stringify(r1).slice(0, 100));
  ok(r2.ok === false, 'aceitou bytes arbitrários');
  return 'PDF e texto recusados com razão escrita';
});

await t('fila: um OCR de cada vez, com recusa declarada em vez de fila infinita', async () => {
  if (!engine) return 'SKIP';
  const jpeg = fs.readFileSync('tests/fixtures/scan-jpeg.pdf');
  const img = pdfPageImages(jpeg).images[0].data;
  ok(img.length > 1000, 'imagem de teste vazia');
  const jobs = [];
  for (let i = 0; i < OCR_LIMITS.maxQueue + 2; i++) jobs.push(ocrImage(img, 'image/jpeg'));
  const res = await Promise.all(jobs);
  const refused = res.filter((x) => !x.ok && /ocupado/i.test(x.reason || ''));
  ok(refused.length >= 1, 'nenhum pedido foi recusado por saturação (fila sem tecto)');
  return refused.length + ' pedido(s) recusado(s) de ' + jobs.length;
});

/* ---------- 5. integração com a recolha real (fetchDocument) ---------- */
await t('recolha real de uma digitalização: cai para OCR e declara o método', async () => {
  if (!engine) return 'SKIP';
  const http = await import('node:http');
  const { fetchDocument } = await import('../server/api.mjs');
  const pdf = fs.readFileSync(JP);
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/scan.pdf')) { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end(pdf); }
    res.writeHead(404); res.end('nao');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const antes = process.env.VN_ALLOW_LOCAL_FETCH;
  process.env.VN_ALLOW_LOCAL_FETCH = '1';
  try {
    const r = await fetchDocument('http://127.0.0.1:' + srv.address().port + '/scan.pdf');
    ok(r.ok === true, 'recolha falhou: ' + r.error);
    ok(r.kind === 'pdf', 'tipo ' + r.kind);
    ok(r.extraction.method === 'ocr', 'método ' + r.extraction.method);
    ok(/250 000 euros/.test(r.text), 'texto sem o valor: ' + JSON.stringify(r.text.slice(0, 80)));
    ok(r.extraction.needsHumanReview === true, 'sem revisão obrigatória');
    ok(r.extraction.warnings.some((w) => /OCR/.test(w)), 'sem aviso de OCR');
    ok(r.hash && r.hash.length === 64, 'sem hash');
    return r.extraction.method + ' · confiança ' + r.extraction.confidence + '/100 · ' + r.text.length + ' chars';
  } finally {
    srv.close();
    if (antes === undefined) delete process.env.VN_ALLOW_LOCAL_FETCH; else process.env.VN_ALLOW_LOCAL_FETCH = antes;
  }
});

/* ---------- 6. integração com a extração ---------- */
await t('extração de PDF de digitalizado devolve «sem camada de texto» antes do OCR', () => {
  const r = extractPdfText(fs.readFileSync(JP));
  ok(r.ok === false && r.imageOnly === true, 'não identificou digitalizado');
  ok(/OCR/.test(r.reason), 'a razão devia falar de OCR: ' + r.reason);
  return r.reason.slice(0, 80);
});

console.log('\n' + pass + ' passaram, ' + fail + ' falharam' + (skipped ? ', ' + skipped + ' não executados (sem motor ou dados)' : ''));
process.exit(fail ? 1 : 0);
