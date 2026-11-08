import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryHub } from '../memory-hub.js';
import { createMemoryCore, createMemoryStore, storeScope } from '../memory-store.js';
import { configuration } from '../packages/global-memory/config.js';
import { memoryService } from '../packages/global-memory/tools.js';
import { createMemoryStore as packagedStore } from '../packages/global-memory/shared/memory-store.js';

const P = '/example/project';
const noEmbed = { available: false, lastError: null, embed: async () => null };
const quietBackend = () => ({ enabled: true, name: 'fake', lastError: null, queued: [], revoked: [],
  enqueue(memory) { this.queued.push(memory); return true; }, revoke(rows) { this.revoked.push(...rows); }, recall: async () => [], flush: async () => ({ sent: 0 }) });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'memory-core-')); t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('storeScope maps every scope, including the team role scope', () => {
  const who = { project: P, session: 's1', role: 'backend' };
  assert.deepEqual(storeScope('global', who), { kind: 'global' });
  assert.deepEqual(storeScope('project', who), { kind: 'project', project: P });
  assert.deepEqual(storeScope('session', who), { kind: 'session', project: P, session: 's1' });
  assert.deepEqual(storeScope('role', who), { kind: 'role', project: P, role: 'backend' });
  assert.throws(() => storeScope('galaxy', who), /Unknown memory scope/);
});

test('hub write and @aiwuk/memory ingest store the same record (role default, kinds, source, key, redaction)', async t => {
  const root = await fixture(t);
  const store = createMemoryStore(root), backend = quietBackend();
  const secret = 'cred-value-abcdef123';
  const hub = createMemoryHub({}, { root }, { store, embedder: noEmbed, backend, secrets: () => [secret] });
  const service = memoryService({ store, embedder: noEmbed, backend, config: configuration(), secrets: () => [secret] });
  const who = { project: P, role: 'backend', session: 's1', name: 'backend', leadId: 'lead-1', lead: false };
  const source = { member: 'backend', session: 's1', lead: 'lead-1', at: 1 };
  const viaHub = await hub.write(who, { kind: 'handoff', text: `handoff ${secret} for backend`, key: 'handoff:backend', tags: ['a'] });
  const viaPackage = await service.ingest(who, { kind: 'handoff', scope: 'role', text: `handoff ${secret} for backend`, key: 'handoff:backend', tags: ['a'], source });
  assert.equal(viaHub.memory.scope.kind, 'role', 'hub default scope stays role');
  assert.deepEqual(viaPackage.merged, true, 'identical text in the same role scope merges, so both paths address one record');
  assert.equal(viaPackage.id, viaHub.memory.id);
  assert.ok(!viaHub.memory.text.includes(secret));
  const [stored] = await store.search({ project: P, role: 'backend', query: 'handoff backend', k: 5, kinds: ['handoff'] });
  assert.deepEqual(stored.memory.scope, { kind: 'role', project: P, role: 'backend' });
  assert.equal(stored.memory.source.member, 'backend');
  assert.equal(stored.memory.key, 'handoff:backend');
  // The public memory_write contract still refuses role and the team-only kinds.
  await assert.rejects(service.write(who, { kind: 'note', text: 'abcd role note', scope: 'role' }));
  await assert.rejects(service.write(who, { kind: 'handoff', text: 'abcd handoff note' }));
  // A replaced decision revokes the old one through the shared backend on both paths.
  await hub.write(who, { kind: 'decision', scope: 'project', key: 'topic', text: 'old architecture decision' });
  await service.write(who, { kind: 'decision', scope: 'project', key: 'topic', text: 'new architecture decision' });
  assert.equal(backend.revoked.length, 1);
  assert.equal(backend.revoked[0].text, 'old architecture decision');
});

test('existing memory files stay readable across hub, package service and a fresh store', async t => {
  const root = await fixture(t);
  const hub = createMemoryHub({}, { root }, { store: createMemoryStore(root), embedder: noEmbed, backend: quietBackend() });
  const who = { project: P, role: 'backend', session: 's1', name: 'backend', leadId: 'l', lead: false };
  await hub.write(who, { kind: 'pitfall', scope: 'project', text: 'legacy pitfall about retries' });
  await hub.write(who, { kind: 'result', text: 'legacy result about retries' });
  // A different process reads the same files through the packaged copy of the store.
  const fresh = packagedStore(root);
  const service = memoryService({ store: fresh, embedder: noEmbed, backend: { enabled: false }, config: configuration() });
  const found = await service.search({ project: P, session: 'other', role: 'global-memory' }, { query: 'retries' });
  assert.deepEqual(found.results.map(r => r.kind), ['pitfall'], 'project memory is shared, role memory stays team-only');
  const teamView = await createMemoryHub({}, { root }, { store: createMemoryStore(root), embedder: noEmbed, backend: quietBackend() }).search(who, { query: 'retries', k: 5 });
  assert.deepEqual(teamView.results.map(r => r.memory.kind).sort(), ['pitfall', 'result']);
});

test('recall counts as use on both paths', async t => {
  const root = await fixture(t);
  const store = createMemoryStore(root);
  const service = memoryService({ store, embedder: noEmbed, backend: { enabled: false }, config: configuration() });
  const who = { project: P, session: 's1', role: 'global-memory' };
  await service.write(who, { kind: 'note', text: 'recall counting lesson', scope: 'project' });
  const hits = async () => (await store.search({ project: P, query: 'recall counting lesson' }))[0].memory.hits;
  await service.search(who, { query: 'recall counting lesson' });
  assert.equal(await hits(), 0, 'explicit tool search does not count');
  await service.search(who, { query: 'recall counting lesson' }, { markUsed: true });
  assert.equal(await hits(), 1, 'automatic recall counts');
  const core = createMemoryCore({ store, embedder: noEmbed, backend: { enabled: false } });
  const [row] = await store.search({ project: P, query: 'recall counting lesson' });
  await core.markUsed([row.memory, { scope: { kind: 'openviking' } }]);
  assert.equal(await hits(), 2, 'backend rows are skipped');
});
