/* =====================================================================
   REGISTO DE FONTES — descoberta, verificação técnica e classificação

   O que este módulo é: a peça determinística de um sistema de expansão de
   fontes. Não decide «isto é verdade»; decide «esta fonte responde, é o que
   diz ser, e com que evidência se pode classificar».

   Princípios que estão no código, não só na documentação:

   · Nenhuma classificação sem evidência. Se faltarem verificações, o
     resultado é «Classificação provisória — evidência insuficiente», com a
     lista do que falta. Nunca se preenche o vazio com um número simpático.
   · Oito dimensões medidas em separado. Não há média que esconda um risco
     crítico: se o risco for elevado, a classificação global desce e o motivo
     é escrito.
   · Risco e credibilidade são coisas diferentes: risco 100 = risco elevado.
   · Uma verificação é um facto datado: HTTP, tipo de conteúdo, TLS, cadeia
     de redireccionamentos. Falhar hoje não apaga o sucesso de ontem — o
     histórico fica.
   · Não se contorna nada: o acesso é uma leitura simples, sem cookies, sem
     credenciais, sem execução de scripts, e uma fonte que exige autenticação
     fica `RESTRICTED` — não é «testada com sucesso».
   · Descoberta com fontes reais e citáveis: os adaptadores chamam APIs
     públicas documentadas e registam a consulta exacta. Nada é gerado.
   ===================================================================== */

export const SOURCE_STATES = {
  DISCOVERED: { label: 'Descoberta', order: 1, hint: 'sabemos que existe; ainda não foi verificada' },
  PENDING_VALIDATION: { label: 'Por validar', order: 2, hint: 'na fila de verificação' },
  TECHNICAL_TESTING: { label: 'Em teste técnico', order: 3, hint: 'verificação em curso' },
  CONTENT_AUDIT: { label: 'Auditoria de conteúdo', order: 4, hint: 'a responder; falta olhar para o conteúdo' },
  NEEDS_REVIEW: { label: 'Necessita revisão', order: 5, hint: 'há resultados contraditórios ou incompletos' },
  APPROVED: { label: 'Aprovada', order: 6, hint: 'cumpre os critérios; pode ser usada' },
  ACTIVE: { label: 'Activa', order: 7, hint: 'em uso, com verificações periódicas' },
  DEGRADED: { label: 'Degradada', order: 8, hint: 'responde pior do que antes; usar com cautela' },
  TEMPORARILY_UNAVAILABLE: { label: 'Temporariamente indisponível', order: 9, hint: 'falha recente; pode ser passageiro' },
  RESTRICTED: { label: 'Restrita', order: 10, hint: 'exige autenticação, CAPTCHA ou limitação de acesso' },
  REJECTED: { label: 'Rejeitada', order: 11, hint: 'não serve o objectivo ou não é o que diz ser' },
  DEPRECATED: { label: 'Descontinuada', order: 12, hint: 'deixou de ser mantida' }
};

/* Categorias da fase A do pedido. Mantidas como dados, para que a cobertura
   e as lacunas sejam contáveis em vez de descritas. */
export const SOURCE_CATEGORIES = {
  tribunais: 'Tribunais e jurisprudência',
  ministerio_publico: 'Ministério Público e procuradorias',
  policia: 'Polícia e autoridades de investigação',
  anticorrupcao: 'Organismos de combate à corrupção',
  registo_comercial: 'Registos comerciais e societários',
  beneficiarios_efectivos: 'Registos de beneficiários efectivos',
  contratos_publicos: 'Contratos públicos e concursos',
  despesa_publica: 'Despesas públicas e execução orçamental',
  tribunal_contas: 'Tribunais de contas e auditorias',
  regulador_financeiro: 'Reguladores financeiros',
  bolsa: 'Bolsas e informação sobre cotadas',
  insolvencias: 'Insolvências e falências',
  propriedade: 'Registos de propriedade',
  patentes: 'Patentes e marcas',
  interesses: 'Declarações de interesses e património',
  financiamento_politico: 'Financiamento político e eleitoral',
  lobbying: 'Grupos de pressão e lobbying',
  sancoes: 'Sanções',
  concorrencia: 'Autoridades da concorrência',
  protecao_dados: 'Autoridades de protecção de dados',
  parlamento: 'Comissões parlamentares e inquéritos',
  relatorios_governo: 'Relatórios governamentais',
  arquivos: 'Arquivos históricos e desclassificados',
  universidades: 'Universidades e repositórios científicos',
  organizacoes_internacionais: 'Organizações internacionais',
  ongs: 'ONG com metodologia publicada',
  jornalismo: 'Jornalismo de investigação',
  noticias_arquivo: 'Arquivos de notícias e bibliotecas digitais',
  bases_empresas: 'Bases de dados de empresas e dirigentes',
  outra: 'Outra (descoberta durante o funcionamento)'
};

/* Jurisdições: dados públicos (ISO 3166 alfa-2 + línguas oficiais mais usadas
   nas fontes). A lista é um ponto de partida para medir cobertura — não é uma
   afirmação de que existam fontes mapeadas em cada país. */
export const JURISDICTIONS = [
  { code: 'PT', name: 'Portugal', languages: ['pt'], region: 'Europa' },
  { code: 'ES', name: 'Espanha', languages: ['es'], region: 'Europa' },
  { code: 'FR', name: 'França', languages: ['fr'], region: 'Europa' },
  { code: 'IT', name: 'Itália', languages: ['it'], region: 'Europa' },
  { code: 'DE', name: 'Alemanha', languages: ['de'], region: 'Europa' },
  { code: 'NL', name: 'Países Baixos', languages: ['nl'], region: 'Europa' },
  { code: 'BE', name: 'Bélgica', languages: ['nl', 'fr', 'de'], region: 'Europa' },
  { code: 'IE', name: 'Irlanda', languages: ['en', 'ga'], region: 'Europa' },
  { code: 'GB', name: 'Reino Unido', languages: ['en'], region: 'Europa' },
  { code: 'CH', name: 'Suíça', languages: ['de', 'fr', 'it'], region: 'Europa' },
  { code: 'AT', name: 'Áustria', languages: ['de'], region: 'Europa' },
  { code: 'SE', name: 'Suécia', languages: ['sv'], region: 'Europa' },
  { code: 'NO', name: 'Noruega', languages: ['no'], region: 'Europa' },
  { code: 'DK', name: 'Dinamarca', languages: ['da'], region: 'Europa' },
  { code: 'FI', name: 'Finlândia', languages: ['fi', 'sv'], region: 'Europa' },
  { code: 'PL', name: 'Polónia', languages: ['pl'], region: 'Europa' },
  { code: 'CZ', name: 'Chéquia', languages: ['cs'], region: 'Europa' },
  { code: 'GR', name: 'Grécia', languages: ['el'], region: 'Europa' },
  { code: 'RO', name: 'Roménia', languages: ['ro'], region: 'Europa' },
  { code: 'UA', name: 'Ucrânia', languages: ['uk'], region: 'Europa' },
  { code: 'US', name: 'Estados Unidos', languages: ['en'], region: 'América do Norte' },
  { code: 'CA', name: 'Canadá', languages: ['en', 'fr'], region: 'América do Norte' },
  { code: 'MX', name: 'México', languages: ['es'], region: 'América Latina' },
  { code: 'BR', name: 'Brasil', languages: ['pt'], region: 'América Latina' },
  { code: 'AR', name: 'Argentina', languages: ['es'], region: 'América Latina' },
  { code: 'CL', name: 'Chile', languages: ['es'], region: 'América Latina' },
  { code: 'CO', name: 'Colômbia', languages: ['es'], region: 'América Latina' },
  { code: 'PE', name: 'Peru', languages: ['es'], region: 'América Latina' },
  { code: 'ZA', name: 'África do Sul', languages: ['en', 'af'], region: 'África' },
  { code: 'NG', name: 'Nigéria', languages: ['en'], region: 'África' },
  { code: 'KE', name: 'Quénia', languages: ['en', 'sw'], region: 'África' },
  { code: 'GH', name: 'Gana', languages: ['en'], region: 'África' },
  { code: 'MA', name: 'Marrocos', languages: ['ar', 'fr'], region: 'África' },
  { code: 'EG', name: 'Egipto', languages: ['ar'], region: 'África' },
  { code: 'IN', name: 'Índia', languages: ['en', 'hi'], region: 'Ásia' },
  { code: 'JP', name: 'Japão', languages: ['ja'], region: 'Ásia' },
  { code: 'KR', name: 'Coreia do Sul', languages: ['ko'], region: 'Ásia' },
  { code: 'ID', name: 'Indonésia', languages: ['id'], region: 'Ásia' },
  { code: 'SG', name: 'Singapura', languages: ['en'], region: 'Ásia' },
  { code: 'PH', name: 'Filipinas', languages: ['en', 'tl'], region: 'Ásia' },
  { code: 'CN', name: 'China', languages: ['zh'], region: 'Ásia' },
  { code: 'IL', name: 'Israel', languages: ['he'], region: 'Médio Oriente' },
  { code: 'AE', name: 'Emirados Árabes Unidos', languages: ['ar'], region: 'Médio Oriente' },
  { code: 'SA', name: 'Arábia Saudita', languages: ['ar'], region: 'Médio Oriente' },
  { code: 'TR', name: 'Turquia', languages: ['tr'], region: 'Médio Oriente' },
  { code: 'AU', name: 'Austrália', languages: ['en'], region: 'Oceânia' },
  { code: 'NZ', name: 'Nova Zelândia', languages: ['en'], region: 'Oceânia' },
  { code: 'JM', name: 'Jamaica', languages: ['en'], region: 'Caraíbas' },
  { code: 'DO', name: 'República Dominicana', languages: ['es'], region: 'Caraíbas' },
  { code: 'TT', name: 'Trindade e Tobago', languages: ['en'], region: 'Caraíbas' }
];

export const jurisdictionOf = (code) => JURISDICTIONS.find((j) => j.code === String(code || '').toUpperCase()) || null;

/* ---------------- URLs: normalização e deduplicação ---------------- */

const PRIVATE_PATTERNS = [
  /^localhost$/i, /\.local$/i, /^127\./, /^0\./, /^10\./, /^192\.168\./,
  /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^\[?::1\]?$/, /^\[?f[cd][0-9a-f]{2}:/i
];

export function parseUrl(input) {
  let u = null;
  try { u = new URL(String(input || '').trim()); } catch { return { ok: false, reason: 'URL inválido' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: 'só http(s)' };
  if (PRIVATE_PATTERNS.some((re) => re.test(u.hostname))) {
    return { ok: false, reason: 'endereço privado/local proibido (SSRF)' };
  }
  if (u.username || u.password) return { ok: false, reason: 'URL com credenciais embutidas é recusado' };
  return { ok: true, url: u, host: u.hostname.toLowerCase() };
}

/* URL canónico: sem fragmento, sem parâmetros de rastreio, sem barra final
   redundante e com o domínio em minúsculas. Serve para deduplicar. */
const TRACKING = /^(utm_|gclid$|fbclid$|mc_cid$|mc_eid$|ref$|referrer$|source$)/i;
export function canonicalUrl(input) {
  const p = parseUrl(input);
  if (!p.ok) return null;
  const u = new URL(p.url.toString());
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k));
  u.search = '';
  keep.sort((a, b) => (a[0] < b[0] ? -1 : 1)).forEach(([k, v]) => u.searchParams.append(k, v));
  let s = u.toString();
  if (u.pathname !== '/' && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

export const domainOf = (input) => {
  const p = parseUrl(input);
  if (!p.ok) return null;
  return p.host.replace(/^www\./, '');
};

/* Chave de duplicação: domínio+canónico. Duas URLs diferentes do mesmo
   documento (com parâmetros de campanha, por exemplo) caem na mesma chave. */
export const dedupeKey = (input) => {
  const c = canonicalUrl(input);
  if (!c) return null;
  const u = new URL(c);
  const path = u.pathname.replace(/\/+$/, '') || '/';
  const q = [...u.searchParams.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => k + '=' + v).join('&');
  /* o «www.» não distingue fontes: dois endereços do mesmo serviço têm de cair
     na mesma chave, senão o catálogo enche-se de duplicados. */
  return domainOf(c) + '|' + path + (q ? '?' + q : '');
};

/* ---------------- verificação técnica ---------------- */

export const TECHNICAL_CHECKS = [
  { id: 'exists', label: 'O domínio resolve e responde', weight: 20 },
  { id: 'tls', label: 'Certificado TLS válido (ou http declarado)', weight: 10 },
  { id: 'identity', label: 'Domínio corresponde à organização indicada', weight: 15 },
  { id: 'structured', label: 'Formatos estruturados ou API documentada', weight: 15 },
  { id: 'searchable', label: 'Pesquisa interna ou paginação', weight: 10 },
  { id: 'metadata', label: 'Metadados e datas nos documentos', weight: 15 },
  { id: 'incremental', label: 'Actualização incremental possível', weight: 15 }
];

/* Converte a observação de `checkAccess` num estado explícito. Nunca diz
   «acessível» quando o que houve foi um bloqueio de protecção. */
export function stateFromCheck(check) {
  if (!check) return { state: 'PENDING_VALIDATION', why: 'ainda não verificado' };
  const code = Number(check.httpStatus != null ? check.httpStatus : (typeof check.status === 'number' ? check.status : 0));
  const reason = String(check.reason || '').toLowerCase();
  const verdict = String(check.status || '');          /* vocabulário de access.mjs: acessivel | inacessivel | bloqueado */
  if (check.blocked || verdict === 'bloqueado') {
    return { state: 'REJECTED', why: 'recusado pela guarda de segurança: ' + (check.reason || 'alvo proibido') };
  }
  if (code === 401 || code === 402 || code === 403 || code === 407) {
    return { state: 'RESTRICTED', why: 'exige autenticação ou pagamento (HTTP ' + code + '): não se contorna' };
  }
  if (/captcha|robots|bloque|bot/i.test(reason)) {
    return { state: 'RESTRICTED', why: 'bloqueio automático declarado pela origem: ' + check.reason };
  }
  if (code === 429) {
    return { state: 'TEMPORARILY_UNAVAILABLE', why: 'a origem limitou os pedidos (HTTP 429): limite de utilização, não avaria' };
  }
  if (code === 404 || code === 410) {
    return { state: 'TEMPORARILY_UNAVAILABLE', why: 'recurso não encontrado (HTTP ' + code + '): pode ter mudado de endereço' };
  }
  if (code >= 500) return { state: 'TEMPORARILY_UNAVAILABLE', why: 'erro do servidor de origem (HTTP ' + code + ')' };
  if (verdict === 'acessivel' || (code >= 200 && code < 400)) {
    return { state: 'TECHNICAL_TESTING', why: 'respondeu HTTP ' + code + (check.ms != null ? ' em ' + check.ms + ' ms' : '') };
  }
  return { state: 'TEMPORARILY_UNAVAILABLE', why: 'falha de rede observada: ' + (check.reason || 'sem resposta') };
}

/* ---------------- classificação multidimensional ---------------- */

export const RATING_DIMENSIONS = {
  authority: 'Autoridade e proveniência',
  factual: 'Qualidade factual',
  transparency: 'Transparência',
  independence: 'Independência',
  usefulness: 'Utilidade',
  freshness: 'Actualização',
  accessibility: 'Acessibilidade técnica',
  risk: 'Risco (100 = risco elevado)'
};

export const RATING_BANDS = [
  { band: 'A', min: 85, label: 'Elevada', hint: 'fonte bem identificada, documentação sólida e qualidade demonstrada' },
  { band: 'B', min: 70, label: 'Boa', hint: 'fonte útil, com limitações conhecidas' },
  { band: 'C', min: 50, label: 'Condicional', hint: 'utilizável com validação adicional' },
  { band: 'D', min: 25, label: 'Fraca', hint: 'só como pista, com verificação independente' },
  { band: 'E', min: 0, label: 'Muito fraca', hint: 'não sustentar conclusões sem validação excepcional' }
];

export const bandOf = (score) => RATING_BANDS.find((b) => score >= b.min) || RATING_BANDS[RATING_BANDS.length - 1];

/* Cada dimensão é avaliada só com o que existe. O que falta fica em
   `missing` e impede uma classificação definitiva — é a diferença entre
   «não sei» e «é bom». */
export function rateSource(input) {
  const src = input || {};
  const checks = src.checks || {};
  const meta = src.meta || {};
  const dims = {};
  const missing = [];

  const dim = (key, score, justification, evidence, unknowns) => {
    dims[key] = { score: score == null ? null : Math.max(0, Math.min(100, Math.round(score))), justification, evidence: evidence || [], missing: unknowns || [] };
  };

  /* autoridade: domínio institucional + identificação da entidade */
  const official = !!checks.officialDomain;
  const named = !!(meta.institution || src.institution);
  dim('authority', official && named ? 85 : official || named ? 60 : null,
    official && named ? 'Domínio institucional e instituição identificada no registo'
      : official ? 'Domínio institucional, mas a instituição não está identificada'
        : named ? 'Instituição identificada, mas o domínio não é reconhecidamente institucional'
          : 'Sem identificação da entidade responsável',
    [checks.tls ? 'certificado TLS do domínio observado' : null, meta.institution ? 'instituição declarada: ' + meta.institution : null].filter(Boolean),
    official && named ? [] : ['identificação documental da entidade responsável']);

  /* qualidade factual: só com amostra verificada */
  const sample = meta.sample || null;
  if (sample && sample.checked > 0) {
    const errRate = sample.errors / sample.checked;
    dim('factual', 100 - errRate * 100,
      sample.checked + ' registo(s) verificados contra o original; ' + sample.errors + ' erro(s) (' + Math.round(errRate * 1000) / 10 + '%)',
      ['amostra de ' + sample.checked + ' contra documento original'],
      sample.checked < 20 ? ['amostra pequena: não representa a base inteira'] : []);
  } else {
    dim('factual', null, 'Sem amostra verificada contra os documentos originais', [], ['amostragem de registos contra originais']);
    missing.push('qualidade factual');
  }

  /* transparência */
  const tPoints = [meta.authors, meta.methodology, meta.corrections, meta.dates];
  const tHave = tPoints.filter(Boolean).length;
  dim('transparency', tHave ? (tHave / tPoints.length) * 100 : null,
    tHave + ' de ' + tPoints.length + ' elementos de transparência observados (autoria, metodologia, política de correcções, datas)',
    ['elementos observados: ' + tPoints.map((v, i) => (v ? ['autoria', 'metodologia', 'correcções', 'datas'][i] : null)).filter(Boolean).join(', ')],
    tHave < tPoints.length ? ['elementos de transparência em falta: ' + ['autoria', 'metodologia', 'correcções', 'datas'].filter((_, i) => !tPoints[i]).join(', ')] : []);
  if (!tHave) missing.push('transparência');

  /* independência: declarada, com a origem da informação */
  dim('independence', meta.independence == null ? null : meta.independence,
    meta.independence == null ? 'Não avaliada: falta saber se a fonte produz informação própria ou reproduz terceiros'
      : 'Avaliação declarada pelo revisor (' + meta.independence + '/100)',
    meta.independenceNote ? [meta.independenceNote] : [],
    meta.independence == null ? ['origem primária vs. reprodução'] : []);
  if (meta.independence == null) missing.push('independência');

  /* utilidade: depende do objectivo declarado */
  dim('usefulness', meta.usefulness == null ? null : meta.usefulness,
    meta.usefulness == null ? 'Não avaliada: falta declarar a relevância para o objectivo da investigação'
      : 'Relevância declarada para o objectivo (' + meta.usefulness + '/100)',
    meta.usefulnessNote ? [meta.usefulnessNote] : [],
    meta.usefulness == null ? ['relevância temática e geográfica'] : []);
  if (meta.usefulness == null) missing.push('utilidade');

  /* actualidade: usa a última publicação observada, se existir */
  dim('freshness', checks.lastPublishedDays == null ? null
    : Math.max(0, 100 - Math.min(100, checks.lastPublishedDays / 3.65)),
  checks.lastPublishedDays == null ? 'Sem data de última publicação observada'
    : 'Última publicação observada há ' + checks.lastPublishedDays + ' dia(s)',
  [], checks.lastPublishedDays == null ? ['data de última publicação'] : []);
  if (checks.lastPublishedDays == null) missing.push('actualidade');

  /* acessibilidade técnica: resultado observado, não promessa */
  dim('accessibility', checks.accessScore == null ? null : checks.accessScore,
    checks.accessScore == null ? 'Sem verificação técnica registada'
      : 'Verificação técnica: HTTP ' + (checks.httpStatus == null ? '—' : checks.httpStatus) + ', ' + (checks.ms || 0) + ' ms, tipo ' + (checks.contentType || 'desconhecido'),
    checks.checkedAt ? ['verificado em ' + checks.checkedAt] : [],
    checks.accessScore == null ? ['verificação de acesso'] : []);
  if (checks.accessScore == null) missing.push('acessibilidade técnica');

  /* risco: 100 = elevado. Nunca é diluído numa média. */
  const riskParts = [];
  let risk = 0;
  if (checks.tls === false) { risk += 25; riskParts.push('TLS inválido (+25)'); }
  if (checks.redirectsToOtherDomain) { risk += 20; riskParts.push('redireccionamento para outro domínio (+20)'); }
  if (checks.malformed) { risk += 20; riskParts.push('resposta malformada (+20)'); }
  if (meta.duplicateOf) { risk += 15; riskParts.push('duplicado de outra fonte (+15)'); }
  if (meta.personalData === 'high') { risk += 20; riskParts.push('tratamento intensivo de dados pessoais (+20)'); }
  if (checks.restricted) { risk += 10; riskParts.push('acesso condicionado (+10)'); }
  dim('risk', risk, riskParts.length ? riskParts.join('; ') : 'Sem factores de risco observados nas verificações existentes', riskParts, []);
  if (!checks.checkedAt) missing.push('verificação que sustente o risco');

  const scored = Object.values(dims).filter((d) => d.score != null);
  const hasRisk = dims.risk.score != null;
  const enoughEvidence = missing.length === 0 && scored.length >= 6;

  const positive = ['authority', 'factual', 'transparency', 'independence', 'usefulness', 'freshness', 'accessibility']
    .map((k) => dims[k].score).filter((v) => v != null);
  const base = positive.length ? positive.reduce((a, b) => a + b, 0) / positive.length : null;

  let global = base;
  let capped = null;
  if (base != null) {
    /* um risco elevado não desaparece numa média: limita a classificação */
    if (dims.risk.score >= 70) { global = Math.min(base, 30); capped = 'risco elevado (' + dims.risk.score + '/100) limita a classificação a D/E'; }
    else if (dims.risk.score >= 40) { global = Math.min(base, 55); capped = 'risco ' + dims.risk.score + '/100 limita a classificação a C'; }
    if (dims.factual.score == null && global > 70) { global = 70; capped = (capped ? capped + '; ' : '') + 'sem amostra verificada, a classificação não passa de B'; }
    /* uma amostra de 3 registos não pode sustentar a mesma confiança que uma de
       300: o tamanho da amostra limita a nota, e o limite é escrito. */
    const n = sample && sample.checked ? sample.checked : 0;
    if (n > 0 && n < 20) {
      const capSample = n < 5 ? 60 : 70;
      if (global > capSample) {
        global = capSample;
        capped = (capped ? capped + '; ' : '') + 'amostra de ' + n + ' registo(s) não sustenta nota acima de ' + capSample;
      }
    }
  }

  const provisional = !enoughEvidence || global == null;
  const result = {
    dims,
    riskScore: dims.risk.score,
    provisional,
    /* Com evidência insuficiente NÃO há nota global: há uma nota parcial
       declarada como tal. Publicar «B» a partir de dois critérios seria dar
       uma aparência de rigor a uma avaliação que não existe. */
    score: provisional ? null : Math.round(global),
    provisionalScore: provisional && global != null ? Math.round(global) : null,
    band: provisional || global == null ? null : bandOf(Math.round(global)).band,
    bandLabel: provisional || global == null ? null : bandOf(Math.round(global)).label,
    cappedBy: capped,
    missing,
    verdict: (enoughEvidence ? '' : 'Classificação provisória — evidência insuficiente' +
      (missing.length ? ' (falta: ' + missing.join('; ') + ')' : '')) || null,
    ratedAt: new Date().toISOString()
  };
  return result;
}

/* ---------------- descoberta a partir de fontes reais ---------------- */

const UA = 'ConspiracyTracker/2 (registo de fontes; ver docs/FONTES.md)';

async function getJson(url, opts) {
  const o = opts || {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || 15000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: 'application/json' }
    });
    const body = await res.text();
    let json = null;
    try { json = JSON.parse(body); } catch { /* resposta não JSON */ }
    return { ok: res.ok, status: res.status, json, body: body.slice(0, 400), url,
      retryAfter: res.headers.get('retry-after') };
  } catch (e) {
    return { ok: false, status: 0, error: String(e && e.message || e), url };
  } finally {
    clearTimeout(timer);
  }
}

/* Adaptador real 1 — tribunais dos Estados Unidos com página oficial.
   Fonte da descoberta: API REST v4 do CourtListener (Free Law Project).
   Não é «pesquisa na web»: é um catálogo público, com identificadores. */
export const ADAPTERS = {
  courtlistener_courts: {
    id: 'courtlistener_courts',
    version: '1.0.0',
    label: 'CourtListener — catálogo de tribunais dos EUA',
    category: 'tribunais',
    jurisdiction: 'US',
    method: 'GET /api/rest/v4/courts/ (JSON, acesso anónimo documentado)',
    limits: 'a API pública limita pedidos anónimos; cada consulta espera 1,2 s e recua em HTTP 429',
    licence: 'metadados do Free Law Project; verificar termos antes de reutilizar em massa',
    async discover(opts) {
      const o = opts || {};
      const pageSize = Math.min(100, o.pageSize || 40);
      const url = 'https://www.courtlistener.com/api/rest/v4/courts/?page_size=' + pageSize;
      let r = await getJson(url, { timeoutMs: o.timeoutMs || 20000 });
      /* 429 é limite de utilização, não avaria: espera-se o que o servidor pede
         (no máximo 3 s, para não bloquear o pedido do utilizador) e tenta-se uma
         vez. Se continuar limitado, devolve-se o motivo — nunca resultados falsos. */
      if (!r.ok && r.status === 429) {
        const wait = Math.min(3000, 1000 * (Number(r.retryAfter) || 2));
        await new Promise((res) => setTimeout(res, wait));
        r = await getJson(url, { timeoutMs: o.timeoutMs || 20000 });
      }
      if (!r.ok) {
        return { ok: false, url, status: r.status,
          error: r.error || ('HTTP ' + r.status + (r.status === 429 ? ' (limite de utilização da API pública)' : '')),
          rateLimited: r.status === 429, candidates: [] };
      }
      const list = (r.json && (r.json.results || r.json)) || [];
      const candidates = list
        .filter((c) => c && c.url && /^https?:\/\//.test(c.url))
        .map((c) => ({
          name: c.full_name || c.short_name || c.id,
          url: c.url,
          jurisdiction: 'US',
          category: 'tribunais',
          institution: c.full_name || c.short_name || c.id,
          discoveredVia: {
            adapter: 'courtlistener_courts', query: url,
            identifier: c.resource_uri || c.id, retrievedAt: new Date().toISOString()
          },
          notes: 'tribunal com código «' + c.id + '»' + (c.citation_string ? ' (' + c.citation_string + ')' : '') +
            '; jurisdição ' + (c.jurisdiction || 'não indicada') + '; o URL é o que o catálogo publica como página oficial'
        }));
      return { ok: true, url, status: r.status, found: list.length, candidates, retrievedAt: new Date().toISOString() };
    }
  }
};

/* ---------------- cobertura ---------------- */

export function coverageFrom(sources) {
  const byCountry = new Map();
  const byCategory = new Map();
  const byRegion = new Map();
  for (const s of sources || []) {
    const code = (s.jurisdiction || '??').toUpperCase();
    const cat = s.category || 'outra';
    const state = s.state || 'DISCOVERED';
    const bump = (map, key) => {
      const cur = map.get(key) || { key, total: 0, approved: 0, active: 0, restricted: 0, unavailable: 0, rejected: 0 };
      cur.total++;
      if (state === 'APPROVED') cur.approved++;
      if (state === 'ACTIVE') cur.active++;
      if (state === 'RESTRICTED') cur.restricted++;
      if (state === 'TEMPORARILY_UNAVAILABLE' || state === 'DEGRADED') cur.unavailable++;
      if (state === 'REJECTED') cur.rejected++;
      map.set(key, cur);
    };
    bump(byCountry, code);
    bump(byCategory, cat);
    const j = jurisdictionOf(code);
    bump(byRegion, j ? j.region : 'Desconhecida');
  }
  const countries = [...byCountry.values()].sort((a, b) => b.total - a.total);
  const covered = new Set(countries.filter((c) => c.approved + c.active > 0).map((c) => c.key));
  const gaps = JURISDICTIONS.filter((j) => !covered.has(j.code)).map((j) => j.code);
  const usedCategories = new Set([...byCategory.keys()]);
  return {
    countries,
    categories: [...byCategory.values()].sort((a, b) => b.total - a.total),
    regions: [...byRegion.values()].sort((a, b) => b.total - a.total),
    totals: {
      sources: (sources || []).length,
      countriesWithSources: countries.filter((c) => c.key !== '??').length,
      countriesWithApproved: covered.size,
      countriesCatalogued: JURISDICTIONS.length,
      categoriesWithoutSources: Object.keys(SOURCE_CATEGORIES).filter((k) => !usedCategories.has(k)).length
    },
    gaps: {
      countries: gaps,
      categories: Object.keys(SOURCE_CATEGORIES).filter((k) => !usedCategories.has(k))
    },
    note: 'Cobertura conta fontes registadas, não fontes validadas: um país com fontes registadas pode ter zero fontes aprovadas.'
  };
}

export const _internals = { getJson, PRIVATE_PATTERNS, TRACKING };
