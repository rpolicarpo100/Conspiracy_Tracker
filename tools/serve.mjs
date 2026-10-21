import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handleFetchApi } from './fetch-api.mjs';
const root = process.cwd();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8' };
createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname);
    if (p === '/api/fetch') return await handleFetchApi(req, res);
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
    res.writeHead(200, {
      'content-type': types[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      // sem X-Frame-Options: a aplicação é feita para ser embutida (pré-visualizações)

      'permissions-policy': 'geolocation=(), camera=(), microphone=()',
      'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors *"
    });
    res.end(buf);
  } catch { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('404'); }
}).listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('serving on', process.env.PORT || 8080));
