/* VN · utilitários de DOM e formatação (sem dependências) */
(function (g) {
  'use strict';
  const VN = (g.VN = g.VN || {});

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : children != null ? [children] : []).forEach((c) => {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  }
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function fmtDate(d, precision) {
    if (!d) return 'data desconhecida';
    const s = String(d);
    const m = s.match(/^(-?\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
    if (!m) return s;
    const y = m[1];
    if (precision === 'year' || (!m[2] && !m[3])) return y + ' (ano)';
    if (precision === 'month' || (!m[3])) return MONTHS[(+m[2] || 1) - 1] + ' ' + y;
    return (+m[3]) + ' ' + MONTHS[(+m[2] || 1) - 1] + ' ' + y;
  }
  function fmtRange(r) {
    if (!r.start && !r.end) return 'datas desconhecidas';
    if (r.start && r.end) return fmtDate(r.start, r.startPrec) + ' → ' + fmtDate(r.end, r.endPrec);
    if (r.start) return 'desde ' + fmtDate(r.start, r.startPrec);
    return 'até ' + fmtDate(r.end, r.endPrec);
  }
  const fmtNum = (n) => new Intl.NumberFormat('pt-PT').format(n);
  function fmtMoney(n, cur) {
    if (typeof n !== 'number') return '—';
    if (cur === '%') return n + '%';
    if (cur && cur !== 'EUR' && cur.length <= 3) return fmtNum(n) + ' ' + cur;
    if (n >= 1e9) return (n / 1e9).toFixed(2).replace('.', ',') + ' mM€';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' M€';
    if (n >= 1e3) return fmtNum(Math.round(n / 1e3)) + ' mil €';
    return fmtNum(n) + ' €';
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  function avatar(entity, size) {
    const img = el('img', { src: VN.avatars.dataUri(entity, size || 64), width: size || 64, height: size || 64, alt: 'Representação de ' + entity.name, loading: 'lazy', class: 'avatar' });
    return img;
  }
  function statusChip(status, verification, extra) {
    const v = verification[status] || {};
    const c = el('span', { class: 'chip verif', style: 'color:' + (v.color || '#94a3b8') + ';border-color:' + (v.color || '#94a3b8') + '55', title: v.desc || '' },
      [el('span', { class: 'dot', style: 'background:' + (v.color || '#94a3b8') }), v.label || status]);
    if (extra) c.appendChild(el('span', { class: 'muted', text: ' ' + extra }));
    return c;
  }
  function toast(msg, kind, ms) {
    const box = $('#toasts');
    if (!box) return;
    // no máximo 2 avisos simultâneos: não tapam o mapa
    while (box.children.length >= 2) box.removeChild(box.firstChild);
    const t = el('div', { class: 'toast ' + (kind || ''), role: 'status', text: msg, title: 'Clique para fechar' });
    t.addEventListener('click', () => t.remove());
    box.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, ms || 3800);
  }
  function download(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    const ta = el('textarea', { style: 'position:fixed;left:-9999px' }); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove(); return Promise.resolve();
  }
  VN.dom = { el, $, $$, clear, esc, fmtDate, fmtRange, fmtNum, fmtMoney, pct, avatar, statusChip, toast, download, copy, MONTHS };
})(typeof window !== 'undefined' ? window : globalThis);
