import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDetector, DETECT_RETRY_MS } from '../team.js';
import { baseConfig } from '../config.js';
import { CATALOG } from './fixture.mjs';

function flakyLlm() {
  const state = { fail: true, calls: 0 };
  const llm = {
    listProviders: () => Object.keys(CATALOG).map(id => ({ id, name: id })),
    listModels: async id => {
      state.calls++;
      if (state.fail) throw new Error('channel not ready');
      return CATALOG[id].map(m => ({ id: m, name: m }));
    },
  };
  return { llm, state };
}

test('启动时目录失败：间隔内不重试，间隔后自愈并分配 orchestrator，成功后签名不变不再拉目录', async () => {
  const { llm, state } = flakyLlm(); let clock = 1_000_000;
  const d = createDetector(llm, baseConfig({}), { now: () => clock, retryMs: DETECT_RETRY_MS });
  const first = await d.ensure();
  assert.ok(first.errors.length > 0);
  assert.equal(first.base.capabilities.orchestrator.provider, undefined); // fail-closed, no inherited model
  const failedCalls = state.calls;
  state.fail = false;
  clock += DETECT_RETRY_MS - 1;
  await d.ensure();
  assert.equal(state.calls, failedCalls, '重试间隔内不重新拉目录');
  clock += 1;
  const healed = await d.ensure();
  assert.equal(healed.errors.length, 0);
  assert.ok(healed.base.capabilities.orchestrator.provider);
  assert.equal(healed.report.find(r => r.capability === 'orchestrator').status !== 'unassigned', true);
  const okCalls = state.calls;
  clock += DETECT_RETRY_MS * 10;
  assert.equal(await d.ensure(), healed);
  assert.equal(state.calls, okCalls, '匹配成功且签名不变时零开销');
});

test('空目录导致 unassigned 时也会按间隔重试，仍无模型则继续拦截不降档', async () => {
  let calls = 0; let clock = 0;
  const llm = { listProviders: () => [{ id: 'p' }], listModels: async () => { calls++; return []; } };
  const d = createDetector(llm, baseConfig({}), { now: () => clock, retryMs: 100 });
  await d.ensure(); assert.equal(calls, 1);
  await d.ensure(); assert.equal(calls, 1);
  clock = 100;
  const again = await d.ensure(); assert.equal(calls, 2);
  assert.equal(again.base.capabilities.orchestrator.provider, undefined);
  assert.ok(again.report.some(r => r.status === 'unassigned'));
});

test('并发 ensure 串行化：同一次重试只拉一次目录', async () => {
  const { llm, state } = flakyLlm(); let clock = 0;
  const d = createDetector(llm, baseConfig({}), { now: () => clock, retryMs: 10 });
  await d.ensure(); const failedCalls = state.calls;
  state.fail = false; clock = 10;
  const [a, b] = await Promise.all([d.ensure(), d.ensure()]);
  assert.equal(state.calls - failedCalls, Object.keys(CATALOG).length);
  assert.equal(a, b);
  assert.ok(a.base.capabilities.orchestrator.provider);
});
