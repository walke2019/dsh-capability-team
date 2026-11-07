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

test('中枢重启必须先退出旧进程，再且仅再启动一次，并使旧令牌失效', async () => {
  const f = fixture();
  const oldRequest = f.request();
  assert.deepEqual(await f.manager.request(f.request('hello')), { ok: true, appPid: 9000 });
  await f.manager.request(oldRequest);
  assert.equal(f.children.length, 1);
  await assert.rejects(f.manager.request(oldRequest), /已有重启/);
  f.children[0].emit('exit', 0, null);
  assert.equal(f.children.length, 1);
  f.timers.find((timer) => timer.delay === 750).fn();
  assert.equal(f.children.length, 2);
  assert.equal(f.manager.phase, 'running');
  assert.equal(f.manager.restarts, 1);
  await assert.rejects(f.manager.request(oldRequest), /拒绝非当前/);
  assert.equal(f.states.at(-1).appPid, 9001);
});

test('手动正常退出及意外崩溃均不会形成自动重启循环', () => {
  for (const code of [0, 1]) {
    const f = fixture();
    f.children[0].emit('exit', code, null);
    assert.equal(f.manager.phase, 'stopped');
    assert.equal(f.children.length, 1);
    assert.equal(f.timers.length, 0);
  }
});

test('错误令牌、错误进程和未知操作不能重启桌面', async () => {
  const f = fixture();
  await assert.rejects(f.manager.request({ ...f.request(), token: 'wrong' }), /拒绝非当前/);
  await assert.rejects(f.manager.request({ ...f.request(), appPid: 1 }), /拒绝非当前/);
  await assert.rejects(f.manager.request(f.request('shell')), /不支持/);
  assert.equal(f.manager.phase, 'running');
  assert.equal(f.timers.length, 0);
});

test('退出超时保留原实例，之后手动退出不会再触发迟到重启', async () => {
  const f = fixture();
  await f.manager.request(f.request());
  f.timers.find((timer) => timer.delay === 45000).fn();
  assert.equal(f.manager.phase, 'running');
  assert.equal(f.children.length, 1);
  assert.match(f.states.at(-1).error, /未强杀/);
  f.children[0].emit('exit', 0, null);
  assert.equal(f.timers.filter((timer) => timer.delay === 750).length, 0);
});

test('系统拒绝退出时恢复运行态，不启动第二个实例', async () => {
  const f = fixture(async () => { throw new Error('系统拒绝'); });
  await assert.rejects(f.manager.request(f.request()), /系统拒绝/);
  assert.equal(f.manager.phase, 'running');
  assert.equal(f.children.length, 1);
  assert.equal(f.timers.length, 0);
});
