import { runtimeBinding } from './runtime-observability.js';
import { safeId } from './activity-summary.js';
export const RUNTIME_PATH = '/api/capability-team.runtime';
export const RUNTIME_STREAM_PATH = `${RUNTIME_PATH}/stream`;
/** Epoch of the placeholder snapshot of a team lead whose runtime is not bound yet (a draft session before its first message). */
export const UNBOUND_EPOCH = 'unbound';
const UNBOUND_POLL_MS = 1000;
/** Empty but well-formed snapshot: the Team overview renders "no activity yet" instead of an error. */
export function emptySnapshot(leadSessionId) {
  return { schemaVersion: 1, leadSessionId, epoch: UNBOUND_EPOCH, revision: 0, generatedAt: 0, coverage: { mode: 'unbound', since: 0 }, members: [], taskControl: null };
}
function resolve(ctx, request, native) {
  const url = new URL(request.url), ids = url.searchParams.getAll('sessionId');
  if (ids.length !== 1 || !safeId(ids[0]) || [...url.searchParams.keys()].some(k => k !== 'sessionId')) return { error: 400 };
  // Never resolve/activate a session from user-controlled input.
  const agent = ctx.get?.('agents')?.get(ids[0]);
  if (!agent) return { error: 404 };
  const teams = ctx.get?.('agentTeams');
  if (!teams || !ctx.agentPresets) return { error: 503 };
  const membership = native?.identity(agent);
  if (!membership || membership.role !== 'lead' || ctx.agentPresets?.composedPreset(agent.ctx) !== 'capability-team') return { error: 404 };
  // A draft lead has no runtime until its first message: answer with an empty snapshot, not an error.
  const current = () => runtimeBinding(agent);
  const snapshot = async () => { const binding = current(); return binding ? binding.runtime.snapshot(agent.id, await native.list(agent)) : emptySnapshot(agent.id); };
  return { current, agent, snapshot };
}
export async function handleRuntime(ctx, request, stream = false, native) {
  if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
  // In production Connection refuses non-owner peers before invoking any registered fetch route.
  let resolved;
  try { resolved = resolve(ctx, request, native); } catch { return Response.json({ error: 503 }, { status: 503 }); }
  if (resolved.error) return Response.json({ error: resolved.error }, { status: resolved.error, headers: { 'cache-control': 'no-store' } });
  if (!stream) {
    try { return Response.json(await resolved.snapshot(), { headers: { 'cache-control': 'no-store' } }); }
    catch { return Response.json({ error: 503 }, { status: 503 }); }
  }
  let dispose = () => {}, timer = null, poll = null, closed = false, abortCleanup = () => {};
  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const close = () => { if (closed) return; closed = true; if (timer) clearTimeout(timer); if (poll) clearInterval(poll); dispose(); request.signal.removeEventListener('abort', close); controller.close(); };
      let pending = false;
      const emit = async () => {
        timer = null; if (closed || pending) return;
        pending = true;
        try { const snapshot = await resolved.snapshot(); if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`)); }
        catch { close(); }
        finally { pending = false; }
      };
      emit();
      const attach = binding => { dispose = binding.runtime.onChanged(() => { if (!closed && timer === null) timer = setTimeout(emit, 350); }); };
      const bound = resolved.current();
      if (bound) attach(bound);
      else {
        // Idle until the lead's runtime appears (first message), then push the real snapshot and follow its changes.
        poll = setInterval(() => {
          if (closed) return;
          const binding = resolved.current();
          if (!binding) return;
          clearInterval(poll); poll = null; attach(binding); emit();
        }, UNBOUND_POLL_MS);
        poll.unref?.();
      }
      abortCleanup = () => request.signal.removeEventListener('abort', close);
      request.signal.addEventListener('abort', close, { once: true });
      if (request.signal.aborted) close();
    },
    cancel() { closed = true; if (timer) clearTimeout(timer); if (poll) clearInterval(poll); dispose(); abortCleanup(); },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
export function applyObservabilityApi(ctx, native) {
  ctx.inject?.(['connection', 'agents', 'agentTeams', 'agentPresets'], scoped => {
    for (const [path, stream] of [[RUNTIME_PATH, false], [RUNTIME_STREAM_PATH, true]]) {
      // Host createSharedFetchHandler enforces peer.principal.kind === 'owner'.
      scoped.connection.fetch.register({ path, methods: ['GET'], requestBody: 'buffered', fetch: request => Promise.resolve(handleRuntime(scoped, request, stream, native)) });
    }
  });
}
