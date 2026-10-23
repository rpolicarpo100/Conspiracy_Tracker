/* =====================================================================
   ROUTER DE FORNECEDORES POR PERFIL (FASE E3)

   Até aqui a cascata de IA era uma ordem única (`AI_OPERATOR_ORDER`) igual para
   todos os perfis: uma triagem de 2 minutos podia acabar no fornecedor mais
   lento e uma investigação exaustiva podia acabar no mais barato — sem que
   ninguém tivesse decidido isso, e sem que ficasse registado.

   Este módulo decide QUEM serve cada PASSO em cada PERFIL, e escreve a razão.
   Nada aqui fala com a rede: recebe candidatos com o que foi MEDIDO
   (`latenciaMs`, `custoPorMil`, `qualidade`, `produzJson`) e devolve a escolha
   com os rejeitados e o motivo de cada rejeição.

   Regras que não se negociam:
   · uma candidata sem estado de catálogo validado (validado / em-uso /
     degradado) não é escolhida — estado desconhecido não é disponibilidade;
   · um passo que exige JSON nunca é servido por quem devolve texto livre
     (`produzJson === false`), seja qual for a nota;
   · `degradado` só entra se não houver alternativa válida, e a razão di-lo;
   · o desempate é determinístico (id do fornecedor), não a ordem do array;
   · sem candidata que sobreviva, o router NÃO escolhe: devolve o que falta.
   ===================================================================== */

export const ROUTER_VERSION = 'r1';

/* Política por perfil. A tabela é a decisão; os números são tectos, não desejos. */
export const PROFILE_POLICY = {
  rapida: { criterio: 'latencia', latenciaMaxMs: 8000, permiteDegradado: false, prefereComChave: false, exigeJson: true },
  normal: { criterio: 'custo', latenciaMaxMs: 15000, permiteDegradado: false, prefereComChave: false, exigeJson: true },
  profunda: { criterio: 'qualidade', latenciaMaxMs: 30000, permiteDegradado: true, prefereComChave: true, exigeJson: true },
  exaustiva: { criterio: 'qualidade', latenciaMaxMs: 60000, permiteDegradado: true, prefereComChave: true, exigeJson: true }
};

const ESTADOS_SERVIVEIS = ['validado', 'em-uso'];
const ESTADOS_COM_DEGRADADO = ['validado', 'em-uso', 'degradado'];

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

/* Normaliza uma candidata: o que não foi medido fica null e é dito como tal. */
export function normalizeCandidate(c) {
  const o = c || {};
  return {
    provider: String(o.provider || o.id || '').trim() || null,
    estado: String(o.estado || 'desconhecido'),
    latenciaMs: num(o.latenciaMs),
    custoPorMil: num(o.custoPorMil),
    qualidade: num(o.qualidade),
    produzJson: o.produzJson === true ? true : (o.produzJson === false ? false : null),
    semChave: !!o.semChave,
    nota: o.nota || null
  };
}

function motivoDeRejeicao(c, politica, o) {
  if (!c.provider) return 'candidata sem identificador';
  const serveis = politica.permiteDegradado ? ESTADOS_COM_DEGRADADO : ESTADOS_SERVIVEIS;
  if (!serveis.includes(c.estado)) {
    return 'estado «' + c.estado + '»: não foi validada na aplicação' +
      (c.estado === 'descontinuado' ? ' (descontinuada)' : '');
  }
  if (o.exigeJson && c.produzJson === false) return 'devolve texto livre: nunca serve um passo que exige JSON';
  if (o.exigeJson && c.produzJson === null) return 'não há prova de que devolva JSON num passo que exige JSON';
  if (c.latenciaMs == null) return 'latência por medir: sem medição não se compara';
  if (c.latenciaMs > politica.latenciaMaxMs) {
    return 'latência medida ' + c.latenciaMs + ' ms acima do tecto do perfil (' + politica.latenciaMaxMs + ' ms)';
  }
  return null;
}

/* Ordenação determinística por critério do perfil. */
function comparar(criterio) {
  return (a, b) => {
    if (criterio === 'latencia') {
      if (a.latenciaMs !== b.latenciaMs) return a.latenciaMs - b.latenciaMs;
    } else if (criterio === 'custo') {
      const ca = a.custoPorMil == null ? Infinity : a.custoPorMil;
      const cb = b.custoPorMil == null ? Infinity : b.custoPorMil;
      if (ca !== cb) return ca - cb;
      if (a.latenciaMs !== b.latenciaMs) return a.latenciaMs - b.latenciaMs;
    } else {
      const qa = a.qualidade == null ? -1 : a.qualidade;
      const qb = b.qualidade == null ? -1 : b.qualidade;
      if (qb !== qa) return qb - qa;
      if (a.latenciaMs !== b.latenciaMs) return a.latenciaMs - b.latenciaMs;
    }
    return a.provider < b.provider ? -1 : (a.provider > b.provider ? 1 : 0);
  };
}

/* A decisão. `o` aceita: perfil, passo, candidatos, exigeJson (por omissão o do
   perfil), agora. Devolve sempre a razão do que fez — inclusive quando não escolhe. */
export function routeProvider(o) {
  const opts = o || {};
  const perfil = String(opts.perfil || 'normal');
  const politica = PROFILE_POLICY[perfil];
  const razao = [];
  if (!politica) {
    return { ok: false, perfil, motivo: 'perfil desconhecido: ' + perfil,
      conhecidos: Object.keys(PROFILE_POLICY), razao: ['perfil fora da tabela: não se escolhe por analogia'] };
  }
  const passo = opts.passo ? String(opts.passo) : null;
  if (!passo) {
    return { ok: false, perfil, motivo: 'sem passo: o fornecedor certo depende do passo',
      razao: ['um router por perfil sem passo é uma ordem fixa com outro nome'] };
  }
  const exigeJson = opts.exigeJson == null ? politica.exigeJson : !!opts.exigeJson;
  const candidatos = (opts.candidatos || []).map(normalizeCandidate);
  razao.push('perfil ' + perfil + ' · critério «' + politica.criterio + '» · tecto ' + politica.latenciaMaxMs + ' ms' +
    (exigeJson ? ' · passo exige JSON' : ''));
  if (!candidatos.length) {
    return { ok: false, perfil, passo, motivo: 'não há candidatas: nada foi medido, nada é escolhido',
      razao: razao.concat(['sem candidatos não se inventa fornecedor']), rejeitados: [] };
  }
  const rejeitados = [];
  let viveiros = [];
  candidatos.forEach((c) => {
    const m = motivoDeRejeicao(c, politica, { exigeJson });
    if (m) rejeitados.push({ provider: c.provider, motivo: m, estado: c.estado });
    else viveiros.push(c);
  });
  /* degradado é a última escolha: só sobrevive se não houver são */
  const saos = viveiros.filter((c) => c.estado !== 'degradado');
  if (saos.length) {
    viveiros.filter((c) => c.estado === 'degradado').forEach((c) => {
      rejeitados.push({ provider: c.provider, motivo: 'degradado e há alternativa válida', estado: c.estado });
    });
    viveiros = saos;
  } else if (viveiros.length) {
    razao.push('só há fornecedores degradados: a escolha é declarada como degradada');
  }
  if (!viveiros.length) {
    return {
      ok: false, perfil, passo, motivo: 'nenhuma candidata sobreviveu às regras do perfil',
      razao, rejeitados,
      falta: rejeitados.map((r) => r.provider + ': ' + r.motivo)
    };
  }
  viveiros.sort(comparar(politica.criterio));
  const escolhido = viveiros[0];
  const alternativa = viveiros[1] || null;
  razao.push('escolhido ' + escolhido.provider + ' por ' +
    (politica.criterio === 'latencia' ? 'menor latência medida (' + escolhido.latenciaMs + ' ms)'
      : politica.criterio === 'custo' ? 'menor custo medido por mil tokens (' + (escolhido.custoPorMil == null ? 'desconhecido' : escolhido.custoPorMil) + ')'
        : 'maior qualidade medida (' + (escolhido.qualidade == null ? 'desconhecida' : escolhido.qualidade) + ')'));
  if (alternativa) {
    razao.push('alternativa ' + alternativa.provider + ' (não venceu: ' +
      (politica.criterio === 'latencia' ? 'latência ' + alternativa.latenciaMs + ' ms'
        : politica.criterio === 'custo' ? 'custo ' + (alternativa.custoPorMil == null ? 'desconhecido' : alternativa.custoPorMil)
          : 'qualidade ' + (alternativa.qualidade == null ? 'desconhecida' : alternativa.qualidade)) + ')');
  }
  return {
    ok: true, perfil, passo, criterio: politica.criterio, exigeJson,
    escolhido: escolhido.provider, estado: escolhido.estado,
    degradado: escolhido.estado === 'degradado',
    alternativa: alternativa ? alternativa.provider : null,
    razao, rejeitados,
    politica: { latenciaMaxMs: politica.latenciaMaxMs, permiteDegradado: politica.permiteDegradado },
    versao: ROUTER_VERSION
  };
}

/* A tabela perfil × passo, para mostrar na interface e para o teste comparar:
   com o mesmo catálogo, perfis diferentes escolhem fornecedores diferentes. */
export function routeTable(opts) {
  const o = opts || {};
  const passos = o.passos || [];
  const candidatos = o.candidatos || [];
  const out = {};
  Object.keys(PROFILE_POLICY).forEach((perfil) => {
    out[perfil] = passos.map((passo) => {
      const r = routeProvider({ perfil, passo, candidatos, exigeJson: o.exigeJson });
      return { passo, ok: r.ok, escolhido: r.escolhido || null, motivo: r.motivo || null,
        criterio: r.criterio || null, rejeitados: (r.rejeitados || []).length };
    });
  });
  return out;
}

/* Candidata a partir de um fornecedor declarado em server/providers.mjs, com o
   que se sabe dele. `produzJson` só é true quando há prova; o sem-chave
   declarado como texto livre fica false, e por isso nunca serve um passo JSON. */
export function candidateFromProvider(id, spec, extra) {
  const e = extra || {};
  return normalizeCandidate({
    provider: id, estado: e.estado || 'desconhecido',
    latenciaMs: e.latenciaMs == null ? null : e.latenciaMs,
    custoPorMil: e.custoPorMil == null ? null : e.custoPorMil,
    qualidade: e.qualidade == null ? null : e.qualidade,
    produzJson: spec && spec.produzJson === false ? false : (e.produzJson === true ? true : null),
    semChave: !!(spec && spec.keyless),
    nota: e.nota || null
  });
}
