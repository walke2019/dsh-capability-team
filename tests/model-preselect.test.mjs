import test from 'node:test';
import assert from 'node:assert/strict';
import { apply as applyRoles, preselect } from '../roles.js';
import { createFailover } from '../failover.js';

// DSH 0.2.2-rc.1 fixes provider/model from agent.model.current() before step preparation and rejects an
// agent/request result that names another route. This mirrors that check (dsh-agent-loop prepareRequest).
function dshPrepare(selection, proposed) {
  if (proposed.provider !== selection.provider || proposed.model !== selection.model) throw new Error('agent/request proposed another route after step preparation');
  if (proposed.reasoningEffort !== selection.reasoningEffort) throw new Error('agent/request changed reasoning effort after step preparation');
  return proposed;
}
function fixture({ role = 'teammate', resolved = { provider: 'p', model: 'role-model', failover: { retryCodes: [], failoverCodes: ['SERVER'], failoverStatuses: [], retries: 0, cooldownMs: 1000 }, fallbacks: [{ provider: 'p', model: 'backup' }] } } = {}) {
  const listeners = {}, selections = [];
  let recorded = { provider: 'p', model: 'lead-model' };
  const agent = { session: {}, ctx: { systemPrompt: { context: () => () => {} } }, model: { current: () => ({ ...recorded }), select: s => { selections.push(s); recorded = { ...s }; } } };
  const ctx = { agentTeams: { tryMembership: () => ({ role, name: 'architect' }) }, on: (event, fn) => { listeners[event] = fn; }, logger: { info() {}, warn() {} } };
  const failover = createFailover({ sleep: async () => true });
  const team = { owns: () => true, resolve: async () => ({ ...resolved }) };
  applyRoles(ctx, team, failover);
  const step = async (turn, n) => {
    const selection = agent.model.current();
    return dshPrepare(selection, await listeners['agent/request']({ agent, turn, step: n }, async () => ({ ...selection })));
  };
  return { agent, listeners, selections, step, ctx, team, failover };
}

test('a teammate is switched to its role route at creation, so its first step passes DSH step preparation', async () => {
  const f = fixture();
  await f.listeners['agent/created']({ agent: f.agent });
  assert.deepEqual(f.selections, [{ provider: 'p', model: 'role-model' }]);
  const request = await f.step(1, 1);
  assert.equal(request.model, 'role-model');
});

test('without preselection the step keeps its fixed route and the role route applies from the next step', async () => {
  const f = fixture();
  const first = await f.step(1, 1); // would have thrown before the fix
  assert.equal(first.model, 'lead-model');
  assert.deepEqual(f.selections, [{ provider: 'p', model: 'role-model' }]);
  assert.equal((await f.step(1, 2)).model, 'role-model');
});

test('preselection leaves the Lead, unassigned roles and other presets untouched', async () => {
  for (const options of [{ role: 'lead' }, { resolved: { unassigned: true } }]) {
    const f = fixture(options);
    await preselect(f.ctx, f.team, f.failover, f.agent);
    assert.deepEqual(f.selections, []);
  }
  const f = fixture();
  await preselect(f.ctx, { ...f.team, owns: () => false }, f.failover, f.agent);
  assert.deepEqual(f.selections, []);
});

test('a same-tier failover switch is recorded for the next step instead of retried on the fixed route', async () => {
  const f = fixture();
  await f.listeners['agent/created']({ agent: f.agent });
  await f.step(1, 1);
  const outcome = await f.listeners['agent/request-error']({ agent: f.agent, failure: { code: 'SERVER', message: 'down' }, signal: new AbortController().signal }, async () => undefined);
  assert.equal(outcome, undefined, 'the failed step ends instead of retrying a route DSH would reject');
  assert.deepEqual(f.selections.at(-1), { provider: 'p', model: 'backup' });
  assert.equal((await f.step(2, 1)).model, 'backup');
});

test('the step reasoning effort is kept when the route already matches', async () => {
  const f = fixture();
  await f.listeners['agent/created']({ agent: f.agent });
  f.agent.model.select({ provider: 'p', model: 'role-model', reasoningEffort: 'high' });
  const request = await f.step(1, 1);
  assert.equal(request.reasoningEffort, 'high');
});
