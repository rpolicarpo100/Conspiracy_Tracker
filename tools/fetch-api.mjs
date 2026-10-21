import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/* Agente local de recolha: reutiliza as mesmas guardas do módulo do navegador.
   A única diferença é o transporte: o servidor pode ler robots.txt e o corpo
   de fontes que não enviam cabeçalhos CORS. */
let VN = null;
async function loadAgents() {
  if (VN) return VN;
  const src = await readFile(new URL('../src/core/agents.js', import.meta.url), 'utf8');
  (0, eval)(src);                    // usa globalThis como contexto
  VN = globalThis.VN.agents;
  return VN;
}

/* Limite de ritmo por origem: o agente local é o único ponto do servidor que faz pedidos
   externos. Numa instância pública isto não pode ser um proxy aberto. */
const BUDGET = {
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.AGENT_BUDGET || 60)   // configurável; 60 por 10 min por IP por omissão
};
const hits = new Map();

export async function handleFetchApi(req, res, opts) {
  opts = opts || {};
  const origin = req.headers.origin;
  const host = req.headers.host;
  // 1) só a própria origem pode usar o agente (evita proxy aberto)
  if (origin && host) {
    let oHost = null;
    try { oHost = new URL(origin).host; } catch { /* origem inválida */ }
    if (oHost !== host) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'origem não autorizada: o agente local só responde ao próprio site' }));
    }
  }
  const cors = { 'access-control-allow-origin': origin || 'null', vary: 'origin', 'access-control-allow-headers': 'content-type' };
  const send = (code, obj) => {
    res.writeHead(code, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, cors));
    res.end(JSON.stringify(obj, null, 2));
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.method !== 'POST') return send(405, { error: 'use POST com {url, source, extract}' });

  // 2) orçamento por IP (janela deslizante simples)
  {
    const budget = opts.budget || BUDGET;
    const ip0 = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'desconhecido';
    const ip = ip0 + '|' + budget.max + '|' + budget.windowMs;
    const now = Date.now();
    const slot = hits.get(ip) || { n: 0, since: now };
    if (now - slot.since > budget.windowMs) { slot.n = 0; slot.since = now; }
    slot.n++;
    hits.set(ip, slot);
    if (hits.size > 5000) hits.clear();
    if (slot.n > budget.max) {
      res.writeHead(429, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'retry-after': String(Math.ceil(budget.windowMs / 1000)) }, cors));
      return res.end(JSON.stringify({ error: 'demasiados pedidos: ' + budget.max + ' por janela de ' + Math.round(budget.windowMs / 60000) + ' min' }));
    }
  }

  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20000) return send(413, { error: 'pedido demasiado grande' });
  }
  let task;
  try { task = JSON.parse(raw || '{}'); } catch { return send(400, { error: 'JSON inválido' }); }

  const agents = await loadAgents();
  /* Metadados de API (catálogo ou especificação OpenAPI) podem ser grandes. O limite sobe
     até 24 MB apenas quando a tarefa declara purpose='catalogue' ou purpose='spec'; o tecto
     é imposto aqui, não pelo cliente, e fica registado no resultado. */
  const CEILING = 24 * 1024 * 1024;
  const bigPurpose = task.purpose === 'catalogue' || task.purpose === 'spec';
  let maxBytes = 2 * 1024 * 1024;
  if (bigPurpose && task.limits && Number(task.limits.maxBytes)) {
    maxBytes = Math.min(CEILING, Math.max(maxBytes, Number(task.limits.maxBytes)));
  }
  // allowPrivateHosts só é usado pelos testes automatizados (servidor local como destino)
  const runner = agents.createRunner({ allowPrivateHosts: opts.allowPrivateHosts === true, limits: { maxRequestsPerRun: 1, maxBytes: maxBytes } });
  const out = await runner.runOne(Object.assign({ id: task.id || 'proxy', source: task.source || '(proxy)' },
    { url: task.url, method: task.method, extract: task.extract, robotsPolicy: task.robotsPolicy || 'obey', robotsJustification: task.robotsJustification || null }), { dryRun: false });
  const payload = { result: out, limitsUsed: { maxBytes: maxBytes } };
  if (out.evidence && out.evidence.bodyText != null) payload.body = out.evidence.bodyText;
  payload.result.evidence = out.evidence ? Object.assign({}, out.evidence) : null;
  if (payload.result.evidence) delete payload.result.evidence.bodyText;
  send(200, payload);
}

export { createHash };
