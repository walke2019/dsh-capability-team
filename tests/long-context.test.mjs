import test from 'node:test';
import assert from 'node:assert/strict';
import { createLongContext, promptTokens } from '../long-context.js';
import { effectiveConfig, resolveRole } from '../config.js';
import { applyModelPolicy } from '../model-policy.js';
import { changedRoutes } from '../allocation.js';
const tiers = { upper: ['main', 'wide', 'other'] };
const capability = { provider: 'a', model: 'main', tier: 'upper', fallbacks: [{ provider: 'b', model: 'other' }] };
const config = longContext => effectiveConfig({ tiers, capabilities: { backend: { ...capability, longContext } } });
const role = longContext => resolveRole({ role: 'teammate', name: 'lv-bu' }, config(longContext));
test('配置：只允许同档、不同于主模型，阈值有上下限，null 取消', () => {
  assert.deepEqual(role({ thresholdTokens: 100000, provider: 'c', model: 'wide' }).longContext, { thresholdTokens: 100000, provider: 'c', model: 'wide' });
  assert.throws(() => config({ thresholdTokens: 100000, provider: 'c', model: 'nope' }), /不在同一档位/);
  assert.throws(() => config({ thresholdTokens: 100000, provider: 'a', model: 'main' }), /不能与主模型相同/);
  assert.throws(() => config({ thresholdTokens: 10, provider: 'c', model: 'wide' }), /thresholdTokens/);
  assert.equal(role(null).longContext, undefined);
});
test('达到阈值切到长上下文路由，降到八成以下才切回；原主模型保留为备选', () => {
  const lc = createLongContext(); const session = {};
  const r = role({ thresholdTokens: 100000, provider: 'c', model: 'wide' });
  assert.equal(lc.apply(session, r, 99999).model, 'main');
  const on = lc.apply(session, r, 100000);
  assert.equal(`${on.provider}/${on.model}`, 'c/wide');
  assert.deepEqual(on.fallbacks.map(f => f.model), ['main', 'other']);
  assert.equal(lc.apply(session, r, 85000).model, 'wide'); // hysteresis keeps it
  assert.equal(lc.apply(session, r, 79999).model, 'main');
  assert.equal(lc.apply({}, r, undefined).model, 'main'); // no projection: unchanged
});
test('全局禁用长上下文模型时忽略该路由；新路由纳入保存前的目录核对', () => {
  const r = role({ thresholdTokens: 100000, provider: 'c', model: 'wide' });
  assert.equal(applyModelPolicy(r, ['c/*']).longContext, undefined);
  assert.ok(applyModelPolicy(r, ['b/other']).longContext);
  const before = config(undefined); const after = config({ thresholdTokens: 100000, provider: 'c', model: 'wide' });
  assert.deepEqual(changedRoutes(before, after).map(x => `${x.provider}/${x.model}`), ['c/wide']);
});
test('提示词规模按 contextPressure 视图同样的方式计算', () => {
  const at = state => promptTokens({ stateOf: () => state }, {});
  assert.equal(at({ pressureTokens: 1000, surfaceTokens: 1500, sampledSurfaceTokens: 1200 }), 1300);
  assert.equal(at({ surfaceTokens: 700 }), 700);
  assert.equal(at(undefined), undefined);
  assert.equal(promptTokens({ stateOf: () => { throw new Error('no key'); } }, {}), undefined);
});
