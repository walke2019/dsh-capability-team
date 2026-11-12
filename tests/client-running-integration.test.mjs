import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const entry = process.env.DSH_NATIVE_LOOP_ENTRY;
test('native child execution status supplies baseline without catalog or history activation', { skip: !entry }, async () => {
  const source = await readFile(resolve(dirname(entry), '../../dsh-api-session-controller/lib/index.js'), 'utf8');
  const start = source.indexOf('var StateController = class'), end = source.indexOf('//#endregion', start);
  assert.ok(start >= 0 && end > start);
  const Native = vm.runInNewContext(`${source.slice(start, end)};StateController`, { AbortSignal, queueItems: () => [] });
  const child = { status: 'running', inbox: { nextTurn: [], nextStep: [] }, session: { id: 'child', seq: 10, header: { cwd: '/workspace' } } };
  let history = 0;
  const native = new Native({ agents: { get: id => id === 'child' ? child : undefined }, typertGateway: { getPendingRemoteEvents: () => [] } },
    { usingObservation() { history++; throw new Error('Unexpected history read'); } });
  assert.equal((await native.state({ sessionId: 'child' }, new AbortController().signal)).running, true);
  const fragment = await readFile(new URL('../client/11-register.js', import.meta.url), 'utf8');
  const store = fragment.slice(fragment.indexOf('    function liveStore'), fragment.indexOf('\n    const VIEWS'));
  const callbacks = new Map(), events = new Map(), effects = [];
  let calls = 0;
  const ctx = {
    sessions: { list: { getSnapshot: () => ({ ids: [], byId: { child: { running: false } } }), subscribe: () => () => {} } },
    uiSession: { sessionStatus: { getSnapshot: () => new Map(), subscribe: () => () => {} } },
    effect(fn) { const off = fn(); if (typeof off === 'function') effects.push(off); },
    on: (name, fn) => events.set(name, fn),
    remote: { $on(name, fn) { callbacks.set(name, fn); return () => callbacks.delete(name); },
      session: { state(args) { calls++; return native.state(args, new AbortController().signal); } } },
  };
  const live = vm.runInNewContext(`${store}\nliveStore`, {})(ctx);
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const release = live.watchMembers(['child']);
  assert.equal(live.running('child'), undefined, 'catalog-only false is not execution evidence');
  await flush();
  assert.equal(live.running('child'), true); assert.equal(calls, 1); assert.equal(history, 0);
  child.status = 'idle'; callbacks.get('api-session/status')('child', false);
  assert.equal(live.running('child'), false);
  child.status = 'running'; events.get('connection/reset')();
  assert.equal(live.running('child'), undefined, 'old connection must not manufacture idle');
  await flush(); assert.equal(live.running('child'), true); assert.equal(calls, 2);
  release();
  for (const off of effects.reverse()) off();
  assert.equal(callbacks.size, 0);
});
