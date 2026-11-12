import test from 'node:test';
import assert from 'node:assert/strict';
import './keep-alive.mjs';
import { handleRuntime, applyObservabilityApi, emptySnapshot, UNBOUND_EPOCH, RUNTIME_PATH } from '../observability-api.js';
import { bindRuntime, createRuntimeObservability } from '../runtime-observability.js';
import { fixtureNative } from './helpers/backend-native-fixture.mjs';
const runtimeResponse = (ctx, request, stream = false) => handleRuntime(ctx, request, stream, fixtureNative({ ...ctx, agentTeams: ctx.get?.('agentTeams') }));
const req = (id = 'lead') => new Request(`http://host${RUNTIME_PATH}?sessionId=${id}`);
function fixture() {
  const agent = { id: 'lead', ctx: {} }, runtime = createRuntimeObservability();
  const teams = { tryMembership: a => a === agent ? { role: 'lead' } : null, listMembers: () => [agent] };
  const services = { agents: { get: id => id === 'lead' ? agent : null }, agentTeams: teams };
  const ctx = { get: k => services[k], agentPresets: { composedPreset: () => 'capability-team' } };
  bindRuntime(agent, runtime, teams); return { ctx, agent, runtime };
}
test('GET is live-only, lead-only, validates input and never activates or writes', async () => {
  const { ctx } = fixture(); const response = await runtimeResponse(ctx, req()); assert.equal(response.status, 200); assert.equal((await response.json()).schemaVersion, 1);
  assert.equal((await runtimeResponse(ctx, req('unknown'))).status, 404); assert.equal((await runtimeResponse(ctx, req(''))).status, 400);
  assert.equal((await runtimeResponse(ctx, new Request(`http://host${RUNTIME_PATH}?sessionId=lead&sessionId=lead`))).status, 400);
  ctx.get('agentTeams').tryMembership = () => ({ role: 'teammate' }); assert.equal((await runtimeResponse(ctx, req())).status, 404);
  ctx.get('agentTeams').tryMembership = () => ({ role: 'lead' });
  ctx.agentPresets.composedPreset = () => 'other'; assert.equal((await runtimeResponse(ctx, req())).status, 404);
  ctx.agentPresets.composedPreset = () => 'capability-team';
  ctx.get('agentTeams').listMembers = () => { throw new Error('sk-BAIT'); };
  const unavailable = await runtimeResponse(ctx, req()); assert.equal(unavailable.status, 503); assert.ok(!(await unavailable.text()).includes('sk-BAIT'));
});
test('SSE first snapshot and trailing burst coalescing, cancellation', async () => {
  const { ctx, agent, runtime } = fixture(); const abort = new AbortController(); const response = await runtimeResponse(ctx, new Request(req(), { signal: abort.signal }), true);
  assert.equal(response.headers.get('content-type'), 'text/event-stream'); const reader = response.body.getReader(); const decoder = new TextDecoder();
  const first = decoder.decode((await reader.read()).value); assert.ok(first.startsWith('data: '));
  runtime.failure(agent, {}); runtime.failure(agent, {}); runtime.failure(agent, {});
  const frame = decoder.decode((await reader.read()).value); const data = JSON.parse(frame.slice(6)); assert.equal(data.members[0].counters.requestFailures, 3); abort.abort(); assert.equal((await reader.read()).done, true);
});
test('routes are registered exclusively through host owner-fenced connection seam', async () => {
  const routes = []; const ctx = { inject: (_, callback) => callback({ connection: { fetch: { register: route => routes.push(route) } } }) };
  applyObservabilityApi(ctx); assert.equal(routes.length, 2); assert.deepEqual(routes[0].methods, ['GET']);
  // Model the actual host createSharedFetchHandler owner fence; plugin handler never sees remote peers.
  const fenced = (route, request, peer) => peer.principal.kind !== 'owner' ? new Response('forbidden', { status: 403 }) : route.fetch(request);
  assert.equal((await fenced(routes[0], req(), { principal: { kind: 'remote' } })).status, 403);
});

test('a lead whose runtime is not bound yet (draft session) gets 200 with an empty snapshot, not 503', async () => {
  const agent = { id: 'draft', ctx: {} }; // never bound: no first message yet
  const teams = { tryMembership: a => a === agent ? { role: 'lead' } : null, listMembers: () => [agent] };
  const services = { agents: { get: id => id === 'draft' ? agent : null }, agentTeams: teams };
  const ctx = { get: k => services[k], agentPresets: { composedPreset: () => 'capability-team' } };
  const response = await runtimeResponse(ctx, req('draft')); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(body, emptySnapshot('draft')); assert.equal(body.schemaVersion, 1); assert.equal(body.epoch, UNBOUND_EPOCH); assert.deepEqual(body.members, []);
  // Authorization fences still apply: a non-lead or other preset stays 404, unknown id 404.
  teams.tryMembership = () => ({ role: 'teammate' }); assert.equal((await runtimeResponse(ctx, req('draft'))).status, 404);
  teams.tryMembership = () => ({ role: 'lead' }); assert.equal((await runtimeResponse(ctx, req('nobody'))).status, 404);
  // Missing host services remain a genuine 503.
  assert.equal((await runtimeResponse({ get: k => k === 'agents' ? services.agents : undefined, agentPresets: ctx.agentPresets }, req('draft'))).status, 503);
});

test('the stream of an unbound lead is idle, then switches to real snapshots once the runtime binds', async () => {
  const agent = { id: 'draft', ctx: {} };
  const teams = { tryMembership: a => a === agent ? { role: 'lead' } : null, listMembers: () => [agent] };
  const services = { agents: { get: () => agent }, agentTeams: teams };
  const ctx = { get: k => services[k], agentPresets: { composedPreset: () => 'capability-team' } };
  const abort = new AbortController(); const response = await runtimeResponse(ctx, new Request(req('draft'), { signal: abort.signal }), true);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  const first = JSON.parse(decoder.decode((await reader.read()).value).slice(6)); assert.equal(first.epoch, UNBOUND_EPOCH); assert.deepEqual(first.members, []);
  const runtime = createRuntimeObservability(); bindRuntime(agent, runtime, teams); // the first message arrives
  const next = JSON.parse(decoder.decode((await reader.read()).value).slice(6)); assert.equal(next.epoch, runtime.epoch); assert.equal(next.members.length, 1);
  runtime.failure(agent, {});
  const changed = JSON.parse(decoder.decode((await reader.read()).value).slice(6)); assert.equal(changed.members[0].counters.requestFailures, 1);
  abort.abort(); assert.equal((await reader.read()).done, true);
});

test('cancelling an unbound stream stops its poll timer', async () => {
  const agent = { id: 'draft', ctx: {} };
  const teams = { tryMembership: () => ({ role: 'lead' }), listMembers: () => [agent] };
  const services = { agents: { get: () => agent }, agentTeams: teams };
  const ctx = { get: k => services[k], agentPresets: { composedPreset: () => 'capability-team' } };
  const response = await runtimeResponse(ctx, req('draft'), true); const reader = response.body.getReader(); await reader.read();
  await reader.cancel(); // would hang the test process on an unref-less leaked interval otherwise
});
