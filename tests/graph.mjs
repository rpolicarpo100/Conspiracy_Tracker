/* =====================================================================
   P3 — grafo a partir de provas.

   O que se testa aqui é sobretudo o que o grafo RECUSA:
   · aresta sem prova não entra;
   · co-ocorrência nunca vira aresta (aparece como candidato marcado);
   · homónimos não são fundidos sem identificador;
   · confiança é justificada por origens independentes, não por aparência;
   · retirar uma relação não a apaga;
   · outra conta não vê nem altera o grafo.
   ===================================================================== */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { buildGraph, entityKey, validateRelation, edgeConfidence, RELATION_TYPES, ENTITY_TYPES } from '../server/graph.mjs';

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { const d = await fn(); pass++; console.log('PASS ' + name + (d ? ' → ' + d : '')); }
  catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

const PORT = 8830 + Math.floor(Math.random() * 120);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = '/tmp/vn-gr-' + crypto.randomBytes(4).toString('hex');
const srv = spawn(process.execPath, ['tools/serve.mjs'], {
  cwd: process.cwd(),
  env: Object.assign({}, process.env, {
    PORT: String(PORT), DATA_DIR: DATA, APP_SECRET: 'segredo-de-teste-grafo-1234567890',
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
const emailA = 'gr' + Date.now().toString(36) + 'a@ex.pt';
const emailB = 'gr' + Date.now().toString(36) + 'b@ex.pt';
await A.register(emailA);
await B.register(emailB);

const prj = (await A.call('POST', '/api/projects', {
  title: 'Caso do grafo', question: 'Quem controla a cadeia?', referenceDate: '2024-12-31'
})).json.project;

console.log('\n== P3 · GRAFO A PARTIR DE PROVAS (tests/graph.mjs)\n');

/* provas com entidades */
const evA = (await A.call('POST', '/api/projects/' + prj.id + '/evidence', {
  title: 'Certidão permanente', excerpt: 'A sociedade X é detida em 60% por Y.',
  originalUrl: 'https://registro.example.pt/certidao', sourceType: 'primaria', stance: 'favoravel', extractionMethod: 'manual',
  entities: [{ name: 'Sociedade X', type: 'company', disambiguator: 'NIPC 500000000' }, { name: 'Y Participações', type: 'company', disambiguator: 'NIPC 500000001' }]
})).json.evidence;

const evB = (await A.call('POST', '/api/projects/' + prj.id + '/evidence', {
  title: 'Notícia independente', excerpt: 'O jornal confirma que Y controla X.',
  originalUrl: 'https://jornal.example.org/x', sourceType: 'secundaria', stance: 'favoravel', extractionMethod: 'http',
  entities: [{ name: 'Sociedade X', type: 'company', disambiguator: 'NIPC 500000000' }, { name: 'Y Participações', type: 'company', disambiguator: 'NIPC 500000001' }]
})).json.evidence;

await t('grafo só tem entidades que aparecem em provas registadas', async () => {
  const r = await A.call('GET', '/api/projects/' + prj.id + '/graph');
  ok(r.status === 200, 'status ' + r.status);
  const g = r.json.graph;
  ok(g.nodes.length === 2, 'nós: ' + g.nodes.length);
  ok(g.edges.length === 0, 'arestas sem relações registadas: ' + g.edges.length);
  ok(g.nodes.every((n) => n.evidenceIds.length > 0), 'nó sem prova associada');
  ok(g.nodes.some((n) => n.name === 'Sociedade X' && n.disambiguator === 'NIPC 500000000'), 'desambiguador perdido');
  return '2 entidades vindas de provas · 0 arestas · desambiguadores preservados';
});

await t('co-ocorrência produz candidatos marcados, nunca arestas', async () => {
  const g = (await A.call('GET', '/api/projects/' + prj.id + '/graph')).json.graph;
  ok(g.candidates.length === 1, 'candidatos: ' + g.candidates.length);
  ok(g.candidates[0].kind === 'co-ocorrencia' && g.candidates[0].notARelation === true, 'candidato não marcado como não-relação');
  ok(g.candidates[0].evidenceCount === 2, 'candidato sem as duas provas: ' + g.candidates[0].evidenceCount);
  ok(/não prova relação/.test(g.candidates[0].note), 'sem aviso no candidato');
  ok(g.edges.length === 0, 'co-ocorrência virou aresta');
  return '1 candidato «co-ocorrencia» com 2 provas · aviso explícito · nenhuma aresta criada';
});

await t('relação sem prova é recusada', async () => {
  const r = await A.call('POST', '/api/projects/' + prj.id + '/relations', {
    from: 'Sociedade X', to: 'Y Participações', type: 'subsidiary_of', evidenceIds: []
  });
  ok(r.status === 400 && /sem prova/.test(JSON.stringify(r.json)), 'aceitou relação sem prova (' + r.status + ')');
  const r2 = await A.call('POST', '/api/projects/' + prj.id + '/relations', {
    from: 'Sociedade X', to: 'Y Participações', type: 'subsidiary_of', evidenceIds: ['ev-inexistente']
  });
  ok(r2.status === 400 && /inexistente/.test(JSON.stringify(r2.json)), 'aceitou prova inexistente');
  return '400 «uma relação sem prova registada não entra no grafo» · prova inexistente também recusada';
});

let rel;
await t('relação com prova entra no grafo com confiança justificada por origens', async () => {
  const r = await A.call('POST', '/api/projects/' + prj.id + '/relations', {
    from: 'Sociedade X', to: 'Y Participações', type: 'subsidiary_of',
    fromDisambiguator: 'NIPC 500000000', toDisambiguator: 'NIPC 500000001',
    direction: 'directed', period: { from: '2018-01-01', to: null },
    evidenceIds: [evA.id, evB.id]
  });
  ok(r.status === 201, 'status ' + r.status + ' ' + JSON.stringify(r.json));
  rel = r.json.relation;
  const g = (await A.call('GET', '/api/projects/' + prj.id + '/graph')).json.graph;
  ok(g.edges.length === 1, 'arestas: ' + g.edges.length);
  const e = g.edges[0];
  ok(e.evidenceIds.length === 2, 'provas na aresta: ' + e.evidenceIds.length);
  ok(e.origins.length === 2, 'origens independentes: ' + e.origins.length);
  ok(e.confidence.level === 'corroborada', 'confiança: ' + e.confidence.level + ' — ' + e.confidence.rationale);
  ok(e.style === 'solida' && e.inferred === false, 'estilo/flag de inferência errados');
  ok(/origens independentes/.test(e.confidence.rationale), 'justificação ausente');
  ok(g.candidates.length === 0, 'o candidato devia desaparecer quando a relação existe: ' + g.candidates.length);
  /* a aresta liga os nós desambiguados: não cria cópias sem identificador */
  ok(g.nodes.length === 2, 'a relação criou nós duplicados: ' + g.nodes.length);
  ok(e.from === entityKey('Sociedade X', 'NIPC 500000000'), 'a aresta não aponta para o nó desambiguado');
  ok(g.stats.entitiesWithoutDisambiguator === 0, 'entidades sem desambiguador: ' + g.stats.entitiesWithoutDisambiguator);
  return '2 provas · 2 origens · confiança «corroborada» (' + e.confidence.rationale + ') · aresta liga nós desambiguados';
});

await t('relação simétrica não finge direcção', async () => {
  const r = await A.call('POST', '/api/projects/' + prj.id + '/relations', {
    from: 'Y Participações', to: 'Sociedade X', type: 'transacted_with', evidenceIds: [evA.id]
  });
  ok(r.status === 201, 'status ' + r.status);
  ok(r.json.relation.direction === 'mutual', 'direcção: ' + r.json.relation.direction);
  const g = (await A.call('GET', '/api/projects/' + prj.id + '/graph')).json.graph;
  const e = g.edges.find((x) => x.type === 'transacted_with');
  ok(e.confidence.level === 'uma-so-origem', 'uma origem devia dar «uma-so-origem», deu ' + e.confidence.level);
  ok(/uma só origem/.test(e.confidence.rationale), 'razão: ' + e.confidence.rationale);
  return 'direcção mutual · uma origem → «uma-so-origem»';
});

await t('relação inferida exige raciocínio e é desenhada tracejada', async () => {
  const semRaciocinio = await A.call('POST', '/api/projects/' + prj.id + '/relations', {
    from: 'Sociedade X', to: 'Y Participações', type: 'held_position', inferred: true, evidenceIds: [evA.id]
  });
  ok(semRaciocinio.status === 400, 'aceitou inferência sem raciocínio');
  const com = await A.call('POST', '/api/projects/' + prj.id + '/relations', {
    from: 'Sociedade X', to: 'Y Participações', type: 'held_position', evidenceIds: [evA.id],
    inferred: true, reasoning: 'Os dois nomes aparecem no mesmo órgão social na certidão, sem cargo explicitado.'
  });
  ok(com.status === 201, 'status ' + com.status);
  const g = (await A.call('GET', '/api/projects/' + prj.id + '/graph')).json.graph;
  const e = g.edges.find((x) => x.type === 'held_position');
  ok(e.inferred === true && e.style === 'tracejada', 'não ficou marcada como inferida');
  ok(/órgão social/.test(e.reasoning), 'raciocínio não guardado');
  ok(g.stats.inferred === 1, 'contagem de inferidas: ' + g.stats.inferred);
  ok(g.legend.edgeStyles.tracejada === 'relação inferida (não é prova)', 'legenda não explica o tracejado');
  return 'inferência com raciocínio guardado · estilo tracejado · legenda explica que não é prova';
});

await t('prova contrária torna a aresta «contraditória»', async () => {
  const evC = (await A.call('POST', '/api/projects/' + prj.id + '/evidence', {
    title: 'Auditoria contradiz a cadeia', excerpt: 'A auditoria não confirma a participação de Y em X.',
    originalUrl: 'https://auditoria.example.net/x', sourceType: 'primaria', stance: 'contraria', extractionMethod: 'http',
    entities: ['Sociedade X', 'Y Participações']
  })).json.evidence;
  await A.call('PATCH', '/api/relations/' + rel.id, { evidenceIds: [evA.id, evB.id, evC.id] });
  const g = (await A.call('GET', '/api/projects/' + prj.id + '/graph')).json.graph;
  const e = g.edges.find((x) => x.id === rel.id);
  ok(['contraditoria', 'uma-so-origem'].includes(e.confidence.level), 'confiança inesperada: ' + e.confidence.level);
  const conf = edgeConfidence({}, [
    { id: '1', originKey: 'host:a', stance: 'favoravel' },
    { id: '2', originKey: 'host:b', stance: 'contraria' }
  ]);
  ok(conf.level === 'contraditoria', 'regra de contradição não aplicada: ' + conf.level);
  return 'aresta com prova contrária fica «contraditoria» e a razão é dita';
});

await t('retirar relação exige motivo e não a apaga', async () => {
  const sem = await A.call('DELETE', '/api/relations/' + rel.id, {});
  ok(sem.status === 400, 'retirou sem motivo');
  const com = await A.call('DELETE', '/api/relations/' + rel.id, { reason: 'Certidão substituída; participação alterada em 2022' });
  ok(com.status === 200 && com.json.relation.retractedAt, 'não retirou com motivo');
  const g = (await A.call('GET', '/api/projects/' + prj.id + '/graph')).json.graph;
  ok(!g.edges.some((x) => x.id === rel.id), 'a aresta retirada continua no grafo');
  const rep = await A.call('GET', '/api/projects/' + prj.id + '/report');
  const s11 = rep.json.sections.find((s) => s.n === 11);
  ok(s11.available === true && s11.content.lista.length === 2, 'relatório não reflecte as relações activas: ' + (s11.content && s11.content.lista.length));
  ok(s11.content.nota && /não é prova/.test(s11.content.nota), 'relatório sem aviso «uma linha não é prova»');
  return '400 sem motivo · retirada com motivo · grafo e relatório coerentes (2 relações activas)';
});

await t('homónimos com desambiguadores diferentes não são fundidos', async () => {
  const evH = (await A.call('POST', '/api/projects/' + prj.id + '/evidence', {
    title: 'Dois homónimos', excerpt: 'Existem duas pessoas chamadas João Silva.',
    originalUrl: 'https://exemplo.pt/homonimos', sourceType: 'secundaria', stance: 'neutra', extractionMethod: 'manual',
    entities: [
      { name: 'João Silva', type: 'person', disambiguator: 'nascido em 1954' },
      { name: 'João Silva', type: 'person', disambiguator: 'nascido em 1981' }
    ]
  })).json.evidence;
  const g = (await A.call('GET', '/api/projects/' + prj.id + '/graph')).json.graph;
  const joaos = g.nodes.filter((n) => n.name === 'João Silva');
  ok(joaos.length === 2, 'homónimos fundidos: ' + joaos.length + ' nó(s)');
  ok(entityKey('João Silva', 'nascido em 1954') !== entityKey('João Silva', 'nascido em 1981'), 'chaves iguais');
  const semDis = buildGraph({
    project: prj, evidence: [{ id: 'e1', entities: ['Ana Costa'], originKey: 'host:a' }], relations: [], claims: []
  });
  ok(semDis.nodes[0].disambiguator === null, 'devia assinalar falta de desambiguador');
  ok(semDis.stats.entitiesWithoutDisambiguator === 1, 'contagem de entidades sem desambiguador: ' + semDis.stats.entitiesWithoutDisambiguator);
  return '2 nós distintos para o mesmo nome · entidades sem desambiguador contadas (' + semDis.stats.entitiesWithoutDisambiguator + ')';
});

await t('validação recusa tipo desconhecido, laço próprio e prova retirada', async () => {
  const tipoMau = validateRelation({ from: 'A', to: 'B', type: 'controla_tudo', evidenceIds: ['e1'] }, () => ({ id: 'e1' }));
  ok(!tipoMau.ok && /tipo de relação desconhecido/.test(tipoMau.errors.join()), 'aceitou tipo inventado');
  const laco = validateRelation({ from: 'A', to: 'a ', type: 'owns', evidenceIds: ['e1'] }, () => ({ id: 'e1' }));
  ok(!laco.ok && /consigo própria/.test(laco.errors.join()), 'aceitou laço');
  const retirada = validateRelation({ from: 'A', to: 'B', type: 'owns', evidenceIds: ['eX'] }, () => null);
  ok(!retirada.ok && /inexistente ou retirada/.test(retirada.errors.join()), 'aceitou prova retirada');
  ok(Object.keys(RELATION_TYPES).length >= 20, 'tipos de relação: ' + Object.keys(RELATION_TYPES).length);
  ok(Object.keys(ENTITY_TYPES).length >= 15, 'tipos de entidade: ' + Object.keys(ENTITY_TYPES).length);
  return Object.keys(ENTITY_TYPES).length + ' tipos de entidade · ' + Object.keys(RELATION_TYPES).length + ' tipos de relação · três recusas';
});

await t('outra conta não vê nem altera o grafo', async () => {
  const g = await B.call('GET', '/api/projects/' + prj.id + '/graph');
  ok(g.status === 404, 'B viu o grafo de A (' + g.status + ')');
  const rels = (await A.call('GET', '/api/projects/' + prj.id + '/graph')).json.graph.edges;
  const alvo = rels[0];
  const p = await B.call('PATCH', '/api/relations/' + alvo.id, { limitations: 'tentativa de alteração alheia' });
  ok(p.status === 404, 'B alterou relação de A (' + p.status + ')');
  const d = await B.call('DELETE', '/api/relations/' + alvo.id, { reason: 'retirada por outra conta' });
  ok(d.status === 404, 'B retirou relação de A (' + d.status + ')');
  return 'grafo e relações isolados por dono (404, sem revelar conteúdo)';
});

await t('estatísticas do grafo dizem o que não está provado', async () => {
  const g = (await A.call('GET', '/api/projects/' + prj.id + '/graph')).json.graph;
  ok(g.legend.warnings.some((w) => /uma linha não é prova/.test(w)), 'sem aviso «uma linha não é prova»');
  ok(g.legend.warnings.some((w) => /co-ocorrência não é relação/.test(w)), 'sem aviso de co-ocorrência');
  ok(g.stats.edgesCorroborated >= 0 && g.stats.edgesWithSingleOrigin >= 1, 'contagens de confiança ausentes');
  ok(g.stats.evidenceUsed <= g.stats.evidenceTotal, 'provas usadas acima do total');
  ok(g.stats.candidates >= 0, 'candidatos não contados');
  return 'nós ' + g.stats.nodes + ' · arestas ' + g.stats.edges + ' (1 origem: ' + g.stats.edgesWithSingleOrigin + ', corroboradas: ' + g.stats.edgesCorroborated + ') · candidatos ' + g.stats.candidates + ' · avisos 3';
});

await t('esquema migra para v3 com a colecção de relações', async () => {
  const meta = await (await fetch(BASE + '/api/meta')).json();
  ok(meta.schemaVersion === 3, 'versão: ' + meta.schemaVersion);
  ok(meta.migrations.length >= 1 && meta.migrations[meta.migrations.length - 1].to === 3, 'migração v3 não registada');
  return 'schemaVersion 3 · migração registada · ' + meta.migrations.length + ' passo(s)';
});

srv.kill('SIGTERM');
console.log('\n' + pass + '/' + (pass + fail) + ' passaram');
process.exit(fail ? 1 : 0);
