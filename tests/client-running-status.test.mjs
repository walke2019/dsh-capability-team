import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = name => readFileSync(new URL(`../client/${name}`, import.meta.url), 'utf8');
const registration = source('11-register.js');
const storeSource = registration.slice(registration.indexOf('    function liveStore'), registration.indexOf('\n    const VIEWS'));
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness({ native = new Map(), state } = {}) {
  const callbacks = new Map(), events = new Map(), cleanup = [], listeners = new Set(), calls = [];
  const list = { ids: ['lead'], byId: { lead: { running: true }, back: { running: false }, front: { running: false } } };
  const ctx = {
    sessions: { list: { getSnapshot: () => list, subscribe: () => () => {} } },
    uiSession: { sessionStatus: { getSnapshot: () => native, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } } },
    effect(fn) { const off = fn(); if (typeof off === 'function') cleanup.push(off); },
    on(name, fn) { events.set(name, fn); },
    remote: {
      $on(name, fn) { callbacks.set(name, fn); return () => callbacks.delete(name); },
      session: { state(args) { calls.push(args.sessionId); return state?.(args.sessionId) ?? Promise.resolve({ active: true, running: true }); } },
    },
  };
  const live = runInNewContext(`${storeSource}\nliveStore`, {})(ctx);
  return { live, callbacks, events, cleanup, listeners, calls, list, native };
}
const helpers = runInNewContext(`${source('06-usage.js')}\n${source('07-board-parts.js')}\n({teamActivityFrom,liveRoster,boardCards})`, { baseName: x => x, routeOutsideConfig: () => false, routeText: x => x });
const team = { members: [{ id: 'lead', name: 'lead', role: 'lead', phase: 'active' }, { id: 'back', name: 'backend', phase: 'active' }, { id: 'front', name: 'frontend', phase: 'active' }] };
function cards(live) {
  const activity = helpers.teamActivityFrom(team, live);
  const roster = helpers.liveRoster('lead', activity, [{ kind: 'child', id: 'back', activity: 'running' }, { kind: 'child', id: 'front', activity: 'running' }], live, Date.now());
  return helpers.boardCards([{ id: 'lead' }, { id: 'backend' }, { id: 'frontend' }], roster);
}

test('catalog-only false is unknown; lightweight baseline restores all three running cards', async () => {
  const h = harness();
  assert.equal(cards(h.live)[1].status, 'unknown');
  const release = h.live.watchMembers(['lead', 'back', 'front']);
  await flush();
  assert.equal(h.calls.join(','), 'back,front');
  assert.equal(cards(h.live).filter(c => c.status === 'running').length, 3);
  release();
});
test('native observable status is consumed and subscribed without querying known members', async () => {
  const h = harness({ native: new Map([['back', { running: false }], ['front', { running: true }]]) });
  let notices = 0;
  h.live.subscribe(() => notices++);
  h.live.watchMembers(['back', 'front']);
  await flush();
  assert.equal(h.calls.length, 0);
  assert.equal(cards(h.live)[1].status, 'idle');
  for (const notify of h.listeners) notify();
  assert.equal(notices, 1);
  for (const off of h.cleanup.reverse()) off();
  assert.equal(h.listeners.size, 0);
  assert.equal(h.callbacks.size, 0);
});
test('late baseline cannot resurrect explicit stop or removed member', async () => {
  let resolve;
  const h = harness({ state: () => new Promise(done => { resolve = done; }) });
  h.live.watchMembers(['back']);
  await flush();
  h.callbacks.get('api-session/status')('back', false);
  resolve({ running: true });
  await flush();
  assert.equal(cards(h.live)[1].status, 'idle');
  h.callbacks.get('api-session/removed')('back');
  assert.equal(h.live.running('back'), false);
});
test('failure stays unknown with no render retry; reconnect takes one new baseline', async () => {
  const h = harness({ state: () => Promise.reject(new Error('offline')) });
  h.live.watchMembers(['back']);
  await flush();
  for (let i = 0; i < 5; i++) cards(h.live);
  assert.equal(h.calls.length, 1);
  assert.equal(cards(h.live)[1].status, 'unknown');
  h.events.get('connection/reset')();
  await flush();
  assert.equal(h.calls.length, 2);
});
test('released members and old connection replies are ignored', async () => {
  const replies = [];
  const h = harness({ state: () => new Promise(resolve => replies.push(resolve)) });
  const release = h.live.watchMembers(['back']);
  await flush();
  h.events.get('connection/reset')();
  await flush();
  replies[0]({ running: true });
  await flush();
  assert.equal(h.live.running('back'), undefined);
  release();
  replies[1]({ running: true });
  await flush();
  assert.equal(h.live.running('back'), undefined);
});
test('reconnect refreshes a known native baseline and disposal ignores late replies', async () => {
  let resolve;
  const h = harness({ native: new Map([['back', { running: false }]]), state: () => new Promise(done => { resolve = done; }) });
  h.live.watchMembers(['back']);
  h.events.get('connection/reset')();
  await flush();
  resolve({ running: true });
  await flush();
  assert.equal(h.live.running('back'), true);
  h.events.get('connection/reset')();
  await flush();
  for (const off of h.cleanup.reverse()) off();
  resolve({ running: false });
  await flush();
  assert.equal(h.live.running('back'), undefined);
});
test('canvas receives the same resolved card status and labels unknown explicitly', () => {
  const stage = runInNewContext(`${source('08e-stage-activity.js')}\n${source('08d-stage-adapter.js').split('    // test hooks')[0]}\nstageSprites`, {
    label: (t, key) => t(key), modelBadgeInfo: () => null,
  });
  const h = harness();
  const rows = cards(h.live);
  const sprites = stage(rows, { t: key => key });
  assert.equal(sprites.map(s => s.status).join(','), rows.map(c => c.status).join(','));
  assert.equal(sprites[1].activityLabel, 'live.unknown');
  assert.equal(sprites[1].parallel, 0);
});
test('native Map-only changes supersede legacy status and preserve ABA ordering', () => {
  const h = harness({ native: new Map([['back', { running: false }]]) });
  h.live.watchMembers(['back']);
  h.callbacks.get('api-session/status')('back', true);
  assert.equal(h.live.running('back'), true);
  for (const running of [true, false, true, false]) {
    h.native.set('back', { running });
    for (const notify of h.listeners) notify();
    assert.equal(h.live.running('back'), running);
  }
  h.callbacks.get('api-session/status')('back', true);
  assert.equal(h.live.running('back'), true);
});
test('native Map-only stop fences a late running RPC baseline', async () => {
  let resolve;
  const h = harness({ state: () => new Promise(done => { resolve = done; }) });
  h.live.watchMembers(['back']);
  await flush();
  h.native.set('back', { running: false });
  for (const notify of h.listeners) notify();
  resolve({ running: true });
  await flush();
  assert.equal(h.live.running('back'), false);
});
test('errors remain failed and stale snapshots never count as running', () => {
  const h = harness();
  h.callbacks.get('api-session/error')('back', 'request failed');
  assert.equal(cards(h.live)[1].status, 'failed');
  assert.equal(helpers.liveRoster('lead', { members: [{ id: 'back', status: 'running' }] }, null, h.live, 0).members[0].status, 'failed');
  assert.equal(helpers.liveRoster('lead', { members: [{ id: 'front', status: 'running' }] }, null, h.live, 0).members[0].status, 'unknown');
});
