/* =====================================================================
   MODELOS DE IA — escolher um nome que exista, e não ficar preso a um que mudou

   Porque existe: os fornecedores mudam o catálogo de modelos sem avisar. O que
   estava escrito no código como sugestão («llama-3.3-70b-versatile») deixou de
   existir no Groq, e o resultado foi a instância inteira a responder
   «The model ... does not exist or you do not have access to it» — um erro que
   parece do utilizador e é nosso.

   Regras:
     · só se pede a lista real (GET /models) quando o erro é de MODELO, nunca em
       cada pedido; a lista fica em cache uma hora;
     · repete-se UMA vez, com um modelo de conversa da lista — nunca às cegas,
       nunca em ciclo;
     · o que se devolve diz sempre o que foi pedido e o que foi usado, para não
       haver respostas a fingir que o modelo preferido funcionou;
     · nada disto envia conteúdo: a lista é um GET autenticado, o pedido repetido
       leva o mesmo texto que ia ser enviado de qualquer maneira.

   Este módulo não fala com a rede: recebe `complete` e `listModels` de fora, para
   poder ser testado com fornecedores falsos (é o que tests/modelos.mjs faz).
   ===================================================================== */

/* erros que significam «esse modelo não serve» e não «o pedido está mal» */
export const ERRO_DE_MODELO = /does not exist|no access|not found|unknown model|invalid model|decommission|deprecat|unsupported model|model[_ ]not[_ ]found/i;

/* Um 404 também é, na prática, «esse modelo não existe»: é assim que o Google
   responde a um modelo retirado. A diferença é que, neste caso, o corpo pode vir
   vazio e a mensagem ser só «HTTP 404» — sem esta regra, a correcção automática
   nunca chegava a correr num dos três fornecedores que estavam configurados. */
/* O fornecedor às vezes DIZ qual usar: «Please update your code to use
   models/gemini-3.8-flash». Ignorar essa frase e escolher outra coisa qualquer
   seria escolher às cegas quando a resposta certa estava escrita na recusa. */
export function sugestaoDoFornecedor(texto) {
  const t = String(texto || '');
  if (!t) return null;
  const m = t.match(/(?:use|uses|migrate to|switch to|replace with)\s+[`"']?((?:models\/)?[A-Za-z0-9][A-Za-z0-9._\/-]*[A-Za-z0-9])/i);
  if (!m) return null;
  const nome = m[1].replace(/^models\//, '').replace(/[.,;:)]+$/, '');
  if (!nome || /^the$|^a$|^this$/i.test(nome)) return null;
  return nome;
}

export const erroDeModelo = (r) => {
  const texto = String((r && r.error) || '');
  if (ERRO_DE_MODELO.test(texto)) return true;
  const semCorpo = !texto || /^HTTP \d{3}$/.test(texto.trim());
  return !!(semCorpo && r && (r.status === 404 || r.status === 410));
};

const FORA = /embed|whisper|tts|audio|speech|moderation|guard|rerank|clip|image|dall|sd-|flux|stable-diffusion|vision-only|ocr/i;
const PREFERENCIA = [
  /(^|\/)llama-?3(\.\d+)?-[\d.]+b/i,
  /gpt-oss/i,
  /(^|\/)llama/i,
  /qwen/i,
  /mistral|mixtral|magistral/i,
  /gemini-[\d.]*-flash(-lite)?/i,
  /gpt-4o-mini|gpt-4\.1-mini|gpt-5-mini/i,
  /chat/i
];

/* Escolhe um modelo de CONVERSA a partir da lista real. Devolve null quando a
   lista só tem modelos que não servem — nesse caso é melhor falhar do que
   enviar o texto a um modelo de embeddings e receber uma resposta sem sentido. */
/* Alguns fornecedores (Google) devolvem os nomes com prefixo de recurso
   («models/gemini-2.5-flash»), mas o endpoint de conversa espera o nome SEM
   prefixo. Aplicado o prefixo tal e qual, a escolha automática dava 404 outra
   vez — o mesmo erro, uma camada mais adiante. */
export function normalizarNomes(lista) {
  const l = (lista || []).filter((m) => typeof m === 'string' && m);
  if (!l.length) return [];
  const todosComPrefixo = l.every((m) => m.indexOf('models/') === 0);
  return todosComPrefixo ? l.map((m) => m.slice('models/'.length)) : l;
}

export function escolherModeloConversa(lista, pedido) {
  const so = normalizarNomes(lista).filter((m) => m && !FORA.test(m));
  if (!so.length) return null;
  for (const re of PREFERENCIA) {
    const achado = so.find((m) => m !== pedido && re.test(m));
    if (achado) return achado;
  }
  return so.find((m) => m !== pedido) || null;
}

/* Versão explicável da escolha: para a interface e para os registos. */
export function razaoDaEscolha(lista, pedido) {
  const listaNorm = normalizarNomes(lista);
  /* o modelo pedido existe? então é ele — a correcção não troca o que já serve */
  if (pedido && listaNorm.indexOf(pedido) >= 0) return { escolhido: pedido, razao: 'o modelo pedido existe na lista do fornecedor' };
  const escolhido = escolherModeloConversa(lista, pedido);
  if (!escolhido) return { escolhido: null, razao: 'a lista do fornecedor não tem nenhum modelo de conversa utilizável' };
  if (!pedido) return { escolhido, razao: 'não havia modelo preferido; primeiro modelo de conversa da lista' };
  return { escolhido, razao: 'o modelo pedido não existe na lista do fornecedor; escolhido um modelo de conversa' };
}

/**
 * Cria o resolvedor com dependências injectáveis.
 *   complete({provider, apiKey, model, messages, timeoutMs}) → {ok, text, error, ...}
 *   listModels({provider, apiKey, timeoutMs}) → {ok, models[], error}
 */
export function criarResolvedorDeModelos({ complete, listModels, agora, cacheMs = 3600000 } = {}) {
  const relogio = agora || (() => Date.now());
  const cache = new Map();          /* fornecedor → { at, models } */
  const contas = { consultas: 0, reaproveitadas: 0, correcoes: 0, falhas: 0 };

  async function modelosDoFornecedor(provider, apiKey) {
    const c = cache.get(provider);
    if (c && relogio() - c.at < cacheMs) { contas.reaproveitadas++; return c.models; }
    contas.consultas++;
    const r = await Promise.resolve(listModels({ provider, apiKey, timeoutMs: 8000 })).catch((e) => ({ ok: false, error: String(e && e.message) }));
    if (!r || !r.ok || !r.models || !r.models.length) return [];
    cache.set(provider, { at: relogio(), models: r.models });
    return r.models;
  }

  async function completarComModelo({ provider, apiKey, modelo, mensagens, timeoutMs }) {
    const r1 = await complete({ provider, apiKey, model: modelo, messages: mensagens, timeoutMs });
    if (r1 && r1.ok) return { r: r1, modelo };
    if (!erroDeModelo(r1)) return { r: r1, modelo };
    const decisaoDoFornecedor = { escolhido: sugestaoDoFornecedor((r1 && (r1.detalhe || r1.error)) || ''), razao: 'o próprio fornecedor indicou o modelo a usar' };
    if (decisaoDoFornecedor.escolhido && decisaoDoFornecedor.escolhido !== modelo) {
      const r2 = await complete({ provider, apiKey, model: decisaoDoFornecedor.escolhido, messages: mensagens, timeoutMs });
      contas.correcoes++;
      if (r2 && r2.ok) {
        return { r: Object.assign({}, r2, { modeloCorrigido: decisaoDoFornecedor.escolhido, modeloPedido: modelo, razaoDaCorrecao: decisaoDoFornecedor.razao }),
          modelo: decisaoDoFornecedor.escolhido };
      }
    }
    const lista = await modelosDoFornecedor(provider, apiKey);
    const decisao = razaoDaEscolha(lista, modelo);
    if (!decisao.escolhido || decisao.escolhido === modelo) {
      contas.falhas++;
      return { r: r1, modelo, listaConsultada: lista.length, razao: decisao.razao };
    }
    const r2 = await complete({ provider, apiKey, model: decisao.escolhido, messages: mensagens, timeoutMs });
    contas.correcoes++;
    return {
      r: Object.assign({}, r2, { modeloCorrigido: decisao.escolhido, modeloPedido: modelo, razaoDaCorrecao: decisao.razao }),
      modelo: decisao.escolhido
    };
  }

  return { completarComModelo, modelosDoFornecedor, contas, cache };
}
