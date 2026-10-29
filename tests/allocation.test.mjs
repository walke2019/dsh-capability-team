import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelCatalog, changedRoutes, verifyRoutes, allocatedRequest } from '../allocation.js';
import { effectiveConfig } from '../config.js';
import { base } from './fixture.mjs';
test('目录按项目档位标注，读取失败的渠道单独报告', async () => {
  const catalog = await modelCatalog({
    listProviders: () => [{ id: 'ok', name: 'OK' }, { id: 'down', name: 'Down' }],
    listModels: async id => { if (id === 'down') throw new Error('x'); return [{ id: 'm1', name: 'M1' }, { id: 'm2', name: 'M2' }]; },
  }, { fast: ['m1'] });
  assert.deepEqual(catalog.entries.map(e => e.tiers), [['fast'], []]);
  assert.equal(catalog.errors[0].provider, 'down');
});
test('只校验发生变化的路由', () => {
  const before = effectiveConfig({}, base);
  const after = effectiveConfig({ capabilities: { qa: { model: 'claude-sonnet-5-5', fallbacks: [] } } }, base);
  const routes = changedRoutes(before, after);
  assert.deepEqual(routes.map(r => r.capability), ['qa']);
  assert.throws(() => verifyRoutes(routes, { entries: [] }), /不在当前DSH模型目录/);
  verifyRoutes(routes, { entries: [{ provider: base.capabilities.qa.provider, model: 'claude-sonnet-5-5' }] });
});
test('请求只替换渠道与模型，丢弃模型专属参数', () => {
  assert.deepEqual(allocatedRequest({ provider: 'a', model: 'b', reasoningEffort: 'max', temperature: 1, keep: 1 }, { provider: 'p', model: 'm' }), { keep: 1, provider: 'p', model: 'm' });
});
