import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { INTEGRATION_DEFAULTS, describeIntegrations, keyOf, resolveIntegrations, validateIntegrations } from '../integrations-config.js';
import * as configApi from '../integrations-config.js';

const tmp = () => mkdtemp(join(tmpdir(), 'intcfg-'));

test('默认不指向任何网关，也不带任何厂商专用字段', () => {
  assert.equal(INTEGRATION_DEFAULTS.search.baseUrl, null);
  assert.equal(INTEGRATION_DEFAULTS.embeddings.baseUrl, null);
  assert.equal(INTEGRATION_DEFAULTS.embeddings.model, null);
  assert.equal(INTEGRATION_DEFAULTS.embeddings.provider, null);
  assert.deepEqual(INTEGRATION_DEFAULTS.search.headers, {});
});

test('校验：https、路径、环境变量名、请求头；密钥不能放进请求头', () => {
  assert.deepEqual(validateIntegrations({ search: { baseUrl: 'https://gw.example/api/' } }), { search: { baseUrl: 'https://gw.example/api' } });
  assert.throws(() => validateIntegrations({ search: { baseUrl: 'http://gw.example' } }), /https/);
  assert.throws(() => validateIntegrations({ search: { searchPath: 'v1/search' } }), /以 \/ 开头/);
  assert.throws(() => validateIntegrations({ search: { searchPath: '/a/../b' } }), /以 \/ 开头/);
  assert.throws(() => validateIntegrations({ embeddings: { apiKeyEnv: 'sk-123' } }), /环境变量名/);
  assert.throws(() => validateIntegrations({ embeddings: { headers: { Authorization: 'Bearer x' } } }), /apiKeyEnv/);
  assert.throws(() => validateIntegrations({ embeddings: { apiKey: 'x' } }), /不是支持的字段/);
  assert.throws(() => validateIntegrations({ other: {} }), /不支持/);
});

test('只读分层：环境变量 › 用户文件 › 默认值，并标注来源', async () => {
  const root = await tmp();
  {
    await writeFile(join(root, 'integrations.json'), JSON.stringify({ integrations: { embeddings: { model: 'file-model', baseUrl: 'https://file.example' } } }));
    const r = resolveIntegrations({ root, env: { EMBEDDING_BASE_URL: 'https://env.example', EMBEDDING_API_KEY: 'k' } });
    assert.equal(r.effective.embeddings.baseUrl, 'https://env.example');
    assert.equal(r.sources.embeddings.baseUrl, 'env:EMBEDDING_BASE_URL');
    assert.equal(r.effective.embeddings.model, 'file-model');
    assert.equal(r.sources.embeddings.model, 'file');
    assert.equal(r.effective.embeddings.path, '/v1/embeddings');
    assert.equal(r.sources.embeddings.path, 'default');
    assert.equal(r.sources.embeddings.batch, 'default');
    assert.equal(keyOf('embeddings', r), 'k');
    const view = JSON.stringify(describeIntegrations(r));
    assert.ok(!view.includes('"k"') && !view.includes('EMBEDDING_API_KEY":"k'), '描述里没有密钥值');
    assert.equal(describeIntegrations(r).keys.embeddings.present, true);
  }
});

test('嵌入环境变量：EMBEDDING_* 优先，CPA_EMBED_* 仅在主变量未设时兜底', async () => {
  const root = await tmp();
  const legacy = resolveIntegrations({ root, env: { CPA_EMBED_BASE_URL: 'https://old.example', CPA_EMBED_MODEL: 'old-m', CPA_EMBED_DIMENSIONS: '512', CPA_EMBED_API_KEY: 'old-k' } });
  assert.equal(legacy.effective.embeddings.baseUrl, 'https://old.example');
  assert.equal(legacy.sources.embeddings.baseUrl, 'env:CPA_EMBED_BASE_URL');
  assert.equal(legacy.effective.embeddings.model, 'old-m');
  assert.equal(legacy.effective.embeddings.dimensions, 512);
  assert.equal(legacy.effective.embeddings.apiKeyEnv, 'EMBEDDING_API_KEY');
  assert.equal(keyOf('embeddings', legacy), 'old-k', '默认密钥名未设置时回退旧名');
  assert.equal(legacy.keys.embeddings.present, true);
  const both = resolveIntegrations({ root, env: { EMBEDDING_BASE_URL: 'https://new.example', CPA_EMBED_BASE_URL: 'https://old.example', EMBEDDING_MODEL: 'new-m', CPA_EMBED_MODEL: 'old-m', EMBEDDING_DIMENSIONS: '1024', EMBEDDING_API_KEY: 'new-k', CPA_EMBED_API_KEY: 'old-k' } });
  assert.equal(both.effective.embeddings.baseUrl, 'https://new.example');
  assert.equal(both.effective.embeddings.model, 'new-m');
  assert.equal(both.effective.embeddings.dimensions, 1024);
  assert.equal(keyOf('embeddings', both), 'new-k');
  // A custom apiKeyEnv never falls back to the legacy name.
  await writeFile(join(root, 'integrations.json'), JSON.stringify({ integrations: { embeddings: { apiKeyEnv: 'MY_EMBED_KEY' } } }));
  assert.equal(keyOf('embeddings', resolveIntegrations({ root, env: { CPA_EMBED_API_KEY: 'old-k' } })), undefined);
});

test('MEMORY_BACKENDS 列表校验 memory.backend', () => {
  assert.deepEqual([...configApi.MEMORY_BACKENDS], ['local', 'openviking']);
  assert.equal(validateIntegrations({ memory: { backend: 'openviking' } }).memory.backend, 'openviking');
  assert.throws(() => validateIntegrations({ memory: { backend: 'mem0' } }), /local 或 openviking/);
});

test('memory.sharedRecall：默认 current，可由文件或 MEMORY_SHARED_RECALL 设置，非法值被忽略', async () => {
  const root = await tmp();
  assert.equal(resolveIntegrations({ root, env: {} }).effective.memory.sharedRecall, 'current');
  assert.throws(() => validateIntegrations({ memory: { sharedRecall: 'all' } }), /current 或 none/);
  await writeFile(join(root, 'integrations.json'), JSON.stringify({ integrations: { memory: { sharedRecall: 'none' } } }));
  const file = resolveIntegrations({ root, env: {} });
  assert.equal(file.effective.memory.sharedRecall, 'none'); assert.equal(file.sources.memory.sharedRecall, 'file');
  const env = resolveIntegrations({ root, env: { MEMORY_SHARED_RECALL: 'current' } });
  assert.equal(env.effective.memory.sharedRecall, 'current'); assert.equal(env.sources.memory.sharedRecall, 'env:MEMORY_SHARED_RECALL');
  assert.equal(resolveIntegrations({ root, env: { MEMORY_SHARED_RECALL: 'everything' } }).effective.memory.sharedRecall, 'none');
  assert.ok(configApi.overrideNames().includes('MEMORY_SHARED_RECALL'));
});

test('搜索引擎配置：引擎列表、SearXNG 地址、各引擎密钥名', async () => {
  assert.deepEqual(validateIntegrations({ search: { engines: ['brave', 'tavily', 'brave'] } }).search.engines, ['brave', 'tavily']);
  assert.throws(() => validateIntegrations({ search: { engines: ['google'] } }), /tavily/);
  assert.throws(() => validateIntegrations({ search: { engines: [] } }), /非空/);
  assert.throws(() => validateIntegrations({ search: { fetchEngines: ['brave'] } }), /jina/);
  assert.equal(validateIntegrations({ search: { searxngUrl: 'http://127.0.0.1:8888/' } }).search.searxngUrl, 'http://127.0.0.1:8888');
  assert.throws(() => validateIntegrations({ search: { searxngUrl: 'http://searx.example.com' } }), /https/);
  assert.throws(() => validateIntegrations({ search: { braveKeyEnv: 'bad key' } }), /环境变量名/);
  const root = await tmp();
  const r = resolveIntegrations({ root, env: { SEARXNG_URL: 'https://searx.example.com', TAVILY_API_KEY: 't', OMNI_SEARCH_BASE_URL: 'https://gateway.example.com', OMNI_SEARCH_API_KEY: 'c' } });
  assert.equal(r.effective.search.searxngUrl, 'https://searx.example.com');
  assert.equal(r.effective.search.baseUrl, 'https://gateway.example.com');
  assert.equal(configApi.engineKeyOf('tavily', r), 't');
  assert.equal(configApi.engineKeyOf('brave', r), undefined);
  assert.equal(configApi.engineKeyOf('custom', r), 'c');
  assert.equal(r.keys.search.engines.tavily.present, true);
  assert.deepEqual(configApi.knownSecretValues(r).sort(), ['c', 't']);
  assert.ok(!JSON.stringify(describeIntegrations(r)).includes('"t"'));
});

test('DSH 凭据库对每个引擎密钥名和嵌入旧名都生效', async t => {
  const root = await tmp();
  const asked = [];
  t.after(() => configApi.setCredentialResolver(undefined));
  configApi.setCredentialResolver(async name => { asked.push(name); return { TAVILY_API_KEY: 'st', BRAVE_API_KEY: 'sb', JINA_API_KEY: 'sj', CPA_EMBED_API_KEY: 'se' }[name]; });
  const r = resolveIntegrations({ root, env: process.env });
  await configApi.refreshCredentials(r);
  for (const name of ['OMNI_SEARCH_API_KEY', 'TAVILY_API_KEY', 'BRAVE_API_KEY', 'SEARXNG_API_KEY', 'JINA_API_KEY', 'EMBEDDING_API_KEY', 'CPA_EMBED_API_KEY', 'OMNI_AUDIO_API_KEY', 'OPENVIKING_API_KEY']) assert.ok(asked.includes(name), name);
  assert.equal(configApi.engineKeyOf('tavily', r), 'st');
  assert.equal(configApi.engineKeyOf('brave', r), 'sb');
  assert.equal(configApi.engineKeyOf('jina', r), 'sj');
  if (!process.env.EMBEDDING_API_KEY) assert.equal(keyOf('embeddings', r), 'se');
  const presence = await configApi.keyPresence(r);
  assert.equal(presence.search.engines.brave.present, true);
  assert.ok(!JSON.stringify(presence).includes('"sb"'));
});

test('覆盖项环境变量：引擎列表用逗号分隔，非法值被忽略', async () => {
  const root = await tmp();
  const r = resolveIntegrations({ root, env: { OMNI_SEARCH_ENGINES: 'brave, custom', OMNI_FETCH_ENGINES: 'tavily,jina', OMNI_SEARCH_PROVIDERS_PATH: '/v1/providers', MEMORY_BACKEND: 'openviking' } });
  assert.deepEqual(r.effective.search.engines, ['brave', 'custom']);
  assert.equal(r.sources.search.engines, 'env:OMNI_SEARCH_ENGINES');
  assert.deepEqual(r.effective.search.fetchEngines, ['tavily', 'jina']);
  assert.equal(r.effective.search.providersPath, '/v1/providers');
  assert.equal(r.effective.memory.backend, 'openviking');
  const bad = resolveIntegrations({ root, env: { OMNI_SEARCH_ENGINES: 'google', MEMORY_BACKEND: 'mem0', OMNI_SEARCH_PROVIDERS_PATH: 'x' } });
  assert.equal(bad.effective.search.engines, null);
  assert.equal(bad.effective.memory.backend, 'local');
  assert.equal(bad.effective.search.providersPath, null);
  for (const name of ['OMNI_SEARCH_ENGINES', 'OMNI_FETCH_ENGINES', 'OMNI_SEARCH_PROVIDERS_PATH', 'MEMORY_BACKEND', 'OMNI_SEARCH_BASE_URL', 'SEARXNG_URL', 'EMBEDDING_MODEL', 'CPA_EMBED_MODEL', 'OMNI_AUDIO_BASE_URL', 'OPENVIKING_URL']) assert.ok(configApi.overrideNames().includes(name), name);
});

test('覆盖项也从同名 DSH 凭据读取：凭据优先于环境变量，来源标为 credential:<名>', async t => {
  const root = await tmp();
  const saved = { home: process.env.CAPABILITY_TEAM_HOME, model: process.env.EMBEDDING_MODEL, url: process.env.OMNI_SEARCH_BASE_URL };
  process.env.CAPABILITY_TEAM_HOME = root;
  process.env.EMBEDDING_MODEL = 'env-model';
  delete process.env.OMNI_SEARCH_BASE_URL;
  t.after(() => {
    configApi.setCredentialResolver(undefined);
    for (const [k, name] of [['home', 'CAPABILITY_TEAM_HOME'], ['model', 'EMBEDDING_MODEL'], ['url', 'OMNI_SEARCH_BASE_URL']]) if (saved[k] === undefined) delete process.env[name]; else process.env[name] = saved[k];
  });
  const store = { EMBEDDING_MODEL: 'cred-model', CPA_EMBED_DIMENSIONS: '256', MEMORY_BACKEND: 'openviking', OPENVIKING_URL: 'https://memory.example.com', OMNI_SEARCH_ENGINES: 'custom', OMNI_SEARCH_BASE_URL: 'https://gateway.example.com', OMNI_FETCH_ENGINES: 'bogus' };
  const asked = [];
  configApi.setCredentialResolver(async name => { asked.push(name); return store[name] ? { value: store[name], source: 'file' } : undefined; });
  await configApi.refreshCredentials();
  for (const name of configApi.overrideNames()) assert.ok(asked.includes(name), name);
  const r = resolveIntegrations();
  assert.equal(r.effective.embeddings.model, 'cred-model');
  assert.equal(r.sources.embeddings.model, 'credential:EMBEDDING_MODEL');
  if (!process.env.EMBEDDING_DIMENSIONS) assert.equal(r.sources.embeddings.dimensions, 'credential:CPA_EMBED_DIMENSIONS');
  assert.equal(r.effective.memory.backend, 'openviking');
  assert.equal(r.effective.memory.url, 'https://memory.example.com');
  assert.deepEqual(r.effective.search.engines, ['custom']);
  assert.equal(r.effective.search.baseUrl, 'https://gateway.example.com');
  assert.deepEqual(r.effective.search.fetchEngines, ['jina'], '非法凭据值被忽略');
  // An explicit env (tests, diagnostics) never sees the store.
  assert.equal(resolveIntegrations({ root, env: {} }).effective.memory.backend, 'local');
  // A credential removed from the store falls back to the environment.
  delete store.EMBEDDING_MODEL;
  await configApi.refreshCredentials();
  assert.equal(resolveIntegrations().sources.embeddings.model, 'env:EMBEDDING_MODEL');
});

test('不再识别 CPA_SEARCH_* / CPA_AUDIO_* 环境变量', async () => {
  const root = await tmp();
  const r = resolveIntegrations({ root, env: { CPA_SEARCH_BASE_URL: 'https://a.example', CPA_AUDIO_BASE_URL: 'https://b.example', CPA_SEARCH_API_KEY: 'x', CPA_AUDIO_API_KEY: 'y' } });
  assert.equal(r.effective.search.baseUrl, null);
  assert.equal(r.effective.audio.baseUrl, null);
  assert.equal(keyOf('search', r), undefined);
  assert.equal(keyOf('audio', r), undefined);
});

test('产品无配置写入、HTTP或插件层接口', () => {
  for (const name of ['saveIntegrations','handleIntegrations','applyIntegrationsApi','setPluginIntegrations']) assert.equal(configApi[name], undefined);
});