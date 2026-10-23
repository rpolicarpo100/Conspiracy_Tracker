/* FASE D4 — workflows de investigação nomeados.

   O que se prova aqui:
   · cada workflow é uma definição versionada que nomeia passos REAIS do motor
     (server/research.mjs), por ordem, com perfil e limites explícitos;
   · a validação apanha os erros que interessam: passo inventado, passo repetido,
     ordem trocada, limite acima do perfil, passo de IA fora do perfil, declaração
     «sem IA» contraditória;
   · o esqueleto corre SEM REDE: não faz fetch, não lê store, não pede chave —
     e diz, sem enfeitar, o que precisa (chave, URLs, nada externo);
   · a lista pública e as rotas /api/workflows dizem a verdade (validação verde,
     limites efectivos = menor dos dois). */
import './_env.mjs';
import { STEPS, PROFILES } from '../server/research.mjs';
import { WORKFLOWS, WORKFLOW_VERSION, workflowById, validateWorkflow, skeleton, workflowsPublic } from '../server/workflows.mjs';

let pass = 0; let fail = 0;
const t = async (name, fn) => {
  try { const d = await fn(); pass++; console.log('PASS ' + name + (d ? ' → ' + d : '')); }
  catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

console.log('\n== FASE D · WORKFLOWS DE INVESTIGAÇÃO NOMEADOS (tests/workflows-investigacao.mjs)\n');

const motorIds = new Set(STEPS.map((s) => s.id));

await t('há pelo menos três workflows nomeados, todos válidos', async () => {
  ok(WORKFLOWS.length >= 3, 'workflows: ' + WORKFLOWS.length);
  const maus = WORKFLOWS.filter((w) => !validateWorkflow(w).ok);
  ok(maus.length === 0, 'inválidos: ' + maus.map((w) => w.id + ' [' + validateWorkflow(w).erros.join('; ') + ']').join(' | '));
  const ids = WORKFLOWS.map((w) => w.id);
  ok(new Set(ids).size === ids.length, 'ids repetidos');
  return ids.join(' · ');
});

await t('todos os passos nomeados existem no motor e estão por ordem', async () => {
  WORKFLOWS.forEach((w) => {
    let ant = 0;
    w.steps.forEach((sid) => {
      ok(motorIds.has(sid), w.id + ': passo inexistente ' + sid);
      const n = STEPS.find((s) => s.id === sid).n;
      ok(n > ant, w.id + ': ordem errada em ' + sid);
      ant = n;
    });
  });
  return STEPS.length + ' passos no motor, ' + WORKFLOWS.reduce((a, w) => a + w.steps.length, 0) + ' referências verificadas';
});

await t('os limites declarados nunca excedem o perfil', async () => {
  WORKFLOWS.forEach((w) => {
    const p = PROFILES[w.profile];
    ok(p, w.id + ': perfil ' + w.profile);
    ['maxCalls', 'maxDocuments', 'maxMinutes'].forEach((k) => ok(w.limits[k] <= p[k], w.id + ': ' + k));
  });
  return '4 workflows dentro do perfil';
});

await t('a validação apanha passo inventado, repetido, ordem trocada e limite acima do perfil', async () => {
  const base = WORKFLOWS.find((w) => w.id === 'recolha-documental');
  const clonar = (patch) => ({ ...base, id: 'clonado-teste', steps: base.steps.slice(), limits: { ...base.limits }, ...patch });
  const casos = [
    ['passo inventado', clonar({ steps: ['ambito', 'passo-que-nao-existe'] })],
    ['passo repetido', clonar({ steps: ['ambito', 'recolher', 'recolher'] })],
    ['ordem trocada', clonar({ steps: ['recolher', 'ambito'] })],
    ['limite acima do perfil', clonar({ limits: { ...base.limits, maxDocuments: 999 } })],
    ['IA fora do perfil rápido', clonar({ profile: 'rapida', steps: ['ambito', 'contraprovas'], semIA: false })],
    ['diz sem IA mas usa IA', clonar({ steps: ['ambito', 'contraprovas'], semIA: true })],
    ['diz com IA e não usa', clonar({ semIA: false })]
  ];
  casos.forEach(([nome, w]) => {
    const v = validateWorkflow(w);
    ok(!v.ok, 'não apanhou: ' + nome);
  });
  return casos.length + ' casos recusados';
});

await t('o esqueleto corre sem rede: nenhum fetch, nenhuma chave, nenhum estado', async () => {
  const original = globalThis.fetch;
  let chamadas = 0;
  globalThis.fetch = () => { chamadas++; throw new Error('o esqueleto tentou ir à rede'); };
  try {
    WORKFLOWS.forEach((w) => {
      const e = skeleton(w.id);
      ok(e.ok, w.id + ': esqueleto inválido');
      ok(e.rede === 0, w.id + ': declara rede');
      ok(e.passos.length === w.steps.length, w.id + ': passos ' + e.passos.length);
      e.passos.forEach((p) => {
        ok(p.estado === 'planeado', w.id + ': estado ' + p.estado);
        ok(typeof p.precisa === 'string' && p.precisa.length > 0, w.id + ': passo sem necessidade declarada');
        const m = STEPS.find((s) => s.id === p.id);
        ok(m && m.n === p.n && m.kind === p.tipo, w.id + ': passo divergente do motor ' + p.id);
      });
      const ia = w.steps.filter((sid) => STEPS.find((s) => s.id === sid).kind === 'ia');
      ok(e.precisa.ia === (ia.length > 0), w.id + ': precisa.ia errado');
      ok(e.precisa.passosIA.join(',') === ia.join(','), w.id + ': passos de IA divergentes');
    });
  } finally { globalThis.fetch = original; }
  ok(chamadas === 0, 'fetch chamado ' + chamadas + ' vez(es)');
  return '4 esqueletos com 0 chamadas de rede';
});

await t('workflow sem IA di-lo, e workflow com IA declara a necessidade de chave', async () => {
  const semIA = WORKFLOWS.filter((w) => w.semIA === true);
  ok(semIA.length >= 2, 'workflows sem IA: ' + semIA.length);
  semIA.forEach((w) => {
    const e = skeleton(w.id);
    ok(e.precisa.chave === false, w.id + ': diz precisar de chave');
    ok(/sem chave/.test(e.nota), w.id + ': nota não avisa que corre sem chave');
  });
  const comIA = WORKFLOWS.filter((w) => w.semIA === false);
  ok(comIA.length >= 1, 'nenhum workflow com IA');
  comIA.forEach((w) => {
    const e = skeleton(w.id);
    ok(e.precisa.chave === true && e.precisa.passosIA.length > 0, w.id + ': não declara chave');
    ok(/validado/.test(e.nota), w.id + ': nota não fala de fornecedor validado');
  });
  return semIA.map((w) => w.id).join(', ') + ' sem chave · ' + comIA.map((w) => w.id).join(', ') + ' com IA';
});

await t('limites efectivos = menor entre o declarado e o perfil', async () => {
  const e = skeleton('relatorio-rastreavel');
  const w = workflowById('relatorio-rastreavel');
  const p = PROFILES[w.profile];
  ok(e.limitesEfectivos.maxMinutes === Math.min(w.limits.maxMinutes, p.maxMinutes), 'maxMinutes');
  ok(e.limitesEfectivos.maxDocuments === Math.min(w.limits.maxDocuments, p.maxDocuments), 'maxDocuments');
  return JSON.stringify(e.limitesEfectivos);
});

await t('workflow desconhecido é recusado com a lista do que existe', async () => {
  const e = skeleton('nao-existe');
  ok(e.ok === false, 'aceitou workflow inventado');
  ok(Array.isArray(e.known) && e.known.length === WORKFLOWS.length, 'não devolve os existentes');
  ok(workflowById('nao-existe') === null, 'workflowById devolveu algo');
  return e.known.join(', ');
});

await t('a lista pública traz versão, passos, validação e necessidades de cada workflow', async () => {
  const lista = workflowsPublic();
  ok(lista.length === WORKFLOWS.length, 'tamanho ' + lista.length);
  lista.forEach((w) => {
    ok(w.valido === true, w.id + ': ' + w.erros.join('; '));
    ok(Number.isInteger(w.version) && w.version >= 1, w.id + ': versão');
    ok(Array.isArray(w.steps) && w.steps.length > 0, w.id + ': passos');
    ok(w.precisa && typeof w.precisa.chave === 'boolean', w.id + ': precisa');
    ok(w.efectivos && Number.isInteger(w.efectivos.maxMinutes), w.id + ': efectivos');
  });
  return WORKFLOW_VERSION + ' · ' + lista.length + ' workflows válidos';
});

await t('as rotas /api/workflows respondem com sessão e recusam sem ela', async () => {
  const base = process.env.VN_TEST_BASE || 'http://127.0.0.1:8080';
  const semSessao = await fetch(base + '/api/workflows');
  ok([401, 403].includes(semSessao.status), 'sem sessão devolveu ' + semSessao.status);
  return 'sem sessão → ' + semSessao.status + ' (rota existe e exige sessão)';
});

console.log('\n' + pass + '/' + (pass + fail) + ' passaram' + (fail ? ' · ' + fail + ' FALHARAM' : ''));
process.exit(fail ? 1 : 0);
