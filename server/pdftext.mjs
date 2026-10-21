/* =====================================================================
   EXTRACÇÃO DE TEXTO DE PDF — sem dependências, com limites declarados.

   Estratégia:
   1. lê os objectos do ficheiro (dicionário + fluxo);
   2. descomprime os fluxos de conteúdo (FlateDecode);
   3. usa o CMap /ToUnicode de cada fonte para traduzir os códigos — sem isto,
      qualquer PDF com fontes subconjuntas sai ilegível;
   4. percorre cada /Type /Page na ordem dos objectos, trocando de fonte quando
      encontra /Fx Tf.

   O que NÃO faz, e é dito em cada resultado:
   · não faz OCR — um PDF digitalizado (só imagens) sai como «sem texto»;
   · não aplica /Differences de fontes Type1 sem ToUnicode (avisa que pode haver
     letras erradas);
   · não garante ordem de páginas em PDFs com object streams.

   Regra que não se quebra: o texto extraído NÃO entra no registo de provas
   sozinho. Serve para preencher o excerto que uma pessoa revê e confirma.
   ===================================================================== */
import zlib from 'node:zlib';

export const PDF_LIMITS = {
  maxBytes: 12 * 1024 * 1024,
  maxChars: 200000,
  maxObjects: 20000,
  maxStreamBytes: 8 * 1024 * 1024,
  maxImages: 12,          // imagens recolhidas para OCR
  maxPixels: 40e6         // por imagem: 40 MP (≈ 7000×5600)
};

/* inflate com tecto de saída: um Fluxo pode ser uma bomba de descompressão */
const inflate = (buf, maxOut) => {
  const cap = maxOut || PDF_LIMITS.maxStreamBytes;
  const opts = { maxOutputLength: cap };
  const attempts = [
    () => zlib.inflateSync(buf, opts),
    () => zlib.inflateSync(buf, Object.assign({}, opts, { finishFlush: zlib.constants.Z_SYNC_FLUSH })),
    () => zlib.inflateRawSync(buf, Object.assign({}, opts, { finishFlush: zlib.constants.Z_SYNC_FLUSH }))
  ];
  for (const fn of attempts) { try { return fn(); } catch { /* tenta a seguinte */ } }
  return null;
};

/* ---------------- objectos ---------------- */

function parseObjects(src, limit) {
  const objects = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m, n = 0;
  while ((m = re.exec(src)) !== null && n < limit) {
    n++;
    const id = Number(m[1]);
    const bodyStart = m.index + m[0].length;
    const endObj = src.indexOf('endobj', bodyStart);
    if (endObj < 0) break;
    const body = src.slice(bodyStart, endObj);
    const sIdx = body.indexOf('stream');
    let dict = body, data = null;
    if (sIdx >= 0) {
      dict = body.slice(0, sIdx);
      let start = bodyStart + sIdx + 'stream'.length;
      if (src[start] === '\r') start++;
      if (src[start] === '\n') start++;
      const endStream = src.indexOf('endstream', start);
      if (endStream > start) data = Buffer.from(src.slice(start, endStream), 'latin1');
    }
    objects.set(id, { id, dict, data });
  }
  return objects;
}

function streamText(obj, opts) {
  if (!obj || !obj.data) return null;
  const o = opts || {};
  if (/\/FlateDecode/.test(obj.dict)) {
    const out = inflate(obj.data, o.maxBytes);
    if (!out) { if (o.stats) o.stats.failed++; return null; }
    if (o.stats) o.stats.inflated += out.length;
    return out.toString('latin1');
  }
  if (/\/Filter/.test(obj.dict)) return null;      // filtros não suportados (JPX, LZW antigo…)
  return obj.data.toString('latin1');
}

/* ---------------- CMap /ToUnicode ---------------- */

function hexToInt(h) { return parseInt(h, 16); }
function utf16(h) {
  let out = '';
  for (let i = 0; i + 3 < h.length + 1; i += 4) {
    const part = h.slice(i, i + 4);
    if (part.length < 4) break;
    out += String.fromCharCode(parseInt(part, 16));
  }
  return out;
}

export function parseToUnicode(cmapText) {
  const map = new Map();      // código → string
  if (!cmapText) return map;
  let m;
  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((m = bfchar.exec(cmapText)) !== null) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g;
    let p;
    while ((p = re.exec(m[1])) !== null) {
      map.set(hexToInt(p[1]), p[2] ? utf16(p[2]) : '');
    }
  }
  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = bfrange.exec(cmapText)) !== null) {
    const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
    let p;
    while ((p = re.exec(m[1])) !== null) {
      const lo = hexToInt(p[1]), hi = hexToInt(p[2]);
      if (hi < lo || hi - lo > 65535) continue;
      if (p[3] != null) {
        const base = p[3];
        const prefix = base.slice(0, Math.max(0, base.length - 4));
        const start = base.length >= 4 ? parseInt(base.slice(-4), 16) : parseInt(base, 16);
        for (let c = lo; c <= hi && c - lo < 4096; c++) {
          const code = (start + (c - lo)).toString(16).padStart(4, '0');
          map.set(c, utf16(prefix + code));
        }
      } else if (p[4]) {
        const items = [...p[4].matchAll(/<([0-9A-Fa-f]*)>/g)].map((x) => x[1]);
        items.forEach((item, i) => { if (lo + i <= hi) map.set(lo + i, utf16(item)); });
      }
    }
  }
  return map;
}

/* ---------------- recursos de fonte por página ---------------- */

function refOf(str) { const m = String(str || '').match(/(\d+)\s+\d+\s+R/); return m ? Number(m[1]) : null; }

function dictSlice(dict, key) {
  const i = dict.indexOf(key);
  if (i < 0) return null;
  /* devolve o trecho após a chave até ao fim do valor (dict <<…>> ou referência) */
  const rest = dict.slice(i + key.length);
  const startDict = rest.indexOf('<<');
  if (startDict >= 0) {
    let depth = 0;
    for (let k = startDict; k < rest.length - 1; k++) {
      if (rest[k] === '<' && rest[k + 1] === '<') { depth++; k++; continue; }
      if (rest[k] === '>' && rest[k + 1] === '>') { depth--; k++; if (depth === 0) return rest.slice(startDict, k + 1); }
    }
  }
  return rest.slice(0, 120);
}

function resolveDict(value, objects) {
  if (!value) return null;
  const t = value.trim();
  if (/^\s*\d+\s+\d+\s+R/.test(t)) {
    const id = refOf(t);
    return id && objects.has(id) ? objects.get(id).dict : null;
  }
  return t;
}

/* nomes de fonte → CMap, a partir de um dicionário /Resources (próprio ou herdado) */
function fontsFromResources(resDict, objects) {
  const fonts = new Map();
  const res = resolveDict(resDict, objects);
  if (!res) return fonts;
  const fontDict = resolveDict(dictSlice(res, '/Font'), objects);
  if (!fontDict) return fonts;
  const re = /\/([A-Za-z0-9#+._-]+)\s+(\d+)\s+\d+\s+R/g;
  let m;
  while ((m = re.exec(fontDict)) !== null) {
    const fontObj = objects.get(Number(m[2]));
    if (!fontObj) continue;
    const tu = refOf(dictSlice(fontObj.dict, '/ToUnicode'));
    if (tu && objects.has(tu)) {
      const cmapText = streamText(objects.get(tu));
      if (cmapText) {
        const cmap = parseToUnicode(cmapText);
        if (cmap.size) fonts.set(m[1], { cmap, twoByte: /\/Subtype\s*\/Type0|Identity-H/.test(fontObj.dict) });
      }
    }
  }
  return fonts;
}

/* XObjects de formulário declarados nos recursos: /Fm0 12 0 R */
function xobjectsFromResources(resDict, objects) {
  const out = new Map();
  const res = resolveDict(resDict, objects);
  if (!res) return out;
  const xd = resolveDict(dictSlice(res, '/XObject'), objects);
  if (!xd) return out;
  const re = /\/([A-Za-z0-9#+._-]+)\s+(\d+)\s+\d+\s+R/g;
  let m;
  while ((m = re.exec(xd)) !== null) out.set(m[1], Number(m[2]));
  return out;
}

/* CMap global: todos os ToUnicode do documento, como recurso de último caso */
function globalFonts(objects) {
  const fonts = new Map();
  let n = 0;
  objects.forEach((ob) => {
    if (!/\/Type\s*\/Font/.test(ob.dict)) return;
    const tu = refOf(dictSlice(ob.dict, '/ToUnicode'));
    if (!tu || !objects.has(tu)) return;
    const cmap = parseToUnicode(streamText(objects.get(tu)));
    if (cmap.size) fonts.set('__f' + (n++), { cmap, twoByte: /\/Subtype\s*\/Type0|Identity-H/.test(ob.dict) });
  });
  return fonts;
}

/* ---------------- leitura dos operadores de texto ---------------- */

function readLiteral(src, i) {
  let depth = 0, out = '';
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      const nx = src[i + 1];
      if (nx === 'n') { out += '\n'; i++; continue; }
      if (nx === 'r') { out += '\r'; i++; continue; }
      if (nx === 't') { out += '\t'; i++; continue; }
      if (nx === 'b' || nx === 'f') { i++; continue; }
      if (nx === '(' || nx === ')' || nx === '\\') { out += nx; i++; continue; }
      if (nx === '\n') { i++; continue; }
      if (/[0-7]/.test(nx || '')) {
        let oct = '';
        while (oct.length < 3 && /[0-7]/.test(src[i + 1] || '')) oct += src[++i];
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
        continue;
      }
      out += nx || ''; i++; continue;
    }
    if (ch === '(') { depth++; if (depth > 1) out += ch; continue; }
    if (ch === ')') { depth--; if (depth === 0) return { text: out, next: i + 1 }; out += ch; continue; }
    out += ch;
  }
  return { text: out, next: i };
}

function readHex(src, i) {
  let hex = '';
  for (i++; i < src.length && src[i] !== '>'; i++) hex += src[i];
  if (hex.length % 2) hex += '0';
  let out = '';
  for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
  return { text: out, next: i + 1 };
}

/* converte uma string "crua" (bytes) em texto, usando o CMap da fonte actual */
function mapBytes(raw, cmap, twoByte) {
  if (!cmap || !cmap.size) return { text: raw, mapped: false };
  /* códigos de 2 bytes aparecem como bytes nulos intercalados quando não há
     declaração de tipo de fonte: usa-se isso como sinal */
  if (!twoByte) {
    let nuls = 0;
    for (let k = 0; k < raw.length; k++) if (raw.charCodeAt(k) === 0) nuls++;
    if (raw.length > 3 && nuls / raw.length > 0.25) twoByte = true;
  }
  let out = '', mapped = 0;
  if (twoByte) {
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const code = (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1);
      if (cmap.has(code)) { out += cmap.get(code); mapped++; } else out += '\uFFFD';
    }
  } else {
    for (let i = 0; i < raw.length; i++) {
      const code = raw.charCodeAt(i);
      if (cmap.has(code)) { out += cmap.get(code); mapped++; } else out += raw[i];
    }
  }
  return { text: out, mapped: mapped > 0 };
}

export function textFromContentStream(content, fonts) {
  fonts = fonts || new Map();
  const out = [];
  let line = '';
  let cmap = null, twoByte = false, mappedAny = false;
  let nums = [];                       // operandos numéricos do operador seguinte
  let lastTm = null;
  let fontSize = 12;                   // usado para distinguir kerning de salto de palavra
  const flush = () => { if (line.trim()) out.push(line.trim()); line = ''; };
  /* separa palavras por ligaduras tipográficas (ﬁ, ﬂ…) para o texto ficar pesquisável */
  const LIG = { '\uFB00': 'ff', '\uFB01': 'fi', '\uFB02': 'fl', '\uFB03': 'ffi', '\uFB04': 'ffl', '\uFB05': 'st', '\uFB06': 'st' };
  const denorm = (t) => t.replace(/[\uFB00-\uFB06]/g, (c) => LIG[c] || c);
  const emit = (raw) => { const r = mapBytes(raw, cmap, twoByte); if (r.mapped) mappedAny = true; line += denorm(r.text); };

  let i = 0, pending = null;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '(') {
      const r = readLiteral(content, i);
      if (pending) pending.push(r.text); else emit(r.text);
      i = r.next; continue;
    }
    if (ch === '<' && content[i + 1] !== '<') {
      const r = readHex(content, i);
      if (pending) pending.push(r.text); else emit(r.text);
      i = r.next; continue;
    }
    if (ch === '[') { pending = []; i++; continue; }
    if (ch === ']') { if (pending) { pending.forEach(emit); pending = null; } i++; continue; }
    if (ch === '<' && content[i + 1] === '<') {      // dicionário inline: salta
      let depth = 0;
      for (; i < content.length - 1; i++) {
        if (content[i] === '<' && content[i + 1] === '<') { depth++; i++; continue; }
        if (content[i] === '>' && content[i + 1] === '>') { depth--; i++; if (!depth) { i++; break; } }
      }
      continue;
    }
    if ((ch === '-' || ch === '.' || /\d/.test(ch)) && ch !== '<') {
      const m = content.slice(i).match(/^-?\d*\.?\d+/);
      if (m && m[0] !== '-' && m[0] !== '.') {
        if (pending) { if (ch === '-' && Math.abs(Number(m[0])) > 120) pending.push(' '); }
        else { nums.push(Number(m[0])); if (nums.length > 8) nums.shift(); }
        i += m[0].length; continue;
      }
      if (m) { i += m[0].length; continue; }
    }
    if (/[A-Za-z'"*]/.test(ch)) {
      const opStart = i;
      let op = '';
      while (i < content.length && /[A-Za-z'"*]/.test(content[i])) op += content[i++];
      if (op === 'Tf') {
        /* o nome da fonte e o tamanho vêm ANTES do operador: /F4 12 Tf */
        const before = content.slice(Math.max(0, opStart - 80), opStart);
        const fm = before.match(/\/([A-Za-z0-9#+._-]+)\s+[\d.]+\s*$/);
        const entry = fm ? fonts.get(fm[1]) : null;
        cmap = entry ? entry.cmap : null;
        twoByte = entry ? !!entry.twoByte : false;
      } else if (op === 'Td' || op === 'TD') {
        /* Td/TD deslocam a linha: y != 0 começa nova linha, x > 0 é só um salto de palavra */
        const y = nums[nums.length - 1], x = nums[nums.length - 2];
        /* só se muda de linha: os saltos em x são reposicionamentos de kerning,
           e as palavras separam-se pelo glifo de espaço do próprio documento */
        if (Number.isFinite(y) && Math.abs(y) > 0.5) flush();
      } else if (op === 'Tm') {
        const y = nums[nums.length - 1], x = nums[nums.length - 2];
        if (Number.isFinite(y) && Math.abs(y - (lastTm && lastTm.y)) > 0.5) flush();
        if (Number.isFinite(x) && Number.isFinite(y)) lastTm = { x, y };
      } else if (op === 'T*' || op === "'" || op === '"') flush();
      else if (op === 'ET') flush();
      nums = [];
      continue;
    }
    if (ch === '\n' || ch === '\r') { i++; continue; }
    i++;
  }
  flush();
  const text = out.join('\n').replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n');
  return { text, mapped: mappedAny };
}

/* ---------------- extracção principal ---------------- */

export function extractPdfText(buffer, opts) {
  const o = Object.assign({}, PDF_LIMITS, opts || {});
  const warnings = [];
  const empty = (reason, extra) => Object.assign({ ok: false, reason, text: '', method: 'nenhum', warnings }, extra || {});

  if (!buffer || buffer.length < 8) return empty('ficheiro vazio ou truncado');
  if (buffer.length > o.maxBytes) {
    const lim = o.maxBytes >= 1024 * 1024 ? (o.maxBytes / 1024 / 1024).toFixed(1) + ' MB' : Math.round(o.maxBytes / 1024) + ' KB';
    return empty('PDF maior do que o limite de ' + lim);
  }
  const head = buffer.slice(0, 8).toString('latin1');
  if (head.indexOf('%PDF-') !== 0) return empty('não é um PDF (assinatura ausente)');

  const src = buffer.toString('latin1');
  const version = (src.match(/^%PDF-(\d\.\d)/) || [])[1] || null;
  if (/\/Encrypt\b/.test(src)) {
    return empty('PDF protegido por cifra: não se extrai texto (não se contorna protecção)', {
      version, encrypted: true,
      warnings: ['documento cifrado: a extracção parou em vez de tentar quebrar a protecção']
    });
  }

  const streamStats = { inflated: 0, failed: 0 };
  const readStream = (ob) => streamText(ob, { maxBytes: o.maxStreamBytes, stats: streamStats });

  const objects = parseObjects(src, o.maxObjects);
  const hasImages = /\/Subtype\s*\/Image/.test(src);
  const hasObjStm = /\/Type\s*\/ObjStm/.test(src);
  const fallbackFonts = globalFonts(objects);

  const chunks = [];
  let usedToUnicode = 0, streams = 0;
  const seen = new Set();

  /* percorre um fluxo de conteúdo, com os recursos herdados; entra nos XObjects */
  const processContent = (content, resDict, depth) => {
    if (!content || depth > 4 || streams > 400) return;
    if (!/\bBT\b/.test(content)) {
      /* mesmo sem BT pode conter XObjects com texto */
    } else {
      streams++;
      let fonts = fontsFromResources(resDict, objects);
      if (!fonts.size) fonts = fallbackFonts;
      const r = textFromContentStream(content, fonts);
      if (r.mapped) usedToUnicode++;
      if (r.text.trim()) chunks.push(r.text.trim());
    }
    const xobjs = xobjectsFromResources(resDict, objects);
    const reDo = /\/([A-Za-z0-9#+._-]+)\s+Do\b/g;
    let m;
    while ((m = reDo.exec(content)) !== null) {
      const xid = xobjs.get(m[1]);
      if (!xid || seen.has(xid)) continue;
      seen.add(xid);
      const xo = objects.get(xid);
      if (!xo || !/\/Subtype\s*\/Form/.test(xo.dict)) continue;
      const inner = readStream(xo);
      const innerRes = dictSlice(xo.dict, '/Resources');
      processContent(inner, innerRes || resDict, depth + 1);
    }
  };

  const pages = [...objects.values()].filter((ob) => /\/Type\s*\/Page\b/.test(ob.dict) && !/\/Type\s*\/Pages\b/.test(ob.dict));
  let ordered = pages;
  const pagesNode = [...objects.values()].find((ob) => /\/Type\s*\/Pages\b/.test(ob.dict) && /\/Kids/.test(ob.dict));
  if (pagesNode) {
    const kids = [...(dictSlice(pagesNode.dict, '/Kids') || '').matchAll(/(\d+)\s+\d+\s+R/g)].map((m2) => Number(m2[1]));
    const byId = new Map(pages.map((p) => [p.id, p]));
    const fromKids = kids.map((id) => byId.get(id)).filter(Boolean);
    if (fromKids.length) ordered = fromKids;
  }

  if (ordered.length) {
    ordered.forEach((page) => {
      const res = dictSlice(page.dict, '/Resources');
      const contentsVal = dictSlice(page.dict, '/Contents');
      if (!contentsVal) return;
      const refs = [...contentsVal.matchAll(/(\d+)\s+\d+\s+R/g)].map((m2) => Number(m2[1]));
      refs.forEach((rid) => {
        const ob = objects.get(rid);
        if (ob) processContent(readStream(ob), res, 0);
      });
    });
  } else {
    [...objects.values()].forEach((ob) => {
      if (ob.data && !/\/Type\s*\/(Font|ObjStm|Metadata|XRef)/.test(ob.dict)) processContent(readStream(ob), null, 0);
    });
    warnings.push('estrutura de páginas não reconhecida: o texto foi recolhido de todos os fluxos, sem garantia de ordem');
  }

  let text = chunks.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/\uFFFD+/g, '?').trim();
  if (text.length > o.maxChars) { text = text.slice(0, o.maxChars); warnings.push('texto cortado no limite de ' + o.maxChars + ' caracteres'); }

  if (!text) {
    return empty(hasImages ? 'PDF sem camada de texto (digitalizado): aqui não há OCR — a recolha tenta-o se o motor estiver disponível, senão o texto tem de ser transcrito por uma pessoa'
      : 'nenhum texto encontrado nos fluxos analisados', {
      version, pages: pages.length, streams, imageOnly: hasImages,
      streamFailures: streamStats.failed,
      warnings: warnings.concat(['esta extracção não substitui a leitura do documento'])
    });
  }

  if (!usedToUnicode) warnings.push('sem ToUnicode utilizável: acentos e nomes podem sair errados — confirmar no documento');
  if (hasObjStm) warnings.push('PDF com object streams: a ordem do texto pode não ser a ordem visual das páginas');
  if (streamStats.failed) warnings.push(streamStats.failed + ' fluxo(s) não puderam ser descomprimidos (corrompidos, cifrados ou acima do limite): parte do texto pode faltar');

  return {
    ok: true, text, method: 'texto-extraído', version,
    pages: pages.length, streams, usedToUnicode,
    chars: text.length, blocks: text.split(/\n{2,}/).length,
    streamFailures: streamStats.failed, inflatedBytes: streamStats.inflated,
    warnings: warnings.concat(['o texto não entra no registo de provas sem revisão humana: leia e confirme antes de citar']),
    limits: { maxBytes: o.maxBytes, maxChars: o.maxChars }
  };
}


/* ---------------- imagens de página (para OCR de digitalizados) ----------------

   Uma digitalização é, quase sempre, uma imagem DCTDecode (JPEG) ou FlateDecode
   por página. Devolver os bytes da imagem evita ter de rasterizar o PDF — não há
   aqui nenhum motor de render, nem dependência nativa.
   O que não é suportado é DITO, não adivinhado: CCITT, JBIG2, JPX e imagens com
   /DecodeParms (predictor) ficam listadas como não suportadas. */

export function pdfPageImages(buffer, opts) {
  const o = Object.assign({}, PDF_LIMITS, opts || {});
  const out = { images: [], unsupported: [], pages: 0, reason: null };
  if (!buffer || buffer.length < 8 || buffer.slice(0, 5).toString('latin1') !== '%PDF-') {
    out.reason = 'não é um PDF';
    return out;
  }
  if (buffer.length > o.maxBytes) { out.reason = 'PDF acima do limite'; return out; }
  const src = buffer.toString('latin1');
  if (/\/Encrypt\b/.test(src)) { out.reason = 'PDF cifrado: não se abre para OCR'; return out; }
  const objects = parseObjects(src, o.maxObjects);
  const pages = [...objects.values()].filter((ob) => /\/Type\s*\/Page\b/.test(ob.dict) && !/\/Type\s*\/Pages\b/.test(ob.dict));
  out.pages = pages.length;
  const seen = new Set();

  const collect = (resDict, pageIndex, depth) => {
    const xobjs = xobjectsFromResources(resDict, objects);
    xobjs.forEach((id, name) => {
      if (seen.has(id) || out.images.length + out.unsupported.length >= o.maxImages) return;
      seen.add(id);
      const ob = objects.get(id);
      if (!ob) return;
      if (/\/Subtype\s*\/Form/.test(ob.dict) && depth < 3) {
        collect(dictSlice(ob.dict, '/Resources') || resDict, pageIndex, depth + 1);
        return;
      }
      if (!/\/Subtype\s*\/Image/.test(ob.dict)) return;
      const width = Number((ob.dict.match(/\/Width\s+(\d+)/) || [])[1]) || 0;
      const height = Number((ob.dict.match(/\/Height\s+(\d+)/) || [])[1]) || 0;
      const bpc = Number((ob.dict.match(/\/BitsPerComponent\s+(\d+)/) || [])[1]) || 8;
      const cs = (ob.dict.match(/\/ColorSpace\s*\/(\w+)/) || [])[1] || null;
      const filterRaw = (dictSlice(ob.dict, '/Filter') || '').trim();
      const hasPred = /\/DecodeParms/.test(ob.dict);
      const base = {
        id, page: pageIndex + 1, name, width, height, bitsPerComponent: bpc, colorSpace: cs,
        filter: filterRaw.replace(/[\[\]\/\s]+/g, ' ').trim() || 'nenhum'
      };
      const unsupported = (why) => out.unsupported.push(Object.assign(base, { why }));
      if (!ob.data || !ob.data.length) return unsupported('imagem sem dados');
      if (width * height > o.maxPixels) return unsupported('imagem com ' + width + '×' + height + ' píxeis: acima do limite');
      if (bpc !== 8 && !/DCTDecode/.test(filterRaw)) return unsupported('bits por componente ' + bpc);
      if (/\/DCTDecode/.test(filterRaw) && !hasPred) {
        out.images.push(Object.assign(base, { mime: 'image/jpeg', data: ob.data }));
        return;
      }
      if (/\/FlateDecode/.test(filterRaw) && !hasPred && (cs === 'DeviceRGB' || cs === 'DeviceGray' || cs === 'DeviceCMYK')) {
        const raw = inflate(ob.data, o.maxStreamBytes);
        if (!raw) return unsupported('fluxo de imagem ilegível');
        out.images.push(Object.assign(base, { mime: 'raw', data: raw }));
        return;
      }
      if (/CCITTFax|JBIG2|JPX/.test(filterRaw)) return unsupported('compressão ' + filterRaw + ' não suportada');
      if (hasPred) return unsupported('imagem com /DecodeParms (predictor) não suportada');
      return unsupported('filtro ' + filterRaw + ' não suportado');
    });
  };

  const ordered = pages.length ? pages : [];
  ordered.forEach((page, i) => collect(dictSlice(page.dict, '/Resources'), i, 0));
  return out;
}

/* superfície interna exposta para testes e diagnóstico (não é API pública) */
export const _internals = { parseObjects, parseToUnicode, fontsFromResources, streamText, dictSlice, xobjectsFromResources, globalFonts, pdfPageImages };
