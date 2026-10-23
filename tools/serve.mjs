import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handleFetchApi } from './fetch-api.mjs';
import { createApi } from '../server/api.mjs';
const root = process.cwd();
/* API do servidor (autenticação, projectos, fornecedores de IA, administração).
   Não interfere com os ficheiros estáticos: apenas /api/* e /health, /ready. */
const api = await createApi({
  dataDir: process.env.DATA_DIR || undefined,
  appSecret: process.env.APP_SECRET || '',
  adminEmail: process.env.ADMIN_EMAIL || '',
  secure: true
});
console.log('[api] pronta · cofre de chaves:', api.vault.enabled ? 'activo' : 'DESACTIVADO (' + api.vault.reason + ')');
if (!process.env.ADMIN_EMAIL) console.log('[api] ADMIN_EMAIL não definido: o primeiro registo não se torna administrador automaticamente');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8' };
createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname);
    if (p === '/api/fetch') return await handleFetchApi(req, res);
    if (p === '/health' || p === '/ready' || p.startsWith('/api/')) return await api.handle(req, res, u);
    if (p === '/robots.txt') {
      // o próprio servidor de desenvolvimento declara regras: nenhum rastreador deve tocar no agente
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('User-agent: *\nAllow: /\nDisallow: /api/fetch\n');
    }
    if (p === '/') p = '/index.html';
    const file = join(root, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not file');
    if (/[\\/]\.[^.]/.test(p)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404'); }
    const buf = await readFile(file);
    /* Embutir a aplicação num site alheio é clickjacking: com acções destrutivas
       (apagar conta, apagar chaves) o valor por omissão tem de ser 'self'. Quem
       precisar de pré-visualização embutida liga ALLOW_EMBED=1 e sabe o que faz. */
    const embutivel = String(process.env.ALLOW_EMBED || process.env.VN_ALLOW_EMBED || '') === '1';
    res.writeHead(200, {
      'content-type': types[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'permissions-policy': 'geolocation=(), camera=(), microphone=()',
      /* script-src sem 'unsafe-inline': não há scripts embutidos no HTML nem
         handlers onclick= (verificado) — todo o JS vem de ficheiros com src. */
      'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors " + (embutivel ? '*' : "'self'"),
      ...(embutivel ? {} : { 'x-frame-options': 'SAMEORIGIN' })
    });
    res.end(buf);
  } catch { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('404'); }
}).listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('serving on', process.env.PORT || 8080));
