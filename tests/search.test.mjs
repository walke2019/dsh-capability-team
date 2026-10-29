import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestBody, gateway, gatewayBase } from '../search.js';
const base = 'https://gateway.example.com';
test('默认自动轮询，不发送provider', () => assert.deepEqual(requestBody('search', { query: '文档' }), { query: '文档', max_results: 5, search_type: 'web' }));
test('无密钥明确失败', async () => assert.rejects(gateway('search', { query: 'test' }, { key: '', base }), /CPA_SEARCH_API_KEY/));
test('无网关地址明确失败，不使用内置地址', async () => assert.rejects(gateway('search', { query: 'test' }, { key: 'test-only', base: '' }), /CPA_SEARCH_BASE_URL/));
test('网关地址只接受不含凭据的 https', () => {
  assert.equal(gatewayBase('https://gateway.example.com/api/'), 'https://gateway.example.com/api');
  for (const raw of ['http://gateway.example.com', 'https://u:p@gateway.example.com', 'https://gateway.example.com/?k=1', 'not a url']) assert.throws(() => gatewayBase(raw), /CPA_SEARCH_BASE_URL/);
});
test('鉴权UA超时与JSON回传', async () => {
  const result = await gateway('search', { query: '文档', provider: 'duckduckgo-free' }, { key: 'test-only', base, fetcher: async (url, opts) => {
    assert.equal(url, 'https://gateway.example.com/v1/search'); assert.equal(opts.headers.Authorization, 'Bearer test-only'); assert.ok(opts.headers['User-Agent']); assert.equal(opts.redirect, 'error'); assert.ok(opts.signal);
    return new Response(JSON.stringify({ results: [{ title: '示例', url: 'https://example.com' }] }));
  } }); assert.equal(result.results.length, 1);
});
test('错误不回显上游正文与密钥', async () => assert.rejects(gateway('search', { query: '文档' }, { key: 'test-only', base, fetcher: async () => new Response('test-only', { status: 403 }) }), /HTTP 403/));
test('拒绝私网凭据和非法渠道', () => {
  for (const url of ['http://127.0.0.1','http://169.254.169.254','http://user:pass@example.com','file:///tmp/test']) assert.throws(() => requestBody('fetch', { url }));
  assert.throws(() => requestBody('search', { query: 'test', provider: 'other' }));
});
