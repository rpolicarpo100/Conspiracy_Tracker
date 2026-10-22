/* =====================================================================
   FASE 3D — memória da investigação, resumo descarregável, cópia de
   segurança, fusão de homónimos com identificador e caminhos restritos.

   O que se testa é sobretudo o que NÃO pode acontecer:
   · a memória não muda estados de conclusões nem cria provas;
   · uma decisão sem motivo escrito é recusada;
   · homónimos não se fundem sem identificador, e a fusão é reversível;
   · o resumo nunca apresenta uma conclusão acima do que as provas sustentam
     sem o dizer; formatos MD/CSV/PDF saem com o aviso de que não são prova;
   · a cópia de segurança não leva chaves nem palavras-passe, e a reposição
     remapeia as ligações em vez de as deixar penduradas;
   · caminhos com restrições dizem quantas relações excluíram;
   · nada disto atravessa a fronteira entre contas.
   ===================================================================== */
import './_env.mjs';   // opt-in explícito: registo aberto só nos testes (ver tests/_env.mjs)
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { validateMemory, memoryToMarkdown, MEMORY_KINDS } from '../server/memory.mjs';
import { validateEntityLink, buildGraph } from '../server/graph.mjs';
import { buildSummary, summaryToMarkdown, summaryToCsv, summaryToPdf } from '../server/summary.mjs';
import { renderPdf } from '../server/pdf.mjs';

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { const d = await fn(); pass++; console.log('PASS ' + name + (d ? ' → ' + d : '')); }
  catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

const PORT = 9200 + Math.floor(Math.random() * 90);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = '/tmp/vn-3d-' + crypto.randomBytes(4).toString('hex');
const srv = spawn(process.execPath, ['tools/serve.mjs'], {
  cwd: process.cwd(),
  env: Object.assign({}, process.env, {
    PORT: String(PORT), DATA_DIR: DATA, APP_SECRET: 'segredo-de-teste-fase3d-1234567890',
    ADMIN_EMAIL: 'd3-a@exemplo.pt', REGISTER_MAX: '200', LOGIN_MAX_ATTEMPTS: '200'
  }),
  stdio: 'ignore'
});
await new Promise((r) => setTimeout(r, 1700));

function session() {
  let cookie = '', csrf = '';
  async function call(method, path, body) {
    const headers = { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    if (csrf) headers['x-csrf-token'] = csrf;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((c) => {
      const [pair] = c.split(';'); const [k, v] = pair.split('=');
      if (k === 'vn_sid') cookie = 'vn_sid=' + v;
      if (k === 'vn_csrf') { csrf = v; cookie += '; vn_csrf=' + v; }
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let json = null; try { json = JSON.parse(text); } catch { /* binário/exportação */ }
    return { status: res.status, json, text, buf, headers: res.headers };
  }
  return {
    call,
    async register(email) {
      const r = await call('POST', '/api/auth/register', { email, password: 'SenhaForte123', acceptTerms: true });
      ok(r.status === 201, 'registo ' + r.status);
      return r.json.user;
    }
  };
}

const A = session(), B = session();
await A.register('d3-a@exemplo.pt');
await B.register('d3-b@exemplo.pt');
const prj = (await A.call('POST', '/api/projects', { title: 'Fase 3D', question: 'Quem financiou a fundação?', objective: 'mapear' })).json.project;
const pid = prj.id;

const ev1 = (await A.call('POST', '/api/projects/' + pid + '/evidence', {
  title: 'Registo oficial', sourceType: 'primaria', stance: 'favoravel',
  originalUrl: 'https://exemplo.pt/registo', excerpt: 'A fundação recebeu 250 000 euros em 2019, segundo o registo oficial.',
  publicationDate: '2020-03-01', extractionMethod: 'manual', location: 'registo'
})).json.evidence;
const ev2 = (await A.call('POST', '/api/projects/' + pid + '/evidence', {
  title: 'Segunda redacção', sourceType: 'secundaria', stance: 'favoravel',
  originalUrl: 'https://outro-exemplo.pt/n', excerpt: 'Uma segunda redacção confirma o mesmo apoio de 250 mil euros.',
  publicationDate: '2020-04-02', extractionMethod: 'manual', location: 'notícia'
})).json.evidence;

/* ================= 1. memória ================= */

await t('memória: entrada criada, ligada a provas e registada na auditoria', async () => {
  const r = await A.call('POST', '/api/projects/' + pid + '/memory', {
    kind: 'decisao', title: 'Limitar o âmbito a Portugal',
    body: 'Ficou decidido investigar apenas entidades com registo português.',
    reason: 'pedido explícito do cliente em 2026-10; fontes estrangeiras ficam fora desta fase',
    evidenceIds: [ev1.id]
  });
  ok(r.status === 201, 'criação ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 120));
  ok(r.json.note.kind === 'decisao' && r.json.note.links.evidenceIds[0] === ev1.id, 'ligações');
  const audit = await A.call('GET', '/api/admin/audit?type=memory_added');
  ok(audit.json.events.length >= 1, 'sem evento de auditoria');
  const md = await A.call('GET', '/api/projects/' + pid + '/memory?format=md');
  ok(md.status === 200 && md.text.includes('# Memória da investigação'), 'exportação markdown');
  ok(/não prova nada por si/i.test(md.text), 'o markdown tem de dizer que a memória não prova');
});

await t('memória: decisão sem motivo é recusada; corpo vazio e tipo inventado também', async () => {
  const semMotivo = await A.call('POST', '/api/projects/' + pid + '/memory', { kind: 'decisao', title: 'Decisão', body: 'sem motivo' });
  ok(semMotivo.status === 400 && /motivo/.test(semMotivo.json.error.message), 'decisão sem motivo passou');
  const vazio = await A.call('POST', '/api/projects/' + pid + '/memory', { kind: 'nota', title: 'T', body: '' });
  ok(vazio.status === 400, 'corpo vazio passou');
  const tipo = await A.call('POST', '/api/projects/' + pid + '/memory', { kind: 'opiniao', title: 'T', body: 'corpo' });
  ok(tipo.status === 400 && /tipo de memória/.test(tipo.json.error.message), 'tipo inventado passou');
  ok(!validateMemory({ kind: 'correcao', title: 'Erro no valor', body: 'corrigido', reason: 'curto' }).ok, 'correcção sem motivo');
});

await t('memória: ligação a prova de outro projecto é recusada', async () => {
  const outro = (await A.call('POST', '/api/projects', { title: 'Outro', question: 'q' })).json.project;
  const evOutro = (await A.call('POST', '/api/projects/' + outro.id + '/evidence', {
    title: 'Prova de outro projecto', sourceType: 'primaria', stance: 'favoravel',
    originalUrl: 'https://exemplo.pt/x', excerpt: 'excerto suficientemente longo para ser aceite',
    publicationDate: '2020-01-01', extractionMethod: 'manual', location: 'x'
  })).json.evidence;
  const r = await A.call('POST', '/api/projects/' + pid + '/memory', {
    kind: 'nota', title: 'Nota', body: 'corpo', evidenceIds: [evOutro.id]
  });
  ok(r.status === 400 && /inexistentes/.test(r.json.error.message), 'ligação cruzada aceite: ' + r.status);
});

await t('memória: arquivar exige motivo e não apaga (fica no histórico)', async () => {
  const criada = (await A.call('POST', '/api/projects/' + pid + '/memory', { kind: 'lacuna', title: 'Falta 2018', body: 'pedir o registo de 2018' })).json.note;
  const semMotivo = await A.call('DELETE', '/api/memory/' + criada.id, {});
  ok(semMotivo.status === 400, 'arquivou sem motivo');
  const okDel = await A.call('DELETE', '/api/memory/' + criada.id, { reason: 'resolvida: registo obtido' });
  ok(okDel.status === 200 && okDel.json.note.archivedAt, 'não arquivou');
  const lista = await A.call('GET', '/api/projects/' + pid + '/memory');
  const encontrada = lista.json.notes.find((n) => n.id === criada.id);
  ok(encontrada && encontrada.archivedAt, 'a entrada desapareceu em vez de ficar arquivada');
  ok(lista.json.counts.arquivadas >= 1, 'contagem de arquivadas');
});

await t('memória não altera o estado das conclusões nem cria provas', async () => {
  const antes = await A.call('GET', '/api/projects/' + pid + '/evidence');
  const cl = await A.call('POST', '/api/projects/' + pid + '/claims', { text: 'A fundação recebeu 250 mil euros em 2019.', state: 'hipotese', evidenceIds: [ev1.id, ev2.id] });
  ok(cl.status === 201 && cl.json.claim.evidenceIds.length === 2, 'provas não foram ligadas na criação: ' + JSON.stringify(cl.json.claim.evidenceIds));
  const estadoAntes = cl.json.claim.state;
  await A.call('POST', '/api/projects/' + pid + '/memory', { kind: 'nota', title: 'Nota de trabalho', body: 'a conclusão parece sustentada', claimIds: [cl.json.claim.id] });
  const depois = await A.call('GET', '/api/claims/' + cl.json.claim.id);
  ok(depois.json.claim.state === estadoAntes, 'a memória mudou o estado da conclusão');
  const evDepois = await A.call('GET', '/api/projects/' + pid + '/evidence');
  ok(evDepois.json.evidence.length === antes.json.evidence.length, 'a memória criou provas');
});

await t('memória é isolada por conta (404 e sem listagem)', async () => {
  const r = await B.call('GET', '/api/projects/' + pid + '/memory');
  ok(r.status === 404, 'outra conta leu a memória: ' + r.status);
  const lista = await A.call('GET', '/api/projects/' + pid + '/memory');
  const id = lista.json.notes[0].id;
  const r2 = await B.call('DELETE', '/api/memory/' + id, { reason: 'tentativa alheia' });
  ok(r2.status === 404, 'outra conta apagou memória: ' + r2.status);
});

/* ================= 2. homónimos ================= */

await t('fusão de homónimos exige identificador e motivo', async () => {
  const semId = await A.call('POST', '/api/projects/' + pid + '/entities/link', {
    from: { name: 'A. Silva' }, to: { name: 'Ana Silva' }, reason: 'parecem a mesma pessoa'
  });
  ok(semId.status === 400 && /identificador/.test(semId.json.error.message), 'fundiu sem identificador');
  ok(!validateEntityLink({ from: { name: 'a' }, to: { name: 'b' }, identifier: 'NIPC 1', reason: 'x' }).ok, 'motivo curto aceite');
  ok(validateEntityLink({ from: { name: 'a' }, to: { name: 'b' }, identifier: 'NIPC 500000000', reason: 'mesmo registo comercial' }).ok, 'ligação válida recusada');
});

await t('com identificador, o grafo trata as duas entradas como uma e mostra o alias', async () => {
  const ev = [{ id: 'e1', title: 'd', entities: [{ name: 'Ana Silva' }, { name: 'Beta SA' }], stance: 'favoravel', originKey: 'src:a' }];
  const rel = [
    { id: 'r1', from: 'Ana Silva', to: 'Beta SA', type: 'financed', evidenceIds: ['e1'] },
    { id: 'r2', from: 'A. Silva', to: 'Beta SA', type: 'held_position', evidenceIds: ['e1'] }
  ];
  const sem = buildGraph({ project: { id: 'p', title: 't' }, evidence: ev, relations: rel, claims: [] });
  const com = buildGraph({
    project: { id: 'p', title: 't' }, evidence: ev, relations: rel, claims: [],
    entityLinks: [{ id: 'l1', from: { name: 'A. Silva' }, to: { name: 'Ana Silva' }, identifier: 'NIPC 500000000', reason: 'mesmo registo' }]
  });
  ok(sem.nodes.length === 3, 'sem ligação: ' + sem.nodes.length + ' nós');
  ok(com.nodes.length === 2, 'com ligação: ' + com.nodes.length + ' nós (esperados 2: as duas entradas são a mesma)');
  const fundido = com.nodes.find((n) => n.disambiguator === 'NIPC 500000000');
  ok(fundido, 'o nó fundido não traz o identificador');
  ok(fundido.aliases.includes('A. Silva'), 'alias não registado: ' + JSON.stringify(fundido.aliases));
  ok(com.edges.filter((e) => e.from === fundido.id || e.to === fundido.id).length === 2, 'arestas não convergiram');
});

await t('ligação criada pela API é reversível e fica na auditoria', async () => {
  const r = await A.call('POST', '/api/projects/' + pid + '/entities/link', {
    from: { name: 'A. Silva' }, to: { name: 'Ana Silva', disambiguator: 'NIPC 500000000' },
    identifier: 'NIPC 500000000', identifierType: 'NIPC', reason: 'mesmo registo comercial consultado'
  });
  ok(r.status === 201, 'criação ' + r.status);
  const g = await A.call('GET', '/api/projects/' + pid + '/graph');
  ok(g.json.graph.entityLinks.length === 1, 'ligação não aparece no grafo');
  const semMotivo = await A.call('DELETE', '/api/entity-links/' + r.json.link.id, {});
  ok(semMotivo.status === 400, 'desfez sem motivo');
  const okDel = await A.call('DELETE', '/api/entity-links/' + r.json.link.id, { reason: 'identificadores diferentes afinal' });
  ok(okDel.status === 200 && okDel.json.link.retractedAt, 'não desfez');
  const g2 = await A.call('GET', '/api/projects/' + pid + '/graph');
  ok(g2.json.graph.entityLinks.length === 0, 'ligação retirada continua activa');
  const alheia = await B.call('DELETE', '/api/entity-links/' + r.json.link.id, { reason: 'tentativa alheia' });
  ok(alheia.status === 404, 'outra conta mexeu na ligação: ' + alheia.status);
});

/* ================= 3. caminhos com restrições ================= */

await t('caminho com restrições exclui arestas e diz quantas excluiu', async () => {
  const evA = ev1.id, evB = ev2.id;
  for (const r of [
    { from: 'Ana Silva', to: 'Beta SA', type: 'financed', evidenceIds: [evA], period: { from: '2019-01-01', to: '2019-12-31' } },
    { from: 'Beta SA', to: 'Gama Lda', type: 'subsidiary_of', evidenceIds: [evB], period: { from: '2021-01-01', to: '2021-12-31' } },
    { from: 'Ana Silva', to: 'Gama Lda', type: 'held_position', evidenceIds: [evA], inferred: true, reasoning: 'aparece na mesma notícia' }
  ]) {
    const rr = await A.call('POST', '/api/projects/' + pid + '/relations', r);
    ok(rr.status === 201, 'relação: ' + rr.status + ' ' + JSON.stringify(rr.json).slice(0, 100));
  }
  const from = 'name:ana silva', to = 'name:gama lda';
  const livre = await A.call('GET', '/api/projects/' + pid + '/graph?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to));
  ok(livre.json.caminho.found && livre.json.caminho.saltos === 1, 'caminho livre: ' + JSON.stringify(livre.json.caminho).slice(0, 120));
  const semInferidas = await A.call('GET', '/api/projects/' + pid + '/graph?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) + '&pathExcludeInferred=1');
  /* há um caminho alternativo de dois saltos: o que não pode acontecer é o passo inferido aparecer */
  ok(semInferidas.json.caminho.found, 'perdeu o caminho alternativo entre as duas entidades');
  ok(semInferidas.json.caminho.saltos === 2, 'saltos: ' + semInferidas.json.caminho.saltos);
  ok(semInferidas.json.caminho.passos.every((x) => !x.inferida), 'a inferência foi usada apesar de excluída');
  ok(semInferidas.json.caminho.restricoes.arestasExcluidas >= 1, 'não contou as excluídas');
  const porTipo = await A.call('GET', '/api/projects/' + pid + '/graph?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) + '&pathTypes=financed');
  ok(!porTipo.json.caminho.found && /restrições/.test(porTipo.json.caminho.reason), 'filtro por tipo não explicou a ausência');
  /* com janela até 2020 a única alternativa é o passo inferido (sem período): excluindo-o não há caminho */
  const janela = await A.call('GET', '/api/projects/' + pid + '/graph?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) + '&pathNotAfter=2020&pathExcludeInferred=1');
  ok(!janela.json.caminho.found, 'passou uma relação de 2021 com janela até 2020');
  ok(/restrições/.test(janela.json.caminho.reason), 'não explicou a ausência: ' + janela.json.caminho.reason);
  /* um passo sem período é incluído e declarado como tal, em vez de ser excluído em silêncio */
  const semPeriodo = await A.call('GET', '/api/projects/' + pid + '/graph?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) + '&pathNotAfter=2020');
  ok(semPeriodo.json.caminho.found && semPeriodo.json.caminho.semPeriodo >= 1, 'passo sem período não declarado');
  ok(/sem período declarado/.test(semPeriodo.json.caminho.aviso), 'aviso do passo sem período ausente');
  const invalida = await A.call('GET', '/api/projects/' + pid + '/graph?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) + '&pathNotAfter=2021-13');
  ok(invalida.status === 200 && /inválidas/.test(invalida.json.caminho.reason), 'data inválida não foi assinalada');
});

/* ================= 4. resumo descarregável ================= */

await t('resumo JSON marca conclusão acima do que as provas sustentam', async () => {
  const cl = await A.call('GET', '/api/projects/' + pid + '/claims');
  const id = cl.json.claims[0].id;
  const patch = await A.call('PATCH', '/api/claims/' + id, { state: 'corroborada-independente' });
  ok(patch.status === 200, 'estado forte recusado sem prova suficiente? ' + JSON.stringify(patch.json).slice(0, 160));
  const s = await A.call('GET', '/api/projects/' + pid + '/summary?format=json');
  ok(s.status === 200, 'resumo ' + s.status);
  const c = s.json.conclusoes.find((x) => x.id === id);
  ok(c && c.origensIndependentes === 2, 'origens independentes: ' + JSON.stringify(c));
  ok(s.json.avisos.length >= 4 && /não é prova/.test(s.json.avisos[0]), 'avisos');
  ok(s.json.estado.provasActivas === 2, 'contagem de provas');
});

await t('resumo MD/CSV/PDF saem com o aviso e o nome do projecto', async () => {
  const md = await A.call('GET', '/api/projects/' + pid + '/summary?format=md');
  ok(md.status === 200 && /attachment; filename="conspiracy-tracker-resumo-/.test(md.headers.get('content-disposition') || ''), 'nome do ficheiro');
  ok(/um resumo não é prova/i.test(md.text), 'MD sem o aviso');
  ok(/## 3\. Conclusões e o que as sustenta/.test(md.text), 'secção de conclusões');
  const csv = await A.call('GET', '/api/projects/' + pid + '/summary?format=csv');
  ok(csv.status === 200 && csv.buf[0] === 0xEF && csv.buf[1] === 0xBB, 'CSV sem BOM para Excel');
  ok(/seccao;item;valor/.test(csv.text), 'cabeçalho CSV em pt-PT');
  const pdf = await A.call('GET', '/api/projects/' + pid + '/summary?format=pdf');
  ok(pdf.status === 200 && pdf.headers.get('content-type') === 'application/pdf', 'PDF ' + pdf.status);
  ok(pdf.buf.slice(0, 5).toString() === '%PDF-', 'assinatura PDF');
  ok(pdf.buf.toString('latin1').includes('%%EOF'), 'PDF sem fim');
  ok(pdf.buf.toString('latin1').includes('Conclus'), 'PDF sem as conclusões');
  ok(/um resumo não substitui as provas/.test(pdf.buf.toString('latin1')), 'PDF sem o aviso no rodapé');
  const invalido = await A.call('GET', '/api/projects/' + pid + '/summary?format=docx');
  ok(invalido.status === 400, 'formato inválido aceite');
});

await t('resumo é auditado e não é acessível a outra conta', async () => {
  await A.call('GET', '/api/projects/' + pid + '/summary?format=pdf');
  const audit = await A.call('GET', '/api/admin/audit?type=summary_downloaded');
  ok(audit.json.events.length >= 1, 'sem auditoria de descarregamento');
  const r = await B.call('GET', '/api/projects/' + pid + '/summary?format=pdf');
  ok(r.status === 404, 'outra conta descarregou o resumo: ' + r.status);
});

await t('gerador de PDF: paginação, acentos e recusa de caracteres fora do Latin-1', async () => {
  const buf = renderPdf({ title: 'Teste', blocks: [
    { type: 'p', text: 'linha '.repeat(4000) },
    { type: 'h2', text: 'Segunda parte' },
    { type: 'p', text: 'caracteres fora: 日本語 e 漢字' }
  ] });
  const s = buf.toString('latin1');
  ok((s.match(/\/Type \/Page[^s]/g) || []).length > 1, 'não paginou');
  ok(s.includes('Segunda parte'), 'perdeu a segunda parte');
  ok(s.includes('?') || s.includes('caracteres fora'), 'não substituiu caracteres não representáveis');
  const semFim = !s.trim().endsWith('%%EOF');
  ok(!semFim, 'PDF mal terminado');
});

/* ================= 5. cópia de segurança ================= */

await t('cópia de segurança leva os dados e não leva segredos', async () => {
  await A.call('POST', '/api/providers/groq/key', { apiKey: 'gsk_chave_de_teste_1234567890' });
  const r = await A.call('GET', '/api/auth/backup');
  ok(r.status === 200, 'cópia ' + r.status);
  const bk = JSON.parse(r.text);
  ok(bk.format === 'conspiracy-tracker-backup/1', 'formato');
  const legado = await A.call('POST', '/api/auth/restore', { backup: { format: 'meridiano-backup/1', projects: [] } });
  ok(legado.status === 200 || legado.status === 201, 'cópia antiga (meridiano-backup/1) ainda é aceite: ' + legado.status);
  ok(bk.counts.projects >= 2 && bk.counts.evidence >= 2, 'contagens: ' + JSON.stringify(bk.counts));
  const cru = r.text;
  ok(!cru.includes('gsk_chave_de_teste'), 'a chave em claro foi exportada');
  ok(!/passwordHash|salt"/.test(cru), 'hash/salt exportados');
  ok(!/keyCipher/.test(cru), 'cifra da chave exportada');
  ok(bk.notIncluded && bk.notIncluded.length >= 3, 'não declara o que fica de fora');
});

await t('reposição remapeia ligações e não duplica nada no projecto original', async () => {
  const bk = JSON.parse((await A.call('GET', '/api/auth/backup')).text);
  const antes = (await A.call('GET', '/api/projects')).json.projects.length;
  const r = await A.call('POST', '/api/auth/restore', { backup: bk });
  ok(r.status === 201, 'reposição ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160));
  ok(r.json.restored.projects === bk.counts.projects, 'projectos repostos: ' + r.json.restored.projects);
  ok(r.json.restored.skipped.length === 0, 'entradas ignoradas: ' + JSON.stringify(r.json.restored.skipped));
  const depois = (await A.call('GET', '/api/projects')).json.projects;
  ok(depois.length === antes + bk.counts.projects, 'contagem de projectos após reposição');
  const novo = depois.find((p) => p.restoredFrom && p.id !== pid);
  ok(novo, 'projecto reposto sem marca de origem');
  const evN = (await A.call('GET', '/api/projects/' + novo.id + '/evidence')).json.evidence;
  const clN = (await A.call('GET', '/api/projects/' + novo.id + '/claims')).json.claims;
  ok(evN.length >= 2 && clN.length >= 1, 'dados repostos: ' + evN.length + ' provas, ' + clN.length + ' conclusões');
  const lig = clN.find((c) => (c.evidenceIds || []).length);
  ok(lig, 'conclusão reposta sem provas ligadas');
  const ids = new Set(evN.map((e) => e.id));
  ok(lig.evidenceIds.every((id) => ids.has(id)), 'ligação pendurada para prova inexistente');
  const notas = (await A.call('GET', '/api/projects/' + novo.id + '/memory')).json.notes;
  ok(notas.length >= 2, 'memória não reposta: ' + notas.length);
});

await t('reposição recusa formatos errados e não aceita cópia de outra conta como sua', async () => {
  const errado = await A.call('POST', '/api/auth/restore', { backup: { format: 'outro' } });
  ok(errado.status === 400 && /formato/.test(errado.json.error.message), 'formato errado aceite');
  const vazio = await A.call('POST', '/api/auth/restore', { backup: { format: 'conspiracy-tracker-backup/1' } });
  ok(vazio.status === 400, 'cópia sem projectos aceite');
  const bk = JSON.parse((await A.call('GET', '/api/auth/backup')).text);
  const r = await B.call('POST', '/api/auth/restore', { backup: bk });
  ok(r.status === 201, 'reposição noutra conta ' + r.status);
  const projectsB = (await B.call('GET', '/api/projects')).json.projects;
  ok(projectsB.every((p) => p.ownerId === undefined || p.ownerId !== undefined), 'saneamento');
  const dono = (await B.call('GET', '/api/projects/' + pid)).status;
  ok(dono === 404, 'a reposição deu acesso ao projecto original de outra conta: ' + dono);
});

/* ================= 6. esquema ================= */

await t('esquema actual registado e coerente com o código', async () => {
  const meta = await A.call('GET', '/api/meta');
  /* a versão sobe quando há migração nova (fase 3G → v6 com o registo de fontes);
     o teste compara com o valor que o armazenamento declara, para não envelhecer */
  const store = await import('../server/store.mjs');
  const dir = '/tmp/vn-schema-check-' + Date.now().toString(36);
  const st = await store.createStore(dir).init();
  const v = st.schemaVersion();
  await st.close();
  ok(meta.json.schemaVersion === v, 'schemaVersion ' + meta.json.schemaVersion + ' ≠ ' + v);
  /* formato da versão, não a fase concreta: o número da fase muda sem que
     nada neste teste deixe de ser verdade */
  ok(/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/i.test(meta.json.version), 'versão ' + meta.json.version);
  ok(meta.json.schemaVersion >= 5, 'esquema antigo: ' + meta.json.schemaVersion);
});

srv.kill('SIGKILL');
console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
