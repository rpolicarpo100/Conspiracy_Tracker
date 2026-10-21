/* =====================================================================
   OCR DE DIGITALIZAÇÕES — tesseract.js, com regras fixas.

   Porque existe: metade das fontes primárias reais são digitalizações. Sem
   OCR, o passo 8 do motor fica com «sem camada de texto» e a investigação
   perde a fonte. Com OCR, o texto passa a existir — e passa a existir com
   ERROS, que é diferente de não existir.

   Regras que não se quebram:
   1. OCR nunca produz provas. O texto entra como texto, marcado `method: 'ocr'`,
      com a confiança medida por página e aviso de revisão humana obrigatória.
   2. Confiança baixa é declarada, não escondida: por baixo de `minConfidence`
      a página é assinalada e o resumo diz quantas páginas ficaram frágeis.
   3. Os dados de língua são LOCAIS (`OCR_LANG_PATH`). Sem dados locais e sem
      autorização explícita (`OCR_ALLOW_CDN=1`), o OCR está INDISPONÍVEL — não
      se descarrega um modelo de um CDN de terceiros a meio de um pedido.
   4. O motor corre num worker com memória limitada e um pedido de cada vez;
      um OCR não pode derrubar o processo (plano gratuito = 512 MB).
   5. Nada de shell: não há `exec`, nem caminhos interpolados em comandos.
   6. Imagem que não se consegue ler é DITA (CCITT, JBIG2, JPX, predictor),
      nunca substituída por texto inventado.
   ===================================================================== */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pdfPageImages, PDF_LIMITS } from './pdftext.mjs';

const require_ = createRequire(import.meta.url);

export const OCR_LIMITS = {
  maxImages: 6,
  maxPixels: 40e6,
  timeoutMs: 120000,
  perImageMs: 45000,
  maxChars: 120000,
  minConfidence: 55,
  maxQueue: 2
};

/* ---------------- estado do motor (sem rede) ---------------- */

const hasData = (dir) => {
  try { return fs.readdirSync(dir).some((f) => /^[a-z]{2,3}\.traineddata(\.gz)?$/.test(f)); }
  catch { return false; }
};

// Ordem: configuração explícita → dados de execução → cópia versionada no
// repositório (vendor/ocr, instalada por tools/fetch-ocr-data.mjs). A cópia
// versionada é o que faz o OCR funcionar num serviço onde não é possível mexer
// nas variáveis de ambiente — e continua a não haver rede em runtime.
function langPathOf() {
  if (process.env.OCR_LANG_PATH) return path.resolve(process.env.OCR_LANG_PATH);
  if (process.env.DATA_DIR) {
    const run = path.resolve(process.env.DATA_DIR, 'ocr');
    if (hasData(run)) return run;
  }
  const vendored = path.resolve('vendor/ocr');
  if (hasData(vendored)) return vendored;
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR, 'ocr');
  return path.resolve('data/ocr');
}

let cachedStatus = null;
export function ocrStatus(force) {
  if (cachedStatus && !force) return cachedStatus;
  const langPath = langPathOf();
  const status = {
    available: false, engine: 'tesseract.js', version: null,
    languages: [], langPath, dataSource: null, reason: null,
    limits: OCR_LIMITS
  };
  try {
    const pkgPath = require_.resolve('tesseract.js/package.json');
    status.version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
  } catch {
    status.reason = 'motor tesseract.js não está instalado; o OCR está indisponível e os PDF digitalizados ficam declarados como sem texto';
    cachedStatus = status;
    return status;
  }
  const langs = [];
  const formats = new Set();
  try {
    for (const f of fs.readdirSync(langPath)) {
      const m = f.match(/^([a-z]{2,3})\.traineddata(\.gz)?$/);
      if (m) { langs.push(m[1]); formats.add(m[2] ? 'gz' : 'plain'); }
    }
  } catch { /* pasta inexistente */ }
  if (langs.length) {
    status.languages = [...new Set(langs)].sort();
    status.langFormat = formats.has('gz') ? 'gz' : 'plain';
    status.dataSource = 'local:' + langPath;
    status.available = true;
  } else if (process.env.OCR_ALLOW_CDN === '1') {
    status.languages = ['por', 'eng'];
    status.dataSource = 'cdn (jsDelivr, autorizado por OCR_ALLOW_CDN=1)';
    status.available = true;
    status.reason = 'dados de língua vêm de um CDN de terceiros: autorizado explicitamente pela instalação';
  } else {
    status.reason = 'sem dados de língua em ' + langPath + ' — obtenha-os com ' +
      'npm run ocr:data (grava em vendor/ocr, com integridade npm) ou defina OCR_ALLOW_CDN=1 ' +
      'para aceitar o CDN de terceiros';
  }
  cachedStatus = status;
  return status;
}

/* ---------------- PNG a partir de píxeis crus (FlateDecode) ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

/* imagem crua (8 bits) → PNG; devolve null quando não é representável */
export function pngFromRaw({ width, height, colorSpace, data }) {
  const channels = colorSpace === 'DeviceRGB' ? 3 : colorSpace === 'DeviceGray' ? 1 : 0;
  if (!channels) return null;
  const stride = width * channels;
  if (!width || !height || data.length < stride * height) return null;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = colorSpace === 'DeviceRGB' ? 2 : 0;
  const rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (stride + 1)] = 0;                                   // filtro «nenhum»
    data.copy(rows, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(rows, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- fila: um OCR de cada vez ---------------- */

let running = 0;
const waiting = [];
function acquire() {
  if (running === 0) { running++; return Promise.resolve(); }
  if (waiting.length >= OCR_LIMITS.maxQueue) return Promise.reject(new Error('OCR ocupado: já há ' + running + ' pedido(s) em curso e ' + waiting.length + ' à espera'));
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else running = 0;
}

/* ---------------- reconhecimento ---------------- */

async function withWorker(languages, fn) {
  const tesseract = await import('tesseract.js');
  /* O motor lança (throw) dentro do worker quando uma imagem é ilegível; sem
     `errorHandler` isso sobe até ao processo e deita abaixo o servidor inteiro.
     Aqui o erro fica na promessa do pedido — um pedido mau não mata o serviço. */
  const workerErrors = [];
  const opts = { logger: () => {}, errorHandler: (e) => { workerErrors.push(String(e).slice(0, 200)); } };
  opts.__errors = workerErrors;
  const status = ocrStatus();
  if (status.dataSource && status.dataSource.startsWith('local:')) {
    opts.langPath = status.langPath;
    opts.gzip = status.langFormat !== 'plain';       // o motor procura <lang>.traineddata[.gz]
  }
  const worker = await tesseract.createWorker(languages.join('+'), 1, opts);
  try {
    return await fn(worker);
  } catch (e) {
    const extra = workerErrors.length ? ' (' + workerErrors[workerErrors.length - 1] + ')' : '';
    throw new Error(String(e && e.message ? e.message : e) + extra);
  } finally {
    try { await worker.terminate(); } catch { /* worker já terminou */ }
  }
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + ': tempo limite de ' + Math.round(ms / 1000) + ' s excedido')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/* reconhece uma imagem já em memória; `mime` aceite: image/png, image/jpeg */
export async function ocrImage(buffer, mime, opts) {
  const o = Object.assign({}, OCR_LIMITS, opts || {});
  const status = ocrStatus();
  if (!status.available) return { ok: false, reason: status.reason, engine: status.engine };
  /* assinatura do ficheiro tem de ser a de uma imagem: o motor é um binário WASM
     e um contentor errado faz o worker abortar em vez de devolver erro */
  const sig = buffer && buffer.length > 8 ? buffer.subarray(0, 8) : null;
  const isPng = !!sig && sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4E && sig[3] === 0x47;
  const isJpeg = !!sig && sig[0] === 0xFF && sig[1] === 0xD8 && sig[2] === 0xFF;
  if (!isPng && !isJpeg) {
    return { ok: false, reason: 'não é uma imagem PNG ou JPEG (assinatura inesperada): não se entrega ao OCR', engine: status.engine };
  }
  const languages = (o.languages && o.languages.length ? o.languages : status.languages)
    .filter((l) => status.languages.includes(l));
  if (!languages.length) return { ok: false, reason: 'nenhuma língua pedida está disponível (' + status.languages.join(', ') + ')' };
  try { await acquire(); }
  catch (e) {
    /* saturação é uma resposta, não um silêncio: devolve-se o motivo */
    return { ok: false, reason: String(e.message || e), busy: true, engine: status.engine };
  }
  const t0 = Date.now();
  try {
    const r = await withTimeout(withWorker(languages, async (worker) => {
      const { data } = await worker.recognize(buffer);
      return data;
    }), o.perImageMs, 'OCR');
    const text = String(r.text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return {
      ok: true, text, engine: status.engine, languages,
      confidence: typeof r.confidence === 'number' ? Math.round(r.confidence) : null,
      words: Array.isArray(r.words) ? r.words.length : null,
      mime, bytes: buffer.length, latencyMs: Date.now() - t0
    };
  } catch (e) {
    return { ok: false, reason: String(e.message || e).slice(0, 200), engine: status.engine, latencyMs: Date.now() - t0 };
  } finally {
    release();
  }
}

/* extrai as imagens de um PDF e reconhece-as, página a página */
export async function ocrPdf(buffer, opts) {
  const o = Object.assign({}, OCR_LIMITS, opts || {});
  const status = ocrStatus();
  const base = {
    ok: false, method: 'ocr', engine: status.engine, engineAvailable: status.available,
    pages: 0, imagesRecognized: 0, chars: 0, text: '', perPage: [],
    warnings: [], needsHumanReview: true, reason: null
  };
  if (!status.available) {
    base.reason = 'OCR indisponível: ' + status.reason;
    base.warnings.push('documento digitalizado sem camada de texto e sem OCR disponível: transcreva à mão ou active o OCR');
    return base;
  }
  const found = pdfPageImages(buffer, { maxImages: o.maxImages, maxPixels: o.maxPixels, maxBytes: PDF_LIMITS.maxBytes });
  base.pages = found.pages;
  if (!found.images.length) {
    base.reason = found.reason || (found.unsupported.length
      ? 'nenhuma imagem OCR-ável: ' + found.unsupported.map((u) => u.why).filter((v, i, a) => a.indexOf(v) === i).join('; ')
      : 'nenhuma imagem encontrada no PDF');
    base.unsupported = found.unsupported;
    return base;
  }
  const parts = [];
  let chars = 0, weak = 0, failed = 0;
  for (const img of found.images) {
    if (chars >= o.maxChars) break;
    let payload = img.data, mime = img.mime;
    if (mime === 'raw') {
      const png = pngFromRaw(img);
      if (!png) {
        base.warnings.push('página ' + img.page + ': imagem ' + img.colorSpace + ' não convertível para PNG (declarada, não adivinhada)');
        continue;
      }
      payload = png; mime = 'image/png';
    }
    const r = await ocrImage(payload, mime, { perImageMs: o.perImageMs, languages: o.languages });
    const entry = {
      page: img.page, width: img.width, height: img.height, mime: img.mime,
      ok: !!r.ok, confidence: r.ok ? r.confidence : null, chars: r.ok ? r.text.length : 0,
      reason: r.ok ? null : r.reason
    };
    if (r.ok) {
      base.imagesRecognized++;
      parts.push(r.text);
      chars += r.text.length;
      if (r.confidence != null && r.confidence < o.minConfidence) {
        weak++;
        entry.weak = true;
        base.warnings.push('página ' + img.page + ': confiança de OCR baixa (' + r.confidence + '/100) — o texto pode ter erros de leitura');
      }
    } else {
      failed++;
      base.warnings.push('página ' + img.page + ': OCR falhou (' + r.reason + ')');
    }
    base.perPage.push(entry);
  }
  const unsupportedNote = found.unsupported.length
    ? found.unsupported.length + ' imagem(ns) não suportada(s): ' + [...new Set(found.unsupported.map((u) => u.why))].join('; ')
    : null;
  if (unsupportedNote) base.warnings.push(unsupportedNote);
  base.text = parts.join('\n\n').slice(0, o.maxChars).trim();
  base.chars = base.text.length;
  base.ok = base.text.length > 0;
  base.reason = base.ok ? null : 'nenhum texto reconhecido nas imagens' + (failed ? ' (' + failed + ' falha(s))' : '');
  if (base.ok) {
    base.warnings.push('texto obtido por OCR: erros de leitura são frequentes (números, nomes e acentos) — confirme no documento antes de citar');
    if (weak) base.warnings.push(weak + ' página(s) com confiança baixa: trate o texto como pista, não como transcrição');
  }
  base.confidenceAvg = base.perPage.filter((p) => p.confidence != null).length
    ? Math.round(base.perPage.filter((p) => p.confidence != null).reduce((a, p) => a + p.confidence, 0) / base.perPage.filter((p) => p.confidence != null).length)
    : null;
  return base;
}
