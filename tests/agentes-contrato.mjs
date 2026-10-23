/* FASE D — contrato de agente aplicado a sério.

   O que se prova aqui, por palavras próprias:
   · cada agente declara tempo, tecto de itens, orçamento de chamadas, retries e
     cancelamento — e o executor APLICA-os (não é decoração no catálogo);
   · a saída é validada contra o contrato: falta de chave é «falhou», não sucesso
     vazio, e o excesso de itens é cortado com aviso;
   · esgotar o orçamento de um agente pára só esse agente;
   · cancelar antes ou a meio não guarda resultado nenhum;
   · o passo de contraprovas do fluxo calcula sem IA em vez de ficar vazio;
   · os workflows de operação têm modo seco e ele não escreve. */
import './_env.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  AGENTS, agentById, executeAgent, validateAgentOutput
} from '../server/agents.mjs';
import { createStore } from '../server/store.mjs';
import { runResearch } from '../server/research.mjs';

let pass = 0; let fail = 0;
const t = async (name, fn) => {
  try { const d = await fn(); pass++; console.log('PASS ' + name + (d ? ' → ' + d : '')); }
  catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };

const DIR = '/tmp/vn-agentes-' + crypto.randomBytes(4).toString('hex');
const store = await createStore(DIR).init();
const user = await store.createUser({ email: 'agentes@ex.pt', passwordHash: 'x', salt: 'y' });
const project = await store.createProject(user.id, { title: 'Contrato', question: 'O contrato existe?', referenceDate: '2026-01-01' });
const ctx = { project, evidence: [], claims: [], relations: [], runs: [] };

console.log('\n== FASE D · CONTRATO DE AGENTE, ORÇAMENTO E CANCELAMENTO (tests/agentes-contrato.mjs)\n');

/* ---------------- D1: contrato completo ---------------- */

await t('os 13 agentes declaram tempo, tecto de itens, chamadas, retries e cancelamento', async () => {
  ok(AGENTS.length === 13, 'agentes: ' + AGENTS.length);
  AGENTS.forEach((ag) => {
    ['timeoutMs', 'maxItems', 'maxCalls', 'retries', 'cancelavel'].forEach((k) => {
      ok(ag.limits[k] !== undefined, ag.id + ' sem ' + k);
    });
    ok(ag.limits.cancelavel === true, ag.id + ' não é cancelável');
    ok(Array.isArray(ag.contract.outRequired) && ag.contract.outRequired.length > 0, ag.id + ' sem saída obrigatória declarada');
    ag.contract.outRequired.forEach((k) => {
      const declarado = ag.contract.out.join(' ');
      ok(declarado.length > 0, ag.id + ' sem contrato de saída legível');
    });
  });
  return '13 agentes com 5 limites e saída obrigatória (' + AGENTS.map((a) => a.contract.outRequired.length).join('/') + ')';
});

await t('saída fora do contrato é «falhou», nunca sucesso vazio', async () => {
  const ai = async () => ({ ok: true, provider: 'p', model: 'm', parsed: {} });      // objecto vazio
  const r = await executeAgent({}, 'web-search', ctx, { ai });
  /* o essencial é não ser sucesso; o estado final varia com o que aperta primeiro:
     o contrato («falhou») ou o orçamento de chamadas («orcamento-esgotado»). */
  ok(['falhou', 'orcamento-esgotado'].includes(r.run.status), 'estado ' + r.run.status);
  ok(/falta consultas/.test(r.run.reason), 'motivo sem a chave em falta: ' + r.run.reason);
  ok(r.run.output === null, 'guardou saída vazia como resultado');
  const v = validateAgentOutput('web-search', { consultas: [{ texto: 'a' }] });
  ok(v.ok === true, 'saída válida recusada: ' + v.faltas.join(','));
  return 'objecto vazio recusado com motivo nomeado · saída válida aceite';
});

await t('excesso de itens é cortado no tecto do agente e o corte fica registado', async () => {
  const muitas = Array.from({ length: 25 }, (_, i) => ({ texto: 'c' + i }));
  const r = await executeAgent({}, 'web-search', ctx, { ai: async () => ({ ok: true, parsed: { consultas: muitas } }) });
  ok(r.run.status === 'concluido', 'estado ' + r.run.status);
  ok(r.run.output.consultas.length === 20, 'itens: ' + r.run.output.consultas.length);
  ok(r.run.truncado && r.run.truncado.consultas.tinha === 25, 'corte não registado: ' + JSON.stringify(r.run.truncado));
  ok(/cortada/.test(r.run.reason), 'motivo sem aviso de corte: ' + r.run.reason);
  return '25 → 20 itens · corte declarado no resultado';
});

/* ---------------- D2/D3: orçamento e retry ---------------- */

await t('retry por agente: falha duas vezes e passa à terceira, com as tentativas registadas', async () => {
  let n = 0;
  const ai = async () => {
    n++;
    if (n < 3) return { ok: false, error: 'fornecedor em baixa' };
    return { ok: true, provider: 'p', model: 'm', parsed: { consultas: [{ texto: 'ok' }] } };
  };
  const r = await executeAgent({}, 'web-search', ctx, { ai });
  ok(r.run.status === 'concluido', 'estado ' + r.run.status + ' (' + r.run.reason + ')');
  ok(r.run.tentativas.length === 3, 'tentativas: ' + r.run.tentativas.length);
  ok(r.run.chamadas === 3, 'chamadas: ' + r.run.chamadas);
  ok(r.run.tentativas[0].ok === false && r.run.tentativas[2].ok === true, 'sequência de tentativas: ' + JSON.stringify(r.run.tentativas.map((x) => x.ok)));
  return '3 tentativas (2 falhas + 1 sucesso) · chamadas contadas';
});

await t('orçamento do agente esgota e para SÓ esse agente', async () => {
  const chamadas = [];
  const ai = async () => { chamadas.push(1); return { ok: false, error: 'sempre em baixo' }; };
  const r = await executeAgent({}, 'web-search', ctx, { ai });
  ok(r.run.status === 'orcamento-esgotado', 'estado ' + r.run.status + ' (' + r.run.reason + ')');
  ok(r.run.chamadas === agentById('web-search').limits.maxCalls, 'chamadas ' + r.run.chamadas);
  ok(/esgotado/.test(r.run.reason), 'motivo: ' + r.run.reason);
  /* outro agente, com o mesmo executor, continua a funcionar */
  const outro = await executeAgent({}, 'orchestrator', ctx, { ai: null });
  ok(outro.run.status === 'concluido', 'o agente local seguinte não correu: ' + outro.run.status);
  return 'web-search esgotou em ' + r.run.chamadas + ' chamadas · orchestrator a seguir correu normalmente';
});

await t('cancelar antes de começar não faz uma única chamada', async () => {
  let chamadas = 0;
  const r = await executeAgent({}, 'report-generator', ctx, { ai: async () => { chamadas++; return { ok: true, parsed: { seccoes: [] } }; }, cancelado: () => true });
  ok(r.run.status === 'cancelado', 'estado ' + r.run.status);
  ok(chamadas === 0, 'fez ' + chamadas + ' chamada(s) depois de cancelado');
  ok(r.run.output === null, 'guardou resultado apesar de cancelado');
  return 'estado «cancelado» · 0 chamadas · nada guardado';
});

await t('cancelar entre tentativas interrompe o retry', async () => {
  let n = 0;
  const r = await executeAgent({}, 'web-search', ctx, {
    ai: async () => { n++; return { ok: false, error: 'baixa' }; },
    cancelado: () => n >= 1            // cancelado depois da primeira falha
  });
  ok(r.run.status === 'cancelado', 'estado ' + r.run.status + ' (' + r.run.reason + ')');
  ok(n === 1, 'tentou ' + n + ' vezes depois de cancelado');
  return 'parou após 1 tentativa · nada guardado';
});

await t('agente local também respeita o tecto de itens', async () => {
  const muitasProvas = Array.from({ length: 260 }, (_, i) => ({ id: 'ev-' + i, title: 't' + i, excerpt: 'e',
    entities: [{ name: 'Pessoa ' + i, disambiguator: null }], stance: 'favoravel' }));
  const r = await executeAgent({}, 'entity-resolution', { project, evidence: muitasProvas, claims: [], relations: [], runs: [] }, {});
  ok(r.run.status === 'concluido', 'estado ' + r.run.status);
  ok(r.run.output.semDesambiguador.length <= 200, 'não respeitou 200: ' + r.run.output.semDesambiguador.length);
  ok(r.run.truncado && r.run.truncado.semDesambiguador.ficou === 200, 'corte não registado: ' + JSON.stringify(r.run.truncado));
  return '260 entidades → ' + r.run.output.semDesambiguador.length + ' (tecto 200) com corte declarado';
});

/* ---------------- contraprovas sem IA no fluxo ---------------- */

await t('o passo de contraprovas calcula sem IA em vez de ficar vazio', async () => {
  const c = await store.createClaim(project.id, { text: 'Afirmação sem contraprova procurada', kind: 'facto', state: 'hipotese', createdBy: user.id, evidenceIds: [] });
  const run = await store.createRun(project.id, {
    userId: user.id, profile: 'profunda',
    candidates: { urls: ['https://arquivo.example/peca'] },
    budget: { maxCalls: 30, maxDocuments: 20, maxMinutes: 30 }
  });
  const out = await runResearch({ store, ai: null, fetchDoc: async () => ({ ok: false, error: 'sem rede no teste' }) }, run.id, { ai: null });
  const passo = out.run.steps.find((x) => x.id === 'contraprovas');
  ok(passo, 'passo de contraprovas não registado');
  ok(passo.status === 'concluido', 'estado do passo: ' + passo.status);
  ok(/sem IA/.test(passo.reason), 'não declarou que foi sem IA: ' + passo.reason);
  ok(passo.output && passo.output.totalAaProcurar >= 1, 'não apontou as afirmações sem procura: ' + JSON.stringify(passo.output).slice(0, 120));
  ok(passo.output.semProcura.some((x) => x.conclusao === c.id), 'a conclusão criada não aparece na lista');
  return 'passo 15 concluído sem IA · ' + passo.output.totalAaProcurar + ' afirmação(ões) sem procura de contraprova';
});

/* ---------------- workflows com modo seco ---------------- */

await t('os workflows de operação têm modo seco declarado', async () => {
  const lidos = {};
  ['.github/workflows/manutencao.yml', '.github/workflows/reevaluate.yml',
    '.github/workflows/keyless-scan.yml', '.github/workflows/ai-quota.yml'].forEach((f) => {
    lidos[f] = fs.readFileSync(f, 'utf8');
  });
  ok(/seco/.test(lidos['.github/workflows/manutencao.yml']), 'manutencao sem modo seco');
  ok(/if: \$\{\{ github\.event_name == 'schedule' \|\| inputs\.seco == false \}\}/.test(lidos['.github/workflows/manutencao.yml']),
    'manutencao: a purga não está condicionada ao modo seco');
  ok(/seco/.test(lidos['.github/workflows/reevaluate.yml']), 'reevaluate sem modo seco');
  ok(/workflow_dispatch/.test(lidos['.github/workflows/ai-quota.yml']), 'ai-quota sem disparo manual');
  ok(/workflow_dispatch/.test(lidos['.github/workflows/keyless-scan.yml']), 'keyless sem disparo manual');
  return 'manutencao e reevaluate com modo seco · os quatro workflows com disparo manual';
});

await fs.promises.rm(DIR, { recursive: true, force: true }).catch(() => {});
console.log('\n' + pass + '/' + (pass + fail) + ' passaram');
process.exit(fail ? 1 : 0);
