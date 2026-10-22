/* =====================================================================
   PESQUISA NO TRABALHO DO UTILIZADOR — motor do servidor (GET /api/search)

   Porque existe este ficheiro: até à fase 11 o servidor comparava a consulta
   inteira como SUBSTRING do texto. Consequências medidas (bancada
   tools/bench-search.mjs, 23 consultas com alvo conhecido): 1/23 alvos no
   topo-5, e 0 resultados para «financiamento 2019», «fundação calouste»,
   «ministério saúde» — consultas que uma pessoa escreve naturalmente.

   O que este motor faz, e o que NÃO faz:

   · caixa e acentos indiferentes (dobra 1:1, para os índices continuarem a
     apontar para o texto original — o recorte antigo desalinhava em textos
     com acentos);
   · vários termos = E (todos têm de aparecer), em qualquer ordem e campo;
   · "frase exacta" = os termos têm de aparecer seguidos;
   · -termo = exclui;
   · prefixo a partir de 3 letras («financ» encontra «financiamento»), nunca
     abaixo disso (senão «de» casaria com tudo);
   · se E não devolver nada, alarga para OU e DECLARA que alargou — nunca
     devolve zero fingindo que o alargamento não existiu;
   · pontuação explicável: peso do campo × qualidade da correspondência
     (palavra inteira > prefixo > dentro da palavra). Nada de «relevância»
     inventada por modelo: a ordem é reproduzível e testada.

   Não faz: sinónimos, stemming agressivo, semântica, correcção de gralhas.
   Estas exigem dicionário ou modelo; ficam declaradas como ausentes em vez
   de simuladas.
   ===================================================================== */

export const PESQUISA = {
  versao: 1,
  minPrefixo: 3,
  minTermo: 2,
  maxTermos: 12,
  janelaRecorte: 160,
  /* palavras que não distinguem nada: fora dos termos soltos (dentro de uma
     "frase" continuam a contar, porque aí a ordem importa) */
  paragem: new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'o', 'a', 'os', 'as', 'um', 'uma',
    'uns', 'umas', 'para', 'por', 'com', 'em', 'no', 'na', 'nos', 'nas', 'que', 'ao', 'aos',
    'se', 'ou', 'como', 'mais', 'ja', 'nao', 'sem', 'entre', 'sobre', 'foi', 'ser', 'sao',
    'the', 'of', 'and']),
  /* pesos por campo: o título diz mais sobre o assunto do que o corpo */
  pesos: { project: 6, claim: 4, memory: 4, evidence: 3, document: 3, relation: 3, entity: 4 },
  ordemTipo: { project: 0, claim: 1, evidence: 2, relation: 3, entity: 4, document: 5, memory: 6 }
};

/* Dobra 1:1: cada carácter acentuado torna-se um ASCII, sem mudar o
   comprimento. É isto que permite usar o índice da dobra para recortar o
   texto original sem deslizar uma letra por cada acento. */
const ACENTOS = {
  a: 'àáâãäåāăą', A: 'ÀÁÂÃÄÅĀĂĄ', e: 'èéêëēĕėęě', E: 'ÈÉÊËĒĔĖĘĚ',
  i: 'ìíîïĩīĭį', I: 'ÌÍÎÏĨĪĬĮ', o: 'òóôõöøōŏő', O: 'ÒÓÔÕÖØŌŎŐ',
  u: 'ùúûüũūŭůűų', U: 'ÙÚÛÜŨŪŬŮŰŲ', c: 'çćĉċč', C: 'ÇĆĈĊČ',
  n: 'ñńņň', N: 'ÑŃŅŇ', s: 'śŝşš', S: 'ŚŜŞŠ', z: 'źżž', Z: 'ŹŻŽ',
  y: 'ýÿŷ', Y: 'ÝŸŶ', l: 'łļ', L: 'ŁĻ', g: 'ĝğġģ', G: 'ĜĞĠĢ',
  r: 'ŕŗř', R: 'ŔŖŘ', t: 'ţť', T: 'ŢŤ', d: 'ďđ', D: 'ĎĐ'
};
const TABELA = (() => {
  const m = new Map();
  for (const [base, lista] of Object.entries(ACENTOS)) {
    for (const ch of lista) m.set(ch, base);
  }
  return m;
})();

export function fold(texto) {
  const s = String(texto == null ? '' : texto);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    out += TABELA.get(ch) || ch;      // fora da tabela: fica como está, mesmo comprimento
  }
  return out;
}

/* tokens com posição no texto dobrado (para recortar sem adivinhar) */
export function tokens(texto) {
  const dobrado = fold(texto).toLowerCase();
  const out = [];
  const re = /[0-9a-z]+/g;
  let m;
  while ((m = re.exec(dobrado))) out.push({ t: m[0], s: m.index, e: m.index + m[0].length });
  return out;
}

export function parseQuery(q) {
  const bruto = String(q || '').trim();
  const termos = [];
  const frases = [];
  const negativos = [];
  const re = /("([^"]+)"|(\S+))/g;
  let m;
  while ((m = re.exec(bruto))) {
    if (m[2]) {
      const f = tokens(m[2]).map((x) => x.t);
      if (f.length) frases.push(f);
      continue;
    }
    let t = m[3];
    if (!t) continue;
    let negar = false;
    if (t.startsWith('-') && t.length > 1) { negar = true; t = t.slice(1); }
    const limpos = tokens(t).map((x) => x.t)
      .filter((x) => x.length >= PESQUISA.minTermo && !PESQUISA.paragem.has(x));
    limpos.forEach((x) => (negar ? negativos : termos).push(x));
  }
  const vistos = new Set();
  const unicos = termos.filter((t) => (vistos.has(t) ? false : (vistos.add(t), true))).slice(0, PESQUISA.maxTermos);
  const cons = { bruto, termos: unicos, frases, negativos, valido: !!(unicos.length || frases.length) };
  cons.termosPorFrase = frases.map((f) => f.join(' '));
  return cons;
}

/* Qualidade da correspondência de um termo num texto já dobrado:
   3 = palavra inteira, 2 = prefixo de palavra, 1 = dentro de palavra, 0 = nada. */
function qualidade(tokLista, termo) {
  let melhor = 0, indice = -1;
  const prefixo = termo.length >= PESQUISA.minPrefixo;
  for (const tk of tokLista) {
    if (tk.t === termo) { if (melhor < 3) { melhor = 3; indice = tk.s; } if (melhor === 3) break; continue; }
    if (prefixo && tk.t.startsWith(termo)) { if (melhor < 2) { melhor = 2; indice = tk.s; } continue; }
    if (tk.t.indexOf(termo) >= 0) { if (melhor < 1) { melhor = 1; indice = tk.s; } }
  }
  return { melhor, indice };
}

/* Frase: os tokens têm de aparecer exactamente seguidos. */
function temFrase(tokLista, fraseTokens) {
  if (!fraseTokens.length) return -1;
  const alvo = fraseTokens.join(' ');
  const lista = tokLista.map((x) => x.t);
  for (let i = 0; i + fraseTokens.length <= lista.length; i++) {
    if (lista.slice(i, i + fraseTokens.length).join(' ') === alvo) return tokLista[i].s;
  }
  return -1;
}

/* Pontua um texto. Devolve null quando os requisitos (E + frases) não se cumprem. */
export function pontuarTexto(texto, consulta, opts) {
  const o = opts || {};
  const tokLista = tokens(texto);
  if (!tokLista.length) return null;
  for (const neg of consulta.negativos) {
    if (qualidade(tokLista, neg).melhor > 0) return null;      // contém termo excluído
  }
  let soma = 0, primeiro = -1, casados = 0;
  const detalhe = [];
  for (const termo of consulta.termos) {
    const r = qualidade(tokLista, termo);
    if (!r.melhor) {
      if (o.exigirTodos !== false) return null;
      continue;
    }
    casados++;
    const pontos = r.melhor * (o.peso == null ? 1 : o.peso);
    soma += pontos;
    detalhe.push({ termo, qualidade: r.melhor, pontos });
    if (primeiro < 0 || r.indice < primeiro) primeiro = r.indice;
  }
  for (const f of consulta.frases) {
    const idx = temFrase(tokLista, f);
    if (idx < 0) { if (o.exigirTodos !== false) return null; continue; }
    const pontos = 5 * (o.peso == null ? 1 : o.peso);
    soma += pontos;
    detalhe.push({ frase: f.join(' '), qualidade: 3, pontos });
    if (primeiro < 0 || idx < primeiro) primeiro = idx;
  }
  if (!detalhe.length) return null;
  return { pontos: soma, primeiro, casados: detalhe.length, detalhe };
}

/* Recorte à volta do primeiro termo encontrado, alinhado com o texto ORIGINAL
   (a dobra é 1:1, por isso o índice serve nos dois). */
export function recorte(texto, indice, janela) {
  const t = String(texto || '');
  const w = janela || PESQUISA.janelaRecorte;
  if (indice == null || indice < 0) return t.slice(0, w);
  const meia = Math.floor(w / 3);
  const ini = Math.max(0, indice - meia);
  const fim = Math.min(t.length, ini + w);
  return (ini > 0 ? '…' : '') + t.slice(ini, fim).trim() + (fim < t.length ? '…' : '');
}

/* Pontua um item com vários campos e devolve o melhor campo. */
export function pontuarItem(campos, consulta, pesoItem, opts) {
  let melhor = null;
  for (const c of campos) {
    if (!c || !c.texto) continue;
    const r = pontuarTexto(c.texto, consulta, { peso: c.peso || 1, exigirTodos: !opts || opts.exigirTodos !== false });
    if (!r) continue;
    const pontos = r.pontos * (pesoItem || 1);
    if (!melhor || pontos > melhor.pontos) {
      melhor = { pontos, campo: c.campo, texto: c.texto, primeiro: r.primeiro, detalhe: r.detalhe };
    }
  }
  return melhor;
}

/* Raridade de um termo: quantos itens menos contêm o termo, mais ele distingue.
   1 para o termo mais comum, até 4 para o termo que só aparece num item.
   É logarítmica de propósito: não deixa um código raro esmagar tudo o resto. */
export function pesoRaridade(df, total) {
  if (!df || !total) return 1;
  const r = 1 + Math.log(total / df);
  return Math.max(1, Math.min(4, r));
}

/* Ordena: pontos desc, depois ordem do tipo, depois recência (texto ISO). */
export function ordenar(itens) {
  return itens.slice().sort((a, b) => {
    if (b.pontos !== a.pontos) return b.pontos - a.pontos;
    const ta = PESQUISA.ordemTipo[a.type] == null ? 9 : PESQUISA.ordemTipo[a.type];
    const tb = PESQUISA.ordemTipo[b.type] == null ? 9 : PESQUISA.ordemTipo[b.type];
    if (ta !== tb) return ta - tb;
    return String(b.at || '').localeCompare(String(a.at || ''));
  });
}
