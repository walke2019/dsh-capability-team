import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMemoryStore } from '../../packages/global-memory/shared/memory-store.js';
import { createOpenViking } from '../../packages/global-memory/shared/memory-openviking.js';
import { createSyncQueue } from '../../packages/global-memory/shared/memory-sync-queue.js';
import { memoryService } from '../../packages/global-memory/tools.js';
import { configuration, validate, searchSchema, writeSchema } from '../../packages/global-memory/config.js';
import { identities } from '../../packages/global-memory/identity.js';
const who = { project: '/example/project', session: 'parent', role: 'global-memory' };
async function fixture(t, config = {}) {
  const root = await mkdtemp(join(tmpdir(), 'gm-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = createMemoryStore(root);
  const counts = { embed: 0, recall: 0, enqueue: 0, revoke: 0 };
  const backend = { enabled: true, enqueue: () => { counts.enqueue++; return true; }, revoke: () => { counts.revoke++; }, recall: async () => { counts.recall++; return []; } };
  const embedder = { embed: async () => { counts.embed++; return null; } };
  const service = memoryService({ store, embedder, backend, config: configuration(config), secrets: () => ['private-test-secret'] });
  return { root, store, service, counts, backend, embedder };
}
test('4 identity pins first cwd and missing cwd retains session/global only; schema parity', async () => {
  let cwd = '/example/project';
  const i = identities({ workingDirectory: { ensure: async () => cwd } });
  assert.equal((await i.get({ id: 'a' })).project, resolve(cwd)); cwd = '/elsewhere';
  assert.equal((await i.get({ id: 'a' })).project, resolve('/example/project'));
  const none = identities({ workingDirectory: { ensure: () => { throw Error(); } } });
  assert.equal((await none.get({ id: 'b' })).project, undefined);
  for (const args of [{}, { query: 'ok', k: 0 }, { query: 'ok', kinds: ['invalid'] }, { query: 'ok', extra: true }, { query: ' ' }]) assert.throws(() => validate(searchSchema, args));
  for (const args of [{ kind: 'result', text: 'abc' }, { kind: 'note', text: 'abc', scope: 'role' }, { kind: 'note', text: 'abc', tags: Array(11).fill('a') }]) assert.throws(() => validate(writeSchema, args));
});
test('5 session never embeds/syncs/revokes; parent/child isolation; all redacted', async t => {
  const f = await fixture(t);
  let saved = await f.service.write(who, { kind: 'decision', text: 'private-test-secret session lesson', scope: 'session', key: 'topic' });
  assert.equal(saved.sync, 'local-only'); assert.equal(saved.embedded, false);
  await f.service.write(who, { kind: 'decision', text: 'new session lesson', scope: 'session', key: 'topic' });
  const own = await f.service.search(who, { query: 'session lesson', scope: 'session' });
  assert.equal(own.results.length, 1);
  assert.equal((await f.service.search({ ...who, session: 'child' }, { query: 'session lesson', scope: 'session' })).results.length, 0);
  assert.deepEqual(f.counts, { embed: 0, recall: 0, enqueue: 0, revoke: 0 });
  await f.service.write(who, { kind: 'note', text: 'private-test-secret reusable lesson', scope: 'project' });
  const results = await f.service.search(who, { query: 'reusable lesson' });
  assert.doesNotMatch(JSON.stringify(results), /private-test-secret/);
  assert.match(JSON.stringify(results), /Credentials redacted/);
});
test('6 strict scopes exclude role, respect k/JSON budget and explicit none', async t => {
  const f = await fixture(t);
  for (const scope of ['project','global','session']) await f.service.write(who, { kind: 'note', text: `${scope} common lesson`, scope });
  await f.store.write({ kind: 'note', text: 'private common lesson', scope: { kind: 'role', project: who.project, role: 'global-memory' } });
  for (const scope of ['project','session','global']) {
    const found = await f.service.search(who, { query: 'common lesson', scope });
    assert.equal(found.results.length, 1); assert.equal(found.results[0].scope, scope);
  }
  const local = await f.service.search(who, { query: 'common lesson', k: 1, shared_project_filter: 'current' });
  assert.equal(local.results.length, 1); assert.equal(local.shared.degraded, 'project-filter-unavailable'); assert.equal(f.counts.recall, 0);
  f.backend.recall = async () => { f.counts.recall++; return Array.from({ length: 20 }, (_, n) => ({ memory: { id: `${n}`, text: `${n} ${'x'.repeat(2000)}`, kind: 'note', scope: { kind: 'openviking' } }, via: ['openviking'] })); };
  const shared = await f.service.search(who, { query: 'common lesson', k: 20, shared_project_filter: 'none' });
  assert.equal(f.counts.recall, 1); assert.equal(shared.truncated, true); assert.ok(JSON.stringify(shared).length <= 12000);
});
test('7 embed/shared failure stays local, replacement revokes, queue failure saved truthfully', async t => {
  const f = await fixture(t);
  f.embedder.embed = async () => { throw Error('secret failure'); };
  const first = await f.service.write(who, { kind: 'decision', text: 'original local lesson', key: 'topic' });
  assert.equal(first.saved, true); assert.equal(first.sync, 'queued');
  await f.service.write(who, { kind: 'decision', text: 'replacement local lesson', key: 'topic' }); assert.equal(f.counts.revoke, 1);
  f.backend.recall = async () => { throw Error('secret failure'); };
  const found = await f.service.search(who, { query: 'local lesson', shared_project_filter: 'none' });
  assert.equal(found.results.length, 1); assert.equal(found.mode, 'text'); assert.equal(found.shared.degraded, 'shared-unavailable');
  f.backend.enqueue = () => { throw Error('full'); };
  const saved = await f.service.write(who, { kind: 'note', text: 'another local conclusion' });
  assert.equal(saved.saved, true); assert.equal(saved.syncWarning, 'sync-unavailable'); assert.notEqual(saved.sync, 'queued');
  const disabled = memoryService({ store: f.store, embedder: f.embedder, backend: f.backend, config: configuration({ syncWrites: false }) });
  assert.equal((await disabled.write(who, { kind: 'note', text: 'disabled sync conclusion' })).sync, 'disabled');
});
test('6 shared recall scope follows the deployment setting unless the plugin or the call sets it', async t => {
  const f = await fixture(t);
  let deployment = 'none';
  const service = memoryService({ store: f.store, embedder: f.embedder, backend: f.backend, config: configuration(), sharedFilter: () => deployment });
  const crossed = await service.search(who, { query: 'any lesson' });
  assert.equal(crossed.shared.filter, 'none'); assert.equal(crossed.shared.degraded, null); assert.equal(f.counts.recall, 1);
  deployment = 'current';
  const local = await service.search(who, { query: 'any lesson' });
  assert.equal(local.shared.degraded, 'project-filter-unavailable'); assert.equal(f.counts.recall, 1);
  assert.equal((await service.search(who, { query: 'any lesson', shared_project_filter: 'none' })).shared.filter, 'none');
  const pinned = memoryService({ store: f.store, embedder: f.embedder, backend: f.backend, config: configuration({ sharedProjectFilter: 'current' }), sharedFilter: () => 'none' });
  assert.equal((await pinned.search(who, { query: 'any lesson' })).shared.filter, 'current');
  assert.throws(() => configuration({ sharedProjectFilter: 'all' }), /sharedProjectFilter/);
});
test('7 durable queue restart and explicit capacity failure; 8 independent queue paths', async t => {
  const f = await fixture(t);
  const a = createSyncQueue(join(f.root, 'team-queue.json'), { max: 1 });
  a.push({ role: 'user', content: 'durable' });
  assert.throws(() => a.push({ role: 'user', content: 'overflow' }));
  const restored = createSyncQueue(join(f.root, 'team-queue.json'), { max: 1 }); assert.equal(restored.size(), 1);
  const global = createSyncQueue(join(f.root, 'global-memory-queue.json')); assert.equal(global.size(), 0);
  const settings = { config: { backend: 'openviking', url: 'https://gateway.example.com', timeoutMs: 100 }, key: '' };
  const v = createOpenViking({ queuePath: join(f.root, 'ov.json'), settings, schedule: () => 1 });
  assert.equal(v.enqueue({ kind: 'note', text: 'test conclusion', scope: { kind: 'project' } }, who), true);
  assert.equal(createSyncQueue(join(f.root, 'ov.json')).size(), 1);
});
test('8 long-lived stores see each other and concurrent file lock writes survive', async t => {
  const f = await fixture(t); const other = createMemoryStore(f.root);
  const scope = { kind: 'project', project: who.project };
  await f.store.search({ project: who.project, query: 'shared lesson' });
  await Promise.all([f.store.write({ kind: 'note', text: 'first shared lesson', scope }), other.write({ kind: 'note', text: 'second shared lesson', scope })]);
  const found = await f.store.search({ project: who.project, query: 'shared lesson' }); assert.equal(found.length, 2);
  assert.equal((await other.search({ project: who.project, query: 'shared lesson' })).length, 2);
});
