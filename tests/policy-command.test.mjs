import test from 'node:test';
import assert from 'node:assert/strict';
import { savePolicyCommand } from '../ui.js';
import { registerPolicyWriter } from '../runtime-view.js';
test('保存命令校验会话绑定并调用同一策略存储操作', async () => {
  const agent = { ctx: {} }; let calls = 0;
  const off = registerPolicyWriter(agent, async (routes, revision) => {
    calls++; assert.deepEqual(routes, ['p/m']); assert.equal(revision, 4);
    return { revision: 5, disabledRoutes: routes };
  });
  const ctx = { agentPresets: { composedPreset: () => 'capability-team' } };
  try {
    const result = await savePolicyCommand(ctx, { agent, rawInput: JSON.stringify({ disabledRoutes: ['p/m'], expectedRevision: 4 }) });
    assert.equal(JSON.parse(result.text).revision, 5);
    await assert.rejects(savePolicyCommand(ctx, { agent, rawInput: '{bad' }));
    await assert.rejects(savePolicyCommand(ctx, { agent, rawInput: '{"unexpected":1}' }), /无效/);
    ctx.agentPresets.composedPreset = () => 'standard';
    await assert.rejects(savePolicyCommand(ctx, { agent, rawInput: '{}' }), /未启用/);
    assert.equal(calls, 1);
  } finally { off(); }
});
