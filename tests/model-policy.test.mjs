import test from 'node:test';
import assert from 'node:assert/strict';
import { applyModelPolicy, validateDisabledRoutes, modelPolicyRows, policyRoleView } from '../model-policy.js';
const role = { id: 'backend', tier: 'upper', provider: 'a', model: 'main', fallbacks: [{ provider: 'b', model: 'backup' }, { provider: 'c', model: 'backup' }] };
test('角色预览与请求过滤共用规则，阻止和未分配明确区分', () => {
  const result = modelPolicyRows({}, [role, { id: 'empty' }], ['a/main']);
  assert.equal(result.allocations[0].primary, 'b/backup');
  assert.equal(result.allocations[1].status, 'unassigned');
  const blocked = modelPolicyRows({}, [role], ['a/main', 'b/backup', 'c/backup']);
  assert.equal(blocked.allocations[0].status, 'blocked');
  assert.equal(blocked.allocations[0].primary, null);
});
test('禁用主模型只提升已确认同档备选，并过滤禁用备用', () => {
  const result = applyModelPolicy(role, ['a/main', 'b/backup']);
  assert.equal(result.provider, 'c'); assert.deepEqual(result.fallbacks, []);
  assert.equal(result.tier, 'upper'); assert.equal(role.provider, 'a');
});
test('全部禁用时阻止请求，不沿用或降档', () => {
  assert.throws(() => applyModelPolicy(role, ['a/main', 'b/backup', 'c/backup']), /均已被全局模型策略禁用/);
});
test('禁用使用完整渠道标识，不误禁其他渠道', () => {
  const result = applyModelPolicy(role, ['b/backup']);
  assert.deepEqual(result.fallbacks, [{ provider: 'c', model: 'backup' }]);
});
test('恢复允许列表保留主模型；禁用列表不被修改', () => {
  assert.equal(applyModelPolicy(role, []).provider, 'a');
  assert.deepEqual(validateDisabledRoutes(['b/x', 'b/x', 'a/y']), ['a/y', 'b/x']);
  assert.throws(() => validateDisabledRoutes(['model-only']), /完整/);
});
test('目录中未分配候选及未知模型仍可查看和禁用', () => {
  const { rows } = modelPolicyRows({}, [role], ['p/unused'], [
    { provider: 'p', model: 'unused', tier: 'low' }, 'p/unknown',
    { provider: 'a', model: 'main', tier: 'upper' },
  ]);
  assert.equal(rows.length, 5);
  assert.equal(rows.find(r => r.key === 'p/unused').disabled, true);
  assert.deepEqual(rows.find(r => r.key === 'p/unknown').tiers, []);
  assert.deepEqual(rows.find(r => r.key === 'a/main').primaryFor, ['backend']);
});
test('预检模型按档位和角色归属展示，不冒充实测成功', () => {
  const result = modelPolicyRows({ upper: ['main', 'backup'] }, [role], ['b/backup']);
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows.find(r => r.key === 'b/backup').disabled, true);
  assert.deepEqual(result.rows[0].primaryFor, ['backend']);
  assert.ok(result.rows.every(r => !r.verified));
});

test('前缀规则：校验、同时匹配完整标识与模型ID、跳过被排除的主模型', async () => {
  const { routeMatcher } = await import('../model-policy.js');
  assert.deepEqual(validateDisabledRoutes(['cpa/@cf/*', '@cf/*', 'a/main']), ['@cf/*', 'a/main', 'cpa/@cf/*']);
  for (const bad of ['a*', '*', 'c*p*', 'cpa/ x*', 'no-slash']) assert.throws(() => validateDisabledRoutes([bad]));
  const off = routeMatcher(['@cf/*', 'cpa/or/*']);
  assert.equal(off('cpa/@cf/qwen'), true);
  assert.equal(off('win/@cf/qwen'), true);
  assert.equal(off('cpa/or/qwen'), true);
  assert.equal(off('win/or/qwen'), false);
  assert.equal(off('cpa/qwen'), false);
  const resolved = applyModelPolicy(role, ['a/*']);
  assert.equal(`${resolved.provider}/${resolved.model}`, 'b/backup');
  assert.deepEqual(resolved.policyExcluded, ['a/main']);
  assert.throws(() => applyModelPolicy(role, ['backup*', 'main*']), /均已被全局模型策略禁用/);
  const rows = modelPolicyRows({}, [role], ['c/*'], ['c/other']);
  assert.equal(rows.rows.find(r => r.key === 'c/other').disabled, true);
  assert.deepEqual(rows.disabledRoutes, ['c/*']);
});

test('前缀规则同样作用于自动匹配，不会被选为主模型或备选', async () => {
  const { autoMatch } = await import('../defaults.js');
  const entries = [{ provider: 'relay', model: 'claude-opus-5-5' }, { provider: 'cpa', model: 'claude-opus-5-5' }, { provider: 'cpa', model: 'gpt-6-astra' }];
  const caps = { orchestrator: { tier: 'high', prefer: ['claude'] } };
  const base = autoMatch(entries, caps);
  assert.ok(JSON.stringify(base.routes.orchestrator).includes('relay'));
  const ruled = autoMatch(entries, caps, { disabledRoutes: ['relay/*'] });
  assert.equal(JSON.stringify(ruled.routes.orchestrator).includes('relay'), false);
});
test('角色视图按前缀规则替换显式路由，全部排除时标记阻止', () => {
  const [shown] = policyRoleView([role], ['ma*']);
  assert.equal(`${shown.provider}/${shown.model}`, 'b/backup');
  assert.deepEqual(shown.fallbacks, [{ provider: 'c', model: 'backup' }]);
  const [blocked, empty] = policyRoleView([role, { id: 'empty' }], ['a/*', 'backup*']);
  assert.equal(blocked.provider, undefined); assert.deepEqual(blocked.fallbacks, []);
  assert.match(blocked.blocked, /均已被全局模型策略禁用/);
  assert.equal(empty.blocked, undefined);
});
