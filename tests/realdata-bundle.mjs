/* Validação do lote real que a aplicação abre hoje.
   Dívida antiga: validateBundle existia mas nunca tinha sido corrido sobre o conjunto real
   (17 documentos, 46 entidades, 82 relações). Este teste corre-o e falha se o lote deixar de
   passar — e confirma que um lote com prova em falta continua a ser recusado. */
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {}, console };
vm.createContext(ctx);
for (const f of ['src/core/realdata.js', 'data/00-schema.js', 'data/real/10-epstein.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
}
const VN = ctx.window.VN;
const DATA = ctx.window.VN_DATA;
const prov = JSON.parse(fs.readFileSync('data/real/PROVENIENCIA.json', 'utf8'));

let pass = 0, fail = 0;
const t = (name, fn) => { try { const d = fn(); pass++; console.log('PASS ' + name + (d ? ' → ' + d : '')); }
  catch (e) { fail++; console.log('FAIL ' + name + ' → ' + e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m || 'falhou'); };

t('lote real passa a validação de proveniência', () => {
  const v = VN.realdata.validateBundle(DATA);
  ok(v.ok, 'recusado: ' + (v.errors || []).slice(0, 3).map((e) => e.msg).join(' · '));
  return v.stats.entities + ' entidades · ' + v.stats.relations + ' relações · ' + v.stats.withExcerpt + ' com excerto';
});

t('contagens do lote iguais às da proveniência', () => {
  const v = VN.realdata.validateBundle(DATA);
  ok(v.stats.entities === prov.counts.entities, 'entidades ' + v.stats.entities + ' ≠ ' + prov.counts.entities);
  ok(v.stats.relations === prov.counts.relations, 'relações ' + v.stats.relations + ' ≠ ' + prov.counts.relations);
  const docs = DATA.entities.filter((e) => e.type === 'document').length;
  ok(docs === prov.counts.documents, 'documentos ' + docs + ' ≠ ' + prov.counts.documents);
  return docs + ' documentos · ' + prov.documents.length + ' registos de proveniência';
});

t('todas as relações têm excerto literal e fonte', () => {
  const sem = DATA.relations.filter((r) => !r.ex || !r.src);
  ok(!sem.length, sem.length + ' sem excerto/fonte: ' + sem.slice(0, 3).map((r) => r.id).join(','));
  return DATA.relations.length + ' relações com excerto';
});

t('nenhuma relação declara crime, culpa ou coordenação', () => {
  const proibido = /culpad|crime|conspira|coorden|comboiou|corrupt|tráfico|trafic/i;
  const maus = DATA.relations.filter((r) => r.kind !== 'mentioned_in' && r.kind !== 'documented_in' && r.kind !== 'ruled_on' && r.kind !== 'litigation_with');
  ok(!maus.length, 'tipos não processuais: ' + [...new Set(maus.map((r) => r.kind))].join(','));
  const suspeitas = DATA.relations.filter((r) => proibido.test(String(r.why || '')));
  ok(!suspeitas.length, 'texto acusatório em ' + suspeitas.length + ' relações');
  return '4 tipos processuais em uso · 0 arestas acusatórias';
});

t('documento sem origem nem data de recolha é recusado', () => {
  const clone = JSON.parse(JSON.stringify(DATA));
  const doc = clone.entities.find((e) => e.type === 'document');
  delete doc.source; doc.url = null; doc.retrievedAt = null; doc.hash = null;
  const v = VN.realdata.validateBundle(clone);
  ok(!v.ok, 'documento sem proveniência foi aceite');
  ok(v.errors.some((e) => /sem URL/.test(e.msg)) && v.errors.some((e) => /retrievedAt/.test(e.msg)),
    'erros esperados ausentes: ' + v.errors.map((e) => e.msg).join(' | ').slice(0, 160));
  return v.errors.length + ' erros no mesmo documento';
});

t('documento com origem mas sem hash apenas avisa (não inventa prova)', () => {
  const clone = JSON.parse(JSON.stringify(DATA));
  const doc = clone.entities.find((e) => e.type === 'document');
  delete doc.source.sha256; delete doc.hash;
  const v = VN.realdata.validateBundle(clone);
  ok(v.ok, 'não devia recusar: ' + (v.errors || []).map((e) => e.msg)[0]);
  ok(v.warnings.some((w) => /sem hash/.test(w.msg)), 'deveria avisar da falta de hash');
  return 'aceite com aviso visível';
});

t('lote que se declara fictício é recusado', () => {
  const clone = JSON.parse(JSON.stringify(DATA));
  clone.meta.fictional = true;
  const v = VN.realdata.validateBundle(clone);
  ok(!v.ok, 'aceitou um lote fictício');
  return v.errors.find((e) => /fictício/.test(e.msg)).msg.slice(0, 80);
});

console.log('\n' + pass + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
