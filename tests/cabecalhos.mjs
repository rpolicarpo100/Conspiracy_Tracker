/* Cabeçalhos de segurança servidos por tools/serve.mjs (o servidor de produção
   do Render e o servidor de desenvolvimento).

   Existe porque uma promessa sem teste é uma intenção: se alguém repuser
   'unsafe-inline' ou 'frame-ancestors *', ninguém daria por isso. */
import { spawn } from 'node:child_process';
import net from 'node:net';

let pass = 0; let fail = 0;
const t = async (name, fn) => {
  try { const d = await fn(); pass++; console.log('PASS ' + name + (d ? ' → ' + d : '')); }
  catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

const portaLivre = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

console.log('\n== CABEÇALHOS DE SEGURANÇA (tests/cabecalhos.mjs)\n');

const variante = async (embutivel) => {
  const porta = await portaLivre();
  const env = Object.assign({}, process.env, { PORT: String(porta) });
  if (embutivel) env.ALLOW_EMBED = '1'; else delete env.ALLOW_EMBED;
  const filho = spawn(process.execPath, ['tools/serve.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let erroArranque = '';
  filho.stderr.on('data', (d) => { erroArranque += String(d); });
  await new Promise((r) => setTimeout(r, 700));
  const pedir = async () => {
    const r = await fetch('http://127.0.0.1:' + porta + '/');
    ok(r.status === 200, 'HTTP ' + r.status + ' ' + erroArranque.slice(0, 120));
    return r;
  };
  try {
    if (!embutivel) {
      await t('por omissão: sem script inline, sem embutir em site alheio e com HSTS', async () => {
        const r = await pedir();
        const csp = r.headers.get('content-security-policy') || '';
        ok(/script-src 'self'/.test(csp), 'script-src: ' + csp);
        ok(!/script-src[^;]*unsafe-inline/.test(csp), 'script-src permitiu inline: ' + csp);
        ok(/frame-ancestors 'self'/.test(csp), 'frame-ancestors: ' + csp);
        ok(r.headers.get('x-frame-options') === 'SAMEORIGIN', 'x-frame-options: ' + r.headers.get('x-frame-options'));
        ok(/max-age=31536000/.test(r.headers.get('strict-transport-security') || ''), 'sem HSTS');
        ok(r.headers.get('x-content-type-options') === 'nosniff', 'sem nosniff');
        ok(r.headers.get('referrer-policy') === 'no-referrer', 'sem referrer-policy');
        return 'script-src self · frame-ancestors self · XFO SAMEORIGIN · HSTS 1 ano · nosniff';
      });
    } else {
      await t('ALLOW_EMBED=1: só então a aplicação aceita ser embutida (pré-visualizações)', async () => {
        const r = await pedir();
        const csp = r.headers.get('content-security-policy') || '';
        ok(/frame-ancestors \*/.test(csp), 'frame-ancestors: ' + csp);
        ok(!r.headers.get('x-frame-options'), 'XFO presente apesar de embutível');
        ok(/script-src 'self'/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp), 'script-src relaxou com ALLOW_EMBED: ' + csp);
        return 'frame-ancestors * só com ALLOW_EMBED=1, sem XFO e sem afrouxar o script-src';
      });
    }
  } finally {
    filho.kill();
    await new Promise((r) => setTimeout(r, 150));
  }
};

await variante(false);
await variante(true);

console.log('\n' + pass + '/' + (pass + fail) + ' passaram');
process.exit(fail ? 1 : 0);
