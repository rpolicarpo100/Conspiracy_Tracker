/* =====================================================================
   MODELOS DE IA — escolher um nome que exista (fase 12)

   O que aconteceu de verdade, e que isto impede: a sugestão de modelo do Groq
   no catálogo («llama-3.3-70b-versatile») deixou de existir. Com uma chave
   válida, a instância respondia «The model ... does not exist or you do not
   have access to it» — e o utilizador via um erro que parecia dele.

   Aqui não há rede: `complete` e `listModels` são falsos e dizem o que se quer
   provar. O que se mede:
     · lista pedida UMA vez e reaproveitada (cache), nunca em cada pedido;
     · um só pedido repetido, com um modelo de conversa da lista real;
     · nada de embeddings/áudio/moderação a responder a perguntas;
     · quando a lista não serve, falha — não inventa um nome;
     · o que foi pedido e o que foi usado ficam ambos registados.
   ===================================================================== */
import { escolherModeloConversa, razaoDaEscolha, normalizarNomes, criarResolvedorDeModelos, ERRO_DE_MODELO, erroDeModelo } from '../server/modelos.mjs';

const R = [];
const t = async (name, fn) => {
  try { const d = await fn(); R.push({ ok: true, name, detail: d }); }
  catch (e) { R.push({ ok: false, name, detail: e.message }); }
};
const ok = (c, m) => { if (!c) throw new Error(m || 'falhou'); };

const LISTA_GROQ = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile-v2',
  'whisper-large-v3',
  'whisper-large-v3-turbo',
  'distil-whisper-large-v3-en',
  'meta-llama/llama-guard-4-12b',
  'openai/gpt-oss-20b'
];

await t('escolha · prefere um modelo de conversa e descarta áudio, moderação e embeddings', async () => {
  const e = escolherModeloConversa(LISTA_GROQ, 'modelo-que-nao-existe');
  ok(e && !/whisper|guard/i.test(e), 'escolheu ' + e);
  ok(/llama-3\.\d|gpt-oss/i.test(e), 'não preferiu um modelo de conversa: ' + e);
  const nada = escolherModeloConversa(['text-embedding-3-small', 'whisper-1', 'omni-moderation-latest'], 'x');
  ok(nada === null, 'escolheu ' + nada + ' para conversa');
  ok(escolherModeloConversa([], 'x') === null, 'lista vazia devia dar null');
  return e + ' · lista sem modelos de conversa → null';
});

await t('escolha · explica-se: o que foi pedido, o que existe, o que se usou', async () => {
  const dentro = razaoDaEscolha(LISTA_GROQ, 'llama-3.1-8b-instant');
  ok(dentro.escolhido === 'llama-3.1-8b-instant' && /existe/.test(dentro.razao), JSON.stringify(dentro));
  const fora = razaoDaEscolha(LISTA_GROQ, 'llama-3.3-70b-versatile');
  ok(fora.escolhido !== 'llama-3.3-70b-versatile' && /não existe/.test(fora.razao), JSON.stringify(fora));
  const vazia = razaoDaEscolha([], 'llama-3.3-70b-versatile');
  ok(vazia.escolhido === null && /não tem nenhum modelo/.test(vazia.razao), JSON.stringify(vazia));
  return 'modelo pedido dentro/fora da lista e lista vazia — três razões distintas';
});

/* fábrica de fornecedor falso: conta chamadas e permite guiões */
function fornecedorFalso({ falharModelos = [], lista = LISTA_GROQ, falhaLista = false } = {}) {
  const pedidos = []; const listas = [];
  return {
    pedidos, listas,
    complete: async ({ provider, model }) => {
      pedidos.push({ provider, model });
      if (falharModelos.indexOf(model) >= 0) {
        return { ok: false, status: 404, error: 'The model `' + model + '` does not exist or you do not have access to it.' };
      }
      return { ok: true, text: 'ok · ' + model, model };
    },
    listModels: async ({ provider }) => {
      listas.push(provider);
      if (falhaLista) return { ok: false, error: 'HTTP 500' };
      return { ok: true, models: lista };
    }
  };
}

await t('resolvedor · modelo morto → lista real + UM pedido repetido com modelo que existe', async () => {
  const f = fornecedorFalso({ falharModelos: ['llama-3.3-70b-versatile'] });
  const r = criarResolvedorDeModelos(f);
  const saida = await r.completarComModelo({ provider: 'groq', apiKey: 'k', modelo: 'llama-3.3-70b-versatile', mensagens: [], timeoutMs: 1000 });
  ok(saida.r.ok, 'não recuperou: ' + saida.r.error);
  ok(saida.modelo !== 'llama-3.3-70b-versatile', 'insistiu no modelo morto');
  ok(saida.r.modeloPedido === 'llama-3.3-70b-versatile', 'não registou o que foi pedido');
  ok(saida.r.modeloCorrigido === saida.modelo, 'não registou o que foi usado');
  ok(f.pedidos.length === 2, 'pedidos: ' + f.pedidos.length + ' (devia ser exactamente 2)');
  ok(f.listas.length === 1, 'listas pedidas: ' + f.listas.length);
  return 'pedido ' + saida.r.modeloPedido + ' → usado ' + saida.modelo + ' · 2 pedidos, 1 lista';
});

await t('resolvedor · a lista fica em cache: um segundo pedido não volta a perguntar', async () => {
  const f = fornecedorFalso({ falharModelos: ['morto'] });
  const r = criarResolvedorDeModelos(f);
  await r.completarComModelo({ provider: 'groq', apiKey: 'k', modelo: 'morto', mensagens: [], timeoutMs: 1000 });
  await r.completarComModelo({ provider: 'groq', apiKey: 'k', modelo: 'morto', mensagens: [], timeoutMs: 1000 });
  await r.completarComModelo({ provider: 'groq', apiKey: 'k', modelo: 'morto', mensagens: [], timeoutMs: 1000 });
  ok(f.listas.length === 1, 'listas pedidas: ' + f.listas.length + ' (devia ser 1)');
  ok(r.contas.consultas === 1 && r.contas.reaproveitadas === 2, JSON.stringify(r.contas));
  return '3 pedidos com modelo morto → 1 lista no fornecedor';
});

await t('resolvedor · a cache expira e volta a perguntar (não fica com uma lista velha para sempre)', async () => {
  const f = fornecedorFalso({ falharModelos: ['morto'] });
  let relogio = 1000;
  const r = criarResolvedorDeModelos({ ...f, agora: () => relogio, cacheMs: 60000 });
  await r.completarComModelo({ provider: 'groq', apiKey: 'k', modelo: 'morto', mensagens: [], timeoutMs: 1000 });
  relogio += 61000;
  await r.completarComModelo({ provider: 'groq', apiKey: 'k', modelo: 'morto', mensagens: [], timeoutMs: 1000 });
  ok(f.listas.length === 2, 'listas: ' + f.listas.length);
  return 'lista pedida outra vez ao fim de 61 s';
});

await t('resolvedor · erro que NÃO é de modelo (chave inválida) não gasta pedidos nem listas', async () => {
  const pedidos = []; let listas = 0;
  const r = criarResolvedorDeModelos({
    complete: async ({ model }) => { pedidos.push(model); return { ok: false, status: 401, error: 'Invalid API Key' }; },
    listModels: async () => { listas++; return { ok: true, models: LISTA_GROQ }; }
  });
  const s = await r.completarComModelo({ provider: 'groq', apiKey: 'k', modelo: 'llama-3.1-8b-instant', mensagens: [], timeoutMs: 1000 });
  ok(!s.r.ok && s.modelo === 'llama-3.1-8b-instant', 'mudou de modelo por um erro de chave');
  ok(pedidos.length === 1 && listas === 0, 'pedidos ' + pedidos.length + ' · listas ' + listas);
  return 'chave inválida → 1 pedido, 0 listas, modelo inalterado';
});

await t('resolvedor · lista indisponível → falha declarada, sem inventar um modelo', async () => {
  const f = fornecedorFalso({ falhaLista: true, falharModelos: ['morto'] });
  const r = criarResolvedorDeModelos(f);
  const s = await r.completarComModelo({ provider: 'groq', apiKey: 'k', modelo: 'morto', mensagens: [], timeoutMs: 1000 });
  ok(!s.r.ok, 'disse que correu bem');
  ok(s.modelo === 'morto' && /não tem nenhum modelo|não existe/.test(s.razao || ''), 'sem razão: ' + s.razao);
  ok(f.pedidos.length === 1, 'pedidos: ' + f.pedidos.length);
  return 'falhou com razão escrita: ' + s.razao;
});

await t('resolvedor · o pedido repetido leva o MESMO texto (nada de conteúdo novo)', async () => {
  const enviados = [];
  const r = criarResolvedorDeModelos({
    complete: async ({ model, messages }) => {
      enviados.push(JSON.stringify(messages));
      return model === 'morto' ? { ok: false, status: 404, error: 'model not found' } : { ok: true, text: 'ok' };
    },
    listModels: async () => ({ ok: true, models: LISTA_GROQ })
  });
  await r.completarComModelo({ provider: 'groq', apiKey: 'k', modelo: 'morto', mensagens: [{ role: 'user', content: 'Responda apenas: ok' }], timeoutMs: 1000 });
  ok(enviados.length === 2 && enviados[0] === enviados[1], 'textos diferentes: ' + enviados.join(' vs '));
  return 'duas chamadas, exactamente o mesmo corpo';
});

await t('resolvedor · 404 sem mensagem (o caso do Google) também corrige o modelo', async () => {
  const pedidos = [];
  const r = criarResolvedorDeModelos({
    complete: async ({ model }) => {
      pedidos.push(model);
      /* o Google responde 404 com corpo vazio: a aplicação só vê «HTTP 404» */
      return model === 'gemini-2.0-flash' ? { ok: false, status: 404, error: 'HTTP 404' }
        : { ok: true, text: 'ok', model };
    },
    listModels: async () => ({ ok: true, models: ['gemini-2.5-flash', 'text-embedding-004', 'gemini-2.5-pro'] })
  });
  const s = await r.completarComModelo({ provider: 'gemini', apiKey: 'k', modelo: 'gemini-2.0-flash', mensagens: [], timeoutMs: 1000 });
  ok(s.r.ok, 'não recuperou de um 404 sem mensagem: ' + JSON.stringify(s.r));
  ok(s.modelo === 'gemini-2.5-flash', 'escolheu ' + s.modelo);
  ok(pedidos.length === 2, 'pedidos: ' + pedidos.length);
  return 'HTTP 404 sem corpo → ' + s.modelo;
});

await t('nomes com prefixo de recurso · «models/gemini-2.5-flash» vira «gemini-2.5-flash»', async () => {
  ok(normalizarNomes(['models/gemini-2.5-flash', 'models/gemini-2.5-pro']).join(',') === 'gemini-2.5-flash,gemini-2.5-pro', 'não normalizou');
  ok(normalizarNomes(['llama-3.1-8b-instant']).join(',') === 'llama-3.1-8b-instant', 'mexeu numa lista sem prefixo');
  ok(normalizarNomes([]).length === 0, 'lista vazia');
  const escolhido = escolherModeloConversa(['models/gemini-2.5-flash', 'models/text-embedding-004'], 'gemini-2.0-flash');
  ok(escolhido === 'gemini-2.5-flash', 'escolheu ' + escolhido);
  /* e com o modelo pedido JÁ a existir: não se troca por outro */
  const igual = razaoDaEscolha(['models/gemini-2.5-flash'], 'gemini-2.5-flash');
  ok(igual.escolhido === 'gemini-2.5-flash' && /existe/.test(igual.razao), JSON.stringify(igual));
  return 'prefixo removido só quando é comum a todos · modelo pedido reconhecido';
});

await t('reconhecimento do erro · cobre os avisos reais dos fornecedores', async () => {
  ['does not exist', 'no access', 'model_not_found', 'decommissioned', 'deprecated', 'unknown model', 'unsupported model']
    .forEach((m) => ok(ERRO_DE_MODELO.test(m), 'não reconhece: ' + m));
  ['Invalid API Key', 'rate limit exceeded', 'HTTP 500', 'timeout após 30000 ms']
    .forEach((m) => ok(!ERRO_DE_MODELO.test(m), 'confunde erro de chave com modelo: ' + m));
  /* erroDeModelo: 404/410 contam, 401/429/500 não */
  ok(erroDeModelo({ status: 404, error: 'HTTP 404' }), '404 sem corpo devia contar');
  ok(erroDeModelo({ status: 410, error: '' }), '410 devia contar');
  ok(!erroDeModelo({ status: 401, error: 'HTTP 401' }), '401 não é modelo');
  ok(!erroDeModelo({ status: 429, error: 'rate limit' }), '429 não é modelo');
  ok(!erroDeModelo({ status: 500, error: 'HTTP 500' }), '500 não é modelo');
  return '7 reconhecidos · 4 não confundidos';
});

let pass = 0, fail = 0;
console.log('MODELOS DE IA — ESCOLHER UM NOME QUE EXISTA\n');
R.forEach((r) => {
  if (r.ok) { pass++; console.log('PASS ' + r.name + (r.detail ? ' → ' + r.detail : '')); }
  else { fail++; console.log('FAIL ' + r.name + ' → ' + r.detail); }
});
console.log('\n' + pass + '/' + R.length + ' passaram');
process.exit(fail ? 1 : 0);
