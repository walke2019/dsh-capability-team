import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ownsCapabilityTeam } from '../preset-guard.js';
import { apply as applyRoles } from '../roles.js';
import { applyAccess } from '../access.js';
import { createMemoryHub } from '../memory-hub.js';
import { createTokenDiscipline, TOKEN_RULES } from '../token-discipline.js';
import { createTokenMetrics } from '../token-metrics.js';
import { createOpenViking } from '../memory-openviking.js';
import * as integrationConfig from '../integrations-config.js';

function fixture(preset, member = true, child = false) {
  const root = { id: 'root', ctx: { preset } };
  let injected = 0;
  const agent = { id: 'worker', ctx: { preset: child ? undefined : preset,
    systemPrompt: { context() { injected++; return () => {}; } } }, session: { id: 'worker' } };
  const events = {}, guards = [];
  const membership = member ? { role: 'teammate', name: 'worker', root: child ? root : agent } : undefined;
  const agents = new Map([[agent.id, agent]]);
  const ctx = { agents: { get: id => agents.get(id), list: () => [agent] },
    agentPresets: { composedPreset: c => c?.preset },
    agentTeams: { tryMembership: a => a === agent ? membership : undefined },
    on: (key, fn) => { events[key] = fn; }, effect: fn => fn(),
    tools: { register: () => () => {}, guard: fn => guards.push(fn) },
  };
  ctx.get = key => ctx[key];
  return { ctx, agent, events, guards, injected: () => injected };
}
for (const [label, preset, member, child] of [
  ['plain session', undefined, false, false],
  ['different preset', 'standard', false, false],
  ['different native team', 'other-team', true, true],
  ['ordinary subagent', undefined, false, true],
]) test(`QA regression: ${label} preserves routing, access, memory and output`, async () => {
  const f = fixture(preset, member, child);
  const team = { owns: a => ownsCapabilityTeam(f.ctx, a),
    pinned() { throw new Error('foreign team must not be loaded'); },
    resolve() { throw new Error('foreign route must not resolve'); } };
  applyRoles(f.ctx, team, { recover() { throw new Error('foreign failover'); } });
  assert.equal(f.injected(), 0);
  const original = { model: 'original-model' };
  assert.equal(await f.events['agent/request']({ agent: f.agent }, async () => original), original);
  assert.equal(await f.events['agent/request-error']({ agent: f.agent }, async () => original), original);
  applyAccess(f.ctx, team);
  assert.equal(f.guards[0]({ agent: f.agent, name: 'write' }), undefined);
  const hub = createMemoryHub(f.ctx, team, { store: {}, embedder: {}, viking: {} });
  hub.register();
  f.events['agent/created']({ agent: f.agent });
  f.events['agent/inbox/claimed']({ agent: f.agent, message: { text: 'foreign task must not trigger recall' } });
  assert.equal(f.injected(), 0);
  const discipline = createTokenDiscipline(f.ctx, team, { rulesOf: () => TOKEN_RULES });
  const result = { content: [{ type: 'text', text: 'x'.repeat(9000) }] };
  assert.equal(await discipline.trim({ agent: f.agent, name: 'pwsh' }, result), undefined);
  assert.equal(await discipline.compactIdle(f.agent), false);
});

test('QA regression: owned root permits policy and API GET, session query is mandatory', async () => {
  const f = fixture('capability-team', true, true);
  assert.equal(ownsCapabilityTeam(f.ctx, f.agent), true);
  applyRoles(f.ctx, { owns: a => ownsCapabilityTeam(f.ctx, a) }, {});
  assert.equal(f.injected(), 1);
  assert.equal(integrationConfig.handleIntegrations, undefined);
  assert.equal(integrationConfig.applyIntegrationsApi, undefined);
  assert.equal(integrationConfig.saveIntegrations, undefined);
});

test('QA regression: cumulative official usage yields step deltas without double counting', () => {
  const a = {}, metrics = createTokenMetrics();
  metrics.sample(a, 1, 1, { inputTokens: 100, cacheReadTokens: 900, outputTokens: 10 });
  metrics.sample(a, 1, 2, { inputTokens: 120, cacheReadTokens: 1000, outputTokens: 15 });
  metrics.sample(a, 1, 2, { inputTokens: 125, cacheReadTokens: 1000, outputTokens: 17 });
  const s = metrics.snapshot(a);
  assert.equal(s.steps.length, 2);
  assert.deepEqual(s.steps.map(x => x.prompt), [1000, 125]);
  assert.deepEqual(s.steps.map(x => x.output), [10, 7]);
  assert.ok(s.steps.every(x => x.estimatedCost === null));
  s.steps[0].prompt = 0;
  assert.equal(metrics.snapshot(a).steps[0].prompt, 1000);
});

test('QA regression: failed cloud batch persists and recovery acknowledges only committed rows', async () => {
  const queuePath = join(await mkdtemp(join(tmpdir(), 'qa-retry-')), 'queue.json');
  const settings = { config: { backend: 'openviking', url: 'https://memory.example.test', timeoutMs: 1000 } };
  const opts = { queuePath, settings, schedule: () => null };
  const first = createOpenViking({ ...opts, fetcher: async () => new Response('unavailable', { status: 503 }) });
  first.enqueue({ kind: 'note', text: 'safe retry probe', scope: {} }, {});
  await assert.rejects(first.flush(), /503/);
  assert.equal(first.pending(), 1);
  const requests = [];
  const recovered = createOpenViking({ ...opts, fetcher: async (url, req) => {
    requests.push({ url, body: JSON.parse(req.body) });
    return Response.json({ status: 'ok', result: {} });
  } });
  assert.equal(recovered.pending(), 1);
  assert.equal((await recovered.flush()).sent, 1);
  assert.equal(requests.length, 3);
  assert.match(requests[1].body.content, /safe retry probe/);
  assert.ok(requests[2].url.endsWith('/commit'));
  assert.equal(createOpenViking(opts).pending(), 0);
});
