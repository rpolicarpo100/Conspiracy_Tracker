/* =====================================================================
   P2 — registo de provas, corroboração independente, estados das conclusões,
   ciclo de vida do projecto e migração do esquema.

   Cada teste verifica comportamento do SERVIDOR, não da interface: o cliente
   pede, o servidor decide. Corre contra uma instância própria e isolada.
   ===================================================================== */
import './_env.mjs';   // opt-in explícito: registo aberto só nos testes (ver tests/_env.mjs)
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const PORT = 8700 + Math.floor(Math.random() * 200);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = '/tmp/vn-ev-' + crypto.randomBytes(4).toString('hex');
const srv = spawn(process.execPath, ['tools/serve.mjs'], {
  cwd: process.cwd(),
  env: Object.assign({}, process.env, {
    PORT: String(PORT), DATA_DIR: DATA, APP_SECRET: 'segredo-de-teste-ev-1234567890ab',
    REGISTER_MAX: '500', LOGIN_MAX_ATTEMPTS: '500'
  }),
  stdio: 'ignore'
});
await new Promise((r) => setTimeout(r, 1600));

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { const d = await fn(); pass++; console.log('PASS ' + name + (d ? ' → ' + d : '')); }
  catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); }
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

/* --- cliente HTTP com cookies e CSRF --- */
function session() {
  let cookie = '', csrf = '';
  async function call(method, path2, body) {
    const headers = { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    if (csrf) headers['x-csrf-token'] = csrf;
    const res = await fetch(BASE + path2, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    set.forEach((c) => {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (k === 'vn_sid') cookie = 'vn_sid=' + v;
      if (k === 'vn_csrf') { csrf = v; cookie += '; vn_csrf=' + v; }
    });
    let json = null;
    try { json = await res.json(); } catch { /* resposta sem corpo */ }
    return { status: res.status, json };
  }
  return {
    call,
    async register(email) {
      const r = await call('POST', '/api/auth/register', { email, password: 'SenhaForte123', acceptTerms: true });
      ok(r.status === 201, 'registo falhou: ' + r.status + ' ' + JSON.stringify(r.json));
      return r.json.user;
    }
  };
}

const A = session();
const B = session();
const emailA = 'ev' + Date.now().toString(36) + 'a@ex.pt';
const emailB = 'ev' + Date.now().toString(36) + 'b@ex.pt';
await A.register(emailA);
await B.register(emailB);

const proj = (await A.call('POST', '/api/projects', {
  title: 'Caso de teste P2',
  question: 'As provas sustentam a alegação?',
  objective: 'Testar o registo de provas e a corroboração',
  scope: { geo: 'PT', languages: ['pt', 'en'], period: { from: '2020-01-01', to: '2024-12-31' } },
  keywords: ['teste', 'provas'],
  hypotheses: [{ text: 'A alegação é verdadeira', status: 'a-testar' }],
  completionCriteria: ['duas origens independentes'],
  budget: { maxCalls: 10, maxDocuments: 5, maxMinutes: 5, maxCost: 0 },
  referenceDate: '2024-12-31', timeLimit: '30 dias'
})).json.project;

console.log('\n== P2 · PROVAS, CORROBORAÇÃO E CONCLUSÕES (tests/evidence.mjs)\n');

await t('projecto guarda o objecto de investigação completo', async () => {
  const r = await A.call('GET', '/api/projects/' + proj.id);
  const p = r.json.project;
  ok(p.question && p.objective, 'pergunta/objectivo ausentes');
  ok(p.scope.geo === 'PT' && p.scope.languages.length === 2, 'âmbito não guardado');
  ok(p.hypotheses.length === 1 && p.hypotheses[0].state === 'hipotese', 'hipótese devia nascer como hipótese');
  ok(p.completionCriteria.length === 1 && p.referenceDate === '2024-12-31', 'critérios/data de referência ausentes');
  ok(p.budget.maxCalls === 10 && p.timeLimit === '30 dias', 'orçamento/limite temporal ausentes');
  return 'pergunta, âmbito, hipótese (hipotese), critérios, orçamento e data de referência presentes';
});

await t('hipótese não sobe a facto sem passar pelas regras do servidor', async () => {
  const r = await A.call('PATCH', '/api/projects/' + proj.id, { hypotheses: [{ text: 'A alegação é verdadeira', state: 'confirmada' }] });
  const h = r.json.project.hypotheses[0];
  ok(h.state === 'hipotese', 'o servidor aceitou uma hipótese «confirmada» vinda do cliente');
  return 'estado forçado no corpo do pedido é ignorado';
});

/* --- provas --- */
const evBase = {
  title: 'Relatório oficial de 2021', author: 'Autoridade X', excerpt: 'O relatório confirma o valor de 12 milhões de euros.',
  originalUrl: 'https://exemplo.pt/relatorio?utm_source=news&utm_medium=email', sourceType: 'primaria',
  stance: 'favoravel', extractionMethod: 'manual', language: 'pt',
  publicationDate: '2021-03-04', eventDate: '2021-02-01', entities: ['Entidade X'],
  limitations: 'cópia digital sem anexos'
};
let evPrimary, evCopy, evSecondary, evContrary;

await t('prova primária é aceite com hash, URL canónico e origem', async () => {
  const r = await A.call('POST', '/api/projects/' + proj.id + '/evidence', evBase);
  ok(r.status === 201, 'resposta ' + r.status + ' ' + JSON.stringify(r.json));
  evPrimary = r.json.evidence;
  ok(/^[0-9a-f]{64}$/.test(evPrimary.contentHash), 'sem hash SHA-256');
  ok(evPrimary.canonicalUrl === 'https://exemplo.pt/relatorio', 'URL canónico errado: ' + evPrimary.canonicalUrl);
  ok(!/utm_/.test(r.json.evidence.originalUrl || '') === false, 'UTM devia ficar no original e sair do canónico');
  ok(evPrimary.originKey === 'src:exemplo.pt', 'origem inesperada: ' + evPrimary.originKey);
  ok(evPrimary.validationState === 'insuficiente', 'devia começar em «insuficiente», não em ' + evPrimary.validationState);
  return 'hash ' + evPrimary.contentHash.slice(0, 12) + '… · canónico ' + evPrimary.canonicalUrl + ' · origem ' + evPrimary.originKey;
});

await t('prova sem excerto é recusada (não se verifica o que não se citou)', async () => {
  const r = await A.call('POST', '/api/projects/' + proj.id + '/evidence', { title: 'Sem excerto', originalUrl: 'https://exemplo.pt/x' });
  ok(r.status === 400 && /excerpt/.test(JSON.stringify(r.json)), 'aceitou prova sem excerto');
  return '400 · ' + r.json.error.errors.join('; ');
});

await t('duplicado exacto não inflaciona a contagem de origens', async () => {
  const r = await A.call('POST', '/api/projects/' + proj.id + '/evidence', evBase);
  ok(r.status === 200 && r.json.duplicate === true, 'duplicado foi criado como prova nova');
  ok(r.json.evidence.id === evPrimary.id, 'devolveu prova diferente');
  const all = (await A.call('GET', '/api/projects/' + proj.id + '/evidence')).json;
  ok(all.count === 1, 'contagem passou a ' + all.count);
  return 'devolve a prova existente (' + evPrimary.id + ') e mantém 1 registo';
});

await t('dez cópias de um comunicado dão UMA origem independente', async () => {
  const bodies = [];
  for (let i = 0; i < 10; i++) {
    bodies.push(await A.call('POST', '/api/projects/' + proj.id + '/evidence', {
      title: 'Comunicado reproduzido ' + (i + 1),
      excerpt: 'Comunicado da empresa sobre o valor de 12 milhões de euros. ' + i,
      originalUrl: 'https://sindicado' + i + '.example.com/noticia',
      sourceType: 'comunicado', stance: 'favoravel', extractionMethod: 'manual',
      syndicationOf: 'https://empresa.example.com/comunicado-2021'
    }));
  }
  const created = bodies.filter((b) => b.status === 201).length;
  const list = (await A.call('GET', '/api/projects/' + proj.id + '/evidence')).json.evidence;
  const synd = list.filter((e) => e.syndicationOf);
  const origins = new Set(synd.map((e) => e.originKey));
  ok(created === 10, 'esperava 10 registos criados, obteve ' + created);
  ok(origins.size === 1, 'as cópias contaram como ' + origins.size + ' origens');
  const claims = await A.call('POST', '/api/projects/' + proj.id + '/claims', { text: 'Alegação com cópias apenas', kind: 'facto' });
  const cid = claims.json.claim.id;
  for (const b of bodies) await A.call('PATCH', '/api/claims/' + cid, { evidenceId: b.json.evidence.id });
  const view = (await A.call('GET', '/api/claims/' + cid)).json;
  ok(view.factors.independentOrigins === 1, 'fatores contam ' + view.factors.independentOrigins + ' origens');
  ok(view.factors.copiesWithoutIndependentValue === 9, 'cópias redundantes mal contadas: ' + view.factors.copiesWithoutIndependentValue);
  ok(view.factors.favourable === 10, 'provas favoráveis contadas: ' + view.factors.favourable);
  ok(view.suggested !== 'corroborada-independente', 'sugeriu corroboração com uma só origem');
  const refused = await A.call('PATCH', '/api/claims/' + cid, { state: 'corroborada-independente' });
  ok(refused.status === 409, 'aceitou corroboração independente com uma origem (' + refused.status + ')');
  return '10 registos · 1 origem · 9 cópias redundantes · servidor recusa «corroborada independente» (409): ' + refused.json.error.reasons[0];
});

await t('servidor recusa «confirmada» sem prova primária e origens independentes', async () => {
  const c = (await A.call('POST', '/api/projects/' + proj.id + '/claims', { text: 'Valor de 12 milhões atribuído ao relatório', kind: 'facto' })).json.claim;
  await A.call('PATCH', '/api/claims/' + c.id, { evidenceId: evPrimary.id });
  const r1 = await A.call('PATCH', '/api/claims/' + c.id, { state: 'confirmada' });
  ok(r1.status === 409, 'aceitou «confirmada» com uma só origem');
  const reasons1 = r1.json.error.reasons.join(' | ');
  /* segunda origem independente, secundária e favorável */
  const ev2 = (await A.call('POST', '/api/projects/' + proj.id + '/evidence', {
    title: 'Notícia independente', excerpt: 'Jornal independente confirma o valor de 12 milhões de euros.',
    originalUrl: 'https://jornal.example.org/noticia', sourceType: 'secundaria', stance: 'favoravel', extractionMethod: 'http'
  })).json.evidence;
  await A.call('PATCH', '/api/claims/' + c.id, { evidenceId: ev2.id });
  const r2 = await A.call('PATCH', '/api/claims/' + c.id, { state: 'confirmada' });
  ok(r2.status === 200, 'não deixou confirmar com 2 origens e 1 primária: ' + JSON.stringify(r2.json));
  ok(r2.json.claim.state === 'confirmada', 'estado final ' + r2.json.claim.state);
  ok(r2.json.claim.history.length >= 2, 'sem histórico de alterações');
  return 'recusado com 1 origem (' + reasons1.slice(0, 60) + '…) · aceite com 2 origens e 1 primária';
});

await t('prova contrária torna a conclusão «contraditória» e não desaparece', async () => {
  const c = (await A.call('POST', '/api/projects/' + proj.id + '/claims', { text: 'O valor divulgado é exacto', kind: 'facto' })).json.claim;
  await A.call('PATCH', '/api/claims/' + c.id, { evidenceId: evPrimary.id });
  evContrary = (await A.call('POST', '/api/projects/' + proj.id + '/evidence', {
    title: 'Auditoria contradiz o valor', excerpt: 'A auditoria independente aponta 9 milhões e não 12 milhões.',
    originalUrl: 'https://auditoria.example.net/relatorio', sourceType: 'primaria', stance: 'contraria', extractionMethod: 'http'
  })).json.evidence;
  await A.call('PATCH', '/api/claims/' + c.id, { evidenceId: evContrary.id });
  const confirmar = await A.call('PATCH', '/api/claims/' + c.id, { state: 'confirmada' });
  ok(confirmar.status === 409, 'aceitou «confirmada» com prova contrária activa');
  const r = await A.call('PATCH', '/api/claims/' + c.id, { state: 'contraditoria' });
  ok(r.status === 200 && r.json.claim.state === 'contraditoria', 'não aceitou «contraditória»');
  ok(r.json.factors.favourable === 1 && r.json.factors.contrary === 1, 'factores desequilibrados');
  return '«confirmada» recusada (409): ' + confirmar.json.error.reasons[0] + ' · «contraditória» aceite';
});

await t('prova pode ser anotada (limitações, data de verificação) com histórico', async () => {
  const r = await A.call('PATCH', '/api/evidence/' + evPrimary.id, {
    limitations: 'cópia digital sem os anexos; verificado por telefone com a fonte',
    verificationDate: '2026-10-21', validationState: 'insuficiente'
  });
  ok(r.status === 200, 'falhou: ' + r.status + ' ' + JSON.stringify(r.json));
  ok(r.json.evidence.verificationDate && /2026-10-21/.test(r.json.evidence.verificationDate), 'data de verificação não guardada');
  ok(r.json.evidence.history.length === 2, 'histórico sem a alteração: ' + r.json.evidence.history.length);
  return 'limitações, data de verificação e histórico de ' + r.json.evidence.history.length + ' entradas';
});

await t('retirar prova exige motivo e mantém o registo auditável', async () => {
  const semMotivo = await A.call('DELETE', '/api/evidence/' + evContrary.id, {});
  ok(semMotivo.status === 400, 'retirou prova sem motivo');
  const comMotivo = await A.call('DELETE', '/api/evidence/' + evContrary.id, { reason: 'URL deixou de existir e não há cópia arquivada' });
  ok(comMotivo.status === 200, 'falhou a retirada: ' + comMotivo.status);
  const ev = comMotivo.json.evidence;
  ok(ev.retractedAt && ev.retractReason, 'prova sem marca de retirada');
  const list = (await A.call('GET', '/api/projects/' + proj.id + '/evidence')).json.evidence;
  ok(list.some((e) => e.id === evContrary.id), 'a prova desapareceu da lista em vez de ficar retirada');
  const claim = (await A.call('GET', '/api/claims/' + ev.claimIds[0])).json;
  ok(claim.claim.history.some((h) => /prova retirada/.test(h.action)), 'a alegação não registou a retirada');
  const audit = (await A.call('GET', '/api/projects/' + proj.id + '/evidence')).json;
  ok(audit.count === list.length, 'contagem inconsistente');
  return 'retirada com motivo · prova conservada · alegação notificada no histórico';
});

await t('prova de outro utilizador não é acessível nem associável', async () => {
  const r1 = await B.call('GET', '/api/projects/' + proj.id + '/evidence');
  ok(r1.status === 404, 'B viu as provas de A (' + r1.status + ')');
  const r2 = await B.call('PATCH', '/api/evidence/' + evPrimary.id, { validationState: 'confirmada' });
  ok(r2.status === 404, 'B alterou prova de A (' + r2.status + ')');
  const cp = (await B.call('POST', '/api/projects', { title: 'Projecto de B' })).json.project;
  const cB = (await B.call('POST', '/api/projects/' + cp.id + '/claims', { text: 'Alegação de B sobre outra prova' })).json.claim;
  const r3 = await B.call('PATCH', '/api/claims/' + cB.id, { evidenceId: evPrimary.id });
  ok(r3.status === 404, 'B ligou uma prova de A à sua alegação (' + r3.status + ')');
  return 'provas e alegações isoladas · ligação cruzada recusada com 404';
});

await t('estado inválido é recusado com a lista dos nove estados', async () => {
  const c = (await A.call('POST', '/api/projects/' + proj.id + '/claims', { text: 'Alegação para testar estados' })).json.claim;
  const r = await A.call('PATCH', '/api/claims/' + c.id, { state: 'verdade-absoluta' });
  ok(r.status === 400 && Array.isArray(r.json.error.allowed) && r.json.error.allowed.length === 9, 'não devolveu os 9 estados');
  ok(!r.json.error.allowed.includes('100%'), 'estado inventado aceite');
  return '9 estados permitidos · «verdade-absoluta» recusado';
});

await t('alegação nova não pode nascer «confirmada»', async () => {
  const r = await A.call('POST', '/api/projects/' + proj.id + '/claims', { text: 'Alegação que tenta nascer provada', state: 'confirmada' });
  ok(r.status === 409, 'aceitou nascer confirmada (' + r.status + ')');
  return '409 · começa sempre como hipótese/insuficiente/alegação atribuída';
});

await t('duplicar, arquivar, retomar e cancelar projecto', async () => {
  const dup = await A.call('POST', '/api/projects/' + proj.id + '/duplicate');
  ok(dup.status === 201 && dup.json.project.id !== proj.id, 'não duplicou');
  ok(/\(cópia\)/.test(dup.json.project.title), 'título da cópia não identificado');
  const arquivar = await A.call('POST', '/api/projects/' + proj.id + '/archive');
  ok(arquivar.json.project.status === 'archived' && arquivar.json.project.archivedAt, 'não arquivou');
  const retomar = await A.call('POST', '/api/projects/' + proj.id + '/resume');
  ok(retomar.json.project.status === 'active' && !retomar.json.project.archivedAt, 'não retomou');
  const cancelar = await A.call('POST', '/api/projects/' + proj.id + '/cancel');
  ok(cancelar.json.project.status === 'cancelled', 'não cancelou');
  await A.call('POST', '/api/projects/' + proj.id + '/resume');
  const alheio = await B.call('POST', '/api/projects/' + proj.id + '/duplicate');
  ok(alheio.status === 404, 'B duplicou o projecto de A');
  return 'cópia, arquivo, retoma, cancelamento · B recebe 404';
});

await t('checkpoint regista o estado com contagens reais', async () => {
  const r = await A.call('POST', '/api/projects/' + proj.id + '/checkpoints', { label: 'depois das provas iniciais' });
  ok(r.status === 201, 'falhou: ' + r.status);
  ok(r.json.checkpoint.evidenceCount >= 1 && r.json.checkpoint.claimCount >= 1, 'contagens do checkpoint a zero');
  const p = (await A.call('GET', '/api/projects/' + proj.id)).json.project;
  ok(p.checkpoints.length === 1, 'checkpoint não ficou no projecto');
  return 'provas ' + r.json.checkpoint.evidenceCount + ' · alegações ' + r.json.checkpoint.claimCount;
});

await t('auditoria registou provas e alegações sem conteúdo sensível', async () => {
  const db = JSON.parse(await fs.readFile(path.join(DATA, 'db.json'), 'utf8'));
  const types = new Set(db.audit.map((e) => e.type));
  ['evidence_added', 'evidence_updated', 'evidence_retracted', 'claim_created', 'claim_updated']
    .forEach((x) => ok(types.has(x), 'evento em falta: ' + x));
  const raw = JSON.stringify(db.audit);
  ok(!/SenhaForte123/.test(raw), 'auditoria contém palavras-passe');
  ok(!/utm_source/.test(raw), 'auditoria guarda URLs completos com parâmetros');
  return 'eventos de provas e alegações presentes · sem palavras-passe nem URLs com UTM';
});

await t('esquema v1 é migrado para v2 com registo do que mudou', async () => {
  const dir = '/tmp/vn-mig-' + crypto.randomBytes(4).toString('hex');
  await fs.mkdir(dir, { recursive: true });
  const legacy = {
    version: 1, users: [], sessions: [], credentials: [], usage: [], audit: [],
    metrics: { counters: {} },
    projects: [{ id: 'prj-antigo', ownerId: 'usr-1', title: 'Projecto antigo', question: 'q', keywords: [] }]
  };
  await fs.writeFile(path.join(dir, 'db.json'), JSON.stringify(legacy));
  const port2 = PORT + 1;
  const srv2 = spawn(process.execPath, ['tools/serve.mjs'], {
    cwd: process.cwd(),
    env: Object.assign({}, process.env, { PORT: String(port2), DATA_DIR: dir, APP_SECRET: 'segredo-de-teste-mig-1234567890' }),
    stdio: 'ignore'
  });
  try {
    await new Promise((r) => setTimeout(r, 1800));
    const meta = await (await fetch('http://127.0.0.1:' + port2 + '/api/meta')).json();
    ok(meta.schemaVersion === 7, 'versão de esquema ' + meta.schemaVersion);
    ok(meta.migrations.map((m) => m.to).join(',') === '2,3,4,5,6,7', 'registo de migrações: ' + JSON.stringify(meta.migrations.map((m) => m.to)));
    const db = JSON.parse(await fs.readFile(path.join(dir, 'db.json'), 'utf8'));
    const p = db.projects[0];
    ok(p.status === 'draft' && Array.isArray(p.hypotheses) && p.budget.maxCalls === 50, 'projecto antigo não completado');
    ok(Array.isArray(db.evidence) && Array.isArray(db.claims) && Array.isArray(db.runs), 'colecções novas ausentes');
    ok(Array.isArray(db.notes) && Array.isArray(db.entityLinks), 'colecções da memória/ligações ausentes');
    ok(Array.isArray(db.relations) && Array.isArray(db.agentRuns), 'colecções relations/agentRuns ausentes após migração');
    ok(Array.isArray(db.sources) && Array.isArray(db.sourceChecks) && Array.isArray(db.discoveryRuns), 'colecções do registo de fontes ausentes');
    ok(Array.isArray(db.providerCatalog) && Array.isArray(db.providerTests) && Array.isArray(db.checkpoints), 'colecções do Provider OS ausentes');
    ok(db.migrations[0].changes.length > 0, 'migração sem descrição de alterações');
    return 'v1 → v7 em seis passos · ' + db.migrations.map((m) => m.from + '→' + m.to + ': ' + m.changes.join('; ')).join(' | ');
  } finally { srv2.kill('SIGTERM'); }
});

srv.kill('SIGTERM');
console.log('\n' + pass + '/' + (pass + fail) + ' passaram');
process.exit(fail ? 1 : 0);
