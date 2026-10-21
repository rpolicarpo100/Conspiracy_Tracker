/* =====================================================================
   PDF mínimo, sem dependências — para o resumo poder sair em ficheiro.

   Porque escrito à mão: o plano gratuito não tem binários de renderização e
   uma dependência de PDF só para texto é peso sem retorno. Limites assumidos
   e declarados no documento:
   · texto apenas (sem imagens, sem tabelas com grelha, sem ligações clicáveis);
   · Helvetica com codificação WinAnsi: caracteres fora do Latin-1 saem como «?»;
   · quebras de linha calculadas com métricas aproximadas da Helvetica.

   O PDF é escrito sem compressão de propósito: qualquer leitor extrai o texto e
   o conteúdo pode ser verificado com `grep`-equivalente, o que também permite
   testar o que sai sem depender de uma biblioteca.
   ===================================================================== */

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = { left: 48, right: 48, top: 56, bottom: 54 };
const SIZE = { body: 9.8, leading: 13.2, h1: 17, h2: 12.6, small: 8.2 };

/* larguras Helvetica (unidades/1000). Aproximação suficiente para quebrar linhas;
   letras acentuadas usam a largura da letra base. */
const W = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333,
  '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584,
  '>': 584, '?': 556, '@': 1015, '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556, '`': 333,
  '{': 334, '|': 260, '}': 334, '~': 584,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556,
  M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667,
  Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222,
  m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500,
  y: 500, z: 500
};
const BASE = { á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e', í: 'i', ì: 'i',
  î: 'i', ï: 'i', ó: 'o', ò: 'o', ô: 'o', õ: 'o', ö: 'o', ú: 'u', ù: 'u', û: 'u', ü: 'u', ç: 'c', ñ: 'n',
  Á: 'A', À: 'A', Â: 'A', Ã: 'A', Ä: 'A', É: 'E', È: 'E', Ê: 'E', Ë: 'E', Í: 'I', Ì: 'I', Î: 'I', Ï: 'I',
  Ó: 'O', Ò: 'O', Ô: 'O', Õ: 'O', Ö: 'O', Ú: 'U', Ù: 'U', Û: 'U', Ü: 'U', Ç: 'C', Ñ: 'N' };

function charWidth(ch, size) {
  const key = W[ch] != null ? ch : BASE[ch];
  const w = key && W[key] ? W[key] : 556;
  return (w / 1000) * size;
}
function textWidth(str, size) {
  let t = 0;
  for (const ch of str) t += charWidth(ch, size);
  return t;
}

/* WinAnsi ≈ Latin-1 para o que usamos; o resto sai como «?». */
function toWinAnsi(str) {
  let out = '';
  for (const ch of String(str == null ? '' : str)) {
    const c = ch.codePointAt(0);
    if (ch === '\n') { out += ' '; continue; }
    if (ch === '\t') { out += '    '; continue; }
    if (c >= 32 && c <= 126) { out += ch; continue; }
    if (c >= 160 && c <= 255) { out += ch; continue; }
    if (ch === '…') { out += '...'; continue; }
    if (ch === '–' || ch === '—') { out += '-'; continue; }
    if (ch === '“' || ch === '”') { out += '"'; continue; }
    if (ch === '‘' || ch === '’') { out += "'"; continue; }
    if (ch === '•') { out += '-'; continue; }
    if (ch === '→') { out += '->'; continue; }
    if (ch === '≤') { out += '<='; continue; }
    if (ch === '≥') { out += '>='; continue; }
    out += '?';
  }
  return out;
}

function escapePdf(str) {
  return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapText(text, size, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word;
    if (textWidth(candidate, size) <= maxWidth || !line) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * renderPdf({ title, subtitle, blocks }) → Buffer
 * blocks: {type:'h1'|'h2'|'p'|'li'|'kv'|'small'|'rule'|'pagebreak'|'spacer', text, label}
 */
export function renderPdf(doc) {
  const title = toWinAnsi(doc.title || 'Documento');
  const subtitle = toWinAnsi(doc.subtitle || '');
  const contentW = A4.w - MARGIN.left - MARGIN.right;
  const pages = [];
  let ops = [];
  let y = A4.h - MARGIN.top;

  const newPage = () => { pages.push(ops); ops = []; y = A4.h - MARGIN.top; };
  const ensure = (need) => { if (y - need < MARGIN.bottom + 26) newPage(); };

  const put = (text, size, font, opts) => {
    const maxW = contentW - ((opts && opts.indent) || 0);
    const lines = wrapText(text, size, maxW);
    const leading = (opts && opts.leading) || SIZE.leading;
    ensure(lines.length * leading);
    lines.forEach((ln) => {
      ensure(leading);
      ops.push('BT /' + font + ' ' + size.toFixed(2) + ' Tf 1 0 0 1 ' +
        (MARGIN.left + ((opts && opts.indent) || 0)).toFixed(2) + ' ' + (y - size).toFixed(2) + ' Tm (' +
        escapePdf(toWinAnsi(ln)) + ') Tj ET');
      y -= leading;
    });
  };

  /* cabeçalho da primeira página */
  put(title, SIZE.h1, 'F2', { leading: 21 });
  if (subtitle) put(subtitle, SIZE.small, 'F1', { leading: 11.6 });
  y -= 2;
  ops.push('0.75 0.78 0.82 RG 0.6 w ' + MARGIN.left + ' ' + y.toFixed(2) + ' m ' + (A4.w - MARGIN.right).toFixed(2) + ' ' + y.toFixed(2) + ' l S');
  y -= 12;

  (doc.blocks || []).forEach((b) => {
    switch (b.type) {
      case 'h1': put(b.text, SIZE.h1, 'F2', { leading: 20 }); y -= 2; break;
      case 'h2': ensure(26); y -= 4; put(b.text, SIZE.h2, 'F2', { leading: 16 }); break;
      case 'p': put(b.text, SIZE.body, 'F1'); y -= 1.5; break;
      case 'small': put(b.text, SIZE.small, 'F1', { leading: 10.6 }); y -= 1; break;
      case 'li': put('- ' + b.text, SIZE.body, 'F1', { indent: 8 }); break;
      case 'kv':
        put((b.label ? b.label + ': ' : '') + b.text, SIZE.body, 'F1', { indent: 8, leading: 12.4 });
        break;
      case 'rule': ensure(10); ops.push('0.82 0.84 0.88 RG 0.5 w ' + MARGIN.left + ' ' + y.toFixed(2) + ' m ' + (A4.w - MARGIN.right).toFixed(2) + ' ' + y.toFixed(2) + ' l S'); y -= 8; break;
      case 'spacer': y -= Number(b.size) || 6; break;
      case 'pagebreak': newPage(); break;
      default: put(String(b.text || ''), SIZE.body, 'F1');
    }
  });
  pages.push(ops);
  const total = pages.length;

  /* rodapé em todas as páginas, com o aviso que não pode faltar */
  const footer = (i) => [
    '0.85 0.87 0.90 RG 0.5 w ' + MARGIN.left + ' ' + (MARGIN.bottom - 12) + ' m ' + (A4.w - MARGIN.right) + ' ' + (MARGIN.bottom - 12) + ' l S',
    'BT /F1 ' + SIZE.small + ' Tf 1 0 0 1 ' + MARGIN.left + ' ' + (MARGIN.bottom - 24) + ' Tm (' +
      escapePdf('Meridiano - resumo gerado a partir dos dados registados: um resumo nao substitui as provas.') + ') Tj ET',
    'BT /F1 ' + SIZE.small + ' Tf 1 0 0 1 ' + (A4.w - MARGIN.right - 70) + ' ' + (MARGIN.bottom - 24) + ' Tm (' +
      escapePdf('pagina ' + (i + 1) + ' de ' + total) + ') Tj ET'
  ];

  /* montagem dos objectos */
  const objs = [];
  const push = (s) => { objs.push(s); return objs.length; };
  const fontRegular = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold = push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pagesObjIndex = objs.length + 1 + pages.length * 2 + 1; // calculado adiante com cuidado
  void pagesObjIndex;

  const pageRefs = [];
  pages.forEach((pageOps, i) => {
    const content = pageOps.concat(footer(i)).join('\n');
    const streamIdx = push('<< /Length ' + Buffer.byteLength(content, 'latin1') + ' >>\nstream\n' + content + '\nendstream');
    const pageIdx = push('<< /Type /Page /Parent __PAGES__ /MediaBox [0 0 ' + A4.w.toFixed(2) + ' ' + A4.h.toFixed(2) +
      '] /Resources << /Font << /F1 ' + fontRegular + ' 0 R /F2 ' + fontBold + ' 0 R >> >> /Contents ' + streamIdx + ' 0 R >>');
    pageRefs.push(pageIdx);
  });
  const pagesIdx = push('<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pageRefs.map((r) => r + ' 0 R').join(' ') + '] >>');
  const catalogIdx = push('<< /Type /Catalog /Pages ' + pagesIdx + ' 0 R >>');
  const infoIdx = push('<< /Title (' + escapePdf(title) + ') /Producer (Meridiano) /CreationDate (D:' +
    new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z) >>');

  /* resolver o pai das páginas */
  for (let i = 0; i < objs.length; i++) objs[i] = objs[i].replace('__PAGES__', pagesIdx + ' 0 R');

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
  });
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
  offsets.forEach((off) => { out += String(off).padStart(10, '0') + ' 00000 n \n'; });
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalogIdx + ' 0 R /Info ' + infoIdx + ' 0 R >>\nstartxref\n' +
    xrefOffset + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}
