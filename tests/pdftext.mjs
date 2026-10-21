/* =====================================================================
   PASSO 8 — extracção de texto de PDF (server/pdftext.mjs).

   Tudo aqui corre sobre ficheiros REAIS:
   · tests/fixtures/relatorio-chromium.pdf — PDF verdadeiro do motor do
     Chromium (fontes subconjuntas, FlateDecode, /ToUnicode);
   · docs/exemplo-resumo.pdf — PDF escrito pelo gerador da própria aplicação
     (sem ToUnicode, codificação simples);
   · ficheiros sintéticos só para os casos-limite (cifra, digitalizado,
     bomba de descompressão), que não existem em nenhum corpus público.

   A régua é o `pdftotext` (poppler) quando está instalado: se o nosso texto
   não coincidir com ele, o teste falha. Não se aceita «parece bem».
   ===================================================================== */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { extractPdfText, parseToUnicode, textFromContentStream, _internals } from '../server/pdftext.mjs';

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { const d = await fn(); pass++; console.log('PASS ' + name + (d ? ' → ' + d : '')); }
  catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

const FIX = 'tests/fixtures/relatorio-chromium.pdf';
const OWN = 'docs/exemplo-resumo.pdf';
const fixture = fs.readFileSync(FIX);
const own = fs.readFileSync(OWN);

const hasPdftotext = (() => {
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const pdfToText = (file) => execFileSync('pdftotext', [file, '-']).toString();

/* ---------- 1. PDF real do Chromium: legível e igual ao pdftotext ---------- */
let real = null;

await t('fixture Chromium: extrai texto com acentos', () => {
  real = extractPdfText(fixture);
  ok(real.ok, 'devia extrair: ' + (real.reason || ''));
  ok(real.pages === 2, 'páginas = ' + real.pages);
  ok(real.usedToUnicode >= 1, 'nenhuma fonte resolvida por /ToUnicode');
  ok(/Relatório de teste/.test(real.text), 'falta «Relatório de teste»');
  ok(/Segunda página/.test(real.text), 'falta «Segunda página»');
  ok(/250 000 euros/.test(real.text), 'falta «250 000 euros»');
  ok(/duas fontes/.test(real.text), 'falta «duas fontes»');
  return real.chars + ' caracteres, ' + real.usedToUnicode + ' fluxos com ToUnicode';
});

await t('fixture Chromium: igual ao pdftotext (texto normalizado)', () => {
  if (!hasPdftotext) return 'pdftotext ausente: comparação não executada';
  ok(norm(real.text) === norm(pdfToText(FIX)), 'o nosso texto difere do pdftotext');
  return 'idêntico';
});

await t('fixture Chromium: ligaduras resolvidas (ﬁ → fi) e nenhum U+FFFD', () => {
  ok(!/[\uFB00-\uFB06]/.test(real.text), 'ainda há ligaduras tipográficas');
  ok(/\bficheiro\b/.test(real.text), '«ficheiro» não ficou legível');
  ok(!/\uFFFD/.test(real.text), 'há caracteres de substituição');
  return 'ficheiro / fluxo / extracção';
});

await t('fixture Chromium: o resultado obriga a revisão humana', () => {
  ok(real.warnings.some((w) => /revisão humana/i.test(w)), 'falta o aviso de revisão humana');
  return real.warnings.length + ' avisos declarados';
});

/* ---------- 2. PDF escrito pela própria aplicação (sem ToUnicode) ---------- */
await t('PDF da aplicação (sem ToUnicode): legível', () => {
  const r = extractPdfText(own);
  ok(r.ok, 'devia extrair: ' + (r.reason || ''));
  ok(r.usedToUnicode === 0, 'não devia haver ToUnicode');
  ok(r.warnings.some((w) => /sem ToUnicode/i.test(w)), 'falta o aviso de ausência de ToUnicode');
  return r.chars + ' caracteres';
});

await t('PDF da aplicação: igual ao pdftotext', () => {
  if (!hasPdftotext) return 'pdftotext ausente: comparação não executada';
  ok(norm(extractPdfText(own).text) === norm(pdfToText(OWN)), 'difere do pdftotext');
  return 'idêntico';
});

/* ---------- 3. CMap /ToUnicode: bfchar, bfrange e bfrange-array ---------- */
await t('parseToUnicode: bfchar, bfrange e lista', () => {
  const cmap = parseToUnicode(`
    beginbfchar <0003> <0020> <0004> <0041> endbfchar
    beginbfrange <0010> <0012> <0061> endbfrange
    beginbfrange <0020> <0021> [<00C1> <00C9>] endbfrange`);
  ok(cmap.get(3) === ' ', 'espaço');
  ok(cmap.get(4) === 'A', 'A');
  ok(cmap.get(0x10) === 'a' && cmap.get(0x12) === 'c', 'intervalo a..c');
  ok(cmap.get(0x20) === 'Á' && cmap.get(0x21) === 'É', 'lista de acentos');
  return [...cmap.values()].join('');
});

await t('textFromContentStream: fontes de 2 bytes não duplicam caracteres', () => {
  const cmap = new Map([[0x2E, 'R'], [0x4F, 'e'], [3, ' ']]);
  const content = 'BT /F1 12 Tf 1 0 0 -1 8 30 Tm <002E004F> Tj ET';
  const r = textFromContentStream(content, new Map([['F1', { cmap, twoByte: true }]]));
  ok(r.text === 'Re', 'obtido: ' + JSON.stringify(r.text));
  ok(r.mapped, 'não marcou uso do CMap');
  return r.text;
});

await t('textFromContentStream: sem CMap devolve bytes e avisa que não mapeou', () => {
  const r = textFromContentStream('BT /F9 12 Tf (abc) Tj ET', new Map());
  ok(r.text.includes('abc'), 'esperava abc, obtido ' + JSON.stringify(r.text));
  ok(r.mapped === false, 'não devia afirmar mapeamento');
  return 'texto cru devolvido com mapped:false';
});

/* ---------- 4. Casos-limite e recusas declaradas ---------- */
await t('recusa ficheiro que não é PDF', () => {
  const r = extractPdfText(Buffer.from('<html><body>olá</body></html>'));
  ok(!r.ok && /não é um PDF/.test(r.reason), r.reason);
  return r.reason;
});

await t('recusa ficheiro vazio', () => {
  const r = extractPdfText(Buffer.alloc(0));
  ok(!r.ok, 'devia recusar');
  return r.reason;
});

await t('PDF cifrado: pára em vez de contornar a protecção', () => {
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj <</Type /Catalog>> endobj\ntrailer <</Root 1 0 R /Encrypt 9 0 R>>\n%%EOF');
  const r = extractPdfText(pdf);
  ok(!r.ok, 'devia recusar');
  ok(r.encrypted === true, 'não marcou encrypted');
  ok(/cifra/i.test(r.reason), r.reason);
  ok(r.text === '', 'não devia devolver texto de um documento cifrado');
  return r.reason;
});

await t('limite de tamanho: recusa antes de ler', () => {
  const r = extractPdfText(fixture, { maxBytes: 1024 });
  ok(!r.ok && /limite/i.test(r.reason), r.reason);
  return r.reason;
});

await t('limite de caracteres: corta e declara o corte', () => {
  const r = extractPdfText(fixture, { maxChars: 40 });
  ok(r.ok, 'devia extrair');
  ok(r.text.length === 40, 'tamanho ' + r.text.length);
  ok(r.warnings.some((w) => /cortado/i.test(w)), 'falta aviso de corte');
  return '40 caracteres + aviso';
});

await t('PDF só com imagem: diz que não há OCR', () => {
  const content = 'q 100 0 0 100 0 0 cm /Im1 Do Q';
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj <</Type /Page /Resources <</XObject <</Im1 3 0 R>>>> /Contents 2 0 R>> endobj\n' +
    '2 0 obj <</Length ' + content.length + '>>\nstream\n' + content + '\nendstream endobj\n' +
    '3 0 obj <</Type /XObject /Subtype /Image /Width 10 /Height 10>>\nstream\nxxxx\nendstream endobj\n%%EOF');
  const r = extractPdfText(pdf);
  ok(!r.ok, 'devia dizer que não há texto');
  ok(r.imageOnly === true, 'não marcou imageOnly');
  ok(/OCR/.test(r.reason), r.reason);
  return r.reason;
});

await t('bomba de descompressão: não rebenta, declara o fluxo ilegível', () => {
  const bomb = zlib.deflateSync(Buffer.alloc(4 * 1024 * 1024, 0x41));
  const head = Buffer.from('%PDF-1.4\n1 0 obj <</Type /Page /Contents 2 0 R>> endobj\n2 0 obj <</Filter /FlateDecode /Length ' + bomb.length + '>>\nstream\n', 'latin1');
  const tail = Buffer.from('\nendstream endobj\n%%EOF', 'latin1');
  const pdf = Buffer.concat([head, bomb, tail]);
  const r = extractPdfText(pdf, { maxStreamBytes: 64 * 1024 });
  ok(!r.ok || r.streamFailures >= 1, 'devia recusar ou declarar o fluxo ilegível');
  ok(!r.text.includes('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), 'devolveu conteúdo do fluxo acima do limite');
  return r.ok ? 'fluxo ignorado com aviso' : r.reason;
});

await t('lixo depois de %PDF- não lança excepção', () => {
  const r = extractPdfText(Buffer.from('%PDF-1.4\n' + 'x'.repeat(5000)));
  ok(!r.ok, 'devia devolver ok:false');
  return r.reason;
});

/* ---------- 5. Contrato do resultado ---------- */
await t('resultado tem os campos declarados e nenhum segredo', () => {
  const campos = ['ok', 'text', 'method', 'pages', 'streams', 'usedToUnicode', 'chars', 'warnings', 'limits'];
  campos.forEach((c) => ok(c in real, 'falta o campo ' + c));
  ok(real.method === 'texto-extraído', 'método ' + real.method);
  ok(JSON.stringify(real).length < 250000, 'resultado demasiado grande');
  return campos.join(', ');
});

await t('parseObjects encontra os objectos do fixture e ignora fluxos como dicionário', () => {
  const objs = _internals.parseObjects(fixture.toString('latin1'), 20000);
  ok(objs.size >= 10, 'só ' + objs.size + ' objectos');
  const streamy = [...objs.values()].filter((o) => o.data);
  ok(streamy.length >= 3, 'poucos fluxos encontrados');
  return objs.size + ' objectos, ' + streamy.length + ' com fluxo';
});

console.log('\n' + pass + ' testes passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
