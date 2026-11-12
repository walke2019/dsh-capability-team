import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { createContinuation } from '../failover-continuation.js';
import { createFailover } from '../failover.js';
import { seed } from '../config.js';

// Optional local contract verification; no installed runtime or credentials are modified.
// DSH_NATIVE_LOOP_ENTRY=/absolute/path/to/dsh-agent-loop/lib/index.js enables it.
const entry = process.env.DSH_NATIVE_LOOP_ENTRY;
test('installed native driver wakes once from its own failing-driver idle boundary', { skip: !entry }, async () => {
  const source = await readFile(entry, 'utf8');
  const start = source.indexOf('var ReactLoopAgent = class');
  assert.ok(start >= 0, 'installed native class must be recognizable');
  const end = source.indexOf('//#endregion', start);
  assert.ok(end > start);
  const Native = vm.runInNewContext(`${source.slice(start, end)};ReactLoopAgent`, { AbortController, Promise, Error });
  const require = createRequire(resolve(dirname(entry), 'contract-test.cjs'));
  const { createUserMessage } = require('@deepseek-ai/dsh-llm');
  const listeners = new Map();
  const ctx = { on(name, fn) { listeners.set(name, fn); }, effect() {} };
  const agent = Object.create(Native.prototype);
  const signal = new AbortController();
  agent.phase = { kind: 'running', turn: 1, step: 1, abort: signal, wakeRequested: false };
  agent.activityDone = Promise.resolve();
  agent.lifetimeSignal = new AbortController().signal;
  agent.model = { current: () => ({ provider: 'backup', model: 'm' }) };
  agent.inbox = {
    nextStep: [], nextTurn: [],
    get hasPending() { return this.nextStep.length + this.nextTurn.length > 0; },
    splice(target, _start, _count, items) { this[target === 'next-step' ? 'nextStep' : 'nextTurn'].push(...items); },
  };
  agent.loopCtx = { agents: { withInitiator: (_agent, fn) => fn() } };
  agent.dispatch = { emit: (name, payload) => listeners.get(name)?.({ agent, ...payload }) };
  let turns = 0, continues = 0;
  // Keep the real driver methods; replace only the turn workload and inbox storage.
  // This proves wake timing, not provider projection or tool execution semantics.
  const notices = [];
  agent.turn = async function () {
    turns++;
    if (turns === 1) throw new Error('QUOTA');
    notices.push(...this.inbox.nextStep.splice(0));
    return false;
  };
  const continuation = createContinuation(ctx, { owns: () => true }, { continue: () => continues++ }, { createMessage: createUserMessage });
  assert.equal(await continuation.arm(agent, { provider: 'backup', model: 'm' }, signal.signal), true);
  await agent.kick();
  await agent.whenIdle();
  assert.equal(turns, 2);
  assert.equal(continues, 1);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].source.kind, 'capability-team-failover');
  assert.equal(signal.signal.aborted, false);
  assert.equal(agent.status, 'idle');
});

test('new lease identity or candidate list resets the previous outage chain', async () => {
  for (const change of [role => ({ ...role, taskLeaseSignature: 'new-lease:1' }),
    role => ({ ...role, fallbacks: [...role.fallbacks, { provider: 'third', model: 'm' }] })]) {
    const f = createFailover({ now: () => 0 });
    const agent = {};
    const role = { provider: 'primary', model: 'm', fallbacks: [{ provider: 'backup', model: 'm' }], taskLeaseSignature: 'lease:1', failover: seed.failover };
    f.route(agent, 1, 1, role);
    assert.equal(await f.recover(agent, { code: 'QUOTA' }), true);
    f.continue(agent);
    f.route(agent, 2, 1, change(role));
    assert.deepEqual(f.status(agent).failed, []);
  }
});
