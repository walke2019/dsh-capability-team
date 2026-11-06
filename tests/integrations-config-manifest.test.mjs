// Managed manifest reader: credential record first, then <DSH home>/aiwuk/managed-config.json. Values-free always.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MANAGED_CONFIG_RECORD_ID, MANAGED_CONFIG_RECORD_KEY, MANAGED_CONFIG_RECORD_SCOPE, managedConfigFilePath, manifestToWire, normalizeManifest, readManagedManifest } from '../shared/managed-config.js';

const good = { revision: 4, updatedAt: '2026-01-01T00:00:00Z', entries: [{ ref: 'SEARXNG_URL', locked: true, secret: false }, { ref: 'TAVILY_API_KEY', locked: false, secret: false }] };
const withHome = async fn => { const home = await mkdtemp(join(tmpdir(), 'mh-')); try { return await fn(home); } finally { await rm(home, { recursive: true, force: true }); } };
const writeManifest = async (home, payload) => { await mkdir(join(home, 'aiwuk'), { recursive: true }); await writeFile(managedConfigFilePath(home), typeof payload === 'string' ? payload : JSON.stringify(payload)); };

test('record key is the connector scope plus the managed-config id', () => {
  assert.equal(MANAGED_CONFIG_RECORD_SCOPE, 'mothership-connector');
  assert.equal(MANAGED_CONFIG_RECORD_ID, 'managed-config');
  assert.equal(MANAGED_CONFIG_RECORD_KEY, 'mothership-connector/managed-config');
});

test('reads the credential record and normalizes it into a Map', async () => {
  const keys = [];
  const credentials = { readRecord: async key => { keys.push(key); return { kind: 'grant', payload: good }; } };
  const m = await readManagedManifest({ credentials }, { home: '/nonexistent' });
  assert.deepEqual(keys, [MANAGED_CONFIG_RECORD_KEY]);
  assert.equal(m.revision, 4);
  assert.deepEqual([...m.entries], [['SEARXNG_URL', { locked: true, secret: false }], ['TAVILY_API_KEY', { locked: false, secret: true }]], 'a *_API_KEY ref is always secret');
});

test('falls back to the file when the record is missing, wrong-typed or the read throws', async () => {
  await withHome(async home => {
    await writeManifest(home, good);
    for (const credentials of [undefined, { readRecord: async () => undefined }, { readRecord: async () => ({ kind: 'apiKey', value: 'x' }) }, { readRecord: async () => { throw new Error('boom'); } }, { readRecord: async () => ({ kind: 'grant', payload: { nope: true } }) }]) {
      assert.equal((await readManagedManifest({ credentials }, { home }))?.revision, 4);
    }
  });
});

test('the record wins over the file', async () => {
  await withHome(async home => {
    await writeManifest(home, { ...good, revision: 1 });
    assert.equal((await readManagedManifest({ credentials: { readRecord: async () => ({ kind: 'grant', payload: { ...good, revision: 9 } }) } }, { home })).revision, 9);
  });
});

test('malformed input yields null or skips the bad entries, never throws', async () => {
  for (const bad of [null, undefined, 3, 'x', [], {}, { revision: -1, entries: [] }, { revision: 1.5, entries: [] }, { revision: 1, entries: 'x' }]) assert.equal(normalizeManifest(bad), null, JSON.stringify(bad));
  const partial = normalizeManifest({ revision: 1, entries: [null, 7, { ref: 'lower' }, { ref: 'OK_REF' }, { ref: 'A' }, { ref: 'X'.repeat(80) }] });
  assert.deepEqual([...partial.entries.keys()], ['OK_REF']);
  assert.equal(partial.entries.get('OK_REF').locked, false);
  await withHome(async home => {
    await writeManifest(home, '{not json');
    assert.equal(await readManagedManifest({}, { home }), null);
    assert.equal(await readManagedManifest(undefined, { home: join(home, 'missing') }), null);
  });
  const many = normalizeManifest({ revision: 1, entries: Array.from({ length: 500 }, (_, i) => ({ ref: `REF_${String(i).padStart(4, '0')}` })) });
  assert.equal(many.entries.size, 200, 'bounded to the protocol maximum');
});

test('never returns values: a stray value field is dropped everywhere', async () => {
  const leaky = { revision: 2, entries: [{ ref: 'OMNI_SEARCH_API_KEY', locked: true, secret: true, value: 'sk-leak-1' }], value: 'sk-leak-2' };
  const manifest = normalizeManifest(leaky);
  assert.ok(!JSON.stringify([...manifest.entries]).includes('sk-leak'));
  assert.ok(!JSON.stringify(manifestToWire(manifest)).includes('sk-leak'));
  assert.deepEqual(Object.keys(manifestToWire(manifest).entries[0]).sort(), ['locked', 'ref', 'secret']);
  assert.deepEqual(manifestToWire(null), { revision: 0, entries: [] });
});
