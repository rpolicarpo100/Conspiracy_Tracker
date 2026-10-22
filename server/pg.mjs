/* =====================================================================
   PERSISTÊNCIA DURÁVEL EM POSTGRES (Neon / Supabase / qualquer Postgres)

   Porque existe: o armazenamento em ficheiro (server/store.mjs) é bom
   enquanto o processo vive, mas no plano gratuito do Render o disco é
   apagado em cada deploy. Este módulo guarda o MESMO documento JSON numa
   base gerida, para que os dados sobrevivam a deploy, reinício de
   instância e troca de máquina.

   Modelo escolhido, e porquê:
     · um documento (a base inteira) numa linha de `vn_state`, em jsonb —
       a forma do documento não muda, não há migração de esquema a cada
       campo novo, e a leitura é uma consulta;
     · concorrência optimista: cada gravação leva o número de versão que
       leu; se outra instância escreveu entretanto, a gravação falha com
       conflito em vez de sobrepor dados alheios;
     · auditoria também em tabela append-only (`vn_audit`), porque é o
       registo que tem de sobreviver mesmo a um documento corrompido;
     · nenhuma escrita silenciosa: se o Postgres está configurado e falha,
       a operação falha — é preferível um erro a dizer «gravado» quando
       não está.

   Variável: DATABASE_URL (ex.: postgresql://…/neondb?sslmode=require).
   Sem ela, o módulo fica desligado e o comportamento anterior mantém-se.
   ===================================================================== */
import pg from 'pg';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS vn_state (
     id         text PRIMARY KEY,
     version    bigint NOT NULL,
     doc        jsonb  NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now(),
     written_by text
   )`,
  `CREATE TABLE IF NOT EXISTS vn_audit (
     seq        bigserial PRIMARY KEY,
     at         timestamptz NOT NULL DEFAULT now(),
     type       text NOT NULL,
     actor_id   text,
     subject_id text,
     action     text,
     ip         text,
     detail     jsonb NOT NULL DEFAULT '{}'::jsonb
   )`,
  `CREATE INDEX IF NOT EXISTS vn_audit_type_at ON vn_audit (type, at DESC)`,
  `CREATE TABLE IF NOT EXISTS vn_snapshot (
     id         bigserial PRIMARY KEY,
     version    bigint NOT NULL,
     at         timestamptz NOT NULL DEFAULT now(),
     doc        jsonb NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS vn_snapshot_at ON vn_snapshot (at DESC)`
];

/* Normaliza o URL para que a verificação do certificado seja explícita.
   Com `sslmode=require` o driver aceita o certificado mas avisa que o
   significado vai mudar (pg 9 / libpq); escrever `verify-full` diz o que
   queremos de facto: certificado válido, sem atalhos. */
export function normalizarUrl( bruto ) {
  if (!bruto) return bruto;
  try {
    const u = new URL(bruto);
    const modo = (u.searchParams.get('sslmode') || '').toLowerCase();
    if (modo === 'require' || modo === 'prefer' || modo === 'verify-ca' || modo === '') {
      u.searchParams.set('sslmode', 'verify-full');
    }
    return u.toString();
  } catch { return bruto; }
}

export function createPgStore(connectionString, opts) {
  opts = opts || {};
  const url = normalizarUrl(connectionString || process.env.DATABASE_URL || '');
  const enabled = !!url && url !== 'off';
  const SNAPSHOTS = opts.snapshots == null ? 14 : opts.snapshots;
  const status = {
    configured: enabled, ok: false, version: null, writes: 0, errors: 0,
    lastWriteAt: null, lastError: null, latencyMs: null, snapshots: SNAPSHOTS,
    host: null, database: null, ssl: null, schemaReady: false
  };
  let pool = null;
  let writeInFlight = null;

  function describe() {
    if (!enabled) return;
    try {
      const u = new URL(url);
      status.host = u.hostname;
      status.database = u.pathname.replace(/^\//, '') || null;
      status.ssl = (u.searchParams.get('sslmode') || 'require').toLowerCase();
    } catch { /* URL inválida: a ligação falhará e o erro é devolvido */ }
  }
  describe();

  function client() {
    if (!pool) {
      pool = new pg.Pool({
        connectionString: url,
        /* cadeia de certificados do sistema: Neon e Supabase usam CA pública.
           rejectUnauthorized:true significa que um certificado inválido
           impede a ligação — não se aceita TLS «de fachada». */
        ssl: { rejectUnauthorized: true },
        max: 4,
        idleTimeoutMillis: 20000,
        connectionTimeoutMillis: 12000,
        application_name: 'vn-conspiracy-tracker'
      });
      pool.on('error', (e) => { status.errors++; status.lastError = String(e.message || e); });
    }
    return pool;
  }

  async function q(sql, params) {
    const t0 = Date.now();
    try {
      const r = await client().query(sql, params);
      status.latencyMs = Date.now() - t0;
      status.ok = true;
      return r;
    } catch (e) {
      status.ok = false;
      status.errors++;
      status.lastError = String(e.message || e).slice(0, 300);
      throw e;
    }
  }

  async function init() {
    if (!enabled) return status;
    try {
      for (const sql of SCHEMA) await q(sql);
      status.schemaReady = true;
      status.ok = true;
    } catch (e) {
      status.ok = false;
      throw e;
    }
    return status;
  }

  /* devolve { doc, version, updatedAt, writtenBy } ou null se ainda não há nada */
  async function load() {
    if (!enabled) return null;
    const r = await q('SELECT doc, version, updated_at, written_by FROM vn_state WHERE id = $1', ['main']);
    if (!r.rows.length) { status.version = null; return null; }
    const row = r.rows[0];
    status.version = Number(row.version);
    return { doc: row.doc, version: Number(row.version), updatedAt: row.updated_at, writtenBy: row.written_by };
  }

  /* Gravação com versão esperada. `expected` null = inserção inicial.
     Devolve a nova versão. Lança em conflito ou em falha de rede. */
  async function save(doc, expected, writtenBy) {
    if (!enabled) return null;
    const dados = JSON.stringify(doc);
    const run = async () => {
      if (expected == null) {
        const r = await q(
          `INSERT INTO vn_state (id, version, doc, updated_at, written_by)
           VALUES ('main', 1, $1::jsonb, now(), $2)
           ON CONFLICT (id) DO NOTHING
           RETURNING version`, [dados, writtenBy || 'api']);
        if (!r.rows.length) {
          const cur = await q('SELECT version FROM vn_state WHERE id = $1', ['main']);
          throw conflito(cur.rows[0] ? Number(cur.rows[0].version) : 0);
        }
        status.version = Number(r.rows[0].version);
      } else {
        const r = await q(
          `UPDATE vn_state SET doc = $1::jsonb, version = version + 1, updated_at = now(), written_by = $3
           WHERE id = 'main' AND version = $2
           RETURNING version`, [dados, expected, writtenBy || 'api']);
        if (!r.rows.length) {
          const cur = await q('SELECT version FROM vn_state WHERE id = $1', ['main']);
          throw conflito(cur.rows[0] ? Number(cur.rows[0].version) : 0);
        }
        status.version = Number(r.rows[0].version);
      }
      status.writes++;
      status.lastWriteAt = new Date().toISOString();
      status.lastError = null;
      return status.version;
    };
    /* uma só gravação de cada vez por processo: o documento é o mesmo, não
       faz sentido escrever duas versões a partir da mesma memória */
    const anterior = writeInFlight || Promise.resolve();
    const atual = anterior.catch(() => {}).then(run);
    writeInFlight = atual;
    try { return await atual; } finally { if (writeInFlight === atual) writeInFlight = null; }
  }

  function conflito(versaoNaBase) {
    const e = new Error('conflito de versão na base: a base está na versão ' + versaoNaBase +
      ' e esta instância tentou gravar sobre outra. Nada foi escrito — recarregue para ver o estado actual.');
    e.status = 409;
    e.code = 'PG_VERSION_CONFLICT';
    e.currentVersion = versaoNaBase;
    status.errors++;
    status.lastError = e.message;
    return e;
  }

  async function appendAudit(event) {
    if (!enabled) return;
    try {
      await q(`INSERT INTO vn_audit (at, type, actor_id, subject_id, action, ip, detail)
               VALUES (COALESCE($1::timestamptz, now()), $2, $3, $4, $5, $6, $7::jsonb)`,
        [event.at || null, String(event.type || 'unknown'), event.actorId || null, event.subjectId || null,
          event.action || null, event.ip || null, JSON.stringify(event.detail || {})]);
    } catch (e) {
      /* a auditoria em tabela não pode derrubar o pedido: o evento já está no
         documento e no ficheiro local. O erro fica contado em /ready. */
      console.error('[pg] auditoria não gravada:', e.message);
    }
  }

  async function auditTail(limit) {
    if (!enabled) return [];
    try {
      const r = await q('SELECT at, type, actor_id, subject_id, action, ip, detail FROM vn_audit ORDER BY seq DESC LIMIT $1',
        [Math.min(1000, Math.max(1, Number(limit) || 50))]);
      return r.rows.map((x) => ({ at: x.at, type: x.type, actorId: x.actor_id, subjectId: x.subject_id, action: x.action, ip: x.ip, detail: x.detail }));
    } catch { return []; }
  }

  /* Cópia pontual do documento (recuperação a partir de um ponto no tempo). */
  async function snapshot(version) {
    if (!enabled) return null;
    const r = await q('SELECT doc, version FROM vn_state WHERE id = $1', ['main']);
    if (!r.rows.length) return null;
    await q('INSERT INTO vn_snapshot (version, doc) VALUES ($1, $2::jsonb)', [r.rows[0].version, JSON.stringify(r.rows[0].doc)]);
    await q(`DELETE FROM vn_snapshot WHERE id NOT IN (SELECT id FROM vn_snapshot ORDER BY at DESC LIMIT $1)`, [SNAPSHOTS]);
    return { version: Number(r.rows[0].version), kept: SNAPSHOTS };
  }

  async function snapshots() {
    if (!enabled) return [];
    try {
      const r = await q('SELECT id, version, at, pg_column_size(doc) AS bytes FROM vn_snapshot ORDER BY at DESC LIMIT 50');
      return r.rows.map((x) => ({ id: Number(x.id), version: Number(x.version), at: x.at, bytes: Number(x.bytes) }));
    } catch { return []; }
  }

  async function restoreSnapshot(id) {
    if (!enabled) return null;
    const r = await q('SELECT doc, version FROM vn_snapshot WHERE id = $1', [Number(id)]);
    if (!r.rows.length) return null;
    const alvo = r.rows[0];
    const atual = await q('SELECT version FROM vn_state WHERE id = $1', ['main']);
    const versaoAtual = atual.rows.length ? Number(atual.rows[0].version) : 0;
    const up = await q(
      `UPDATE vn_state SET doc = $1::jsonb, version = version + 1, updated_at = now(), written_by = $3
       WHERE id = 'main' AND version = $2 RETURNING version`,
      [JSON.stringify(alvo.doc), versaoAtual, 'restore-snapshot-' + id]);
    if (!up.rows.length) throw conflito(versaoAtual);
    return { fromSnapshot: Number(id), snapshotVersion: Number(alvo.version), newVersion: Number(up.rows[0].version) };
  }

  /* Sonda usada por /ready: mede a base agora, sem escrever nada. */
  async function probe() {
    if (!enabled) return Object.assign({}, status, { enabled: false });
    const t0 = Date.now();
    try {
      const r = await q("SELECT current_database() AS db, (SELECT version FROM vn_state WHERE id='main') AS v, now() AS at");
      status.latencyMs = Date.now() - t0;
      return Object.assign({}, status, {
        enabled: true, ok: true, database: r.rows[0].db,
        version: r.rows[0].v == null ? null : Number(r.rows[0].v),
        serverTime: r.rows[0].at, latencyMs: status.latencyMs
      });
    } catch (e) {
      return Object.assign({}, status, { enabled: true, ok: false, latencyMs: Date.now() - t0, lastError: String(e.message || e).slice(0, 300) });
    }
  }

  async function close() {
    if (pool) { await pool.end().catch(() => {}); pool = null; }
  }

  return {
    enabled, status, init, load, save, appendAudit, auditTail,
    snapshot, snapshots, restoreSnapshot, probe, close,
    get ready() { return enabled && status.ok && status.schemaReady; }
  };
}
