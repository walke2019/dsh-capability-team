// Resolver precedence (contract F.3): a LOCKED managed ref beats everything local; otherwise
// settings > credential > env > file > unlocked managed value > default. All seven sources are covered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveIntegrations, keyOf, keyPresence, describeIntegrations, setCredentialResolver, setManagedReader, refreshCredentials, useCredentials } from '../integrations-config.js';
import { resolveRef } from '../managed-ref.js';
import { SOURCE_KINDS } from '../managed-resolve.js';

const URL_REF = 'SEARXNG_URL';
const manifest = (...entries) => ({ revision: 1, entries: new Map(entries.map(([ref, locked]) => [ref, { locked, secret: false }])) });
const resolveUrl = async ({ settings, credential, env = {}, file, managed }) => {
  const root = await mkdtemp(join(tmpdir(), 'mc-'));
  try {
    if (file) await writeFile(join(root, 'integrations.json'), JSON.stringify({ integrations: { search: { searxngUrl: file } } }));
    const r = resolveIntegrations({ root, env, managed, credentials: new Map(credential ? [[URL_REF, credential]] : []), settings: settings ? { search: { searxngUrl: settings } } : {} });
    return { value: r.effective.search.searxngUrl, source: r.sources.search.searxngUrl, locked: r.locked.search.searxngUrl };
  } finally { await rm(root, { recursive: true, force: true }); }
};
const U = name => `https://${name}.example.com`;

test('each of the seven sources can win, with its source label', async () => {
  const all = { settings: U('settings'), credential: U('credential'), env: { [URL_REF]: U('env') }, file: U('file') };
  assert.deepEqual(await resolveUrl({ ...all, managed: manifest([URL_REF, true]) }), { value: U('credential'), source: 'managed-locked', locked: true });
  assert.deepEqual(await resolveUrl(all), { value: U('settings'), source: 'settings', locked: false });
  assert.deepEqual(await resolveUrl({ ...all, settings: undefined }), { value: U('credential'), source: `credential:${URL_REF}`, locked: false });
  assert.deepEqual(await resolveUrl({ ...all, settings: undefined, credential: undefined }), { value: U('env'), source: `env:${URL_REF}`, locked: false });
  assert.deepEqual(await resolveUrl({ file: U('file') }), { value: U('file'), source: 'file', locked: false });
  assert.deepEqual(await resolveUrl({ credential: U('managed'), managed: manifest([URL_REF, false]) }), { value: U('managed'), source: 'managed-default', locked: false });
  assert.deepEqual(await resolveUrl({}), { value: null, source: 'default', locked: false });
  for (const kind of ['managed-locked', 'settings', 'credential', 'env', 'file', 'managed-default', 'default']) assert.ok(SOURCE_KINDS.includes(kind));
});

test('unlocked managed values act as defaults below every local source', async () => {
  const managed = manifest([URL_REF, false]);
  const stored = U('managed');
  assert.equal((await resolveUrl({ credential: stored, managed, file: U('file') })).value, U('file'), 'file beats the unlocked managed value');
  assert.equal((await resolveUrl({ credential: stored, managed, env: { [URL_REF]: U('env') } })).value, U('env'), 'env beats it too');
  assert.equal((await resolveUrl({ credential: stored, managed, settings: U('settings') })).value, U('settings'));
});

test('a locked ref ignores settings, env and file; only the managed value counts', async () => {
  const managed = manifest([URL_REF, true]);
  const local = { settings: U('settings'), env: { [URL_REF]: U('env') }, file: U('file') };
  assert.equal((await resolveUrl({ ...local, credential: U('managed'), managed })).value, U('managed'));
  // Locked but no managed value stored yet: local values are still ignored; the built-in default stands.
  assert.deepEqual(await resolveUrl({ ...local, managed }), { value: null, source: 'default', locked: true });
  // An invalid managed value is skipped rather than trusted, and local values stay ignored.
  assert.equal((await resolveUrl({ ...local, credential: 'http://insecure.example.com', managed })).value, null);
});

test('legacy aliases (EMBEDDING_* / CPA_EMBED_*): the primary name wins, a legacy name is consulted only when unset', () => {
  const store = new Map([['CPA_EMBED_MODEL', 'legacy-model']]);
  const r = resolveIntegrations({ root: '/nonexistent', env: {}, credentials: store, settings: {} });
  assert.deepEqual([r.effective.embeddings.model, r.sources.embeddings.model], ['legacy-model', 'credential:CPA_EMBED_MODEL']);
  store.set('EMBEDDING_MODEL', 'primary-model');
  assert.equal(resolveIntegrations({ root: '/nonexistent', env: {}, credentials: store, settings: {} }).effective.embeddings.model, 'primary-model');
  const locked = resolveIntegrations({ root: '/nonexistent', env: { EMBEDDING_MODEL: 'env-model' }, credentials: store, settings: { embeddings: { model: 'form-model' } }, managed: manifest(['EMBEDDING_MODEL', true]) });
  assert.deepEqual([locked.effective.embeddings.model, locked.sources.embeddings.model], ['primary-model', 'managed-locked']);
});

test('keys: presence and source only, locked managed keys ignore the environment, nothing leaks', async () => {
  const secret = 'sk-test-value-123';
  const store = new Map([['TAVILY_API_KEY', secret]]);
  const env = { TAVILY_API_KEY: 'env-should-lose' };
  const lockedKey = resolveIntegrations({ root: '/nonexistent', env, credentials: store, settings: {}, managed: { revision: 1, entries: new Map([['TAVILY_API_KEY', { locked: true, secret: true }]]) } });
  assert.equal(keyOf('search', lockedKey) ?? 'none', 'none'); // the search section key is OMNI_SEARCH_API_KEY, not Tavily
  assert.equal(lockedKey.keys.search.engines.tavily.present, true);
  assert.equal(lockedKey.keys.search.engines.tavily.source, 'managed-locked');
  assert.equal(lockedKey.keys.search.engines.tavily.locked, true);
  const open = resolveIntegrations({ root: '/nonexistent', env, credentials: store, settings: {} });
  assert.equal(open.keys.search.engines.tavily.source, 'credential');
  const envOnly = resolveIntegrations({ root: '/nonexistent', env, credentials: new Map(), settings: {} });
  assert.equal(envOnly.keys.search.engines.tavily.source, 'env');
  const unlocked = resolveIntegrations({ root: '/nonexistent', env, credentials: store, settings: {}, managed: { revision: 1, entries: new Map([['TAVILY_API_KEY', { locked: false, secret: true }]]) } });
  assert.equal(unlocked.keys.search.engines.tavily.source, 'env', 'a local env key beats an unlocked managed default');
  for (const view of [describeIntegrations(lockedKey), await keyPresence(lockedKey)]) assert.ok(!JSON.stringify(view).includes(secret) && !JSON.stringify(view).includes('env-should-lose'));
  assert.equal(JSON.stringify(lockedKey).includes(secret), false, 'the store and manifest are non-enumerable');
});

test('backward compatible: legacy sources strings and the settings reader still work, and the real-environment path is unchanged', () => {
  const r = resolveIntegrations({ root: '/nonexistent', env: { SEARXNG_URL: U('env') } });
  assert.equal(r.sources.search.searxngUrl, 'env:SEARXNG_URL');
  assert.equal(r.sources.search.engines, 'default');
  assert.deepEqual(Object.keys(r).sort(), ['effective', 'fileLayer', 'keys', 'locked', 'revision', 'sources']);
});

test('useCredentials binds the resolver and the manifest reader; unbinding clears both', async () => {
  const service = {
    resolve: async name => (name === 'SEARXNG_URL' ? U('managed') : undefined),
    readRecord: async key => (key === 'mothership-connector/managed-config' ? { kind: 'grant', payload: { revision: 3, entries: [{ ref: 'SEARXNG_URL', locked: true, secret: false }] } } : undefined),
  };
  useCredentials(service);
  try {
    await refreshCredentials(resolveIntegrations({ root: '/nonexistent', env: process.env }));
    const r = resolveIntegrations({ root: '/nonexistent', env: process.env });
    assert.deepEqual([r.effective.search.searxngUrl, r.sources.search.searxngUrl], [U('managed'), 'managed-locked']);
  } finally { useCredentials(null); setCredentialResolver(null); setManagedReader(null); }
  assert.notEqual(resolveIntegrations({ root: '/nonexistent', env: process.env }).sources.search.searxngUrl, 'managed-locked');
});

test('resolveRef (single named setting): locked beats credential and env, unlocked sits below them', () => {
  const credential = name => ({ AUTOCOMPLETE_MODEL: 'cred-model' })[name];
  const env = { AUTOCOMPLETE_MODEL: 'env-model' };
  assert.deepEqual(resolveRef('AUTOCOMPLETE_MODEL', { manifest: manifest(['AUTOCOMPLETE_MODEL', true]), credential, env }), { value: 'cred-model', source: 'managed-locked', locked: true });
  assert.deepEqual(resolveRef('AUTOCOMPLETE_MODEL', { manifest: manifest(['AUTOCOMPLETE_MODEL', false]), credential, env }), { value: 'env-model', source: 'env', locked: false });
  assert.deepEqual(resolveRef('AUTOCOMPLETE_MODEL', { manifest: manifest(['AUTOCOMPLETE_MODEL', false]), credential, env: {} }), { value: 'cred-model', source: 'managed-default', locked: false });
  assert.deepEqual(resolveRef('AUTOCOMPLETE_MODEL', { credential, env: {} }), { value: 'cred-model', source: 'credential', locked: false });
  assert.deepEqual(resolveRef('AUTOCOMPLETE_MODEL', { env: {} }), { value: undefined, source: 'default', locked: false });
});
