/* =====================================================================
   ARMazenamento persistente em ficheiro (JSON) com escrita atómica.
   LIMITAÇÃO CONHECIDA E DECLARADA: no plano gratuito do Render o disco é
   efémero — os dados sobrevivem a reinícios do processo, mas NÃO a um novo
   deploy. Para produção: montar um disco persistente (DATA_DIR) ou trocar
   este módulo por Postgres (a API abaixo é a única superfície a substituir).
   ===================================================================== */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SCHEMA_VERSION = 5;

const EMPTY = () => ({
  version: SCHEMA_VERSION,
  users: [], sessions: [], projects: [], credentials: [], usage: [],
  evidence: [], claims: [], runs: [], relations: [], agentRuns: [], notes: [], entityLinks: [],
  audit: [], migrations: [], metrics: { counters: {} }, createdAt: new Date().toISOString()
});

/* Migrações por passo. Cada passo recebe a base e devolve o que mudou, para que
   o registo em `migrations` diga exactamente o que foi alterado (sem inventar). */
const MIGRATIONS = {
  2: (db) => {
    const changes = [];
    ['evidence', 'claims', 'runs', 'migrations'].forEach((k) => {
      if (!Array.isArray(db[k])) { db[k] = []; changes.push('criada a colecção ' + k); }
    });
    let touched = 0;
    db.projects.forEach((p) => {
      const before = JSON.stringify(p);
      p.status = p.status || 'draft';
      p.hypotheses = Array.isArray(p.hypotheses) ? p.hypotheses : [];
      p.subquestions = Array.isArray(p.subquestions) ? p.subquestions : [];
      p.completionCriteria = Array.isArray(p.completionCriteria) ? p.completionCriteria : [];
      p.checkpoints = Array.isArray(p.checkpoints) ? p.checkpoints : [];
      p.notes = Array.isArray(p.notes) ? p.notes : [];
      p.referenceDate = p.referenceDate || null;
      p.timeLimit = p.timeLimit || null;
      p.budget = Object.assign({ maxCalls: 50, maxDocuments: 100, maxMinutes: 30, maxCost: 0 }, p.budget || {});
      p.scope = Object.assign({ geo: '', period: { from: null, to: null }, languages: [] }, p.scope || {});
      if (JSON.stringify(p) !== before) touched++;
    });
    if (touched) changes.push(touched + ' projecto(s) completados com os campos da v2');
    return changes;
  },
  3: (db, missing) => {
    const changes = [];
    if (!Array.isArray(db.relations)) db.relations = [];
    if (missing && missing.indexOf('relations') >= 0) changes.push('criada a colecção relations (grafo a partir de provas)');
    return changes;
  },
  4: (db, missing) => {
    const changes = [];
    if (!Array.isArray(db.agentRuns)) db.agentRuns = [];
    if (missing && missing.indexOf('agentRuns') >= 0) changes.push('criada a colecção agentRuns (execuções dos 13 agentes)');
    return changes;
  },
  5: (db, missing) => {
    const changes = [];
    if (!Array.isArray(db.notes)) db.notes = [];
    if (missing && missing.indexOf('notes') >= 0) changes.push('criada a colecção notes (memória da investigação)');
    if (!Array.isArray(db.entityLinks)) db.entityLinks = [];
    if (missing && missing.indexOf('entityLinks') >= 0) changes.push('criada a colecção entityLinks (fusão de homónimos com identificador, reversível)');
    return changes;
  }
};

function migrate(db, missing) {
  const from = Number(db.version || 1);
  const applied = [];
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) continue;
    const changes = step(db, missing || []) || [];
    db.version = v;
    applied.push({ to: v, at: new Date().toISOString(), changes });
    db.migrations.push({ from: v - 1, to: v, at: applied[applied.length - 1].at, changes });
  }
  return { from, to: db.version, applied };
}

export function createStore(dir) {
  const root = dir || path.join(process.cwd(), '.data');
  const file = path.join(root, 'db.json');
  let db = EMPTY();
  let loaded = false;
  let writeChain = Promise.resolve();

  async function load() {
    if (loaded) return db;
    try {
      await fs.mkdir(root, { recursive: true });
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      db = Object.assign(EMPTY(), parsed);
      /* o que o ficheiro guardado não tinha: base para descrever a migração sem inventar */
      const missing = Object.keys(EMPTY()).filter((k) => !(k in parsed));
      const m = migrate(db, missing);
      if (m.applied.length) {
        console.log('[store] migração aplicada:', m.from, '→', m.to,
          m.applied.map((a) => a.changes.join('; ')).join(' | '));
        await persist();
      }
      loaded = true;
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // dados ilegíveis não são ignorados em silêncio: preserva-se o ficheiro e recomeça-se
        const broken = file + '.broken-' + Date.now();
        await fs.rename(file, broken).catch(() => {});
        console.error('[store] base ilegível, preservada em', broken);
      }
      db = EMPTY(); loaded = true;
      db.migrations.push({ from: 0, to: SCHEMA_VERSION, at: new Date().toISOString(),
        changes: ['base criada directamente na versão ' + SCHEMA_VERSION] });
      await persist();
    }
    return db;
  }

  function persist() {
    writeChain = writeChain.then(async () => {
      const tmp = file + '.tmp-' + process.pid;
      const data = JSON.stringify(db, null, 1);
      await fs.writeFile(tmp, data, { mode: 0o600 });
      await fs.rename(tmp, file);           // troca atómica
    }).catch((e) => console.error('[store] falha ao gravar:', e.message));
    return writeChain;
  }

  const id = (p) => p + '-' + crypto.randomBytes(9).toString('base64url');

  db = EMPTY();

  return {
    async init() { await load(); return this; },
    get data() { return db; },
    root, file,

    /* --- utilizadores --- */
    async createUser({ email, passwordHash, salt, role, termsAcceptedAt }) {
      const u = {
        id: id('usr'), email: String(email).toLowerCase(), passwordHash, salt,
        role: role || 'USER', status: 'active',
        emailVerified: false, emailVerifyToken: null,
        createdAt: new Date().toISOString(), lastLoginAt: null,
        termsAcceptedAt: termsAcceptedAt || null, mfa: null
      };
      db.users.push(u); await persist(); return u;
    },
    userByEmail(email) { return db.users.find((u) => u.email === String(email || '').toLowerCase()) || null; },
    userById(uid) { return db.users.find((u) => u.id === uid) || null; },
    async updateUser(uid, patch) {
      const u = this.userById(uid); if (!u) return null;
      Object.assign(u, patch); await persist(); return u;
    },
    async deleteUser(uid) {
      db.users = db.users.filter((u) => u.id !== uid);
      db.sessions = db.sessions.filter((s) => s.userId !== uid);
      db.projects = db.projects.filter((p) => p.ownerId !== uid);
      db.credentials = db.credentials.filter((c) => c.userId !== uid);
      const mine = new Set(db.projects.filter((p) => p.ownerId === uid).map((p) => p.id));
      db.evidence = db.evidence.filter((e) => !mine.has(e.projectId));
      db.notes = db.notes.filter((n) => !mine.has(n.projectId));
      db.entityLinks = db.entityLinks.filter((l) => !mine.has(l.projectId));
      db.claims = db.claims.filter((c) => !mine.has(c.projectId));
      db.runs = db.runs.filter((r) => !mine.has(r.projectId));
      db.relations = db.relations.filter((r) => !mine.has(r.projectId));
      db.agentRuns = db.agentRuns.filter((r) => !mine.has(r.projectId));
      await persist();
    },

    /* --- sessões --- */
    async createSession({ userId, tokenHash, ip, ua, ttlMs }) {
      const s = {
        id: id('ses'), userId, tokenHash, ip: ip || null, ua: ua ? String(ua).slice(0, 180) : null,
        createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + (ttlMs || 12 * 3600e3)).toISOString(), revokedAt: null
      };
      db.sessions.push(s); await persist(); return s;
    },
    sessionByHash(h) { return db.sessions.find((s) => s.tokenHash === h) || null; },
    sessionsOf(uid) { return db.sessions.filter((s) => s.userId === uid); },
    async revokeSession(sid, byUserId) {
      const s = db.sessions.find((x) => x.id === sid); if (!s) return false;
      if (byUserId && s.userId !== byUserId) return false;
      s.revokedAt = new Date().toISOString(); await persist(); return true;
    },
    async revokeAllSessions(uid, except) {
      db.sessions.filter((s) => s.userId === uid && s.id !== except && !s.revokedAt)
        .forEach((s) => { s.revokedAt = new Date().toISOString(); });
      await persist();
    },
    async touchSession(sid) {
      const s = db.sessions.find((x) => x.id === sid);
      if (s) { s.lastSeenAt = new Date().toISOString(); persist(); }
    },

    /* --- projectos --- */
    async createProject(ownerId, data) {
      const now = new Date().toISOString();
      const p = Object.assign({
        id: id('prj'), ownerId, title: 'Sem título', question: '', objective: '', description: '',
        scope: { geo: '', period: { from: null, to: null }, languages: [] },
        keywords: [], entities: [], excludedSources: [], prioritySources: [],
        hypotheses: [], subquestions: [], completionCriteria: [],
        budget: { maxCalls: 50, maxDocuments: 100, maxMinutes: 30, maxCost: 0 },
        status: 'draft', notes: [], checkpoints: [], documents: [], evidence: [],
        relations: [], createdAt: now, updatedAt: now, archivedAt: null
      }, data || {});
      db.projects.push(p); await persist(); return p;
    },
    projectsOf(ownerId) { return db.projects.filter((p) => p.ownerId === ownerId); },
    allProjects() { return db.projects.slice(); },
    projectByIdFor(pid, ownerId) {
      const p = db.projects.find((x) => x.id === pid);
      if (!p) return null;
      return (!ownerId || p.ownerId === ownerId) ? p : null;
    },
    async updateProject(pid, ownerId, patch) {
      const p = db.projects.find((x) => x.id === pid && (!ownerId || x.ownerId === ownerId));
      if (!p) return null;
      const allowed = ['title', 'question', 'objective', 'description', 'scope', 'keywords', 'entities',
        'excludedSources', 'prioritySources', 'hypotheses', 'subquestions', 'completionCriteria',
        'budget', 'status', 'notes', 'referenceDate', 'timeLimit', 'languages'];
      allowed.forEach((k) => { if (patch[k] !== undefined) p[k] = patch[k]; });
      p.updatedAt = new Date().toISOString();
      await persist(); return p;
    },
    async deleteProject(pid, ownerId) {
      const before = db.projects.length;
      db.projects = db.projects.filter((p) => !(p.id === pid && (!ownerId || p.ownerId === ownerId)));
      if (db.projects.length === before) return false;
      await persist(); return true;
    },

    /* --- documentos recolhidos (texto extraído para revisão humana) --- */
    async addDocument(pid, ownerId, doc) {
      const prj = db.projects.find((x) => x.id === pid && (!ownerId || x.ownerId === ownerId));
      if (!prj) return null;
      prj.documents = prj.documents || [];
      const d = Object.assign({ id: id('doc'), createdAt: new Date().toISOString() }, doc);
      prj.documents.push(d);
      prj.updatedAt = d.createdAt;
      await persist(); return d;
    },
    documentsOf(pid) {
      const prj = db.projects.find((x) => x.id === pid);
      return prj ? (prj.documents || []).slice() : [];
    },
    documentById(did) {
      for (const prj of db.projects) {
        const d = (prj.documents || []).find((x) => x.id === did);
        if (d) return d;
      }
      return null;
    },
    async updateDocument(did, ownerId, patch) {
      for (const prj of db.projects) {
        const d = (prj.documents || []).find((x) => x.id === did);
        if (!d) continue;
        if (ownerId && prj.ownerId !== ownerId) return null;
        ['title', 'note', 'reviewed', 'reviewNote'].forEach((k) => { if (patch[k] !== undefined) d[k] = patch[k]; });
        if (patch.reviewed === true && !d.reviewedAt) d.reviewedAt = new Date().toISOString();
        await persist(); return d;
      }
      return null;
    },
    async deleteDocument(did, ownerId) {
      for (const prj of db.projects) {
        if (ownerId && prj.ownerId !== ownerId) continue;
        const before = (prj.documents || []).length;
        prj.documents = (prj.documents || []).filter((x) => x.id !== did);
        if (prj.documents.length !== before) { await persist(); return true; }
      }
      return false;
    },

    /* --- credenciais de IA (cifradas) --- */
    async upsertCredential({ userId, provider, keyCipher, keyMask, model, meta }) {
      let c = db.credentials.find((x) => x.userId === userId && x.provider === provider);
      const now = new Date().toISOString();
      if (c) { Object.assign(c, { keyCipher, keyMask, model, meta, updatedAt: now }); }
      else {
        c = { id: id('cred'), userId, provider, keyCipher, keyMask, model: model || null,
          meta: meta || null, status: 'unverified', createdAt: now, updatedAt: now,
          lastValidatedAt: null, lastError: null };
        db.credentials.push(c);
      }
      await persist(); return c;
    },
    credentialsOf(userId) { return db.credentials.filter((c) => c.userId === userId); },
    credentialFor(userId, provider) { return db.credentials.find((c) => c.userId === userId && c.provider === provider) || null; },
    async setCredentialStatus(id2, status, error) {
      const c = db.credentials.find((x) => x.id === id2); if (!c) return;
      c.status = status; c.lastError = error || null; c.lastValidatedAt = new Date().toISOString();
      await persist();
    },
    async deleteCredential(userId, provider) {
      const before = db.credentials.length;
      db.credentials = db.credentials.filter((c) => !(c.userId === userId && c.provider === provider));
      if (db.credentials.length === before) return false;
      await persist(); return true;
    },

    /* --- ciclo de vida do projecto --- */
    async duplicateProject(pid, ownerId) {
      const src = db.projects.find((p) => p.id === pid && (!ownerId || p.ownerId === ownerId));
      if (!src) return null;
      const now = new Date().toISOString();
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = id('prj');
      copy.title = (src.title || 'Sem título') + ' (cópia)';
      copy.status = 'draft';
      copy.createdAt = now; copy.updatedAt = now; copy.archivedAt = null;
      copy.checkpoints = [{ id: id('chk'), at: now, label: 'duplicado de ' + src.id, by: ownerId }];
      db.projects.push(copy); await persist(); return copy;
    },
    async setProjectStatus(pid, ownerId, status) {
      const p = db.projects.find((x) => x.id === pid && (!ownerId || x.ownerId === ownerId));
      if (!p) return null;
      p.status = status;
      p.updatedAt = new Date().toISOString();
      p.archivedAt = status === 'archived' ? p.updatedAt : null;
      await persist(); return p;
    },
    async addCheckpoint(pid, ownerId, label, by) {
      const p = db.projects.find((x) => x.id === pid && (!ownerId || x.ownerId === ownerId));
      if (!p) return null;
      const cp = { id: id('chk'), at: new Date().toISOString(), label: String(label || '').slice(0, 300), by: by || null,
        evidenceCount: db.evidence.filter((e) => e.projectId === p.id).length,
        claimCount: db.claims.filter((c) => c.projectId === p.id).length };
      p.checkpoints.push(cp);
      p.updatedAt = cp.at;
      await persist(); return cp;
    },

    /* --- registo de provas (append-only com retirada explícita) --- */
    async addEvidence(projectId, ev) {
      const e = Object.assign({ id: 'ev-' + crypto.randomBytes(8).toString('base64url'),
        projectId, createdAt: new Date().toISOString(), retractedAt: null, retractReason: null,
        verificationDate: null, claimIds: [], history: [] }, ev);
      e.history.push({ at: e.createdAt, action: 'criada', by: e.createdBy || null });
      db.evidence.push(e); await persist(); return e;
    },
    evidenceOf(projectId) { return db.evidence.filter((e) => e.projectId === projectId); },
    evidenceById(eid) { return db.evidence.find((e) => e.id === eid) || null; },
    evidenceByDedupe(projectId, key) { return db.evidence.find((e) => e.projectId === projectId && e.dedupeKey === key) || null; },
    async updateEvidence(eid, patch, by, action) {
      const e = db.evidence.find((x) => x.id === eid); if (!e) return null;
      Object.assign(e, patch);
      e.history.push({ at: new Date().toISOString(), action: action || 'actualizada', by: by || null,
        fields: Object.keys(patch) });
      await persist(); return e;
    },
    async retractEvidence(eid, reason, by) {
      const e = db.evidence.find((x) => x.id === eid); if (!e) return null;
      if (e.retractedAt) return e;
      e.retractedAt = new Date().toISOString(); e.retractReason = String(reason).slice(0, 500);
      e.history.push({ at: e.retractedAt, action: 'retirada', by: by || null, reason: e.retractReason });
      // retirar uma prova não a apaga: as alegações que dependiam dela são reavaliadas
      db.claims.filter((c) => (c.evidenceIds || []).includes(eid)).forEach((c) => {
        c.history.push({ at: e.retractedAt, action: 'prova retirada', by: by || null, evidenceId: eid,
          note: 'o estado deve ser revisto: ' + (c.state || 'insuficiente') });
      });
      await persist(); return e;
    },

    /* --- alegações/conclusões --- */
    async createClaim(projectId, data) {
      const now = new Date().toISOString();
      const c = Object.assign({ id: 'cl-' + crypto.randomBytes(8).toString('base64url'), projectId,
        text: '', kind: 'facto', state: 'hipotese', confidence: null, reasoning: '',
        evidenceIds: [], createdAt: now, updatedAt: now, history: [] }, data || {});
      c.history.push({ at: now, action: 'criada', by: c.createdBy || null, state: c.state });
      db.claims.push(c); await persist(); return c;
    },
    claimsOf(projectId) { return db.claims.filter((c) => c.projectId === projectId); },
    claimById(cid) { return db.claims.find((c) => c.id === cid) || null; },
    async updateClaim(cid, patch, by, action) {
      const c = db.claims.find((x) => x.id === cid); if (!c) return null;
      const prev = c.state;
      Object.assign(c, patch);
      c.updatedAt = new Date().toISOString();
      c.history.push({ at: c.updatedAt, action: action || 'actualizada', by: by || null,
        from: prev, to: c.state, fields: Object.keys(patch) });
      await persist(); return c;
    },
    async linkEvidence(cid, eid, on) {
      const c = db.claims.find((x) => x.id === cid); const e = db.evidence.find((x) => x.id === eid);
      if (!c || !e) return null;
      const has = c.evidenceIds.includes(eid);
      if (on && !has) c.evidenceIds.push(eid);
      if (!on && has) c.evidenceIds = c.evidenceIds.filter((x) => x !== eid);
      if (on && !e.claimIds.includes(cid)) e.claimIds.push(cid);
      if (!on) e.claimIds = e.claimIds.filter((x) => x !== cid);
      await persist(); return c;
    },

    /* --- relações do grafo (sempre com prova; retirada em vez de apagada) --- */
    async addRelation(projectId, rel, by) {
      const now = new Date().toISOString();
      const r = Object.assign({ id: 'rel-' + crypto.randomBytes(8).toString('base64url'),
        projectId, createdAt: now, createdBy: by || null, retractedAt: null, retractReason: null,
        validationState: null, lastChecked: now, history: [] }, rel);
      r.history.push({ at: now, action: 'criada', by: by || null });
      db.relations.push(r); await persist(); return r;
    },
    relationsOf(projectId) { return db.relations.filter((r) => r.projectId === projectId); },
    relationById(rid) { return db.relations.find((r) => r.id === rid) || null; },
    async updateRelation(rid, patch, by) {
      const r = db.relations.find((x) => x.id === rid); if (!r) return null;
      Object.assign(r, patch);
      r.lastChecked = new Date().toISOString();
      r.history.push({ at: r.lastChecked, action: 'actualizada', by: by || null, fields: Object.keys(patch) });
      await persist(); return r;
    },
    async retractRelation(rid, reason, by) {
      const r = db.relations.find((x) => x.id === rid); if (!r) return null;
      if (r.retractedAt) return r;
      r.retractedAt = new Date().toISOString();
      r.retractReason = String(reason).slice(0, 500);
      r.history.push({ at: r.retractedAt, action: 'retirada', by: by || null, reason: r.retractReason });
      await persist(); return r;
    },

    /* --- execuções de agentes (histórico, nunca fonte de factos) --- */
    async addAgentRun(projectId, run, by) {
      const r = Object.assign({}, run, {
        projectId, createdBy: by || null,
        seq: db.agentRuns.filter((x) => x.projectId === projectId).length + 1
      });
      db.agentRuns.push(r); await persist(); return r;
    },
    agentRunsOf(projectId) { return db.agentRuns.filter((r) => r.projectId === projectId); },
    latestAgentRun(projectId, agentId) {
      const list = db.agentRuns.filter((r) => r.projectId === projectId && r.agentId === agentId);
      return list.length ? list[list.length - 1] : null;
    },

    /* --- memória da investigação (append-only, com histórico) --- */
    async addNote(projectId, note, by) {
      const now = new Date().toISOString();
      const n = Object.assign({ id: 'mem-' + crypto.randomBytes(8).toString('base64url'),
        projectId, createdAt: now, updatedAt: now, createdBy: by || null,
        archivedAt: null, archiveReason: null, history: [], links: {}, tags: [] }, note || {});
      n.history.push({ at: now, action: 'criada', by: by || null, kind: n.kind || null });
      db.notes.push(n); await persist(); return n;
    },
    notesOf(projectId) { return db.notes.filter((n) => n.projectId === projectId); },
    noteById(id) { return db.notes.find((n) => n.id === id) || null; },
    async updateNote(id, patch, by, action) {
      const n = db.notes.find((x) => x.id === id); if (!n) return null;
      Object.assign(n, patch, { updatedAt: new Date().toISOString() });
      n.history.push({ at: n.updatedAt, action: action || 'actualizada', by: by || null, fields: Object.keys(patch) });
      await persist(); return n;
    },
    async archiveNote(id, reason, by) {
      const n = db.notes.find((x) => x.id === id); if (!n) return null;
      if (n.archivedAt) return n;
      n.archivedAt = new Date().toISOString();
      n.archiveReason = String(reason || '').slice(0, 500);
      n.history.push({ at: n.archivedAt, action: 'arquivada', by: by || null, reason: n.archiveReason });
      await persist(); return n;
    },

    /* --- fusão de homónimos: ligações declaradas, reversíveis --- */
    async addEntityLink(projectId, link, by) {
      const l = Object.assign({ id: 'elnk-' + crypto.randomBytes(8).toString('base64url'),
        projectId, createdAt: new Date().toISOString(), createdBy: by || null, retractedAt: null, retractReason: null }, link || {});
      db.entityLinks.push(l); await persist(); return l;
    },
    entityLinksOf(projectId) { return db.entityLinks.filter((l) => l.projectId === projectId); },
    async retractEntityLink(id, reason, by) {
      const l = db.entityLinks.find((x) => x.id === id); if (!l) return null;
      if (l.retractedAt) return l;
      l.retractedAt = new Date().toISOString();
      l.retractReason = String(reason || '').slice(0, 500);
      l.retractedBy = by || null;
      await persist(); return l;
    },

    /* --- execuções de pesquisa (registadas, retomáveis) --- */
    async createRun(projectId, data) {
      const now = new Date().toISOString();
      const r = Object.assign({ id: 'run-' + crypto.randomBytes(8).toString('base64url'), projectId,
        profile: 'normal', status: 'pending', step: 0, steps: [], stopReason: null,
        startedAt: now, finishedAt: null, sourcesConsulted: [], budget: {} }, data || {});
      db.runs.push(r); await persist(); return r;
    },
    runsOf(projectId) { return db.runs.filter((r) => r.projectId === projectId); },
    runById(rid) { return db.runs.find((r) => r.id === rid) || null; },
    async updateRun(rid, patch) {
      const r = db.runs.find((x) => x.id === rid); if (!r) return null;
      Object.assign(r, patch); await persist(); return r;
    },

    /* --- utilização de IA (apenas o que o fornecedor reportou) --- */
    async addUsage(entry) {
      db.usage.push(Object.assign({ id: id('use'), at: new Date().toISOString() }, entry));
      if (db.usage.length > 20000) db.usage = db.usage.slice(-20000);
      await persist();
    },
    usageSummary() {
      const byProvider = {};
      db.usage.forEach((u) => {
        const k = u.provider || 'desconhecido';
        byProvider[k] = byProvider[k] || { calls: 0, promptTokens: 0, completionTokens: 0, reportedTokens: 0, errors: 0, costKnown: 0 };
        byProvider[k].calls++;
        if (u.promptTokens != null) { byProvider[k].promptTokens += u.promptTokens; byProvider[k].reportedTokens++; }
        if (u.completionTokens != null) byProvider[k].completionTokens += u.completionTokens;
        if (u.cost != null) byProvider[k].costKnown += u.cost;
        if (u.ok === false) byProvider[k].errors++;
      });
      return byProvider;
    },

    /* --- auditoria --- */
    async audit(event) {
      db.audit.push(Object.assign({ id: id('evt'), at: new Date().toISOString() }, event));
      if (db.audit.length > 50000) db.audit = db.audit.slice(-50000);
      await persist();
    },
    auditList(filter) {
      let list = db.audit.slice().reverse();
      if (filter && filter.type) list = list.filter((e) => e.type === filter.type);
      if (filter && filter.actorId) list = list.filter((e) => e.actorId === filter.actorId);
      if (filter && filter.subjectId) list = list.filter((e) => e.subjectId === filter.subjectId);
      return filter && filter.limit ? list.slice(0, filter.limit) : list;
    },
    async count(name, n) {
      db.metrics.counters[name] = (db.metrics.counters[name] || 0) + (n == null ? 1 : n);
      persist();
    },
    counters() { return Object.assign({}, db.metrics.counters); },
    schemaVersion() { return db.version; },
    migrations() { return (db.migrations || []).slice(); },
    persist
  };
}
