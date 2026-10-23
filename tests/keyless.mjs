/* =====================================================================
   VARRIMENTO «SEM CHAVE» — guardar e servir o que foi medido (fase 12)

   O defeito que isto fecha: a ferramenta existia (tools/keyless-scan.mjs) e
   escrevia docs/APIS-sem-chave.json, mas (1) nada a corria periodicamente e
   (2) nada lia o ficheiro — nem a aplicação, nem a interface. «Guardar» sem
   ninguém a ler não é guardar; é deixar um ficheiro a envelhecer.

   Camadas:
     1. sonda (módulo) — com servidores HTTP locais, sem internet: catálogo
        público vs geração fechada vs geração aberta, controlo negativo incluído;
     2. relatório guardado — formato do ficheiro, idade, e o que se pode concluir;
     3. rota /api/ai/keyless — serve o relatório, avisa quando envelhece, recusa
        afirmar quando não existe, e nunca sugere que um endpoint descoberto
        passou a ser usado pela aplicação.
   ===================================================================== */
import './_env.mjs';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApi } from '../server/api.mjs';
import { probeSemChave, probeGeracaoSemChave, KEYLESS_VERDICTS } from '../server/discovery.mjs';

const R = [];
const t = async (name, fn) => {
  try { const d = await fn(); R.push({ ok: true, name, detail: d }); }
  catch (e) { R.push({ ok: false, name, detail: e.message }); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'falhou'); };

/* ---------------------------------------------- 1. a sonda (fetch injectado, sem rede) */

/* host público (só nome): o fetchImpl é falso, por isso nada sai para a rede. O
   endereço privado é recusado ANTES do pedido — é o que o teste seguinte prova. */
const BASE_TLS = 'https://api.fornecedor-teste.example/v1';

/* resposta falsa com a forma que a sonda usa: status, ok e text() */
const respostaFalsa = (status, corpo) => ({
  status, ok: status >= 200 && status < 300,
  text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo))
});

await t('sonda · catálogo fechado (401) → «exige-chave»', async () => {
  const r = await probeSemChave({ id: 'x', base: BASE_TLS }, {
    timeoutMs: 3000, fetchImpl: async () => respostaFalsa(401, { error: 'no key' })
  });
  ok(r.verdict === KEYLESS_VERDICTS.exigeChave, 'veredicto: ' + r.verdict);
  ok(/pede credencial/.test(r.porque), r.porque);
  return '401 sem Authorization → exige-chave';
});

await t('sonda · catálogo público (200) → «sem-chave» — e SÓ isso', async () => {
  const r = await probeSemChave({ id: 'x', base: BASE_TLS }, {
    timeoutMs: 3000, fetchImpl: async () => respostaFalsa(200, { data: [{ id: 'm1' }, { id: 'm2' }] })
  });
  ok(r.verdict === KEYLESS_VERDICTS.semChave, 'veredicto: ' + r.verdict);
  ok(r.modelsCount === 2, 'modelos: ' + r.modelsCount);
  ok(r.verdict !== KEYLESS_VERDICTS.geraSemChave, 'concluiu geração a partir de um catálogo');
  ok(r.firstModel === 'm1', 'primeiro modelo: ' + r.firstModel);
  return 'catálogo com 2 modelos → «sem-chave» (não «gera»)';
});

await t('sonda · 200 sem JSON não conclui nada (indeterminado, não «sem chave»)', async () => {
  const r = await probeSemChave({ id: 'y', base: BASE_TLS }, {
    timeoutMs: 3000, fetchImpl: async () => respostaFalsa(200, '<html>ola</html>')
  });
  ok(r.verdict === KEYLESS_VERDICTS.indeterminado, 'veredicto: ' + r.verdict);
  return 'HTML em vez de JSON → indeterminado';
});

await t('sonda · geração aberta e geração fechada distinguem-se pela RESPOSTA gerada', async () => {
  const aberta = await probeGeracaoSemChave({ id: 'a', base: BASE_TLS, firstModel: 'modelo-a' }, {
    timeoutMs: 3000, fetchImpl: async () => respostaFalsa(200, { choices: [{ message: { content: 'ok' } }] })
  });
  ok(aberta.verdict === KEYLESS_VERDICTS.geraSemChave, 'aberta: ' + aberta.verdict + ' ' + aberta.porque);
  const fechada = await probeGeracaoSemChave({ id: 'b', base: BASE_TLS, firstModel: 'modelo-a' }, {
    timeoutMs: 3000, fetchImpl: async () => respostaFalsa(401, { error: { message: 'Missing API key' } })
  });
  ok(fechada.verdict === KEYLESS_VERDICTS.exigeChave, 'fechada: ' + fechada.verdict);
  /* 200 sem `choices` não é uma geração: não se conclui */
  const vazio = await probeGeracaoSemChave({ id: 'c', base: BASE_TLS, firstModel: 'modelo-a' }, {
    timeoutMs: 3000, fetchImpl: async () => respostaFalsa(200, { nada: true })
  });
  ok(vazio.verdict === KEYLESS_VERDICTS.indeterminado, '200 sem choices: ' + vazio.verdict);
  return 'resposta gerada → gera-sem-chave · 401 → exige-chave · 200 sem choices → indeterminado';
});

await t('sonda · endereço privado é recusado (não é SSRF disfarçado de descoberta)', async () => {
  const r = await probeSemChave({ id: 'local', base: 'https://127.0.0.1:9/v1' }, { timeoutMs: 2000 });
  ok(r.verdict === KEYLESS_VERDICTS.indeterminado, 'veredicto: ' + r.verdict);
  ok(/privado|local/i.test(r.porque || ''), 'porque: ' + r.porque);
  return 'recusado antes de qualquer pedido: ' + r.porque;
});

/* ---------------------------------------------- 2/3. relatório guardado e rota */

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vn-keyless-'));
const api = await createApi({ dataDir: DIR, appSecret: 'segredo-de-teste-keyless-1234', secure: false });
const srv = http.createServer((q, r) => api.handle(q, r, new URL(q.url, 'http://x')));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + srv.address().port;
const get = async (p) => {
  const res = await fetch(BASE + p);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* não JSON */ }
  return { status: res.status, json, text };
};

const RELATORIO = path.join(process.cwd(), 'docs', 'APIS-sem-chave.json');
const ORIGINAL = fs.existsSync(RELATORIO) ? fs.readFileSync(RELATORIO, 'utf8') : null;

try {
  if (ORIGINAL) {
    await t('rota · o relatório guardado é servido com data, método e o que gerou de facto', async () => {
      const r = await get('/api/ai/keyless');
      ok(r.status === 200, 'HTTP ' + r.status + ' ' + r.text.slice(0, 120));
      ok(r.json.geradoEm && r.json.idadeDias >= 0, 'sem data: ' + JSON.stringify(r.json.geradoEm));
      ok(r.json.metodo, 'sem método declarado');
      ok(Array.isArray(r.json.geramSemChave), 'sem lista de quem gera');
      r.json.geramSemChave.forEach((g) => ok(g.id && typeof g.base === 'string', 'entrada sem id/base: ' + JSON.stringify(g)));
      ok(r.json.resumo && typeof r.json.resumo['sem-chave'] === 'number', 'sem resumo: ' + JSON.stringify(r.json.resumo));
      return r.json.geramSemChave.length + ' endpoint(s) geram sem chave · relatório de ' + String(r.json.geradoEm).slice(0, 10) + ' (' + r.json.idadeDias + ' dias)';
    });

    await t('rota · diz o que NÃO decide: descoberto ≠ usado pela aplicação', async () => {
      const r = await get('/api/ai/keyless');
      ok(Array.isArray(r.json.emUsoPelaAplicacao), 'sem lista do que a aplicação usa');
      ok(r.json.emUsoPelaAplicacao.length === 1 && r.json.emUsoPelaAplicacao[0] === 'pollinations',
        'fornecedores sem chave em uso: ' + JSON.stringify(r.json.emUsoPelaAplicacao));
      ok(/NÃO o acrescenta/.test(r.json.nota || ''), 'nota: ' + r.json.nota);
      /* o relatório não pode conter credenciais de ninguém */
      ok(!/"(apiKey|authorization|bearer)"/i.test(r.text), 'o relatório expõe credenciais');
      return 'em uso: ' + r.json.emUsoPelaAplicacao.join(',') + ' · nota de não-adopção presente';
    });
  } else {
    await t('rota · sem relatório guardado, recusa afirmar (404 com o que fazer)', async () => {
      const r = await get('/api/ai/keyless');
      ok(r.status === 404, 'HTTP ' + r.status);
      ok(/não existe relatório/.test(r.json.error.message), JSON.stringify(r.json.error));
      ok(/workflow|keyless-scan/.test(r.json.error.how || ''), 'sem instruções: ' + r.json.error.how);
      return '404 com instruções';
    });
  }

  await t('rota · relatório com 60 dias é servido mas marcado como desactualizado', async () => {
    const velho = {
      generatedAt: new Date(Date.now() - 60 * 86400000).toISOString(),
      metodo: 'teste', fonte: 'teste', resumo: { 'sem-chave': 1, 'exige-chave': 0, indeterminado: 0 },
      geracao: { veredictos: { 'gera-sem-chave': 1 }, resultados: [{ id: 'ctl', base: 'https://x/v1', model: 'm', verdict: 'gera-sem-chave' }] },
      resultados: [{ id: 'ctl', base: 'https://x/v1', verdict: 'sem-chave' }]
    };
    fs.writeFileSync(RELATORIO, JSON.stringify(velho));
    const r = await get('/api/ai/keyless');
    ok(r.status === 200, 'HTTP ' + r.status);
    ok(r.json.idadeDias >= 59, 'idade: ' + r.json.idadeDias);
    ok(/desactualizado/.test(r.json.aviso || ''), 'sem aviso: ' + r.json.aviso);
    return 'idade ' + r.json.idadeDias + ' dias → ' + r.json.aviso;
  });

  await t('rota · relatório corrompido é 500 declarado, não uma lista vazia a fingir', async () => {
    fs.writeFileSync(RELATORIO, '{ isto não é json');
    const r = await get('/api/ai/keyless');
    ok(r.status === 500, 'HTTP ' + r.status);
    ok(/não é JSON válido/.test(r.json.error.message), JSON.stringify(r.json.error));
    return '500 com motivo';
  });

  await t('rota · sem relatório (ficheiro apagado) → 404 e não inventa resultados', async () => {
    fs.rmSync(RELATORIO, { force: true });
    const r = await get('/api/ai/keyless');
    ok(r.status === 404, 'HTTP ' + r.status);
    ok(/sem relatório não se afirma nada/.test(r.json.aviso || ''), 'aviso: ' + r.json.aviso);
    return '404 · «sem relatório não se afirma nada»';
  });
} finally {
  try { if (ORIGINAL) fs.writeFileSync(RELATORIO, ORIGINAL); } catch { /* fica o que houver */ }
  srv.close();
  await new Promise((r) => setTimeout(r, 150));
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* fica */ }
}

let pass = 0, fail = 0;
console.log('VARRIMENTO «SEM CHAVE» — GUARDAR E SERVIR\n');
R.forEach((r) => {
  if (r.ok) { pass++; console.log('PASS ' + r.name + (r.detail ? ' → ' + r.detail : '')); }
  else { fail++; console.log('FAIL ' + r.name + ' → ' + r.detail); }
});
console.log('\n' + pass + '/' + R.length + ' passaram');
process.exit(fail ? 1 : 0);
