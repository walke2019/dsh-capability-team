import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, normalizeModelId, autoMatch } from '../defaults.js';
import { seed, effectiveConfig } from '../config.js';
import { match, base } from './fixture.mjs';
test('网关前缀、日期快照与连字符版本统一归一', () => {
  assert.equal(normalizeModelId('anthropic/claude-opus-4-8'), 'claude-opus-4.8');
  assert.equal(normalizeModelId('bai/claude-haiku-4-5-20251001'), 'claude-haiku-4.5');
  assert.equal(normalizeModelId('pro/deepseek-ai/DeepSeek-V3.2'), 'deepseek-v3.2');
  assert.equal(normalizeModelId('openai/gpt-5.5:free'), 'gpt-5.5');
});
test('按厂商命名规律分档，非对话与免费模型排除，未知模型不猜', () => {
  const tier = id => classify(id)?.tier;
  assert.deepEqual(['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'].map(tier), ['high', 'upper', 'low']);
  assert.deepEqual(['gpt-5.5-pro', 'gpt-5.5', 'gpt-5-mini', 'gpt-5-nano'].map(tier), ['high', 'upper', 'medium', 'low']);
  assert.deepEqual(['gemini-3-pro-preview', 'gemini-3-flash', 'gemini-3-flash-lite'].map(tier), ['high', 'medium', 'low']);
  assert.deepEqual(['deepseek-chat', 'qwen3-max', 'qwen3-30b-a3b', 'kimi-k2', 'glm-4.5-air'].map(tier), ['upper', 'upper', 'low', 'upper', 'medium']);
  assert.equal(tier('claude-3-5-sonnet'), 'medium'); // one generation behind drops a tier
  assert.equal(tier('gpt-3.5-turbo'), undefined); // two generations behind is excluded
  for (const id of ['gpt-image-1', 'text-embedding-3-large', 'tts-1', 'whisper-1', 'llama-4-scout:free', 'house-model-x']) assert.equal(classify(id), undefined, id);
});
test('按能力档位与厂商偏好选主模型，备选同档：同模型他渠道优先，其次异厂商', () => {
  const o = base.capabilities.orchestrator;
  assert.deepEqual([o.provider, o.model, o.tier], ['anthropic', 'claude-opus-4-8', 'high']);
  assert.deepEqual(o.fallbacks, [{ provider: 'relay', model: 'anthropic/claude-opus-4-8' }, { provider: 'openai', model: 'gpt-5.5-pro' }, { provider: 'relay', model: 'google/gemini-3-pro-preview' }]);
  assert.deepEqual([base.capabilities.backend.provider, base.capabilities.backend.model], ['openai', 'gpt-5.5']);
  assert.equal(base.capabilities.frontend.model, 'gemini-3-flash');
  assert.equal(base.capabilities.writer.model, 'gpt-5-nano');
  for (const c of Object.values(base.capabilities)) for (const f of c.fallbacks) assert.ok(base.tiers[c.tier].includes(f.model));
  assert.ok(match.unknown.includes('relay/house-model-x'));
  assert.ok(match.report.every(r => r.status === 'matched'));
});
test('推理强度后缀视为同一模型；旧代模型排在备选末尾', () => {
  const r = autoMatch([
    { provider: 'a', model: 'claude-sonnet-4-6' }, { provider: 'a', model: 'claude-sonnet-4-6-thinking' },
    { provider: 'a', model: 'claude-3-opus' }, { provider: 'b', model: 'deepseek-chat' }, { provider: 'b', model: 'gpt-5.5' },
  ], { backend: { tier: 'upper', prefer: ['claude'] } });
  assert.equal(r.routes.backend.model, 'claude-sonnet-4-6');
  assert.deepEqual(r.routes.backend.fallbacks.map(f => f.model), ['gpt-5.5', 'deepseek-chat', 'claude-3-opus']);
  const old = autoMatch([{ provider: 'a', model: 'claude-3-7-sonnet' }, { provider: 'b', model: 'gpt-5-mini' }], { frontend: { tier: 'medium', prefer: ['claude'] } });
  assert.equal(old.routes.frontend.model, 'gpt-5-mini'); // current generation beats vendor preference
});
test('所需档位缺失时先升档；连更高档也没有才用最强低档并标明', () => {
  const up = autoMatch([{ provider: 'p', model: 'claude-opus-4-8' }], { qa: { tier: 'upper' } });
  assert.equal(up.report[0].status, 'upgraded'); assert.equal(up.routes.qa.tier, 'high');
  const below = autoMatch([{ provider: 'p', model: 'gpt-5-mini' }], { orchestrator: { tier: 'high' } });
  assert.equal(below.report[0].status, 'below-tier'); assert.match(below.report[0].reason, /补充渠道/);
  const none = autoMatch([{ provider: 'p', model: 'house-model-x' }], { qa: { tier: 'upper' } });
  assert.equal(none.report[0].status, 'unassigned'); assert.equal(none.routes.qa, undefined);
});
test('无可识别模型时能力保持未分配，配置仍然有效', () => {
  const e = effectiveConfig({}, seed);
  assert.equal(e.capabilities.qa.provider, undefined);
  assert.throws(() => effectiveConfig({ capabilities: { qa: { fallbacks: [{ provider: 'a', model: 'b' }] } } }, seed), /未指定主模型/);
});
test('项目显式配置优先于自动匹配', () => {
  const e = effectiveConfig({ capabilities: { qa: { provider: 'anthropic', model: 'claude-sonnet-4-6', fallbacks: [] } } }, base);
  assert.deepEqual([e.capabilities.qa.provider, e.capabilities.qa.model], ['anthropic', 'claude-sonnet-4-6']);
});
