import test from 'node:test';
import assert from 'node:assert/strict';
import { foldUsage, billable, budgetDenial, sessionUsage } from '../usage.js';
import { effectiveConfig, resolveRole } from '../config.js';
import { readRequestEvidence } from '../request-evidence.js';
const header = (provider, model) => ({ type: 'request/header', data: { header: { config: { provider, model } } } });
const usageChunk = (turn, step, input, output, extra = {}) => ({ type: 'assistant/attempt', data: { turn, step,
  stream: [{ type: 'chunk', chunk: { type: 'text' } }, { type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: input, outputTokens: output, ...extra } } }] } });
test('与 token-meter 相同的折叠：同一步替换、重试累加、按请求头归属模型', () => {
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
  assert.deepEqual(totals, { uncachedInputTokens: 180, outputTokens: 31, cacheReadTokens: 50, cacheWriteTokens: 4 });
  assert.deepEqual(routes.map(r => [r.route, billable(r)]), [['a/m1', 140], ['b/m2', 75]]);
  assert.equal(billable(totals), 215);
});
test('跳过继承事件；无用量的会话为零', () => {
  const events = [header('a', 'm'), usageChunk(1, 1, 999, 999), header('a', 'm'), usageChunk(2, 1, 1, 2)];
  assert.equal(billable(foldUsage({ events, inheritedEventCount: 2 }).totals), 3);
  assert.deepEqual(foldUsage({ events: [] }), { totals: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, routes: [] });
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
test('请求证据与用量来自同一次日志读取', async () => {
  let reads = 0;
  const query = { readSession: async () => { reads++; return { events: [header('a', 'm'), usageChunk(1, 1, 10, 1)] }; } };
  const result = await readRequestEvidence(query, 's');
  assert.equal(reads, 1);
  assert.equal(result.records.length, 1);
  assert.equal(billable(result.usage.totals), 11);
});
