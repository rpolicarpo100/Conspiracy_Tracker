/* =====================================================================
   DADOS DE LÍNGUA PARA OCR — descarregados no BUILD, com integridade conferida.

   Porque não se descarrega isto a meio de um pedido:
   · um pedido de utilizador não deve depender de um CDN de terceiros estar vivo;
   · o modelo tem de ser o mesmo em todos os ambientes, e verificável.

   O que faz:
   1. lê o registo npm do pacote @tesseract.js-data/<lang>;
   2. descarrega o tarball e confere o `dist.integrity` (sha512) publicado;
   3. extrai apenas 4.0.0_best_int/<lang>.traineddata.gz, descomprime e grava
      <out>/<lang>.traineddata;
   4. escreve <out>/manifest.json com versão, URL, integridade e sha256 do
      ficheiro final — para se poder provar depois o que está a correr.

   Uso:  node tools/fetch-ocr-data.mjs [--langs=por,eng] [--out=DIR] [--force]
   Falha com código 1 e mensagem clara se a integridade não bater certo.
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const hit = args.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : def;
};
const LANGS = String(arg('langs', 'por,eng')).split(',').map((s) => s.trim()).filter(Boolean);
const OUT = path.resolve(arg('out', process.env.OCR_LANG_PATH || 'vendor/ocr'));
const FORCE = args.includes('--force');
const VARIANT = '4.0.0_best_int';

/* leitor de tar mínimo (só precisa de nomes, tamanhos e dados) */
function untar(buf) {
  const files = new Map();
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    if (!name) break;
    const sizeField = header.subarray(124, 136).toString('latin1').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeField, 8) || 0;
    const type = String.fromCharCode(header[156] || 0x30);
    const dataStart = off + 512;
    if (type === '0' || type === '\0' || type === '0') files.set(name, buf.subarray(dataStart, dataStart + size));
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

const sha512b64 = (buf) => crypto.createHash('sha512').update(buf).digest('base64');
const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

fs.mkdirSync(OUT, { recursive: true });
const manifestPath = path.join(OUT, 'manifest.json');
let manifest = { source: 'registry.npmjs.org', variant: VARIANT, generatedAt: new Date().toISOString(), languages: {} };
try { manifest = Object.assign(manifest, JSON.parse(fs.readFileSync(manifestPath, 'utf8'))); } catch { /* primeiro run */ }

let failures = 0;
for (const lang of LANGS) {
  const target = path.join(OUT, lang + '.traineddata');        // formato antigo (descomprimido)
  const targetGz = path.join(OUT, lang + '.traineddata.gz');
  if (!FORCE && fs.existsSync(targetGz)) {
    const hash = sha256hex(fs.readFileSync(targetGz));
    const known = manifest.languages[lang];
    if (known && known.sha256 === hash) {
      console.log('[ocr] ' + lang + ': já presente e com o hash esperado (nada a fazer)');
      continue;
    }
  }
  try {
    const metaRes = await fetch('https://registry.npmjs.org/@tesseract.js-data%2F' + lang, { headers: { accept: 'application/json' } });
    if (!metaRes.ok) throw new Error('registo npm respondeu HTTP ' + metaRes.status);
    const meta = await metaRes.json();
    const version = meta['dist-tags'] && meta['dist-tags'].latest;
    const dist = meta.versions && meta.versions[version] && meta.versions[version].dist;
    if (!dist || !dist.tarball || !dist.integrity) throw new Error('metadados incompletos no registo npm');

    const tb = await fetch(dist.tarball);
    if (!tb.ok) throw new Error('tarball respondeu HTTP ' + tb.status);
    const tgz = Buffer.from(await tb.arrayBuffer());
    const got = 'sha512-' + sha512b64(tgz);
    if (got !== dist.integrity) throw new Error('integridade não corresponde: esperado ' + dist.integrity + ', obtido ' + got);

    const files = untar(zlib.gunzipSync(tgz));
    const inner = 'package/' + VARIANT + '/' + lang + '.traineddata.gz';
    const gz = files.get(inner);
    if (!gz) throw new Error('o tarball não contém ' + inner);
    /* grava-se o .gz tal como é publicado: o motor lê-o diretamente e o ficheiro
       é exatamente o artefacto cuja integridade npm se conferiu */
    const data = Buffer.from(gz);
    fs.writeFileSync(targetGz, data);
    if (fs.existsSync(target)) fs.rmSync(target);
    manifest.languages[lang] = {
      package: '@tesseract.js-data/' + lang, version, tarball: dist.tarball,
      integrity: dist.integrity, variant: VARIANT,
      sha256: sha256hex(data), bytes: data.length,
      licence: 'Apache-2.0 (tessdata)', fetchedAt: new Date().toISOString()
    };
    console.log('[ocr] ' + lang + ': ' + Math.round(data.length / 1024) + ' KB (gz) · sha256 ' + sha256hex(data).slice(0, 16) + '… · integridade npm conferida');
  } catch (e) {
    failures++;
    console.error('[ocr] ' + lang + ': FALHOU — ' + String(e.message || e).slice(0, 200));
  }
}
manifest.generatedAt = new Date().toISOString();
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
console.log('[ocr] destino: ' + OUT + ' · línguas: ' + Object.keys(manifest.languages).join(', '));
if (failures) {
  console.error('[ocr] ' + failures + ' língua(s) não obtida(s): o OCR dirá que está indisponível em vez de fingir que funciona');
  process.exit(1);
}
