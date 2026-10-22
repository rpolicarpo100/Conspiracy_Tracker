/* =====================================================================
   P3 — 13 agentes com execuções persistidas, auditor adversário e vistas do
   grafo (caminhos, cronologia, contradições).

   Critério central: nenhum agente escreve conclusões nem promove hipóteses.
   O que se testa é o que os agentes RECUSAM e o que DECLARAM quando não podem
   correr. Os agentes de IA são testados em dois estados: sem fornecedor
   (não executado, com motivo) e com fornecedor substituído por stub (JSON
   válido e JSON inválido).
   ===================================================================== */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { AGENTS, agentById, redTeamAudit, executeAgent, runLocalAgent } from '../server/agents.mjs';
import { createStore } from '../server/store.mjs';
import { buildGraph } from '../server/graph.mjs';

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { const d = await fn(); pass++; console.log('PASS ' + name + (d ? ' → ' + d : '')); }
  catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

const PORT = 8860 + Math.floor(Math.random() * 120);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = '/tmp/vn-ag-' + crypto.randomBytes(4).toString('hex');
const srv = spawn(process.execPath, ['tools/serve.mjs'], {
  cwd: process.cwd(),
  env: Object.assign({}, process.env, {
    PORT: String(PORT), DATA_DIR: DATA, APP_SECRET: 'segredo-de-teste-agentes-1234567',
    REGISTER_MAX: '200', LOGIN_MAX_ATTEMPTS: '200'
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
    let json = null; try { json = await res.json(); } catch { /* sem corpo */ }
    return { status: res.status, json };
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

const A = session();
const B = session();
await A.register('ag' + Date.now().toString(36) + 'a@ex.pt');
await B.register('ag' + Date.now().toString(36) + 'b@ex.pt');

const prj = (await A.call('POST', '/api/projects', {
  title: 'Caso dos agentes', question: 'Quem controla a cadeia?', referenceDate: '2024-12-31',
  completionCriteria: ['duas origens independentes']
})).json.project;

console.log('\n== P3 · AGENTES, AUDITOR ADVERSÁRIO E VISTAS DO GRAFO (tests/agents-p3.mjs)\n');

await t('registo dos 13 agentes tem contrato, critérios e limites declarados', async () => {
  const r = await A.call('GET', '/api/agents');
  ok(r.status === 200 && r.json.agents.length === 13, 'agentes: ' + (r.json.agents || []).length);
  const ids = r.json.agents.map((x) => x.id);
  ['orchestrator', 'research-planner', 'web-search', 'document-hunter', 'extraction', 'entity-resolution',
    'relationship-mapper', 'corporate-financial', 'timeline', 'counter-evidence', 'fact-checker', 'red-team', 'report-generator']
    .forEach((id) => ok(ids.includes(id), 'agente em falta: ' + id));
  ok(r.json.agents.every((x) => x.contract.in.length && x.contract.out.length && x.criteria.length && x.limits.timeoutMs), 'contrato incompleto');
  ok(/nenhum agente escreve conclusões/.test(r.json.note), 'sem aviso sobre o que os agentes não fazem');
  return '13 agentes · ' + r.json.agents.filter((x) => x.kind === 'local').length + ' locais · ' +
    r.json.agents.filter((x) => x.kind === 'ai').length + ' de IA · versão de prompt ' + r.json.promptVersion;
});

await t('agente de IA sem chave validada fica «nao-executado» com motivo', async () => {
  const r = await A.call('POST', '/api/projects/' + prj.id + '/agents/extraction/run', {});
  ok(r.status === 201, 'status ' + r.status);
  ok(r.json.aiUsed === false, 'disse ter usado IA');
  ok(r.json.run.status === 'nao-executado' && /sem fornecedor de IA validado/.test(r.json.run.reason), 'motivo: ' + r.json.run.reason);
  ok(r.json.run.output === null, 'guardou uma saída inventada');
  ok(r.json.run.promptVersion === 'a1', 'sem versão de prompt');
  return 'nao-executado · ' + r.json.run.reason.slice(0, 60) + '… · saída nula';
});

await t('agente desconhecido é recusado com a lista de agentes', async () => {
  const r = await A.call('POST', '/api/projects/' + prj.id + '/agents/adivinho/run', {});
  ok(r.status === 404, 'status ' + r.status);
  ok(Array.isArray(r.json.error.known) && r.json.error.known.length === 13, 'lista de agentes em falta');
  return '404 com 13 agentes conhecidos';
});

/* dados para os agentes locais */
const evOk = (await A.call('POST', '/api/projects/' + prj.id + '/evidence', {
  title: 'Certidão permanente', excerpt: 'A sociedade X é detida em 60% por Y, conforme inscrição de 2018.',
  originalUrl: 'https://registro.example.pt/certidao', sourceType: 'primaria', stance: 'favoravel', extractionMethod: 'manual',
  publicationDate: '2018-06-01', eventDate: '2018-05-01',
  entities: [{ name: 'Sociedade X', type: 'company', disambiguator: 'NIPC 500000000' },
             { name: 'Y Participações', type: 'company', disambiguator: 'NIPC 500000001' }]
})).json.evidence;
const evCopia = (await A.call('POST', '/api/projects/' + prj.id + '/evidence', {
  title: 'Cópia do comunicado', excerpt: 'A sociedade X é detida em 60% por Y, conforme inscrição de 2018.',
  originalUrl: 'https://sindicado.example.com/noticia', sourceType: 'comunicado', stance: 'favoravel', extractionMethod: 'http',
  syndicationOf: 'https://registro.example.pt/certidao',
  entities: [{ name: 'Sociedade X', type: 'company', disambiguator: 'NIPC 500000000' }]
})).json.evidence;
const evData = (await A.call('POST', '/api/projects/' + prj.id + '/evidence', {
  title: 'Documento sem data nem URL', excerpt: 'Documento interno que menciona a relação entre X e Y.',
  sourceType: 'secundaria', stance: 'neutra', extractionMethod: 'manual', location: 'arquivo pessoal, pasta 3'
})).json.evidence;

const clConfirmada = (await A.call('POST', '/api/projects/' + prj.id + '/claims', {
  text: 'Y controla X desde 2018', kind: 'facto'
})).json.claim;
await A.call('PATCH', '/api/claims/' + clConfirmada.id, { evidenceId: evOk.id });
await A.call('PATCH', '/api/claims/' + clConfirmada.id, { evidenceId: evCopia.id });
const clForcada = (await A.call('POST', '/api/projects/' + prj.id + '/claims', {
  text: 'A relação é 100% certa e provada sem qualquer dúvida', kind: 'facto'
})).json.claim;
await A.call('PATCH', '/api/claims/' + clForcada.id, { evidenceId: evCopia.id });
const clSemProva = (await A.call('POST', '/api/projects/' + prj.id + '/claims', {
  text: 'Existe financiamento oculto não documentado', kind: 'hipotese'
})).json.claim;

const rel = (await A.call('POST', '/api/projects/' + prj.id + '/relations', {
  from: 'Sociedade X', to: 'Y Participações', type: 'subsidiary_of',
  fromDisambiguator: 'NIPC 500000000', toDisambiguator: 'NIPC 500000001',
  evidenceIds: [evOk.id], period: { from: '2018-05-01', to: null }
})).json.relation;

await t('orquestrador lista o que falta, sem inventar progresso', async () => {
  const r = await A.call('POST', '/api/projects/' + prj.id + '/agents/orchestrator/run', {});
  ok(r.status === 201 && r.json.run.status === 'concluido', 'estado ' + (r.json.run && r.json.run.status));
  const o = r.json.run.output;
  ok(Array.isArray(o.proximosPassos) && o.proximosPassos.length > 0, 'sem próximos passos');
  ok(o.provas === 3 && o.conclusoes === 3 && o.relacoes === 1, 'contagens erradas: ' + JSON.stringify(o));
  ok(o.proximosPassos.some((x) => /sem provas|ligar provas/.test(x)), 'não assinalou conclusão sem prova');
  ok(o.proximosPassos.some((x) => /executar a pesquisa/.test(x)), 'não assinalou pesquisa por executar');
  return '3 provas · 3 conclusões · 1 relação · ' + o.proximosPassos.length + ' próximos passos declarados';
});

await t('resolução de entidades distingue colisões de falta de desambiguador', async () => {
  const r = await A.call('POST', '/api/projects/' + prj.id + '/agents/entity-resolution/run', {});
  const o = r.json.run.output;
  ok(Array.isArray(o.semDesambiguador) && o.semDesambiguador.length === 0, 'entidades com desambiguador marcadas: ' + JSON.stringify(o.semDesambiguador));
  ok(/não são fundidos sem identificador/.test(o.nota), 'sem aviso de não-fusão');
  const local = runLocalAgent('entity-resolution', {
    project: prj, claims: [], relations: [], runs: [],
    evidence: [{ id: 'e1', entities: [{ name: 'João Silva', disambiguator: 'n.1954' }, { name: 'João Silva', disambiguator: 'n.1981' }, { name: 'Ana', disambiguator: null }] }]
  });
  ok(local.colisoes.length === 1 && local.colisoes[0].identificadores.length === 2, 'colisão não detectada');
  ok(local.semDesambiguador.includes('Ana'), 'sem desambiguador não assinalado');
  return 'colisão de homónimos detectada (2 identificadores) · entidade sem desambiguador listada';
});

await t('auditor adversário encontra conclusão acima das provas e cópias como corroboração', async () => {
  /* 1) pela API o servidor já não deixa «confirmar» com uma só origem nem com cópias */
  const tentativa = await A.call('PATCH', '/api/claims/' + clConfirmada.id, { state: 'confirmada' });
  ok(tentativa.status === 409, 'o servidor deixou confirmar com cópias (' + tentativa.status + ')');
  /* 2) o auditor apanha o caso antigo: conclusão «confirmada» assente em duas cópias da mesma peça */
  const legado = redTeamAudit({
    evidence: [
      { id: 'e1', title: 'Comunicado', excerpt: 'Texto suficientemente longo do comunicado.', canonicalUrl: 'https://empresa.pt/c', originKey: 'sind:https://empresa.pt/c', syndicationOf: 'https://empresa.pt/c', stance: 'favoravel', validationState: 'insuficiente' },
      { id: 'e2', title: 'Cópia noutro sítio', excerpt: 'Texto suficientemente longo do comunicado.', canonicalUrl: 'https://sindicado.pt/n', originKey: 'sind:https://empresa.pt/c', syndicationOf: 'https://empresa.pt/c', stance: 'favoravel', validationState: 'insuficiente' }
    ],
    claims: [{ id: 'c1', text: 'A empresa controla X', state: 'confirmada', evidenceIds: ['e1', 'e2'], confidence: 'alta' }],
    relations: []
  });
  const codigosLegado = legado.findings.map((f) => f.code);
  ok(codigosLegado.includes('copias-como-corroboracao'), 'auditor não detectou cópias como corroboração: ' + codigosLegado.join(','));
  ok(codigosLegado.includes('estado-acima-das-provas') || codigosLegado.includes('confianca-inflacionada'), 'auditor não detectou estado/confiança acima das provas');
  /* 3) a auditoria real do projecto apanha o que existe hoje */
  const r = await A.call('POST', '/api/projects/' + prj.id + '/agents/red-team/run', {});
  ok(r.status === 201 && r.json.run.status === 'concluido', 'estado ' + r.json.run.status);
  const codigos = r.json.run.findings.map((f) => f.code);
  ok(codigos.includes('conclusao-sem-prova'), 'não detectou conclusão sem prova');
  ok(codigos.includes('linguagem-absoluta'), 'não detectou linguagem absoluta');
  ok(codigos.includes('prova-sem-data'), 'não detectou prova sem data');
  ok(codigos.includes('comunicado-sem-origem') === false, 'marcou comunicado que declara syndicationOf');
  const achado = r.json.run.findings.find((f) => f.code === 'conclusao-sem-prova');
  ok(achado.subject && achado.subject.type === 'claim' && achado.subject.id, 'achado sem sujeito identificado');
  ok(r.json.run.output.total === r.json.run.findings.length, 'contagem de achados inconsistente');
  return r.json.run.findings.length + ' achados · ' + Object.entries(r.json.run.output.counts).map(([k, v]) => k + ': ' + v).join(' · ') +
    ' · legado: ' + codigosLegado.slice(0, 3).join(',');
});

await t('auditor detecta citação que não corresponde a prova e excerto divergente', async () => {
  const r = await A.call('POST', '/api/projects/' + prj.id + '/agents/red-team/run', {});
  /* o agente é determinístico: a mesma auditoria com citações injectadas no contexto */
  const audit = redTeamAudit({
    evidence: [{ id: 'e1', title: 'Certidão', excerpt: 'A sociedade X é detida em 60% por Y.', canonicalUrl: 'https://a.pt/x', originKey: 'host:a.pt', stance: 'favoravel', validationState: 'insuficiente' }],
    claims: [], relations: [],
    citations: [
      { id: 'c1', evidenceId: 'e-inexistente', text: 'citação sem prova' },
      { id: 'c2', evidenceId: 'e1', excerpt: 'Um trecho que não existe no documento' }
    ]
  });
  const codigos = audit.findings.map((f) => f.code);
  ok(codigos.includes('citacao-sem-prova'), 'não detectou citação sem prova');
  ok(codigos.includes('citacao-divergente'), 'não detectou excerto divergente');
  ok(audit.findings.filter((f) => f.severity === 'alta').length >= 2, 'gravidade das citações não é alta');
  return 'citação sem prova e excerto divergente detectados (gravidade alta) · ' + r.json.run.findings.length + ' achados na auditoria real';
});

await t('auditor detecta relação sem prova activa e inferência sem raciocínio', async () => {
  const audit = redTeamAudit({
    evidence: [{ id: 'e1', title: 'X', excerpt: 'excerto suficientemente longo para passar', canonicalUrl: 'https://a.pt', originKey: 'host:a.pt', stance: 'favoravel' }],
    claims: [],
    relations: [
      { id: 'r1', from: 'A', to: 'B', type: 'owns', evidenceIds: ['e-que-nao-existe'] },
      { id: 'r2', from: 'A', to: 'C', type: 'held_position', inferred: true, reasoning: null, evidenceIds: ['e1'] }
    ]
  });
  const codigos = audit.findings.map((f) => f.code);
  ok(codigos.includes('relacao-sem-prova-activa'), 'não detectou relação sem prova');
  ok(codigos.includes('inferencia-sem-raciocinio'), 'não detectou inferência sem raciocínio');
  return 'relação sem prova activa e inferência sem raciocínio detectadas';
});

await t('contra-provas e verificador de factos apontam lacunas, não conclusões', async () => {
  const c1 = await A.call('POST', '/api/projects/' + prj.id + '/agents/counter-evidence/run', {});
  ok(c1.json.run.status === 'concluido', 'estado ' + c1.json.run.status);
  ok(c1.json.run.output.semContraprova.length >= 2, 'não listou conclusões sem contra-prova: ' + c1.json.run.output.semContraprova.length);
  ok(/não uma confirmação/.test(c1.json.run.output.nota), 'sem aviso de que a ausência não confirma');
  const c2 = await A.call('POST', '/api/projects/' + prj.id + '/agents/fact-checker/run', {});
  ok(c2.json.run.output.problemas.length >= 1, 'não encontrou conclusões cujo estado não é sustentado');
  ok(c2.json.run.output.problemas.every((p) => p.estado !== p.sustentado), 'problema sem divergência de estado');
  return 'contra-provas: ' + c1.json.run.output.semContraprova.length + ' lacunas · verificador: ' +
    c2.json.run.output.problemas.map((p) => p.estado + '→' + p.sustentado).join(', ');
});

await t('nenhum agente alterou conclusões, provas ou relações', async () => {
  const before = (await A.call('GET', '/api/projects/' + prj.id + '/claims')).json.claims;
  await A.call('POST', '/api/projects/' + prj.id + '/agents/orchestrator/run', {});
  await A.call('POST', '/api/projects/' + prj.id + '/agents/red-team/run', {});
  await A.call('POST', '/api/projects/' + prj.id + '/agents/relationship-mapper/run', {});
  const after = (await A.call('GET', '/api/projects/' + prj.id + '/claims')).json.claims;
  ok(JSON.stringify(before.map((c) => [c.id, c.state])) === JSON.stringify(after.map((c) => [c.id, c.state])), 'os agentes mudaram estados de conclusões');
  const rels = (await A.call('GET', '/api/projects/' + prj.id + '/graph')).json.graph.edges;
  ok(rels.length === 1, 'os agentes criaram relações: ' + rels.length);
  return 'estados intactos · 1 relação (a registada por uma pessoa) · agentes só analisam';
});

await t('cronologia ordena eventos com prova e assinala datas suspeitas', async () => {
  const r = await A.call('POST', '/api/projects/' + prj.id + '/agents/timeline/run', {});
  const o = r.json.run.output;
  ok(o.eventos.length >= 1, 'sem eventos apesar de haver datas');
  ok(o.eventos[0].prova && o.eventos[0].tipo, 'evento sem prova ou tipo de data');
  const datas = o.eventos.map((e) => e.data);
  ok(datas.join('|') === datas.slice().sort().join('|'), 'eventos fora de ordem: ' + datas.join(' | '));
  const g = (await A.call('GET', '/api/projects/' + prj.id + '/graph')).json;
  ok(g.timeline.total >= 2, 'cronologia do grafo: ' + g.timeline.total);
  ok(g.timeline.eventos.some((e) => e.tipo === 'relação'), 'relações com período não entraram na cronologia');
  return o.eventos.length + ' eventos ordenados · cronologia do grafo junta ' + g.timeline.total + ' (inclui período de relação)';
});

await t('caminho entre entidades traz provas por passo e o aviso de que não é prova de coordenação', async () => {
  const y = (await A.call('GET', '/api/projects/' + prj.id + '/graph')).json.graph.nodes.find((n) => n.name === 'Y Participações');
  const x = (await A.call('GET', '/api/projects/' + prj.id + '/graph')).json.graph.nodes.find((n) => n.name === 'Sociedade X');
  const same = await A.call('GET', '/api/projects/' + prj.id + '/graph?from=' + encodeURIComponent(x.id) + '&to=' + encodeURIComponent(x.id));
  ok(same.status === 200, 'status ' + same.status);
  const otro = await A.call('GET', '/api/projects/' + prj.id + '/graph?from=' + encodeURIComponent(x.id) + '&to=name:inexistente');
  ok(otro.json.caminho.found === false, 'devolveu caminho para entidade inexistente');
  const r = await A.call('GET', '/api/projects/' + prj.id + '/graph?from=' + encodeURIComponent(x.id) + '&to=' + encodeURIComponent(y.id));
  const c = r.json.caminho;
  ok(c.found === true && c.passos.length === 1, 'caminho: ' + JSON.stringify(c).slice(0, 120));
  ok(c.passos[0].provas.length === 1 && c.passos[0].confianca, 'passo sem provas/confiança');
  ok(/não prova de coordenação/.test(c.aviso), 'sem aviso de coordenação');
  return 'caminho de ' + c.saltos + ' salto(s) com provas · aviso presente · entidade inexistente devolve found:false';
});

await t('vista de contradições lista conflitos com as provas dos dois lados', async () => {
  const evContra = (await A.call('POST', '/api/projects/' + prj.id + '/evidence', {
    title: 'Auditoria contrária', excerpt: 'A auditoria não confirma a participação de Y em X.',
    originalUrl: 'https://auditoria.example.net/x', sourceType: 'primaria', stance: 'contraria', extractionMethod: 'http'
  })).json.evidence;
  await A.call('PATCH', '/api/relations/' + rel.id, { evidenceIds: [evOk.id, evContra.id] });
  await A.call('PATCH', '/api/claims/' + clConfirmada.id, { evidenceId: evContra.id });
  const g = (await A.call('GET', '/api/projects/' + prj.id + '/graph')).json;
  ok(g.contradicoes.length >= 1, 'sem contradições detectadas');
  const porRelacao = g.contradicoes.find((c) => c.tipo === 'relacao');
  ok(porRelacao && porRelacao.provas.some((p) => p.posicao === 'contraria'), 'contradição de relação sem prova contrária');
  const porConclusao = g.contradicoes.find((c) => c.tipo === 'conclusao');
  ok(porConclusao, 'conclusão com provas dos dois lados não entrou nas contradições');
  ok(porConclusao.provas.filter((p) => p.posicao === 'favoravel').length >= 1 && porConclusao.provas.filter((p) => p.posicao === 'contraria').length >= 1, 'lados desequilibrados');
  return g.contradicoes.length + ' contradição(ões) · ' + porRelacao.provas.length + ' provas na relação · ' + porConclusao.provas.length + ' na conclusão';
});

await t('execuções de agentes ficam guardadas, ordenadas e isoladas por conta', async () => {
  const r = await A.call('GET', '/api/projects/' + prj.id + '/agent-runs');
  ok(r.status === 200 && r.json.runs.length >= 6, 'execuções guardadas: ' + (r.json.runs || []).length);
  ok(r.json.runs.every((x) => x.id && x.agentId && x.status && x.startedAt), 'execução sem campos obrigatórios');
  ok(r.json.runs.every((x, i) => i === 0 || x.seq >= r.json.runs[i - 1].seq), 'sequência fora de ordem');
  const seen = new Set(r.json.runs.map((x) => x.agentId));
  ok(seen.has('red-team') && seen.has('orchestrator'), 'faltam execuções esperadas: ' + [...seen].join(','));
  const b = await B.call('GET', '/api/projects/' + prj.id + '/agent-runs');
  ok(b.status === 404, 'B viu execuções de A (' + b.status + ')');
  const runB = await B.call('POST', '/api/projects/' + prj.id + '/agents/orchestrator/run', {});
  ok(runB.status === 404, 'B correu um agente no projecto de A');
  return r.json.runs.length + ' execuções registadas · B recebe 404 (leitura e execução)';
});

/* --- nível de módulo: agentes de IA com stub --- */
await t('agente de IA com stub devolve saída estruturada e é registado', async () => {
  const store = await createStore('/tmp/vn-ag-mod-' + crypto.randomBytes(4).toString('hex')).init();
  const u = await store.createUser({ email: 'mod@ex.pt', passwordHash: 'x', salt: 'y' });
  const p = await store.createProject(u.id, { title: 't', question: 'q' });
  const ctx = { project: p, evidence: [], claims: [], relations: [], runs: [] };
  const stub = async () => ({ ok: true, provider: 'stub', model: 'stub-1', parsed: { consultas: [{ texto: 'consulta', porque: 'teste' }] }, note: null });
  const a = await executeAgent({ store }, 'web-search', ctx, { ai: stub });
  ok(a.run.status === 'concluido' && a.run.output.consultas.length === 1, 'saída: ' + JSON.stringify(a.run.output));
  ok(a.run.provider === 'stub' && a.run.promptVersion, 'sem fornecedor/versão registados');
  const bad = await executeAgent({ store }, 'web-search', ctx, { ai: async () => ({ ok: true, provider: 'stub', parsed: null, note: 'sem objecto JSON' }) });
  ok(bad.run.status === 'falhou' && bad.run.output === null, 'aceitou resposta inválida');
  ok(/não é JSON válido/.test(bad.run.reason), 'motivo: ' + bad.run.reason);
  const fail = await executeAgent({ store }, 'web-search', ctx, { ai: async () => ({ ok: false, error: 'HTTP 401' }) });
  ok(fail.run.status === 'falhou' && /HTTP 401/.test(fail.run.reason), 'falha de fornecedor não registada');
  return 'sucesso, JSON inválido e falha de fornecedor distinguidos · nada inventado';
});

await t('esquema v5 registado e meta publica os agentes', async () => {
  const meta = await (await fetch(BASE + '/api/meta')).json();
  ok(meta.schemaVersion === 7, 'versão ' + meta.schemaVersion);
  ok(meta.agents.total === 13 && meta.agents.local + meta.agents.ai === 13, 'meta dos agentes: ' + JSON.stringify(meta.agents));
  /* base criada já na versão actual não tem passos de migração; uma base antiga tem de os registar */
  ok(meta.migrations.length === 0 || meta.migrations.some((m) => m.to >= 4), 'migração para v4+ não registada');
  return 'schemaVersion 5 (' + (meta.migrations.length ? meta.migrations.length + ' passo(s) de migração' : 'base criada na versão actual') + ') · ' + meta.agents.local + ' agentes locais · ' + meta.agents.ai + ' de IA · prompt ' + meta.agents.promptVersion;
});

srv.kill('SIGTERM');
console.log('\n' + pass + '/' + (pass + fail) + ' passaram');
process.exit(fail ? 1 : 0);
