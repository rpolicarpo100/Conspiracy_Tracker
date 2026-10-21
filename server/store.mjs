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

const EMPTY = () => ({
  version: 1,
  users: [], sessions: [], projects: [], credentials: [], usage: [],
  audit: [], metrics: { counters: {} }, createdAt: new Date().toISOString()
});

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
      loaded = true;
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // dados ilegíveis não são ignorados em silêncio: preserva-se o ficheiro e recomeça-se
        const broken = file + '.broken-' + Date.now();
        await fs.rename(file, broken).catch(() => {});
        console.error('[store] base ilegível, preservada em', broken);
      }
      db = EMPTY(); loaded = true;
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
        'budget', 'status', 'notes'];
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
    persist
  };
}
