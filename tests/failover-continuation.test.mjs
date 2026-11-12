import { test } from 'node:test';
import { memberFixtureNative } from './helpers/backend-native-fixture.mjs';
import assert from 'node:assert/strict';
import { apply } from '../roles.js';
import { createFailover } from '../failover.js';
import { seed } from '../config.js';
import { fixture as taskFixture } from './helpers/task-control-fixture.mjs';

function fixture({ role: changes = {}, createMessage = input => ({ ...input, id: 'notice', role: 'user' }) } = {}) {
  const listeners = new Map(), effects = [], notices = [], waits = [], warnings = [];
  const ctx = { on(name, fn) { const list = listeners.get(name) ?? []; list.push(fn); listeners.set(name, list); },
    effect(fn) { effects.push(fn()); }, logger: { warn: text => warnings.push(text) } };
  const role = { id: 'dev', provider: 'primary', model: 'same-tier', fallbacks: [{ provider: 'backup', model: 'same-tier' }], failover: seed.failover, ...changes };
  let selected = { provider: role.provider, model: role.model };
  const agent = { status: 'running', inbox: { nextStep: [], nextTurn: [] },
    model: { current: () => selected, select: route => { selected = route; } },
    steer(message) { notices.push(message); this.status = 'running'; } };
  let clock = 0;
  const f = createFailover({ now: () => clock, sleep: async ms => { waits.push(ms); return true; } });
  apply(ctx, { native: memberFixtureNative, owns: () => true, resolve: async () => role }, f, undefined, undefined, { createMessage });
  let turn = 1, step = 1, controller = new AbortController();
  const emit = (name, payload) => { for (const fn of listeners.get(name) ?? []) fn(payload); };
  return { agent, f, notices, waits, warnings, effects, role,
    request: () => listeners.get('agent/request')[0]({ agent, turn, step }, async () => selected),
    preStep: (messages = [], kind = 'enter') => listeners.get('agent/pre-step')[0]({ agent, turn, step, signal: controller.signal }, async () => ({ kind, messages })),
    error: (failure = { code: 'QUOTA', status: 503, message: '503 usage_limit_reached' }, downstream) => listeners.get('agent/request-error')[0]({ agent, turn, step, failure, signal: controller.signal }, async () => downstream),
    idle() { agent.status = 'idle'; emit('agent/status', { agent, status: 'idle' }); },
    next() { turn++; step = 1; controller = new AbortController(); },
    signal: () => controller,
    advance() { step++; }, elapse(ms) { clock += ms; }, abort() { controller.abort(); }, dispose() { emit('agent/disposed', { agent }); },
    listen: (name, fn) => ctx.on(name, fn),
  };
}

test('QUOTA selects backup and wakes once at idle, never retries the pinned primary', async () => {
  const h = fixture(); await h.request();
  assert.equal(await h.error(), undefined);
  assert.equal(h.f.status(h.agent).active, 'backup/same-tier');
  assert.deepEqual(h.waits, []); assert.equal(h.notices.length, 0);
  h.idle(); h.idle(); assert.equal(h.notices.length, 1);
  assert.equal(h.notices[0].source.kind, 'capability-team-failover');
  assert.match(h.notices[0].content[0].text, /Do not replay completed tool calls/);
  h.next(); assert.equal((await h.request()).provider, 'backup');
});

test('same-route retries and native retry priority do not enqueue continuation', async () => {
  const h = fixture(); await h.request();
  assert.deepEqual(await h.error(undefined, { kind: 'retry' }), { kind: 'retry' });
  assert.deepEqual(await h.error({ code: 'SERVER', status: 502 }), { kind: 'retry' });
  assert.deepEqual(h.waits, [1000]); h.idle(); assert.equal(h.notices.length, 0);
});

test('exhaustion remains bounded even if cooldown expires between continuation turns', async () => {
  const h = fixture({ role: { taskLeaseSignature: 'lease:1' } }); await h.request(); await h.error(); h.idle();
  h.elapse(seed.failover.cooldownMs + 1); h.role.taskLeaseSignature = 'lease:2'; h.next(); await h.request();
  assert.equal(h.f.status(h.agent).active, 'backup/same-tier');
  assert.equal(await h.error(), undefined); h.idle();
  assert.equal(h.notices.length, 1); assert.equal(h.f.status(h.agent).failed.length, 2);
});

test('real task-control revision updates do not reset the continuation outage chain', async () => {
  const t = taskFixture();
  let lease = await t.control.budget(t.lead, { action: 'start', role: 'dev' });
  await t.control.override(t.lead, { action: 'set', role: 'dev', lease_id: lease.leaseId, expected_revision: lease.revision, provider: 'p', model: 'mid' });
  const base = { ...t.role, fallbacks: [{ provider: 'p', model: 'upper' }], failover: seed.failover };
  const first = await t.control.route(t.worker, base);
  const f = createFailover(), agent = {};
  f.route(agent, 1, 1, first); assert.equal(await f.recover(agent, { code: 'QUOTA' }), true); f.continue(agent);
  t.setStarts(1); const second = await t.control.route(t.worker, base);
  assert.notEqual(first.taskLeaseSignature, second.taskLeaseSignature);
  assert.equal(f.route(agent, 2, 1, second).model, 'upper');
  assert.equal(await f.recover(agent, { code: 'QUOTA' }), false);
  assert.equal(f.status(agent).failed.length, 2);
});

test('no backup and INVALID_ARGS do not claim recovery or inject a notice', async () => {
  for (const failure of [{ code: 'QUOTA', status: 503 }, { code: 'INVALID_ARGS', status: 400 }]) {
    const h = fixture({ role: { fallbacks: [] } }); await h.request();
    assert.equal(await h.error(failure), undefined); h.idle(); assert.equal(h.notices.length, 0);
    if (failure.code === 'INVALID_ARGS') assert.deepEqual(h.f.cooling(), []);
  }
});

test('cancel, disposal, owner input, changed route and plugin disposal suppress pending wake', async () => {
  for (const stop of [h => h.abort(), h => h.dispose(), h => h.agent.inbox.nextTurn.push({ id: 'owner' }),
    h => h.agent.model.select({ provider: 'owner', model: 'choice' }), h => h.effects.forEach(fn => fn?.())]) {
    const h = fixture(); await h.request(); await h.error(); stop(h); h.idle(); assert.equal(h.notices.length, 0);
  }
});

test('native user source resets stickiness but internal notices and peer relays do not', async () => {
  const h = fixture(); await h.preStep(); await h.request(); await h.error(); h.idle(); h.next();
  await h.preStep(h.notices); await h.request();
  h.elapse(seed.failover.cooldownMs + 1);
  for (const source of [{ kind: 'capability-team-failover' }, { kind: 'agent-team' }, { kind: 'runtime-context' }]) {
    h.advance(); await h.preStep([{ role: 'user', source }]); await h.request();
    assert.equal(h.f.status(h.agent).active, 'backup/same-tier');
  }
  h.advance(); await h.preStep([{ role: 'user', source: { kind: 'user' } }], 'reject');
  assert.equal(h.f.status(h.agent).active, 'backup/same-tier');
  await h.preStep([{ role: 'user', source: { kind: 'user' } }]); await h.request();
  assert.equal(h.f.status(h.agent).active, 'primary/same-tier');
});

test('native user reset obeys cooldown and current signal cancellation clears activity', async () => {
  const h = fixture(); await h.preStep(); await h.request(); await h.error(); h.idle(); h.next();
  await h.preStep([{ source: { kind: 'user' } }]); await h.request();
  assert.equal(h.f.status(h.agent).active, 'backup/same-tier', 'new task cannot bypass primary cooldown');
  h.abort(); assert.equal(h.f.status(h.agent), undefined);
  h.next(); h.elapse(seed.failover.cooldownMs + 1); await h.preStep(); await h.request();
  assert.equal(h.f.status(h.agent).active, 'primary/same-tier');
});

test('late abort of a replaced native turn cannot reset current stickiness', async () => {
  const h = fixture(); await h.preStep(); const old = h.signal(); await h.request(); await h.error(); h.idle();
  h.next(); await h.preStep(h.notices); await h.request(); old.abort();
  assert.equal(h.f.status(h.agent).active, 'backup/same-tier');
});

test('sticky backup failing after successful steps advances once to the next same-tier candidate', async () => {
  const h = fixture({ role: { fallbacks: [{ provider: 'backup', model: 'same-tier' }, { provider: 'third', model: 'same-tier' }] } });
  await h.preStep(); await h.request(); await h.error(); h.idle(); h.next(); await h.preStep(h.notices); await h.request();
  h.elapse(seed.failover.cooldownMs + 1);
  for (let i = 0; i < 4; i++) { h.advance(); await h.preStep(); await h.request(); assert.equal(h.f.status(h.agent).active, 'backup/same-tier'); }
  await h.error(); h.idle(); assert.equal(h.notices.length, 2);
  h.next(); await h.preStep([h.notices[1]]); await h.request();
  assert.equal(h.f.status(h.agent).active, 'third/same-tier');
  await h.error(); h.idle(); assert.equal(h.notices.length, 2);
});

test('message factory failure preserves original failure and logs without waking', async () => {
  const h = fixture({ createMessage: () => { throw new Error('factory unavailable'); } }); await h.request();
  assert.equal(await h.error(), undefined); h.idle(); assert.equal(h.notices.length, 0);
  assert.match(h.warnings[0], /continuation unavailable/);
});

test('synchronous idle wake preserves lease-style asynchronous idle recheck and existing tool history', async () => {
  const h = fixture(); const history = [{ tool: 'write', result: 'completed' }]; h.agent.history = history;
  let ended = false;
  h.listen('agent/status', async ({ status }) => { if (status === 'idle') { await Promise.resolve(); ended = h.agent.status === 'idle'; } });
  await h.request(); await h.error(); h.idle(); await Promise.resolve();
  assert.equal(ended, false); assert.equal(h.agent.history, history); assert.equal(history.length, 1);
  h.next(); await h.request(); h.advance(); await h.request();
  assert.equal(h.f.status(h.agent).failed.length, 1, 'successful steps preserve the activity outage chain');
});
