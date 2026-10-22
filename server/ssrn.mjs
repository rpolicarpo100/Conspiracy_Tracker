/* =====================================================================
   SSRN — O QUE É POSSÍVEL EXTRAIR, E O QUE NÃO É (fase 11)

   Medido em 2026-10-22, sem contornar nada:
     · https://www.ssrn.com/robots.txt .......... HTTP 200. O robots permite o
       acesso geral (Disallow só para GPTBot/ChatGPT-User e para /admin/, /tasks/,
       /config/), com Crawl-delay: 5.
     · Página de resumo (papers.ssrn.com/sol3/papers.cfm?abstract_id=…) ... HTTP 403.
       Duas respostas medidas: «Content Blocked» (pedido com cabeçalho de navegador)
       e «Just a moment…» / desafio JavaScript (pedido do servidor, sem cabeçalhos
       de navegador). É um bloqueio TÉCNICO, não um paywall, e NÃO se contorna
       (sem UA falsificado em série, sem resolver desafios, sem proxies).
     · PDF (Delivery.cfm) ...................... HTTP 403, mesmo bloqueio.
     · doi.org/10.2139/ssrn.<id> ............... HTTP 302 → ssrn.com/abstract=<id>;
       o destino devolve o mesmo 403.
     · api.crossref.org/works/10.2139/ssrn.<id>  HTTP 200: TÍTULO, autores,
       filiação, data, editora, tipo e RESUMO (JATS). O SSRN deposita metadados
       no Crossref com o prefixo 10.2139 — é por aí que se lê a ficha.
     · api.openalex.org (fonte S4210172589 = SSRN Electronic Journal)  HTTP 200:
       existência, ano, DOI, contagens de citação; o resumo não é publicado.
     · api.unpaywall.org/v2/<doi> .............. devolve a própria DOI como
       localização OA (circular): não há cópia aberta do texto completo.

   Conclusão honesta: METAADOS SIM (Crossref/OpenAlex), TEXTO COMPLETO NÃO.
   Este módulo só faz a parte que funciona e declara a que não funciona. Não
   tenta ler a página bloqueada e não apresenta o resumo do autor como prova
   do conteúdo do artigo.
   ===================================================================== */
import { isPrivateHost } from './providers.mjs';

export const SSRN = {
  prefixoDoi: '10.2139/ssrn.',
  baseCrossref: 'https://api.crossref.org/works/',
  fonteOpenAlex: 'https://openalex.org/S4210172589',
  bloqueioMedido: {
    paginaResumo: { url: 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3247331', status: 403, at: '2026-10-22', motivo: 'Content Blocked (protecção do fornecedor)' },
    pdf: { url: 'https://papers.ssrn.com/sol3/Delivery.cfm/abstractid=4461514', status: 403, at: '2026-10-22', motivo: 'Content Blocked' },
    robots: { url: 'https://www.ssrn.com/robots.txt', status: 200, at: '2026-10-22', nota: 'permite acesso geral; Crawl-delay: 5; bloqueia GPTBot/ChatGPT-User' }
  }
};

/* Aceita: «4461514», «ssrn.4461514», «10.2139/ssrn.4461514», URL do SSRN com
   abstract_id, ou URL doi.org. Devolve {ok, id} ou {ok:false, reason}. */
export function extrairIdSSRN(entrada) {
  const s = String(entrada || '').trim();
  if (!s) return { ok: false, reason: 'entrada vazia: indicar um identificador SSRN' };
  let m = s.match(/(?:10\.2139\/ssrn\.)(\d{4,9})/i);
  if (m) return { ok: true, id: m[1] };
  m = s.match(/abstract(?:_id)?[=\/](\d{4,9})/i);
  if (m) return { ok: true, id: m[1] };
  m = s.match(/^ssrn\.(\d{4,9})$/i);
  if (m) return { ok: true, id: m[1] };
  m = s.match(/^(\d{4,9})$/);
  if (m) return { ok: true, id: m[1] };
  return { ok: false, reason: 'não reconheci um identificador SSRN (esperado: 4461514, ssrn.4461514, 10.2139/ssrn.4461514 ou o URL do resumo)' };
}

function limparJats(html) {
  return String(html || '')
    .replace(/<jats:title>[\s\S]*?<\/jats:title>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Só HTTPS público. O correio de contacto do Crossref (mailto) identifica quem
   faz o pedido — exigência de boa cidadania da API. */
export async function lerMetadadosSSRN(id, opts) {
  const o = opts || {};
  const fetchImpl = o.fetchImpl || fetch;
  const doi = SSRN.prefixoDoi + id;
  const mailto = o.mailto || process.env.CROSSREF_MAILTO || null;
  const url = SSRN.baseCrossref + encodeURIComponent(doi) + (mailto ? '?mailto=' + encodeURIComponent(mailto) : '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 20000);
  const t0 = Date.now();
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    const txt = (await res.text()).slice(0, 262144);
    let json = null; try { json = JSON.parse(txt); } catch { /* não JSON */ }
    if (res.status === 404) {
      return { ok: false, reason: 'o Crossref não tem metadados para ' + doi + ' (pode não estar depositado)', status: 404, ms: Date.now() - t0 };
    }
    if (!res.ok || !json || !json.message) {
      return { ok: false, reason: 'Crossref respondeu HTTP ' + res.status, status: res.status, ms: Date.now() - t0 };
    }
    const m = json.message;
    const data = (m.created && m.created['date-parts'] && m.created['date-parts'][0]) || null;
    const autores = (m.author || []).map((a) => ({
      nome: [a.given, a.family].filter(Boolean).join(' ') || a.name || null,
      afiliacao: (a.affiliation || []).map((x) => x.name).filter(Boolean).join('; ') || null
    })).filter((a) => a.nome);
    const resumo = m.abstract ? limparJats(m.abstract) : null;
    return {
      ok: true, ms: Date.now() - t0,
      id, doi, doiUrl: 'https://doi.org/' + doi,
      titulo: (m.title && m.title[0]) || null,
      subtitulo: (m.subtitle && m.subtitle[0]) || null,
      autores,
      data: data ? data.join('-') : null,
      editora: m.publisher || null,
      tipo: m.type || null,
      urlCrossref: m.URL || null,
      recursoPrimario: (m.resource && m.resource.primary && m.resource.primary.URL) || null,
      resumo,
      /* O resumo é do autor, depositado no Crossref. Não é o texto do artigo. */
      resumoFonte: resumo ? 'resumo do autor depositado no Crossref (não é o texto completo)' : null,
      textoCompleto: {
        disponivel: false,
        motivo: 'SSRN devolve HTTP 403 (bloqueio técnico do fornecedor) na página de resumo e no PDF; não se contorna',
        medidoEm: SSRN.bloqueioMedido.paginaResumo.at,
        alternativas: ['pedir o PDF ao autor', 'procurar cópia em repositório institucional', 'verificar se há versão publicada com DOI de editora']
      },
      metodo: { via: 'Crossref', url, at: new Date().toISOString(), papel: 'apenas metadados' }
    };
  } catch (e) {
    return { ok: false, reason: 'sem resposta do Crossref: ' + String(e.message || e).slice(0, 120), ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

/* Sonda de bloqueio: faz UM pedido GET e relata o que recebeu. Não tenta
   ultrapassar nada, não muda de utilizador, não repete com outros cabeçalhos. */
export async function sondarBloqueioSSRN(id, opts) {
  const o = opts || {};
  const fetchImpl = o.fetchImpl || fetch;
  const url = 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=' + encodeURIComponent(id);
  const host = new URL(url).hostname;
  if (isPrivateHost(host)) return { ok: false, reason: 'endereço privado proibido' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 15000);
  const t0 = Date.now();
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'text/html' } });
    const txt = (await res.text()).slice(0, 4096);
    const desafio = /just a moment|cf-chl|attention required|checking your browser/i.test(txt);
    const bloqueado = /content blocked/i.test(txt) || desafio;
    return {
      ok: true, url, status: res.status, ms: Date.now() - t0, bloqueado, desafio,
      conclusao: bloqueado
        ? (desafio ? 'desafio anti-robô (Cloudflare) na resposta: não se resolve nem se contorna'
          : 'página bloqueada pelo fornecedor (não se contorna)')
        : res.status === 200 ? 'página acessível neste pedido'
        : 'HTTP ' + res.status + ': não se conclui acesso',
      amostra: txt.slice(0, 120)
    };
  } catch (e) {
    return { ok: false, url, reason: 'sem resposta: ' + String(e.message || e).slice(0, 120), ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}
