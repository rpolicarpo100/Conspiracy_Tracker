/* =====================================================================
   MEMÓRIA DA INVESTIGAÇÃO — o que não pode depender de alguém se lembrar.

   Uma investigação longa perde-se em três sítios: nas decisões que ninguém
   registou, no vocabulário que cada pessoa usa à sua maneira e nas lacunas
   que se esquecem. Esta memória é um registo **append-only** (editar guarda
   histórico; arquivar exige motivo) e tem uma proibição explícita:

     uma entrada de memória NUNCA altera o estado de uma conclusão nem cria
     provas. Serve para explicar, não para provar.

   Tipos: nota, decisao, glossario, lacuna, correcao.
   ===================================================================== */
import crypto from 'node:crypto';

export const MEMORY_KINDS = {
  nota: { label: 'Nota', hint: 'observação de trabalho que deve sobreviver à sessão' },
  decisao: { label: 'Decisão', hint: 'o que se decidiu, porquê, e o que ficou de fora' },
  glossario: { label: 'Glossário', hint: 'o que um termo significa NESTA investigação' },
  lacuna: { label: 'Lacuna', hint: 'o que falta e como se resolve' },
  correcao: { label: 'Correcção', hint: 'erro detectado e a sua correcção, com data' }
};

export const MEMORY_LIMITS = { body: 8000, title: 200, tags: 8, entriesPerProject: 500 };

export function validateMemory(input, opts) {
  const errors = [];
  const kind = String(input.kind || 'nota');
  if (!MEMORY_KINDS[kind]) errors.push('tipo de memória desconhecido (use um de: ' + Object.keys(MEMORY_KINDS).join(', ') + ')');
  const title = String(input.title || '').trim().slice(0, MEMORY_LIMITS.title);
  const body = String(input.body || '').trim().slice(0, MEMORY_LIMITS.body);
  if (title.length < 3) errors.push('o título precisa de pelo menos 3 caracteres');
  if (body.length < 3) errors.push('o corpo precisa de pelo menos 3 caracteres');
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.map((t) => String(t).trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, MEMORY_LIMITS.tags)
    : [];
  /* uma decisão sem motivo é uma ordem, não uma decisão */
  const reason = String(input.reason || '').trim().slice(0, 2000);
  if (kind === 'decisao' && reason.length < 10) errors.push('uma decisão exige o motivo escrito (mínimo 10 caracteres)');
  if (kind === 'correcao' && reason.length < 10) errors.push('uma correcção exige o que estava errado e o que passou a estar certo (mínimo 10 caracteres)');
  const links = {
    evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds.slice(0, 30).map(String) : [],
    claimIds: Array.isArray(input.claimIds) ? input.claimIds.slice(0, 30).map(String) : [],
    relationIds: Array.isArray(input.relationIds) ? input.relationIds.slice(0, 30).map(String) : [],
    runIds: Array.isArray(input.runIds) ? input.runIds.slice(0, 30).map(String) : []
  };
  const pinned = input.pinned === true;
  if (opts && opts.count >= MEMORY_LIMITS.entriesPerProject) errors.push('limite de ' + MEMORY_LIMITS.entriesPerProject + ' entradas de memória por projecto');
  return {
    ok: errors.length === 0, errors,
    note: { kind, title, body, tags, reason: reason || null, links, pinned }
  };
}

/* a memória exporta-se para Markdown para poder entrar num relatório ou num arquivo */
export function memoryToMarkdown(notes, opts) {
  const active = (notes || []).filter((n) => !n.archivedAt);
  const archived = (notes || []).filter((n) => n.archivedAt);
  const byKind = {};
  active.forEach((n) => { (byKind[n.kind] = byKind[n.kind] || []).push(n); });
  const out = [];
  out.push('# Memória da investigação' + (opts && opts.projectTitle ? ' — ' + opts.projectTitle : ''));
  out.push('');
  out.push('_Registo de trabalho: explica decisões e lacunas. Não prova nada por si: as provas estão no registo de provas._');
  out.push('');
  Object.keys(MEMORY_KINDS).forEach((k) => {
    const list = byKind[k];
    if (!list || !list.length) return;
    out.push('## ' + MEMORY_KINDS[k].label + ' (' + list.length + ')');
    out.push('');
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    list.forEach((n) => {
      out.push('### ' + n.title + (n.pinned ? '  📌' : ''));
      out.push('_data: ' + String(n.createdAt).slice(0, 10) + (n.tags && n.tags.length ? ' · etiquetas: ' + n.tags.join(', ') : '') + '_');
      out.push('');
      out.push(n.body);
      if (n.reason) out.push('\n**Motivo / fundamento:** ' + n.reason);
      const l = n.links || {};
      const refs = []
        .concat((l.evidenceIds || []).map((id) => 'prova ' + id))
        .concat((l.claimIds || []).map((id) => 'conclusão ' + id))
        .concat((l.relationIds || []).map((id) => 'relação ' + id))
        .concat((l.runIds || []).map((id) => 'execução ' + id));
      if (refs.length) out.push('\n**Ligações:** ' + refs.join(' · '));
      out.push('');
    });
  });
  if (archived.length) {
    out.push('## Entradas arquivadas (' + archived.length + ')');
    out.push('');
    archived.forEach((n) => out.push('- ' + String(n.createdAt).slice(0, 10) + ' · ' + n.title + ' — motivo: ' + (n.archiveReason || '(sem motivo registado)')));
    out.push('');
  }
  return out.join('\n');
}

