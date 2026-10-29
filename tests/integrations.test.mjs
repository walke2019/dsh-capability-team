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
  const saved = process.env.CPA_SEARCH_API_KEY; delete process.env.CPA_SEARCH_API_KEY;
  try { await assert.rejects(definitions[0].execute({ query: 'test' }, { agent: {} }), err => !/未开启检索/.test(err.message)); }
  finally { if (saved !== undefined) process.env.CPA_SEARCH_API_KEY = saved; }
});
