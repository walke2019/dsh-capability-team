// Host half: an owner-only, same-origin SSE endpoint. It never writes the transcript and never takes routes from clients.
import { PredictionError, parseRequest, predict, readConfig } from './predictor.js';
import { loadFleetDefaults, withFleetDefaults } from './fleet-defaults.js';
export { FLEET_KEYS } from './fleet-defaults.js';
export { Config } from './schema.js';
export const name = 'autocomplete';
export const inject = ['connection', 'llm', 'sessions', 'webServer'];
export const ENDPOINT = '/autocomplete/predict';
export const MAX_ACTIVE = 4;

function json(response, status, reason) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify({ suggestions: [], reason }));
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 16384) throw new PredictionError('body-too-large', 413);
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new PredictionError('invalid-json'); }
}

/** Reasons a request is refused before any body is read, or undefined when it may proceed. */
function refusal(ctx, request, active) {
  const admission = ctx.connection.admit(request);
  if ('rejection' in admission) return [admission.rejection, 'unauthorized'];
  if (admission.peer.principal.kind !== 'owner') return [403, 'forbidden'];
  if (request.method !== 'POST') return [405, 'method-not-allowed'];
  // Admission authenticates; Origin/Sec-Fetch-Site additionally block browser CSRF. Behind the hub tunnel or a
  // reverse proxy the public host may arrive as X-Forwarded-Host; a page cannot forge that header cross-site
  // because the JSON content type already forces a CORS preflight that DSH never approves.
  const origin = request.headers.origin;
  const hosts = [request.headers.host, String(request.headers['x-forwarded-host'] ?? '').split(',')[0].trim()].filter(Boolean);
  let crossOrigin = request.headers['sec-fetch-site'] === 'cross-site';
  if (origin !== undefined) { try { crossOrigin ||= !hosts.includes(new URL(origin).host); } catch { crossOrigin = true; } }
  if (crossOrigin) return [403, 'cross-origin'];
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return [415, 'unsupported-media-type'];
  if (active.size >= MAX_ACTIVE) return [429, 'too-many-predictions'];
  return undefined;
}

export function apply(ctx, live = {}) {
  const active = new Set();
  ctx.effect(() => () => { for (const controller of active) controller.abort(); active.clear(); });
  // Fleet defaults arrive through the optional credential store and are re-read when settings change.
  let fleet = {};
  let credentials = null;
  const refreshFleet = () => loadFleetDefaults(credentials).then(next => { fleet = next; }, () => {});
  ctx.inject?.(['credentials'], scoped => {
    credentials = scoped.credentials;
    scoped.effect?.(() => () => { credentials = null; fleet = {}; });
    void refreshFleet();
  });
  ctx.on?.('loader/volatile-update', () => void refreshFleet());
  ctx.on?.('credentials/record-updated', () => void refreshFleet());
  ctx.effect(() => {
    const registered = ctx.webServer.register({ kind: 'exact', path: ENDPOINT, handler: async (request, response) => {
      let started = false;
      let controller;
      const send = (event, data) => {
        if (!response.destroyed && !response.writableEnded) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const closed = () => controller?.abort();
      try {
        const refused = refusal(ctx, request, active);
        if (refused) { json(response, ...refused); return; }
        const config = withFleetDefaults(readConfig(live), fleet);
        if (!config.enabled) { json(response, 409, 'disabled'); return; }
        controller = new AbortController();
        active.add(controller);
        response.on('close', closed);
        // Bound body reads too; otherwise a slow client could hold every slot.
        const bodyTimeout = setTimeout(() => request.destroy(), 10000);
        let body;
        try { body = await readBody(request); } finally { clearTimeout(bodyTimeout); }
        const plan = parseRequest(body);
        const session = ctx.sessions.get(plan.sessionId);
        if (!session) { json(response, 404, 'session-not-live'); return; }
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        started = true;
        send('meta', { mode: plan.mode, sessionId: plan.sessionId });
        const result = await predict(ctx.llm, session, config, plan, controller.signal, text => send('delta', { text }));
        send('done', { ...result, suggestion: result.suggestions[0] ?? null });
        response.end();
      } catch (error) {
        const known = error instanceof PredictionError;
        const reason = known ? error.code : 'prediction-failed';
        if (started) { send('error', { reason, suggestions: [] }); response.end(); } else json(response, known ? error.status : 500, reason);
      } finally {
        response.off?.('close', closed);
        if (controller) { controller.abort(); active.delete(controller); }
      }
    } });
    return typeof registered === 'function' ? registered : undefined;
  });
}
