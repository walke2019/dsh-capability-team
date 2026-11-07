import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DesktopLifecycle } from '../scripts/dsh-autostart/desktop-supervisor.mjs';

function fixture(terminate = async () => {}) {
  const children = [], states = [], timers = [];
  const manager = new DesktopLifecycle({
    launch: () => { const child = new EventEmitter(); child.pid = 9000 + children.length; children.push(child); return child; },
    terminate, save: (state) => states.push(state), log: () => {},
    schedule: (fn, delay) => { const timer = { fn, delay, cancelled: false }; timers.push(timer); return timer; },
    cancel: (timer) => { timer.cancelled = true; }
  });
  manager.start();
  const request = (action = 'restart') => ({ token: manager.token, appPid: manager.child.pid, action });
  return { manager, children, states, timers, request };
}

test('a Mothership restart quits the old process first, launches exactly once and invalidates the old token', async () => {
  const f = fixture();
  const oldRequest = f.request();
  assert.deepEqual(await f.manager.request(f.request('hello')), { ok: true, appPid: 9000 });
  await f.manager.request(oldRequest);
  assert.equal(f.children.length, 1);
  await assert.rejects(f.manager.request(oldRequest), /already in progress/);
  f.children[0].emit('exit', 0, null);
  assert.equal(f.children.length, 1);
  f.timers.find((timer) => timer.delay === 750).fn();
  assert.equal(f.children.length, 2);
  assert.equal(f.manager.phase, 'running');
  assert.equal(f.manager.restarts, 1);
  await assert.rejects(f.manager.request(oldRequest), /not from the currently managed/);
  assert.equal(f.states.at(-1).appPid, 9001);
});

test('a manual quit or an unexpected crash never causes a restart loop', () => {
  for (const code of [0, 1]) {
    const f = fixture();
    f.children[0].emit('exit', code, null);
    assert.equal(f.manager.phase, 'stopped');
    assert.equal(f.children.length, 1);
    assert.equal(f.timers.length, 0);
  }
});

test('a wrong token, wrong process or unknown action cannot restart the desktop', async () => {
  const f = fixture();
  await assert.rejects(f.manager.request({ ...f.request(), token: 'wrong' }), /not from the currently managed/);
  await assert.rejects(f.manager.request({ ...f.request(), appPid: 1 }), /not from the currently managed/);
  await assert.rejects(f.manager.request(f.request('shell')), /unsupported/);
  assert.equal(f.manager.phase, 'running');
  assert.equal(f.timers.length, 0);
});

test('a quit timeout keeps the instance, and a later manual quit triggers no late restart', async () => {
  const f = fixture();
  await f.manager.request(f.request());
  f.timers.find((timer) => timer.delay === 45000).fn();
  assert.equal(f.manager.phase, 'running');
  assert.equal(f.children.length, 1);
  assert.match(f.states.at(-1).error, /not killed/);
  f.children[0].emit('exit', 0, null);
  assert.equal(f.timers.filter((timer) => timer.delay === 750).length, 0);
});

test('when the system refuses to quit, the running state is restored and no second instance starts', async () => {
  const f = fixture(async () => { throw new Error('system refused'); });
  await assert.rejects(f.manager.request(f.request()), /system refused/);
  assert.equal(f.manager.phase, 'running');
  assert.equal(f.children.length, 1);
  assert.equal(f.timers.length, 0);
});
