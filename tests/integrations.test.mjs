import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../integrations.js';
test('工具注册；检索权限来自能力配置', async () => {
  const definitions = []; const disposers = [];
  let role = { capability: 'backend', search: false };
  apply({ effect: fn => disposers.push(fn()), tools: { register: tool => { definitions.push(tool); return () => {}; } } }, { resolve: async () => role });
  assert.deepEqual(definitions.map(d => d.name), ['cpa_search', 'cpa_web_fetch', 'capability_free_task']);
  for (const d of definitions) { assert.ok(d.output.schema); assert.equal(typeof d.output.render, 'function'); }
  assert.equal(disposers.length, 3);
  await assert.rejects(definitions[0].execute({ query: 'test' }, { agent: {} }), /未开启检索/);
  role = { capability: 'research', search: true };
  // Search permission passes; the gateway then fails on the missing key without any network call.
  // Without any key the call must fail locally; CPA_API_KEY/CPA_BASE_URL are the fallback, so clear them too.
  const names = ['CPA_SEARCH_API_KEY', 'CPA_API_KEY', 'CPA_BASE_URL'];
  const saved = Object.fromEntries(names.map(n => [n, process.env[n]])); for (const n of names) delete process.env[n];
  try { await assert.rejects(definitions[0].execute({ query: 'test' }, { agent: {} }), err => !/未开启检索/.test(err.message)); }
  finally { for (const n of names) if (saved[n] !== undefined) process.env[n] = saved[n]; }
});

test('搜索网关默认使用 CPA_BASE_URL 的同源地址', async () => {
  const { gatewayBase } = await import('../search.js');
  const names = ['CPA_SEARCH_BASE_URL', 'CPA_BASE_URL'];
  const saved = Object.fromEntries(names.map(n => [n, process.env[n]]));
  try {
    delete process.env.CPA_SEARCH_BASE_URL; process.env.CPA_BASE_URL = 'https://gw.example/gateway/v1';
    assert.equal(gatewayBase(), 'https://gw.example');
    process.env.CPA_SEARCH_BASE_URL = 'https://search.example';
    assert.equal(gatewayBase(), 'https://search.example', '显式设置优先');
  } finally { for (const n of names) if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }
});
