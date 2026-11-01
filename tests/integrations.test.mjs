import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../integrations.js';
test('工具注册；检索权限来自能力配置', async () => {
  const definitions = []; const disposers = [];
  let role = { capability: 'backend', search: false };
  // Isolated from the user's real integrations.json (which may enable the provider and speech tools).
  const home = process.env.CAPABILITY_TEAM_HOME;
  process.env.CAPABILITY_TEAM_HOME = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'int-'));
  try { apply({ effect: fn => disposers.push(fn()), tools: { register: tool => { definitions.push(tool); return () => {}; } } }, { resolve: async () => role }); }
  finally { if (home === undefined) delete process.env.CAPABILITY_TEAM_HOME; else process.env.CAPABILITY_TEAM_HOME = home; }
  assert.deepEqual(definitions.map(d => d.name), ['cpa_search', 'cpa_web_fetch', 'capability_free_task']);
  for (const d of definitions) { assert.ok(d.output.schema); assert.equal(typeof d.output.render, 'function'); }
  assert.equal(disposers.length, 3);
  await assert.rejects(definitions[0].execute({ query: 'test' }, { agent: {} }), /未开启检索/);
  role = { capability: 'research', search: true };
  // Search permission passes; the gateway then fails on the missing configuration without any network call.
  const names = ['CPA_SEARCH_API_KEY', 'CPA_SEARCH_BASE_URL', 'CAPABILITY_TEAM_HOME'];
  const saved = Object.fromEntries(names.map(n => [n, process.env[n]])); for (const n of names) delete process.env[n];
  process.env.CAPABILITY_TEAM_HOME = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'int-'));
  try { await assert.rejects(definitions[0].execute({ query: 'test' }, { agent: {} }), err => !/未开启检索/.test(err.message)); }
  finally { for (const n of names) if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }
});

test('不从 CPA_BASE_URL 猜测搜索网关；CPA_SEARCH_BASE_URL 环境变量覆盖配置', async () => {
  const { searchSettings } = await import('../search.js');
  const { resolveIntegrations } = await import('../integrations-config.js');
  const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'int-'));
  assert.equal(searchSettings(resolveIntegrations({ root, env: { CPA_BASE_URL: 'https://gw.example/gateway/v1', CPA_API_KEY: 'k' } })).config.baseUrl, null);
  const s = searchSettings(resolveIntegrations({ root, env: { CPA_SEARCH_BASE_URL: 'https://search.example', CPA_SEARCH_API_KEY: 'k' } }));
  assert.equal(s.config.baseUrl, 'https://search.example');
  assert.equal(s.key, 'k');
});
