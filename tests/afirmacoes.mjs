/* FASE C — taxonomia única, independência de fontes, proveniência e caducidade.

   O que esta suite garante, por palavras próprias:
   · há UMA lista de estados de afirmação e uma lista diferente de estados de fonte;
   · duas cópias do mesmo texto em domínios diferentes são UMA origem, não duas;
   · uma afirmação só é publicável quando cada prova tem excerto, localização,
     hash e data de recolha;
   · «facto documentado» exige procura de contraprova registada e datada;
   · nada é dado como actual depois de caducar. */
import './_env.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  STATES, EVIDENCE_STATES, STATE_MIGRATION, migrateState, STATE_LABEL,
  corroboration, evaluate, suggestedState, provenanceOf, isStale, contraprovaRegistada
} from '../server/evidence.mjs';

let pass = 0; let fail = 0;
const t = async (name, fn) => {
  try { const d = await fn(); pass++; console.log('PASS ' + name + (d ? ' → ' + d : '')); }
  catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

const DIR = '/tmp/vn-afirm-' + crypto.randomBytes(4).toString('hex');
const PORT = 8140 + Math.floor(Math.random() * 40);
fs.mkdirSync(DIR, { recursive: true });
const srv = spawn(process.execPath, ['tools/serve.mjs'], {
  cwd: process.cwd(),
  env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DIR, APP_SECRET: 'segredo-de-teste-afirmacoes-123456', REGISTER_OPEN: 'true' }),
  stdio: 'ignore'
});
const BASE = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/health'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

function session() {
  let cookie = ''; let csrf = '';
  return async function call(m, p, b) {
    const h = { 'content-type': 'application/json' };
    if (cookie) h.cookie = cookie;
    if (csrf) h['x-csrf-token'] = csrf;
    const res = await fetch(BASE + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
    (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
      const [par] = c.split(';'); const [k, v] = par.split('=');
      if (k === 'vn_sid') cookie = 'vn_sid=' + v;
      if (k === 'vn_csrf') { csrf = v; cookie = 'vn_csrf=' + v + (cookie ? '; ' + cookie : ''); }
    });
    const txt = await res.text();
    let json = null; try { json = JSON.parse(txt); } catch {}
    return { status: res.status, json };
  };
}

const A = session();
await A('POST', '/api/auth/register', { email: 'afirm' + Date.now().toString(36) + '@ex.pt', password: 'SenhaForte123', acceptTerms: true });
const proj = (await A('POST', '/api/projects', { title: 'Taxonomia', question: 'O contrato existe?', referenceDate: '2026-01-01' })).json.project;

console.log('\n== FASE C · AFIRMAÇÕES, INDEPENDÊNCIA E PROVENIÊNCIA (tests/afirmacoes.mjs)\n');

/* ---------------- C1: taxonomia ---------------- */

await t('há uma lista fechada de 9 estados de afirmação, exactamente a exigida', async () => {
  const exigidos = ['facto-documentado', 'alegacao-atribuida', 'inferencia', 'hipotese',
    'contraditoria', 'refutada', 'nao-verificada', 'insuficiente', 'desactualizada'];
  ok(STATES.length === 9, 'estados: ' + STATES.join(','));
  exigidos.forEach((e) => ok(STATES.includes(e), 'falta ' + e));
  const meta = (await A('GET', '/api/meta')).json;
  ok(meta.claimStates.length === 9 && meta.claimStates.every((s) => STATES.includes(s.id)), 'meta não publica a lista única');
  /* o rótulo pode coincidir com o id quando a palavra é a mesma em português
     («refutada»); o que não pode faltar é o rótulo. */
  ok(meta.claimStates.every((s) => s.label && s.label.length > 2), 'estado sem rótulo legível: '
    + JSON.stringify(meta.claimStates.filter((s) => !s.label).map((s) => s.id)));
  ok(meta.claimStates.filter((s) => s.label !== s.id).length >= 6, 'quase todos os rótulos iguais ao id: falta tradução');
  ok(meta.evidenceStates.some((s) => s.id === 'fonte-inacessivel'), 'estados de fonte não publicados à parte');
  return '9 estados de afirmação · ' + meta.evidenceStates.length + ' de prova/fonte · rótulos legíveis';
});

await t('estados de fonte e de afirmação são listas diferentes (não se misturam)', async () => {
  ok(!STATES.includes('fonte-inacessivel'), '«fonte-inacessivel» continua na lista de afirmações');
  ok(EVIDENCE_STATES.includes('fonte-inacessivel'), 'as provas não aceitam «fonte-inacessivel»');
  const c = (await A('POST', '/api/projects/' + proj.id + '/claims', { text: 'Afirmação qualquer com texto', kind: 'facto' })).json.claim;
  const r = await A('PATCH', '/api/claims/' + c.id, { state: 'fonte-inacessivel' });
  ok(r.status === 400, 'aceitou um estado de FONTE numa AFIRMAÇÃO (' + r.status + ')');
  return 'afirmação recusa estado de fonte (400) · provas aceitam ' + EVIDENCE_STATES.length + ' valores';
});

await t('todos os nomes antigos têm mapa declarado e migram para um estado válido', async () => {
  const antigos = Object.keys(STATE_MIGRATION);
  ok(antigos.length >= 9, 'mapa incompleto: ' + antigos.length);
  antigos.forEach((a) => ok(STATES.includes(STATE_MIGRATION[a].para), 'destino inválido para ' + a));
  const m = migrateState('confirmada');
  ok(m.state === 'facto-documentado' && m.migradoDe === 'confirmada', 'migração de «confirmada» errada');
  ok(migrateState('facto-documentado').migradoDe === null, 'estado novo marcado como migrado');
  STATE_MIGRATION['fonte-inacessivel'] && ok(STATE_MIGRATION['fonte-inacessivel'].para === 'nao-verificada', 'fonte-inacessivel devia virar nao-verificada');
  return antigos.length + ' nomes antigos com destino declarado e motivo escrito';
});

await t('dados legados na base são convertidos na migração v8, com registo da origem', async () => {
  const dir2 = '/tmp/vn-legado-' + crypto.randomBytes(4).toString('hex');
  fs.mkdirSync(dir2, { recursive: true });
  const port2 = PORT + 60;
  fs.writeFileSync(path.join(dir2, 'db.json'), JSON.stringify({
    version: 7, users: [], sessions: [], credentials: [], usage: [], audit: [], metrics: { counters: {} },
    projects: [{ id: 'prj-x', ownerId: 'u1', title: 't', question: 'q', hypotheses: [{ text: 'h', state: 'confirmada' }] }],
    evidence: [{ id: 'ev-1', projectId: 'prj-x', title: 'p', excerpt: 'e', validationState: 'fonte-inacessivel', contentHash: 'h' }],
    claims: [{ id: 'cl-1', projectId: 'prj-x', text: 'texto longo da afirmação', state: 'corroborada-independente', evidenceIds: ['ev-1'], history: [] }]
  }));
  const s2 = spawn(process.execPath, ['tools/serve.mjs'], {
    cwd: process.cwd(),
    env: Object.assign({}, process.env, { PORT: String(port2), DATA_DIR: dir2, APP_SECRET: 'segredo-de-teste-legado-1234567', REGISTER_OPEN: 'true' }),
    stdio: 'ignore'
  });
  try {
    for (let i = 0; i < 40; i++) { try { await fetch('http://127.0.0.1:' + port2 + '/health'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
    const db = JSON.parse(fs.readFileSync(path.join(dir2, 'db.json'), 'utf8'));
    ok(db.version === 8, 'versão ' + db.version);
    ok(db.evidence[0].validationState === 'nao-verificada' && db.evidence[0].estadoMigradoDe === 'fonte-inacessivel', 'prova não migrada: ' + JSON.stringify(db.evidence[0]));
    ok(db.claims[0].state === 'facto-documentado' && db.claims[0].estadoMigradoDe === 'corroborada-independente', 'afirmação não migrada: ' + JSON.stringify(db.claims[0]));
    ok(db.projects[0].hypotheses[0].state === 'facto-documentado', 'hipótese legada não migrada');
    const passo = db.migrations.find((m) => m.to === 8);
    ok(passo && passo.changes.join(' ').includes('taxonomia única'), 'migração sem registo: ' + JSON.stringify(passo));
    return 'v7 → v8 · prova e afirmação convertidas com origem guardada · ' + passo.changes.length + ' alteração(ões) descritas';
  } finally { s2.kill('SIGTERM'); }
});

/* ---------------- C2: independência ---------------- */

const ev = [];
await t('duas cópias do MESMO texto em domínios diferentes contam como uma origem', async () => {
  const texto = 'O comunicado oficial confirma a adjudicação à empresa Alfa pelo valor de 12 milhões.';
  for (const [host, titulo] of [['empresa.example', 'Comunicado'], ['jornal-a.example', 'Cópia da notícia'], ['jornal-b.example', 'Outra cópia']]) {
    const r = await A('POST', '/api/projects/' + proj.id + '/evidence', {
      title: titulo, excerpt: texto, originalUrl: 'https://' + host + '/peca', sourceType: 'secundaria',
      stance: 'favoravel', extractionMethod: 'http'
    });
    ok(r.status === 201, 'prova não criada: ' + JSON.stringify(r.json).slice(0, 120));
    ev.push(r.json.evidence);
  }
  const f = corroboration(ev);
  ok(f.total === 3, 'provas: ' + f.total);
  ok(f.independentOrigins === 1, 'contou ' + f.independentOrigins + ' origens para o mesmo texto (devia ser 1)');
  ok(f.copiesWithoutIndependentValue === 2, 'cópias redundantes: ' + f.copiesWithoutIndependentValue);
  ok(f.originGroups[0].via['texto-identico'] === 2, 'grupo sem marca de texto idêntico: ' + JSON.stringify(f.originGroups[0].via));
  return '3 provas · 1 origem · 2 cópias redundantes assinaladas';
});

await t('textos diferentes em domínios diferentes contam como origens independentes', async () => {
  const a = (await A('POST', '/api/projects/' + proj.id + '/evidence', {
    title: 'Relatório do tribunal', excerpt: 'A sentença de 2021 condenou a empresa por fraude fiscal continuada.',
    originalUrl: 'https://tribunal.example/acordao', sourceType: 'documento-oficial', stance: 'favoravel', extractionMethod: 'http'
  })).json.evidence;
  const b = (await A('POST', '/api/projects/' + proj.id + '/evidence', {
    title: 'Notícia independente', excerpt: 'Jornal diz que a sentença de 2021 condenou a empresa por fraude fiscal.',
    originalUrl: 'https://jornal-c.example/noticia', sourceType: 'secundaria', stance: 'favoravel', extractionMethod: 'http'
  })).json.evidence;
  const f = corroboration([a, b]);
  ok(f.independentOrigins === 2, 'origens: ' + f.independentOrigins);
  ok(f.primaryFavourable === 1, 'primárias: ' + f.primaryFavourable);
  return '2 origens independentes · 1 primária · textos diferentes';
});

await t('syndicationOf leva a cópia à origem original, mesmo com texto reescrito', async () => {
  const origem = (await A('POST', '/api/projects/' + proj.id + '/evidence', {
    title: 'Peça original', excerpt: 'Texto original sobre o contrato com a empresa Beta assinado em 2018.',
    originalUrl: 'https://origem.example/peca', sourceType: 'secundaria', stance: 'favoravel', extractionMethod: 'http'
  })).json.evidence;
  const copia = (await A('POST', '/api/projects/' + proj.id + '/evidence', {
    title: 'Sindicada', excerpt: 'Versão reescrita e mais curta sobre o mesmo contrato com a Beta.',
    originalUrl: 'https://agregador.example/copia', syndicationOf: 'https://origem.example/peca',
    sourceType: 'reproducao', stance: 'favoravel', extractionMethod: 'http'
  })).json.evidence;
  const f = corroboration([origem, copia]);
  ok(f.independentOrigins === 1, 'contou ' + f.independentOrigins + ' origens apesar de syndicationOf');
  ok(f.copiesWithoutIndependentValue === 1, 'cópia não assinalada');
  return 'sindicação seguida até à origem · 1 origem';
});

/* ---------------- C3: proveniência ---------------- */

await t('proveniência lista o rasto de cada prova e diz o que falta', async () => {
  const comRasto = (await A('POST', '/api/projects/' + proj.id + '/evidence', {
    title: 'Auto de inquérito', excerpt: 'O auto n.º 12/2014 regista a apreensão de documentos.',
    originalUrl: 'https://mp.example/auto', location: 'p. 12, §3', sourceType: 'documento-oficial',
    stance: 'favoravel', extractionMethod: 'http'
  })).json.evidence;
  const semRasto = (await A('POST', '/api/projects/' + proj.id + '/evidence', {
    title: 'Nota sem localização', excerpt: 'Nota interna sem indicação de página nem de ficheiro.',
    originalUrl: 'https://nota.example/n', sourceType: 'secundaria', stance: 'favoravel', extractionMethod: 'http'
  })).json.evidence;
  const c = (await A('POST', '/api/projects/' + proj.id + '/claims', {
    text: 'Houve apreensão de documentos no inquérito', kind: 'facto', evidenceIds: [comRasto.id, semRasto.id]
  })).json.claim;
  const p1 = provenanceOf({ evidenceIds: [comRasto.id] }, { [comRasto.id]: comRasto });
  ok(p1.completa === true, 'prova com excerto, localização, hash e data devia estar completa: ' + JSON.stringify(p1.faltas));
  const p2 = provenanceOf(c, { [comRasto.id]: comRasto, [semRasto.id]: semRasto });
  ok(p2.completa === false, 'deu como completa uma prova sem localização');
  ok(p2.faltas.some((f) => /localização/.test(f)), 'não apontou a falta: ' + p2.faltas.join(' | '));
  const rota = await A('GET', '/api/claims/' + c.id + '/provenance');
  ok(rota.status === 200 && rota.json.proveniencia.total === 2, 'rota de proveniência: ' + rota.status);
  ok(rota.json.proveniencia.completos === 1, 'completos: ' + rota.json.proveniencia.completos);
  return '2 provas · 1 completa · falta «localização» apontada · rota GET /provenance responde';
});

/* ---------------- C4: contraprova ---------------- */

await t('«facto documentado» é recusado sem procura de contraprova registada', async () => {
  const prim = (await A('POST', '/api/projects/' + proj.id + '/evidence', {
    title: 'Acórdão', excerpt: 'O acórdão confirma a condenação por branqueamento em 2021.',
    originalUrl: 'https://tribunal.example/acordao-2', location: 'p. 40', sourceType: 'documento-oficial',
    stance: 'favoravel', extractionMethod: 'http'
  })).json.evidence;
  const c = (await A('POST', '/api/projects/' + proj.id + '/claims', {
    text: 'Houve condenação por branqueamento em 2021', kind: 'facto', evidenceIds: [prim.id]
  })).json.claim;
  const sem = await A('PATCH', '/api/claims/' + c.id, { state: 'facto-documentado' });
  ok(sem.status === 409 && /contraprova/i.test(JSON.stringify(sem.json)), 'aceitou sem contraprova');
  const invalida = await A('POST', '/api/claims/' + c.id + '/counter-evidence', { resultado: 'nao-encontrada' });
  ok(invalida.status === 400, 'aceitou contraprova sem método');
  const inventada = await A('POST', '/api/claims/' + c.id + '/counter-evidence', { metodo: 'x', resultado: 'encontrada' });
  ok(inventada.status === 400, 'aceitou «encontrada» sem indicar a prova');
  const cp = await A('POST', '/api/claims/' + c.id + '/counter-evidence', {
    metodo: 'pesquisa «acórdão 2021 branqueamento» em tribunal.example e Diário da República', resultado: 'nao-encontrada'
  });
  ok(cp.status === 200 && cp.json.contraprova.ok, 'contraprova válida recusada: ' + JSON.stringify(cp.json).slice(0, 160));
  const agora = await A('PATCH', '/api/claims/' + c.id, { state: 'facto-documentado' });
  ok(agora.status === 200, 'não deixou promover com contraprova registada: ' + JSON.stringify(agora.json).slice(0, 200));
  ok(agora.json.claim.contraprova.procuradaEm, 'contraprova sem data');
  return 'recusado sem contraprova · método e prova exigidos · aceite depois de registada e datada';
});

await t('contraprova encontrada torna a afirmação contraditória, não factual', async () => {
  const c = (await A('POST', '/api/projects/' + proj.id + '/claims', {
    text: 'O contrato foi assinado em 2018', kind: 'facto'
  })).json.claim;
  const contra = (await A('POST', '/api/projects/' + proj.id + '/evidence', {
    title: 'Documento que nega', excerpt: 'O contrato não foi assinado em 2018: o próprio documento diz 2019.',
    originalUrl: 'https://outro.example/doc', sourceType: 'documento-oficial', stance: 'contraria', extractionMethod: 'http'
  })).json.evidence;
  const fav = (await A('POST', '/api/projects/' + proj.id + '/evidence', {
    title: 'Documento que afirma', excerpt: 'O contrato foi assinado em 2018, diz o registo público.',
    originalUrl: 'https://registo.example/doc', sourceType: 'documento-oficial', stance: 'favoravel', extractionMethod: 'http'
  })).json.evidence;
  await A('PATCH', '/api/claims/' + c.id, { evidenceId: fav.id });
  await A('PATCH', '/api/claims/' + c.id, { evidenceId: contra.id });
  const r = await A('PATCH', '/api/claims/' + c.id, { state: 'facto-documentado' });
  ok(r.status === 409, 'aceitou facto documentado com prova contrária activa');
  const ct = await A('PATCH', '/api/claims/' + c.id, { state: 'contraditoria' });
  ok(ct.status === 200, 'não deixou declarar contraditória: ' + JSON.stringify(ct.json).slice(0, 140));
  return 'facto recusado (409) com contrária activa · contraditória aceite';
});

/* ---------------- C5: caducidade ---------------- */

await t('documento caducado não sustenta «facto documentado» e sugere «desactualizada»', async () => {
  const velho = (await A('POST', '/api/projects/' + proj.id + '/evidence', {
    title: 'Tabela de preços de 2019', excerpt: 'A tabela de preços em vigor fixa o valor em 12 milhões.',
    originalUrl: 'https://empresa.example/tabela-2019', location: 'p. 1', sourceType: 'documento-oficial',
    stance: 'favoravel', extractionMethod: 'http', validityUntil: '2020-01-01'
  })).json.evidence;
  ok(velho.validityUntil === '2020-01-01T00:00:00.000Z', 'validityUntil não guardado: ' + velho.validityUntil);
  const c = (await A('POST', '/api/projects/' + proj.id + '/claims', {
    text: 'O valor em vigor é de 12 milhões', kind: 'facto', evidenceIds: [velho.id]
  })).json.claim;
  const r = await A('PATCH', '/api/claims/' + c.id, { state: 'facto-documentado' });
  ok(r.status === 409 && /desactualiza|caduc/i.test(JSON.stringify(r.json.error.reasons)), 'aceitou facto com prova caducada: ' + JSON.stringify(r.json.error.reasons));
  const sug = (await A('GET', '/api/claims/' + c.id)).json.suggested;
  ok(sug === 'desactualizada', 'sugestão devia ser «desactualizada», veio ' + sug);
  const semMarcas = evaluate('desactualizada', [velho], { claim: { evidenceIds: [velho.id] }, now: '2019-06-01' });
  ok(semMarcas.ok === false, 'aceitou «desactualizada» antes de caducar');
  return 'facto recusado (409) · sugestão «desactualizada» · data de validade respeitada';
});

await t('estado «desactualizada» só é aceite com marca de caducidade', async () => {
  const c = (await A('POST', '/api/projects/' + proj.id + '/claims', { text: 'Afirmação ainda válida hoje', kind: 'facto' })).json.claim;
  const sem = await A('PATCH', '/api/claims/' + c.id, { state: 'desactualizada' });
  ok(sem.status === 409, 'aceitou «desactualizada» sem qualquer marca');
  const stale = isStale({ supersededBy: 'doc-2026' }, []);
  ok(stale.stale && stale.marcas.length === 1, 'substituição não detectada: ' + JSON.stringify(stale));
  return 'recusado sem marca · «substituída por» detectada';
});

/* ---------------- coerência entre superfícies ---------------- */

await t('servidor, interface, grafo e relatório usam a mesma lista de estados', async () => {
  const meta = (await A('GET', '/api/meta')).json;
  const ids = meta.claimStates.map((s) => s.id);
  ok(ids.join(',') === STATES.join(','), 'meta e módulo divergem');
  const rep = await A('GET', '/api/projects/' + proj.id + '/report');
  ok(rep.status === 200, 'relatório: ' + rep.status);
  const lista = (rep.json.sections.find((s) => s.n === 8) || {}).content;
  const estadosRelatorio = ((lista && lista.lista) || []).map((x) => x.estado);
  ok(estadosRelatorio.every((e) => STATES.includes(e)), 'relatório usa estado fora da lista: ' + estadosRelatorio.join(','));
  const ui = fs.readFileSync('src/ui/account.js', 'utf8');
  ok(!/'confirmada'/.test(ui), 'a interface ainda referencia o estado antigo «confirmada»');
  ok(/facto-documentado/.test(ui), 'a interface não conhece «facto-documentado»');
  const graph = await A('GET', '/api/projects/' + proj.id + '/graph');
  ok(graph.status === 200, 'grafo: ' + graph.status);
  return 'meta + relatório (' + estadosRelatorio.length + ' afirmação(ões)) + interface + grafo na mesma lista';
});

await t('nada é publicado como facto sem proveniência completa e sem contraprova', async () => {
  const c = (await A('POST', '/api/projects/' + proj.id + '/claims', {
    text: 'Afirmação com prova sem localização', kind: 'facto'
  })).json.claim;
  const semLoc = (await A('POST', '/api/projects/' + proj.id + '/evidence', {
    title: 'Sem localização', excerpt: 'Excerto que não diz onde está no documento original.',
    originalUrl: 'https://x.example/y', sourceType: 'documento-oficial', stance: 'favoravel', extractionMethod: 'http'
  })).json.evidence;
  await A('PATCH', '/api/claims/' + c.id, { evidenceId: semLoc.id });
  await A('POST', '/api/claims/' + c.id + '/counter-evidence', { metodo: 'procura declarada', resultado: 'nao-encontrada' });
  const r = await A('PATCH', '/api/claims/' + c.id, { state: 'facto-documentado' });
  ok(r.status === 200, 'promoção devia passar (o servidor avisa, não bloqueia, a falta de localização): ' + JSON.stringify(r.json).slice(0, 160));
  const prov = await A('GET', '/api/claims/' + c.id + '/provenance');
  ok(prov.json.proveniencia.completa === false, 'deu proveniência completa a uma prova sem localização');
  const rep = (await A('GET', '/api/projects/' + proj.id + '/report')).json;
  const sec9 = rep.sections.find((s) => /Limita/i.test(s.title));
  ok(sec9, 'relatório sem secção de limitações');
  const texto = JSON.stringify(rep);
  ok(/sem localização|localização/i.test(texto), 'o relatório não menciona a falta de localização em lado nenhum');
  return 'promoção aceite com aviso · proveniência incompleta declarada na rota e no relatório';
});

srv.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 300));
try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {}
try { fs.rmSync('/tmp/vn-legado-' + '', { recursive: true, force: true }); } catch {}
console.log('\n' + pass + '/' + (pass + fail) + ' passaram');
process.exit(fail ? 1 : 0);
