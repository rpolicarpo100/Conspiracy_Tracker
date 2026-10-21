/* VN · Exportação: relatório com referências às provas, modelo JSON, CSV,
   ficha de entidade e caminhos. Tudo autocontido e datado. */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});
  const D = VN.dom;
  const { el, esc, fmtDate, fmtRange, fmtMoney, fmtNum } = D;

  function fingerprint(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }

  function css() {
    return 'body{font:13px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b2431;background:#fff;max-width:980px;margin:32px auto;padding:0 20px}' +
      'h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 8px;border-bottom:1px solid #d9e0ea;padding-bottom:4px}' +
      'h3{font-size:13px;margin:16px 0 6px;text-transform:uppercase;letter-spacing:.05em;color:#5b6b82}' +
      'table{border-collapse:collapse;width:100%;margin:8px 0;font-size:12px}th,td{border:1px solid #dde3ec;padding:5px 7px;vertical-align:top;text-align:left}' +
      'th{background:#f3f6fa;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#48586e}' +
      'code,.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px}' +
      '.warn{border-left:3px solid #b45309;background:#fff8ec;padding:9px 12px;margin:12px 0;font-size:12px}' +
      '.badge{display:inline-block;padding:1px 6px;border-radius:99px;border:1px solid #cbd5e1;font-size:10px;letter-spacing:.02em}' +
      '.q{border-left:2px solid #cbd5e1;padding:2px 0 2px 9px;margin:5px 0;font-style:italic;color:#243040}' +
      '.meta{color:#5b6b82;font-size:11px}.ref{color:#0369a1;font-size:10.5px}.fg{font-size:11px;color:#5b6b82}' +
      'footer{margin-top:36px;border-top:1px solid #d9e0ea;padding-top:10px;font-size:11px;color:#5b6b82}' +
      '@media print{body{margin:0}h2{page-break-after:avoid}table{page-break-inside:auto}tr{page-break-inside:avoid}}';
  }

  function statusBadge(model, s) {
    const v = model.verification[s] || {};
    return '<span class="badge" style="border-color:' + (v.color || '#999') + ';color:' + (v.color || '#333') + '">' + esc(v.label || s) + '</span>';
  }

  function relsOfEntity(model, id) {
    return (model.neighbors.get(id) || []).slice().sort((a, b) => (b.statusWeight - a.statusWeight) || ((a.tStart || 0) - (b.tStart || 0)));
  }

  /* ---------- relatório principal ---------- */
  function buildReport(ctx, opts) {
    opts = opts || {};
    const { model, store } = ctx;
    const st = store.state;
    const masks = store.masks();
    const now = new Date();
    const scopeNodes = opts.all ? model.entities : Array.from(masks.nodes).map((id) => model.byId.get(id)).filter(Boolean);
    const entities = scopeNodes.slice().sort((a, b) => (model.stats.get(b.id).degree - model.stats.get(a.id).degree));
    const usedRelIds = new Set();
    const usedDocs = new Set();
    entities.forEach((e) => relsOfEntity(model, e.id).forEach((r) => {
      if (opts.all || masks.edges.has(r.id)) { usedRelIds.add(r.id); if (r.src) usedDocs.add(r.src); }
    }));
    const rels = Array.from(usedRelIds).map((id) => model.relById.get(id))
      .sort((a, b) => (a.tStart || 0) - (b.tStart || 0));

    const filterDesc = [];
    if (st.filters.types.size !== Object.keys(model.entityTypes).length) filterDesc.push('tipos: ' + Array.from(st.filters.types).map((t) => (model.entityTypes[t] || {}).label).join(', '));
    if (st.filters.families.size !== Object.keys(model.relationFamilies).length) filterDesc.push('famílias: ' + Array.from(st.filters.families).map((f) => (model.relationFamilies[f] || {}).label).join(', '));
    if (st.filters.statuses.size !== Object.keys(model.verification).length) filterDesc.push('estados: ' + Array.from(st.filters.statuses).map((s) => (model.verification[s] || {}).label).join(', '));
    if (st.filters.kinds.size) filterDesc.push('tipos de relação: ' + Array.from(st.filters.kinds).length);
    if (st.filters.sources.size) filterDesc.push('fontes: ' + Array.from(st.filters.sources).map((id) => (model.byId.get(id) || {}).name).join(', '));
    if (st.filters.yearFrom != null || st.filters.yearTo != null) filterDesc.push('período: ' + (st.filters.yearFrom != null ? st.filters.yearFrom : model.timeline.min) + '–' + (st.filters.yearTo != null ? st.filters.yearTo : model.timeline.max));
    if (st.filters.text) filterDesc.push('texto: "' + st.filters.text + '"');

    const h = [];
    h.push('<!DOCTYPE html><html lang="pt-PT"><head><meta charset="utf-8"><title>' + esc(model.meta.title) + ' — relatório</title><style>' + css() + '</style></head><body>');
    h.push('<h1>' + esc(model.meta.title) + '</h1>');
    h.push('<p class="meta">Relatório gerado em ' + now.toLocaleString('pt-PT') + ' · versão do modelo ' + esc(model.meta.version) +
      ' · impressão digital do conteúdo <code>' + fingerprint(JSON.stringify([entities.map((e) => e.id), rels.map((r) => r.id)])) + '</code></p>');
    h.push('<div class="warn"><b>' + (model.meta.fictional ? 'Proveniência não declarada.' : 'Dados reais sob verificação.') + '</b> ' + esc(model.meta.disclaimer) + '</div>');

    h.push('<h2>1. Âmbito e limitações</h2>');
    h.push('<table><tr><th>Entidades no relatório</th><td>' + entities.length + ' de ' + model.entities.length + '</td></tr>' +
      '<tr><th>Relações referenciadas</th><td>' + rels.length + ' de ' + model.relations.length + '</td></tr>' +
      '<tr><th>Documentos-fonte citados</th><td>' + usedDocs.size + '</td></tr>' +
      '<tr><th>Filtros aplicados</th><td>' + esc(filterDesc.join(' · ') || 'nenhum (rede completa carregada)') + '</td></tr>' +
      '<tr><th>Período</th><td>' + (st.filters.yearFrom != null || st.filters.yearTo != null ? esc((st.filters.yearFrom || model.timeline.min) + '–' + (st.filters.yearTo || model.timeline.max)) : 'todas as datas; relações sem data assinaladas individualmente') + '</td></tr>' +
      '<tr><th>Última acção no grafo</th><td>' + esc(st.lastAction || '—') + '</td></tr></table>');
    h.push('<p class="fg"><b>Como ler este relatório.</b> Cada afirmação é seguida de referências: <span class="ref">[R-nnn]</span> identifica a relação tipificada e <span class="ref">[D-nnn]</span> o documento que a sustenta. Estados de verificação: ' +
      Object.keys(model.verification).map((k) => statusBadge(model, k) + ' ' + esc(model.verification[k].label)).join(' · ') +
      '. Relações «alegadas», «não verificadas» ou «contraditadas» não são factos provados. A existência de ligações entre entidades não demonstra coordenação, intenção ou ilícito.</p>');

    h.push('<h2>2. Entidades</h2>');
    entities.forEach((e) => {
      const stt = model.stats.get(e.id);
      const relsE = relsOfEntity(model, e.id).filter((r) => usedRelIds.has(r.id));
      h.push('<h3>' + esc(e.name) + ' <span class="mono ref">[' + esc(e.id) + ']</span></h3>');
      h.push('<p class="meta">' + esc(e.typeLabel) + ' · estado: ' + statusBadge(model, e.status) +
        (e.juris ? ' · jurisdição ' + esc(e.juris) : '') + (e.date ? ' · ' + esc(fmtDate(e.date, e.precision)) : ' · data desconhecida') +
        ' · ' + stt.degree + ' ligações (' + stt.confirmed + ' confirmadas) · ' + stt.documents.size + ' documentos</p>');
      if (e.ctx) h.push('<p>' + esc(e.ctx) + '</p>');
      if ((e.facts || []).length) h.push('<p class="fg"><b>Factos documentados</b></p><ul>' + e.facts.map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>');
      if ((e.alleges || []).length) h.push('<p class="fg"><b>Alegações atribuídas (não provadas)</b></p><ul>' + e.alleges.map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>');
      if ((e.contradictions || []).length) h.push('<p class="fg"><b>Contra-provas e informação contraditória</b></p><ul>' + e.contradictions.map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>');
      if (relsE.length) {
        h.push('<table><tr><th>Relação</th><th>Período</th><th>Estado</th><th>Fonte e excerto</th></tr>');
        relsE.forEach((r) => {
          const outgoing = r.from === e.id;
          const other = outgoing ? r.toName : r.fromName;
          h.push('<tr><td>' + (outgoing ? esc(r.kindLabel) + ' → <b>' + esc(other) + '</b>' : '<b>' + esc(other) + '</b> ' + esc(r.kindLabel) + ' esta entidade') +
            ' <span class="ref">[' + esc(r.id) + ']</span></td>' +
            '<td>' + esc(fmtRange(r)) + '<br><span class="fg">' + esc(r.startPrecisionLabel) + '</span></td>' +
            '<td>' + statusBadge(model, r.status) + (typeof r.conf === 'number' ? '<br><span class="fg">confiança ' + r.conf + '/5</span>' : '') + '</td>' +
            '<td>' + (r.src ? esc((model.byId.get(r.src) || {}).name || r.src) + ' <span class="ref">[' + esc(r.src) + ']</span>' + (r.loc ? '<br><span class="fg">' + esc(r.loc) + '</span>' : '') +
              (r.ex ? '<div class="q">«' + esc(r.ex.replace(/^«|»$/g, '')) + '»</div>' : '<span class="fg">sem excerto</span>') : '<span class="fg">sem fonte documental</span>') + '</td></tr>');
        });
        h.push('</table>');
      }
    });

    h.push('<h2>3. Anexo A — Relações (registo completo)</h2>');
    h.push('<table><tr><th>ID</th><th>Origem</th><th>Tipo</th><th>Destino</th><th>Período</th><th>Estado</th><th>Conf.</th><th>Fonte</th><th>Excerto</th><th>Verificado em</th></tr>');
    rels.forEach((r) => {
      h.push('<tr><td class="mono">' + esc(r.id) + '</td><td>' + esc(r.fromName) + '</td><td>' + esc(r.kindLabel) + '</td><td>' + esc(r.toName) + '</td>' +
        '<td>' + esc(fmtRange(r)) + '</td><td>' + esc(r.statusLabel) + '</td><td>' + (r.conf != null ? r.conf : '—') + '</td>' +
        '<td>' + (r.src ? esc((model.byId.get(r.src) || {}).name || r.src) : '<i>nenhuma</i>') + '</td><td>' + esc(r.ex ? '«' + r.ex.replace(/^«|»$/g, '') + '»' : '—') + '</td><td>' + esc(r.lv || '—') + '</td></tr>');
    });
    h.push('</table>');

    h.push('<h2>4. Anexo B — Documentos citados</h2>');
    h.push('<table><tr><th>ID</th><th>Documento</th><th>Data</th><th>Descrição</th><th>Factos</th></tr>');
    Array.from(usedDocs).map((id) => model.byId.get(id)).filter(Boolean).forEach((d) => {
      h.push('<tr><td class="mono">' + esc(d.id) + '</td><td>' + esc(d.name) + '</td><td>' + esc(fmtDate(d.date, d.precision)) + '</td><td>' + esc(d.ctx || '') + '</td><td>' + esc((d.facts || []).join(' ')) + '</td></tr>');
    });
    h.push('</table>');

    h.push('<h2>5. Metodologia</h2>');
    h.push('<ul>' +
      '<li>Nenhuma relação é inferida por co-presença em página, fotografia ou lista de contactos.</li>' +
      '<li>Toda a relação confirmada exige documento-fonte e excerto; sem isso é marcada como não verificada.</li>' +
      '<li>Datas exactas, estimativas (mês/ano) e datas desconhecidas são distinguidas; relações sem data não são projectadas retroactivamente.</li>' +
      '<li>Imagens: apenas com crédito, licença e origem declarados. Sem imagem fiável, é usado avatar procedimental identificado.</li>' +
      '<li>Relações contraditadas por decisão judicial ou documento posterior permanecem visíveis e assinaladas.</li>' +
      '<li>Um caminho entre entidades indica a existência de relações registadas, não coordenação nem cumplicidade.</li>' +
      '</ul>');
    h.push('<footer>Gerado por VN · Rede de investigação visual. Este documento preserva as referências às provas: cada relação tem identificador estável, fonte, localização e excerto. ' +
      'A impressão digital permite detectar alterações posteriores ao conteúdo exportado.</footer>');
    h.push('</body></html>');
    return h.join('\n');
  }

  /* ---------- ficha de entidade ---------- */
  function buildEntity(ctx, id) {
    const { model } = ctx;
    const e = model.byId.get(id);
    if (!e) return '';
    const relsE = relsOfEntity(model, id);
    const h = [];
    h.push('<!DOCTYPE html><html lang="pt-PT"><head><meta charset="utf-8"><title>Ficha — ' + esc(e.name) + '</title><style>' + css() + '</style></head><body>');
    h.push('<h1>' + esc(e.name) + '</h1>');
    h.push('<p class="meta">' + esc(e.typeLabel) + ' · <span class="mono">' + esc(e.id) + '</span> · estado ' + statusBadge(model, e.status) +
      (e.date ? ' · ' + esc(fmtDate(e.date, e.precision)) : ' · data desconhecida') + ' · emitida em ' + new Date().toLocaleString('pt-PT') + '</p>');
    h.push('<div class="warn"><b>' + (model.meta.fictional ? 'Proveniência não declarada.' : 'Dados reais sob verificação.') + '</b> ' + esc(model.meta.disclaimer) + '</div>');
    if (e.ctx) h.push('<p>' + esc(e.ctx) + '</p>');
    if ((e.facts || []).length) h.push('<h2>Factos documentados</h2><ul>' + e.facts.map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>');
    if ((e.alleges || []).length) h.push('<h2>Alegações atribuídas</h2><ul>' + e.alleges.map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>');
    if ((e.contradictions || []).length) h.push('<h2>Contra-provas</h2><ul>' + e.contradictions.map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>');
    h.push('<h2>Ligações documentadas (' + relsE.length + ')</h2><table><tr><th>ID</th><th>Relação</th><th>Período</th><th>Estado</th><th>Fonte</th><th>Excerto</th></tr>');
    relsE.forEach((r) => {
      h.push('<tr><td class="mono">' + esc(r.id) + '</td><td>' + esc(r.fromName + ' ' + r.kindLabel + ' ' + r.toName) + '</td><td>' + esc(fmtRange(r)) + '</td><td>' + statusBadge(model, r.status) +
        '</td><td>' + (r.src ? esc((model.byId.get(r.src) || {}).name || r.src) + ' <span class="ref">[' + esc(r.src) + ']</span>' : '<i>sem fonte</i>') +
        '</td><td>' + esc(r.ex ? '«' + r.ex.replace(/^«|»$/g, '') + '»' : '—') + '</td></tr>');
    });
    h.push('</table>');
    h.push('<h2>Origem da representação visual</h2><p class="meta">' + esc(JSON.stringify(VN.avatars.provenance(e))) + '</p>');
    h.push('<footer>Ficha gerada com referências a fontes. Ligações não verificadas estão assinaladas e não devem ser citadas como factos.</footer></body></html>');
    return h.join('\n');
  }

  /* ---------- caminhos ---------- */
  function buildPaths(ctx) {
    const { model, store } = ctx;
    const p = store.state.path;
    if (!p.results) return null;
    const h = [];
    h.push('<!DOCTYPE html><html lang="pt-PT"><head><meta charset="utf-8"><title>Caminhos documentados</title><style>' + css() + '</style></head><body>');
    h.push('<h1>Caminhos entre ' + esc((model.byId.get(p.a) || {}).name) + ' e ' + esc((model.byId.get(p.b) || {}).name) + '</h1>');
    h.push('<p class="meta">Até ' + p.maxSteps + ' passos · ' + p.results.paths.length + ' caminhos · gerado em ' + new Date().toLocaleString('pt-PT') + '</p>');
    h.push('<div class="warn"><b>Leitura correcta.</b> Um caminho demonstra apenas que existem relações registadas entre as entidades. Não é prova de coordenação, acordo, intenção ou cumplicidade. A nota de evidência avalia a documentação das ligações.</div>');
    p.results.paths.forEach((path, i) => {
      h.push('<h2>#' + (i + 1) + ' · ' + path.hops + ' passos · evidência ' + path.score + ' · elo mais fraco: ' + esc((model.verification[path.minStatus] || {}).label) + '</h2>');
      h.push('<table><tr><th>#</th><th>Origem</th><th>Relação</th><th>Destino</th><th>Período</th><th>Estado</th><th>Fonte</th><th>Excerto</th></tr>');
      path.rels.forEach((r, k) => {
        h.push('<tr><td>' + (k + 1) + '</td><td>' + esc(r.fromName) + '</td><td>' + esc(r.kindLabel) + ' <span class="ref">[' + esc(r.id) + ']</span></td><td>' + esc(r.toName) +
          '</td><td>' + esc(fmtRange(r)) + '</td><td>' + statusBadge(model, r.status) + '</td>' +
          '<td>' + (r.src ? esc((model.byId.get(r.src) || {}).name || r.src) + ' <span class="ref">[' + esc(r.src) + ']</span>' : '<i>sem fonte</i>') + '</td>' +
          '<td>' + esc(r.ex ? '«' + r.ex.replace(/^«|»$/g, '') + '»' : '—') + '</td></tr>');
      });
      h.push('</table>');
    });
    h.push('<footer>VN · exportação de caminhos com referências.</footer></body></html>');
    return h.join('\n');
  }

  /* ---------- CSV ---------- */
  function buildCSV(ctx) {
    const { model, store } = ctx;
    const masks = store.masks();
    const rows = [['relacao_id', 'origem_id', 'origem', 'tipo_relacao', 'familia', 'destino_id', 'destino', 'dirigida',
      'inicio', 'precisao_inicio', 'fim', 'estado_verificacao', 'confianca', 'justificacao', 'fonte_id', 'fonte',
      'localizacao', 'excerto', 'montante', 'moeda', 'verificado_em']];
    model.relations.forEach((r) => {
      rows.push([r.id, r.from, r.fromName, r.kind, r.family, r.to, r.toName, r.directed ? 'sim' : 'nao',
        r.start || '', r.startPrec || '', r.end || '', r.status, r.conf != null ? r.conf : '',
        r.why || '', r.src || '', r.src ? ((model.byId.get(r.src) || {}).name || '') : '', r.loc || '',
        r.ex || '', r.amount != null ? r.amount : '', r.currency || '', r.lv || '']);
    });
    const q = (v) => {
      const s = String(v == null ? '' : v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '\ufeff' + rows.map((r) => r.map(q).join(';')).join('\r\n');
  }

  function buildJSON(ctx) {
    const { model, store } = ctx;
    const st = store.state;
    const masks = store.masks();
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      generator: 'VN · Rede de investigação visual',
      meta: model.meta,
      scope: {
        nodes: Array.from(masks.nodes), edges: Array.from(masks.edges),
        filters: {
          types: Array.from(st.filters.types), families: Array.from(st.filters.families),
          statuses: Array.from(st.filters.statuses), kinds: Array.from(st.filters.kinds),
          sources: Array.from(st.filters.sources), yearFrom: st.filters.yearFrom, yearTo: st.filters.yearTo,
          text: st.filters.text, docsOnly: st.filters.docsOnly
        },
        lastAction: st.lastAction, trail: (st.trail || []).slice(-30)
      },
      entities: model.entities.map((e) => ({
        id: e.id, type: e.type, name: e.name, short: e.short, ctx: e.ctx, status: e.status,
        juris: e.juris, date: e.date, precision: e.precision, aliases: e.aliases, tags: e.tags,
        facts: e.facts, alleges: e.alleges, contradictions: e.contradictions,
        visual: e.visual, degree: model.stats.get(e.id).degree
      })),
      relations: model.relations,
      validation: model.validation,
      paths: st.path.results || null
    }, null, 2);
  }

  VN.report = { buildReport, buildEntity, buildPaths, buildCSV, buildJSON, fingerprint, relsOfEntity };
})(typeof window !== 'undefined' ? window : globalThis);
