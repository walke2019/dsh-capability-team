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
    const r = resolveIntegrations({ root, env: { CPA_EMBED_BASE_URL: 'https://env.example', CPA_EMBED_API_KEY: 'k' } });
    assert.equal(r.effective.embeddings.baseUrl, 'https://env.example');
    assert.equal(r.sources.embeddings.baseUrl, 'env:CPA_EMBED_BASE_URL');
    assert.equal(r.effective.embeddings.model, 'file-model');
    assert.equal(r.sources.embeddings.model, 'file');
    assert.equal(r.effective.embeddings.path, '/v1/embeddings');
    assert.equal(r.sources.embeddings.path, 'default');
    assert.equal(r.sources.embeddings.batch, 'default');
    assert.equal(keyOf('embeddings', r), 'k');
    const view = JSON.stringify(describeIntegrations(r));
    assert.ok(!view.includes('"k"') && !view.includes('CPA_EMBED_API_KEY":"k'), '描述里没有密钥值');
    assert.equal(describeIntegrations(r).keys.embeddings.present, true);
  }
});

test('产品无配置写入、HTTP或插件层接口', () => {
  for (const name of ['saveIntegrations','handleIntegrations','applyIntegrationsApi','setPluginIntegrations']) assert.equal(configApi[name], undefined);
});