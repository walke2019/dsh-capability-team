import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestBody, gateway, gatewayBase, searchSchemas } from '../search.js';
import { INTEGRATION_DEFAULTS } from '../integrations-config.js';
const base = 'https://gateway.example.com';
// Explicit settings keep these tests independent of the machine's integrations file and environment.
const settings = (extra = {}) => ({ config: { ...INTEGRATION_DEFAULTS.search, baseUrl: base, ...extra }, key: 'test-only', keyEnv: 'OMNI_SEARCH_API_KEY' });
test('默认自动轮询，不发送provider', () => assert.deepEqual(requestBody('search', { query: '文档' }), { query: '文档', max_results: 5, search_type: 'web' }));
test('无密钥明确失败，并说出要设置的变量名', async () => assert.rejects(gateway('search', { query: 'test' }, { settings: { ...settings(), key: undefined, keyEnv: 'MY_GATEWAY_KEY' } }), /MY_GATEWAY_KEY/));
test('无网关地址明确失败，不使用内置地址', async () => assert.rejects(gateway('search', { query: 'test' }, { settings: settings({ baseUrl: null }) }), /search\.baseUrl/));
test('网关地址只接受不含凭据的 https', () => {
  assert.equal(gatewayBase('https://gateway.example.com/api/'), 'https://gateway.example.com/api');
  for (const raw of ['http://gateway.example.com', 'https://u:p@gateway.example.com', 'https://gateway.example.com/?k=1', 'not a url']) assert.throws(() => gatewayBase(raw), /OMNI_SEARCH_BASE_URL/);
  assert.throws(() => gatewayBase(undefined), /gateway URL not configured/);
});
test('路径、附加请求头、鉴权与超时都来自配置', async () => {
  const config = { searchPath: '/api/find', headers: { 'User-Agent': 'Custom/1.0' }, providers: ['duckduckgo-free'] };
  const result = await gateway('search', { query: '文档', provider: 'duckduckgo-free' }, { settings: settings(config), fetcher: async (url, opts) => {
    assert.equal(url, 'https://gateway.example.com/api/find'); assert.equal(opts.headers.Authorization, 'Bearer test-only'); assert.equal(opts.headers['User-Agent'], 'Custom/1.0'); assert.equal(opts.redirect, 'error'); assert.ok(opts.signal);
    return new Response(JSON.stringify({ results: [{ title: '示例', url: 'https://example.com' }] }));
  } }); assert.equal(result.results.length, 1);
});
test('错误不回显上游正文与密钥', async () => assert.rejects(gateway('search', { query: '文档' }, { settings: settings(), fetcher: async () => new Response('test-only', { status: 403 }) }), /HTTP 403/));
test('拒绝私网凭据和非法渠道', () => {
  for (const url of ['http://127.0.0.1','http://169.254.169.254','http://user:pass@example.com','file:///tmp/test']) assert.throws(() => requestBody('fetch', { url }));
  assert.throws(() => requestBody('search', { query: 'test', provider: 'other' }, { ...INTEGRATION_DEFAULTS.search, providers: ['a'] }), /search provider/, '配置了渠道列表时只接受列表内的');
  assert.equal(requestBody('search', { query: 'test', provider: 'other' }).provider, 'other', '未配置列表时交给网关判断');
  assert.throws(() => requestBody('search', { query: 'test', provider: 'bad name' }));
});
test('工具定义的渠道枚举来自配置；只有启用自定义引擎时才有 provider 参数', () => {
  const custom = { ...INTEGRATION_DEFAULTS.search, baseUrl: base };
  assert.deepEqual(searchSchemas({ ...custom, providers: ['x', 'y'] }).omni_search.properties.provider.enum, ['x', 'y']);
  assert.equal(searchSchemas(custom).omni_search.properties.provider.enum, undefined);
  assert.equal(searchSchemas().omni_search.properties.provider, undefined, '默认无自定义网关，不暴露 provider');
  assert.equal(searchSchemas().omni_fetch.properties.provider, undefined, '默认抓取只用 jina');
  assert.equal(searchSchemas({ ...custom, engines: ['tavily'] }).omni_search.properties.provider, undefined, '显式列表不含 custom');
  assert.ok(searchSchemas({ ...INTEGRATION_DEFAULTS.search, fetchEngines: ['custom'] }).omni_fetch.properties.provider);
  assert.equal('omni_search_providers' in searchSchemas({ ...INTEGRATION_DEFAULTS.search, providersPath: '/p' }), false, '没有 custom 引擎不注册渠道工具');
});
