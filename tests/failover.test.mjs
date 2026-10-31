import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFailover } from '../failover.js';
import { effectiveConfig, seed } from '../config.js';
// Neutral fixed tiers so failover behavior is tested independently of auto-matching.
const fixed = { ...seed, tiers: { ...seed.tiers, upper: ['gpt-6.1-sol', 'claude-opus-4-8', 'sol-mirror'], low: ['gpt-6-luna'] },
  capabilities: { ...seed.capabilities, qa: { ...seed.capabilities.qa, provider: 'win', model: 'gpt-6.1-sol' } } };
import { apply } from '../roles.js';
const config = effectiveConfig({
  capabilities: { qa: { fallbacks: [{ provider: 'provider-a', model: 'gpt-6.1-sol' }, { provider: 'win', model: 'claude-opus-4-8' }] } },
}, fixed);
const role = { provider: 'win', model: 'gpt-6.1-sol', fallbacks: config.capabilities.qa.fallbacks, failover: config.failover };
const fail = (code, status) => ({ code, status, message: `${code} failed` });
function harness(opts = {}) {
  let clock = 0; const waits = [];
  const f = createFailover({ now: () => clock, sleep: async ms => { waits.push(ms); return true; }, ...opts });
  return { f, waits, advance: ms => { clock += ms; } };
}
test('同一模型先按退避多次重试，不会一次失败就切换', async () => {
  const { f, waits } = harness(); const agent = {};
  assert.equal(f.route(agent, 1, 1, role).model, 'gpt-6.1-sol');
  assert.equal(await f.recover(agent, fail('SERVER', 502)), true);
  assert.equal(await f.recover(agent, fail('SERVER', 502)), true);
  assert.deepEqual(waits, [1000, 2000]); // exponential backoff
  assert.deepEqual(f.route(agent, 1, 1, role), { provider: 'win', model: 'gpt-6.1-sol', primary: true, index: 0 });
  assert.equal(await f.recover(agent, fail('SERVER', 502)), true); // retries exhausted → failover
  assert.deepEqual(f.route(agent, 1, 1, role), { provider: 'provider-a', model: 'gpt-6.1-sol', primary: false, index: 1 });
});
test('按顺序切换同档备选，全部失败后报告而不降档', async () => {
  const { f } = harness(); const agent = {};
  f.route(agent, 1, 1, role);
  for (const expected of ['provider-a/gpt-6.1-sol', 'win/claude-opus-4-8']) {
    for (let i = 0; i < 2; i++) await f.recover(agent, fail('TIMEOUT'));
    assert.equal(await f.recover(agent, fail('TIMEOUT')), true);
    assert.equal(`${f.route(agent, 1, 1, role).provider}/${f.route(agent, 1, 1, role).model}`, expected);
  }
  for (let i = 0; i < 2; i++) await f.recover(agent, fail('TIMEOUT'));
  assert.equal(await f.recover(agent, fail('TIMEOUT')), false);
  assert.equal(f.status(agent).failed.length, 3);
});
test('凭据或额度错误不在同一渠道重复重试，直接切换', async () => {
  const { f, waits } = harness(); const agent = {};
  f.route(agent, 1, 1, role);
  assert.equal(await f.recover(agent, fail('QUOTA', 402)), true);
  assert.equal(waits.length, 0);
  assert.equal(f.route(agent, 1, 1, role).provider, 'provider-a');
});
test('上下文超长、内容拒绝等非可用性错误不切换', async () => {
  const { f } = harness(); const agent = {};
  f.route(agent, 1, 1, role);
  assert.equal(await f.recover(agent, fail('CONTEXT_WINDOW_EXCEEDED', 400)), false);
  assert.equal(f.route(agent, 1, 1, role).primary, true);
});
test('故障模型短暂冷却，冷却结束自动回到主模型', async () => {
  const { f, advance } = harness(); const agent = {};
  f.route(agent, 1, 1, role);
  for (let i = 0; i < 3; i++) await f.recover(agent, fail('SERVER'));
  assert.equal(f.route(agent, 1, 2, role).provider, 'provider-a'); // next step skips the cooling primary
  advance(config.failover.cooldownMs + 1);
  assert.equal(f.route(agent, 1, 3, role).primary, true);
});
test('未注册渠道的备选被跳过', async () => {
  const { f } = harness({ registered: p => p !== 'provider-a' }); const agent = {};
  f.route(agent, 1, 1, role);
  assert.equal(await f.recover(agent, fail('QUOTA')), true);
  assert.equal(f.route(agent, 1, 1, role).model, 'claude-opus-4-8');
});
test('备选必须同档位且不重复，策略可配置', () => {
  assert.throws(() => effectiveConfig({ capabilities: { qa: { fallbacks: [{ provider: 'provider-a', model: 'gpt-6-luna' }] } } }, fixed), /同一档位/);
  assert.throws(() => effectiveConfig({ capabilities: { qa: { fallbacks: [{ provider: 'win', model: 'gpt-6.1-sol' }] } } }, fixed), /重复/);
  assert.throws(() => effectiveConfig({ failover: { retries: 99 } }, fixed), /追加重试/);
  assert.equal(effectiveConfig({ failover: { retries: 4, cooldownMs: 30000 } }, fixed).failover.retries, 4);
});
test('DSH自带重试优先，之后由容灾层接管并改写下一次请求', async () => {
  const listeners = {};
  const ctx = { effect: fn => fn(), systemPrompt: { section: () => () => {} }, on: (e, fn) => { listeners[e] = fn; } };
  const resolved = { ...role, capability: 'qa' };
  const team = { owns: () => true, resolve: async () => resolved };
  const f = createFailover({ sleep: async () => true });
  apply(ctx, team, f);
  const agent = {}; const signal = new AbortController().signal;
  const request = () => listeners['agent/request']({ agent, turn: 1, step: 1 }, async () => ({ provider: 'x', model: 'y', reasoningEffort: 'high' }));
  assert.deepEqual(await request(), { provider: 'win', model: 'gpt-6.1-sol' });
  assert.deepEqual(await listeners['agent/request-error']({ agent, failure: fail('SERVER'), signal }, async () => ({ kind: 'retry' })), { kind: 'retry' });
  assert.equal(f.status(agent).active, 'win/gpt-6.1-sol'); // DSH retry did not consume ours
  for (let i = 0; i < 3; i++) assert.deepEqual(await listeners['agent/request-error']({ agent, failure: fail('SERVER'), signal }, async () => undefined), { kind: 'retry' });
  assert.deepEqual(await request(), { provider: 'provider-a', model: 'gpt-6.1-sol' });
});
test('同一模型反复失败时冷却逐次加倍（上限 30 分钟），长时间无故障后重新计数', async () => {
  const { escalatedCooldown, MAX_COOLDOWN_MS } = await import('../failover.js');
  assert.deepEqual([1, 2, 3, 4].map(n => escalatedCooldown(60000, n)), [60000, 120000, 240000, 480000]);
  assert.equal(escalatedCooldown(60000, 20), MAX_COOLDOWN_MS);
  const { f, advance } = harness(); const base = config.failover.cooldownMs;
  const outage = async step => { const agent = {}; f.route(agent, 1, step, role); for (let i = 0; i < 3; i++) await f.recover(agent, fail('SERVER', 502)); };
  await outage(1);
  assert.equal(f.health()['win/gpt-6.1-sol'].strikes, 1);
  advance(base + 1);                                    // first cooldown over → primary is tried again
  assert.equal(f.route({}, 1, 2, role).primary, true);
  await outage(3);                                      // and fails again right away
  assert.equal(f.health()['win/gpt-6.1-sol'].strikes, 2);
  advance(base + 1);
  assert.equal(f.route({}, 1, 4, role).primary, false, '第二次冷却是 2 倍，过了 1 倍时间还在冷却');
  advance(base);
  assert.equal(f.route({}, 1, 5, role).primary, true);
  advance(20 * base);                                   // a long quiet spell
  await outage(6);
  assert.equal(f.health()['win/gpt-6.1-sol'].strikes, 1, '长时间无故障后重新从 1 开始');
});
test('凭据错误（AUTH / 消息里的 401）不重试同一渠道，但继续切到下一个备选', async () => {
  const { f } = harness(); const agent = {};
  f.route(agent, 1, 1, role);
  assert.equal(await f.recover(agent, { code: 'AUTH', message: '401 {"detail":"Invalid API key"}' }), true);
  assert.equal(f.route(agent, 1, 1, role).provider, 'provider-a', '直接切走，不在 win 上重试');
  assert.equal(await f.recover(agent, { code: 'WEIRD', message: '403 forbidden' }), true, '状态码只在消息里也能识别');
});
