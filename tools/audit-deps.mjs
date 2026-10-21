/* =====================================================================
   AUDITORIA DE DEPENDÊNCIAS — dados reais, não opiniões.

   O que faz:
   1. lê o que está INSTALADO (package-lock.json), não o que se gostaria;
   2. pergunta ao OSV (base pública de vulnerabilidades) por cada versão;
   3. pergunta ao registo npm pela versão mais recente e por depreciações;
   4. sinaliza licenças fora da lista aceite e pacotes com scripts de instalação
      (código que corre no build sem ninguém olhar);
   5. escreve docs/DEPENDENCIAS-DADOS.json e imprime um resumo.

   Códigos de saída: 0 = nada crítico; 1 = vulnerabilidade alta/crítica ou
   licença proibida; 2 = falha de rede (auditoria INCOMPLETA — diz-se, não se
   assume que está tudo bem).

   Uso:
     node tools/audit-deps.mjs              # audita o que está instalado
     node tools/audit-deps.mjs --candidates=lista.txt   # avalia candidatos
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (n, d) => { const h = args.find((a) => a.startsWith('--' + n + '=')); return h ? h.split('=').slice(1).join('=') : d; };
const CANDIDATES_FILE = arg('candidates', null);
const ALLOW = new Set(['MIT', 'MIT-0', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'Python-2.0', 'MPL-2.0', 'Apache-2.0 WITH LLVM-exception']);
const FORBID = /^(AGPL|GPL|SSPL|BUSL|CC-BY-NC)/i;

async function jget(url, tries = 3) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'meridiano-audit' } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { last = e; await new Promise((res) => setTimeout(res, 400 * (i + 1))); }
  }
  throw last;
}

/* ---------- 1. inventário do que está instalado ---------- */
function installed() {
  const lockPath = 'package-lock.json';
  if (!fs.existsSync(lockPath)) return { error: 'sem package-lock.json: não se sabe o que está instalado' };
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const pkgs = lock.packages || {};
  const rows = [];
  for (const [p, meta] of Object.entries(pkgs)) {
    if (!p.startsWith('node_modules/')) continue;
    const name = p.slice('node_modules/'.length);
    rows.push({
      name, version: meta.version || null, dev: !!meta.dev,
      license: meta.license || null, scripts: meta.hasInstallScript ? 'sim' : 'não'
    });
  }
  const root = lock.packages && lock.packages[''];
  return { rows, direct: Object.keys((root && root.dependencies) || {}), directDev: Object.keys((root && root.devDependencies) || {}) };
}

/* ---------- 2. candidatos ainda não instalados ---------- */
function candidateList() {
  if (!CANDIDATES_FILE) return [];
  return fs.readFileSync(CANDIDATES_FILE, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

/* detalhe de uma vulnerabilidade (o querybatch nem sempre traz a severidade) */
const vulnDetail = new Map();
async function vulnInfo(id) {
  if (vulnDetail.has(id)) return vulnDetail.get(id);
  let info = { id, severity: null, summary: null, fixed: null };
  try {
    const d = await jget('https://api.osv.dev/v1/vulns/' + id);
    if (d) {
      const sev = (d.database_specific && d.database_specific.severity) || null;
      const cvss = (d.severity || []).map((x) => x.score).join(' ');
      const fixed = [];
      (d.affected || []).forEach((a) => (a.ranges || []).forEach((r) => (r.events || []).forEach((e) => { if (e.fixed) fixed.push(e.fixed); })));
      info = { id, severity: sev, cvss: cvss || null, summary: (d.summary || '').slice(0, 200), fixed: fixed.length ? fixed.join(', ') : null };
    }
  } catch { /* fica sem detalhe: declarado como «severidade desconhecida» */ }
  vulnDetail.set(id, info);
  return info;
}
const isHigh = (info) => /high|critical/i.test(String(info.severity || '')) || /(^|\s)(7|8|9|10)\.\d/.test(String(info.cvss || ''));

/* ---------- 3. vulnerabilidades (OSV) em lotes ---------- */
async function osv(pairs) {
  const out = new Map();
  const chunk = 200;
  for (let i = 0; i < pairs.length; i += chunk) {
    const q = pairs.slice(i, i + chunk).map(([name, version]) => ({ package: { name, ecosystem: 'npm' }, version }));
    const r = await fetch('https://api.osv.dev/v1/querybatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queries: q }) });
    if (!r.ok) throw new Error('OSV HTTP ' + r.status);
    const j = await r.json();
    (j.results || []).forEach((res, k) => {
      const key = pairs[i + k][0] + '@' + pairs[i + k][1];
      const vulns = res.vulns || [];
      if (vulns.length) out.set(key, vulns.map((v) => ({
        id: v.id, aliases: v.aliases || [], summary: (v.summary || '').slice(0, 200),
        severity: (v.database_specific && v.database_specific.severity) || (v.severity && v.severity[0] && v.severity[0].score) || null
      })));
    });
  }
  return out;
}

/* ---------- execução ---------- */
const inv = installed();
if (inv.error) { console.error('[deps] ' + inv.error); process.exit(2); }
const pairs = inv.rows.filter((r) => r.version).map((r) => [r.name, r.version]);
let vulns = new Map(), osvError = null;
try { vulns = await osv(pairs); } catch (e) { osvError = String(e.message || e); }

/* candidatos: última versão publicada, sem instalar */
const cands = [];
for (const name of candidateList()) {
  try {
    const meta = await jget('https://registry.npmjs.org/' + name.replace('/', '%2F'));
    if (!meta) { cands.push({ name, error: 'não existe no registo npm' }); continue; }
    const v = meta['dist-tags'].latest;
    const info = meta.versions[v] || {};
    cands.push({
      name, version: v, license: info.license || null,
      deprecated: info.deprecated ? String(info.deprecated).slice(0, 140) : null,
      engines: info.engines || null,
      installScript: info.scripts && (info.scripts.install || info.scripts.postinstall || info.scripts.preinstall) ? 'SIM' : 'não',
      unpacksKB: info.dist && info.dist.unpackedSize ? Math.round(info.dist.unpackedSize / 1024) : null,
      published: (meta.time && meta.time[v] || '').slice(0, 10),
      deps: info.dependencies ? Object.keys(info.dependencies).length : 0
    });
  } catch (e) { cands.push({ name, error: String(e.message).slice(0, 80) }); }
}
let candVulns = new Map();
if (cands.some((c) => c.version)) {
  try { candVulns = await osv(cands.filter((c) => c.version).map((c) => [c.name, c.version])); } catch { /* declarado abaixo */ }
}

const criticos = [];
const avisos = [];
for (const r of inv.rows) {
  const key = r.name + '@' + r.version;
  const v = vulns.get(key);
  if (v) {
    const infos = [];
    for (const x of v) infos.push(await vulnInfo(x.id));
    const high = infos.some(isHigh);
    (high ? criticos : avisos).push({
      tipo: 'vulnerabilidade', pacote: r.name, versao: r.version,
      detalhe: infos.map((i) => i.id + (i.severity ? ' (' + i.severity + ')' : '') + (i.fixed ? ' → corrigido em ' + i.fixed : '')).join('; '),
      resumo: infos.map((i) => i.summary).filter(Boolean).join(' | ')
    });
  }
  const lic = String(r.license || '');
  if (!lic) avisos.push({ tipo: 'licença ausente', pacote: r.name, versao: r.version });
  else if (FORBID.test(lic)) criticos.push({ tipo: 'licença incompatível', pacote: r.name, versao: r.version, detalhe: lic });
  else if (!ALLOW.has(lic.split(' OR ')[0].split(' AND ')[0].trim())) avisos.push({ tipo: 'licença fora da lista', pacote: r.name, versao: r.version, detalhe: lic });
}

const doc = {
  geradoEm: new Date().toISOString(), osv: osvError ? 'FALHOU: ' + osvError : 'ok',
  instalados: inv.rows.length, directos: inv.direct, directosDev: inv.directDev,
  vulnerabilidades: Object.fromEntries(vulns), candidatos: cands.map((c) => Object.assign({}, c, {
    vulnerabilidades: candVulns.get(c.name + '@' + c.version) || []
  })),
  criticos, avisos
};
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/DEPENDENCIAS-DADOS.json', JSON.stringify(doc, null, 1) + '\n');

console.log('=== DEPENDÊNCIAS INSTALADAS: ' + inv.rows.length + ' (directas: ' + inv.direct.length + ', de desenvolvimento: ' + inv.directDev.length + ') ===');
const byName = (a, b) => a.pacote.localeCompare(b.pacote);
if (!criticos.length) console.log('sem vulnerabilidades altas/críticas e sem licenças proibidas nas versões instaladas');
for (const c of criticos.sort(byName)) console.log('CRÍTICO  ' + c.pacote + '@' + c.versao + ' — ' + c.tipo + (c.detalhe ? ': ' + c.detalhe : ''));
for (const a of avisos.sort(byName)) console.log('aviso    ' + a.pacote + '@' + a.versao + ' — ' + a.tipo + (a.detalhe ? ': ' + a.detalhe : ''));
if (cands.length) {
  console.log('\n=== CANDIDATOS (não instalados) ===');
  for (const c of cands) {
    if (c.error) { console.log(c.name + ' — ' + c.error); continue; }
    const vlist = c.vulnerabilidades || [];
    const v = vlist.length ? 'VULNS: ' + vlist.map((x) => x.id).join(',') : 'sem vulns conhecidas';
    console.log(c.name + '@' + c.version + ' · ' + (c.license || '?') + ' · ' + (c.unpacksKB || '?') + ' KB · instal:' + c.installScript +
      ' · engines ' + JSON.stringify(c.engines) + ' · ' + c.published + ' · ' + v + (c.deprecated ? ' · DEPRECADO: ' + c.deprecated : ''));
  }
}
console.log('\ndados completos: docs/DEPENDENCIAS-DADOS.json');
if (osvError) { console.error('auditoria INCOMPLETA: ' + osvError); process.exit(2); }
process.exit(criticos.length ? 1 : 0);
