/* =====================================================================
   VN · LIVRO DE PROVAS (evidence ledger)
   Registo append-only, com hash encadeado, para que qualquer alteração
   posterior seja detectável. Cada entrada descreve uma operação sobre
   provas: recolha, verificação, refutação, registo negativo.
   Não substitui assinatura digital; torna a manipulação evidente.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});

  function canonical(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
    return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
  }

  /* SHA-256 quando disponível (WebCrypto / Node); fallback FNV-1a 64 (não criptográfico, marcado como tal). */
  async function hash(text) {
    if (g.crypto && g.crypto.subtle && g.TextEncoder) {
      const buf = await g.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return { algo: 'sha256', value: Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('') };
    }
    const nodeCrypto = (!g.crypto && typeof require === 'function') ? require('crypto') : null;
    if (nodeCrypto) return { algo: 'sha256', value: nodeCrypto.createHash('sha256').update(text).digest('hex') };
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < text.length; i++) {
      h1 ^= text.charCodeAt(i); h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= text.charCodeAt(i) + i; h2 = Math.imul(h2, 0x01000193) >>> 0;
    }
    return { algo: 'fnv1a64-fallback', value: h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') };
  }

  function create(caseId) {
    const ledger = { caseId: caseId, version: 1, createdAt: new Date().toISOString(), entries: [], head: null };

    async function append(entry) {
      const prev = ledger.entries.length ? ledger.entries[ledger.entries.length - 1] : null;
      const base = {
        n: ledger.entries.length + 1,
        at: new Date().toISOString(),
        prev: prev ? prev.hash : null,
        type: entry.type,
        actor: entry.actor || 'investigador',
        subject: entry.subject || null,
        payload: entry.payload || {},
        note: entry.note || ''
      };
      const h = await hash(canonical(base));
      const full = Object.assign(base, { hash: h.value, algo: h.algo });
      ledger.entries.push(full);
      ledger.head = full.hash;
      return full;
    }

    async function verify() {
      let prev = null, ok = true;
      const problems = [];
      for (const e of ledger.entries) {
        const copy = Object.assign({}, e); delete copy.hash; delete copy.algo;
        const h = await hash(canonical(copy));
        if (h.value !== e.hash) { ok = false; problems.push({ n: e.n, msg: 'hash não corresponde ao conteúdo' }); }
        if (e.prev !== prev) { ok = false; problems.push({ n: e.n, msg: 'encadeamento quebrado' }); }
        prev = e.hash;
      }
      return { ok: ok, entries: ledger.entries.length, problems: problems, head: ledger.head };
    }

    return { ledger, append, verify, hash, canonical };
  }

  VN.ledger = { create, hash, canonical };
})(typeof window !== 'undefined' ? window : globalThis);
