/* =====================================================================
   ARMazenamento persistente: ficheiro JSON com escrita atómica + Postgres.

   O ficheiro continua a ser a memória rápida do processo (e a rede de
   segurança local: tmp → fsync → rename, sha256, 3 cópias). Quando existe
   DATABASE_URL, o MESMO documento é gravado numa base Postgres gerida
   (Neon/Supabase) — é isso que faz os dados sobreviverem a um deploy.
   Ordem de escrita: primeiro a base, depois o ficheiro. Se a base falhar,
   nada é dado como gravado e a memória volta ao último estado bom.

   Sem DATABASE_URL nada muda: ficheiro apenas, e /ready declara
   durableBetweenDeploys:false (o disco do plano gratuito é apagado em cada
   deploy — mitiga-se, não se resolve com ficheiros).
   ===================================================================== */
import { promises as fs } from 'node:fs';
import { createPgStore } from './pg.mjs';
import fs_sync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const SCHEMA_VERSION = 7;

const EMPTY = () => ({
  version: SCHEMA_VERSION,
  users: [], sessions: [], mfaChallenges: [], projects: [], credentials: [], usage: [],
  evidence: [], claims: [], runs: [], relations: [], agentRuns: [], notes: [], entityLinks: [],
  sources: [], sourceChecks: [], sourceRatings: [], sourceDecisions: [], discoveryRuns: [],
  providerCatalog: [], providerTests: [], providerRankings: [], selectionDecisions: [], checkpoints: [],
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
  6: (db, missing) => {
    const changes = [];
    /* O loader faz Object.assign(EMPTY(), parsed): uma colecção que faltava no
       ficheiro já existe (vazia) quando a migração corre. Sem olhar também para
       `missing`, o registo dizia «nada mudou» sobre uma base que ganhou cinco
       colecções — um changelog que mente por omissão. */
    const add = (name, why) => {
      if (!Array.isArray(db[name]) || (missing || []).indexOf(name) >= 0) {
        if (!Array.isArray(db[name])) db[name] = [];
        changes.push('colecção ' + name + (why ? ' (' + why + ')' : ''));
      } else if (!Array.isArray(db[name])) { db[name] = []; changes.push('criada a colecção ' + name); }
    };
    add('sources', 'registo de fontes: identidade, estado e proveniência da descoberta');
    add('sourceChecks', 'verificações técnicas datadas de cada fonte');
    add('sourceRatings', 'classificações por dimensão, com justificação e o que faltou');
    add('sourceDecisions', 'decisões de aprovação, rejeição ou revisão, com autor e motivo');
    add('discoveryRuns', 'execuções de descoberta: consulta, resultados e limites encontrados');
    return changes;
  },
  7: (db, missing) => {
    const changes = [];
    const add = (name, why) => {
      if (!Array.isArray(db[name]) || (missing || []).indexOf(name) >= 0) {
        if (!Array.isArray(db[name])) db[name] = [];
        changes.push('colecção ' + name + (why ? ' (' + why + ')' : ''));
      }
    };
    add('providerCatalog', 'catálogo de fornecedores e modelos de IA com evidência datada');
    add('providerTests', 'resultados de testes por camada (existência, ligação, geração, capacidades)');
    add('providerRankings', 'classificações calculadas, com pesos, métricas usadas e o que faltou');
    add('selectionDecisions', 'decisões do selector: tarefa, escolha, alternativas e razão');
    add('checkpoints', 'arquivo de trabalho: contexto recuperável, decisões, artefactos e versão');
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

  /* ---------- integridade, cópias de segurança e bloqueio de instância ----------

     Porque isto existe: o disco do plano gratuito é efémero, mas enquanto o
     processo vive o ficheiro é a única memória da investigação. Um `rename`
     sem `fsync`, um JSON truncado ou duas instâncias a escrever o mesmo
     ficheiro apagam trabalho sem aviso. Então:
     · cada gravação é tmp → fsync → rename → fsync da pasta;
     · ao lado do ficheiro fica o sha256 do conteúdo (verificado na leitura);
     · guardam-se as 3 últimas cópias boas e, se a principal estiver ilegível,
       recupera-se a mais recente VÁLIDA — dizendo qual e porquê;
     · um ficheiro de bloqueio impede duas instâncias de escreverem o mesmo
       diretório: a segunda entra em modo só-de-leitura e diz isso em /ready.
     Nada disto substitui disco persistente ou Postgres: mitiga, não resolve. */
  const checksumFile = file + '.sha256';
  const lockFile = path.join(root, 'db.lock');
  const BACKUPS = 3;
  let lockState = { held: false, readOnly: false, owner: null, reason: null };
  const recovery = { used: null, reason: null, freshStart: false, skippedBackups: 0, backups: [], source: null };
  /* Postgres: só conta como activo se a inicialização correr bem. Uma base
     configurada e inacessível não pode fazer o serviço parecer durável nem
     derrubar a aplicação inteira: fica «activo:false» com o erro à vista. */
  const pgStore = createPgStore(process.env.DATABASE_URL, {});
  let pgActive = false;
  let pgVersion = null;

  const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');

  function acquireLock() {
    try {
      const meu = { pid: process.pid, at: new Date().toISOString(), host: os.hostname() };
      fs_sync.mkdirSync(root, { recursive: true });
      if (fs_sync.existsSync(lockFile)) {
        let dono = null;
        try { dono = JSON.parse(fs_sync.readFileSync(lockFile, 'utf8')); } catch { dono = null; }
        const vivo = dono && dono.pid && (() => { try { process.kill(dono.pid, 0); return dono.pid !== process.pid; } catch { return false; } })();
        if (vivo) {
          lockState = { held: false, readOnly: true, owner: dono, reason: 'outra instância (pid ' + dono.pid + ') está a escrever neste diretório: esta instância entra em modo só-de-leitura para não corromper a base' };
          console.error('[store] ' + lockState.reason);
          return;
        }
      }
      fs_sync.writeFileSync(lockFile, JSON.stringify(meu), { mode: 0o600 });
      lockState = { held: true, readOnly: false, owner: meu, reason: null };
    } catch (e) {
      lockState = { held: false, readOnly: true, owner: null, reason: 'não foi possível criar o bloqueio: ' + e.message };
      console.error('[store] ' + lockState.reason);
    }
  }

  function releaseLock() {
    try {
      if (!lockState.held) return;
      const dono = JSON.parse(fs_sync.readFileSync(lockFile, 'utf8'));
      if (dono.pid === process.pid) fs_sync.rmSync(lockFile, { force: true });
    } catch { /* já não existe */ }
  }

  const latestCopy = file + '.ultima-copia.json';
  function keepLatest(data) {
    try { fs_sync.writeFileSync(latestCopy, data, { mode: 0o600 }); } catch (e) { console.error('[store] cópia «última» falhou:', e.message); }
  }

  function rotateBackups(data) {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const copy = path.join(root, 'db-backup-' + stamp + '.json');
      fs_sync.writeFileSync(copy, data, { mode: 0o600 });
      const all = fs_sync.readdirSync(root).filter((f) => /^db-backup-.*\.json$/.test(f)).sort();
      while (all.length > BACKUPS) {
        const old = all.shift();
        fs_sync.rmSync(path.join(root, old), { force: true });
      }
      return copy;
    } catch (e) {
      console.error('[store] cópia de segurança falhou:', e.message);
      return null;
    }
  }

  function tryRead(filePath) {
    try {
      const raw = fs_sync.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return { raw, parsed };
    } catch { return null; }
  }

  /* Tenta trazer o documento da base. Devolve true se a base for a origem. */
  async function carregarDoPostgres() {
    if (!pgStore.enabled) return false;
    try {
      await pgStore.init();
      pgActive = true;
    } catch (e) {
      pgActive = false;
      console.error('[store] Postgres configurado mas inacessível na inicialização: ' + String(e.message || e).slice(0, 200));
      console.error('[store] a aplicação continua com o ficheiro local; /ready vai declarar durableBetweenDeploys:false');
      return false;
    }
    try {
      const remoto = await pgStore.load();
      if (!remoto || !remoto.doc) return false;
      db = Object.assign(EMPTY(), remoto.doc);
      pgVersion = remoto.version;
      const missing = Object.keys(EMPTY()).filter((k) => !(k in remoto.doc));
      const m = migrate(db, missing);
      if (m.applied.length) {
        console.log('[store] migração aplicada sobre a base Postgres:', m.from, '→', m.to,
          m.applied.map((a) => a.changes.join('; ')).join(' | '));
      }
      recovery.source = 'postgres';
      recovery.reason = 'base carregada do Postgres (versão ' + remoto.version + ', gravada em ' +
        (remoto.updatedAt instanceof Date ? remoto.updatedAt.toISOString() : String(remoto.updatedAt || '?')) + ')';
      lastGood = JSON.stringify(db);
      loaded = true;
      /* o ficheiro local passa a cópia de trabalho, para as cópias de segurança
         continuarem a existir mesmo com a base configurada */
      await persist();
      return true;
    } catch (e) {
      console.error('[store] leitura do Postgres falhou: ' + String(e.message || e).slice(0, 200));
      return false;
    }
  }

  async function load() {
    if (loaded) return db;
    await fs.mkdir(root, { recursive: true });
    acquireLock();

    if (await carregarDoPostgres()) return db;

    let raw = null, parsed = null, problema = null;
    const principal = tryRead(file);
    if (principal) {
      /* o sha256 só existe a partir desta versão; se existir, tem de bater certo */
      const esperado = (() => { try { return fs_sync.readFileSync(checksumFile, 'utf8').trim(); } catch { return null; } })();
      if (esperado && sha(principal.raw) !== esperado) {
        problema = 'o ficheiro não corresponde ao sha256 registado (escrita interrompida ou alteração externa)';
      } else {
        raw = principal.raw; parsed = principal.parsed;
      }
    } else if (fs_sync.existsSync(file)) {
      problema = 'ficheiro existe mas não é JSON válido (truncado?)';
    }

    if (!parsed) {
      /* procura a cópia válida mais recente — e diz qual usou */
      const datadas = (() => { try { return fs_sync.readdirSync(root).filter((f) => /^db-backup-.*\.json$/.test(f)).sort().reverse(); } catch { return []; } })();
      const copias = (fs_sync.existsSync(latestCopy) ? [path.basename(latestCopy)] : []).concat(datadas);
      recovery.backups = copias.slice(0, BACKUPS).map((f) => path.join(root, f));
      for (const nome of copias) {
        const cand = tryRead(path.join(root, nome));
        if (cand && cand.parsed && cand.parsed.version) { raw = cand.raw; parsed = cand.parsed; recovery.used = path.join(root, nome); break; }
        recovery.skippedBackups++;
      }
      if (parsed) {
        recovery.reason = (problema || 'base principal inexistente') + ' — recuperada a cópia ' + path.basename(recovery.used);
        console.error('[store] ' + recovery.reason);
        if (fs_sync.existsSync(file)) {
          const broken = file + '.broken-' + Date.now();
          try { fs_sync.renameSync(file, broken); console.error('[store] base danificada preservada em ' + broken); } catch { /* nada a fazer */ }
        }
      }
    }

    if (parsed) {
      db = Object.assign(EMPTY(), parsed);
      const missing = Object.keys(EMPTY()).filter((k) => !(k in parsed));
      const m = migrate(db, missing);
      if (m.applied.length) {
        console.log('[store] migração aplicada:', m.from, '→', m.to,
          m.applied.map((a) => a.changes.join('; ')).join(' | '));
      }
      if (lockState.readOnly) {
        console.log('[store] base aberta em modo só-de-leitura: as migrações ficam por gravar');
      } else {
        await persist();
      }
      /* fotografia do estado em disco: é a ela que se volta se uma gravação falhar */
      lastGood = JSON.stringify(db);
      loaded = true;
      recovery.source = recovery.source || 'ficheiro';
      /* havia dados locais e a base está vazia: é a migração para Postgres.
         Sem isto, o primeiro deploy em modo Postgres começaria vazio. */
      if (pgActive && pgVersion == null) {
        try {
          pgVersion = await pgStore.save(db, null, 'migracao-inicial');
          recovery.source = 'ficheiro→postgres';
          recovery.reason = (recovery.reason || '') +
            ' · documento local publicado na base Postgres (versão ' + pgVersion + ')';
          console.log('[store] documento local migrado para Postgres (versão ' + pgVersion + ')');
        } catch (e) {
          console.error('[store] migração para Postgres falhou: ' + String(e.message || e).slice(0, 200));
        }
      }
      return db;
    }

    /* sem base e sem cópias: começa vazia — mas isso NUNCA é silencioso */
    recovery.freshStart = true;
    if (!recovery.reason) recovery.reason = problema ? problema + ' — não há cópia válida: base recomeçada vazia' : 'primeira execução: base criada vazia';
    if (problema) console.error('[store] ' + recovery.reason);
    db = EMPTY();
    loaded = true;
    db.migrations.push({ from: 0, to: SCHEMA_VERSION, at: new Date().toISOString(),
      changes: ['base criada directamente na versão ' + SCHEMA_VERSION] });
    recovery.source = pgActive ? 'base nova (postgres)' : 'base nova (ficheiro)';
    if (!lockState.readOnly) await persist();
    return db;
  }

  let lastBackupAt = 0;
  let lastGood = null;            // último estado gravado com sucesso (para desfazer)
  /* Saúde da escrita. Existe porque uma falha repetida de gravação tem de
     aparecer em /ready em vez de ficar só no log: um serviço que aceita
     trabalho e não o consegue guardar não está «pronto». */
  const saude = { ok: true, falhas: 0, ultimaFalha: null, motivo: null, recuperacoes: 0 };

  /* A pasta de dados pode desaparecer com o processo vivo (disco efémero
     substituído, limpeza externa). Sem isto, cada gravação falhava com ENOENT
     para sempre e o estado em memória era revertido a cada tentativa. */
  async function garantirPasta() {
    try { await fs.mkdir(root, { recursive: true, mode: 0o700 }); } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    /* as cópias vivem na própria pasta de dados: recriar a pasta basta */
  }

  function anotarFalha(e) {
    saude.ok = false;
    saude.falhas += 1;
    saude.ultimaFalha = new Date().toISOString();
    saude.motivo = String((e && e.message) || e).slice(0, 200);
  }
  function anotarSucesso() {
    if (!saude.ok) console.log('[store] escrita recuperada após ' + saude.falhas + ' falha(s)');
    saude.ok = true; saude.falhas = 0; saude.motivo = null;
  }

  /* ---------------------------------------------------------------------
     COALESCÊNCIA DE ESCRITAS (fase 12)

     O modelo é «um documento JSON»: cada alteração reescreve a base inteira.
     Uma importação de 5 000 provas fazia 5 000 escritas de um documento cada
     vez maior — 10× mais lento do que o necessário e, no Postgres, 5 000
     gravações da base completa.

     Aqui as alterações que chegam juntas (durante uma escrita, ou dentro de
     uma janela de 20 ms) passam a produzir UMA escrita. A promessa devolvida
     só resolve quando está no disco uma escrita que inclui essa alteração —
     a garantia de durabilidade não muda, só o número de escritas.
     --------------------------------------------------------------------- */
  /* 0 = escrever já. A coalescência acontece na mesma para pedidos que chegam
     ENQUANTO uma escrita decorre (é aí que o ganho existe e não custa latência).
     Um valor >0 junta também pedidos seguidos, à custa de esperar por ele. */
  const DEBOUNCE_MS = Math.max(0, Number(process.env.STORE_WRITE_DEBOUNCE_MS || 0));
  let geracao = 0;        // alterações pedidas
  let gravada = 0;        // alterações já no disco
  let corrente = null;    // escrita em curso (promessa)
  let escritas = 0;       // contador para /api/meta e diagnóstico
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  async function escreverBase() {
    if (lockState.readOnly) throw new Error('base em modo só-de-leitura: ' + lockState.reason);
      /* A base primeiro: se ela recusar (rede, conflito de versão), nada foi
         gravado e a memória volta ao último estado bom — nunca se anuncia um
         êxito que só existiu no ficheiro local. */
      if (pgActive) {
        pgVersion = await pgStore.save(db, pgVersion, process.env.RENDER_INSTANCE_ID || 'api');
      }
      const data = JSON.stringify(db, null, 1);
      const tmp = file + '.tmp-' + process.pid;
      /* uma tentativa normal; se a pasta desapareceu, recria-se e repete-se uma
         vez — sem esconder a recuperação do log */
      const escrever = async () => {
        const fh = await fs.open(tmp, 'w', 0o600);
        try {
          await fh.writeFile(data);
          await fh.sync();                   // os bytes chegam ao disco antes do rename
        } finally { await fh.close(); }
        await fs.rename(tmp, file);
      };
      try { await escrever(); }
      catch (e) {
        if (e.code !== 'ENOENT') throw e;
        await garantirPasta();
        saude.recuperacoes += 1;
        console.error('[store] pasta de dados ausente: recriada e escrita repetida (' + e.path + ')');
        await escrever();
      }
      try {
        const dh = await fs.open(root, 'r');
        try { await dh.sync(); } finally { await dh.close(); }   // o rename também
      } catch { /* alguns sistemas de ficheiros não permitem fsync de pasta */ }
      lastGood = data;
      await fs.writeFile(checksumFile + '.tmp', sha(data), { mode: 0o600 });
      await fs.rename(checksumFile + '.tmp', checksumFile);
      /* a última gravação boa fica sempre copiada: é a rede de segurança para
         uma escrita truncada; as cópias datadas rodam a cada 5 minutos */
      keepLatest(data);
      if (Date.now() - lastBackupAt > 5 * 60 * 1000) {
        lastBackupAt = Date.now();
        rotateBackups(data);
      }
      escritas += 1;
      anotarSucesso();
  }

  function persist() {
    const minha = ++geracao;
    if (!corrente) {
      corrente = (async () => {
        try {
          while (gravada < geracao) {
            if (DEBOUNCE_MS) await esperar(DEBOUNCE_MS);   // junta o que chegar entretanto
            const alvo = geracao;
            await escreverBase();
            gravada = alvo;
          }
        } finally { corrente = null; }
      })();
    }
    return corrente.then(() => undefined, (e) => {
      anotarFalha(e);
      console.error('[store] falha ao gravar:', e.message);
      /* a memória não pode ficar à frente do disco: desfaz-se a alteração */
      if (lastGood) {
        try {
          const antes = JSON.parse(lastGood);
          Object.keys(db).forEach((k) => { delete db[k]; });
          Object.assign(db, antes);
          console.error('[store] estado em memória reposto ao último gravado com sucesso');
        } catch (e2) { console.error('[store] reposição em memória falhou:', e2.message); }
      }
      throw e;
    });
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

    /* --- desafios de segundo factor (a sessão só nasce depois do código) --- */
    async createMfaChallenge({ userId, tokenHash, ip, ua, ttlMs }) {
      db.mfaChallenges = db.mfaChallenges || [];
      const now = Date.now();
      /* limpeza: um desafio velho não fica à espera para sempre */
      db.mfaChallenges = db.mfaChallenges.filter((c) => Date.parse(c.expiresAt) > now && !c.usedAt);
      const c = {
        id: id('mfa'), userId, tokenHash, ip: ip || null, ua: ua ? String(ua).slice(0, 180) : null,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(now + (ttlMs || 5 * 60 * 1000)).toISOString(),
        usedAt: null, attempts: 0
      };
      db.mfaChallenges.push(c); await persist(); return c;
    },
    mfaChallengeByHash(h) {
      const c = (db.mfaChallenges || []).find((x) => x.tokenHash === h);
      if (!c || c.usedAt || Date.parse(c.expiresAt) <= Date.now()) return null;
      return c;
    },
    async bumpMfaChallenge(cid) {
      const c = (db.mfaChallenges || []).find((x) => x.id === cid);
      if (!c) return null;
      c.attempts = (c.attempts || 0) + 1; await persist(); return c;
    },
    async consumeMfaChallenge(cid) {
      const c = (db.mfaChallenges || []).find((x) => x.id === cid);
      if (!c) return null;
      c.usedAt = new Date().toISOString(); await persist(); return c;
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
    /* --- registo de fontes (descoberta, verificação, classificação) --- */
    async createSource(data, by) {
      const now = new Date().toISOString();
      const src = Object.assign({
        id: 'src-' + crypto.randomBytes(8).toString('base64url'),
        createdAt: now, createdBy: by || null, updatedAt: now,
        state: 'DISCOVERED', history: [{ at: now, action: 'registada', by: by || null, state: 'DISCOVERED' }]
      }, data || {});
      db.sources.push(src); await persist(); return src;
    },
    sources() { return db.sources.slice(); },
    sourceById(id) { return db.sources.find((x) => x.id === id) || null; },
    sourceByKey(key) { return db.sources.find((x) => x.dedupeKey && x.dedupeKey === key) || null; },
    async updateSource(id, patch, by, action) {
      const src = db.sources.find((x) => x.id === id);
      if (!src) return null;
      const before = src.state;
      Object.assign(src, patch, { updatedAt: new Date().toISOString() });
      src.history.push({ at: src.updatedAt, action: action || 'actualizada', by: by || null, from: before, to: src.state, fields: Object.keys(patch) });
      await persist(); return src;
    },
    async addSourceCheck(sourceId, check) {
      const rec = Object.assign({ id: 'chk-' + crypto.randomBytes(8).toString('base64url'), sourceId, at: new Date().toISOString() }, check || {});
      db.sourceChecks.push(rec);
      if (db.sourceChecks.length > 20000) db.sourceChecks = db.sourceChecks.slice(-20000);
      await persist(); return rec;
    },
    checksOf(sourceId) { return db.sourceChecks.filter((c) => c.sourceId === sourceId); },
    lastCheckOf(sourceId) {
      const list = db.sourceChecks.filter((c) => c.sourceId === sourceId);
      return list.length ? list[list.length - 1] : null;
    },
    async addSourceRating(sourceId, rating, by) {
      const rec = Object.assign({ id: 'rat-' + crypto.randomBytes(8).toString('base64url'), sourceId,
        at: new Date().toISOString(), by: by || null }, rating || {});
      db.sourceRatings.push(rec); await persist(); return rec;
    },
    ratingsOf(sourceId) { return db.sourceRatings.filter((r) => r.sourceId === sourceId); },
    async addSourceDecision(sourceId, decision, by) {
      const rec = Object.assign({ id: 'dec-' + crypto.randomBytes(8).toString('base64url'), sourceId,
        at: new Date().toISOString(), by: by || null }, decision || {});
      db.sourceDecisions.push(rec); await persist(); return rec;
    },
    decisionsOf(sourceId) { return db.sourceDecisions.filter((d) => d.sourceId === sourceId); },
    async createDiscoveryRun(run, by) {
      const rec = Object.assign({ id: 'run-' + crypto.randomBytes(8).toString('base64url'),
        startedAt: new Date().toISOString(), by: by || null, status: 'running' }, run || {});
      db.discoveryRuns.push(rec);
      if (db.discoveryRuns.length > 500) db.discoveryRuns = db.discoveryRuns.slice(-500);
      await persist(); return rec;
    },
    async updateDiscoveryRun(id, patch) {
      const rec = db.discoveryRuns.find((r) => r.id === id);
      if (!rec) return null;
      Object.assign(rec, patch);
      await persist(); return rec;
    },
    discoveryRuns() { return db.discoveryRuns.slice().reverse(); },
    discoveryRunById(id) { return db.discoveryRuns.find((r) => r.id === id) || null; },

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

    /* --- catálogo de fornecedores de IA (fase 2 do Provider OS) ---
       Um registo, três regras: (1) nada entra sem evidência datada; (2) o mesmo
       recurso não entra duas vezes (chave canónica); (3) o estado nunca sobe
       sozinho — só um teste ou uma decisão o mudam. */
    async upsertCatalogEntry(entry, by) {
      const at = new Date().toISOString();
      const key = entry.key;
      let cur = db.providerCatalog.find((x) => x.key === key);
      if (!cur) {
        cur = Object.assign({ key, createdAt: at, createdBy: by || null, state: 'DISCOVERED',
          evidence: [], models: [], tests: [], notes: [] }, entry, { updatedAt: at });
        cur.id = cur.id || id('pcat');
        db.providerCatalog.push(cur);
        await persist();
        return { entry: cur, created: true };
      }
      const antes = cur.state;
      Object.assign(cur, entry, { updatedAt: at });
      db.providerCatalog[db.providerCatalog.indexOf(cur)] = cur;
      await persist();
      return { entry: cur, created: false, previousState: antes };
    },
    catalogEntries() { return db.providerCatalog.slice(); },
    catalogEntry(key) { return db.providerCatalog.find((x) => x.key === key || x.id === key) || null; },
    async setCatalogState(key, state, reason, by) {
      const cur = db.providerCatalog.find((x) => x.key === key || x.id === key);
      if (!cur) return null;
      cur.history = cur.history || [];
      cur.history.push({ at: new Date().toISOString(), from: cur.state, to: state, reason: reason || null, by: by || null });
      cur.state = state;
      cur.updatedAt = new Date().toISOString();
      await persist(); return cur;
    },
    async addCatalogEvidence(key, evidence) {
      const cur = db.providerCatalog.find((x) => x.key === key || x.id === key);
      if (!cur) return null;
      const ev = Object.assign({ id: id('pev'), at: new Date().toISOString() }, evidence);
      cur.evidence.push(ev);
      cur.updatedAt = ev.at;
      await persist(); return ev;
    },

    /* --- testes de fornecedor (por camada, imutáveis) --- */
    async addProviderTest(t) {
      const rec = Object.assign({ id: id('ptest'), at: new Date().toISOString() }, t);
      db.providerTests.push(rec);
      if (db.providerTests.length > 5000) db.providerTests = db.providerTests.slice(-5000);
      const cur = db.providerCatalog.find((x) => x.key === rec.key || x.id === rec.key);
      if (cur) {
        cur.tests = (cur.tests || []).concat([{ id: rec.id, at: rec.at, level: rec.level, result: rec.result, latencyMs: rec.latencyMs == null ? null : rec.latencyMs }]).slice(-50);
        cur.updatedAt = rec.at;
      }
      await persist(); return rec;
    },
    providerTestsOf(key, level) {
      return db.providerTests.filter((t) => t.key === key && (level == null || t.level === level));
    },
    latestProviderTest(key, level) {
      const list = db.providerTests.filter((t) => t.key === key && (level == null || t.level === level));
      return list.length ? list[list.length - 1] : null;
    },

    /* --- classificações --- */
    async addProviderRanking(ranking) {
      const rec = Object.assign({ id: id('prank'), at: new Date().toISOString() }, ranking);
      db.providerRankings.push(rec);
      if (db.providerRankings.length > 2000) db.providerRankings = db.providerRankings.slice(-2000);
      await persist(); return rec;
    },
    providerRankingsOf(task) {
      return db.providerRankings.filter((r) => task == null || r.task === task);
    },
    latestProviderRanking(task) {
      const list = db.providerRankings.filter((r) => r.task === task);
      return list.length ? list[list.length - 1] : null;
    },

    /* --- decisões do selector --- */
    async addSelectionDecision(d) {
      const rec = Object.assign({ id: id('sel'), at: new Date().toISOString() }, d);
      db.selectionDecisions.push(rec);
      if (db.selectionDecisions.length > 5000) db.selectionDecisions = db.selectionDecisions.slice(-5000);
      await persist(); return rec;
    },
    selectionDecisionsOf(userId) {
      return db.selectionDecisions.filter((d) => !userId || d.userId === userId);
    },

    /* --- arquivo de trabalho (checkpoints profundos, com concorrência optimista) --- */
    async saveCheckpoint(cp, opts) {
      opts = opts || {};
      const key = cp.projectId + '|' + cp.taskId;
      const list = db.checkpoints.filter((x) => x.key === key);
      const cur = list.length ? list[list.length - 1] : null;
      /* controlo de concorrência: se o cliente diz em que versão trabalhou e a
         versão já mudou, não se grava por cima do trabalho de outro agente */
      if (cur && opts.ifVersion != null && Number(opts.ifVersion) !== Number(cur.version)) {
        return { ok: false, conflict: true, current: { version: cur.version, updatedAt: cur.updatedAt, by: cur.by } };
      }
      const at = new Date().toISOString();
      const rec = {
        id: id('ckpt'), key, projectId: cp.projectId, taskId: cp.taskId,
        version: cur ? Number(cur.version) + 1 : 1,
        parentVersion: cur ? cur.version : null,
        objective: cp.objective == null ? (cur ? cur.objective : null) : String(cp.objective).slice(0, 2000),
        state: cp.state || (cur ? cur.state : 'in-progress'),
        context: Array.isArray(cp.context) ? cp.context.slice(0, 50).map((c) => String(c).slice(0, 500)) : (cur ? cur.context : []),
        decisions: Array.isArray(cp.decisions) ? cp.decisions.slice(0, 50).map((d) => ({ text: String(d.text || d).slice(0, 500), at: d.at || at, by: d.by || null })) : (cur ? cur.decisions : []),
        artifacts: Array.isArray(cp.artifacts) ? cp.artifacts.slice(0, 100).map((a) => ({ path: String(a.path || a).slice(0, 300), hash: a.hash || null, note: a.note || null })) : (cur ? cur.artifacts : []),
        sources: Array.isArray(cp.sources) ? cp.sources.slice(0, 100).map((s) => String(s).slice(0, 500)) : (cur ? cur.sources : []),
        verified: Array.isArray(cp.verified) ? cp.verified.slice(0, 100).map((s) => String(s).slice(0, 500)) : (cur ? cur.verified : []),
        open: Array.isArray(cp.open) ? cp.open.slice(0, 50).map((s) => String(s).slice(0, 500)) : (cur ? cur.open : []),
        nextAction: cp.nextAction == null ? (cur ? cur.nextAction : null) : String(cp.nextAction).slice(0, 1000),
        doneCriteria: Array.isArray(cp.doneCriteria) ? cp.doneCriteria.slice(0, 20).map((s) => String(s).slice(0, 300)) : (cur ? cur.doneCriteria : []),
        model: cp.model || null, provider: cp.provider || null,
        createdAt: cur ? cur.createdAt : at, updatedAt: at, by: cp.by || null
      };
      db.checkpoints.push(rec);
      if (db.checkpoints.length > 10000) db.checkpoints = db.checkpoints.slice(-10000);
      /* espelha o essencial no projecto, para a interface antiga continuar a funcionar */
      const p = db.projects.find((x) => x.id === rec.projectId);
      if (p) {
        p.checkpoints = Array.isArray(p.checkpoints) ? p.checkpoints : [];
        p.checkpoints.push({ id: rec.id, at: rec.updatedAt, label: rec.taskId + ' v' + rec.version, by: rec.by });
        p.updatedAt = rec.updatedAt;
      }
      await persist();
      return { ok: true, checkpoint: rec };
    },
    checkpointsOf(projectId) {
      return db.checkpoints.filter((x) => x.projectId === projectId);
    },
    latestCheckpoint(projectId, taskId) {
      const list = db.checkpoints.filter((x) => x.projectId === projectId && (!taskId || x.taskId === taskId));
      return list.length ? list[list.length - 1] : null;
    },

    /* --- auditoria --- */
    async audit(event) {
      const ev = Object.assign({ id: id('evt'), at: new Date().toISOString() }, event);
      db.audit.push(ev);
      if (db.audit.length > 50000) db.audit = db.audit.slice(-50000);
      await persist();
      /* registo append-only em tabela: sobrevive mesmo a um documento corrompido */
      if (pgActive) await pgStore.appendAudit(ev);
    },
    auditList(filter) {
      let list = db.audit.slice().reverse();
      if (filter && filter.type) list = list.filter((e) => e.type === filter.type);
      if (filter && filter.actorId) list = list.filter((e) => e.actorId === filter.actorId);
      if (filter && filter.subjectId) list = list.filter((e) => e.subjectId === filter.subjectId);
      return filter && filter.limit ? list.slice(0, filter.limit) : list;
    },
    /* --- retenção (RGPD art. 5.º, 1.º e): o que fica guardado durante quanto tempo ---
       Purga selectiva, com relatório do que foi removido e do que ficou. Nunca
       toca em contas, projectos, provas nem no evento de eliminação de conta.
       Um evento `retention_purged` é escrito ANTES da purga da auditoria, para
       que a própria purga fique registada. */
    retentionPolicy() {
      return {
        auditDays: Number(process.env.RETENTION_AUDIT_DAYS || 180),
        sessionDays: Number(process.env.RETENTION_SESSION_DAYS || 30),
        usageDays: Number(process.env.RETENTION_USAGE_DAYS || 90),
        note: 'aplica-se só a registos operacionais: auditoria, sessões terminadas/expiradas e uso de IA. Contas, projectos, provas e conclusões são do titular e só saem com a conta.'
      };
    },
    async purgeRetention(opts) {
      const dryRun = !!(opts && opts.dryRun);
      const pol = Object.assign(this.retentionPolicy(), (opts && opts.policy) || {});
      const limite = (dias) => Date.now() - dias * 24 * 3600e3;
      const velho = (iso, dias) => { const t = Date.parse(iso || ''); return Number.isFinite(t) && t < limite(dias); };
      const antes = {
        audit: db.audit.length, sessions: db.sessions.length, usage: db.usage.length
      };
      /* auditoria: mantém sempre o que seja prova de eliminação de conta e a
         própria purga anterior (nunca apagamos o rasto de que apagámos) */
      const auditMantidos = ['account_deleted', 'retention_purged'];
      const auditRemover = dryRun ? [] : db.audit.filter((e) => velho(e.at, pol.auditDays) && auditMantidos.indexOf(e.type) < 0);
      const sessionsRemover = dryRun ? [] : db.sessions.filter((s) =>
        (s.revokedAt || new Date(s.expiresAt).getTime() < Date.now()) && velho(s.revokedAt || s.expiresAt, pol.sessionDays));
      const usageRemover = dryRun ? [] : db.usage.filter((u) => velho(u.at, pol.usageDays));
      const contarAudit = dryRun ? db.audit.filter((e) => velho(e.at, pol.auditDays) && auditMantidos.indexOf(e.type) < 0).length : auditRemover.length;
      const contarSessions = dryRun ? db.sessions.filter((s) => (s.revokedAt || new Date(s.expiresAt).getTime() < Date.now()) && velho(s.revokedAt || s.expiresAt, pol.sessionDays)).length : sessionsRemover.length;
      const contarUsage = dryRun ? db.usage.filter((u) => velho(u.at, pol.usageDays)).length : usageRemover.length;
      if (!dryRun) {
        await this.audit({ type: 'retention_purged', actorId: null, action: 'retention',
          detail: { policy: pol, before: antes, removed: { audit: contarAudit, sessions: contarSessions, usage: contarUsage } } });
        const foraA = new Set(auditRemover.map((e) => e.id));
        const foraS = new Set(sessionsRemover.map((s) => s.id));
        const foraU = new Set(usageRemover.map((u) => u.id));
        db.audit = db.audit.filter((e) => !foraA.has(e.id));
        db.sessions = db.sessions.filter((s) => !foraS.has(s.id));
        db.usage = db.usage.filter((u) => !foraU.has(u.id));
        await persist();
      }
      return {
        dryRun, policy: pol,
        removed: { audit: contarAudit, sessions: contarSessions, usage: contarUsage },
        before: antes,
        after: { audit: db.audit.length, sessions: db.sessions.length, usage: db.usage.length },
        keptAlways: auditMantidos
      };
    },
    async count(name, n) {
      db.metrics.counters[name] = (db.metrics.counters[name] || 0) + (n == null ? 1 : n);
      persist();
    },
    counters() { return Object.assign({}, db.metrics.counters); },
    schemaVersion() { return db.version; },
    migrations() { return (db.migrations || []).slice(); },
    /* estado de integridade: o que foi recuperado, se há bloqueio, se é só-leitura */
    integrity() {
      return {
        file, root, checksum: fs_sync.existsSync(checksumFile),
        backups: (() => { try { return fs_sync.readdirSync(root).filter((f) => /^db-backup-.*\.json$/.test(f)).length; } catch { return 0; } })(),
        lock: { held: lockState.held, readOnly: lockState.readOnly, ownerPid: lockState.owner ? lockState.owner.pid : null, reason: lockState.reason },
        recovery: Object.assign({}, recovery),
        sizes: (() => {
          try { return { db: fs_sync.statSync(file).size, bytes: fs_sync.statSync(file).size }; } catch { return { db: 0 }; }
        })()
      };
    },
    readOnly() { return !!lockState.readOnly; },
    /* quantas escritas físicas aconteceram (para provar a coalescência) */
    writeStats() { return { escritas: escritas, geracao: geracao, debounceMs: DEBOUNCE_MS }; },
    /* saúde da escrita: usada por /ready para não declarar «pronto» o que não grava */
    storageHealth() { return Object.assign({}, saude); },
    /* Estado da persistência durável: é isto que /ready publica. Nada aqui é
       optimista — 'durable' só é true com gravação confirmada na base. */
    persistence() {
      return {
        mode: pgActive ? 'postgres+ficheiro' : 'ficheiro',
        durableBetweenDeploys: !!(pgActive && pgStore.ready),
        postgres: {
          configured: pgStore.enabled,
          active: pgActive,
          ready: pgStore.ready,
          version: pgVersion,
          host: pgStore.status.host,
          database: pgStore.status.database,
          ssl: pgStore.status.ssl,
          schemaReady: pgStore.status.schemaReady,
          writes: pgStore.status.writes,
          errors: pgStore.status.errors,
          lastWriteAt: pgStore.status.lastWriteAt,
          lastError: pgStore.status.lastError,
          latencyMs: pgStore.status.latencyMs
        },
        file: { dir: root, role: pgActive ? 'cópia de trabalho e cópias de segurança' : 'único armazenamento' }
      };
    },
    pg: pgStore,
    async close() {
      /* uma base só-de-leitura não tem nada para gravar: fechar não é erro */
      /* espera pela escrita em curso, se houver: fechar não pode perder o último lote */
      if (!lockState.readOnly) { try { await persist(); } catch { /* já registado em saude */ } }
      await pgStore.close();
      releaseLock();
    },
    persist
  };
}
