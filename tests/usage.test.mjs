import test from 'node:test';
import assert from 'node:assert/strict';
import { foldUsage, billable, budgetDenial, sessionUsage, initOwnUsage, applyOwnUsage, OWN_USAGE_KEY } from '../usage.js';
import { effectiveConfig, resolveRole } from '../config.js';
import { readRequestEvidence } from '../request-evidence.js';
const header = (provider, model) => ({ type: 'request/header', data: { header: { config: { provider, model } } } });
const usageChunk = (turn, step, input, output, extra = {}) => ({ type: 'assistant/attempt', data: { turn, step,
  stream: [{ type: 'chunk', chunk: { type: 'text' } }, { type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: input, outputTokens: output, ...extra } } }] } });
test('own fold：settled attempt累加、宿主重试累加、按请求头归属模型', () => {
  const { totals, routes } = foldUsage({ events: [
    header('a', 'm1'),
    usageChunk(1, 1, 100, 10),
    { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 120, outputTokens: 20, cacheReadTokens: 50 } } },
    { type: 'llm/retry-started', data: { turn: 1, step: 2 } }, // other step: does not close the slot
    header('b', 'm2'),
    usageChunk(1, 2, 30, 5),
    { type: 'llm/retry-started', data: { turn: 1, step: 2 } },
    usageChunk(1, 2, 30, 6, { cacheWriteTokens: 4 }),
  ] });
  assert.deepEqual(totals, { uncachedInputTokens: 280, outputTokens: 41, cacheReadTokens: 50, cacheWriteTokens: 4 });
  assert.deepEqual(routes.map(r => [r.route, billable(r)]), [['a/m1', 250], ['b/m2', 75]]);
  assert.equal(billable(totals), 325);
});
test('跳过继承事件；无用量的会话为零', () => {
  const events = [header('a', 'm'), usageChunk(1, 1, 999, 999), header('a', 'm'), usageChunk(2, 1, 1, 2)];
  assert.equal(billable(foldUsage({ events, inheritedEventCount: 2 }).totals), 3);
  assert.deepEqual(foldUsage({ events: [] }), { totals: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, routes: [], lastRoute: null, reportedSamples: 0, attemptsWithoutUsage: 0, coverage: 'unknown' });
});
test('预算：maxTokens 校验，达到上限阻止，投影缺席时不拦截', () => {
  const effective = effectiveConfig({ capabilities: { writer: { maxTokens: 5000 } } });
  const role = resolveRole({ role: 'teammate', name: 'chen-lin' }, effective);
  assert.equal(role.maxTokens, 5000);
  assert.equal(budgetDenial(role, { uncachedInputTokens: 3000, outputTokens: 1999, cacheReadTokens: 90000, cacheWriteTokens: 0 }), undefined);
  assert.match(budgetDenial(role, { uncachedInputTokens: 3000, outputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0 }), /达到预算上限 5000/);
  assert.equal(budgetDenial(role, undefined), undefined);
  assert.equal(budgetDenial(resolveRole({ role: 'lead' }, effective), { outputTokens: 1e9 }), undefined);
  assert.throws(() => effectiveConfig({ capabilities: { qa: { maxTokens: 10 } } }), /maxTokens/);
  assert.equal(effectiveConfig({ capabilities: { writer: { maxTokens: null } } }).capabilities.writer.maxTokens, undefined);
  const totals = { uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 };
  assert.deepEqual(sessionUsage({ stateOf: () => ({ totals, last: null }) }, {}), totals);
  assert.equal(sessionUsage({ stateOf: () => { throw new Error('missing key'); } }, {}), undefined);
  assert.equal(sessionUsage(undefined, {}), undefined);
});
test('own usage excludes fork prefix and budget never reads host tokenUsage', () => {
  const events = [header('p', 'm'), usageChunk(1, 1, 30, 4, { cacheReadTokens: 6, cacheWriteTokens: 2 }), { type: 'turn/end' }, header('p', 'm'), usageChunk(2, 1, 7, 1, { cacheReadTokens: 2, cacheWriteTokens: 1 })].map((e, seq) => ({ ...e, seq }));
  const state = events.reduce(applyOwnUsage, initOwnUsage(3));
  assert.deepEqual(state.totals, { uncachedInputTokens: 7, outputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 1 });
  const live = sessionUsage({ stateOf: (_s, key) => { assert.equal(key, OWN_USAGE_KEY); return state; } }, {});
  assert.deepEqual(live, foldUsage({ events, inheritedEventCount: 3 }).totals);
  assert.equal(budgetDenial({ maxTokens: 10 }, live), undefined);
});
test('host retry exhaustion then plugin retry accumulates durable attempts; same stream takes last sample', () => {
  const attempt = usageChunk(1, 1, 10, 1);
  attempt.data.stream.unshift({ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 2, outputTokens: 0 } } });
  const events = [header('p', 'm'), attempt, { type: 'llm/retry-started', data: { turn: 1, step: 1 } }, usageChunk(1, 1, 20, 2), header('p', 'fallback'), { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 30, outputTokens: 3 } } }];
  const result = foldUsage({ events }); assert.equal(result.totals.uncachedInputTokens, 60); assert.equal(result.totals.outputTokens, 6); assert.equal(result.coverage, 'complete');
  assert.equal(result.reportedSamples, 3);
  assert.equal(foldUsage({ events: [{ type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [] } }] }).coverage, 'partial');
  assert.equal(foldUsage({ events: [] }).coverage, 'unknown');
});
test('请求证据与用量来自同一次日志读取', async () => {
  let reads = 0;
  const query = { readSession: async () => { reads++; return { events: [header('a', 'm'), usageChunk(1, 1, 10, 1)] }; } };
  const result = await readRequestEvidence(query, 's');
  assert.equal(reads, 1);
  assert.equal(result.records.length, 1);
  assert.equal(billable(result.usage.totals), 11);
});
test('lastRoute is the latest request header, even when it returns to a route used earlier', async () => {
  const { ownUsageView } = await import('../usage.js');
  const events = [header('a', 'pick'), usageChunk(1, 1, 0, 0), header('a', 'primary'), usageChunk(1, 2, 10, 1), header('a', 'pick')];
  assert.equal(foldUsage({ events }).lastRoute, 'a/pick');
  const state = events.reduce(applyOwnUsage, initOwnUsage());
  assert.equal(ownUsageView(state).lastRoute, 'a/pick');
  assert.equal(ownUsageView(initOwnUsage()).lastRoute, null);
});
