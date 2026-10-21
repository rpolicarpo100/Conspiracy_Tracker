/* =====================================================================
   VN · REPRESENTAÇÕES VISUAIS
   Nunca inventa fotografias. Três modos, todos com proveniência:
     kind:'image'  -> fotografia real fornecida, com crédito + licença
     kind:'logo'   -> marca desenhada localmente, declarada como não oficial
     kind:'procedural' -> avatar gerado localmente a partir do tipo
   Qualquer falha de carregamento cai para o avatar procedimental.
   ===================================================================== */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});

  const GLYPH = {
    person: '<circle cx="16" cy="11" r="4.6"/><path d="M6.5 27c0-5.2 4.3-8.4 9.5-8.4s9.5 3.2 9.5 8.4" fill="none" stroke-width="2.6"/>',
    building: '<rect x="7" y="9" width="18" height="19" rx="1.5" fill="none" stroke-width="2.4"/><path d="M12 14h3M17 14h3M12 19h3M17 19h3M14 28v-4h4v4" stroke-width="2.2" fill="none"/>',
    foundation: '<path d="M16 7l9 7v2H7v-2z"/><path d="M9 17v9M16 17v9M23 17v9M7 28h18" fill="none" stroke-width="2.4"/>',
    group: '<circle cx="10" cy="12" r="3.4"/><circle cx="22" cy="12" r="3.4"/><circle cx="16" cy="20" r="3.4"/><path d="M4 27c1-4 4-6 8-6M28 27c-1-4-4-6-8-6" fill="none" stroke-width="2.2"/>',
    state: '<path d="M16 6l2.8 5.8 6.2.9-4.5 4.4 1 6.2-5.5-3-5.5 3 1-6.2L7 12.7l6.2-.9z"/><path d="M7 24h18v4H7z" fill="none" stroke-width="2.2"/>',
    church: '<path d="M16 5v7M12 8h8" stroke-width="2.4"/><path d="M16 12l8 6v11H8V18z" fill="none" stroke-width="2.4"/><path d="M13 29v-7a3 3 0 016 0v7" fill="none" stroke-width="2.2"/>',
    court: '<path d="M4 11h24M16 6v5M8 11l-4 9h8zM24 11l-4 9h8z" fill="none" stroke-width="2.2"/><path d="M8 27h16M12 27v-4h8v4" fill="none" stroke-width="2.2"/>',
    page: '<path d="M9 6h11l5 5v19H9z" fill="none" stroke-width="2.4"/><path d="M20 6v5h5M12 17h10M12 21h10M12 25h6" fill="none" stroke-width="2"/>',
    event: '<rect x="6" y="9" width="20" height="20" rx="2" fill="none" stroke-width="2.4"/><path d="M6 15h20M11 6v5M21 6v5" stroke-width="2.2"/><circle cx="16" cy="22" r="2.6"/>',
    money: '<circle cx="16" cy="16" r="10" fill="none" stroke-width="2.4"/><path d="M16 9v14M12.6 12.5h5.2a2.6 2.6 0 010 5.2h-3.6a2.6 2.6 0 000 5.2h5.2" fill="none" stroke-width="2.2"/>'
  };

  function initials(name, monogram) {
    if (monogram) return monogram.slice(0, 3).toUpperCase();
    const stop = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'para', 'the']);
    const parts = String(name).replace(/[.,]/g, '').split(/\s+/).filter((w) => w && !stop.has(w.toLowerCase()));
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function shade(hex, amount) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
    r = Math.max(0, Math.min(255, Math.round(r + amount)));
    gg = Math.max(0, Math.min(255, Math.round(gg + amount)));
    b = Math.max(0, Math.min(255, Math.round(b + amount)));
    return '#' + ((r << 16) | (gg << 8) | b).toString(16).padStart(6, '0');
  }

  const MARK = {
    // marcas desenhadas: geometria abstracta, declarada como não oficial (nunca imita insígnias reais)
    hex: (c) => '<path d="M32 12l17 10v20L32 52 15 42V22z" fill="none" stroke="' + c + '" stroke-width="3"/>',
    orbit: (c) => '<circle cx="32" cy="32" r="17" fill="none" stroke="' + c + '" stroke-width="3"/><ellipse cx="32" cy="32" rx="24" ry="9" fill="none" stroke="' + c + '" stroke-width="2" opacity=".7"/>',
    bars: (c) => '<path d="M20 44V30M32 44V20M44 44V26" stroke="' + c + '" stroke-width="4" stroke-linecap="round"/>',
    wave: (c) => '<path d="M12 36c6-12 10 12 16 0s10 12 16 0" fill="none" stroke="' + c + '" stroke-width="3"/>',
    ring: (c) => '<circle cx="32" cy="32" r="16" fill="none" stroke="' + c + '" stroke-width="3"/><circle cx="32" cy="32" r="6" fill="' + c + '"/>',
    arch: (c) => '<path d="M18 46V30a14 14 0 0128 0v16" fill="none" stroke="' + c + '" stroke-width="3"/>'
  };

  function badge(status, verification) {
    const v = (verification || {})[status] || {};
    const color = v.color || '#94a3b8';
    const letter = v.short || '?';
    return '<g transform="translate(43,43)"><circle r="8.5" fill="#0b1220" stroke="' + color + '" stroke-width="2"/>' +
      '<text y="3.6" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="9" font-weight="700" fill="' + color + '">' + letter + '</text></g>';
  }

  /* SVG do avatar. size define o atributo width/height (o viewBox é fixo 64). */
  function svg(entity, opts) {
    opts = opts || {};
    const size = opts.size || 64;
    const v = entity.visual || {};
    const typeColor = entity.typeColor || '#94a3b8';
    const dark = shade(typeColor, -120);
    const light = shade(typeColor, 40);
    const glyph = GLYPH[(VN_DATA.entityTypes[entity.type] || {}).glyph] || GLYPH.page;
    const initialsText = initials(entity.name, v.monogram);
    const dashed = entity.status === 'unverified' || entity.status === 'alleged' ? ' stroke-dasharray="5 3"' : '';
    const uid = 'g' + String(entity.id).replace(/[^a-z0-9]/gi, '');

    let artwork;
    if (v.kind === 'logo') {
      const mark = (MARK[v.mark] || MARK.hex)(light);
      artwork = '<rect x="2" y="2" width="60" height="60" rx="16" fill="url(#' + uid + ')"/>' +
        '<g opacity=".95">' + mark + '</g>' +
        '<text x="32" y="52" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="10" font-weight="700" fill="#e2e8f0" letter-spacing=".5">' + initialsText + '</text>';
    } else if (v.kind === 'image' && (v.src || v.dataUri)) {
      const href = v.src || v.dataUri;
      artwork = '<image href="' + href + '" x="3" y="3" width="58" height="58" preserveAspectRatio="xMidYMid slice" clip-path="url(#' + uid + 'c)"/>' +
        '<rect x="3" y="3" width="58" height="58" fill="none" stroke="' + light + '" stroke-width="1.4" clip-path="url(#' + uid + 'c)"/>';
    } else {
      artwork = '<rect x="2" y="2" width="60" height="60" rx="16" fill="url(#' + uid + ')"/>' +
        '<g opacity=".16" transform="translate(14,13) scale(1.1)" fill="#fff" stroke="#fff">' + glyph + '</g>' +
        '<text x="32" y="40" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="20" font-weight="700" fill="#f8fafc" letter-spacing=".6">' + initialsText + '</text>';
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 64 64" role="img" aria-label="' +
      String(entity.name).replace(/"/g, '&quot;') + '">' +
      '<defs>' +
      '<linearGradient id="' + uid + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + dark + '"/><stop offset="1" stop-color="' + shade(typeColor, -55) + '"/></linearGradient>' +
      '<clipPath id="' + uid + 'c"><rect x="3" y="3" width="58" height="58" rx="15"/></clipPath>' +
      '</defs>' +
      artwork +
      '<rect x="2" y="2" width="60" height="60" rx="16" fill="none" stroke="' + typeColor + '" stroke-width="2"' + dashed + '/>' +
      badge(entity.status, VN_DATA.verification) +
      '</svg>';
  }

  function dataUri(entity, size) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(entity, { size: size || 64 }));
  }

  /* Proveniência legível, mostrada no painel de detalhes. */
  function provenance(entity) {
    const v = entity.visual || {};
    if (v.kind === 'image') return {
      kind: 'Fotografia fornecida', src: v.src || v.dataUri, credit: v.credit || '—',
      licence: v.licence || 'não declarada', source: v.source || '—', verified: !!v.verified
    };
    if (v.kind === 'logo') return {
      kind: 'Marca não oficial', src: null, credit: v.credit || 'Marca abstracta gerada localmente',
      licence: v.licence || 'CC0-1.0', source: v.source || 'gerador local (avatars.js)', verified: false
    };
    return {
      kind: 'Avatar procedimental', src: null,
      credit: v.credit || 'Representação gerada localmente — não é fotografia',
      licence: v.licence || 'CC0-1.0', source: v.source || 'vn-avatar-generator', verified: false
    };
  }

  VN.avatars = { svg, dataUri, provenance, initials };
})(typeof window !== 'undefined' ? window : globalThis);
