import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, normalizeModelId, autoMatch } from '../defaults.js';
import { seed, effectiveConfig } from '../config.js';
import { match, base } from './fixture.mjs';
const tierIn = (ids, id) => autoMatch(ids.map(model => ({ provider: 'p', model })), {}).pools.find(c => c.model === id)?.tier;
test('网关前缀、日期快照与连字符版本统一归一', () => {
  assert.equal(normalizeModelId('anthropic/claude-opus-5-5'), 'claude-opus-5.5');
  assert.equal(normalizeModelId('bai/claude-haiku-5-5-20261007'), 'claude-haiku-5.5');
  assert.equal(normalizeModelId('pro/deepseek-ai/DeepSeek-V4.1-Flash-1017'), 'deepseek-v4.1-flash');
  assert.equal(normalizeModelId('openai/gpt-6.1-sol:batch'), 'gpt-6.1-sol');
});
test('当前命名：GPT-6 astra/sol/terra/luna，Gemini 4 代号旗舰', () => {
  const tier = id => classify(id)?.tier;
  assert.deepEqual(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna'].map(tier), ['high', 'upper', 'medium', 'low']);
  assert.equal(tier('gpt-6.1-sol-pro'), 'upper'); // -pro is a same-price mode on every GPT-6 line
  assert.equal(classify('gpt-6.1-sol-pro').family, classify('gpt-6.1-sol').family);
  assert.deepEqual(['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.5-flash-lite'].map(tier), ['high', 'medium', 'low']);
  assert.deepEqual(['claude-opus-5.5', 'claude-fable-5.1', 'claude-sonnet-5.5', 'claude-haiku-5.5'].map(tier), ['high', 'high', 'upper', 'low']);
  assert.deepEqual(['deepseek-v4.1-flash', 'deepseek-v4-pro', 'qwen3.8-max-prime', 'qwen3.8-flash', 'kimi-k3.1-pro', 'glm-5.3-flash', 'glm-5.3-flashx', 'minimax-m3.1-flash', 'mimo-v2.6-pro'].map(tier),
    ['medium', 'upper', 'upper', 'low', 'upper', 'low', 'medium', 'low', 'upper']);
  assert.equal(tier('deepseek-v4-flash'), 'medium');
  assert.deepEqual(['qwen3.8-27b', 'qwen3.8-2.4t-a95b'].map(tier), ['low', 'upper']);
});
test('上一代命名仍可识别：GPT-5 -pro/-mini/-nano、Gemini 3 -pro', () => {
  const tier = id => classify(id)?.tier;
  assert.deepEqual(['gpt-5.5-pro', 'gpt-5.5', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gemini-3.1-pro-preview'].map(tier), ['high', 'upper', 'medium', 'low', 'high']);
  for (const id of ['gpt-image-2', 'text-embedding-3-large', 'tts-1', 'whisper-1', 'gemini-nano-banana-2.1', 'llama-4-scout:free', 'house-model-x', 'gpt-4o', 'claude-3-7-sonnet']) assert.equal(classify(id), undefined, id);
});
test('代际按用户目录判断：同厂商有更新大版本时旧版降一档、排最后', () => {
  assert.equal(tierIn(['gpt-5.5-pro', 'gpt-6-astra'], 'gpt-5.5-pro'), 'upper');
  assert.equal(tierIn(['gpt-5.5-pro'], 'gpt-5.5-pro'), 'high'); // only GPT-5 present: still that user's flagship
  assert.equal(tierIn(['gemini-3.1-pro-preview', 'gemini-4-argon'], 'gemini-3.1-pro-preview'), 'upper');
  assert.equal(tierIn(['gemini-3.8-flash', 'gemini-4-argon'], 'gemini-3.8-flash'), 'medium'); // no Gemini 4 Flash yet
  assert.equal(tierIn(['gpt-5.4-mini', 'gpt-6.1-terra'], 'gpt-5.4-mini'), 'low');
});
test('官方最新ID：DeepSeek 无版本名、Gemini 代号、Grok 产品线版本号', () => {
  const tier = id => classify(id)?.tier;
  assert.deepEqual(['deepseek-flash', 'deepseek-v4-pro', 'gemini-4-argon', 'gemini-3.6-flash', 'grok-build-0.1', 'grok-4.20-0309-non-reasoning'].map(tier),
    ['medium', 'upper', 'high', 'medium', 'medium', 'medium']);
  for (const id of ['gemini-3.8-live', 'gemini-3.8-live-extended-thinking', 'gemini-3.5-live-translate-preview', 'gemini-omni-flash', 'gemini-3.8-flash-tts',
    'grok-4.20-multi-agent-0309', 'minimax-m2-her', 'gpt-daybreak-blue-latest', 'gpt-rosalind-research', 'o4-mini-deep-research'])
    assert.equal(classify(id), undefined, id);
  const r = autoMatch(['deepseek-flash', 'gemini-flash-latest', 'gpt-6.1-terra'].map(model => ({ provider: 'p', model })), { frontend: { tier: 'medium', prefer: ['deepseek'] } });
  assert.equal(r.routes.frontend.model, 'deepseek-flash'); // plain versionless official id is not an alias
  assert.deepEqual(r.routes.frontend.fallbacks.map(f => f.model), ['gpt-6.1-terra', 'gemini-flash-latest']);
});
test('GPT 各线独立升级：现有 6.1 sol/terra 与 6 luna 并存；将来出现 6.1-luna 时自动取代', () => {
  const ids = ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-6.1-terra', 'gpt-5.6-terra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol'];
  const r = autoMatch(ids.map(model => ({ provider: 'p', model })), { writer: { tier: 'low' }, frontend: { tier: 'medium' }, backend: { tier: 'upper' } });
  assert.deepEqual([r.routes.writer.model, r.routes.frontend.model, r.routes.backend.model], ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol']);
  assert.equal(r.pools.find(c => c.model === 'gpt-5.6-sol').legacy, true); // previous major, one tier lower
  assert.equal(classify('gpt-5.6-cyber'), undefined); // restricted Daybreak model
  const next = autoMatch(['gpt-6-luna', 'gpt-6.1-luna'].map(model => ({ provider: 'p', model })), { writer: { tier: 'low' } });
  assert.equal(next.routes.writer.model, 'gpt-6.1-luna');
  assert.deepEqual(next.routes.writer.fallbacks.map(f => f.model), ['gpt-6-luna']);
});
test('同一大版本内的小版本：新版优先，旧版只作末位备选', () => {
  const r = autoMatch(['deepseek-v4-flash', 'deepseek-v4.1-flash', 'gpt-6.1-terra'].map(model => ({ provider: 'p', model })), { frontend: { tier: 'medium', prefer: ['deepseek'] } });
  assert.equal(r.routes.frontend.model, 'deepseek-v4.1-flash');
  assert.deepEqual(r.routes.frontend.fallbacks.map(f => f.model), ['gpt-6.1-terra', 'deepseek-v4-flash']);
  const only = autoMatch([{ provider: 'p', model: 'deepseek-v4-flash' }], { frontend: { tier: 'medium' } });
  assert.equal(only.routes.frontend.model, 'deepseek-v4-flash'); // without v4.1 it is still a normal choice
});
test('按能力档位与厂商偏好选主模型，备选同档：同模型他渠道优先，其次异厂商', () => {
  const o = base.capabilities.orchestrator;
  assert.deepEqual([o.provider, o.model, o.tier], ['anthropic', 'claude-opus-5-5', 'high']);
  assert.deepEqual(o.fallbacks, [{ provider: 'relay', model: 'anthropic/claude-opus-5.5' }, { provider: 'openai', model: 'gpt-6-astra' }, { provider: 'relay', model: 'google/gemini-4-argon' }]);
  assert.deepEqual([base.capabilities.backend.provider, base.capabilities.backend.model], ['openai', 'gpt-6.1-sol']);
  assert.ok(!base.capabilities.backend.fallbacks.some(f => f.model === 'gpt-6.1-sol-pro')); // a mode variant is not a backup
  assert.equal(base.capabilities.frontend.model, 'google/gemini-3.8-flash'); // frontend prefers Gemini; no Gemini 4 Flash yet
  assert.equal(classify('o3-pro'), undefined); // the o-series line was folded into GPT-5+
  assert.equal(base.capabilities.writer.model, 'gpt-6-luna');
  for (const c of Object.values(base.capabilities)) for (const f of c.fallbacks) assert.ok(base.tiers[c.tier].includes(f.model));
  assert.ok(match.unknown.includes('relay/house-model-x'));
  assert.ok(match.report.every(r => r.status === 'matched'));
});
test('所需档位缺失时可升档；没有合格模型时保持未分配，不降档', () => {
  const up = autoMatch([{ provider: 'p', model: 'claude-opus-5.5' }], { qa: { tier: 'upper' } });
  assert.equal(up.report[0].status, 'upgraded'); assert.equal(up.routes.qa.tier, 'high');
  const below = autoMatch([{ provider: 'p', model: 'gpt-6.1-terra' }], { orchestrator: { tier: 'high' } });
  assert.equal(below.report[0].status, 'unassigned'); assert.match(below.report[0].reason, /不降档/);
  assert.equal(below.routes.orchestrator, undefined);
  const none = autoMatch([{ provider: 'p', model: 'house-model-x' }], { qa: { tier: 'upper' } });
  assert.equal(none.report[0].status, 'unassigned'); assert.equal(none.routes.qa, undefined);
});
test('模式变体视为同一模型；旧代模型排在备选末尾', () => {
  const r = autoMatch([
    { provider: 'a', model: 'claude-sonnet-5.5' }, { provider: 'a', model: 'claude-sonnet-5-5-thinking' },
    { provider: 'a', model: 'claude-sonnet-4.6' }, { provider: 'b', model: 'deepseek-v4-pro' }, { provider: 'b', model: 'gpt-6.1-sol' },
  ], { backend: { tier: 'upper', prefer: ['claude'] } });
  assert.equal(r.routes.backend.model, 'claude-sonnet-5.5');
  assert.deepEqual(r.routes.backend.fallbacks.map(f => f.model).sort(), ['deepseek-v4-pro', 'gpt-6.1-sol']); // sonnet-4.6 dropped to medium
});
test('无可识别模型时能力保持未分配，配置仍然有效', () => {
  const e = effectiveConfig({}, seed);
  assert.equal(e.capabilities.qa.provider, undefined);
  assert.throws(() => effectiveConfig({ capabilities: { qa: { fallbacks: [{ provider: 'a', model: 'b' }] } } }, seed), /未指定主模型/);
});
test('项目显式配置优先于自动匹配', () => {
  const e = effectiveConfig({ capabilities: { qa: { provider: 'anthropic', model: 'claude-sonnet-5-5', fallbacks: [] } } }, base);
  assert.deepEqual([e.capabilities.qa.provider, e.capabilities.qa.model], ['anthropic', 'claude-sonnet-5-5']);
});
