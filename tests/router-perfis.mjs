/* =====================================================================
   FASE E3/E4/E5 — ROUTER POR PERFIL E «TEXTO LIVRE NUNCA SERVE JSON»

   O que se prova aqui, por palavras próprias:
   · a política de cada perfil (rápida/normal/profunda/exaustiva) é explícita e
     a mesma pergunta, com o mesmo catálogo, escolhe fornecedores DIFERENTES —
     e diz porquê;
   · sem estado validado na aplicação ninguém é escolhido; sem latência medida
     ninguém é escolhido: a resposta honesta é «não há candidata», com a lista
     do que falta;
   · quem devolve texto livre — ou não tem prova de JSON — nunca serve um passo
     que exige JSON, por muito boa que seja a nota (E4);
   · «degradado» só entra sem alternativa, e o registo di-lo;
   · na aplicação, o fornecedor sem chave com produção medida em texto livre é
     EXCLUÍDO da cadeia de IA, com o motivo e a prova, em vez de gastar a
     chamada para falhar (E4/E5);
   · toda a decisão é determinística e traz alternativa e rejeitados.
   ===================================================================== */
import './_env.mjs';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../server/api.mjs';
import { PROFILE_POLICY, routeProvider, routeTable, normalizeCandidate, candidateFromProvider, ROUTER_VERSION } from '../server/router-perfis.mjs';
import { PROVIDERS } from '../server/providers.mjs';

const R = [];
const t = async (name, fn) => {
  try { const d = await fn(); R.push({ ok: true, name, detail: d }); }
  catch (e) { R.push({ ok: false, name, detail: e.message, skip: e.skip }); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'falhou'); };

console.log('\n== FASE E · ROUTER POR PERFIL (tests/router-perfis.mjs)\n');

/* Catálogo FIXO: nada aqui foi medido agora — é um cenário declarado, para que
   a regra possa ser provada sem depender de nenhum fornecedor real.
     rapido    latência 900 ms · qualidade 0.55 · custo 0.9 · JSON sim
     barato    latência 6400 ms · qualidade 0.70 · custo 0.1 · JSON sim
     bom       latência 12000 ms · qualidade 0.95 · custo 0.8 · JSON sim
     texto     latência 300 ms · qualidade 0.99 · custo 0.0 · JSON NÃO
     degradado latência 800 ms · qualidade 0.60 · custo 0.2 · estado degradado
     semestado latência 500 ms · estado em-análise                                */
const C = [
  { provider: 'rapido', estado: 'validado', latenciaMs: 900, qualidade: 0.55, custoPorMil: 0.9, produzJson: true },
  { provider: 'barato', estado: 'validado', latenciaMs: 6400, qualidade: 0.70, custoPorMil: 0.1, produzJson: true },
  { provider: 'bom', estado: 'validado', latenciaMs: 12000, qualidade: 0.95, custoPorMil: 0.8, produzJson: true },
  { provider: 'texto', estado: 'validado', latenciaMs: 300, qualidade: 0.99, custoPorMil: 0, produzJson: false },
  { provider: 'degradado', estado: 'degradado', latenciaMs: 800, qualidade: 0.60, custoPorMil: 0.2, produzJson: true },
  { provider: 'semestado', estado: 'em-analise', latenciaMs: 500, qualidade: 0.99, custoPorMil: 0.1, produzJson: true }
];

await t('os quatro perfis têm política declarada e diferente entre si', async () => {
  const perfis = Object.keys(PROFILE_POLICY);
  ok(perfis.join(',') === 'rapida,normal,profunda,exaustiva', 'perfis: ' + perfis.join(','));
  const criterios = new Set(perfis.map((p) => PROFILE_POLICY[p].criterio));
  ok(criterios.size >= 3, 'critérios distintos: ' + [...criterios].join(','));
  const tectos = perfis.map((p) => PROFILE_POLICY[p].latenciaMaxMs);
  ok(tectos.every((x, i) => i === 0 || x >= tectos[i - 1]), 'tectos fora de ordem: ' + tectos.join(','));
  return perfis.map((p) => p + '=' + PROFILE_POLICY[p].criterio + '/' + PROFILE_POLICY[p].latenciaMaxMs + 'ms').join(' · ');
});

await t('mesmo catálogo, perfis diferentes: rápida escolhe o mais rápido, exaustiva o melhor', async () => {
  const rapida = routeProvider({ perfil: 'rapida', passo: 'excertos', candidatos: C });
  const normal = routeProvider({ perfil: 'normal', passo: 'excertos', candidatos: C });
  const exaustiva = routeProvider({ perfil: 'exaustiva', passo: 'excertos', candidatos: C });
  ok(rapida.ok && normal.ok && exaustiva.ok, 'alguma decisão falhou: ' + [rapida.motivo, normal.motivo, exaustiva.motivo].join(' | '));
  ok(rapida.escolhido === 'rapido', 'rapida escolheu ' + rapida.escolhido);
  ok(normal.escolhido === 'barato', 'normal escolheu ' + normal.escolhido);
  ok(exaustiva.escolhido === 'bom', 'exaustiva escolheu ' + exaustiva.escolhido);
  ok(new Set([rapida.escolhido, normal.escolhido, exaustiva.escolhido]).size === 3, 'não houve diferença entre perfis');
  ok(rapida.razao.length >= 2 && /escolhido/.test(rapida.razao.join(' ')), 'sem razão registada');
  return 'rapida→' + rapida.escolhido + ' · normal→' + normal.escolhido + ' · exaustiva→' + exaustiva.escolhido;
});

await t('quem devolve texto livre nunca serve um passo que exige JSON (E4)', async () => {
  const r = routeProvider({ perfil: 'rapida', passo: 'excertos', candidatos: C });
  /* 'texto' é o mais rápido de todos: se a regra não valesse, ganhava */
  ok(r.escolhido !== 'texto', 'escolheu o fornecedor de texto livre');
  const rej = r.rejeitados.find((x) => x.provider === 'texto');
  ok(rej && /texto livre/.test(rej.motivo), 'rejeição não declarada: ' + JSON.stringify(rej));
  const semProva = routeProvider({ perfil: 'exaustiva', passo: 'excertos',
    candidatos: [{ provider: 'semprova', estado: 'validado', latenciaMs: 100, produzJson: null }] });
  ok(!semProva.ok && /não há prova de que devolva JSON/.test(semProva.motivo + '' + JSON.stringify(semProva.rejeitados)), 'aceitou quem não tem prova de JSON');
  const semExigencia = routeProvider({ perfil: 'exaustiva', passo: 'resumo-livre', candidatos: C, exigeJson: false });
  ok(semExigencia.ok && semExigencia.escolhido === 'texto', 'com exigeJson:false devia poder escolher o mais rápido: ' + semExigencia.escolhido);
  return 'texto livre rejeitado em passo JSON · aceite quando o passo não exige JSON';
});

await t('sem estado validado ou sem latência medida, o router NÃO escolhe', async () => {
  const semValidado = routeProvider({ perfil: 'normal', passo: 'excertos',
    candidatos: [{ provider: 'x', estado: 'em-analise', latenciaMs: 900, produzJson: true }] });
  ok(!semValidado.ok, 'escolheu um fornecedor em análise');
  ok(/não foi validada na aplicação/.test(JSON.stringify(semValidado.rejeitados)), 'motivo: ' + JSON.stringify(semValidado.rejeitados));
  const semLatencia = routeProvider({ perfil: 'normal', passo: 'excertos',
    candidatos: [{ provider: 'y', estado: 'validado', latenciaMs: null, produzJson: true }] });
  ok(!semLatencia.ok && /latência por medir/.test(JSON.stringify(semLatencia.rejeitados)), 'escolheu sem medição');
  const vazio = routeProvider({ perfil: 'normal', passo: 'excertos', candidatos: [] });
  ok(!vazio.ok && /não há candidatas/.test(vazio.motivo), 'inventou com catálogo vazio');
  const semPasso = routeProvider({ perfil: 'normal', candidatos: C });
  ok(!semPasso.ok && /sem passo/.test(semPasso.motivo), 'decidiu sem passo');
  const perfilMau = routeProvider({ perfil: 'turbo', passo: 'excertos', candidatos: C });
  ok(!perfilMau.ok && /perfil desconhecido/.test(perfilMau.motivo), 'aceitou perfil inventado');
  return '4 recusas honestas: em análise, sem latência, sem candidatas, perfil inventado';
});

await t('degradado só entra quando não há alternativa válida', async () => {
  const comAlternativa = routeProvider({ perfil: 'profunda', passo: 'excertos', candidatos: C });
  ok(comAlternativa.escolhido !== 'degradado', 'preferiu o degradado havendo válidos');
  const soDegradado = routeProvider({ perfil: 'profunda', passo: 'excertos',
    candidatos: [{ provider: 'degradado', estado: 'degradado', latenciaMs: 800, qualidade: 0.6, produzJson: true }] });
  ok(soDegradado.ok && soDegradado.escolhido === 'degradado' && soDegradado.degradado === true, 'não usou o degradado quando era o único');
  const naRapida = routeProvider({ perfil: 'rapida', passo: 'excertos',
    candidatos: [{ provider: 'degradado', estado: 'degradado', latenciaMs: 800, produzJson: true }] });
  ok(!naRapida.ok, 'o perfil rápido aceitou um degradado (política: não)');
  return 'degradado usado só como último recurso na profunda/exaustiva';
});

await t('a decisão é determinística: mesma entrada, mesma escolha, sempre', async () => {
  const inverso = C.slice().reverse();
  const a = routeProvider({ perfil: 'normal', passo: 'excertos', candidatos: C });
  const b = routeProvider({ perfil: 'normal', passo: 'excertos', candidatos: inverso });
  ok(a.escolhido === b.escolhido, 'a ordem do array mudou a escolha: ' + a.escolhido + ' vs ' + b.escolhido);
  const empate = [
    { provider: 'zzz', estado: 'validado', latenciaMs: 1000, qualidade: 0.5, produzJson: true },
    { provider: 'aaa', estado: 'validado', latenciaMs: 1000, qualidade: 0.5, produzJson: true }
  ];
  const e1 = routeProvider({ perfil: 'normal', passo: 'x', candidatos: empate });
  ok(e1.escolhido === 'aaa', 'desempate por id: ' + e1.escolhido);
  return 'empate resolvido por id · alternativa ' + e1.alternativa;
});

await t('a tabela perfil × passo existe e nenhum perfil inventa escolhas', async () => {
  const tabela = routeTable({ passos: ['interpretar', 'excertos'], candidatos: C });
  ok(Object.keys(tabela).length === 4, 'perfis na tabela: ' + Object.keys(tabela).length);
  Object.keys(tabela).forEach((p) => {
    ok(tabela[p].length === 2, p + ': linhas ' + tabela[p].length);
    tabela[p].forEach((l) => ok(l.ok ? !!l.escolhido : !!l.motivo, p + '/' + l.passo + ' sem escolha nem motivo'));
  });
  return '4 perfis × 2 passos com escolha ou motivo';
});

await t('na aplicação, o fornecedor de texto livre é excluído da cadeia com motivo e prova', async () => {
  ok(PROVIDERS.pollinations.produzJson === false, 'pollinations não está marcado como texto livre');
  ok(PROVIDERS.pollinations.produzJsonProva && /200/.test(PROVIDERS.pollinations.produzJsonProva.resultado),
    'a exclusão não tem prova registada');
  /* candidata construída do fornecedor real: o router recusa-a num passo JSON */
  const cand = candidateFromProvider('pollinations', PROVIDERS.pollinations, { estado: 'validado', latenciaMs: 900 });
  ok(cand.produzJson === false, 'a candidata não herdou produzJson:false');
  const r = routeProvider({ perfil: 'rapida', passo: 'excertos', candidatos: [cand] });
  ok(!r.ok && /texto livre/.test(JSON.stringify(r.rejeitados)), 'o router aceitou o fornecedor de texto livre');
  return 'produzJson:false com prova de ' + PROVIDERS.pollinations.produzJsonProva.em + ' · rejeitado num passo JSON';
});

/* ---------------- servidor ---------------- */

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-router-'));
const api = await createApi({ dataDir: DIR, appSecret: 'segredo-de-teste-router-1234567890', secure: false });
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
  const text = await res.text(); let json = null;
  try { json = JSON.parse(text); } catch { /* não JSON */ }
  return { status: res.status, json, text };
}
const reg = await call('POST', '/api/auth/register', { email: 'router' + Date.now() + '@ex.pt', password: 'SuiteForte-2026', acceptTerms: true });
ok(reg.status === 201 || reg.status === 200, 'registo: HTTP ' + reg.status);

await t('servidor · /api/ia/rotas publica política, passos de IA e a cadeia actual com exclusões', async () => {
  const r = await call('GET', '/api/ia/rotas');
  ok(r.status === 200, 'HTTP ' + r.status + ' ' + r.text.slice(0, 120));
  ok(Object.keys(r.json.politica).length === 4, 'perfis: ' + Object.keys(r.json.politica).length);
  ok(r.json.passosIA.length >= 8, 'passos de IA: ' + r.json.passosIA.length);
  ok(r.json.cadeiaActual.exigeJson === true, 'a cadeia não declara a exigência de JSON');
  const excl = r.json.cadeiaActual.excluidos.find((x) => x.provider === 'pollinations');
  ok(excl && /texto livre/.test(excl.motivo), 'pollinations não consta das exclusões: ' + JSON.stringify(r.json.cadeiaActual.excluidos));
  ok(excl.prova && excl.prova.em, 'exclusão sem prova datada');
  return r.json.passosIA.length + ' passos · 4 perfis · exclusão de pollinations com prova';
});

await t('servidor · a decisão por perfil responde com escolha ou com o que falta', async () => {
  const rapida = await call('GET', '/api/ia/rotas?perfil=rapida&passo=excertos');
  const exaustiva = await call('GET', '/api/ia/rotas?perfil=exaustiva&passo=excertos');
  ok(rapida.status === 200 && exaustiva.status === 200, 'HTTP ' + rapida.status + '/' + exaustiva.status);
  [rapida, exaustiva].forEach((r) => {
    const d = r.json.decisao;
    ok(d && d.perfil, 'decisão ausente');
    ok(d.ok ? !!d.escolhido : !!d.motivo, 'decisão sem escolha nem motivo');
    ok(Array.isArray(d.rejeitados), 'sem lista de rejeitados');
  });
  /* sem chaves nem testes de geração neste ambiente, a resposta honesta é
     «não há candidata» — e tem de dizer porquê, não inventar um fornecedor */
  ok(rapida.json.decisao.ok === false, 'escolheu um fornecedor sem medições na aplicação');
  ok(/validada|latência|não há candidatas/.test(JSON.stringify(rapida.json.decisao)), 'motivo sem dizer o que falta');
  const tabela = await call('GET', '/api/ia/rotas?perfil=normal');
  ok(tabela.json.tabela.length === rapida.json.passosIA.length, 'tabela do perfil com ' + tabela.json.tabela.length + ' linhas');
  return 'decisão honesta: ' + (rapida.json.decisao.motivo || '').slice(0, 80);
});

await t('servidor · /api/ai/estado mostra a cadeia com a exigência de JSON e o que excluiu', async () => {
  const r = await fetch(BASE + '/api/ai/estado');
  ok(r.status === 200, 'HTTP ' + r.status);
  const j = await r.json();
  ok(j.emRota && j.emRota.exigeJson === true, 'emRota sem exigência de JSON');
  ok(Array.isArray(j.emRota.excluidos) && j.emRota.excluidos.some((x) => x.provider === 'pollinations'), 'sem exclusão declarada');
  ok(!j.emRota.ordem.includes('pollinations'), 'pollinations continua na ordem utilizável');
  return 'ordem utilizável: [' + j.emRota.ordem.join(', ') + '] · excluído: ' + j.emRota.excluidos.map((x) => x.provider).join(',');
});

await t('servidor · /api/meta publica estados do catálogo e política do router', async () => {
  const r = await fetch(BASE + '/api/meta');
  const j = await r.json();
  ok(j.apiCatalog && j.apiCatalog.states.length === 6, 'estados no meta: ' + JSON.stringify(j.apiCatalog && j.apiCatalog.states));
  ok(j.router && j.router.version === ROUTER_VERSION, 'router no meta: ' + JSON.stringify(j.router && j.router.version));
  ok(j.router.policy.rapida.criterio === PROFILE_POLICY.rapida.criterio, 'política do perfil rápido diferente do módulo');
  return 'meta: ' + j.apiCatalog.states.length + ' estados · router ' + j.router.version;
});

srv.close();
console.log('');
let pass = 0; let fail = 0;
R.forEach((x) => { if (x.ok) { pass++; console.log('PASS ' + x.name + (x.detail ? ' → ' + x.detail : '')); } else { fail++; console.log('FAIL ' + x.name + ' → ' + x.detail); } });
console.log('\n' + pass + '/' + (pass + fail) + ' passaram' + (fail ? ' · ' + fail + ' FALHARAM' : ''));
process.exit(fail ? 1 : 0);
