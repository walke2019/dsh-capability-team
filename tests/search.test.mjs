import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestBody, gateway } from '../search.js';
test('默认自动轮询，不发送provider', () => assert.deepEqual(requestBody('search', { query: '文档' }), { query: '文档', max_results: 5, search_type: 'web' }));
test('无密钥明确失败', async () => assert.rejects(gateway('search', { query: 'test' }, { key: '' }), /CPA_SEARCH_API_KEY/));
test('鉴权UA超时与JSON回传', async () => {
  const result = await gateway('search', { query: '文档', provider: 'duckduckgo-free' }, { key: 'test-only', fetcher: async (url, opts) => {
    assert.equal(url, 'https://gateway.example.com/v1/search'); assert.equal(opts.headers.Authorization, 'Bearer test-only'); assert.ok(opts.headers['User-Agent']); assert.equal(opts.redirect, 'error'); assert.ok(opts.signal);
    return new Response(JSON.stringify({ results: [{ title: '示例', url: 'https://example.com' }] }));
  } }); assert.equal(result.results.length, 1);
});
test('错误不回显上游正文与密钥', async () => assert.rejects(gateway('search', { query: '文档' }, { key: 'test-only', fetcher: async () => new Response('test-only', { status: 403 }) }), /HTTP 403/));
test('拒绝私网凭据和非法渠道', () => {
  for (const url of ['http://127.0.0.1','http://169.254.169.254','http://user:pass@example.com','file:///tmp/test']) assert.throws(() => requestBody('fetch', { url }));
  assert.throws(() => requestBody('search', { query: 'test', provider: 'other' }));
});
