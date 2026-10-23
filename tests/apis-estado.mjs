/* =====================================================================
   FASE E1/E2 — CATÁLOGO DE APIs SEM CHAVE: estados, provas e reversibilidade

   O que se prova aqui, por palavras próprias:
   · os seis estados existem e a lista de transições é fechada — o que não está
     lá é recusado, mesmo que pareça razoável;
   · «validado» exige PROVA DE GERAÇÃO com pedido, resposta e latência; uma
     lista de modelos pública não valida nada;
   · «em uso» exige estar validado, a prova existente, dizer para que passo
     serve e confirmação explícita — validar não põe nada em uso;
   · reverter desfaz o último passo e fica no histórico (nada é apagado);
   · um relatório de sonda importa entradas para «em análise», NUNCA para
     «validado»/«em uso», e não reescreve decisões tomadas por uma pessoa;
   · as rotas fazem tudo isto a sério, com o histórico guardado entre pedidos.
   A sonda é substituída nos testes (nenhuma chamada externa): quando isso
   acontece, o registo diz «ensaio» e não «sonda».
   ===================================================================== */
import './_env.mjs';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../server/api.mjs';
import {
  API_STATES, STATE_IDS, TRANSITIONS, TRANSITION_RULES, validateProof, proofFromProbe,
  validateTransition, applyTransition, revertLast, mergeScan, summary, toPublic
} from '../server/apis-catalogo.mjs';

const R = [];
const t = async (name, fn) => {
  try { const d = await fn(); R.push({ ok: true, name, detail: d }); }
  catch (e) { R.push({ ok: false, name, detail: e.message, skip: e.skip }); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'falhou'); };

console.log('\n== FASE E · CATÁLOGO DE APIs SEM CHAVE (tests/apis-estado.mjs)\n');

/* ---------------- 1. a máquina de estados ---------------- */

const PROVA_OK = {
  tipo: 'geracao', em: '2026-10-23T10:00:00.000Z', origem: 'sonda', ok: true,
  pedido: { metodo: 'POST', url: 'https://exemplo.test/chat/completions', modelo: 'm-1', maxTokens: 1 },
  resposta: { status: 200, excerto: '{"choices":[{"message":{"content":"o"}}]}' },
  latenciaMs: 412,
  por: 'teste'
};

await t('os seis estados existem, com significado escrito e ordem', async () => {
  ok(STATE_IDS.length === 6, 'estados: ' + STATE_IDS.length);
  ['descoberto', 'em-analise', 'validado', 'em-uso', 'degradado', 'descontinuado']
    .forEach((s) => ok(STATE_IDS.includes(s), 'falta ' + s));
  API_STATES.forEach((s) => ok(s.meaning && s.meaning.length > 10, s.id + ' sem significado'));
  const ordens = API_STATES.map((s) => s.ordem);
  ok(ordens.join(',') === '1,2,3,4,5,6', 'ordem: ' + ordens.join(','));
  return STATE_IDS.join(' → ');
});

await t('a lista de transições é fechada e o descontinuado não salta para em-uso', async () => {
  const e = { estado: 'descontinuado', provas: [PROVA_OK], historico: [] };
  const r = validateTransition(e, 'em-uso', { motivo: 'x', confirmar: true, usaEm: 'tudo' });
  ok(!r.ok, 'aceitou descontinuado → em-uso');
  ok(/não permitida/.test(r.erros[0]), 'erro: ' + r.erros[0]);
  const e2 = { estado: 'descoberto', provas: [], historico: [] };
  ok(!validateTransition(e2, 'em-uso', { motivo: 'x', confirmar: true, usaEm: 'y' }).ok, 'saltou de descoberto para em-uso');
  ok(!validateTransition(e2, 'validado', { motivo: 'x', prova: PROVA_OK }).ok, 'saltou de descoberto para validado');
  ok(TRANSITIONS.descontinuado.join(',') === 'em-analise', 'descontinuado: ' + TRANSITIONS.descontinuado.join(','));
  return Object.keys(TRANSITIONS).length + ' estados com transições declaradas';
});

await t('sem motivo escrito nenhuma transição acontece', async () => {
  const e = { estado: 'descoberto', provas: [], historico: [] };
  const r = applyTransition(e, 'em-analise', {});
  ok(!r.ok && /motivo/.test(r.erros.join(' ')), 'aceitou sem motivo');
  const comMotivo = applyTransition(e, 'em-analise', { motivo: 'sondada' });
  ok(comMotivo.ok && comMotivo.entrada.estado === 'em-analise', 'recusou com motivo');
  ok(comMotivo.entrada.historico.length === 1, 'histórico vazio');
  return 'motivo obrigatório em todas as transições';
});

await t('«validado» exige prova de geração completa — pedido, resposta e latência', async () => {
  const e = { estado: 'em-analise', provas: [], historico: [] };
  const faltas = [
    ['sem prova', undefined],
    ['sem data', Object.assign({}, PROVA_OK, { em: '' })],
    ['sem pedido', Object.assign({}, PROVA_OK, { pedido: null })],
    ['http em vez de https', Object.assign({}, PROVA_OK, { pedido: Object.assign({}, PROVA_OK.pedido, { url: 'http://x/y' }) })],
    ['sem status', Object.assign({}, PROVA_OK, { resposta: { excerto: 'x' } })],
    ['sem excerto nem hash', Object.assign({}, PROVA_OK, { resposta: { status: 200 } })],
    ['sem latência', Object.assign({}, PROVA_OK, { latenciaMs: null })],
    ['não confirmada', Object.assign({}, PROVA_OK, { ok: false })]
  ];
  faltas.forEach(([nome, prova]) => {
    const r = validateTransition(e, 'validado', { motivo: 'x', prova });
    ok(!r.ok, 'aceitou prova ' + nome);
  });
  ok(validateTransition(e, 'validado', { motivo: 'x', prova: PROVA_OK }).ok, 'recusou a prova completa');
  return faltas.length + ' provas incompletas recusadas · 1 completa aceite';
});

await t('«em uso» exige validado + prova + confirmação + o passo onde é usada', async () => {
  const validado = { estado: 'validado', provas: [PROVA_OK], historico: [] };
  ok(!validateTransition(validado, 'em-uso', { motivo: 'x', usaEm: 'passo 1' }).ok, 'entrou em uso sem confirmação');
  ok(!validateTransition(validado, 'em-uso', { motivo: 'x', confirmar: true }).ok, 'entrou em uso sem dizer o passo');
  const r = validateTransition(validado, 'em-uso', { motivo: 'x', confirmar: true, usaEm: 'passo 1' });
  ok(r.ok, 'recusou o caso completo: ' + r.erros.join('; '));
  const semProva = { estado: 'validado', provas: [], historico: [] };
  ok(!validateTransition(semProva, 'em-uso', { motivo: 'x', confirmar: true, usaEm: 'passo 1' }).ok, 'entrou em uso sem prova');
  return 'confirmação + usaEm + prova obrigatórias';
});

await t('degradar exige falha observada com data; descontinuar exige motivo', async () => {
  const e = { estado: 'em-uso', provas: [PROVA_OK], historico: [] };
  ok(!validateTransition(e, 'degradado', { motivo: 'lento' }).ok, 'degradou sem falha observada');
  ok(!validateTransition(e, 'degradado', { motivo: 'lento', falha: { motivo: 'HTTP 500' } }).ok, 'degradou sem data da falha');
  ok(validateTransition(e, 'degradado', { motivo: 'lento', falha: { motivo: 'HTTP 500', em: '2026-10-23T12:00:00Z' } }).ok, 'recusou falha completa');
  ok(!validateTransition(e, 'descontinuado', {}).ok, 'descontinuou sem motivo');
  return 'falha datada obrigatória para degradar';
});

await t('reverter desfaz o último passo e deixa rasto (nada é apagado)', async () => {
  let e = { id: 'x', estado: 'descoberto', provas: [], historico: [] };
  e = applyTransition(e, 'em-analise', { motivo: 'sondada' }).entrada;
  e = applyTransition(e, 'validado', { motivo: 'prova', prova: PROVA_OK }).entrada;
  ok(e.estado === 'validado' && e.historico.length === 2, 'preparação');
  const r = revertLast(e, { motivo: 'a prova era de outro modelo' });
  ok(r.ok, 'não reverteu: ' + (r.erros || []).join('; '));
  ok(r.entrada.estado === 'em-analise', 'estado após reverter: ' + r.entrada.estado);
  ok(r.entrada.historico.length === 3, 'histórico após reverter: ' + r.entrada.historico.length);
  ok(r.entrada.historico[2].motivo === 'a prova era de outro modelo', 'motivo da reversão perdido');
  ok(!revertLast({ estado: 'descoberto', historico: [] }, {}).ok, 'reverteu sem haver o que reverter');
  return 'histórico de 3 passos · estado em análise';
});

await t('o resumo conta estados e provas sem inventar', async () => {
  const r = summary([
    { estado: 'em-uso', provas: [PROVA_OK] },
    { estado: 'validado', provas: [PROVA_OK] },
    { estado: 'em-analise', provas: [] },
    { estado: 'descoberto', provas: [] }
  ]);
  ok(r.total === 4 && r.emUso === 1 && r.validados === 2 && r.comProvaDeGeracao === 2, JSON.stringify(r));
  ok(Object.keys(r.porEstado).length === 6, 'estados no resumo: ' + Object.keys(r.porEstado).length);
  return JSON.stringify(r.porEstado);
});

/* ---------------- 2. importação do varrimento ---------------- */

const RELATORIO = {
  generatedAt: '2026-10-23T06:53:39.170Z',
  resultados: [
    { id: 'a-controlo', base: 'https://a.test', verdict: 'sem-chave', status: 200 },
    { id: 'b-fechado', base: 'https://b.test', verdict: 'exige-chave', status: 401 }
  ],
  geracao: { resultados: [
    { id: 'a-controlo', base: 'https://a.test', model: 'm', at: '2026-10-23T06:54:00.000Z',
      verdict: 'gera-sem-chave', status: 200, ms: 350, excerpt: '{"choices":[]}' }
  ] }
};

await t('importar o varrimento leva no máximo a «em análise» — nunca a validado', async () => {
  const r = mergeScan([], RELATORIO, { em: '2026-10-23T08:00:00.000Z', por: 'teste' });
  ok(r.entradas.length === 2, 'entradas: ' + r.entradas.length);
  const comProva = r.entradas.find((e) => e.id === 'a-controlo');
  const semProva = r.entradas.find((e) => e.id === 'b-fechado');
  ok(comProva.estado === 'em-analise', 'a-controlo: ' + comProva.estado);
  ok(semProva.estado === 'descoberto', 'b-fechado: ' + semProva.estado);
  ok(comProva.provas.length === 1 && comProva.provas[0].origem === 'varrimento-externo', 'prova externa não marcada');
  ok(!r.entradas.some((e) => e.estado === 'validado' || e.estado === 'em-uso'), 'o varrimento validou sozinho');
  return '2 entradas · 1 prova externa · 0 validadas';
});

await t('sincronizar de novo não reescreve o estado decidido por uma pessoa', async () => {
  const existentes = [{ id: 'a-controlo', estado: 'em-uso', provas: [], historico: [{ de: 'validado', para: 'em-uso', em: '2026-10-23T09:00:00Z', motivo: 'confirmado' }] }];
  const r = mergeScan(existentes, RELATORIO, { em: '2026-10-24T08:00:00.000Z' });
  const a = r.entradas.find((e) => e.id === 'a-controlo');
  ok(a.estado === 'em-uso', 'o varrimento reescreveu o estado: ' + a.estado);
  ok(a.provas.length === 1, 'a prova externa não foi acrescentada');
  ok(r.entradas.length === 2, 'entradas: ' + r.entradas.length);
  return 'estado mantido · prova externa acrescentada · ' + r.novas + ' nova(s)';
});

await t('a prova da sonda é construída a partir do que a sonda devolveu', async () => {
  const prova = proofFromProbe({ id: 'x', base: 'https://x.test/', model: 'm', at: '2026-10-23T10:00:00Z',
    verdict: 'gera-sem-chave', status: 200, ms: 512, excerpt: '{"choices":[]}', porque: 'HTTP 200' },
  { origem: 'sonda', por: 'u1' });
  ok(validateProof(prova).ok, 'prova inválida: ' + validateProof(prova).erros.join('; '));
  ok(prova.pedido.url === 'https://x.test/chat/completions', 'URL: ' + prova.pedido.url);
  ok(prova.latenciaMs === 512 && prova.resposta.status === 200, 'latência/status');
  const falhada = proofFromProbe({ base: 'https://x.test', verdict: 'exige-chave', status: 401, ms: 90 }, { origem: 'sonda' });
  ok(!validateProof(falhada).ok && /não confirma/.test(validateProof(falhada).erros.join(' ')), 'prova falhada passou como válida');
  return 'prova de geração completa a partir da sonda · ' + toPublic({ id: 'x', estado: 'validado', provas: [prova] }).estadoLabel;
});

/* ---------------- 3. servidor: operações reais, sonda substituída ---------------- */

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-apis-'));
let sondagens = 0;
const api = await createApi({
  dataDir: DIR, appSecret: 'segredo-de-teste-apis-1234567890', secure: false,
  /* sonda substituída: devolve uma geração confirmada. O registo fica marcado
     como «ensaio» — nunca se apresenta como medição feita em produção. */
  probeApi: async () => {
    sondagens++;
    return { id: 'a-controlo', base: 'https://a.test', model: 'm-1', at: new Date().toISOString(),
      verdict: 'gera-sem-chave', status: 200, ms: 321, excerpt: '{"choices":[{"message":{"content":"o"}}]}',
      porque: 'HTTP 200 com max_tokens:1 e sem Authorization' };
  }
});
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

const reg = await call('POST', '/api/auth/register', { email: 'apis' + Date.now() + '@ex.pt', password: 'SuiteForte-2026', name: 'APIs', acceptTerms: true });
ok(reg.status === 201 || reg.status === 200, 'registo: HTTP ' + reg.status + ' ' + reg.text.slice(0, 120));

await t('servidor · o catálogo começa vazio e diz como o encher', async () => {
  const r = await call('GET', '/api/apis/catalogo');
  ok(r.status === 200, 'HTTP ' + r.status);
  ok(r.json.entradas.length === 0, 'entradas: ' + r.json.entradas.length);
  ok(/sincronize/i.test(r.json.vazio || ''), 'sem instrução de como encher');
  ok(r.json.estados.length === 6, 'estados publicados: ' + r.json.estados.length);
  return '0 entradas · 6 estados · instrução presente';
});

await t('servidor · sincronizar importa o relatório guardado (sem validar nada)', async () => {
  const r = await call('POST', '/api/apis/catalogo/sincronizar', {});
  ok(r.status === 200, 'HTTP ' + r.status + ' ' + r.text.slice(0, 140));
  ok(r.json.total > 0, 'nada importado');
  const lista = await call('GET', '/api/apis/catalogo');
  ok(lista.json.resumo.emUso === 0, 'já há algo em uso depois de sincronizar');
  ok(lista.json.resumo.validados === 0, 'já há algo validado depois de sincronizar');
  return r.json.total + ' APIs · ' + r.json.novas + ' novas · 0 em uso';
});

await t('servidor · validar com sonda confirmada valida a API e marca a prova como ensaio', async () => {
  const alvo = (await call('GET', '/api/apis/catalogo')).json.entradas.find((e) => e.estado === 'em-analise') ||
    (await call('GET', '/api/apis/catalogo')).json.entradas[0];
  const r = await call('POST', '/api/apis/' + encodeURIComponent(alvo.id) + '/validar', {});
  ok(r.status === 200, 'HTTP ' + r.status + ' ' + r.text.slice(0, 160));
  ok(r.json.entrada.estado === 'validado', 'estado: ' + r.json.entrada.estado);
  ok(r.json.prova.origem === 'ensaio', 'origem da prova: ' + r.json.prova.origem);
  ok(r.json.prova.latenciaMs === 321 && r.json.prova.resposta.status === 200, 'prova incompleta');
  ok(/não põe a API em uso/.test(r.json.nota || ''), 'sem aviso de que validar não põe em uso');
  ok(sondagens === 1, 'sondagens: ' + sondagens);
  return alvo.id + ': ' + alvo.estado + ' → validado · prova de ensaio registada';
});

await t('servidor · validar não põe em uso; sem confirmação a operação é recusada', async () => {
  const alvo = (await call('GET', '/api/apis/catalogo')).json.entradas.find((e) => e.estado === 'validado');
  const semConfirmar = await call('POST', '/api/apis/' + encodeURIComponent(alvo.id) + '/uso', { usaEm: 'passos de IA' });
  ok(semConfirmar.status === 400, 'aceitou sem confirmação: HTTP ' + semConfirmar.status);
  ok(/confirmação/i.test(JSON.stringify(semConfirmar.json)), 'erro sem falar de confirmação');
  const ainda = await call('GET', '/api/apis/catalogo');
  ok(ainda.json.resumo.emUso === 0, 'entrou em uso sem confirmação');
  const comConfirmar = await call('POST', '/api/apis/' + encodeURIComponent(alvo.id) + '/uso', { confirmar: true, usaEm: 'passos de IA', motivo: 'teste' });
  ok(comConfirmar.status === 200 && comConfirmar.json.entrada.estado === 'em-uso', 'com confirmação: ' + comConfirmar.text.slice(0, 120));
  const depois = await call('GET', '/api/apis/catalogo');
  ok(depois.json.resumo.emUso === 1, 'em uso: ' + depois.json.resumo.emUso);
  return 'recusado sem confirmação · aceite com confirmação (1 em uso)';
});

await t('servidor · reverter devolve ao estado anterior e o histórico cresce', async () => {
  const alvo = (await call('GET', '/api/apis/catalogo')).json.entradas.find((e) => e.estado === 'em-uso');
  const r = await call('POST', '/api/apis/' + encodeURIComponent(alvo.id) + '/reverter', { motivo: 'teste de reversão' });
  ok(r.status === 200, 'HTTP ' + r.status + ' ' + r.text.slice(0, 160));
  ok(r.json.entrada.estado === 'validado', 'estado após reverter: ' + r.json.entrada.estado);
  ok(r.json.entrada.passos === (alvo.passos + 1), 'histórico não cresceu: ' + r.json.entrada.passos);
  const lista = await call('GET', '/api/apis/catalogo');
  ok(lista.json.resumo.emUso === 0, 'continua em uso depois de reverter');
  return 'em-uso → validado · histórico ' + r.json.entrada.passos + ' passos';
});

await t('servidor · API desconhecida e pedidos sem sessão são recusados', async () => {
  const inexistente = await call('POST', '/api/apis/nao-existe/validar', {});
  ok(inexistente.status === 404, 'HTTP ' + inexistente.status);
  const semSessao = await fetch(BASE + '/api/apis/catalogo');
  ok([401, 403].includes(semSessao.status), 'sem sessão: HTTP ' + semSessao.status);
  return '404 para API inexistente · 401 sem sessão';
});

await t('servidor · a sonda falhada fica registada e NÃO valida', async () => {
  const DIR2 = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-apis2-'));
  const api2 = await createApi({
    dataDir: DIR2, appSecret: 'segredo-de-teste-apis-2222222222', secure: false,
    probeApi: async () => ({ id: 'a-controlo', base: 'https://a.test', model: 'm-1', at: new Date().toISOString(),
      verdict: 'exige-chave', status: 401, ms: 88, excerpt: 'unauthorized', porque: 'HTTP 401 sem Authorization' })
  });
  const srv2 = http.createServer((q, r) => api2.handle(q, r, new URL(q.url, 'http://x')));
  await new Promise((r) => srv2.listen(0, '127.0.0.1', r));
  const B2 = 'http://127.0.0.1:' + srv2.address().port;
  let ck2 = ''; let cs2 = '';
  async function call2(m, p, b) {
    const h = { 'content-type': 'application/json' };
    if (ck2) h.cookie = ck2;
    if (cs2) h['x-csrf-token'] = cs2;
    const res = await fetch(B2 + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
    (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
      const [pair] = c.split(';'); const [k, v] = pair.split('=');
      if (k === 'vn_sid') ck2 = 'vn_sid=' + v;
      if (k === 'vn_csrf') { cs2 = v; ck2 = 'vn_csrf=' + v + (ck2 ? '; ' + ck2 : ''); }
    });
    const text = await res.text(); let json = null;
    try { json = JSON.parse(text); } catch { /* não JSON */ }
    return { status: res.status, json, text };
  }
  await call2('POST', '/api/auth/register', { email: 'apis2' + Date.now() + '@ex.pt', password: 'SuiteForte-2026', acceptTerms: true });
  await call2('POST', '/api/apis/catalogo/sincronizar', {});
  const alvo = (await call2('GET', '/api/apis/catalogo')).json.entradas[0];
  const r = await call2('POST', '/api/apis/' + encodeURIComponent(alvo.id) + '/validar', {});
  ok(r.status === 200, 'HTTP ' + r.status);
  ok(r.json.entrada.estado !== 'validado', 'validou com sonda recusada: ' + r.json.entrada.estado);
  ok(/não confirmou/.test(r.json.aviso || ''), 'sem aviso: ' + r.json.aviso);
  ok((r.json.entrada.provas || []).length >= 1, 'a prova falhada não ficou registada');
  srv2.close();
  return alvo.id + ': ' + r.json.entrada.estado + ' · prova falhada registada';
});

srv.close();
console.log('');
let pass = 0; let fail = 0;
R.forEach((x) => { if (x.ok) { pass++; console.log('PASS ' + x.name + (x.detail ? ' → ' + x.detail : '')); } else { fail++; console.log('FAIL ' + x.name + ' → ' + x.detail); } });
console.log('\n' + pass + '/' + (pass + fail) + ' passaram' + (fail ? ' · ' + fail + ' FALHARAM' : ''));
process.exit(fail ? 1 : 0);
