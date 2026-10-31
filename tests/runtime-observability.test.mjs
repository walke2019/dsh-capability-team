import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeObservability } from '../runtime-observability.js';
import { createFailover } from '../failover.js';
const role = { provider: 'p', model: 'a', fallbacks: [{ provider: 'p', model: 'b' }], failover: { retries: 1, initialDelayMs: 1, maxDelayMs: 1, cooldownMs: 1000, retryCodes: ['SERVER'], failoverCodes: ['SERVER'], failoverStatuses: [500] } };
test('runtime counts retries/failover without secret messages; shared cooldown; restart epoch', async () => {
  const obs = createRuntimeObservability({ now: () => 100, epoch: 'one' }), agent = { id: 'a' }, b = { id: 'b' };
  const fo = createFailover({ now: () => 100, sleep: async () => true, telemetry: e => obs.telemetry(e) });
  let selected = fo.route(agent, 1, 1, role); obs.request(agent, { turn: 1, step: 1, role, routed: role, selected });
  obs.failure(agent, { message: 'sk-BAIT' }); await fo.recover(agent, { code: 'SERVER', status: 500, message: 'sk-BAIT' });
  selected = fo.route(agent, 1, 1, role); obs.request(agent, { turn: 1, step: 1, role, routed: role, selected });
  await fo.recover(agent, { code: 'SERVER', status: 500, message: 'sk-BAIT' });
  selected = fo.route(agent, 1, 1, role); obs.request(agent, { turn: 1, step: 1, role, routed: role, selected });
  obs.request(b, { turn: 1, step: 1, role, routed: role, selected: fo.route(b, 1, 1, role) });
  const view = obs.snapshot('a', [agent, b]);
  const detached = obs.snapshot('a', [agent]); detached.members[0].counters.requestFailures = 999;
  assert.equal(obs.snapshot('a', [agent]).members[0].counters.requestFailures, 1);
  assert.equal(view.members[0].counters.pluginRetries, 1); assert.equal(view.members[0].counters.failoverSwitches, 1); assert.equal(view.members[1].cooling.length, 1); assert.equal(view.members[0].cooling[0].attempt, 2); assert.ok(!JSON.stringify(view).includes('sk-BAIT'));
  const fresh = createRuntimeObservability({ now: () => 100, epoch: 'two' }).snapshot('a', [agent]); assert.notEqual(fresh.epoch, view.epoch); assert.equal(fresh.members[0].counters.failoverSwitches, 0);
});
test('cancelled retry wait does not count, long context entry and return do', async () => {
  const obs = createRuntimeObservability(), a = { id: 's' };
  const fo = createFailover({ sleep: async () => false, telemetry: e => obs.telemetry(e) }); fo.route(a, 1, 1, role); await fo.recover(a, { code: 'SERVER' });
  obs.request(a, { turn: 1, step: 1, role, routed: role, selected: role });
  const lc = { ...role, model: 'long', longContextActive: true };
  obs.request(a, { turn: 1, step: 2, role, routed: lc, selected: lc }); obs.request(a, { turn: 1, step: 3, role, routed: role, selected: role });
  const m = obs.snapshot('s', [a]).members[0]; assert.equal(m.counters.pluginRetries, 0); assert.equal(m.counters.longContextSwitches, 2);
});
