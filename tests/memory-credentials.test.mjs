import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmbedder } from '../memory-embed.js';
import { createMemoryBackend } from '../memory-backends.js';
import { setCredentialResolver } from '../integrations-config.js';

const NAMES = ['CAPABILITY_TEAM_HOME', 'EMBEDDING_BASE_URL', 'EMBEDDING_API_KEY', 'EMBEDDING_MODEL', 'EMBEDDING_DIMENSIONS', 'CPA_EMBED_BASE_URL', 'CPA_EMBED_API_KEY', 'CPA_EMBED_MODEL', 'CPA_EMBED_DIMENSIONS', 'MEMORY_BACKEND', 'OPENVIKING_URL', 'OPENVIKING_API_KEY'];
// Zero local config: an empty home and no related environment, so every setting must come from the store.
async function isolated(t, store) {
  const root = await mkdtemp(join(tmpdir(), 'memcred-'));
  const saved = Object.fromEntries(NAMES.map(name => [name, process.env[name]]));
  for (const name of NAMES) delete process.env[name];
  process.env.CAPABILITY_TEAM_HOME = root;
  setCredentialResolver(async name => (store[name] ? { value: store[name], source: 'file' } : undefined));
  t.after(async () => {
    setCredentialResolver(undefined);
    for (const name of NAMES) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test('嵌入器从同名 DSH 凭据读取 EMBEDDING_* 设置与密钥（零本地配置）', async t => {
  await isolated(t, { EMBEDDING_BASE_URL: 'https://embed.example.com', EMBEDDING_API_KEY: 'cred-embed-key', EMBEDDING_MODEL: 'cred-model', EMBEDDING_DIMENSIONS: '3' });
  const calls = [];
  const embedder = createEmbedder({ fetcher: async (url, init) => {
    calls.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) });
    return Response.json({ data: [{ index: 0, embedding: [1, 0, 0] }] });
  } });
  const out = await embedder.embed(['hello'], 'passage');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://embed.example.com/v1/embeddings');
  assert.equal(calls[0].auth, 'Bearer cred-embed-key');
  assert.equal(calls[0].body.model, 'cred-model');
  assert.equal(calls[0].body.dimensions, 3);
  assert.equal(out.model, 'cred-model@3');
  assert.equal(embedder.available, true);
});

test('MEMORY_BACKEND / OPENVIKING_URL 凭据选中 openviking 后端', async t => {
  const root = await isolated(t, { MEMORY_BACKEND: 'openviking', OPENVIKING_URL: 'https://memory.example.com', OPENVIKING_API_KEY: 'cred-ov-key' });
  const { refreshCredentials } = await import('../integrations-config.js');
  const lazy = createMemoryBackend({ lazy: true, queuePath: name => join(root, `${name}-queue.json`), schedule: () => null });
  assert.equal(lazy.name, 'local', '刷新前没有本地配置');
  await refreshCredentials();
  const seen = [];
  const backend = createMemoryBackend({ queuePath: name => join(root, `${name}-q.json`), schedule: () => null, fetcher: async (url, init) => {
    seen.push({ url, key: init.headers['X-API-Key'] });
    return Response.json({ status: 'ok', result: { memories: [] } });
  } });
  assert.equal(backend.name, 'openviking');
  assert.equal(backend.enabled, true);
  assert.equal(lazy.name, 'openviking', '同一实例在凭据到达后切换');
  await backend.recall('probe', 2);
  assert.ok(seen.length >= 1);
  assert.ok(seen[0].url.startsWith('https://memory.example.com/api/v1'));
  assert.equal(seen[0].key, 'cred-ov-key');
});
