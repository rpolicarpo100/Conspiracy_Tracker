/* =====================================================================
   WORKFLOWS DE INVESTIGAÇÃO NOMEADOS (FASE D4)

   Um workflow é uma DEFINIÇÃO versionada: quais dos 20 passos do motor
   (server/research.mjs) correm, por que ordem, com que perfil e com que
   limites explicitos. Não é uma promessa de cobertura nem um atalho: cada
   passo nomeado tem de existir no motor, e os limites nunca podem exceder
   o perfil que os enquadra.

   Regras (todas verificáveis por `validateWorkflow`):
   · ids de passo existentes em STEPS — nada inventado;
   · ordem crescente, sem repetições — a ordem é a do motor;
   · perfil existente (rapida|normal|profunda|exaustiva);
   · limites (maxCalls, maxDocuments, maxMinutes) inteiros positivos e
     ≤ limites do perfil;
   · os passos de IA do workflow são um subconjunto de profile.aiSteps e
     têm kind 'ia' no motor — um workflow sem passos de IA declara-o, para
     que a UI diga «corre sem chave» em vez de fingir que usa IA;
   · `skeleton()` é puro cálculo: não faz fetch, não lê o store, não chama
     IA. É o que o teste corre para provar o esqueleto sem rede.
   ===================================================================== */
import { STEPS, PROFILES, profileOf } from './research.mjs';

export const WORKFLOW_VERSION = 'w1';

const stepById = new Map(STEPS.map((s) => [s.id, s]));

export const WORKFLOWS = [
  {
    id: 'triagem-rapida',
    name: 'Triagem rápida',
    version: 1,
    profile: 'rapida',
    goal: 'Em 2 minutos: fixar o âmbito, listar que fontes primárias e secundárias procurar e recolher até 3 documentos. Nenhum passo de IA — corre sem chave.',
    steps: ['ambito', 'primarias', 'secundarias', 'recolher'],
    limits: { maxCalls: 0, maxDocuments: 3, maxMinutes: 2 },
    inputs: { urls: '1–3 URLs indicadas pelo utilizador' },
    outputs: ['âmbito datado', 'lista de fontes a procurar', 'documentos arquivados com hash'],
    semIA: true
  },
  {
    id: 'recolha-documental',
    name: 'Recolha documental',
    version: 1,
    profile: 'normal',
    goal: 'Arquivar o que o utilizador indicou e provar que ficou íntegro: recolha, deduplicação por conteúdo e verificação de datas, origem e hash. Sem interpretação de IA.',
    steps: ['ambito', 'primarias', 'secundarias', 'recolher', 'resolver', 'deduplicar', 'verificar', 'lacunas'],
    limits: { maxCalls: 0, maxDocuments: 8, maxMinutes: 10 },
    inputs: { urls: '1–8 URLs indicadas pelo utilizador' },
    outputs: ['documentos arquivados (hash, estado, revisão pendente)', 'duplicados agrupados por original', 'lacunas e fontes inacessíveis'],
    semIA: true
  },
  {
    id: 'verificacao-cruzada',
    name: 'Verificação cruzada',
    version: 1,
    profile: 'profunda',
    goal: 'Avaliar corroboração por origens independentes e procurar activamente contraprovas para cada afirmação favorável, declarando o que não foi encontrado.',
    steps: ['resolver', 'deduplicar', 'verificar', 'corroborar', 'contraprovas', 'lacunas', 'grafo'],
    limits: { maxCalls: 6, maxDocuments: 20, maxMinutes: 20 },
    inputs: { documents: 'documentos já arquivados no projecto', claims: 'afirmações a verificar' },
    outputs: ['apoios distintos por original', 'contraprovas procuradas (encontradas/não encontradas)', 'lacunas de verificação', 'entidades e relações candidatas'],
    semIA: false
  },
  {
    id: 'relatorio-rastreavel',
    name: 'Relatório rastreável',
    version: 1,
    profile: 'normal',
    goal: 'Fechar o ciclo: das provas confirmadas ao relatório com proveniência por afirmação, pronto para revisão humana.',
    steps: ['verificar', 'corroborar', 'lacunas', 'grafo', 'relatorio', 'revisao'],
    limits: { maxCalls: 0, maxDocuments: 0, maxMinutes: 5 },
    inputs: { claims: 'afirmações com prova e excerto' },
    outputs: ['relatório com proveniência', 'lista de lacunas', 'entrega para revisão'],
    semIA: true
  }
];

export const workflowById = (id) => WORKFLOWS.find((w) => w.id === id) || null;

/* Validação pura de uma definição. Devolve sempre {ok, erros[]} — nunca lança. */
export function validateWorkflow(w) {
  const erros = [];
  if (!w || typeof w !== 'object') return { ok: false, erros: ['definição ausente'] };
  const id = String(w.id || '');
  if (!/^[a-z0-9-]{3,40}$/.test(id)) erros.push('id inválido: minúsculas, dígitos e hífen (3–40)');
  if (!w.name) erros.push('nome ausente');
  if (!Number.isInteger(w.version) || w.version < 1) erros.push('versão tem de ser inteiro ≥ 1');
  const perfil = PROFILES[w.profile];
  if (!perfil) erros.push('perfil desconhecido: ' + String(w.profile));

  const steps = Array.isArray(w.steps) ? w.steps : [];
  if (!steps.length) erros.push('sem passos');
  const vistos = new Set();
  let anterior = 0;
  steps.forEach((sid) => {
    const s = stepById.get(sid);
    if (!s) return erros.push('passo inexistente no motor: ' + sid);
    if (vistos.has(sid)) erros.push('passo repetido: ' + sid);
    vistos.add(sid);
    if (s.n <= anterior) erros.push('ordem dos passos fora da ordem do motor: ' + sid);
    anterior = s.n;
  });

  const lim = w.limits || {};
  ['maxCalls', 'maxDocuments', 'maxMinutes'].forEach((k) => {
    const v = lim[k];
    if (!Number.isInteger(v) || v < 0) return erros.push('limite inválido: ' + k);
    if (perfil && Number.isInteger(perfil[k]) && v > perfil[k]) {
      erros.push('limite ' + k + '=' + v + ' excede o perfil ' + w.profile + ' (' + perfil[k] + ')');
    }
  });

  /* Passos de IA: só podem ser os que o perfil autoriza. */
  const iaNoMotor = steps.filter((sid) => (stepById.get(sid) || {}).kind === 'ia');
  if (perfil) {
    const fora = iaNoMotor.filter((sid) => !perfil.aiSteps.includes(sid));
    if (fora.length) erros.push('passos de IA fora do perfil ' + w.profile + ': ' + fora.join(', '));
  }
  if (w.semIA === true && iaNoMotor.length) erros.push('declara sem IA mas inclui passos de IA: ' + iaNoMotor.join(', '));
  if (w.semIA === false && !iaNoMotor.length) erros.push('declara com IA mas não inclui nenhum passo de IA');

  return { ok: erros.length === 0, erros };
}

/* Esqueleto: o plano do workflow, sem rede e sem estado.
   Serve para a UI mostrar o que vai correr e para o teste provar que o
   esqueleto é executável antes de haver chave, URLs ou projecto. */
export function skeleton(id) {
  const w = workflowById(id);
  if (!w) return { ok: false, error: 'workflow desconhecido', known: WORKFLOWS.map((x) => x.id) };
  const v = validateWorkflow(w);
  const perfil = profileOf(w.profile);
  const passos = w.steps.map((sid, i) => {
    const s = stepById.get(sid);
    return {
      ordem: i + 1, n: s.n, id: s.id, titulo: s.title, fase: s.phase, tipo: s.kind,
      precisa: s.kind === 'ia' ? 'fornecedor de IA validado do utilizador'
        : (s.kind === 'fetch' ? 'URLs indicadas pelo utilizador' : 'nada externo (cálculo local)'),
      estado: 'planeado'
    };
  });
  const ia = passos.filter((p) => p.tipo === 'ia').map((p) => p.id);
  const fetch = passos.filter((p) => p.tipo === 'fetch').map((p) => p.id);
  return {
    ok: v.ok,
    validacao: v,
    workflow: { id: w.id, name: w.name, version: w.version, profile: w.profile, goal: w.goal },
    perfilAplicado: { maxCalls: perfil.maxCalls, maxDocuments: perfil.maxDocuments, maxMinutes: perfil.maxMinutes },
    limitesEfectivos: {
      maxCalls: Math.min(w.limits.maxCalls, perfil.maxCalls),
      maxDocuments: Math.min(w.limits.maxDocuments, perfil.maxDocuments),
      maxMinutes: Math.min(w.limits.maxMinutes, perfil.maxMinutes)
    },
    passos,
    precisa: { ia: ia.length > 0, chave: ia.length > 0, urls: fetch.length > 0, passosIA: ia, passosFetch: fetch },
    rede: 0,
    nota: ia.length ? 'os passos de IA só correm com fornecedor validado; sem ele ficam «não executado» e o resto continua'
      : 'nenhum passo de IA: este workflow corre sem chave'
  };
}

/* Lista pública para /api/workflows — definição + validação + necessidades. */
export function workflowsPublic() {
  return WORKFLOWS.map((w) => {
    const v = validateWorkflow(w);
    const esq = skeleton(w.id);
    return {
      id: w.id, name: w.name, version: w.version, profile: w.profile, goal: w.goal,
      steps: w.steps.slice(), limits: { ...w.limits }, efectivos: esq.limitesEfectivos,
      semIA: w.semIA === true, precisa: esq.precisa, valido: v.ok, erros: v.erros,
      inputs: w.inputs, outputs: w.outputs
    };
  });
}
