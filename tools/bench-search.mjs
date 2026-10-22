/* =====================================================================
   BANCADA DA PESQUISA DO SERVIDOR (GET /api/search)

   Mede duas coisas que se podem medir — e não «sensação de relevância»:
     · EFICÁCIA  — para cada consulta com resposta conhecida (a prova que
                   contém os termos), o alvo aparece nos primeiros k?
     · EFICIÊNCIA— latência por consulta com um corpus de tamanho declarado.

   Uso:
     node tools/bench-search.mjs [--projectos=20] [--provas=250] [--k=5]

   Corre contra um servidor em processo (dados num directório temporário,
   apagado no fim). Não toca em produção nem na base real.
   ===================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../server/api.mjs';

process.env.REGISTER_OPEN = 'true';
const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : d; };
const P = Number(arg('projectos', '20'));
const E = Number(arg('provas', '250'));
const K = Number(arg('k', '5'));

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-bench-pesquisa-'));
const api = await createApi({ dataDir: DIR, appSecret: 'segredo-de-bancada-1234567890', secure: false, exposeStore: true });
const srv = http.createServer((q, r) => api.handle(q, r, new URL(q.url, 'http://x')));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + srv.address().port;
let cookie = ''; let csrf = '';
async function call(m, p, b) {
  const h = { 'content-type': 'application/json' };
  if (cookie) h.cookie = cookie;
  if (csrf) h['x-csrf-token'] = csrf;
  const res = await fetch(BASE + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
  (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
    const [pair] = c.split(';'); const [k, v] = pair.split('=');
    if (k === 'vn_sid') cookie = 'vn_sid=' + v;
    if (k === 'vn_csrf') { csrf = v; cookie = 'vn_csrf=' + v + (cookie ? '; ' + cookie : ''); }
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* não JSON */ }
  return { status: res.status, json, text };
}

await call('POST', '/api/auth/register', { email: 'bancada@ex.pt', password: 'SuiteForte-2026', acceptTerms: true });

/* Corpus: 6 famílias de frase, com acentos, plurais, nomes próprios e datas.
   O alvo de cada consulta é uma prova que EXISTE — não se procura o nada. */
const FAMILIAS = [
  { id: 'gulbenkian', texto: 'A Fundação Calouste Gulbenkian financiou o projecto em 2019 com 250 mil euros, segundo o relatório de contas.',
    consultas: ['gulbenkian', 'fundação calouste', 'financiou 2019', 'fundacao gulbenkian', 'financ'] },
  { id: 'misericordia', texto: 'A Irmandade da Santa Casa da Misericórdia de Lisboa atribuiu um subsídio à associação em 2020.',
    consultas: ['misericórdia', 'santa casa lisboa', 'misericordia lisboa', 'subsídio 2020'] },
  { id: 'tejo', texto: 'Contrato público adjudicado à empresa Construções do Tejo, SA, por ajuste directo, conforme o portal BASE.',
    consultas: ['tejo', 'construções tejo', 'ajuste directo', 'contrato público adjudicado'] },
  { id: 'saude', texto: 'O Ministério da Saúde transferiu verbas para a Administração Regional de Saúde do Norte em 2021.',
    consultas: ['ministério saúde', 'administração regional norte', 'verbas 2021', 'transferiu verbas'] },
  { id: 'banca', texto: 'O Banco de Portugal aplicou uma coima por incumprimento na prevenção do branqueamento de capitais.',
    consultas: ['banco portugal', 'coima branqueamento', 'prevenção capitais'] },
  { id: 'camara', texto: 'A Câmara Municipal de Lisboa aprovou a deliberação que autoriza a permuta de terrenos municipais.',
    consultas: ['câmara lisboa', 'permuta terrenos', 'deliberação municipal'] }
];

const t0 = Date.now();
const alvos = new Map();     // consulta → [ids de prova que devem aparecer]
for (let i = 0; i < P; i++) {
  const fam = FAMILIAS[i % FAMILIAS.length];
  const prj = (await call('POST', '/api/projects', {
    title: 'Investigação ' + i + ' — ' + fam.id, question: 'Que instituições aparecem no dossiê ' + fam.id + '?'
  })).json.project;
  for (let j = 0; j < E; j++) {
    const f = FAMILIAS[(i + j) % FAMILIAS.length];
    const r = await call('POST', '/api/projects/' + prj.id + '/evidence', {
      title: 'Documento ' + j + ' do dossiê ' + f.id,
      originalUrl: 'https://exemplo.pt/' + f.id + '/' + i + '/' + j,
      /* código único e atómico (um token, sem prefixo partilhado com palavras): é
         o que permite testar «este item e só este» sem ambiguidade */
      excerpt: f.texto + ' Código ZQ' + i + 'X' + j + '.',
      occurredAt: '20' + (19 + (j % 5)) + '-0' + ((j % 9) + 1) + '-01T00:00:00Z',
      stance: 'favoravel'
    });
    const idEv = r.json && r.json.evidence && r.json.evidence.id;
    if (idEv) {
      if (!alvos.has('precisao')) alvos.set('precisao', []);
      alvos.get('precisao').push(idEv);
      /* consulta que junta a frase da família a uma referência única: aqui o
         alvo tem de ficar no topo, porque só uma prova tem aquela referência */
      if (j % 9 === 0) alvos.set(f.id + ' zq' + i + 'x' + j, [idEv]);
    }
  }
}
const criacao = Date.now() - t0;
const totalProvas = api.store.data.evidence.length;

console.log('corpus: ' + P + ' projectos · ' + totalProvas + ' provas · criado em ' + criacao + ' ms\n');
console.log('consulta'.padEnd(34) + 'total'.padStart(6) + '  tempo'.padStart(8) + '  alvo@' + K);

let comAlvo = 0, acertos = 0, lat = 0, consultasComAlvo = 0, precisaoOk = 0, precisaoTotal = 0;
const linhas = [];
for (const [q, esperados] of alvos) {
  if (q === 'precisao') continue;
  const t = Date.now();
  const r = await call('GET', '/api/search?q=' + encodeURIComponent(q) + '&limit=' + K);
  const ms = Date.now() - t;
  lat += ms; consultasComAlvo += 1;
  const j = r.json || {};
  const ids = (j.results || []).map((x) => x.id);
  const achou = esperados.some((e) => ids.indexOf(e) >= 0);
  if (esperados.length) { comAlvo += 1; if (achou) acertos += 1; }
  linhas.push([q, j.total == null ? r.status : j.total, ms, achou]);
  if (!achou) console.log('  [falhou] ' + q + ' · total=' + j.total + ' · topo=' + (j.results || []).slice(0, 3).map((x) => x.type + ':' + x.id + ' p' + x.pontos).join(' '));
}

/* precisão: cada resultado devolvido tem mesmo os termos? (prova-se pelo recorte
   e pelo campo; aqui usam-se consultas amplas e verifica-se o texto do item) */
const amplas = ['financiou 2019', 'ministério saúde', 'ajuste directo', 'banco portugal', 'câmara lisboa', 'santa casa lisboa'];
for (const q of amplas) {
  const r = await call('GET', '/api/search?q=' + encodeURIComponent(q) + '&limit=20');
  const termos = q.split(/\s+/).map((x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
  for (const item of (r.json.results || [])) {
    precisaoTotal += 1;
    const txt = String(item.excerpt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    /* o recorte mostra o campo que casou; exigir os dois termos aqui só é
       possível quando o campo escolhido é o mesmo — conta-se como falha
       apenas se NENHUM termo aparecer */
    if (termos.some((t) => txt.indexOf(t.slice(0, Math.min(t.length, 8))) >= 0)) precisaoOk += 1;
  }
  linhas.push([q + ' (amplo)', r.json.total, '-', null]);
}

for (const [q, total, ms, achou] of linhas) {
  console.log(String(q).padEnd(34) + String(total).padStart(6) + String(ms === '-' ? '' : ms + ' ms').padStart(9) + (achou == null ? '' : '  ' + (achou ? 'sim' : 'NÃO')));
}
console.log('\nalvo no topo-' + K + ': ' + acertos + '/' + comAlvo + ' consultas com referência única' +
  ' · latência média: ' + Math.round(lat / Math.max(1, consultasComAlvo)) + ' ms' +
  ' · recortes coerentes: ' + precisaoOk + '/' + precisaoTotal);

/* cauda de latência com um termo muito frequente */
const tq = [];
for (let i = 0; i < 10; i++) { const t = Date.now(); await call('GET', '/api/search?q=documento&limit=30'); tq.push(Date.now() - t); }
tq.sort((a, b) => a - b);
console.log('termo frequente «documento»: p50 ' + tq[5] + ' ms · máx ' + tq[9] + ' ms');

srv.close();
await new Promise((r) => setTimeout(r, 300));
try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* fica para o sistema */ }
