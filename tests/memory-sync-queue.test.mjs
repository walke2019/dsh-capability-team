import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSyncQueue } from '../memory-sync-queue.js';
import { createOpenViking } from '../memory-openviking.js';
import { createMemoryHub } from '../memory-hub.js';
import { createMemoryStore } from '../memory-store.js';
test('hub search budget and replaced decisions produce revocation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hub-budget-')), revoked = [];
  const hub = createMemoryHub({}, { root }, { store: createMemoryStore(root), embedder: { embed: async () => null }, viking: {
    enabled: true, lastError: null, enqueue() {}, revoke: rows => revoked.push(...rows),
    recall: async () => Array.from({ length: 20 }, (_, i) => ({ memory: { id: String(i), kind: 'note', scope: { kind: 'openviking' }, text: String(i) + 'x'.repeat(1100) } })),
  } });
  const who = { project: 'test-project', role: 'backend', session: 's' };
  await hub.write(who, { kind: 'decision', scope: 'project', key: 'topic', text: 'old architecture decision' });
  await hub.write(who, { kind: 'decision', scope: 'project', key: 'topic', text: 'new replacement decision' });
  assert.equal(revoked.length, 1); assert.equal(revoked[0].text, 'old architecture decision');
  const found = await hub.search(who, { query: 'decision', k: 20 });
  assert.ok(found.results.reduce((n, r) => n + JSON.stringify(r.memory.text).length, 0) <= 12000);
  assert.ok(found.results.length <= 20);
});
test('queue persists restart, acknowledgments, revocations and explicit overflow', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'sync-')), 'queue.json'); let warnings = 0;
  const q = createSyncQueue(path, { max: 1, warn: () => warnings++ }); q.push({ role: 'user', content: 'safe test' });
  assert.throws(() => q.push({ content: 'overflow' }), /full/); assert.equal(warnings, 1);
  const next = createSyncQueue(path); assert.equal(next.size(), 1); next.revoke(['old decision']);
  next.ack(next.peek()); const last = createSyncQueue(path); assert.equal(last.size(), 0); assert.deepEqual(last.revoked(), ['old decision']);
});
test('OpenViking retries recovered batch and marks old decisions withdrawn', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'ov-sync-')), 'queue.json'), messages = [];
  const settings = { config: { backend: 'openviking', url: 'https://memory.example.test', timeoutMs: 1000, recallLimit: 4 } };
  const opts = { settings, queuePath: path, schedule: () => null, fetcher: async (_url, request) => {
    if (_url.endsWith('/messages')) messages.push(JSON.parse(request.body));
    return Response.json({ status: 'ok', result: _url.includes('/search/') ? { entries: [{ uri: 'viking://old', text: 'old decision' }, { uri: 'viking://new', text: 'new decision' }] } : {} });
  } };
  const first = createOpenViking(opts); first.enqueue({ kind: 'note', text: 'queued', scope: {} }, {});
  const next = createOpenViking(opts); assert.equal(next.pending(), 1); next.revoke([{ text: 'old decision' }]);
  const out = await next.flush(); assert.equal(out.sent, 2); assert.ok(messages.some(m => m.content.includes('记忆撤销')));
  assert.deepEqual((await next.recall('decision')).map(r => r.memory.text), ['new decision']);
  assert.equal(createOpenViking(opts).pending(), 0);
});
