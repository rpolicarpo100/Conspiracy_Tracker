/* =====================================================================
   API DO SERVIDOR
   Todas as permissões são verificadas AQUI, nunca no frontend.
   Convenções: respostas {ok:true, ...} ou {error:{code,message}};
   nada devolve chaves, hashes ou tokens de outros utilizadores.
   ===================================================================== */
import crypto from 'node:crypto';
import { createStore } from './store.mjs';
import { createAuth, hashPassword, verifyPassword, passwordProblems, sha256, newToken, publicUser, parseCookies } from './auth.mjs';
import { keyVault } from './crypto-keys.mjs';
import { PROVIDERS, registryPublic, validateProvider, complete, breakerState, isPrivateHost } from './providers.mjs';
import { runResearch, profileOf, PROFILES, STEPS, PROMPT_VERSION, promptFor, parseAiJson } from './research.mjs';
import { buildReport, reportToMarkdown, SECTION_TITLES } from './report.mjs';
import { buildGraph, validateRelation, ENTITY_TYPES, RELATION_TYPES, periodWindow, relationInWindow } from './graph.mjs';
import { graphToSvg, graphToDot, graphExportPayload } from './graph-export.mjs';
import { checkAccess, accessSuggestion, ACCESS_STATE_LABEL, ACCESS_METHOD, MAX_REDIRECTS } from './access.mjs';
import { AGENTS, agentById, executeAgent, AGENT_PROMPT_VERSION, quotaState, QUOTAS } from './agents.mjs';
import { validateEntityLink } from './graph.mjs';
import { MEMORY_KINDS, MEMORY_LIMITS, validateMemory, memoryToMarkdown } from './memory.mjs';
import { extractPdfText, PDF_LIMITS } from './pdftext.mjs';
import { ocrPdf, ocrStatus, OCR_LIMITS } from './ocr.mjs';
import { MFA, newSecret, otpauthUri, verifyTotp, newRecoveryCodes, consumeRecoveryCode, makeAttemptLimiter, maskSecret } from './mfa.mjs';
import { buildSummary, summaryToMarkdown, summaryToCsv, summaryToPdf, summaryFilename } from './summary.mjs';
import { runProviderTests, TEST_LEVELS, RESULTS as TEST_RESULTS, classifyFailure } from './provider-tests.mjs';
import {
  ACCESS_CLASSES, PROVIDER_STATES, EVIDENCE_STATUS, KINDS, CATEGORY, DISCOVERY_ADAPTERS,
  SEED, validateEntry, evidenceSummary, publicEntry, fromOpenRouter, fromHuggingFace,
  TASK_TYPES, EXCLUSION_RULES, scoreCandidate, bandOf, costOfTask
} from './provider-catalog.mjs';
import {
  selectProvider, planFallback, runWithFallback, classifyOutcome, SELECTION_STEPS, FALLBACK_DEFAULTS
} from './selector.mjs';
import {
  REEVAL_POLICY, reevaluationState, planReevaluation, runReevaluation, healthVerdict
} from './scheduler.mjs';
import {
  BENCHMARK_SUITE, BENCHMARK_VERSION, runBenchmark, compareBenchmarks
} from './benchmark.mjs';
import {
  ACCESS_DETAIL_FIELDS, DISCOVERY_CATEGORY_LABELS, ADAPTERS as DISCOVERY_IMPL,
  categoryOf, categorySummary, accessDetailCoverage, validateAccessDetails, mergeDiscovered
} from './discovery.mjs';
import {
  SOURCE_STATES, SOURCE_CATEGORIES, JURISDICTIONS, RATING_DIMENSIONS, RATING_BANDS,
  parseUrl, canonicalUrl, dedupeKey as sourceDedupeKey, domainOf, stateFromCheck,
  rateSource, coverageFrom, ADAPTERS
} from './sources.mjs';
import {
  STATES, STATE_LABEL, validateEvidence, evaluate, corroboration, suggestedState, dedupeKey
} from './evidence.mjs';

const MAX_BODY = 512 * 1024;
const APP_VERSION = '2.0.0-fase8';

/* Formato das cópias de segurança. O identificador antigo ('meridiano-backup/1') continua a ser
   lido, para que uma cópia exportada antes da mudança de nome possa ser reposta; o novo é o que
   se escreve. Testado em tests/fase3d.mjs. */
const BACKUP_FORMAT = 'conspiracy-tracker-backup/1';
const BACKUP_FORMATS_IN = [BACKUP_FORMAT, 'meridiano-backup/1'];

function json(res, code, obj, extraHeaders) {
  const headers = Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }, extraHeaders || {});
  res.writeHead(code, headers);
  res.end(JSON.stringify(obj));
}

/* exportações: ficheiro com aviso de proveniência nos cabeçalhos */
function jsonOrFile(res, code, body, type, filename) {
  res.writeHead(code, {
    'content-type': type,
    'content-disposition': 'attachment; filename="' + filename + '"',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

function err(res, code, message, extra) {
  json(res, code, { error: { code, message: message, ...(extra || {}) } });
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw Object.assign(new Error('corpo demasiado grande'), { status: 413 });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('JSON inválido'), { status: 400 }); }
}

const emailRe = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const ipOf = (req) => ((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'desconhecido');

/* =====================================================================
   RECOLHA DE DOCUMENTOS (passo 8 do motor e painel de documentos)

   Disciplina fixa, seja qual for o chamador:
   · só http(s), nunca endereços privados/loopback (SSRF), em cada salto;
   · redireccionamentos seguidos à mão, no máximo 5, revalidando o destino;
   · tecto de tamanho (2 MB HTML, 12 MB PDF) e 20 s de tempo;
   · PDF: o texto é extraído por server/pdftext.mjs e devolvido com os
     avisos da extracção — não entra sozinho no registo de provas;
   · devolve sempre o hash do conteúdo, para se poder provar o que se leu.
   A extracção PDF nunca contorna cifra nem tenta OCR.
   ===================================================================== */
const DOC_MAX_HTML = 2 * 1024 * 1024;
const DOC_MAX_REDIRECTS = 5;

/* Excepção única e explícita para os testes de interface locais: permitir que a
   recolha leia o próprio servidor de desenvolvimento (127.0.0.1). Desliga-se
   sozinha em qualquer ambiente de produção (NODE_ENV=production ou Render) e
   nunca está activa por omissão. */
export function localFetchAllowed() {
  if (process.env.VN_ALLOW_LOCAL_FETCH !== '1') return false;
  if (process.env.NODE_ENV === 'production' || process.env.RENDER) return false;
  return true;
}

export async function fetchDocument(url) {
  let u = null;
  try { u = new URL(String(url)); } catch { return { ok: false, error: 'URL inválida' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, error: 'só http(s)' };
  const allowLocal = localFetchAllowed();
  if (!allowLocal && isPrivateHost(u.hostname)) return { ok: false, error: 'endereço privado/local proibido (SSRF)' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    let res = null, hops = 0;
    /* redireccionamentos seguidos à mão: cada salto volta a passar pela guarda SSRF */
    for (;;) {
      res = await fetch(u.toString(), {
        signal: ctrl.signal, redirect: 'manual',
        headers: { 'user-agent': 'ConspiracyTracker/2 (+investigacao; contacto no site)', accept: 'text/html,application/pdf;q=0.9,*/*;q=0.5' }
      });
      const loc = res.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(res.status) || !loc) break;
      if (++hops > DOC_MAX_REDIRECTS) return { ok: false, status: res.status, error: 'demasiados redireccionamentos (>' + DOC_MAX_REDIRECTS + ')' };
      let next = null;
      try { next = new URL(loc, u); } catch { return { ok: false, status: res.status, error: 'redireccionamento inválido' }; }
      if (!/^https?:$/.test(next.protocol)) return { ok: false, status: res.status, error: 'redireccionamento para protocolo não permitido' };
      if (!allowLocal && isPrivateHost(next.hostname)) return { ok: false, status: res.status, error: 'redireccionamento para endereço privado/local (SSRF)' };
      u = next;
    }

    const type = String(res.headers.get('content-type') || '').toLowerCase();
    const declaredLen = Number(res.headers.get('content-length') || 0);
    const cap = /pdf/.test(type) ? PDF_LIMITS.maxBytes : DOC_MAX_HTML;
    if (declaredLen && declaredLen > cap) {
      return { ok: false, status: res.status, kind: /pdf/.test(type) ? 'pdf' : 'html',
        error: 'documento maior do que o limite (' + Math.round(cap / 1024) + ' KB)' };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > cap) return { ok: false, status: res.status, error: 'documento maior do que o limite (' + Math.round(cap / 1024) + ' KB)' };
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    /* SHA-1 também: alguns editores publicam o SHA-1 do ficheiro (é o caso do
       CourtListener), e sem ele não se pode provar que o nosso ficheiro é o
       mesmo que o editor descreve. Não substitui o SHA-256. */
    const hashSha1 = crypto.createHash('sha1').update(buf).digest('hex');
    const isPdf = buf.slice(0, 5).toString('latin1') === '%PDF-' || /application\/pdf/.test(type);

    if (isPdf) {
      const ex = extractPdfText(buf);
      /* digitalização (só imagens): tenta OCR — e diz sempre o que fez */
      if (!ex.ok && ex.imageOnly && !ex.encrypted && res.ok) {
        const oc = await ocrPdf(buf, { maxImages: OCR_LIMITS.maxImages, perImageMs: OCR_LIMITS.perImageMs });
        if (oc.ok) {
          return {
            ok: true, status: res.status, kind: 'pdf', finalUrl: u.toString(),
            text: String(oc.text).slice(0, 40000), bytes: buf.length, hash, sha1: hashSha1,
            extraction: {
              method: 'ocr', pages: oc.pages || ex.pages || 0, streams: 0,
              usedToUnicode: 0, chars: oc.chars || 0, imageOnly: true, encrypted: false,
              streamFailures: 0, reason: null,
              confidence: oc.confidenceAvg != null ? oc.confidenceAvg : null,
              imagesRecognized: oc.imagesRecognized, perPage: oc.perPage,
              engine: oc.engine, engineAvailable: true,
              warnings: (oc.warnings || []).concat(['OCR: o texto foi lido de uma imagem, não da camada de texto do documento']),
              needsHumanReview: true
            },
            error: null
          };
        }
        return {
          ok: false, status: res.status, kind: 'pdf', finalUrl: u.toString(),
          text: '', bytes: buf.length, hash, sha1: hashSha1,
          extraction: {
            method: 'nenhum', pages: ex.pages || 0, imageOnly: true, encrypted: false,
            ocrAttempted: true, ocrAvailable: !!oc.engineAvailable, ocrReason: oc.reason || null,
            confidence: null, warnings: (oc.warnings || []).concat(ex.warnings || []),
            needsHumanReview: true, reason: oc.reason || ex.reason || null
          },
          error: oc.reason || ex.reason
        };
      }
      return {
        ok: res.ok && ex.ok, status: res.status, kind: 'pdf', finalUrl: u.toString(),
        text: ex.ok ? String(ex.text).slice(0, 40000) : '',
        bytes: buf.length, hash, sha1: hashSha1,
        extraction: {
          method: ex.method, pages: ex.pages || 0, streams: ex.streams || 0,
          usedToUnicode: ex.usedToUnicode || 0, chars: ex.chars || 0,
          imageOnly: !!ex.imageOnly, encrypted: !!ex.encrypted,
          streamFailures: ex.streamFailures || 0, reason: ex.reason || null,
          warnings: ex.warnings || [], needsHumanReview: true
        },
        error: res.ok ? (ex.ok ? null : ex.reason) : 'HTTP ' + res.status
      };
    }

    const raw = buf.toString('utf8');
    const text = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40000);
    return {
      ok: res.ok, status: res.status, kind: 'html', finalUrl: u.toString(),
      text, bytes: buf.length, hash, sha1: hashSha1,
      extraction: { method: 'html-sem-marcacao', needsHumanReview: true, warnings: [] },
      error: res.ok ? null : 'HTTP ' + res.status
    };
  } catch (e) {
    const aborted = /abort/i.test(String(e && e.name));
    return { ok: false, error: aborted ? 'tempo limite excedido (20 s)' : String(e.message || e).slice(0, 160) };
  } finally { clearTimeout(timer); }
}
export async function createApi(opts) {
  opts = opts || {};
  /* em produção não se passa nada: `fetchDoc` é sempre a recolha real.
     A injecção existe só para testes que precisam de servir um PDF conhecido. */
  const fetchDoc = opts.fetchDoc || fetchDocument;
  const store = await createStore(opts.dataDir).init();
  const vault = keyVault(opts.appSecret || process.env.APP_SECRET);
  const auth = createAuth(store, {
    secure: opts.secure !== false,
    adminEmail: opts.adminEmail || process.env.ADMIN_EMAIL
  });
  const counters = store.counters;

  /* ---------- helpers de autorização ---------- */
  /* Rotas que continuam acessíveis quando a conta tem uma palavra-passe
     temporária por trocar: sem elas o utilizador não conseguiria trocá-la. */
  const TROCA_OBRIGATORIA_PERMITIDAS = [
    /^\/api\/auth\/me$/, /^\/api\/auth\/logout$/, /^\/api\/auth\/password$/, /^\/api\/meta$/
  ];
  async function requireUser(req, res) {
    const a = await auth.currentUser(req);
    if (!a) { err(res, 401, 'sessão inválida ou expirada'); return null; }
    if (a.user.mustChangePassword) {
      const path = String(req.url || '').split('?')[0];
      if (!TROCA_OBRIGATORIA_PERMITIDAS.some((re) => re.test(path))) {
        err(res, 403, 'tem de trocar a palavra-passe temporária antes de continuar', { code: 'PASSWORD_CHANGE_REQUIRED' });
        return null;
      }
    }
    return a;
  }
  function requireCsrf(req, res, a) {
    if (!auth.csrfOk(req, a)) { err(res, 403, 'token CSRF ausente ou inválido'); return false; }
    return true;
  }
  /* Campos do objecto de investigação aceites do cliente, com limites e sem
     inventar valores por omissão falsos (o que não vem fica vazio, não «confirmado»). */
  const strList = (v, max) => (Array.isArray(v) ? v.map((x) => String(x).trim().slice(0, 300)).filter(Boolean).slice(0, max) : undefined);
  function projectFields(body, partial) {
    const out = {};
    const str = (k, max) => { if (body[k] !== undefined) out[k] = String(body[k]).slice(0, max); };
    str('title', 200); str('question', 2000); str('objective', 2000); str('description', 4000);
    str('referenceDate', 40); str('timeLimit', 120);
    ['keywords', 'entities', 'excludedSources', 'prioritySources', 'subquestions',
      'completionCriteria', 'languages'].forEach((k) => { const v = strList(body[k], 100); if (v) out[k] = v; });
    if (Array.isArray(body.hypotheses)) {
      out.hypotheses = body.hypotheses.slice(0, 50).map((h, i) => ({
        id: (h && h.id) || 'h' + (i + 1),
        text: String((h && h.text) || h || '').slice(0, 1000),
        status: ['a-testar', 'suportada', 'refutada', 'inconclusiva'].includes(h && h.status) ? h.status : 'a-testar',
        /* uma hipótese nasce fraca: o estado forte só existe nas alegações, com provas
           ligadas e validadas pelo servidor. O cliente não pode promovê-la por aqui. */
        state: ['hipotese', 'insuficiente', 'alegacao-atribuida'].includes(h && h.state) ? h.state : 'hipotese'
      })).filter((h) => h.text);
    }
    if (body.budget && typeof body.budget === 'object') {
      const b = body.budget;
      out.budget = {
        maxCalls: Math.max(0, Math.min(10000, Number(b.maxCalls) || 0)),
        maxDocuments: Math.max(0, Math.min(10000, Number(b.maxDocuments) || 0)),
        maxMinutes: Math.max(0, Math.min(10000, Number(b.maxMinutes) || 0)),
        maxCost: Math.max(0, Math.min(100000, Number(b.maxCost) || 0))
      };
    }
    if (body.scope && typeof body.scope === 'object') {
      const sc = body.scope;
      out.scope = {
        geo: String(sc.geo || '').slice(0, 200),
        languages: strList(sc.languages, 20) || [],
        period: { from: (sc.period && sc.period.from) || null, to: (sc.period && sc.period.to) || null }
      };
    }
    if (!partial) {
      out.title = out.title || 'Sem título';
      ['question', 'objective', 'description'].forEach((k) => { if (out[k] === undefined) out[k] = ''; });
    }
    return out;
  }

  /* Caminho mais curto no grafo (BFS). Devolve cada passo com as provas de cada aresta:
     um caminho NÃO é prova de coordenação — junta-se a explicação no resultado. */
  function shortestPath(g, fromKey, toKey, opts) {
    const o = opts || {};
    const allowed = (e) => {
      if (o.excludeInferred && e.inferred) return false;
      if (o.types && o.types.length && o.types.indexOf(e.type) < 0) return false;
      const p = e.period || {};
      /* um passo sem período não é excluído por data: é contado e o caminho diz que o incluiu */
      const inWin = relationInWindow(p, { from: o.notBefore || null, to: o.notAfter || null, applied: !!(o.notBefore || o.notAfter) });
      if (inWin === false) return false;
      return true;
    };
    const all = g.edges || [];
    const usable = all.filter(allowed);
    const adj = new Map();
    usable.forEach((e) => {
      if (!adj.has(e.from)) adj.set(e.from, []);
      if (!adj.has(e.to)) adj.set(e.to, []);
      adj.get(e.from).push({ to: e.to, edge: e });
      adj.get(e.to).push({ to: e.from, edge: e });
    });
    const restricoes = {
      aplicadas: !!(o.types || o.excludeInferred || o.notBefore || o.notAfter),
      tipos: o.types || null, excluirInferidas: !!o.excludeInferred,
      periodo: (o.notBefore || o.notAfter) ? { de: o.notBefore || null, ate: o.notAfter || null } : null,
      arestasNoGrafo: all.length, arestasUsadas: usable.length,
      arestasExcluidas: all.length - usable.length
    };
    if (!adj.has(fromKey) || !adj.has(toKey)) {
      return { found: false, restricoes,
        reason: restricoes.aplicadas
          ? 'uma das entidades não tem qualquer relação que cumpra as restrições pedidas'
          : 'uma das entidades não existe no grafo' };
    }
    const prev = new Map([[fromKey, null]]);
    const queue = [fromKey];
    while (queue.length) {
      const cur = queue.shift();
      if (cur === toKey) break;
      (adj.get(cur) || []).forEach((n) => {
        if (!prev.has(n.to)) { prev.set(n.to, { from: cur, edge: n.edge }); queue.push(n.to); }
      });
    }
    if (!prev.has(toKey)) {
      return { found: false, restricoes,
        reason: restricoes.aplicadas
          ? 'nenhum caminho registado cumpre as restrições pedidas (com todas as relações, o caminho pode existir)'
          : 'nenhum caminho registado entre as duas entidades' };
    }
    const passos = [];
    let cur = toKey;
    while (prev.get(cur)) {
      const step = prev.get(cur);
      passos.unshift({ de: step.edge.fromName, para: step.edge.toName, id: step.edge.id, tipo: step.edge.label,
        confianca: step.edge.confidence, provas: step.edge.evidenceIds, inferida: step.edge.inferred,
        periodo: step.edge.period || { from: null, to: null } });
      cur = step.from;
    }
    const semPeriodo = passos.filter((p) => !p.periodo.from && !p.periodo.to).length;
    return {
      found: true, passos, saltos: passos.length, restricoes,
      semPeriodo: restricoes.periodo ? semPeriodo : 0,
      aviso: 'um caminho é uma sequência de relações registadas, não prova de coordenação, intenção ou controlo comum; cada passo traz as suas provas e a sua confiança' +
        (restricoes.periodo && semPeriodo ? ' · ' + semPeriodo + ' passo(s) sem período declarado foram incluídos: não se exclui por data o que não tem data' : '')
    };
  }

  /* Cronologia a partir de provas e relações: cada evento aponta a sua prova. */
  function timelineOf(store, pid, win) {
    const evs = store.evidenceOf(pid).filter((e) => !e.retractedAt);
    const eventos = evs.filter((e) => e.eventDate || e.publicationDate).map((e) => ({
      data: e.eventDate || e.publicationDate,
      tipo: e.eventDate ? 'acontecimento' : 'publicação',
      titulo: e.title, prova: e.id, posicao: e.stance, estado: e.validationState
    })).sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const rels = store.relationsOf(pid).filter((r) => !r.retractedAt && r.period && (r.period.from || r.period.to)).map((r) => ({
      data: r.period.from || r.period.to,
      tipo: 'relação',
      titulo: r.from + ' → ' + r.to,
      relacao: r.id,
      ate: r.period.to || null
    }));
    const todos = eventos.concat(rels).sort((a, b) => String(a.data).localeCompare(String(b.data)));
    if (!win || !win.applied) return { eventos: todos, total: todos.length, filter: { applied: false },
      nota: todos.length ? null : 'sem datas registadas: nada a ordenar (não se inventam datas)' };
    const dentro = [], fora = [];
    todos.forEach((e) => (relationInWindow({ from: e.data, to: e.data }, win) === false ? fora : dentro).push(e));
    return {
      eventos: dentro, total: dentro.length,
      filter: { applied: true, from: win.from, to: win.to, excludedByPeriod: fora.length },
      nota: dentro.length ? null : 'nenhum evento datado dentro do período pedido (não se inventam datas)'
    };
  }

  /* Executor de IA do utilizador: só com credencial VALIDADA e cofre activo.
     Sem isso devolve erro explícito — o motor pára e diz porquê. */
  function aiRunner(user) {
    const cred = store.credentialsOf(user.id).find((c) => c.status === 'operational') || null;
    if (!cred) return null;
    if (!vault.enabled) return null;
    let apiKey = null;
    try { apiKey = vault.open(cred.keyCipher); } catch { return null; }
    return async function ai({ step, project, candidates }) {
      const messages = promptFor(step.id, project, candidates);
      const r = await complete({
        provider: cred.provider, base: (cred.meta && cred.meta.base) || undefined, apiKey,
        model: cred.model, accountId: (cred.meta && cred.meta.accountId) || undefined,
        messages, timeoutMs: 30000
      });
      await store.addUsage({
        userId: user.id, provider: cred.provider, model: cred.model, kind: 'research:' + step.id,
        ok: !!r.ok, promptTokens: r.usage ? r.usage.promptTokens : null,
        completionTokens: r.usage ? r.usage.completionTokens : null, cost: null,
        latencyMs: r.latencyMs != null ? r.latencyMs : null
      });
      if (!r.ok) return { ok: false, error: 'fornecedor recusou: ' + String(r.error).slice(0, 160) };
      const parsed = parseAiJson(r.text);
      return {
        ok: true, provider: cred.provider, model: cred.model, latencyMs: r.latencyMs,
        usage: r.usage, expectsJson: true, parsed: parsed.ok ? parsed.parsed : null,
        note: parsed.ok ? null : parsed.reason
      };
    };
  }

  /* Executor genérico para os agentes de IA: mesmo cofre, mesma credencial validada. */
  function agentAiRunner(user) {
    const cred = store.credentialsOf(user.id).find((c) => c.status === 'operational') || null;
    if (!cred || !vault.enabled) return null;
    let apiKey = null;
    try { apiKey = vault.open(cred.keyCipher); } catch { return null; }
    return async function ai({ messages, timeoutMs }) {
      const r = await complete({
        provider: cred.provider, base: (cred.meta && cred.meta.base) || undefined, apiKey,
        model: cred.model, accountId: (cred.meta && cred.meta.accountId) || undefined,
        messages, timeoutMs: timeoutMs || 30000
      });
      await store.addUsage({
        userId: user.id, provider: cred.provider, model: cred.model, kind: 'agent',
        ok: !!r.ok, promptTokens: r.usage ? r.usage.promptTokens : null,
        completionTokens: r.usage ? r.usage.completionTokens : null, cost: null,
        latencyMs: r.latencyMs != null ? r.latencyMs : null
      });
      if (!r.ok) return { ok: false, error: r.error };
      const parsed = parseAiJson(r.text);
      return { ok: true, provider: cred.provider, model: cred.model, parsed: parsed.ok ? parsed.parsed : null, note: parsed.ok ? null : parsed.reason };
    };
  }

  /* projecto do utilizador (ou null): nunca confiar num id vindo do cliente */
  /* limite simples por utilizador: a verificação de acesso faz pedidos de rede
     a endereços escolhidos pelo utilizador, por isso não pode ser ilimitada */
  function makeLimiter(maxPerHour) {
    const hits = new Map();
    return {
      allowed(userId, n) {
        const now = Date.now();
        const list = (hits.get(userId) || []).filter((t) => now - t < 3600 * 1000);
        hits.set(userId, list);
        return list.length + (n || 1) <= maxPerHour;
      },
      hit(userId) {
        const now = Date.now();
        const list = (hits.get(userId) || []).filter((t) => now - t < 3600 * 1000);
        list.push(now); hits.set(userId, list);
      },
      used(userId) { return (hits.get(userId) || []).filter((t) => Date.now() - t < 3600 * 1000).length; },
      maxPerHour
    };
  }
  const accessLimiter = makeLimiter(60);
  const docLimiter = makeLimiter(40);          // recolhas de documentos por hora/utilizador
  const mfaLimiter = makeAttemptLimiter();     // códigos TOTP errados por conta
  const providerDiscoveryLimiter = makeLimiter(10);  // catálogos externos: 10/h por utilizador
  const providerScheduleLimiter = makeLimiter(20);   // lotes de reavaliação: 20/h por utilizador
  const cronLimiter = makeLimiter(2);                // cron de serviço: 2/h (uma execução por hora, no máximo)
  const bootstrapLimiter = makeLimiter(3);           // arranque do primeiro administrador: 3/h por IP

  /* Executa níveis e grava um registo POR NÍVEL. Uma só implementação para o
     teste manual (`/test`) e para a reavaliação automática (`/schedule/run`):
     duas cópias divergiriam e a segunda passaria a mentir em silêncio. */
  async function executarTestes(entry, { userId, levels, apiKey, model, samples, maxRequests, allowInsecure }) {
    const out = await runProviderTests(entry, { apiKey, model, levels, samples, maxRequests, allowInsecure });
    const gravados = [];
    for (const nivel of Object.keys(out.results)) {
      const r = out.results[nivel];
      const rec = await store.addProviderTest({
        key: entry.key, level: Number(nivel), levelId: r.levelId, result: r.result,
        reason: r.reason || null, detail: r.detail || null, diagnosis: r.diagnosis || null,
        httpStatus: r.httpStatus == null ? null : r.httpStatus, latencyMs: r.latencyMs == null ? null : r.latencyMs,
        method: r.method || null, samples: r.samples || null, successRate: r.successRate == null ? null : r.successRate,
        tokens: r.tokens || null, capabilities: r.capabilities || null,
        testedBy: userId, synthetic: !!out.synthetic
      });
      gravados.push({ id: rec.id, level: rec.level, result: rec.result });
    }
    return { out, gravados };
  }

  /* Progressão de estado conservadora: só sobe com prova; nunca desce por omissão. */
  async function promoverEstado(entry, out, motivo, userId) {
    const pass = (n) => out.results[n] && out.results[n].result === 'PASS';
    let novo = null;
    if (pass(4)) novo = 'GENERATION_TESTED';
    else if (pass(3)) novo = 'LINK_TESTED';
    else if (pass(1) || pass(2)) novo = 'DOCUMENTED';
    if (novo && novo !== entry.state) await store.setCatalogState(entry.key, novo, motivo, userId);
    return novo;
  }

  /* Sonda de saúde: uma prova de vida. Não usa chave, não grava em providerTests,
     não muda estado e não entra na nota — ver `healthVerdict`. */
  async function sondarSaude(entry) {
    const alvo = (entry.endpoints && entry.endpoints[0] && entry.endpoints[0].base)
      || (entry.docs && entry.docs[0]) || null;
    if (!alvo) return { key: entry.key, ok: null, reason: 'sem endpoint nem documentação: nada a sondar' };
    const url = String(alvo);
    if (isPrivateHost && isPrivateHost(url) && !localFetchAllowed()) {
      return { key: entry.key, ok: null, reason: 'endereço privado/local: sonda recusada (SSRF)' };
    }
    const t0 = Date.now();
    try {
      const r = await fetch(url, { method: 'GET', redirect: 'follow',
        headers: { 'user-agent': 'ConspiracyTracker/2 (sonda de saúde; ver docs/PROVIDER-OS.md)', accept: '*/*' },
        signal: AbortSignal.timeout(8000) });
      const ms = Date.now() - t0;
      return { key: entry.key, url, ok: r.status < 500, httpStatus: r.status, latencyMs: ms,
        acceptable: 'qualquer HTTP abaixo de 500 conta como «respondeu»: 401/403 provam que o serviço está vivo, não que autoriza' };
    } catch (e) {
      return { key: entry.key, url, ok: false, httpStatus: 0, latencyMs: Date.now() - t0,
        reason: e.name === 'TimeoutError' ? 'timeout de 8 s' : String(e.message || e).slice(0, 160) };
    }
  }

  /* Candidata para ranking/selecção: uma só função, para que a nota e a escolha
     nunca leiam fontes diferentes. Só entram métricas MEDIDAS (testes reais,
     nunca sintéticos); o que não foi medido fica null e é dito como faltando. */
  function candidateOf(entry, userId) {
    const tests = store.providerTestsOf(entry.key).filter((t) => !t.synthetic);
    const gen = tests.filter((t) => t.level === 4);
    const rel = tests.filter((t) => t.level === 6);
    const okGen = gen.filter((t) => t.result === 'PASS');
    const last = (arr) => (arr.length ? arr[arr.length - 1] : null);
    const lat = okGen.map((t) => t.latencyMs).filter((x) => x != null).sort((x, y) => x - y);
    const relLast = last(rel);
    /* capacidades: só as que tiveram PASS no nível 5 (declarado não é testado) */
    const capabilities = {};
    for (const t of tests.filter((x) => x.level === 5 && x.capabilities)) {
      for (const [cap, res] of Object.entries(t.capabilities)) {
        if (res === 'PASS') capabilities[cap] = 'PASS';
        else if (!capabilities[cap]) capabilities[cap] = res;
      }
    }
    /* qualidade e custo vêm do benchmark (nível 7), quando existe: são as duas
       dimensões que até à fase 7 nunca tinham sido medidas */
    const bench = tests.filter((t) => t.level === 7 && t.result === 'PASS');
    const ultimoBench = bench.length ? bench[bench.length - 1] : null;
    const providerId = String(entry.key).startsWith('providers/') ? String(entry.key).slice('providers/'.length) : null;
    const cred = providerId && userId ? store.credentialFor(userId, providerId) : null;
    const meta = entry.metadata || {};
    return {
      key: entry.key, name: entry.name, kind: entry.kind, state: entry.state,
      risk: (entry.security && entry.security.risk) || meta.risk || null,
      tested: { link: tests.some((t) => t.level <= 3 && t.result === 'PASS'), generation: okGen.length > 0 },
      capabilities: { declared: (entry.capabilities && entry.capabilities.claimed) || [], tested: capabilities },
      credentials: { present: providerId ? !!cred : true },
      region: meta.region || (entry.jurisdiction || null),
      privacy: meta.privacy || null,
      defaultModel: (cred && cred.model) || (meta.defaultModel || null),
      freshnessDays: evidenceSummary(entry).freshnessDays,
      metrics: {
        successRate: relLast && relLast.successRate != null ? relLast.successRate
          : (tests.length ? tests.filter((t) => t.result === 'PASS').length / tests.length : null),
        latencyP50Ms: lat.length ? lat[Math.floor(lat.length / 2)] : null,
        uptakeMs: ultimoBench && ultimoBench.latencyMs != null ? ultimoBench.latencyMs : null,
        uptime: null,
        qualityScore: ultimoBench && ultimoBench.qualityScore != null ? ultimoBench.qualityScore : null,
        securityScore: ultimoBench && ultimoBench.safetyPass === true ? 70 : (ultimoBench && ultimoBench.safetyPass === false ? 20 : null),
        integrationScore: null, maintenanceScore: null,
        costPerTaskUsd: ultimoBench && ultimoBench.costUsd != null ? ultimoBench.costUsd : null
      },
      benchmark: ultimoBench ? { at: ultimoBench.at, qualityScore: ultimoBench.qualityScore, passRate: ultimoBench.passRate, costUsd: ultimoBench.costUsd } : null,
      evidence: { tests: tests.length, generationPasses: okGen.length }
    };
  }

  function projectFor(a, pid) { return store.projectByIdFor(pid, a.user.id); }
  function claimFor(a, cid) {
    const c = store.claimById(cid);
    if (!c) return null;
    return projectFor(a, c.projectId) ? c : null;
  }
  function evidenceFor(a, eid) {
    const e = store.evidenceById(eid);
    if (!e) return null;
    return projectFor(a, e.projectId) ? e : null;
  }
  function requireAdmin(a, res) {
    if (!a || a.user.role !== 'ADMIN') { err(res, 403, 'operação restrita a administradores'); return false; }
    return true;
  }

  /* contradições: arestas com prova contrária e conclusões em conflito */
  function contradicoesOf(pid, g) {
    const evById = new Map(store.evidenceOf(pid).map((e) => [e.id, e]));
    const out = g.edges.filter((e) => e.confidence.level === 'contraditoria').map((e) => ({
      tipo: 'relacao', id: e.id, descricao: e.fromName + ' → ' + e.toName + ' (' + e.label + ')',
      provas: e.evidenceIds.map((id) => {
        const ev = evById.get(id);
        return ev ? { id, titulo: ev.title, posicao: ev.stance } : { id };
      })
    }));
    store.claimsOf(pid).forEach((c) => {
      const evs = store.evidenceOf(pid).filter((e) => (c.evidenceIds || []).includes(e.id) && !e.retractedAt);
      const fav = evs.filter((e) => e.stance === 'favoravel');
      const con = evs.filter((e) => e.stance === 'contraria');
      if (fav.length && con.length) {
        out.push({
          tipo: 'conclusao', id: c.id, descricao: c.text, estado: c.state,
          provas: fav.map((e) => ({ id: e.id, titulo: e.title, posicao: 'favoravel' }))
            .concat(con.map((e) => ({ id: e.id, titulo: e.title, posicao: 'contraria' })))
        });
      }
    });
    return out;
  }

  /* grafo do projecto, opcionalmente recortado por período declarado */
  function projectGraph(prj, pid, win) {
    return buildGraph({
      project: prj, evidence: store.evidenceOf(pid), relations: store.relationsOf(pid),
      claims: store.claimsOf(pid), window: win, entityLinks: store.entityLinksOf(pid)
    });
  }

  /* parâmetros de restrição do caminho (nomes próprios: não colidem com from/to) */
  function pathOptions(url) {
    const types = String(url.searchParams.get('pathTypes') || '').split(',').map((x) => x.trim()).filter(Boolean);
    const w = periodWindow({ from: url.searchParams.get('pathNotBefore'), to: url.searchParams.get('pathNotAfter') });
    return { ok: w.ok, error: w.error, opts: {
      types: types.length ? types : null,
      excludeInferred: url.searchParams.get('pathExcludeInferred') === '1',
      notBefore: w.window && w.window.from, notAfter: w.window && w.window.to
    } };
  }

  /* janela temporal vinda da query. Nomes explícitos (periodFrom/periodTo, ou
     desde/ate) para nunca colidir com «from»/«to», que no grafo são ids de
     entidades para o cálculo de caminho. Inválida é recusada, não ignorada. */
  function windowFrom(url) {
    const g = (k, alt) => url.searchParams.get(k) != null ? url.searchParams.get(k) : url.searchParams.get(alt);
    return periodWindow({ from: g('periodFrom', 'desde'), to: g('periodTo', 'ate') });
  }

  /* Verificação de acesso: um GET por prova, sem conteúdo guardado. */
  async function runAccessCheck(ev, a) {
    const target = ev.canonicalUrl || ev.originalUrl || null;
    const r = await checkAccess(target, { timeoutMs: 10000 });
    const suggestion = accessSuggestion(r);
    const check = {
      status: r.status, stateLabel: r.stateLabel, httpStatus: r.httpStatus, contentType: r.contentType,
      bytes: r.bytes, truncated: r.truncated, ms: r.ms, checkedAt: r.checkedAt, finalUrl: r.finalUrl,
      reason: r.reason, redirects: r.redirects, method: r.method, limitations: r.limitations
    };
    const updated = await store.updateEvidence(ev.id, { access: check, accessSuggestion: suggestion },
      a ? a.user.id : null, 'acesso verificado');
    return { evidence: updated, check, suggestion };
  }

  /* limitadores próprios do registo de fontes: submissão, verificação por
     fonte e execuções de descoberta (a descoberta faz pedidos externos). */
  const limiter = (max, windowMs) => {
    const hits = new Map();
    return {
      allowed(key) {
        const now = Date.now();
        const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
        if (list.length >= max) { hits.set(key, list); return false; }
        list.push(now); hits.set(key, list); return true;
      }
    };
  };
  const srcLimiter = limiter(30, 3600 * 1000);
  const checkLimiter = limiter(6, 60 * 60 * 1000);
  const discoveryLimiter = limiter(6, 60 * 60 * 1000);

  const api = { store, vault, auth, version: APP_VERSION };

  /* ============================ ROTAS ============================ */
  api.handle = async function handle(req, res, url) {
    const p = url.pathname;
    const method = req.method;
    const now = () => new Date().toISOString();

    /* base em só-de-leitura (outra instância escreve na mesma pasta): as
       alterações são recusadas ANTES de tocar nos dados, com um 503 honesto */
    if (store.readOnly && store.readOnly() && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return err(res, 503, 'armazenamento em modo só-de-leitura: outra instância detém a escrita nesta pasta', { retryable: true });
    }

    try {
      /* ---------- saúde ---------- */
      if (p === '/health') {
        return json(res, 200, {
          ok: true, status: 'alive', version: APP_VERSION, uptimeSeconds: Math.round(process.uptime()),
          now: now(), commit: process.env.RENDER_GIT_COMMIT || null
        });
      }
      if (p === '/ready') {
        const integ = typeof store.integrity === 'function' ? store.integrity() : null;
        const readOnly = !!(integ && integ.lock && integ.lock.readOnly);
        const checks = {
          storage: {
            ok: !!store.data && !readOnly, writable: !readOnly,
            readOnly, reason: readOnly ? integ.lock.reason : null,
            integrity: integ ? {
              checksumVerified: integ.checksum, backups: integ.backups,
              recoveredFrom: integ.recovery.used ? integ.recovery.used.split('/').pop() : null,
              recoveryReason: integ.recovery.reason,
              freshStart: integ.recovery.freshStart
            } : null
          },
          keyVault: { ok: vault.enabled, mode: vault.enabled ? 'aes-256-gcm' : 'desactivado', reason: vault.reason },
          persistence: (() => {
            const p = typeof store.persistence === 'function' ? store.persistence() : null;
            if (!p) return { ok: false, durableBetweenDeploys: false, note: 'estado de persistência indisponível' };
            return {
              ok: p.mode === 'postgres+ficheiro' ? p.durableBetweenDeploys : true,
              mode: p.mode,
              durableBetweenDeploys: p.durableBetweenDeploys,
              postgres: p.postgres,
              file: p.file,
              note: p.durableBetweenDeploys
                ? 'os dados estão numa base Postgres: sobrevivem a um deploy, a um reinício e à troca de instância'
                : (p.postgres.configured
                  ? 'DATABASE_URL está definida mas a base não confirmou a escrita (' + (p.postgres.lastError || 'sem detalhe') + '): os dados continuam a viver no disco efémero'
                  : 'sem DATABASE_URL: o disco do plano gratuito do Render é apagado em cada deploy')
            };
          })()
        };
        /* «pronto» inclui persistência: com DATABASE_URL definida mas sem
           confirmação de escrita, o serviço está degradado — é melhor dizê-lo
           do que aceitar trabalho que se perde. */
        const persistOk = checks.persistence.ok !== false;
        const ready = checks.storage.ok && persistOk;
        return json(res, ready ? 200 : 503, {
          ok: ready, status: ready ? 'ready' : 'degraded', checks, version: APP_VERSION, now: now(),
          /* um modo só-de-leitura é dito na cara, não escondido em /health */
          aviso: readOnly ? 'outra instância detém a escrita nesta pasta: esta responde a leituras e recusa alterações' : null
        });
      }

      /* ---------- meta ---------- */
      if (p === '/api/meta') {
        return json(res, 200, {
          ok: true, version: APP_VERSION, schemaVersion: store.schemaVersion(),
          migrations: store.migrations().map((m) => ({ to: m.to, at: m.at, changes: m.changes })),
          states: STATES.map((id) => ({ id, label: STATE_LABEL[id] })),
          research: { steps: STEPS.length, profiles: Object.keys(PROFILES), promptVersion: PROMPT_VERSION, reportSections: SECTION_TITLES.length },
          agents: { total: AGENTS.length, promptVersion: AGENT_PROMPT_VERSION, local: AGENTS.filter((x) => x.kind === 'local').length, ai: AGENTS.filter((x) => x.kind === 'ai').length },
          providers: registryPublic(),
          keyVault: { enabled: vault.enabled, reason: vault.reason },
          documents: {
            pdfMaxBytes: PDF_LIMITS.maxBytes, htmlMaxBytes: DOC_MAX_HTML, maxRedirects: DOC_MAX_REDIRECTS,
            pdfText: 'extraído com /ToUnicode; digitalizações passam por OCR quando há motor; cifra não é contornada',
            humanReview: 'obrigatória: nenhuma prova nasce de uma extracção',
            localFetch: localFetchAllowed() ? 'permitido (ambiente de teste local)' : 'proibido',
            ocr: (() => {
              const st = ocrStatus();
              return {
                available: st.available, engine: st.engine, version: st.version,
                languages: st.languages, dataSource: st.dataSource, reason: st.reason,
                minConfidence: OCR_LIMITS.minConfidence, maxImages: OCR_LIMITS.maxImages
              };
            })()
          },
          registration: {
            open: auth.registrationOpen,
            source: 'variável de ambiente REGISTER_OPEN (fechado quando ausente)',
            policy: auth.registrationOpen
              ? 'aberto por configuração explícita da operação'
              : 'fechado por omissão: as contas são criadas por um administrador ou por tools/create-admin.mjs no servidor',
            firstAdminEmailConfigured: !!auth.adminEmail,
            bootstrap: {
              httpRoute: 'POST /api/auth/bootstrap',
              configured: !!process.env.ADMIN_BOOTSTRAP_TOKEN,
              appliesOnly: 'enquanto não existir um administrador activo; depois responde 403',
              localTool: 'tools/create-admin.mjs (acesso ao disco)'
            },
            firstAdminNote: (() => {
              if (!auth.adminEmail) return 'ADMIN_EMAIL não definido: nenhuma conta se torna administradora automaticamente';
              if (!store.data.users.some((u) => u.role === 'ADMIN')) return 'ADMIN_EMAIL definido e ainda sem administrador: use tools/create-admin.mjs no servidor (com o registo fechado, o papel não é atribuído por registo)';
              return 'já existe um administrador; ADMIN_EMAIL deixou de ter efeito';
            })(),
            passwordPolicy: ['pelo menos 10 caracteres', 'uma minúscula', 'uma maiúscula', 'um dígito']
          },
          privacy: {
            adminAccess: 'os administradores podem consultar projectos e execuções para suporte, segurança e operação; cada acesso fica registado na auditoria',
            storage: (() => {
              const p = typeof store.persistence === 'function' ? store.persistence() : null;
              if (!p) return 'estado de armazenamento indisponível';
              return p.durableBetweenDeploys
                ? 'os dados são guardados numa base Postgres gerida e sobrevivem a deploy e reinício; o servidor guarda uma cópia de trabalho local'
                : (p.postgres.configured
                  ? 'a base Postgres está configurada mas não confirmou a escrita: os dados vivem no disco efémero do servidor'
                  : 'os dados são guardados no servidor da aplicação; no plano gratuito do Render o disco é efémero (apagado em cada deploy)');
            })()
          },
          accessChecks: {
            states: ACCESS_STATE_LABEL, method: ACCESS_METHOD, maxRedirects: MAX_REDIRECTS,
            limits: { porUtilizadorPorHora: 60, porPedido: 10 },
            policy: 'verifica uma página por prova, sem contornar paywalls/registos/CAPTCHAs, sem guardar conteúdo e sem alterar estados de validação'
          },
          quotas: { agentes: QUOTAS, exportacao: 'JSON/SVG/DOT no servidor; PNG gerado no browser a partir do desenho' }
        });
      }

      /* ---------- registo ---------- */
      /* ---------- arranque do primeiro administrador (fase 8) ----------
         Com o registo público fechado, uma instância nova fica sem ninguém
         que entre. No plano gratuito do Render não há consola para correr
         tools/create-admin.mjs, por isso o arranque faz-se por HTTPS com um
         segredo que só o operador tem. Três condições, todas obrigatórias:
           · ADMIN_BOOTSTRAP_TOKEN definido no ambiente (sem ele: 503 e nada acontece);
           · nenhum administrador activo (senão: 403 — não é uma porta de serviço);
           · comparação em tempo constante e limite de 3 tentativas por hora.
         A rota deixa de ter efeito depois de existir um administrador. */
      if (p === '/api/auth/bootstrap' && method === 'POST') {
        const ip = ipOf(req);
        const esperado = String(process.env.ADMIN_BOOTSTRAP_TOKEN || '');
        if (!esperado) {
          return json(res, 503, { ok: false, configured: false,
            reason: 'ADMIN_BOOTSTRAP_TOKEN não está definido: o arranque por HTTPS está desligado',
            how: 'definir ADMIN_BOOTSTRAP_TOKEN no painel do Render (valor longo e aleatório) e repetir; ou correr tools/create-admin.mjs com acesso ao disco' });
        }
        const recebido = String(req.headers['x-bootstrap-token'] || '');
        const a1 = Buffer.from(esperado);
        const b1 = Buffer.from(recebido.padEnd(esperado.length, '\0').slice(0, esperado.length));
        const igual = recebido.length === esperado.length && crypto.timingSafeEqual(a1, b1);
        if (!igual) {
          await store.audit({ type: 'bootstrap_refused', ip, action: 'bootstrap', detail: { reason: 'token inválido' } });
          return err(res, 401, 'token de arranque inválido');
        }
        if (!bootstrapLimiter.allowed(ip)) {
          await store.audit({ type: 'bootstrap_refused', ip, action: 'bootstrap', detail: { reason: 'limite' } });
          return err(res, 429, 'demasiadas tentativas de arranque a partir deste endereço');
        }
        bootstrapLimiter.hit(ip);
        if (store.data.users.some((u) => u.role === 'ADMIN' && u.status === 'active')) {
          await store.audit({ type: 'bootstrap_refused', ip, action: 'bootstrap', detail: { reason: 'já existe administrador' } });
          return err(res, 403, 'já existe um administrador activo: o arranque está encerrado (use /api/admin/users)');
        }
        const body = await readBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        if (!emailRe.test(email)) return err(res, 400, 'email inválido');
        const problems = passwordProblems(body.password);
        if (problems.length) return err(res, 400, 'palavra-passe fraca: ' + problems.join(', '));
        if (store.userByEmail(email)) return err(res, 409, 'não foi possível criar a conta com estes dados');
        const { salt, hash } = hashPassword(body.password);
        const user = await store.createUser({ email, passwordHash: hash, salt, role: 'ADMIN', termsAcceptedAt: now() });
        /* A palavra-passe desta via passa por um canal humano (foi escrita
           algures). Marcar mustChangePassword obriga a trocá-la no primeiro
           acesso, para que o que circulou deixe de servir. */
        await store.updateUser(user.id, { createdBy: 'bootstrap-https', mustChangePassword: body.mustChangePassword === true });
        await store.audit({ type: 'admin_user_created', actorId: user.id, subjectId: user.id, ip,
          action: 'bootstrap_admin', detail: { via: 'POST /api/auth/bootstrap', passwordChosenByOperator: true } });
        const s = await auth.issueSession(user, { ip, ua: req.headers['user-agent'] });
        await store.audit({ type: 'session_created', actorId: user.id, ip, action: 'login_after_bootstrap' });
        return json(res, 201, {
          ok: true, user: publicUser(user), csrf: s.csrf,
          mustChangePassword: body.mustChangePassword === true,
          note: 'administrador criado; retire ADMIN_BOOTSTRAP_TOKEN do ambiente agora — a rota fica sem efeito assim que existir um administrador, mas o segredo não deve ficar guardado sem uso'
        }, { 'set-cookie': auth.cookiesFor(s.token, s.csrf) });
      }

      if (p === '/api/auth/register' && method === 'POST') {
        const ip = ipOf(req);
        if (auth.registerLimiter.blocked(ip)) return err(res, 429, 'demasiados registos a partir deste endereço');
        auth.registerLimiter.hit(ip);
        /* P0: registo público fechado por omissão. A recusa é registada na
           auditoria para que uma tentativa de abuso fique visível, mas a
           resposta não revela se já existe conta, nem quantas existem. */
        if (!auth.registrationOpen) {
          await store.audit({ type: 'registration_refused', ip, action: 'register', detail: { reason: 'closed', ua: String(req.headers['user-agent'] || '').slice(0, 120) } });
          return err(res, 403, 'o registo público está desactivado; a conta tem de ser criada por um administrador', { code: 'REGISTRATION_CLOSED' });
        }
        const body = await readBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        if (!emailRe.test(email)) return err(res, 400, 'email inválido');
        const problems = passwordProblems(body.password);
        if (problems.length) return err(res, 400, 'palavra-passe fraca: ' + problems.join(', '));
        if (body.acceptTerms !== true) return err(res, 400, 'é necessário aceitar a política de privacidade');
        if (store.userByEmail(email)) return err(res, 409, 'não foi possível criar a conta com estes dados');
        const role = (auth.adminEmail && email === auth.adminEmail && !store.data.users.some((u) => u.role === 'ADMIN')) ? 'ADMIN' : 'USER';
        const { salt, hash } = hashPassword(body.password);
        const user = await store.createUser({ email, passwordHash: hash, salt, role, termsAcceptedAt: now() });
        await store.audit({ type: 'user_registered', actorId: user.id, subjectId: user.id, ip, action: 'register', detail: { role } });
        await store.count('users_registered');
        const s = await auth.issueSession(user, { ip, ua: req.headers['user-agent'] });
        await store.audit({ type: 'session_created', actorId: user.id, ip, action: 'login_after_register' });
        return json(res, 201, { ok: true, user: publicUser(user), csrf: s.csrf }, { 'set-cookie': auth.cookiesFor(s.token, s.csrf) });
      }

      /* ---------- login ---------- */
      if (p === '/api/auth/login' && method === 'POST') {
        const ip = ipOf(req);
        const body = await readBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        const key = ip + '|' + (email || 'sem-email');
        if (auth.loginLimiter.blocked(key) || auth.loginLimiter.blocked(ip)) {
          await store.audit({ type: 'login_blocked', ip, action: 'login', detail: { email } });
          return err(res, 429, 'demasiadas tentativas; tente novamente mais tarde');
        }
        auth.loginLimiter.hit(key);
        const user = store.userByEmail(email);
        const ok = user && user.status === 'active' && verifyPassword(body.password, user.salt, user.passwordHash);
        if (!ok) {
          await store.audit({ type: 'login_failed', ip, action: 'login', subjectId: user ? user.id : null, detail: { email } });
          return err(res, 401, 'credenciais inválidas');
        }
        auth.loginLimiter.reset(key);

        /* conta com segundo factor: NÃO se emite sessão antes do código */
        if (user.mfa && user.mfa.enabled) {
          if (mfaLimiter.blocked(user.id)) {
            await store.audit({ type: 'mfa_blocked', actorId: user.id, ip, action: 'mfa_login' });
            return err(res, 429, 'demasiados códigos incorrectos; tente novamente dentro de alguns minutos');
          }
          const challenge = newToken(32);
          const c = await store.createMfaChallenge({ userId: user.id, tokenHash: sha256(challenge), ip, ua: req.headers['user-agent'] });
          await store.audit({ type: 'mfa_challenge', actorId: user.id, subjectId: c.id, ip, action: 'mfa_login' });
          return json(res, 200, {
            ok: true, mfaRequired: true, challenge, expiresAt: c.expiresAt,
            methods: ['totp'].concat((user.mfa.recoveryCodes || []).length ? ['recovery'] : []),
            nota: 'introduza o código da aplicação de autenticação; a sessão só é criada depois de o código ser aceite'
          });
        }

        await store.updateUser(user.id, { lastLoginAt: now() });
        const s = await auth.issueSession(user, { ip, ua: req.headers['user-agent'] });
        await store.audit({ type: 'login_succeeded', actorId: user.id, subjectId: user.id, ip, action: 'login' });
        await store.count('logins');
        return json(res, 200, { ok: true, user: publicUser(user), csrf: s.csrf }, { 'set-cookie': auth.cookiesFor(s.token, s.csrf) });
      }

      /* segundo passo do login: código TOTP ou código de recuperação */
      if (p === '/api/auth/mfa/verify' && method === 'POST') {
        const ip = ipOf(req);
        const body = await readBody(req);
        const ch = store.mfaChallengeByHash(sha256(String(body.challenge || '')));
        if (!ch) return err(res, 401, 'desafio inválido ou expirado: volte a introduzir a palavra-passe');
        if (mfaLimiter.blocked(ch.userId)) {
          await store.audit({ type: 'mfa_blocked', actorId: ch.userId, ip, action: 'mfa_verify' });
          return err(res, 429, 'demasiados códigos incorrectos; tente novamente dentro de alguns minutos');
        }
        const user = store.userById(ch.userId);
        if (!user || user.status !== 'active' || !user.mfa || !user.mfa.enabled) return err(res, 401, 'desafio inválido');

        let used = null, via = null;
        const code = String(body.code || '').replace(/\s+/g, '');
        if (body.recoveryCode) {
          const r = consumeRecoveryCode(user.mfa.recoveryCodes, body.recoveryCode, vault.enabled ? vault.secretFor('mfa') : 'pepper-local');
          if (r) { used = r; via = 'recovery'; }
        } else {
          const counter = verifyTotp(user.mfa.secret, code);
          /* o mesmo código não serve duas vezes: guarda-se o último passo aceite */
          if (counter != null && (user.mfa.lastCounter == null || counter > user.mfa.lastCounter)) { used = { counter }; via = 'totp'; }
        }
        if (!used) {
          await store.bumpMfaChallenge(ch.id);
          mfaLimiter.hit(ch.userId);
          await store.audit({ type: 'mfa_failed', actorId: ch.userId, ip, action: 'mfa_verify', detail: { remaining: mfaLimiter.remaining(ch.userId) } });
          return err(res, 401, 'código incorrecto', { remaining: mfaLimiter.remaining(ch.userId) });
        }
        mfaLimiter.reset(ch.userId);
        await store.consumeMfaChallenge(ch.id);
        const patch = via === 'recovery'
          ? { mfa: Object.assign({}, user.mfa, { recoveryCodes: used.remaining, lastRecoveryAt: now() }) }
          : { mfa: Object.assign({}, user.mfa, { lastCounter: used.counter }) };
        await store.updateUser(user.id, Object.assign(patch, { lastLoginAt: now() }));
        const s2 = await auth.issueSession(user, { ip, ua: req.headers['user-agent'] });
        await store.audit({ type: 'login_succeeded', actorId: user.id, subjectId: user.id, ip, action: 'login_mfa', detail: { via, recoveryLeft: via === 'recovery' ? used.remaining.length : (user.mfa.recoveryCodes || []).length } });
        await store.count('logins');
        const left = via === 'recovery' ? used.remaining.length : (user.mfa.recoveryCodes || []).length;
        return json(res, 200, {
          ok: true, user: publicUser(store.userById(user.id)), csrf: s2.csrf, via,
          recoveryLeft: left,
          aviso: via === 'recovery' ? 'usou um código de recuperação: foi consumido e restam ' + left + (left <= 2 ? ' — gere novos códigos' : '') : null
        }, { 'set-cookie': auth.cookiesFor(s2.token, s2.csrf) });
      }

      /* ---------- sessão actual ---------- */
      if (p === '/api/auth/me' && method === 'GET') {
        const a = await auth.currentUser(req);
        if (!a) return json(res, 200, { ok: true, user: null });
        return json(res, 200, { ok: true, user: publicUser(a.user), csrf: a.csrf, session: { id: a.session.id, createdAt: a.session.createdAt, expiresAt: a.session.expiresAt, ip: a.session.ip } });
      }

      /* ---------- logout ---------- */
      /* ---------- verificação em dois passos ---------- */
      if (p === '/api/auth/mfa' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const m = a.user.mfa || {};
        return json(res, 200, {
          ok: true,
          enabled: !!m.enabled,
          pending: !!m.pendingSecret,
          secretMasked: m.secret ? maskSecret(m.secret) : null,
          recoveryCodesLeft: (m.recoveryCodes || []).length,
          enabledAt: m.enabledAt || null,
          rules: { digits: MFA.digits, period: MFA.period, window: MFA.window, recoveryCodes: MFA.recoveryCodes, maxAttempts: MFA.maxAttempts }
        });
      }
      if (p === '/api/auth/mfa/setup' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        if (!verifyPassword(body.password, a.user.salt, a.user.passwordHash)) return err(res, 401, 'palavra-passe actual incorrecta');
        if (a.user.mfa && a.user.mfa.enabled) return err(res, 409, 'a verificação em dois passos já está activa');
        const secret = newSecret();
        await store.updateUser(a.user.id, {
          mfa: Object.assign({}, a.user.mfa || {}, { pendingSecret: secret, pendingAt: now(), enabled: false })
        });
        await store.audit({ type: 'mfa_setup_started', actorId: a.user.id, ip: ipOf(req), action: 'mfa_setup' });
        return json(res, 201, {
          ok: true, secret, otpauth: otpauthUri(secret, a.user.email),
          nota: 'guarde o segredo no seu gestor de palavras-passe; a activação só acontece depois de confirmar um código'
        });
      }
      if (p === '/api/auth/mfa/enable' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        const m = a.user.mfa || {};
        if (!m.pendingSecret) return err(res, 400, 'não há activação pendente: comece por /api/auth/mfa/setup');
        if (mfaLimiter.blocked(a.user.id)) return err(res, 429, 'demasiados códigos incorrectos; tente novamente dentro de alguns minutos');
        const counter = verifyTotp(m.pendingSecret, body.code);
        if (counter == null) {
          mfaLimiter.hit(a.user.id);
          await store.audit({ type: 'mfa_enable_failed', actorId: a.user.id, ip: ipOf(req), action: 'mfa_enable' });
          return err(res, 400, 'código incorrecto: confirme o relógio do dispositivo e o segredo', { remaining: mfaLimiter.remaining(a.user.id) });
        }
        const pepper = vault.enabled ? vault.secretFor('mfa') : 'pepper-local';
        const codes = newRecoveryCodes(pepper);
        await store.updateUser(a.user.id, {
          mfa: {
            enabled: true, secret: m.pendingSecret, pendingSecret: null, enabledAt: now(),
            /* o código que activou a conta não fica «gasto» para o login seguinte:
               a protecção contra repetição aplica-se a códigos usados para entrar */
            lastCounter: null, recoveryCodes: codes.map((c) => ({ hash: c.hash, createdAt: now() }))
          }
        });
        mfaLimiter.reset(a.user.id);
        await store.audit({ type: 'mfa_enabled', actorId: a.user.id, ip: ipOf(req), action: 'mfa_enable', detail: { recoveryCodes: codes.length } });
        /* os códigos de recuperação são mostrados UMA vez e não ficam em claro em lado nenhum */
        return json(res, 200, {
          ok: true, recoveryCodes: codes.map((c) => c.code),
          nota: 'guarde estes códigos agora: não voltam a ser mostrados; cada um serve uma única vez'
        });
      }
      if (p === '/api/auth/mfa/disable' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        if (!verifyPassword(body.password, a.user.salt, a.user.passwordHash)) return err(res, 401, 'palavra-passe actual incorrecta');
        const m = a.user.mfa || {};
        if (!m.enabled) return err(res, 409, 'a verificação em dois passos não está activa');
        const okCode = verifyTotp(m.secret, body.code);
        const rec = okCode == null ? consumeRecoveryCode(m.recoveryCodes, body.recoveryCode || '', vault.enabled ? vault.secretFor('mfa') : 'pepper-local') : null;
        if (okCode == null && !rec) return err(res, 400, 'código incorrecto: para desactivar é preciso a palavra-passe e um código válido');
        await store.updateUser(a.user.id, { mfa: null });
        await store.revokeAllSessions(a.user.id, a.session.id);
        await store.audit({ type: 'mfa_disabled', actorId: a.user.id, ip: ipOf(req), action: 'mfa_disable', detail: { otherSessionsRevoked: true } });
        return json(res, 200, { ok: true, disabled: true, otherSessionsRevoked: true });
      }
      if (p === '/api/auth/mfa/recovery' && method === 'POST') {
        /* novos códigos de recuperação: exige a palavra-passe e um código TOTP válido */
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        if (!verifyPassword(body.password, a.user.salt, a.user.passwordHash)) return err(res, 401, 'palavra-passe actual incorrecta');
        const m = a.user.mfa || {};
        if (!m.enabled) return err(res, 409, 'a verificação em dois passos não está activa');
        const counter = verifyTotp(m.secret, body.code);
        if (counter == null) return err(res, 400, 'código incorrecto');
        const codes = newRecoveryCodes(vault.enabled ? vault.secretFor('mfa') : 'pepper-local');
        await store.updateUser(a.user.id, {
          mfa: Object.assign({}, m, { recoveryCodes: codes.map((c) => ({ hash: c.hash, createdAt: now() })), lastCounter: counter })
        });
        await store.audit({ type: 'mfa_recovery_regenerated', actorId: a.user.id, ip: ipOf(req), action: 'mfa_recovery' });
        return json(res, 200, { ok: true, recoveryCodes: codes.map((c) => c.code), nota: 'os códigos anteriores deixaram de funcionar' });
      }

      if (p === '/api/auth/logout' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        await store.revokeSession(a.session.id, a.user.id);
        await store.audit({ type: 'logout', actorId: a.user.id, ip: ipOf(req), action: 'logout' });
        const cleared = auth.cookiesFor('', '').map((c) => c.replace(/Max-Age=\d+/, 'Max-Age=0'));
        return json(res, 200, { ok: true }, { 'set-cookie': cleared });
      }

      if (p === '/api/auth/logout-all' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        await store.revokeAllSessions(a.user.id);
        await store.audit({ type: 'logout_all', actorId: a.user.id, ip: ipOf(req), action: 'logout_all' });
        return json(res, 200, { ok: true, revoked: store.sessionsOf(a.user.id).length });
      }

      if (p === '/api/auth/sessions' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        return json(res, 200, {
          ok: true,
          sessions: store.sessionsOf(a.user.id).map((s) => ({
            id: s.id, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt,
            revoked: !!s.revokedAt, current: s.id === a.session.id, ip: s.ip, ua: s.ua
          }))
        });
      }

      if (p.match(/^\/api\/auth\/sessions\/[^/]+$/) && method === 'DELETE') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const id = p.split('/').pop();
        const done = await store.revokeSession(id, a.user.id);
        if (!done) return err(res, 404, 'sessão não encontrada');
        await store.audit({ type: 'session_revoked', actorId: a.user.id, subjectId: id, action: 'revoke_session' });
        return json(res, 200, { ok: true });
      }

      /* ---------- palavra-passe ---------- */
      if (p === '/api/auth/password' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        if (!verifyPassword(body.current, a.user.salt, a.user.passwordHash)) return err(res, 401, 'palavra-passe actual incorrecta');
        /* com segundo factor activo, trocar a palavra-passe exige-o também:
           um cookie roubado não pode mudar a palavra-passe e expulsar o dono */
        if (a.user.mfa && a.user.mfa.enabled) {
          const okTotp = verifyTotp(a.user.mfa.secret, body.code) != null;
          const okRec = !okTotp && !!consumeRecoveryCode(a.user.mfa.recoveryCodes, body.recoveryCode || '', vault.enabled ? vault.secretFor('mfa') : 'pepper-local');
          if (!okTotp && !okRec) return err(res, 401, 'com a verificação em dois passos activa, a troca de palavra-passe exige um código válido', { mfaRequired: true });
        }
        const problems = passwordProblems(body.next);
        if (problems.length) return err(res, 400, 'palavra-passe fraca: ' + problems.join(', '));
        const { salt, hash } = hashPassword(body.next);
        await store.updateUser(a.user.id, { salt, passwordHash: hash, mustChangePassword: false });
        await store.revokeAllSessions(a.user.id, a.session.id);
        await store.audit({ type: 'password_changed', actorId: a.user.id, ip: ipOf(req), action: 'change_password', detail: { otherSessionsRevoked: true, temporaryPasswordReplaced: !!a.user.mustChangePassword } });
        return json(res, 200, { ok: true, otherSessionsRevoked: true });
      }

      /* ---------- exportação e eliminação dos próprios dados ---------- */
      if (p === '/api/auth/export' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        await store.audit({ type: 'data_exported', actorId: a.user.id, subjectId: a.user.id, ip: ipOf(req), action: 'export_own_data' });
        return json(res, 200, {
          ok: true,
          exportedAt: now(),
          user: publicUser(a.user),
          projects: store.projectsOf(a.user.id),
          providers: store.credentialsOf(a.user.id).map((c) => ({ provider: c.provider, mask: c.keyMask, model: c.model, status: c.status, updatedAt: c.updatedAt })),
          usage: store.data.usage.filter((u) => u.userId === a.user.id),
          audit: store.auditList({ actorId: a.user.id })
        });
      }

      /* ---------- cópia de segurança completa (e reposição) ----------
         O plano gratuito tem disco efémero: um deploy apaga os dados. A cópia
         não é um extra, é a única forma de o utilizador não perder trabalho. */
      if (p === '/api/auth/backup' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const projects = store.projectsOf(a.user.id).map((prj) => ({
          project: prj,
          evidence: store.evidenceOf(prj.id),
          claims: store.claimsOf(prj.id),
          relations: store.relationsOf(prj.id),
          runs: store.runsOf(prj.id),
          agentRuns: store.agentRunsOf(prj.id),
          notes: store.notesOf(prj.id),
          entityLinks: store.entityLinksOf(prj.id)
        }));
        const payload = {
          format: BACKUP_FORMAT,
          exportedAt: now(),
          app: { version: APP_VERSION, schemaVersion: store.schemaVersion() },
          user: { id: a.user.id, email: a.user.email, role: a.user.role, createdAt: a.user.createdAt },
          counts: {
            projects: projects.length,
            evidence: projects.reduce((n, x) => n + x.evidence.length, 0),
            claims: projects.reduce((n, x) => n + x.claims.length, 0),
            relations: projects.reduce((n, x) => n + x.relations.length, 0),
            notes: projects.reduce((n, x) => n + x.notes.length, 0)
          },
          notIncluded: ['chaves de IA (guardadas apenas cifradas, nunca exportadas)', 'sessões e tokens',
            'palavra-passe', 'eventos de auditoria de outros utilizadores'],
          projects
        };
        await store.audit({ type: 'backup_exported', actorId: a.user.id, subjectId: a.user.id, ip: ipOf(req),
          action: 'export_backup', detail: { projects: payload.counts.projects, evidence: payload.counts.evidence } });
        await store.count('backups_exported');
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': 'attachment; filename="conspiracy-tracker-copia-' + now().slice(0, 10) + '.json"',
          'cache-control': 'no-store'
        });
        return res.end(JSON.stringify(payload, null, 2));
      }
      if (p === '/api/auth/restore' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        const backup = body.backup;
        if (!backup || typeof backup !== 'object') return err(res, 400, 'corpo sem campo «backup»');
        if (!BACKUP_FORMATS_IN.includes(backup.format)) {
          return err(res, 400, 'formato de cópia desconhecido', { expected: BACKUP_FORMAT, legacyAccepted: BACKUP_FORMATS_IN.slice(1), got: backup.format || null });
        }
        const list = Array.isArray(backup.projects) ? backup.projects : null;
        if (!list) return err(res, 400, 'a cópia não tem lista de projectos');
        if (list.length > 50) return err(res, 400, 'a cópia excede 50 projectos: reponha por partes');
        const STR = (v, n) => (v == null ? null : String(v).slice(0, n || 2000));
        const DATE = (v) => { const d = new Date(v || ''); return isNaN(d.getTime()) ? null : d.toISOString(); };
        const restored = { projects: 0, evidence: 0, claims: 0, relations: 0, notes: 0, entityLinks: 0, runs: 0, skipped: [] };
        for (const entry of list) {
          const src = entry && entry.project;
          if (!src || !STR(src.title)) { restored.skipped.push({ project: null, reason: 'entrada sem título de projecto' }); continue; }
          const prj = await store.createProject(a.user.id, {
            title: STR(src.title, 200), question: STR(src.question, 2000) || '', objective: STR(src.objective, 4000) || '',
            status: ['draft', 'active', 'paused', 'archived'].includes(src.status) ? src.status : 'draft',
            referenceDate: DATE(src.referenceDate), scope: src.scope && typeof src.scope === 'object' ? {
              geo: STR(src.scope.geo, 200) || '', languages: Array.isArray(src.scope.languages) ? src.scope.languages.slice(0, 12).map((x) => STR(x, 40)) : [],
              period: src.scope.period && typeof src.scope.period === 'object' ? { from: DATE(src.scope.period.from), to: DATE(src.scope.period.to) } : { from: null, to: null }
            } : { geo: '', period: { from: null, to: null }, languages: [] },
            hypotheses: Array.isArray(src.hypotheses) ? src.hypotheses.slice(0, 50).map((x) => STR(x, 500)) : [],
            subquestions: Array.isArray(src.subquestions) ? src.subquestions.slice(0, 50).map((x) => STR(x, 500)) : [],
            completionCriteria: Array.isArray(src.completionCriteria) ? src.completionCriteria.slice(0, 30).map((x) => STR(x, 500)) : [],
            prioritySources: Array.isArray(src.prioritySources) ? src.prioritySources.slice(0, 30).map((x) => STR(x, 300)) : [],
            excludedSources: Array.isArray(src.excludedSources) ? src.excludedSources.slice(0, 30).map((x) => STR(x, 300)) : [],
            restoredFrom: { backupExportedAt: backup.exportedAt || null, originalProjectId: STR(src.id, 80) }
          });
          restored.projects++;
          const pid = prj.id;
          const evMap = new Map(), clMap = new Map(), relMap = new Map(), runMap = new Map();
          for (const e of (entry.evidence || []).slice(0, 1000)) {
            if (!STR(e.excerpt) || !STR(e.title)) { restored.skipped.push({ project: pid, reason: 'prova sem título ou excerto' }); continue; }
            const saved = await store.addEvidence(pid, {
              title: STR(e.title, 300), sourceType: e.sourceType || 'secundaria', stance: e.stance || 'favoravel',
              originalUrl: STR(e.originalUrl, 1500), archiveUrl: STR(e.archiveUrl, 1500), canonicalUrl: STR(e.canonicalUrl, 1500),
              excerpt: STR(e.excerpt, 6000), location: STR(e.location, 300), language: STR(e.language, 20),
              author: STR(e.author, 200), publicationDate: DATE(e.publicationDate), eventDate: DATE(e.eventDate),
              collectionDate: DATE(e.collectionDate), verificationDate: DATE(e.verificationDate),
              extractionMethod: e.extractionMethod || 'manual', limitations: STR(e.limitations, 1000),
              validationState: STATES.includes(e.validationState) ? e.validationState : 'insuficiente',
              entities: Array.isArray(e.entities) ? e.entities.slice(0, 50) : [], originKey: STR(e.originKey, 200),
              contentHash: STR(e.contentHash, 200), dedupeKey: STR(e.dedupeKey, 300),
              syndicationOf: STR(e.syndicationOf, 1500), retractedAt: DATE(e.retractedAt), retractReason: STR(e.retractReason, 500),
              access: e.access && typeof e.access === 'object' ? e.access : null,
              createdBy: a.user.id
            });
            evMap.set(e.id, saved.id);
            restored.evidence++;
          }
          for (const c of (entry.claims || []).slice(0, 500)) {
            if (!STR(c.text)) continue;
            const saved = await store.createClaim(pid, {
              text: STR(c.text, 2000), kind: c.kind || 'facto',
              state: STATES.includes(c.state) ? c.state : 'hipotese',
              confidence: c.confidence || null, reasoning: STR(c.reasoning, 4000),
              evidenceIds: (Array.isArray(c.evidenceIds) ? c.evidenceIds : []).map((id) => evMap.get(id)).filter(Boolean),
              createdBy: a.user.id
            });
            clMap.set(c.id, saved.id);
            restored.claims++;
          }
          for (const r of (entry.relations || []).slice(0, 500)) {
            if (!STR(r.from) || !STR(r.to)) continue;
            const saved = await store.addRelation(pid, {
              from: STR(r.from, 200), to: STR(r.to, 200), type: r.type,
              fromDisambiguator: STR(r.fromDisambiguator, 160), toDisambiguator: STR(r.toDisambiguator, 160),
              fromType: r.fromType || null, toType: r.toType || null, direction: r.direction || 'directed',
              period: r.period || { from: null, to: null },
              evidenceIds: (Array.isArray(r.evidenceIds) ? r.evidenceIds : []).map((id) => evMap.get(id)).filter(Boolean),
              inferred: r.inferred === true, reasoning: STR(r.reasoning, 2000), limitations: STR(r.limitations, 1000),
              retractedAt: DATE(r.retractedAt), retractReason: STR(r.retractReason, 500)
            }, a.user.id);
            relMap.set(r.id, saved.id);
            restored.relations++;
          }
          for (const n of (entry.notes || []).slice(0, 1000)) {
            if (!STR(n.title) || !STR(n.body)) continue;
            const links = n.links || {};
            await store.addNote(pid, {
              kind: MEMORY_KINDS[n.kind] ? n.kind : 'nota', title: STR(n.title, 200), body: STR(n.body, 8000),
              tags: Array.isArray(n.tags) ? n.tags.slice(0, 8).map((t) => STR(t, 40)) : [],
              reason: STR(n.reason, 2000), pinned: n.pinned === true,
              links: {
                evidenceIds: (links.evidenceIds || []).map((id) => evMap.get(id)).filter(Boolean),
                claimIds: (links.claimIds || []).map((id) => clMap.get(id)).filter(Boolean),
                relationIds: (links.relationIds || []).map((id) => relMap.get(id)).filter(Boolean),
                runIds: []
              },
              archivedAt: DATE(n.archivedAt), archiveReason: STR(n.archiveReason, 500)
            }, a.user.id);
            restored.notes++;
          }
          for (const l of (entry.entityLinks || []).slice(0, 500)) {
            if (!l.from || !l.to || !STR(l.identifier)) continue;
            const saved = await store.addEntityLink(pid, {
              from: l.from, to: l.to, identifier: STR(l.identifier, 120),
              identifierType: STR(l.identifierType, 40), reason: STR(l.reason, 1000),
              retractedAt: DATE(l.retractedAt), retractReason: STR(l.retractReason, 500)
            }, a.user.id);
            void saved;
            restored.entityLinks++;
          }
          for (const r of (entry.runs || []).slice(0, 200)) {
            await store.createRun(pid, {
              profile: r.profile || 'normal', status: r.status || 'stopped', step: r.step || 0,
              steps: Array.isArray(r.steps) ? r.steps.slice(0, 30) : [], stopReason: STR(r.stopReason, 500),
              stopDetail: STR(r.stopDetail, 1000), sourcesConsulted: Array.isArray(r.sourcesConsulted) ? r.sourcesConsulted.slice(0, 200) : [],
              finishedAt: DATE(r.finishedAt)
            });
            runMap.set(r.id, true);
            restored.runs++;
          }
        }
        await store.audit({ type: 'backup_restored', actorId: a.user.id, subjectId: a.user.id, ip: ipOf(req),
          action: 'restore_backup', detail: { projetos: restored.projects, provas: restored.evidence, conclusoes: restored.claims } });
        await store.count('backups_restored');
        return json(res, 201, { ok: true, restored,
          notRestored: ['chaves de IA (a cópia nunca as inclui: reintroduza-as no separador de chaves)', 'execuções dos agentes de IA (histórico de execução)'],
          note: 'cada projecto reposto recebe identificadores novos: as ligações entre provas, conclusões e relações foram remapeadas' });
      }

      if (p === '/api/auth/account' && method === 'DELETE') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        if (!verifyPassword(body.password, a.user.salt, a.user.passwordHash)) return err(res, 401, 'palavra-passe incorrecta');
        const snapshot = { id: a.user.id, email: a.user.email, projects: store.projectsOf(a.user.id).length };
        await store.deleteUser(a.user.id);
        await store.audit({ type: 'account_deleted', actorId: snapshot.id, subjectId: snapshot.id, ip: ipOf(req), action: 'delete_account', detail: snapshot });
        return json(res, 200, { ok: true, deleted: snapshot });
      }

      /* ---------- projectos (isolamento por dono) ---------- */
      if (p === '/api/projects' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        return json(res, 200, { ok: true, projects: store.projectsOf(a.user.id).map(summaryProject) });
      }
      if (p === '/api/projects' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        const prj = await store.createProject(a.user.id, projectFields(body));
        await store.audit({ type: 'project_created', actorId: a.user.id, subjectId: prj.id, action: 'create_project' });
        await store.count('projects_created');
        return json(res, 201, { ok: true, project: prj });
      }
      if (p.match(/^\/api\/projects\/[^/]+$/)) {
        const id = p.split('/').pop();
        const a = await requireUser(req, res); if (!a) return;
        const prj = store.projectByIdFor(id, a.user.id);
        if (!prj) return err(res, 404, 'projecto não encontrado');   // 404 e não 403: não revela existência
        if (method === 'GET') {
          /* o detalhe do projecto não leva o texto inteiro dos documentos:
             isso vem por /api/documents/:id, a pedido, para não arrastar
             dezenas de milhares de caracteres em cada pintura da interface */
          const light = Object.assign({}, prj, {
            documents: (prj.documents || []).map((d) => Object.assign({}, d, {
              text: undefined, preview: String(d.text || '').slice(0, 300), textChars: String(d.text || '').length
            }))
          });
          return json(res, 200, { ok: true, project: light });
        }
        if (!requireCsrf(req, res, a)) return;
        if (method === 'PATCH') {
          const body = await readBody(req);
          const updated = await store.updateProject(id, a.user.id, projectFields(body, true));
          await store.audit({ type: 'project_updated', actorId: a.user.id, subjectId: id, action: 'update_project', detail: { fields: Object.keys(body) } });
          return json(res, 200, { ok: true, project: updated });
        }
        if (method === 'DELETE') {
          await store.deleteProject(id, a.user.id);
          await store.audit({ type: 'project_deleted', actorId: a.user.id, subjectId: id, action: 'delete_project' });
          return json(res, 200, { ok: true });
        }
      }

      /* ---------- ciclo de vida do projecto ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/(duplicate|archive|resume|cancel|checkpoints)$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const parts = p.split('/');
        const pid = parts[3], action = parts[4];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        if (action === 'checkpoints') {
          const body = await readBody(req);
          const cp = await store.addCheckpoint(pid, a.user.id, body.label, a.user.id);
          await store.audit({ type: 'project_checkpoint', actorId: a.user.id, subjectId: pid, action: 'checkpoint', detail: { label: cp.label } });
          return json(res, 201, { ok: true, checkpoint: cp });
        }
        if (action === 'duplicate') {
          const copy = await store.duplicateProject(pid, a.user.id);
          await store.audit({ type: 'project_created', actorId: a.user.id, subjectId: copy.id, action: 'duplicate_project', detail: { from: pid } });
          return json(res, 201, { ok: true, project: copy });
        }
        const status = { archive: 'archived', resume: 'active', cancel: 'cancelled' }[action];
        const updated = await store.setProjectStatus(pid, a.user.id, status);
        await store.audit({ type: 'project_status', actorId: a.user.id, subjectId: pid, action, detail: { status } });
        return json(res, 200, { ok: true, project: updated });
      }

      /* ---------- arquivo de trabalho: checkpoints profundos ---------- */
      /* nome «work» e não «archive»: /archive já existe desde a fase 2 do projecto
         (arquivar o projecto) e a primeira rota ganha — colidir aqui dava 200 com
         o projecto arquivado em vez do checkpoint. */
      if (p.match(/^\/api\/projects\/[^/]+\/work$/) && (method === 'GET' || method === 'POST')) {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        if (method === 'GET') {
          const list = store.checkpointsOf(pid).slice(-50);
          return json(res, 200, { ok: true, count: list.length, checkpoints: list,
            note: list.length ? null : 'sem checkpoints: nada a retomar' });
        }
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        const taskId = String(body.taskId || '').slice(0, 80) || 'principal';
        const out = await store.saveCheckpoint({
          projectId: pid, taskId, objective: body.objective, state: body.state,
          context: body.context, decisions: body.decisions, artifacts: body.artifacts,
          sources: body.sources, verified: body.verified, open: body.open,
          nextAction: body.nextAction, doneCriteria: body.doneCriteria,
          model: body.model || null, provider: body.provider || null, by: a.user.id
        }, { ifVersion: body.ifVersion });
        if (!out.ok && out.conflict) {
          return err(res, 409, 'checkpoint alterado por outro processo: releia antes de gravar', { current: out.current });
        }
        await store.audit({ type: 'checkpoint_saved', actorId: a.user.id, subjectId: pid, action: 'checkpoint',
          detail: { taskId, version: out.checkpoint.version, artifacts: out.checkpoint.artifacts.length } });
        return json(res, 201, { ok: true, checkpoint: out.checkpoint });
      }

      if (p.match(/^\/api\/projects\/[^/]+\/work\/[^/]+$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const parts = p.split('/');
        const pid = parts[3], ver = parts[5];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        const all = store.checkpointsOf(pid);
        const one = all.find((c) => String(c.version) === String(ver) && (!req.url.includes('task=') || c.taskId === new URL(req.url, 'http://x').searchParams.get('task')))
          || all.filter((c) => String(c.version) === String(ver)).pop();
        if (!one) return err(res, 404, 'versão de checkpoint não encontrada');
        return json(res, 200, { ok: true, checkpoint: one,
          note: 'checkpoint é imutável: retomar não altera versões anteriores' });
      }

      /* ---------- registo de provas ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/evidence$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const list = store.evidenceOf(pid);
        return json(res, 200, { ok: true, count: list.length, evidence: list });
      }
      if (p.match(/^\/api\/projects\/[^/]+\/evidence$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const body = await readBody(req);
        const v = validateEvidence(body);
        if (!v.ok) return err(res, 400, 'prova inválida: ' + v.errors.join('; '), { errors: v.errors });
        const ev = v.evidence;
        ev.dedupeKey = dedupeKey(ev);
        ev.createdBy = a.user.id;
        /* duplicado exacto: devolve o que existe em vez de inflacionar a contagem */
        const dup = store.evidenceByDedupe(pid, ev.dedupeKey);
        if (dup) {
          return json(res, 200, {
            ok: true, duplicate: true, evidence: dup,
            note: 'já existia uma prova com o mesmo conteúdo e URL: não foi duplicada (contaria como duas origens sem o ser)'
          });
        }
        const saved = await store.addEvidence(pid, ev);
        await store.audit({ type: 'evidence_added', actorId: a.user.id, subjectId: saved.id,
          action: 'add_evidence', detail: { projectId: pid, sourceType: ev.sourceType, stance: ev.stance, origin: ev.originKey } });
        await store.count('evidence_added');
        return json(res, 201, { ok: true, evidence: saved, origin: ev.originKey });
      }
      if (p.match(/^\/api\/evidence\/[^/]+$/) && (method === 'PATCH' || method === 'DELETE')) {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const eid = p.split('/')[3];
        const ev = evidenceFor(a, eid);
        if (!ev) return err(res, 404, 'prova não encontrada');
        const body = await readBody(req);
        if (method === 'DELETE') {
          /* Não se apaga prova: retira-se com motivo, e fica registado. */
          const reason = String(body.reason || '').trim();
          if (reason.length < 5) return err(res, 400, 'retirar uma prova exige um motivo escrito (mínimo 5 caracteres)');
          const out = await store.retractEvidence(eid, reason, a.user.id);
          await store.audit({ type: 'evidence_retracted', actorId: a.user.id, subjectId: eid, action: 'retract_evidence',
            reason, detail: { projectId: ev.projectId } });
          return json(res, 200, { ok: true, evidence: out,
            note: 'a prova foi retirada, não apagada: o histórico e as alegações associadas mantêm-se auditáveis' });
        }
        const patch = {};
        if (body.validationState !== undefined) {
          if (!STATES.includes(body.validationState)) return err(res, 400, 'validationState inválido', { allowed: STATES });
          patch.validationState = body.validationState;
        }
        if (body.limitations !== undefined) patch.limitations = String(body.limitations).slice(0, 1000);
        if (body.verificationDate !== undefined) {
          const d = new Date(body.verificationDate);
          if (isNaN(d.getTime())) return err(res, 400, 'verificationDate inválida');
          patch.verificationDate = d.toISOString();
        }
        if (body.stance !== undefined) patch.stance = body.stance;
        if (body.archiveUrl !== undefined) patch.archiveUrl = String(body.archiveUrl).slice(0, 1500);
        if (!Object.keys(patch).length) return err(res, 400, 'nada para actualizar');
        const out = await store.updateEvidence(eid, patch, a.user.id, 'actualizada');
        await store.audit({ type: 'evidence_updated', actorId: a.user.id, subjectId: eid, action: 'update_evidence',
          detail: { fields: Object.keys(patch) } });
        return json(res, 200, { ok: true, evidence: out });
      }

      /* ---------- memória da investigação ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/memory$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        const notes = store.notesOf(pid);
        if (String(url.searchParams.get('format') || 'json') === 'md') {
          const md = memoryToMarkdown(notes, { projectTitle: prj.title });
          return jsonOrFile(res, 200, md, 'text/markdown; charset=utf-8', 'conspiracy-tracker-memoria-' + pid + '.md');
        }
        return json(res, 200, {
          ok: true, kinds: MEMORY_KINDS, limits: MEMORY_LIMITS,
          notes: notes.slice().sort((a2, b2) => String(b2.createdAt).localeCompare(String(a2.createdAt))),
          counts: notes.reduce((acc, n) => { const k = n.archivedAt ? 'arquivadas' : n.kind; acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
          note: 'a memória explica decisões e lacunas; não altera estados de conclusões nem cria provas'
        });
      }
      if (p.match(/^\/api\/projects\/[^/]+\/memory$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const body = await readBody(req);
        const v = validateMemory(body, { count: store.notesOf(pid).filter((n) => !n.archivedAt).length });
        if (!v.ok) return err(res, 400, 'entrada de memória recusada: ' + v.errors.join('; '), { errors: v.errors });
        /* as ligações têm de apontar para objectos deste projecto */
        const evIds = new Set(store.evidenceOf(pid).map((e) => e.id));
        const clIds = new Set(store.claimsOf(pid).map((c) => c.id));
        const rlIds = new Set(store.relationsOf(pid).map((r) => r.id));
        const bad = v.note.links.evidenceIds.filter((id) => !evIds.has(id))
          .concat(v.note.links.claimIds.filter((id) => !clIds.has(id)))
          .concat(v.note.links.relationIds.filter((id) => !rlIds.has(id)));
        if (bad.length) return err(res, 400, 'ligações a objectos inexistentes neste projecto: ' + bad.join(', '));
        const saved = await store.addNote(pid, v.note, a.user.id);
        await store.audit({ type: 'memory_added', actorId: a.user.id, subjectId: saved.id, action: 'add_memory',
          detail: { projectId: pid, kind: saved.kind, pinned: saved.pinned } });
        await store.count('memory_entries');
        return json(res, 201, { ok: true, note: saved });
      }
      if (p.match(/^\/api\/memory\/[^/]+$/) && (method === 'PATCH' || method === 'DELETE')) {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const id = p.split('/')[3];
        const n = store.noteById(id);
        if (!n || !projectFor(a, n.projectId)) return err(res, 404, 'entrada de memória não encontrada');
        const body = await readBody(req);
        if (method === 'DELETE') {
          const reason = String(body.reason || '').trim();
          if (reason.length < 5) return err(res, 400, 'arquivar uma entrada exige motivo escrito (mínimo 5 caracteres)');
          const out = await store.archiveNote(id, reason, a.user.id);
          await store.audit({ type: 'memory_archived', actorId: a.user.id, subjectId: id, action: 'archive_memory',
            reason, detail: { projectId: n.projectId } });
          return json(res, 200, { ok: true, note: out, note_text: 'a entrada foi arquivada, não apagada: mantém-se no histórico' });
        }
        const patch = {};
        if (body.title !== undefined) patch.title = String(body.title).trim().slice(0, MEMORY_LIMITS.title);
        if (body.body !== undefined) patch.body = String(body.body).trim().slice(0, MEMORY_LIMITS.body);
        if (body.reason !== undefined) patch.reason = String(body.reason).trim().slice(0, 2000) || null;
        if (body.pinned !== undefined) patch.pinned = body.pinned === true;
        if (!Object.keys(patch).length) return err(res, 400, 'nada para actualizar');
        if (patch.title !== undefined && patch.title.length < 3) return err(res, 400, 'título demasiado curto');
        if (patch.body !== undefined && patch.body.length < 3) return err(res, 400, 'corpo demasiado curto');
        const out = await store.updateNote(id, patch, a.user.id, 'actualizada');
        await store.audit({ type: 'memory_updated', actorId: a.user.id, subjectId: id, action: 'update_memory',
          detail: { fields: Object.keys(patch) } });
        return json(res, 200, { ok: true, note: out });
      }

      /* ---------- fusão de homónimos com identificador ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/entities\/link$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const pid = p.split('/')[3];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        const body = await readBody(req);
        const v = validateEntityLink(body);
        if (!v.ok) return err(res, 400, 'fusão recusada: ' + v.errors.join('; '), { errors: v.errors });
        const link = await store.addEntityLink(pid, v.link, a.user.id);
        await store.audit({ type: 'entity_link_created', actorId: a.user.id, subjectId: link.id, action: 'link_entities',
          detail: { projectId: pid, from: link.from.name, to: link.to.name, identifier: link.identifier } });
        await store.count('entity_links');
        return json(res, 201, { ok: true, link,
          note: 'ligação declarada e reversível: o grafo passa a tratar as duas entradas como a mesma entidade, com o identificador indicado' });
      }
      if (p.match(/^\/api\/entity-links\/[^/]+$/) && method === 'DELETE') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const id = p.split('/')[3];
        const link = store.entityLinksOf ? (store.data.entityLinks || []).find((l) => l.id === id) : null;
        if (!link || !projectFor(a, link.projectId)) return err(res, 404, 'ligação não encontrada');
        const body = await readBody(req);
        const reason = String(body.reason || '').trim();
        if (reason.length < 5) return err(res, 400, 'desfazer uma ligação exige motivo escrito (mínimo 5 caracteres)');
        const out = await store.retractEntityLink(id, reason, a.user.id);
        await store.audit({ type: 'entity_link_retracted', actorId: a.user.id, subjectId: id, action: 'unlink_entities',
          reason, detail: { projectId: link.projectId } });
        return json(res, 200, { ok: true, link: out });
      }

      /* ---------- resumo descarregável (MD / JSON / CSV / PDF) ---------- */
      /* ================= registo de fontes (fase 3G) =================
         Um registo de fontes não é um catálogo de links: cada fonte tem estado
         explícito, verificações datadas, classificações com justificação e
         decisões auditadas. Ver docs/FONTES.md. */

      if (p === '/api/sources/meta' && method === 'GET') {
        return json(res, 200, {
          ok: true,
          states: Object.entries(SOURCE_STATES).map(([k, v]) => ({ id: k, label: v.label, hint: v.hint, order: v.order })),
          categories: Object.entries(SOURCE_CATEGORIES).map(([k, label]) => ({ id: k, label })),
          jurisdictions: JURISDICTIONS,
          dimensions: RATING_DIMENSIONS,
          bands: RATING_BANDS,
          adapters: Object.values(ADAPTERS).map((ad) => ({
            id: ad.id, label: ad.label, category: ad.category, jurisdiction: ad.jurisdiction,
            method: ad.method, limits: ad.limits, licence: ad.licence, version: ad.version
          }))
        });
      }

      if (p === '/api/sources' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const state = url.searchParams.get('state');
        const category = url.searchParams.get('category');
        const jurisdiction = url.searchParams.get('jurisdiction');
        let list = store.sources();
        if (state) list = list.filter((x) => x.state === state);
        if (category) list = list.filter((x) => x.category === category);
        if (jurisdiction) list = list.filter((x) => String(x.jurisdiction || '').toUpperCase() === jurisdiction.toUpperCase());
        if (q) list = list.filter((x) => (x.name + ' ' + (x.institution || '') + ' ' + x.url).toLowerCase().includes(q));
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 200)));
        const items = list.slice(0, limit).map((x) => {
          const last = store.lastCheckOf(x.id);
          const ratings = store.ratingsOf(x.id);
          const lastRating = ratings.length ? ratings[ratings.length - 1] : null;
          return {
            id: x.id, name: x.name, url: x.url, canonicalUrl: x.canonicalUrl || null,
            domain: x.domain || null, category: x.category, jurisdiction: x.jurisdiction,
            institution: x.institution || null, state: x.state, stateLabel: (SOURCE_STATES[x.state] || {}).label || x.state,
            discoveredAt: x.createdAt, discoveredVia: x.discoveredVia || null,
            lastCheckAt: last ? last.at : null,
            lastCheckStatus: last ? last.httpStatus : null,
            rating: lastRating ? { band: lastRating.band, score: lastRating.score, provisional: lastRating.provisional, risk: lastRating.riskScore, at: lastRating.at } : null,
            decisions: store.decisionsOf(x.id).length
          };
        });
        const stats = { total: store.sources().length };
        Object.keys(SOURCE_STATES).forEach((k) => { stats[k] = store.sources().filter((x) => x.state === k).length; });
        return json(res, 200, { ok: true, count: items.length, total: list.length, stats, items });
      }

      if (p === '/api/sources' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        if (!srcLimiter.allowed(a.user.id)) return err(res, 429, 'demasiados candidatos submetidos nesta hora');
        const body = await readBody(req);
        const parsed = parseUrl(body.url);
        if (!parsed.ok) return err(res, 400, 'URL recusada: ' + parsed.reason);
        const category = String(body.category || 'outra');
        if (!SOURCE_CATEGORIES[category]) return err(res, 400, 'categoria desconhecida (ver /api/sources/meta)');
        const key = sourceDedupeKey(body.url);
        const existing = store.sourceByKey(key);
        if (existing) {
          return json(res, 409, {
            ok: false, error: 'esta fonte já está registada (mesmo URL canónico)',
            existing: { id: existing.id, name: existing.name, state: existing.state, url: existing.url },
            nota: 'duplicados não entram no catálogo: duas entradas para a mesma fonte inflacionam a cobertura e escondem lacunas'
          });
        }
        const src = await store.createSource({
          name: String(body.name || parsed.host).slice(0, 200),
          url: parsed.url.toString(), canonicalUrl: canonicalUrl(body.url), dedupeKey: key,
          domain: domainOf(body.url), category,
          jurisdiction: String(body.jurisdiction || '').toUpperCase().slice(0, 2) || null,
          institution: body.institution ? String(body.institution).slice(0, 200) : null,
          notes: body.notes ? String(body.notes).slice(0, 2000) : null,
          discoveredVia: { adapter: 'manual', submittedBy: a.user.id, at: new Date().toISOString() },
          state: 'DISCOVERED'
        }, a.user.id);
        await store.audit({ type: 'source_discovered', actorId: a.user.id, ip: ipOf(req), subjectId: src.id,
          action: 'source_create', detail: { url: src.canonicalUrl, category } });
        return json(res, 201, { ok: true, source: src, nota: 'registada como DISCOVERED: ainda não foi verificada nem aprovada' });
      }

      if (p.match(/^\/api\/sources\/[^/]+$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const id = p.split('/')[3];
        const src = store.sourceById(id);
        if (!src) return err(res, 404, 'fonte não encontrada');
        const checks = store.checksOf(id);
        const ratings = store.ratingsOf(id);
        return json(res, 200, {
          ok: true, source: src, checks, ratings,
          decisions: store.decisionsOf(id),
          rating: ratings.length ? ratings[ratings.length - 1] : null,
          nota: 'as verificações são observações datadas; uma falha de hoje não apaga a de ontem'
        });
      }

      if (p.match(/^\/api\/sources\/[^/]+\/check$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const id = p.split('/')[3];
        const src = store.sourceById(id);
        if (!src) return err(res, 404, 'fonte não encontrada');
        if (!checkLimiter.allowed(a.user.id + ':' + id)) return err(res, 429, 'verificações demasiado frequentes para esta fonte');
        const raw = await checkAccess(src.canonicalUrl || src.url, { timeoutMs: 12000 });
        const mapped = stateFromCheck(raw);
        const record = {
          httpStatus: raw.httpStatus, contentType: raw.contentType, ms: raw.ms, bytes: raw.bytes,
          truncated: raw.truncated, finalUrl: raw.finalUrl, redirects: raw.redirects || [],
          tls: raw.httpStatus ? /^https:/i.test(raw.finalUrl || src.url) : false,
          blocked: raw.status === 'bloqueado', reason: raw.reason || null, stateLabel: raw.stateLabel,
          observed: raw.status, state: mapped.state, why: mapped.why
        };
        const check = await store.addSourceCheck(id, record);
        /* o estado muda por observação, nunca por optimismo */
        const nextState = (src.state === 'APPROVED' || src.state === 'ACTIVE')
          ? (mapped.state === 'TECHNICAL_TESTING' ? src.state : 'DEGRADED')
          : mapped.state;
        const updated = await store.updateSource(id, { state: nextState, lastCheckAt: check.at }, a.user.id, 'verificação técnica');
        await store.audit({ type: 'source_checked', actorId: a.user.id, ip: ipOf(req), subjectId: id,
          action: 'source_check', detail: { httpStatus: record.httpStatus, from: src.state, to: nextState } });
        return json(res, 200, {
          ok: true, check, source: updated,
          interpretation: mapped.why,
          nota: 'verificação de leitura simples: sem cookies, sem credenciais, sem executar scripts; o conteúdo não é guardado'
        });
      }

      if (p.match(/^\/api\/sources\/[^/]+\/rate$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const id = p.split('/')[3];
        const src = store.sourceById(id);
        if (!src) return err(res, 404, 'fonte não encontrada');
        const body = await readBody(req);
        const last = store.lastCheckOf(id);
        const rating = rateSource({
          meta: Object.assign({ institution: src.institution }, body.meta || {}),
          checks: Object.assign({
            officialDomain: /(^|\.)(gov|gov\.[a-z]{2}|gob|gouv|admin\.ch|europa\.eu|int)$/i.test(src.domain || ''),
            tls: last ? last.tls !== false : null,
            httpStatus: last ? last.httpStatus : null,
            ms: last ? last.ms : null,
            contentType: last ? last.contentType : null,
            accessScore: last ? (last.httpStatus >= 200 && last.httpStatus < 400 ? 80 : last.httpStatus ? 40 : 10) : null,
            checkedAt: last ? last.at : null,
            redirectsToOtherDomain: last && last.redirects && last.redirects.some((r) => domainOf(r.to || '') && domainOf(r.to) !== src.domain),
            restricted: src.state === 'RESTRICTED',
            lastPublishedDays: (body.meta && body.meta.lastPublishedDays) != null ? Number(body.meta.lastPublishedDays) : null
          }, body.checks || {})
        });
        const saved = await store.addSourceRating(id, rating, a.user.id);
        await store.audit({ type: 'source_rated', actorId: a.user.id, ip: ipOf(req), subjectId: id,
          action: 'source_rate', detail: { band: rating.band, score: rating.score, provisional: rating.provisional, missing: rating.missing } });
        return json(res, 200, {
          ok: true, rating: saved,
          nota: rating.provisional ? 'classificação provisória: faltam verificações; não é uma nota definitiva' : null
        });
      }

      if (p.match(/^\/api\/sources\/[^/]+\/decision$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const id = p.split('/')[3];
        const src = store.sourceById(id);
        if (!src) return err(res, 404, 'fonte não encontrada');
        const body = await readBody(req);
        const decisions = { approve: 'APPROVED', reject: 'REJECTED', review: 'NEEDS_REVIEW', activate: 'ACTIVE', deprecate: 'DEPRECATED' };
        const target = decisions[String(body.decision || '')];
        if (!target) return err(res, 400, 'decisão inválida (use: approve, reject, review, activate, deprecate)');
        const reason = String(body.reason || '').trim().slice(0, 1000);
        if (reason.length < 10) return err(res, 400, 'uma decisão exige motivo escrito (mínimo 10 caracteres)');
        const lastRating = (store.ratingsOf(id) || []).slice(-1)[0] || null;
        if ((target === 'APPROVED' || target === 'ACTIVE') && !lastRating) {
          return err(res, 409, 'não se aprova uma fonte sem classificação registada: peça a classificação primeiro');
        }
        if ((target === 'APPROVED' || target === 'ACTIVE') && lastRating && lastRating.provisional) {
          return err(res, 409, 'a classificação é provisória (evidência insuficiente): uma fonte não entra em uso com nota provisória');
        }
        const rec = await store.addSourceDecision(id, {
          decision: body.decision, state: target, reason,
          ratingId: lastRating ? lastRating.id : null,
          ratingBand: lastRating ? lastRating.band : null,
          ratingProvisional: lastRating ? !!lastRating.provisional : null
        }, a.user.id);
        const updated = await store.updateSource(id, { state: target }, a.user.id, 'decisão: ' + body.decision);
        await store.audit({ type: 'source_decision', actorId: a.user.id, ip: ipOf(req), subjectId: id,
          action: 'source_' + body.decision, detail: { from: src.state, to: target, reason: reason.slice(0, 200) } });
        return json(res, 200, { ok: true, decision: rec, source: updated });
      }

      if (p === '/api/coverage' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const cov = coverageFrom(store.sources());
        return json(res, 200, Object.assign({ ok: true }, cov));
      }

      if (p === '/api/discovery/runs' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        return json(res, 200, { ok: true, runs: store.discoveryRuns().slice(0, 50).map((r) => Object.assign({}, r)) });
      }

      if (p === '/api/discovery/run' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        if (!discoveryLimiter.allowed(a.user.id)) return err(res, 429, 'execuções de descoberta demasiado frequentes');
        const body = await readBody(req);
        const adapterId = String(body.adapter || 'courtlistener_courts');
        const adapter = ADAPTERS[adapterId];
        if (!adapter) return err(res, 400, 'adaptador desconhecido (ver /api/sources/meta)');
        const dryRun = body.dryRun === true;
        const run = dryRun ? { id: 'dry-' + Date.now().toString(36) } : await store.createDiscoveryRun({
          adapter: adapter.id, adapterVersion: adapter.version,
          params: { pageSize: body.pageSize || 40 }, dryRun: false,
          query: adapter.method
        }, a.user.id);
        const t0 = Date.now();
        let result = null, error = null;
        try { result = await adapter.discover({ pageSize: body.pageSize || 40 }); }
        catch (e) { error = String(e && e.message || e); }
        const durationMs = Date.now() - t0;
        if (!result || !result.ok) {
          if (!dryRun) await store.updateDiscoveryRun(run.id, { status: 'failed', error: error || (result && result.error) || 'falha desconhecida', durationMs, finishedAt: new Date().toISOString() });
          return json(res, 502, {
            ok: false, runId: dryRun ? null : run.id, adapter: adapter.id,
            error: error || (result && result.error) || 'o adaptador não devolveu resultados',
            nota: 'a execução fica registada como falhada; nada é marcado como descoberto'
          });
        }
        const created = [], duplicates = [];
        for (const c of result.candidates) {
          const key = sourceDedupeKey(c.url);
          if (!key) { duplicates.push({ url: c.url, why: 'URL inválida' }); continue; }
          if (store.sourceByKey(key)) { duplicates.push({ url: c.url, why: 'já registada' }); continue; }
          if (dryRun) { created.push({ name: c.name, url: c.url, dryRun: true }); continue; }
          const src = await store.createSource({
            name: c.name, url: c.url, canonicalUrl: canonicalUrl(c.url), dedupeKey: key,
            domain: domainOf(c.url), category: c.category, jurisdiction: c.jurisdiction,
            institution: c.institution, notes: c.notes, discoveredVia: c.discoveredVia,
            state: 'DISCOVERED'
          }, a.user.id);
          created.push({ id: src.id, name: src.name, url: src.url });
        }
        if (!dryRun) {
          await store.updateDiscoveryRun(run.id, {
            status: 'completed', durationMs, finishedAt: new Date().toISOString(),
            query: result.url, found: result.found, candidates: result.candidates.length,
            created: created.length, duplicates: duplicates.length,
            duplicatesSample: duplicates.slice(0, 20)
          });
          await store.audit({ type: 'discovery_run', actorId: a.user.id, ip: ipOf(req), action: 'discovery_run',
            detail: { adapter: adapter.id, created: created.length, duplicates: duplicates.length } });
        }
        return json(res, 200, {
          ok: true, runId: dryRun ? null : run.id, adapter: adapter.id, query: result.url,
          found: result.found, candidates: result.candidates.length, created: created.length, duplicates: duplicates.length,
          duplicatesSample: duplicates.slice(0, 10), items: created.slice(0, 50),
          durationMs,
          nota: dryRun ? 'modo de teste: nada foi gravado' : 'as fontes entram como DISCOVERED: nenhuma é usada antes de verificada e aprovada'
        });
      }

      /* ---------- documentos recolhidos: texto extraído para revisão humana ----------
         O documento entra na base com o texto (e o que a extracção NÃO garante),
         mas nenhuma prova é criada aqui: quem cita tem de ler e confirmar. */
      if (p.match(/^\/api\/projects\/[^/]+\/documents$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const list = store.documentsOf(pid).map((d) => Object.assign({}, d, {
          text: undefined, preview: String(d.text || '').slice(0, 300),
          textChars: String(d.text || '').length
        }));
        return json(res, 200, {
          ok: true, count: list.length, documents: list,
          nota: 'o texto extraído não é prova: abra o documento, leia e confirme o excerto antes de o citar'
        });
      }
      if (p.match(/^\/api\/projects\/[^/]+\/documents$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        if (!docLimiter.allowed(a.user.id)) return err(res, 429, 'demasiadas recolhas de documentos nesta hora');
        const body = await readBody(req);
        const url = String(body.url || '').trim();
        if (!url || url.length > 2000) return err(res, 400, 'URL em falta ou demasiado longa');
        let host = null;
        try { host = new URL(url).hostname; } catch { return err(res, 400, 'URL inválida'); }
        docLimiter.hit(a.user.id);
        const got = await fetchDoc(url);
        const ex = got.extraction || null;
        /* uma fonte inacessível fica registada como inacessível — não se apaga o rasto */
        const doc = await store.addDocument(pid, a.user.id, {
          url, canonicalUrl: got.finalUrl || url, host, kind: got.kind || 'desconhecido',
          title: String(body.title || '').slice(0, 300) || null,
          note: String(body.note || '').slice(0, 1000) || null,
          ok: !!got.ok, status: got.status || null,
          bytes: got.bytes || 0, hash: got.hash || null,
          error: got.ok ? null : String(got.error || 'falha na recolha').slice(0, 200),
          text: got.ok ? String(got.text || '').slice(0, 60000) : '',
          extraction: ex, needsReview: true, reviewed: false, createdBy: a.user.id
        });
        await store.audit({
          type: 'document_fetched', actorId: a.user.id, subjectId: doc.id, action: 'fetch_document',
          detail: { projectId: pid, kind: doc.kind, ok: doc.ok, status: doc.status, hash: doc.hash, method: ex && ex.method }
        });
        await store.count('document_fetched');
        return json(res, got.ok ? 201 : 200, {
          ok: !!got.ok, document: Object.assign({}, doc, { text: undefined, preview: String(doc.text || '').slice(0, 300), textChars: String(doc.text || '').length }),
          extraction: ex,
          erro: got.ok ? null : doc.error,
          revisaoObrigatoria: doc.ok ? 'leia o texto extraído e confirme o excerto antes de o transformar em prova' : null
        });
      }
      if (p.match(/^\/api\/documents\/[^/]+$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const did = p.split('/')[3];
        const doc = store.documentById(did);
        if (!doc) return err(res, 404, 'documento não encontrado');
        const prj = store.data.projects.find((x) => (x.documents || []).some((d2) => d2.id === did));
        /* 404 e não 403: não se revela a existência de documentos de outra pessoa */
        if (!prj || (prj.ownerId !== a.user.id && a.user.role !== 'ADMIN')) return err(res, 404, 'documento não encontrado');
        if (prj.ownerId !== a.user.id) {
          await store.audit({ type: 'admin_document_access', actorId: a.user.id, subjectId: did, action: 'read_document', detail: { projectId: prj.id, ownerId: prj.ownerId } });
        }
        return json(res, 200, { ok: true, document: doc, projectId: prj.id });
      }
      if (p.match(/^\/api\/documents\/[^/]+$/) && (method === 'PATCH' || method === 'DELETE')) {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const did = p.split('/')[3];
        const doc = store.documentById(did);
        if (!doc) return err(res, 404, 'documento não encontrado');
        const prj = store.data.projects.find((x) => (x.documents || []).some((d2) => d2.id === did));
        if (!prj || (prj.ownerId !== a.user.id && a.user.role !== 'ADMIN')) return err(res, 404, 'documento não encontrado');
        if (method === 'DELETE') {
          await store.deleteDocument(did, prj.ownerId);
          await store.audit({ type: 'document_deleted', actorId: a.user.id, subjectId: did, action: 'delete_document', detail: { projectId: prj.id } });
          return json(res, 200, { ok: true });
        }
        const body = await readBody(req);
        const patch = {};
        ['title', 'note', 'reviewNote'].forEach((k) => { if (body[k] !== undefined) patch[k] = String(body[k]).slice(0, 1000); });
        if (body.reviewed !== undefined) patch.reviewed = !!body.reviewed;
        const updated = await store.updateDocument(did, prj.ownerId, patch);
        await store.audit({ type: 'document_reviewed', actorId: a.user.id, subjectId: did, action: 'update_document', detail: { projectId: prj.id, fields: Object.keys(patch), reviewed: updated.reviewed } });
        return json(res, 200, { ok: true, document: Object.assign({}, updated, { text: undefined, preview: String(updated.text || '').slice(0, 300), textChars: String(updated.text || '').length }) });
      }

      if (p.match(/^\/api\/projects\/[^/]+\/summary$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        const format = String(url.searchParams.get('format') || 'json').toLowerCase();
        if (!['json', 'md', 'csv', 'pdf'].includes(format)) return err(res, 400, 'formato inválido', { allowed: ['json', 'md', 'csv', 'pdf'] });
        const s = buildSummary({
          project: prj, evidence: store.evidenceOf(pid), claims: store.claimsOf(pid),
          relations: store.relationsOf(pid), runs: store.runsOf(pid), memory: store.notesOf(pid),
          usage: store.data.usage.filter((u) => u.userId === a.user.id), agentRuns: store.agentRunsOf(pid)
        });
        await store.audit({ type: 'summary_downloaded', actorId: a.user.id, subjectId: pid, action: 'download_summary',
          detail: { projectId: pid, format, conclusoes: s.estado.conclusoes, provas: s.estado.provasActivas } });
        await store.count('summary_downloads');
        if (format === 'pdf') {
          const buf = summaryToPdf(s);
          res.writeHead(200, { 'content-type': 'application/pdf',
            'content-disposition': 'attachment; filename="' + summaryFilename(prj, 'pdf') + '"',
            'content-length': buf.length, 'cache-control': 'no-store' });
          return res.end(buf);
        }
        if (format === 'md') return jsonOrFile(res, 200, summaryToMarkdown(s), 'text/markdown; charset=utf-8', summaryFilename(prj, 'md'));
        if (format === 'csv') return jsonOrFile(res, 200, summaryToCsv(s), 'text/csv; charset=utf-8', summaryFilename(prj, 'csv'));
        return json(res, 200, Object.assign({ ok: true }, s));
      }

      /* ---------- verificação de acesso às fontes (uma página, a pedido) ----------
         Não contorna barreiras, não guarda conteúdo, não muda estados sozinho. */
      if (p.match(/^\/api\/evidence\/[^/]+\/check-access$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const eid = p.split('/')[3];
        const ev = evidenceFor(a, eid);
        if (!ev) return err(res, 404, 'prova não encontrada');
        if (ev.retractedAt) return err(res, 409, 'a prova está retirada: não se verifica o acesso de prova retirada');
        if (!accessLimiter.allowed(a.user.id)) return err(res, 429, 'demasiadas verificações de acesso nesta hora');
        accessLimiter.hit(a.user.id);
        const out = await runAccessCheck(ev, a);
        await store.audit({ type: 'evidence_access_checked', actorId: a.user.id, subjectId: eid, action: 'check_access',
          ip: ipOf(req), detail: { projectId: ev.projectId, status: out.check.status, httpStatus: out.check.httpStatus } });
        await store.count('access_checks');
        return json(res, 200, { ok: true, evidence: out.evidence, check: out.check, suggestion: out.suggestion });
      }
      if (p.match(/^\/api\/projects\/[^/]+\/check-access$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const body = await readBody(req);
        const limit = Math.max(1, Math.min(10, Number(body.limit) || 5));
        const all = store.evidenceOf(pid).filter((e) => !e.retractedAt);
        let pool = all;
        if (Array.isArray(body.evidenceIds) && body.evidenceIds.length) {
          const want = new Set(body.evidenceIds.map(String));
          pool = all.filter((e) => want.has(e.id));
        }
        /* só se verifica o que tem endereço: inventar um endereço é pior do que não verificar */
        const withoutUrl = pool.filter((e) => !(e.canonicalUrl || e.originalUrl)).length;
        pool = pool.filter((e) => e.canonicalUrl || e.originalUrl).slice(0, limit);
        if (!pool.length) return err(res, 400, 'nenhuma prova com URL para verificar', { withoutUrl });
        if (!accessLimiter.allowed(a.user.id, pool.length)) return err(res, 429, 'demasiadas verificações de acesso nesta hora', { requested: pool.length });
        const results = [];
        for (const ev of pool) {
          accessLimiter.hit(a.user.id);
          const out = await runAccessCheck(ev, a);
          results.push({ id: ev.id, title: ev.title, check: out.check, suggestion: out.suggestion });
          await store.audit({ type: 'evidence_access_checked', actorId: a.user.id, subjectId: ev.id, action: 'check_access',
            ip: ipOf(req), detail: { projectId: pid, bulk: true, status: out.check.status, httpStatus: out.check.httpStatus } });
        }
        await store.count('access_checks_bulk');
        const counts = results.reduce((acc, r) => { acc[r.check.status] = (acc[r.check.status] || 0) + 1; return acc; }, {});
        return json(res, 200, {
          ok: true, checked: results.length, counts, results,
          skipped: { withoutUrl, remainingInProject: Math.max(0, all.filter((e) => e.canonicalUrl || e.originalUrl).length - results.length) },
          note: 'verificação de estado, não de conteúdo: o resultado não altera o estado de validação de nenhuma prova'
        });
      }

      /* ---------- alegações e conclusões ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/claims$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const claims = store.claimsOf(pid).map((c) => {
          const evs = store.evidenceOf(pid).filter((e) => (c.evidenceIds || []).includes(e.id));
          return Object.assign({}, c, { factors: corroboration(evs), suggested: suggestedState(evs) });
        });
        return json(res, 200, { ok: true, claims });
      }
      if (p.match(/^\/api\/projects\/[^/]+\/claims$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const body = await readBody(req);
        const text = String(body.text || '').trim();
        if (text.length < 8) return err(res, 400, 'a alegação precisa de texto (mínimo 8 caracteres)');
        const kind = ['facto', 'alegacao', 'hipotese', 'inferencia'].includes(body.kind) ? body.kind : 'facto';
        const state = STATES.includes(body.state) ? body.state : 'hipotese';
        if (!['hipotese', 'insuficiente', 'alegacao-atribuida'].includes(state)) {
          return err(res, 409, 'uma alegação nova começa como hipótese/insuficiente/alegação atribuída; o estado forte é atribuído depois de reunir provas e é validado pelo servidor');
        }
        /* provas indicadas na criação são ligadas aqui: antes eram descartadas em
           silêncio, o que fazia a conclusão nascer «sem prova» sem aviso */
        const evidenceIds = Array.isArray(body.evidenceIds) ? body.evidenceIds.slice(0, 30).map(String) : [];
        if (evidenceIds.length) {
          const byId = new Map(store.evidenceOf(pid).map((e) => [e.id, e]));
          const bad = evidenceIds.filter((id) => { const e = byId.get(id); return !e || e.retractedAt; });
          if (bad.length) return err(res, 400, 'provas inexistentes ou retiradas neste projecto: ' + bad.join(', '));
        }
        const claim = await store.createClaim(pid, {
          text: text.slice(0, 2000), kind, state,
          confidence: ['baixa', 'media', 'alta'].includes(body.confidence) ? body.confidence : null,
          reasoning: String(body.reasoning || '').slice(0, 4000), createdBy: a.user.id,
          evidenceIds: [...new Set(evidenceIds)]
        });
        await store.audit({ type: 'claim_created', actorId: a.user.id, subjectId: claim.id, action: 'create_claim',
          detail: { projectId: pid, kind, state } });
        return json(res, 201, { ok: true, claim });
      }
      if (p.match(/^\/api\/claims\/[^/]+$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const c = claimFor(a, p.split('/')[3]);
        if (!c) return err(res, 404, 'alegação não encontrada');
        const evs = store.evidenceOf(c.projectId).filter((e) => (c.evidenceIds || []).includes(e.id));
        return json(res, 200, { ok: true, claim: c, evidence: evs, factors: corroboration(evs), suggested: suggestedState(evs) });
      }
      if (p.match(/^\/api\/claims\/[^/]+$/) && method === 'PATCH') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const c = claimFor(a, p.split('/')[3]);
        if (!c) return err(res, 404, 'alegação não encontrada');
        const body = await readBody(req);
        const evs = store.evidenceOf(c.projectId).filter((e) => (c.evidenceIds || []).includes(e.id));
        const patch = {};
        if (body.evidenceId !== undefined) {
          const ev = evidenceFor(a, body.evidenceId);
          if (!ev || ev.projectId !== c.projectId) return err(res, 404, 'prova não encontrada neste projecto');
          const on = body.link !== false;
          const linked = await store.linkEvidence(c.id, ev.id, on);
          await store.audit({ type: 'claim_evidence_link', actorId: a.user.id, subjectId: c.id, action: on ? 'link' : 'unlink',
            detail: { evidenceId: ev.id } });
          const evs2 = store.evidenceOf(c.projectId).filter((e) => (linked.evidenceIds || []).includes(e.id));
          return json(res, 200, { ok: true, claim: linked, factors: corroboration(evs2), suggested: suggestedState(evs2) });
        }
        if (body.state !== undefined) {
          if (!STATES.includes(body.state)) return err(res, 400, 'estado inválido', { allowed: STATES, labels: STATE_LABEL });
          const verdict = evaluate(body.state, evs);
          /* O servidor recusa estados que as provas não sustentam. A interface pode
             pedir, mas não pode declarar «confirmada» o que está por provar. */
          if (!verdict.ok) {
            return err(res, 409, 'estado recusado: as provas não sustentam «' + body.state + '»', {
              reasons: verdict.reasons, factors: verdict.factors, suggested: suggestedState(evs)
            });
          }
          patch.state = body.state;
        }
        if (body.confidence !== undefined) patch.confidence = ['baixa', 'media', 'alta', null].includes(body.confidence) ? body.confidence : c.confidence;
        if (body.reasoning !== undefined) patch.reasoning = String(body.reasoning).slice(0, 4000);
        if (body.text !== undefined) patch.text = String(body.text).slice(0, 2000);
        if (!Object.keys(patch).length) return err(res, 400, 'nada para actualizar');
        const updated = await store.updateClaim(c.id, patch, a.user.id, body.state ? 'estado alterado' : 'actualizada');
        await store.audit({ type: 'claim_updated', actorId: a.user.id, subjectId: c.id, action: 'update_claim',
          detail: { from: c.history[c.history.length - 1].from, to: updated.state, fields: Object.keys(patch) } });
        return json(res, 200, { ok: true, claim: updated, factors: corroboration(evs), suggested: suggestedState(evs) });
      }

      /* ---------- agentes ---------- */
      if (p === '/api/agents' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        return json(res, 200, {
          ok: true, promptVersion: AGENT_PROMPT_VERSION,
          agents: AGENTS.map((ag) => ({ id: ag.id, name: ag.name, phase: ag.phase, kind: ag.kind,
            contract: ag.contract, criteria: ag.criteria, limits: ag.limits })),
          note: 'nenhum agente escreve conclusões: os agentes locais só analisam, os de IA devolvem propostas'
        });
      }
      if (p.match(/^\/api\/projects\/[^/]+\/agent-runs$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const quotas = {};
        AGENTS.forEach((ag) => { quotas[ag.id] = quotaState({ runs: store.data.agentRuns || [], userId: a.user.id, projectId: pid, agentId: ag.id }); });
        return json(res, 200, { ok: true, runs: store.agentRunsOf(pid), agents: AGENTS.map((ag) => ag.id), quotas, quotaRules: QUOTAS });
      }
      if (p.match(/^\/api\/projects\/[^/]+\/agents\/[^/]+\/run$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const parts = p.split('/');
        const pid = parts[3], agentId = parts[5];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        if (!agentById(agentId)) return err(res, 404, 'agente desconhecido', { known: AGENTS.map((x) => x.id) });
        const ctx = {
          project: prj, evidence: store.evidenceOf(pid), claims: store.claimsOf(pid),
          relations: store.relationsOf(pid), runs: store.runsOf(pid)
        };
        const quota = quotaState({ runs: store.data.agentRuns || [], userId: a.user.id, projectId: pid, agentId });
        if (!quota.allowed) {
          await store.audit({ type: 'agent_run_blocked', actorId: a.user.id, subjectId: agentId, action: 'run_agent',
            detail: { projectId: pid, reason: quota.reason, used: quota.used } });
          return err(res, 429, quota.reason, { quota });
        }
        const ai = agentAiRunner(a.user);
        const out = await executeAgent({ store }, agentId, ctx, { ai });
        const saved = await store.addAgentRun(pid, out.run, a.user.id);
        await store.audit({
          type: 'agent_run', actorId: a.user.id, subjectId: saved.id, action: agentId,
          detail: { projectId: pid, status: saved.status, kind: saved.kind,
            findings: saved.findings ? saved.findings.length : null, reason: saved.reason || null }
        });
        await store.count('agent_runs');
        const quotaAfter = quotaState({ runs: store.data.agentRuns || [], userId: a.user.id, projectId: pid, agentId });
        return json(res, 201, { ok: true, run: saved, aiUsed: !!ai, quota: quotaAfter });
      }

      /* ---------- grafo a partir de provas ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/graph$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        const w = windowFrom(url);
        if (!w.ok) return err(res, 400, 'filtro temporal inválido: ' + w.error);
        const g = projectGraph(prj, pid, w.window);
        return json(res, 200, {
          ok: true, graph: g,
          entityTypes: ENTITY_TYPES, relationTypes: RELATION_TYPES,
          contradicoes: contradicoesOf(pid, g),
          caminho: (url.searchParams.get('from') && url.searchParams.get('to'))
            ? (() => {
              const po = pathOptions(url);
              if (!po.ok) return { found: false, reason: 'restrições de caminho inválidas: ' + po.error };
              return shortestPath(g, url.searchParams.get('from'), url.searchParams.get('to'), po.opts);
            })() : null,
          timeline: timelineOf(store, pid, w.window),
          filter: g.filter,
          access: { method: ACCESS_METHOD, maxRedirects: MAX_REDIRECTS, states: ACCESS_STATE_LABEL }
        });
      }

      /* ---------- exportação do grafo (JSON / SVG / DOT) ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/graph\/export$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        const format = String(url.searchParams.get('format') || 'json').toLowerCase();
        if (!['json', 'svg', 'dot'].includes(format)) return err(res, 400, 'formato inválido', { allowed: ['json', 'svg', 'dot'] });
        const w = windowFrom(url);
        if (!w.ok) return err(res, 400, 'filtro temporal inválido: ' + w.error);
        const g = projectGraph(prj, pid, w.window);
        const base = 'conspiracy-tracker-' + String(prj.id).replace(/[^a-zA-Z0-9-_]/g, '') + '-grafo' +
          (w.window.applied ? '-' + (w.window.from || 'inicio') + '_' + (w.window.to || 'fim') : '');
        let body, type, filename;
        if (format === 'svg') { body = graphToSvg(g, { width: 1100, height: 720 }); type = 'image/svg+xml; charset=utf-8'; filename = base + '.svg'; }
        else if (format === 'dot') { body = graphToDot(g); type = 'text/vnd.graphviz; charset=utf-8'; filename = base + '.dot'; }
        else {
          body = JSON.stringify(graphExportPayload(g, { format: 'json', generatedBy: a.user.id }), null, 2);
          type = 'application/json; charset=utf-8'; filename = base + '.json';
        }
        await store.audit({
          type: 'graph_exported', actorId: a.user.id, subjectId: pid, action: 'export_graph',
          detail: { projectId: pid, format, nodes: g.stats.nodes, edges: g.stats.edges,
            from: w.window.from, to: w.window.to, bytes: Buffer.byteLength(body) }
        });
        await store.count('graph_exports');
        return jsonOrFile(res, 200, body, type, filename);
      }

      if (p.match(/^\/api\/projects\/[^/]+\/relations$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        const body = await readBody(req);
        const byId = new Map(store.evidenceOf(pid).map((e) => [e.id, e]));
        const v = validateRelation(body, (id) => {
          const e = byId.get(id);
          return e && !e.retractedAt ? e : null;
        });
        if (!v.ok) return err(res, 400, 'relação recusada: ' + v.errors.join('; '), { errors: v.errors });
        const rel = await store.addRelation(pid, v.relation, a.user.id);
        await store.audit({
          type: 'relation_created', actorId: a.user.id, subjectId: rel.id,
          action: 'create_relation', detail: { projectId: pid, type: rel.type, inferred: rel.inferred, evidence: rel.evidenceIds.length }
        });
        await store.count('relations_created');
        return json(res, 201, { ok: true, relation: rel });
      }
      if (p.match(/^\/api\/relations\/[^/]+$/) && (method === 'PATCH' || method === 'DELETE')) {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const rid = p.split('/')[3];
        const rel = store.relationById(rid);
        if (!rel || !projectFor(a, rel.projectId)) return err(res, 404, 'relação não encontrada');
        const body = await readBody(req);
        if (method === 'DELETE') {
          const reason = String(body.reason || '').trim();
          if (reason.length < 5) return err(res, 400, 'retirar uma relação exige motivo escrito (mínimo 5 caracteres)');
          const out = await store.retractRelation(rid, reason, a.user.id);
          await store.audit({ type: 'relation_retracted', actorId: a.user.id, subjectId: rid, action: 'retract_relation', reason });
          return json(res, 200, { ok: true, relation: out, note: 'retirada, não apagada: o histórico mantém-se' });
        }
        const patch = {};
        if (body.period !== undefined) patch.period = { from: body.period.from || null, to: body.period.to || null };
        if (body.validationState !== undefined) patch.validationState = String(body.validationState).slice(0, 40);
        if (body.limitations !== undefined) patch.limitations = String(body.limitations).slice(0, 1000);
        if (body.reasoning !== undefined) { patch.reasoning = String(body.reasoning).slice(0, 2000); patch.inferred = true; }
        if (body.evidenceIds !== undefined) {
          const byId = new Map(store.evidenceOf(rel.projectId).map((e) => [e.id, e]));
          const ids = (Array.isArray(body.evidenceIds) ? body.evidenceIds : []).map(String);
          const missing = ids.filter((id) => !byId.get(id) || byId.get(id).retractedAt);
          if (!ids.length) return err(res, 400, 'uma relação não pode ficar sem prova: indique pelo menos um evidenceId');
          if (missing.length) return err(res, 400, 'prova inexistente ou retirada: ' + missing.join(', '));
          patch.evidenceIds = ids.slice(0, 50);
        }
        if (!Object.keys(patch).length) return err(res, 400, 'nada para actualizar');
        const out = await store.updateRelation(rid, patch, a.user.id);
        await store.audit({ type: 'relation_updated', actorId: a.user.id, subjectId: rid, action: 'update_relation', detail: { fields: Object.keys(patch) } });
        return json(res, 200, { ok: true, relation: out });
      }

      /* ---------- motor de pesquisa: execuções ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/runs$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        if (!projectFor(a, pid)) return err(res, 404, 'projecto não encontrado');
        return json(res, 200, { ok: true, runs: store.runsOf(pid), profiles: Object.keys(PROFILES), steps: STEPS.map((s) => ({ n: s.n, id: s.id, title: s.title, kind: s.kind })) });
      }
      if (p.match(/^\/api\/projects\/[^/]+\/runs$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const pid = p.split('/')[3];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        const body = await readBody(req);
        const profile = PROFILES[body.profile] ? body.profile : 'normal';
        const urls = (Array.isArray(body.urls) ? body.urls : []).slice(0, 25)
          .map((u) => String(u).trim()).filter((u) => /^https?:\/\//i.test(u));
        const run = await store.createRun(pid, {
          profile, userId: a.user.id, status: 'running',
          candidates: { urls }, budget: profileOf(profile),
          aiAvailable: !!aiRunner(a.user), vaultReady: vault.enabled
        });
        const ai = aiRunner(a.user);
        const out = await runResearch({ store, ai, fetchDoc }, run.id, { ai });
        await store.audit({
          type: 'research_run', actorId: a.user.id, subjectId: run.id, action: 'run',
          detail: { projectId: pid, profile, status: out.run && out.run.status, stopReason: out.run && out.run.stopReason, urls: urls.length }
        });
        await store.count('research_runs');
        return json(res, 201, { ok: true, run: out.run, aiUsed: !!ai, vaultReady: vault.enabled });
      }
      if (p.match(/^\/api\/runs\/[^/]+$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const rid = p.split('/')[3];
        const run = store.runById(rid);
        if (!run || !projectFor(a, run.projectId)) return err(res, 404, 'execução não encontrada');
        return json(res, 200, { ok: true, run });
      }
      if (p.match(/^\/api\/runs\/[^/]+\/(resume|cancel)$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const parts = p.split('/');
        const rid = parts[3], action = parts[4];
        const run = store.runById(rid);
        if (!run || !projectFor(a, run.projectId)) return err(res, 404, 'execução não encontrada');
        if (action === 'cancel') {
          if (!['pending', 'running'].includes(run.status)) return err(res, 409, 'execução já terminada (' + run.status + '): não há nada para cancelar');
          const updated = await store.updateRun(rid, { status: 'cancelled', stopReason: 'cancelado-pelo-utilizador', finishedAt: new Date().toISOString() });
          await store.audit({ type: 'research_run', actorId: a.user.id, subjectId: rid, action: 'cancel', detail: { status: updated.status } });
          return json(res, 200, { ok: true, run: updated });
        }
        if (run.status === 'aguarda-revisao-humana') return err(res, 409, 'execução já concluída: nada para retomar');
        if (run.status === 'cancelled') return err(res, 409, 'execução cancelada: crie uma nova');
        await store.updateRun(rid, { status: 'running' });
        const ai = aiRunner(a.user);
        const out = await runResearch({ store, ai, fetchDoc }, rid, { ai });
        await store.audit({ type: 'research_run', actorId: a.user.id, subjectId: rid, action: 'resume', detail: { status: out.run && out.run.status } });
        return json(res, 200, { ok: true, run: out.run });
      }

      /* ---------- relatório de 18 secções ---------- */
      if (p.match(/^\/api\/projects\/[^/]+\/report$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const pid = p.split('/')[3];
        const prj = projectFor(a, pid);
        if (!prj) return err(res, 404, 'projecto não encontrado');
        const rep = buildReport({
          project: prj, evidence: store.evidenceOf(pid), claims: store.claimsOf(pid),
          runs: store.runsOf(pid), relations: store.relationsOf(pid),
          usage: store.data.usage.filter((u) => u.userId === a.user.id)
        });
        if (String(url.searchParams.get('format') || 'json') === 'md') {
          const md = reportToMarkdown(rep);
          res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' });
          return res.end(md);
        }
        return json(res, 200, Object.assign({ ok: true }, rep, { sectionTitles: SECTION_TITLES }));
      }

      /* ---------- Provider OS: catálogo, testes e ranking (fase 2/3) ---------- */
      if (p === '/api/provider-os/meta' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        return json(res, 200, {
          ok: true,
          accessClasses: Object.entries(ACCESS_CLASSES).map(([id, d]) => ({ id, description: d })),
          states: Object.entries(PROVIDER_STATES).map(([id, d]) => ({ id, description: d })),
          evidenceStatus: Object.entries(EVIDENCE_STATUS).map(([id, d]) => ({ id, description: d })),
          kinds: Object.entries(KINDS).map(([id, d]) => ({ id, description: d })),
          categories: Object.entries(CATEGORY).map(([id, d]) => ({ id, description: d })),
          discoveryAdapters: Object.values(DISCOVERY_ADAPTERS).map((d) => ({ key: d.key, label: d.label, url: d.url, needsKey: d.needsKey, what: d.what })),
          taskTypes: Object.entries(TASK_TYPES).map(([id, t]) => ({ id, label: t.label, weights: t.weights })),
          discoveryCategories: Object.entries(DISCOVERY_CATEGORY_LABELS).map(([id, label]) => ({ id, label })),
          accessDetailFields: Object.entries(ACCESS_DETAIL_FIELDS).map(([id, label]) => ({ id, label })),
          exclusions: EXCLUSION_RULES.map((r) => ({ id: r.id, reason: r.reason })),
          catalogueSize: store.catalogEntries().length,
          note: 'só entra no catálogo o que tem evidência com URL e estado; DECLARED é o que o fornecedor afirma, MEASURED é o que esta aplicação mediu'
        });
      }

      if (p === '/api/provider-os/catalog' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const url = new URL(req.url, 'http://x');
        const kind = url.searchParams.get('kind');
        const cls = url.searchParams.get('access');
        const q = String(url.searchParams.get('q') || '').toLowerCase();
        const cat = url.searchParams.get('category');
        const semCampo = url.searchParams.get('missing');
        if (semCampo && !ACCESS_DETAIL_FIELDS[semCampo]) {
          /* um filtro inválido não devolve zero em silêncio: isso faria crer que
             ninguém tem o campo em falta */
          return err(res, 400, 'campo de acesso desconhecido: «' + semCampo + '»', { known: Object.keys(ACCESS_DETAIL_FIELDS) });
        }
        let list = store.catalogEntries();
        if (kind) list = list.filter((e) => e.kind === kind);
        if (cls) list = list.filter((e) => e.access && e.access.class === cls);
        if (cat) list = list.filter((e) => categoryOf(e) === cat.toUpperCase());
        if (semCampo) list = list.filter((e) => accessDetailCoverage(e).unknown.includes(semCampo));
        if (q) list = list.filter((e) => (e.name + ' ' + e.key).toLowerCase().includes(q));
        return json(res, 200, {
          ok: true, total: list.length, category: cat || null,
          entries: list.slice(0, 200).map((e) => Object.assign(publicEntry(e), { discoveryCategory: categoryOf(e) })),
          note: list.length > 200 ? 'mostradas 200 de ' + list.length + ': use ?q= para procurar' : null
        });
      }

      if (p === '/api/provider-os/seed' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        let created = 0, updated = 0, invalid = [];
        for (const e of SEED) {
          const v = validateEntry(e);
          if (!v.ok) { invalid.push({ key: e.key, errors: v.errors.map((x) => x.msg) }); continue; }
          const r = await store.upsertCatalogEntry(Object.assign({}, e, { state: e.state || (e.evidence.some((x) => x.status === 'MEASURED') ? 'DOCUMENTED' : 'DISCOVERED') }), a.user.id);
          if (r.created) created++; else updated++;
        }
        await store.audit({ type: 'catalog_seeded', actorId: a.user.id, action: 'seed', detail: { created, updated, invalid: invalid.length } });
        return json(res, 200, { ok: true, created, updated, invalid, note: 'a semente não afirma gratuitidade: cada linha traz a evidência que a sustenta' });
      }

      if (p === '/api/provider-os/discover' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        if (!providerDiscoveryLimiter.allowed(a.user.id)) return err(res, 429, 'descobertas demasiado frequentes (10/hora): o catálogo externo não é nosso');
        const body = await readBody(req);
        const adapterId = String(body.adapter || '').trim();
        const meta = DISCOVERY_ADAPTERS[adapterId];
        const impl = DISCOVERY_IMPL[adapterId];
        if (!meta || !impl) return err(res, 400, 'adaptador de descoberta desconhecido', { known: Object.keys(DISCOVERY_IMPL) });
        if (meta.needsKey) return err(res, 501, 'este adaptador exige chave e ainda não está implementado');
        /* `sort=stars` numa consulta com dois tópicos faz o GitHub devolver
           total_count 0 (medido em 2026-10-22: sem sort → 177 resultados;
           com sort=stars → 0, HTTP 200). A ordenação é feita aqui, sobre os
           itens recebidos, em vez de confiar num parâmetro que esvazia a
           resposta em silêncio. */
        const query = adapterId === 'github_coding_agents'
          ? '?q=topic:coding-agent+topic:coding-assistant&per_page=' + Math.min(100, Math.max(10, Number(body.pageSize) || 40))
          : '';
        const url = adapterId === 'github_coding_agents' ? meta.url + query : meta.url;
        const t0 = Date.now();
        let payload = null, httpStatus = null, failure = null;
        try {
          const res2 = await fetch(url, {
            headers: { 'user-agent': 'ConspiracyTracker/2 (descoberta de fornecedores; ver docs/PROVIDER-OS.md)',
              accept: adapterId === 'github_coding_agents' ? 'application/vnd.github+json' : 'application/json' },
            signal: AbortSignal.timeout(30000)
          });
          httpStatus = res2.status;
          if (!res2.ok) failure = 'HTTP ' + res2.status + ' na consulta ao catálogo' +
            (res2.status === 403 || res2.status === 429 ? ' (limite de utilização da API pública)' : '');
          else {
            /* tecto de leitura: 12 MB. Um catálogo externo não pode encher a memória. */
            const buf = await res2.arrayBuffer();
            if (buf.byteLength > impl.maxBytes) failure = 'resposta de ' + Math.round(buf.byteLength / 1e6) + ' MB excede o limite de ' + Math.round(impl.maxBytes / 1e6) + ' MB';
            else payload = JSON.parse(Buffer.from(buf).toString('utf8'));
          }
        } catch (e) {
          failure = e.name === 'TimeoutError' ? 'timeout de 30 s' : String(e.message || e).slice(0, 200);
        }
        const ms = Date.now() - t0;
        if (failure) {
          await store.audit({ type: 'provider_discovery_failed', actorId: a.user.id, action: 'discover',
            detail: { adapter: adapterId, failure, ms, url } });
          return json(res, 502, { ok: false, adapter: adapterId, httpStatus, failure, ms, url,
            note: 'nada foi gravado: uma falha de rede não cria candidatos' });
        }
        const out = impl.parse(payload, { at: new Date().toISOString(), url });
        if (adapterId === 'github_coding_agents') {
          /* ordem por estrelas calculada localmente (ver nota acima); o campo
             usado é o que veio da resposta, nunca um valor estimado */
          out.entries.sort((a, b) => ((b.repo && Number(b.repo.stars)) || 0) - ((a.repo && Number(a.repo.stars)) || 0));
        }
        /* catálogo externo pode trazer milhares: entra um lote por execução e o
           que ficou de fora é dito, não escondido */
        const LIMIT = Math.min(200, Math.max(1, Number(body.limit) || 120));
        const considered = out.entries.slice(0, LIMIT);
        let created = 0, updated = 0, rejected = 0;
        const rejects = [];
        for (const e of considered) {
          const v = validateEntry(e);
          const vd = validateAccessDetails(e);
          if (!v.ok || !vd.ok) { rejected++; if (rejects.length < 5) rejects.push({ key: e.key, errors: v.errors.concat(vd.errors).map((x) => x.msg) }); continue; }
          /* descoberta não apaga medição: funde-se com o que já existe */
          const existente = store.catalogEntry(e.key);
          const final = mergeDiscovered(existente, Object.assign({}, e, { state: existente ? existente.state : 'DISCOVERED' }));
          const r = await store.upsertCatalogEntry(final, a.user.id);
          if (r.created) created++; else updated++;
        }
        providerDiscoveryLimiter.hit(a.user.id);
        const porCategoria = {};
        for (const e of considered) { const c = categoryOf(e); porCategoria[c] = (porCategoria[c] || 0) + 1; }
        await store.audit({ type: 'provider_discovered', actorId: a.user.id, action: 'discover',
          detail: { adapter: adapterId, total: out.total, created, updated, rejected, ms, url, categories: porCategoria } });
        /* Uma fonte que responde 200 com zero registos NÃO é um resultado: é
           uma resposta vazia. Fica dita como tal para que ninguém leia «0
           criadas» como «não há nada lá» — e para que um teste de rede possa
           ser declarado SKIP em vez de falha do nosso código. */
        const sourcesEmpty = out.entries.length === 0;
        return json(res, 200, {
          ok: true, adapter: adapterId, url, httpStatus, ms, sourcesEmpty,
          total: out.total, considered: considered.length, truncated: Math.max(0, out.entries.length - considered.length),
          created, updated, rejected, rejects,
          categories: porCategoria, feeds: meta.categories,
          extra: out.modelsTotal != null ? { modelsTotal: out.modelsTotal, providersWithPrice: out.providersWithPrice, providersWithLimit: out.providersWithLimit }
            : (out.archived != null ? { archivedRepos: out.archived, query: out.query } : null),
          freeCount: out.freeCount == null ? null : out.freeCount,
          sample: out.entries.slice(0, 5).map((e) => ({ key: e.key, access: e.access.class, category: categoryOf(e),
            known: accessDetailCoverage(e).known + '/' + accessDetailCoverage(e).total, maintenance: e.maintenanceSignal || null })),
          note: sourcesEmpty
            ? 'a fonte respondeu HTTP ' + httpStatus + ' com zero registos para esta consulta: nada foi gravado e isto não conta como evidência de que o catálogo esteja vazio (pode ser índice externo, limite de utilização ou consulta sem correspondência)'
            : 'os candidatos entram como DISCOVERED: nada disto prova que o serviço funcione, e o que a fonte não publica fica UNKNOWN'
        });
      }

      /* Categorias A–E e cobertura dos 9 campos de acesso — o mapa do que falta. */
      if (p === '/api/provider-os/discovery/categories' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const entries = store.catalogEntries();
        const resumo = categorySummary(entries);
        const campos = {};
        for (const f of Object.keys(ACCESS_DETAIL_FIELDS)) {
          campos[f] = { label: ACCESS_DETAIL_FIELDS[f], measured: 0, declared: 0, unknown: 0 };
        }
        for (const e of entries) {
          for (const f of Object.keys(ACCESS_DETAIL_FIELDS)) {
            const d = (e.accessDetails || {})[f];
            if (!d || d.status === 'UNKNOWN' || d.value == null) campos[f].unknown++;
            else if (d.status === 'MEASURED') campos[f].measured++;
            else campos[f].declared++;
          }
        }
        const runs = store.auditList({ type: 'provider_discovered', limit: 200 });
        const ultimoPor = {};
        for (const r of runs) { const ad = r.detail && r.detail.adapter; if (ad && !ultimoPor[ad]) ultimoPor[ad] = { at: r.at, ...r.detail }; }
        return json(res, 200, Object.assign({}, resumo, {
          adapters: Object.values(DISCOVERY_IMPL).map((x) => {
            const m = DISCOVERY_ADAPTERS[x.key] || {};
            return { key: x.key, label: m.label, url: m.url, feeds: x.categories, needsKey: !!m.needsKey, lastRun: ultimoPor[x.key] || null };
          }),
          fields: campos,
          note: 'cada campo conta só o que tem prova: valor sem fonte não entra (é recusado na validação)'
        }));
      }

      if (p === '/api/provider-os/test' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        const entry = store.catalogEntry(String(body.key || ''));
        if (!entry) return err(res, 404, 'entrada de catálogo não encontrada: carregue a semente primeiro');

        /* O fornecedor do adaptador (ex.: «providers/groq» → groq) é a chave da
           credencial no cofre. Sem credencial, os níveis 3–6 ficam BLOCKED — não
           se pede a chave ao cliente nem se inventa uma. */
        const providerId = String(entry.key).startsWith('providers/') ? String(entry.key).slice('providers/'.length) : null;
        const cred = providerId ? store.credentialFor(a.user.id, providerId) : null;
        let apiKey = null;
        if (cred && vault.enabled) { try { apiKey = vault.open(cred.keyCipher); } catch { apiKey = null; } }
        const model = String(body.model || (cred && cred.model) || '').slice(0, 120) || null;

        const levels = (Array.isArray(body.levels) ? body.levels : [1, 2, 3])
          .map(Number).filter((n) => TEST_LEVELS[n]).slice(0, 6);
        if (!levels.length) return err(res, 400, 'nenhum nível válido pedido', { valid: Object.keys(TEST_LEVELS) });

        /* testes com geração gastam dinheiro do utilizador: exigem confirmação explícita */
        const pedeGeracao = levels.some((n) => n >= 4);
        if (pedeGeracao && body.confirmCost !== true) {
          return err(res, 400, 'os níveis 4–6 fazem pedidos pagos com a sua chave: confirme com confirmCost=true', { levels, model });
        }
        const t0 = Date.now();
        const { out, gravados } = await executarTestes(entry, {
          userId: a.user.id, apiKey, model, levels, samples: body.samples,
          maxRequests: Math.min(20, Math.max(1, Number(body.maxRequests) || (pedeGeracao ? 10 : 4))),
          allowInsecure: process.env.VN_TEST_PROVIDERS === '1'
        });
        const pass = (n) => out.results[n] && out.results[n].result === 'PASS';
        await promoverEstado(entry, out, 'teste nível ' + Object.keys(out.results).join(','), a.user.id);
        await store.audit({ type: 'provider_tested', actorId: a.user.id, subjectId: entry.key, action: 'provider_test',
          detail: { levels, results: gravados.map((g) => g.level + ':' + g.result), requests: out.requestsUsed, ms: Date.now() - t0, hadKey: !!apiKey } });
        await store.addUsage({ userId: a.user.id, provider: providerId || entry.vendor || 'desconhecido', model, kind: 'provider_test',
          ok: pass(4) || pass(3) || pass(1), promptTokens: out.metrics.tokens ? out.metrics.tokens.prompt : null,
          completionTokens: out.metrics.tokens ? out.metrics.tokens.completion : null, cost: null, latencyMs: out.metrics.latencyP50Ms });
        return json(res, 200, {
          ok: true, key: entry.key, state: (store.catalogEntry(entry.key) || {}).state,
          hadKey: !!apiKey, model, levels, requestsUsed: out.requestsUsed, budget: out.budget, ms: Date.now() - t0,
          results: out.results, metrics: out.metrics, stored: gravados,
          note: pedeGeracao && !apiKey ? 'os níveis 4–6 ficaram BLOCKED por falta de chave: guarde uma chave própria em «Chaves de IA»' :
            'resultados gravados em providerTests; a chave nunca é guardada no resultado'
        });
      }

      if (p === '/api/provider-os/tests' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const url2 = new URL(req.url, 'http://x');
        const key = url2.searchParams.get('key');
        const list = key ? store.providerTestsOf(key) : store.data.providerTests.slice(-200);
        return json(res, 200, {
          ok: true, total: list.length,
          results: list.slice(-100).map((t) => ({ id: t.id, key: t.key, level: t.level, levelId: t.levelId, result: t.result,
            reason: t.reason, detail: t.detail, diagnosis: t.diagnosis, httpStatus: t.httpStatus,
            latencyMs: t.latencyMs, at: t.at, samples: t.samples, successRate: t.successRate,
            capabilities: t.capabilities || null, synthetic: !!t.synthetic })),
          note: 'histórico imutável: um teste antigo não é substituído por um novo'
        });
      }

      if (p === '/api/provider-os/ranking' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const url = new URL(req.url, 'http://x');
        const task = url.searchParams.get('task') || 'conversa';
        if (!TASK_TYPES[task]) return err(res, 400, 'tipo de tarefa desconhecido', { known: Object.keys(TASK_TYPES) });
        const rows = store.catalogEntries().map((e) => {
          const cand = candidateOf(e, a.user.id);
          return Object.assign({ key: cand.key, name: cand.name, kind: cand.kind, state: cand.state, tests: cand.evidence.tests },
            scoreCandidate(cand, task));
        }).sort((x, y) => (y.score == null ? -1 : y.score) - (x.score == null ? -1 : x.score));
        const ranking = await store.addProviderRanking({ task, rows: rows.length, computed: rows.filter((r) => r.score != null).length });
        return json(res, 200, {
          ok: true, task, taskLabel: TASK_TYPES[task].label, rankingId: ranking.id,
          computed: rows.filter((r) => r.score != null).length, total: rows.length,
          rows,
          note: 'a nota usa apenas métricas medidas; sem testes de geração todos aparecem com «Classificação provisória — evidência insuficiente». Não há média que esconda falta de prova.'
        });
      }

      /* ---------- selector automático (fase 4) ---------- */
      if (p === '/api/provider-os/selector/meta' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        return json(res, 200, {
          ok: true, steps: SELECTION_STEPS, defaults: FALLBACK_DEFAULTS, taskTypes: Object.keys(TASK_TYPES),
          constraints: ['dataSensitive', 'region', 'localOnly', 'pinnedKey', 'pinnedModel', 'maxCostUsd', 'maxLatencyMs', 'requireCapabilities'],
          note: 'os 13 passos são a ordem em que a decisão é tomada: cada um pode eliminar, e a eliminação fica registada com motivo'
        });
      }

      if (p === '/api/provider-os/select' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        const cands = (Array.isArray(body.candidates) && body.candidates.length)
          ? body.candidates                                     // candidatos explícitos (avaliação/simulação)
          : store.catalogEntries().map((e) => candidateOf(e, a.user.id));
        if (!cands.length) return err(res, 409, 'catálogo vazio: carregue a semente e teste pelo menos um fornecedor');
        const out = selectProvider({ task: body.task, constraints: body.constraints || {}, candidates: cands });
        const rec = await store.addSelectionDecision({
          userId: a.user.id, task: out.task, chosenKey: out.chosen ? out.chosen.key : null,
          chosenModel: out.chosen ? out.chosen.model : null, score: out.chosen ? out.chosen.score : null,
          alternatives: out.alternatives.map((x) => ({ key: x.key, score: x.score, whyNot: x.whyNot })),
          rejected: out.rejected, constraints: body.constraints || {},
          why: out.justification, noChoiceReason: out.noChoiceReason || null,
          whatWouldChangeIt: out.whatWouldChangeIt, confidence: out.confidence,
          candidatesEvaluated: cands.length
        });
        await store.audit({ type: 'provider_selected', actorId: a.user.id, subjectId: out.chosen ? out.chosen.key : null,
          action: 'select', detail: { task: out.task, chosen: out.chosen ? out.chosen.key : null, evaluated: cands.length,
            rejected: out.rejected.length, decisionId: rec.id } });
        return json(res, 200, Object.assign({}, out, { decisionId: rec.id, candidatesEvaluated: cands.length,
          note: out.chosen ? 'a decisão fica registada com alternativa e prazo de reavaliação' : 'não se escolhe por falta de prova: ' + out.noChoiceReason }));
      }

      if (p === '/api/provider-os/decisions' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const list = store.selectionDecisionsOf(a.user.id);
        return json(res, 200, {
          ok: true, total: list.length,
          decisions: list.slice(-50).reverse().map((d) => ({ id: d.id, at: d.at, task: d.task, chosenKey: d.chosenKey,
            chosenModel: d.chosenModel, score: d.score, confidence: d.confidence, alternatives: d.alternatives,
            rejected: (d.rejected || []).length, noChoiceReason: d.noChoiceReason, why: d.why })),
          note: 'histórico imutável: uma decisão antiga não é reescrita quando o ranking muda'
        });
      }

      /* Plano de fallback: calculado, nunca executado por esta rota. Não faz
         pedidos e não gasta nada — é o que permite mostrar o custo da política
         antes de a autorizar. */
      if (p === '/api/provider-os/fallback/plan' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        let order = Array.isArray(body.order) ? body.order.map(String) : null;
        if (!order) {
          const sel = selectProvider({
            task: body.task,
            constraints: body.constraints || {},
            candidates: store.catalogEntries().map((e) => candidateOf(e, a.user.id))
          });
          order = sel.chosen ? [sel.chosen.key].concat(sel.alternatives.map((x) => x.key)) : [];
        }
        const plan = planFallback({ order,
          baseMs: body.baseMs, capMs: body.capMs, jitter: body.jitter,
          maxAttemptsPerProvider: body.maxAttemptsPerProvider, maxTotalAttempts: body.maxTotalAttempts,
          budgetUsd: body.budgetUsd, seed: body.seed });
        return json(res, 200, Object.assign({ ok: plan.ok, order }, plan, {
          simulated: body.seed != null,
          note: 'planeamento puro: nenhum pedido foi feito e nenhum valor foi gasto; a execução real usa a mesma política em runWithFallback'
        }));
      }

      /* ---------- reavaliação adaptativa e saúde (fase 5) ---------- */
      const planoReavaliacao = (limit) => planReevaluation({
        entries: store.catalogEntries(),
        testsOf: (key) => store.providerTestsOf(key),
        limit: limit == null ? undefined : limit,
        now: new Date().toISOString()
      });

      if (p === '/api/provider-os/schedule' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const url = new URL(req.url, 'http://x');
        const plano = planoReavaliacao(url.searchParams.get('limit'));
        return json(res, 200, Object.assign({}, plano, {
          health: store.catalogEntries().slice(0, 40).map((e) => Object.assign({ key: e.key, name: e.name },
            healthVerdict(store.auditList({ type: 'provider_health', subjectId: e.key, limit: 50 }).map((x) => x.detail || {})))),
          note: 'o calendário é derivado do histórico imutável de testes e da idade da evidência: a mesma história dá sempre a mesma fila. Nenhum pedido foi feito.'
        }));
      }

      if (p === '/api/provider-os/schedule/run' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        if (!providerScheduleLimiter.allowed(a.user.id)) return err(res, 429, 'reavaliações demasiado frequentes (20/hora)');
        const body = await readBody(req);
        const plano = planoReavaliacao(body.limit);
        if (!plano.counts.due) {
          return json(res, 200, { ok: true, at: plano.at, executed: 0, skipped: 0, results: [],
            counts: plano.counts, dryRun: body.dryRun === true,
            note: 'nada em atraso: não se testa só para produzir números' });
        }
        if (body.dryRun === true) {
          return json(res, 200, { ok: true, at: plano.at, dryRun: true, executed: 0,
            queue: plano.queue, counts: plano.counts,
            note: 'simulação: nada foi pedido, nada foi gravado' });
        }
        /* níveis 1–2 e mais nada: a reavaliação automática NUNCA gasta a chave
           do utilizador (geração exige confirmação explícita na rota /test) */
        const run = await runReevaluation(plano, {
          maxRequests: Math.min(12, Math.max(2, plano.queue.length * 2)),
          runTest: async (key) => {
            const e = store.catalogEntry(key);
            if (!e) return { requestsUsed: 0, results: {} };
            const { out } = await executarTestes(e, { userId: a.user.id, levels: [1, 2], apiKey: null, model: null,
              maxRequests: 2, allowInsecure: false });
            await promoverEstado(e, out, 'reavaliação automática (níveis 1–2)', a.user.id);
            return out;
          }
        });
        providerScheduleLimiter.hit(a.user.id);
        await store.audit({ type: 'provider_reevaluated', actorId: a.user.id, action: 'schedule_run',
          detail: { executed: run.executed, skipped: run.skipped, keys: run.results.map((r) => r.key), requests: run.requestsUsed } });
        return json(res, 200, Object.assign({}, run, {
          at: plano.at, counts: plano.counts, dryRun: false,
          note: 'níveis 1–2 apenas (sem chave, sem custo). Cada resultado entra no histórico imutável e o próximo intervalo é recalculado a partir dele.'
        }));
      }

      if (p === '/api/provider-os/health/check' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        if (!providerScheduleLimiter.allowed(a.user.id)) return err(res, 429, 'sondas demasiado frequentes (20/hora)');
        const body = await readBody(req);
        const alvo = body.key ? store.catalogEntries().filter((e) => e.key === String(body.key)) : store.catalogEntries().slice(0, 12);
        if (!alvo.length) return err(res, 404, 'nenhuma entrada para sondar');
        const antes = { testes: store.data.providerTests.length,
          estados: store.catalogEntries().map((e) => e.key + ':' + e.state).sort().join('|') };
        const sondas = [];
        for (const e of alvo) {
          const r = await sondarSaude(e);
          await store.audit({ type: 'provider_health', actorId: a.user.id, subjectId: e.key, action: 'health_check',
            detail: { at: new Date().toISOString(), ok: r.ok === true, httpStatus: r.httpStatus == null ? null : r.httpStatus,
              latencyMs: r.latencyMs == null ? null : r.latencyMs, url: r.url || null, reason: r.reason || null } });
          sondas.push(Object.assign({ name: e.name }, r));
        }
        providerScheduleLimiter.hit(a.user.id);
        /* prova de que a sonda é só sonda: nada em providerTests, nada em estados */
        const depois = { testes: store.data.providerTests.length,
          estados: store.catalogEntries().map((x) => x.key + ':' + x.state).sort().join('|') };
        return json(res, 200, { ok: true, checked: sondas.length, probes: sondas.map((x) => ({ key: x.key, name: x.name,
            status: x.ok === true ? 'respondeu' : (x.ok === null ? 'não sondado' : 'não respondeu'),
            httpStatus: x.httpStatus == null ? null : x.httpStatus, latencyMs: x.latencyMs == null ? null : x.latencyMs, reason: x.reason || null })),
          invariants: { novosTestes: depois.testes - antes.testes, estadosAlterados: depois.estados !== antes.estados },
          note: 'HEALTH CHECK NÃO É TESTE DE QUALIDADE: esta rota não grava testes, não promove estados e não entra no ranking'
        });
      }

      /* ---------- cron de serviço (fase 7) ----------
         Um cron externo (GitHub Actions, cron-job.org) pode accionar a
         reavaliação sem sessão de utilizador, mas só com CRON_TOKEN definido
         no ambiente do servidor. Sem CRON_TOKEN a rota existe e recusa — um
         cron que «funciona» sem segredo seria um endpoint aberto. */
      if (p === '/api/provider-os/cron/run' && method === 'POST') {
        const esperado = process.env.CRON_TOKEN || '';
        if (!esperado) {
          return json(res, 503, { ok: false, configured: false,
            reason: 'CRON_TOKEN não está definido no servidor: a reavaliação agendada está desligada',
            how: 'definir a variável CRON_TOKEN no Render e usar o mesmo valor no segredo do workflow' });
        }
        const recebido = String(req.headers['x-cron-token'] || '');
        const a1 = Buffer.from(esperado), b1 = Buffer.from(recebido.padEnd(esperado.length, '\0').slice(0, esperado.length));
        const igual = a1.length === b1.length && crypto.timingSafeEqual(a1, b1) && recebido.length === esperado.length;
        if (!igual) {
          await store.audit({ type: 'cron_refused', actorId: null, action: 'cron_run', detail: { reason: 'token inválido' } });
          return err(res, 401, 'token de serviço inválido');
        }
        if (!cronLimiter.allowed('cron')) return err(res, 429, 'reavaliação agendada já correu nesta hora');
        const plano = planoReavaliacao(Number(process.env.CRON_BATCH || 6));
        if (!plano.counts.due) {
          return json(res, 200, { ok: true, cron: true, executed: 0, counts: plano.counts,
            note: 'nada em atraso: o cron não testa só para produzir números' });
        }
        const run = await runReevaluation(plano, {
          maxRequests: Math.min(12, Math.max(2, plano.queue.length * 2)),
          runTest: async (key) => {
            const e = store.catalogEntry(key);
            if (!e) return { requestsUsed: 0, results: {} };
            const { out } = await executarTestes(e, { userId: null, levels: [1, 2], apiKey: null, model: null,
              maxRequests: 2, allowInsecure: false });
            await promoverEstado(e, out, 'reavaliação agendada (cron, níveis 1–2)', null);
            return out;
          }
        });
        cronLimiter.hit('cron');
        await store.audit({ type: 'provider_reevaluated', actorId: null, action: 'cron_run',
          detail: { executed: run.executed, skipped: run.skipped, keys: run.results.map((r) => r.key), requests: run.requestsUsed, via: 'cron' } });
        return json(res, 200, Object.assign({}, run, { cron: true, at: new Date().toISOString(), counts: plano.counts,
          note: 'execução agendada: níveis 1–2 apenas, sem chave e sem custo' }));
      }

      if (p === '/api/provider-os/health' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        return json(res, 200, { ok: true,
          providers: store.catalogEntries().slice(0, 40).map((e) => Object.assign({ key: e.key, name: e.name },
            healthVerdict(store.auditList({ type: 'provider_health', subjectId: e.key, limit: 50 }).map((x) => x.detail || {})))),
          note: 'prova de vida apenas; a classificação de qualidade continua a exigir testes de níveis 4–6' });
      }

      /* ---------- benchmarks (fase 7) ---------- */
      if (p === '/api/provider-os/benchmark/suite' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        return json(res, 200, { ok: true, version: BENCHMARK_VERSION,
          tasks: Object.entries(BENCHMARK_SUITE).map(([id, t]) => ({ id, label: t.label, maxTokens: t.maxTokens,
            verifier: 'objectivo (sem juiz humano nem LLM)', hasSystemPrompt: !!t.system })),
          note: 'as mesmas perguntas para todos; cada tarefa tem um verificador determinístico' });
      }

      if (p === '/api/provider-os/benchmark' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        const entry = store.catalogEntry(String(body.key || ''));
        if (!entry) return err(res, 404, 'entrada de catálogo não encontrada');
        if (body.confirmCost !== true) {
          return err(res, 400, 'um benchmark faz pedidos pagos com a sua chave (5 tarefas × amostras): confirme com confirmCost=true',
            { estimatedRequests: (body.samples ? Math.min(3, Math.max(1, Number(body.samples))) : 1) * Object.keys(BENCHMARK_SUITE).length });
        }
        const providerId = String(entry.key).startsWith('providers/') ? String(entry.key).slice('providers/'.length) : null;
        const cred = providerId ? store.credentialFor(a.user.id, providerId) : null;
        let apiKey = null;
        if (cred && vault.enabled) { try { apiKey = vault.open(cred.keyCipher); } catch { apiKey = null; } }
        const model = String(body.model || (cred && cred.model) || (entry.metadata && entry.metadata.defaultModel) || '').slice(0, 120) || null;
        const t0 = Date.now();
        const out = await runBenchmark(entry, { apiKey, model, samples: body.samples,
          suite: Array.isArray(body.suite) ? body.suite.slice(0, 8) : null,
          allowInsecure: process.env.VN_TEST_PROVIDERS === '1' });
        if (!out.ok) {
          return json(res, 200, { ok: false, key: entry.key, hadKey: !!apiKey, model, status: out.status, reason: out.reason,
            tasks: out.tasks, ms: Date.now() - t0,
            note: out.status === 'BLOCKED' && !apiKey ? 'guarde uma chave própria em «Chaves de IA» para medir qualidade' : out.reason });
        }
        /* um benchmark medido entra na MESMA história de testes (nível 7) */
        const rec = await store.addProviderTest({
          key: entry.key, level: 7, levelId: 'qualidade', result: out.summary.qualityScore >= 60 ? 'PASS' : 'FAIL',
          reason: out.summary.passRate + ' % de tarefas passadas (' + out.summary.passed + '/' + out.summary.of + ')',
          detail: out.tasks.map((x) => x.task + '=' + x.result).join(' · '),
          diagnosis: null, httpStatus: null, latencyMs: out.summary ? null : null,
          method: 'benchmark v' + BENCHMARK_VERSION + ' · ' + Object.keys(BENCHMARK_SUITE).length + ' tarefas',
          samples: out.samples, successRate: out.summary.passRate / 100,
          qualityScore: out.summary.qualityScore, safetyPass: out.summary.safetyPass,
          costUsd: out.summary.costUsd, tokens: out.summary.tokens,
          testedBy: a.user.id, synthetic: false
        });
        await store.addUsage({ userId: a.user.id, provider: providerId || entry.vendor || 'desconhecido', model,
          kind: 'benchmark', ok: true,
          promptTokens: out.summary.tokens.prompt, completionTokens: out.summary.tokens.completion,
          cost: out.summary.costUsd, latencyMs: null });
        const novoEstado = out.summary.qualityScore != null && entry.state !== 'GENERATION_TESTED' && entry.state !== 'RANKED' && entry.state !== 'APPROVED'
          ? 'GENERATION_TESTED' : null;
        if (novoEstado) await store.setCatalogState(entry.key, novoEstado, 'benchmark medido', a.user.id);
        await store.audit({ type: 'provider_benchmarked', actorId: a.user.id, subjectId: entry.key, action: 'benchmark',
          detail: { model, samples: out.samples, quality: out.summary.qualityScore, passRate: out.summary.passRate,
            costUsd: out.summary.costUsd, requests: out.requestsUsed, ms: Date.now() - t0, testId: rec.id } });
        return json(res, 200, { ok: true, key: entry.key, hadKey: true, model, status: out.status,
          summary: out.summary, tasks: out.tasks, requestsUsed: out.requestsUsed, stored: rec.id, ms: Date.now() - t0,
          note: 'resultado medido: entra no ranking como dimensão de qualidade e de custo' });
      }

      if (p === '/api/provider-os/benchmarks' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const runs = store.catalogEntries()
          .map((e) => {
            const t = store.providerTestsOf(e.key).filter((x) => x.level === 7 && !x.synthetic);
            if (!t.length) return null;
            const last = t[t.length - 1];
            return { key: e.key, model: last.model || null, at: last.at, ok: last.result !== 'BLOCKED',
              summary: { qualityScore: last.qualityScore == null ? null : last.qualityScore,
                passRate: last.successRate == null ? null : last.successRate * 100,
                passed: null, of: null, costUsd: last.costUsd == null ? null : last.costUsd,
                safetyPass: last.safetyPass == null ? null : last.safetyPass },
              tasks: (last.detail || '').split(' · ').filter(Boolean).map((x) => {
                const [id, result] = x.split('=');
                return { task: id, result, passed: result === 'PASS' ? 1 : 0, of: 1, why: null, latencyP50Ms: null };
              }),
              note: last.reason };
          })
          .filter(Boolean);
        return json(res, 200, Object.assign({ ok: true }, compareBenchmarks(runs), {
          history: store.auditList({ type: 'provider_benchmarked', limit: 20 }).map((x) => ({ at: x.at, ...x.detail })),
          note: 'matriz derivada dos registos medidos (nível 7); quem não correu não aparece'
        }));
      }

      if (p === '/api/provider-os/cost' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const body = await readBody(req);
        const e = store.catalogEntry(String(body.key || ''));
        if (!e) return err(res, 404, 'entrada de catálogo não encontrada');
        const out = costOfTask({
          promptTokens: body.promptTokens == null ? null : Number(body.promptTokens),
          completionTokens: body.completionTokens == null ? null : Number(body.completionTokens),
          pricing: e.pricing
        });
        return json(res, 200, { ok: true, key: e.key, pricing: e.pricing || null, cost: out,
          note: out.usd == null ? 'sem base para calcular: ' + out.reason : 'custo calculado, não estimado' });
      }

      /* ---------- fornecedores de IA ---------- */
      if (p === '/api/providers' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        const mine = store.credentialsOf(a.user.id);
        return json(res, 200, {
          ok: true,
          keyVault: { enabled: vault.enabled, reason: vault.reason },
          documents: {
            pdfMaxBytes: PDF_LIMITS.maxBytes, htmlMaxBytes: DOC_MAX_HTML, maxRedirects: DOC_MAX_REDIRECTS,
            pdfText: 'extraído com /ToUnicode; digitalizações passam por OCR quando há motor; cifra não é contornada',
            humanReview: 'obrigatória: nenhuma prova nasce de uma extracção',
            localFetch: localFetchAllowed() ? 'permitido (ambiente de teste local)' : 'proibido',
            ocr: (() => {
              const st = ocrStatus();
              return {
                available: st.available, engine: st.engine, version: st.version,
                languages: st.languages, dataSource: st.dataSource, reason: st.reason,
                minConfidence: OCR_LIMITS.minConfidence, maxImages: OCR_LIMITS.maxImages
              };
            })()
          },
          providers: registryPublic().map((pr) => {
            const c = mine.filter((x) => x.provider === pr.id)[0] || null;
            const br = breakerState(pr.id + ':' + ((c && c.model) || ''));
            return Object.assign({}, pr, {
              configured: !!c,
              mask: c ? c.keyMask : null,
              model: c ? c.model : null,
              status: c ? c.status : 'not_configured',
              lastError: c ? c.lastError : null,
              lastValidatedAt: c ? c.lastValidatedAt : null,
              breakerOpen: br.open
            });
          })
        });
      }

      if (p.match(/^\/api\/providers\/[^/]+\/key$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const provider = p.split('/')[3];
        if (!PROVIDERS[provider]) return err(res, 400, 'fornecedor desconhecido');
        if (!vault.enabled) return err(res, 503, 'cofre de chaves desactivado: ' + vault.reason, { needsEnv: 'APP_SECRET' });
        const body = await readBody(req);
        const key = String(body.apiKey || '').trim();
        if (!key) return err(res, 400, 'chave vazia');
        const sealed = vault.seal(key);
        const c = await store.upsertCredential({
          userId: a.user.id, provider, keyCipher: sealed, keyMask: vault.mask(key),
          model: String(body.model || '').slice(0, 120) || null,
          meta: { accountId: body.accountId ? String(body.accountId).slice(0, 80) : null, base: body.base ? String(body.base).slice(0, 200) : null }
        });
        await store.audit({ type: 'credential_saved', actorId: a.user.id, subjectId: c.id, action: 'save_key', detail: { provider, mask: c.keyMask } });
        return json(res, 200, { ok: true, provider, mask: c.keyMask, status: 'unverified', note: 'chave cifrada em repouso; utilize «testar» para validar' });
      }

      if (p.match(/^\/api\/providers\/[^/]+\/key$/) && method === 'DELETE') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const provider = p.split('/')[3];
        const done = await store.deleteCredential(a.user.id, provider);
        await store.audit({ type: 'credential_deleted', actorId: a.user.id, action: 'delete_key', detail: { provider } });
        return done ? json(res, 200, { ok: true }) : err(res, 404, 'sem chave guardada para este fornecedor');
      }

      if (p.match(/^\/api\/providers\/[^/]+\/test$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const provider = p.split('/')[3];
        const c = store.credentialFor(a.user.id, provider);
        if (!c) return err(res, 400, 'sem chave configurada para ' + provider);
        const body = await readBody(req);
        let apiKey = null;
        try { apiKey = vault.open(c.keyCipher); } catch { return err(res, 500, 'não foi possível ler a chave guardada'); }
        const t0 = Date.now();
        const result = await validateProvider({
          provider, base: (body.base || (c.meta && c.meta.base) || undefined), apiKey,
          model: body.model || c.model, accountId: (c.meta && c.meta.accountId) || undefined,
          timeoutMs: 20000
        });
        await store.setCredentialStatus(c.id, result.ok ? 'operational' : 'error', result.ok ? null : result.error);
        await store.audit({
          type: 'provider_tested', actorId: a.user.id, subjectId: c.id, ip: ipOf(req), action: 'test_provider',
          detail: { provider, ok: !!result.ok, stage: result.stage || null, status: result.checks && result.checks[0] ? result.checks[0].status : null, ms: Date.now() - t0 }
        });
        await store.addUsage({ userId: a.user.id, provider, kind: 'validation', ok: !!result.ok, promptTokens: result.usage ? result.usage.promptTokens : null, completionTokens: result.usage ? result.usage.completionTokens : null, cost: null });
        return json(res, 200, { ok: true, validation: redactValidation(result) });
      }

      if (p.match(/^\/api\/providers\/[^/]+\/complete$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireCsrf(req, res, a)) return;
        const provider = p.split('/')[3];
        const c = store.credentialFor(a.user.id, provider);
        if (!c) return err(res, 400, 'sem chave configurada para ' + provider);
        if (c.status !== 'operational') return err(res, 409, 'fornecedor não validado: execute primeiro o teste de ligação');
        const body = await readBody(req);
        const msgs = Array.isArray(body.messages) ? body.messages.slice(0, 20).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 8000) })) : null;
        if (!msgs || !msgs.length) return err(res, 400, 'messages ausente');
        let apiKey = null;
        try { apiKey = vault.open(c.keyCipher); } catch { return err(res, 500, 'não foi possível ler a chave guardada'); }
        const r = await complete({
          provider, base: (c.meta && c.meta.base) || undefined, apiKey, model: c.model,
          accountId: (c.meta && c.meta.accountId) || undefined, messages: msgs, timeoutMs: 30000
        });
        await store.addUsage({
          userId: a.user.id, provider, model: c.model, kind: 'completion', ok: !!r.ok,
          promptTokens: r.usage ? r.usage.promptTokens : null,
          completionTokens: r.usage ? r.usage.completionTokens : null, cost: null,
          latencyMs: r.latencyMs != null ? r.latencyMs : null
        });
        await store.audit({ type: 'ai_call', actorId: a.user.id, action: 'complete', detail: { provider, model: c.model, ok: !!r.ok, circuitOpen: !!r.circuitOpen } });
        await store.count(r.ok ? 'ai_calls_ok' : 'ai_calls_failed');
        if (!r.ok) return err(res, 502, r.error || 'falha do fornecedor', { circuitOpen: !!r.circuitOpen });
        return json(res, 200, { ok: true, text: r.text, usage: r.usage, latencyMs: r.latencyMs, reported: !!r.usage && r.usage.promptTokens != null });
      }

      /* ---------- administração ---------- */
      if (p === '/api/admin/metrics' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireAdmin(a, res)) return;
        const users = store.data.users;
        const sessions = store.data.sessions;
        const projects = store.data.projects;
        const usage = store.usageSummary();
        const counts = store.counters();
        const audit = store.auditList({ limit: 5000 });
        return json(res, 200, {
          ok: true,
          generatedAt: now(),
          users: {
            total: users.length,
            admins: users.filter((u) => u.role === 'ADMIN').length,
            suspended: users.filter((u) => u.status !== 'active').length,
            activeSessions: sessions.filter((s) => !s.revokedAt && new Date(s.expiresAt) > new Date()).length
          },
          projects: {
            total: projects.length,
            byStatus: projects.reduce((o, x) => { o[x.status] = (o[x.status] || 0) + 1; return o; }, {})
          },
          ai: {
            byProvider: usage,
            totalCalls: Object.values(usage).reduce((n, x) => n + x.calls, 0),
            costNote: 'os custos só aparecem quando o fornecedor os reporta; caso contrário: valor desconhecido'
          },
          counters: counts,
          security: {
            loginFailures: audit.filter((e) => e.type === 'login_failed').length,
            blockedAttempts: audit.filter((e) => e.type === 'login_blocked').length,
            adminAccesses: audit.filter((e) => e.type === 'admin_access').length
          },
          notAvailable: [
            'documentos processados (ainda sem ingestão documental)',
            'relações propostas/verificadas (motor de investigação não implementado nesta fase)',
            'armazenamento em disco (não medido no plano gratuito)'
          ]
        });
      }

      /* Criação de contas por um administrador: é o caminho normal quando o
         registo público está fechado. A palavra-passe temporária é devolvida
         UMA vez (nunca guardada em claro) e a conta obriga a troca no primeiro
         acesso — ver mustChangePassword em /api/auth/me. */
      if (p === '/api/admin/users' && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireAdmin(a, res)) return;
        if (!requireCsrf(req, res, a)) return;
        const ip = ipOf(req);
        const body = await readBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        if (!emailRe.test(email)) return err(res, 400, 'email inválido');
        if (store.userByEmail(email)) return err(res, 409, 'não foi possível criar a conta com estes dados');
        const tempPassword = String(body.password || '') || ('Vn-' + newToken(9).replace(/[^A-Za-z0-9]/g, '').slice(0, 10) + '-' + Math.floor(Math.random() * 9000 + 1000));
        const problems = passwordProblems(tempPassword);
        if (problems.length) return err(res, 400, 'palavra-passe fraca: ' + problems.join(', '));
        const role = body.role === 'ADMIN' ? 'ADMIN' : 'USER';
        const { salt, hash } = hashPassword(tempPassword);
        const user = await store.createUser({ email, passwordHash: hash, salt, role, termsAcceptedAt: body.acceptTerms === true ? now() : null });
        await store.updateUser(user.id, { mustChangePassword: true, createdBy: a.user.id });
        await store.audit({
          type: 'admin_user_created', actorId: a.user.id, subjectId: user.id, ip,
          action: 'create_user', detail: { role, passwordShownOnce: true }
        });
        await store.count('users_created_by_admin');
        return json(res, 201, {
          ok: true, user: publicUser(store.userById(user.id)), tempPassword,
          note: 'esta palavra-passe é mostrada uma única vez; não é guardada em claro e a conta tem de a trocar no primeiro acesso'
        });
      }

      if (p === '/api/admin/users' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireAdmin(a, res)) return;
        await store.audit({ type: 'admin_access', actorId: a.user.id, ip: ipOf(req), action: 'list_users' });
        return json(res, 200, {
          ok: true,
          users: store.data.users.map((u) => Object.assign(publicUser(u), {
            projects: store.projectsOf(u.id).length,
            hasKeys: store.credentialsOf(u.id).map((c) => ({ provider: c.provider, mask: c.keyMask, status: c.status }))
          }))
        });
      }

      if (p.match(/^\/api\/admin\/users\/[^/]+\/projects$/) && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireAdmin(a, res)) return;
        const uid = p.split('/')[4];
        const target = store.userById(uid);
        if (!target) return err(res, 404, 'utilizador não encontrado');
        await store.audit({
          type: 'admin_access', actorId: a.user.id, subjectId: uid, ip: ipOf(req),
          action: 'view_user_projects', reason: String(url.searchParams.get('reason') || 'não indicado').slice(0, 200)
        });
        return json(res, 200, { ok: true, user: publicUser(target), projects: store.projectsOf(uid) });
      }

      if (p.match(/^\/api\/admin\/users\/[^/]+\/status$/) && method === 'POST') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireAdmin(a, res)) return;
        if (!requireCsrf(req, res, a)) return;
        const uid = p.split('/')[4];
        const body = await readBody(req);
        const target = store.userById(uid);
        if (!target) return err(res, 404, 'utilizador não encontrado');
        if (target.id === a.user.id) return err(res, 400, 'não pode suspender a própria conta');
        const status = body.status === 'active' ? 'active' : 'suspended';
        await store.updateUser(uid, { status });
        if (status === 'suspended') await store.revokeAllSessions(uid);
        await store.audit({ type: 'admin_user_status', actorId: a.user.id, subjectId: uid, ip: ipOf(req), action: 'set_status', detail: { status } });
        return json(res, 200, { ok: true, user: publicUser(store.userById(uid)) });
      }

      if (p === '/api/admin/audit' && method === 'GET') {
        const a = await requireUser(req, res); if (!a) return;
        if (!requireAdmin(a, res)) return;
        const limit = Math.min(500, Number(url.searchParams.get('limit') || 100));
        return json(res, 200, { ok: true, events: store.auditList({ type: url.searchParams.get('type') || null, limit }) });
      }

      return err(res, 404, 'rota não encontrada');
    } catch (e) {
      /* base em só-de-leitura e falhas de gravação são 503 (serviço temporariamente
         incapaz), não 500: o cliente precisa de saber que pode tentar mais tarde
         e que nada foi gravado a meio */
      const msg = String(e && e.message || e);
      if (/só-de-leitura|read-only/i.test(msg)) {
        console.error('[api] escrita recusada:', msg);
        return err(res, 503, 'armazenamento em modo só-de-leitura: ' + msg, { retryable: true });
      }
      const status = e.status || 500;
      if (status >= 500) console.error('[api] erro:', e.message);
      return err(res, status, status >= 500 ? 'erro interno' : e.message);
    }
  };

  function summaryProject(p) {
    return {
      id: p.id, title: p.title, question: p.question, status: p.status,
      createdAt: p.createdAt, updatedAt: p.updatedAt, archivedAt: p.archivedAt,
      restoredFrom: p.restoredFrom || null,
      counters: { documents: (p.documents || []).length, evidence: (p.evidence || []).length, relations: (p.relations || []).length }
    };
  }

  function redactValidation(v) {
    return {
      ok: v.ok, stage: v.stage || null, error: v.error || null, provider: v.provider,
      model: v.model, latencyMs: v.latencyMs != null ? v.latencyMs : null,
      checks: v.checks || [], modelsCount: v.models ? v.models.length : 0,
      modelsSample: (v.models || []).slice(0, 8),
      usage: v.usage || null, sample: v.sample ? String(v.sample).slice(0, 120) : null
    };
  }

  /* Acesso ao armazenamento apenas para testes que precisam de semear estado
     (ex.: provar que um teste sintético não entra no ranking). Nunca é exposto
     por omissão: `createApi()` em produção não recebe esta opção. */
  if (opts.exposeStore === true) api.__test = { store };

  api.close = async () => {
    if (typeof store.readOnly === 'function' && store.readOnly()) return;   // nada a gravar
    await store.persist();
  };
  return api;
}
