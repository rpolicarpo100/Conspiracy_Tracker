/* =====================================================================
   PESQUISA NO TRABALHO DO UTILIZADOR — MOTOR E ROTA (fase 12)

   O que mudou e o que isto tem de provar:
     · antes: a consulta inteira era comparada como substring. «fundação
       calouste» e «financiou 2019» devolviam ZERO. Medido em
       tools/bench-search.mjs: 1/23 alvos no topo-5.
     · agora: termos independentes (E), "frases", -exclusão, prefixo a partir
       de 3 letras, acentos e caixa indiferentes, ordem por pontos explicáveis,
       alargamento a OU declarado, e o grafo (relações e entidades) incluído.

   Camadas:
     1. módulo  — dobra, tokens, análise da consulta, pontuação, recorte;
     2. rota    — com dados reais criados pela API, incluindo isolamento entre
                  contas e o orçamento de latência.
   ===================================================================== */
import './_env.mjs';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../server/api.mjs';
import { fold, tokens, parseQuery, pontuarTexto, pontuarItem, recorte, pesoRaridade, PESQUISA } from '../server/search.mjs';

const R = [];
const t = async (name, fn) => {
  try { const d = await fn(); R.push({ ok: true, name, detail: d }); }
  catch (e) { R.push({ ok: false, name, detail: e.message, skip: e.skip }); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'falhou'); };

/* ---------------------------------------------------------- 1. módulo */

await t('dobra · acentos fora e comprimento IGUAL (é o que alinha o recorte)', async () => {
  const casos = ['Misericórdia', 'ÀÉÎÕÜ', 'Fundação Calouste Gulbenkian', 'Construções do Tejo, SA', 'ação — coração'];
  casos.forEach((c) => ok(fold(c).length === c.length, 'comprimento mudou em ' + c));
  ok(fold('Misericórdia') === 'Misericordia', fold('Misericórdia'));
  ok(fold('ACÇÃO') === 'ACCAO', fold('ACÇÃO'));
  return casos.length + ' casos · comprimento preservado';
});

await t('tokens · palavras, números e posições reais no texto', async () => {
  const tk = tokens('Contrato nº 42/2019, Construções do Tejo');
  ok(tk.map((x) => x.t).join(' ') === 'contrato n 42 2019 construcoes do tejo', tk.map((x) => x.t).join(' '));
  ok('Contrato nº 42/2019, Construções do Tejo'.slice(tk[3].s, tk[3].e) === '2019', 'posição errada');
  return tk.length + ' tokens com posição';
});

await t('consulta · termos, "frases" e -exclusão são reconhecidos', async () => {
  const c = parseQuery('fundação "santa casa" -2018 gulbenkian');
  ok(c.termos.join(',') === 'fundacao,gulbenkian', 'termos: ' + c.termos.join(','));
  ok(c.termosPorFrase.join('|') === 'santa casa', 'frases: ' + c.termosPorFrase.join('|'));
  ok(c.negativos.join(',') === '2018', 'negativos: ' + c.negativos.join(','));
  ok(parseQuery('a o e').valido === false, 'consulta só com palavras curtas devia ser inválida');
  ok(parseQuery('de a o').valido === false, 'palavras vazias deviam ser descartadas');
  ok(parseQuery('Santa Casa da Misericórdia').termos.join(',') === 'santa,casa,misericordia', 'palavras vazias dentro de nomes');
  return '2 termos · 1 frase · 1 exclusão';
});

await t('pontuação · E por omissão, prefixo a partir de 3 letras, palavra inteira vale mais', async () => {
  const q = parseQuery('financiamento 2019');
  ok(!!pontuarTexto('o financiamento de 2019 foi aprovado', q), 'E falhou');
  ok(pontuarTexto('o financiamento foi aprovado', q) === null, 'aceitou texto sem o segundo termo');
  const inteira = pontuarTexto('financiamento aprovado', parseQuery('financiamento'));
  const prefixo = pontuarTexto('financiamento aprovado', parseQuery('financ'));
  ok(inteira.pontos > prefixo.pontos, 'palavra inteira não valeu mais: ' + inteira.pontos + ' vs ' + prefixo.pontos);
  ok(pontuarTexto('qualquer coisa', parseQuery('de')) === null, '«de» não devia casar');
  return 'inteira ' + inteira.pontos + ' > prefixo ' + prefixo.pontos;
});

await t('pontuação · frase exacta exige os termos seguidos; exclusão remove', async () => {
  ok(!!pontuarTexto('a santa casa da misericórdia', parseQuery('"santa casa"')), 'frase não encontrada');
  ok(pontuarTexto('a casa santa', parseQuery('"santa casa"')) === null, 'frase aceite fora de ordem');
  ok(pontuarTexto('isto é de 2018 e 2019', parseQuery('2019 -2018')) === null, 'exclusão ignorada');
  return 'frase e exclusão respeitadas';
});

await t('raridade · termo raro pesa mais do que termo comum, com tecto', async () => {
  ok(pesoRaridade(1, 100) === 4, 'raro: ' + pesoRaridade(1, 100));
  ok(pesoRaridade(100, 100) === 1, 'comum: ' + pesoRaridade(100, 100));
  ok(pesoRaridade(50, 100) > 1 && pesoRaridade(50, 100) < 4, 'meio: ' + pesoRaridade(50, 100));
  ok(pesoRaridade(0, 100) === 1, 'zero: ' + pesoRaridade(0, 100));
  return '1 · ' + pesoRaridade(50, 100).toFixed(2) + ' · 4';
});

await t('recorte · janela à volta do termo, alinhada mesmo com acentos antes', async () => {
  const texto = 'A Irmandade da Santa Casa da Misericórdia de Lisboa atribuiu um subsídio à associação em 2020.';
  const q = parseQuery('subsidio');
  const r = pontuarTexto(texto, q);
  const janela = recorte(texto, r.primeiro);
  ok(janela.indexOf('subsídio') >= 0, 'recorte não mostra a palavra: ' + janela);
  ok(janela.length <= PESQUISA.janelaRecorte + 4, 'recorte demasiado longo: ' + janela.length);
  return janela.slice(0, 60) + '…';
});

/* ---------------------------------------------------------- 2. rota */

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-pesquisa-'));
const api = await createApi({ dataDir: DIR, appSecret: 'segredo-de-teste-pesquisa-123456', secure: false });
const srv = http.createServer((q, r) => api.handle(q, r, new URL(q.url, 'http://x')));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + srv.address().port;
function sessao() {
  let cookie = ''; let csrf = '';
  return {
    async call(m, p, b) {
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
  };
}

const A = sessao();
await A.call('POST', '/api/auth/register', { email: 'pesq-a@ex.pt', password: 'SuiteForte-2026', acceptTerms: true });
const prj = (await A.call('POST', '/api/projects', {
  title: 'Quem financiou a Fundação Calouste Gulbenkian?',
  question: 'Que financiamentos existem entre 2018 e 2020?'
})).json.project;

const dados = [
  { excerpt: 'A Fundação Calouste Gulbenkian financiou o projecto em 2019 com 250 mil euros.', url: 'https://ex.pt/a' },
  { excerpt: 'O Ministério da Saúde transferiu verbas para a Administração Regional de Saúde do Norte em 2021.', url: 'https://ex.pt/b' },
  { excerpt: 'Contrato adjudicado por ajuste directo à Construções do Tejo, SA, em 2018.', url: 'https://ex.pt/c' }
];
const ids = [];
for (const d of dados) {
  const r = await A.call('POST', '/api/projects/' + prj.id + '/evidence', {
    title: 'Documento ' + ids.length, originalUrl: d.url, excerpt: d.excerpt, occurredAt: '2019-01-01T00:00:00Z', stance: 'favoravel'
  });
  ok(r.status === 201, 'prova: HTTP ' + r.status);
  ids.push(r.json.evidence.id);
}
/* uma relação e uma conclusão, para provar que o grafo entra na pesquisa */
await A.call('POST', '/api/projects/' + prj.id + '/relations', {
  from: 'Fundação Calouste Gulbenkian', to: 'Ministério da Saúde', type: 'financed',
  reasoning: 'transferência registada no relatório de contas', evidenceIds: [ids[0]]
});
await A.call('POST', '/api/projects/' + prj.id + '/claims', {
  text: 'A Gulbenkian financiou o projecto em 2019', kind: 'facto', state: 'alegacao-atribuida',
  evidenceIds: [ids[0]]
});

const busca = (q, extra) => A.call('GET', '/api/search?q=' + encodeURIComponent(q) + (extra || ''));

await t('rota · dois termos que não estão juntos encontram a prova (antes: 0)', async () => {
  const r = await busca('financiou 2019');
  ok(r.status === 200, 'HTTP ' + r.status);
  ok(r.json.total > 0, 'zero resultados para «financiou 2019»');
  ok(r.json.results.some((x) => x.id === ids[0]), 'não devolveu a prova certa');
  return r.json.total + ' resultados · prova certa presente';
});

await t('rota · acentos e caixa indiferentes nos dois sentidos', async () => {
  const a = await busca('Misericordia');
  const b = await busca('misericórdia');
  ok(a.json.total === b.json.total, 'totais diferentes: ' + a.json.total + ' vs ' + b.json.total);
  const c = await busca('GULBENKIAN');
  ok(c.json.total > 0, 'maiúsculas não encontram');
  return a.json.total + ' resultados iguais com e sem acento';
});

await t('rota · frase exacta e exclusão mudam o conjunto', async () => {
  const semFrase = await busca('santa casa');
  const comFrase = await busca('"santa casa da misericórdia"');
  ok(semFrase.json.total >= comFrase.json.total, 'frase alargou em vez de restringir');
  const com2019 = await busca('fundação 2019');
  const sem2019 = await busca('fundação 2019 -gulbenkian');
  ok(sem2019.json.total < com2019.json.total, 'exclusão não reduziu (' + com2019.json.total + '→' + sem2019.json.total + ')');
  return 'frase ' + comFrase.json.total + ' · exclusão ' + com2019.json.total + '→' + sem2019.json.total;
});

await t('rota · o título do projecto fica acima do excerto da prova (ordem explicável)', async () => {
  const r = await busca('Gulbenkian');
  const primeiro = r.json.results[0];
  ok(primeiro.type === 'project', 'primeiro resultado é ' + primeiro.type);
  ok(primeiro.pontos >= r.json.results[1].pontos, 'pontos fora de ordem');
  return 'projecto (' + primeiro.pontos + ' pts) antes de ' + r.json.results[1].type + ' (' + r.json.results[1].pontos + ' pts)';
});

await t('rota · a mesma coisa não entra duas vezes (título + excerto = um resultado)', async () => {
  const r = await busca('financiou');
  const chaves = r.json.results.map((x) => x.type + ':' + x.id);
  ok(new Set(chaves).size === chaves.length, 'resultados repetidos: ' + chaves.join(','));
  return r.json.total + ' resultados, todos distintos';
});

await t('rota · relações e entidades do grafo entram na pesquisa', async () => {
  const rel = await busca('financiou');
  const tipos = rel.json.counts || {};
  ok((tipos.relation || 0) > 0, 'nenhuma relação encontrada: ' + JSON.stringify(tipos));
  const ent = await busca('ministério');
  ok((ent.json.counts || {}).entity > 0, 'nenhuma entidade encontrada: ' + JSON.stringify(ent.json.counts));
  const item = rel.json.results.find((x) => x.type === 'relation');
  ok(/Fundação Calouste Gulbenkian → Ministério da Saúde/.test(item.excerpt), 'recorte da relação: ' + item.excerpt);
  return 'relation ' + tipos.relation + ' · entity ' + ent.json.counts.entity;
});

await t('rota · alargamento é declarado quando nenhum item tem todos os termos', async () => {
  const r = await busca('gulbenkian astronomia');
  ok(r.json.total > 0, 'devia alargar e encontrar algo');
  ok(r.json.widened === true, 'não declarou o alargamento');
  ok(r.json.results.some((x) => x.parcial), 'resultados sem marca de parcial');
  ok(/alarguei/.test(r.json.note), 'nota: ' + r.json.note);
  return r.json.total + ' resultados parciais, alargamento declarado';
});

await t('rota · consulta curta ou vazia é recusada com motivo', async () => {
  const curta = await busca('a');
  ok(curta.status === 400, 'HTTP ' + curta.status);
  const vazia = await busca('   ');
  ok(vazia.status === 400, 'HTTP ' + vazia.status);
  const semTermos = await busca('de a o');
  ok(semTermos.status === 400, 'HTTP ' + semTermos.status);
  return '400 nos três casos';
});

await t('rota · outra conta não vê nada deste trabalho', async () => {
  const B = sessao();
  await B.call('POST', '/api/auth/register', { email: 'pesq-b@ex.pt', password: 'SuiteForte-2026', acceptTerms: true });
  const r = await B.call('GET', '/api/search?q=' + encodeURIComponent('Gulbenkian'));
  ok(r.json.total === 0, 'outra conta viu ' + r.json.total + ' resultados');
  ok(r.json.projects === 0, 'outra conta contou ' + r.json.projects + ' projectos');
  return '0 resultados · 0 projectos para a segunda conta';
});

await t('rota · sem sessão a pesquisa não responde', async () => {
  const res = await fetch(BASE + '/api/search?q=teste');
  ok(res.status === 401, 'HTTP ' + res.status);
  return '401 sem sessão';
});

await t('rota · latência com 500 provas fica dentro do orçamento declarado', async () => {
  const alvo = await A.call('POST', '/api/projects', { title: 'Carga', question: 'carga' });
  const pid = alvo.json.project.id;
  const lote = [];
  for (let i = 0; i < 500; i++) {
    lote.push(A.call('POST', '/api/projects/' + pid + '/evidence', {
      title: 'Carga ' + i, originalUrl: 'https://carga.pt/' + i,
      excerpt: 'Texto de carga número ' + i + ' sobre financiamento e contrato público em 2019.',
      occurredAt: '2019-01-01T00:00:00Z', stance: 'favoravel'
    }));
    if (lote.length === 50) { await Promise.all(lote); lote.length = 0; }
  }
  await Promise.all(lote);
  const tempos = [];
  for (const q of ['financiamento 2019', 'contrato público', 'carga 42', 'gulbenkian']) {
    const t0 = Date.now(); await busca(q); tempos.push(Date.now() - t0);
  }
  const max = Math.max.apply(null, tempos);
  ok(max < 1500, 'demasiado lento: ' + max + ' ms (' + tempos.join('/') + ')');
  return 'pior caso ' + max + ' ms com ' + (500 + 3) + ' provas';
});

srv.close();
await new Promise((r) => setTimeout(r, 200));
try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* fica */ }

let pass = 0, fail = 0;
console.log('PESQUISA NO TRABALHO DO UTILIZADOR (FASE 12)\n');
R.forEach((r) => {
  if (r.ok) { pass++; console.log('PASS ' + r.name + (r.detail ? ' → ' + r.detail : '')); }
  else { fail++; console.log('FAIL ' + r.name + ' → ' + r.detail); }
});
console.log('\n' + pass + '/' + R.length + ' passaram');
process.exit(fail ? 1 : 0);
