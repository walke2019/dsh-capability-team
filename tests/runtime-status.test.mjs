import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectTeamRuntime, apply } from '../ui.js';
import { registerTeamReader } from '../runtime-view.js';
const names = ['capability_team_read', 'capability_dispatch_plan', 'capability_free_task'];
function context(preset, visible = names, broken) {
  return { agentPresets: { composedPreset: () => preset, list: async () => [{ id: 'capability-team', broken }] },
    tools: { schemas: () => visible.map(name => ({ name })) } };
}
const agent = { id: 'fixture-session', ctx: {} };
test('其他预设不会被误报为能力路由已挂载', async () => {
  const s = await inspectTeamRuntime(context('standard', []), agent);
  assert.equal(s.ready, false); assert.equal(s.preset, 'standard');
  assert.match(s.explanation, /未挂载/);
});
test('名称相同但工具缺失必须显示未就绪', async () => {
  const s = await inspectTeamRuntime(context('capability-team', []), agent);
  assert.equal(s.ready, false); assert.deepEqual(s.missingTools, names);
});
test('挂载成功不冒充模型调用成功', async () => {
  const before = await inspectTeamRuntime(context('capability-team'), agent);
  assert.equal(before.ready, false); assert.match(before.explanation, /读取器尚未就绪/);
  const off = registerTeamReader(agent, () => ({ roles: [] }));
  try {
    const s = await inspectTeamRuntime(context('capability-team'), agent);
    assert.equal(s.ready, true); assert.match(s.explanation, /不代表/);
  } finally { off(); }
});
test('激活失败明确返回诊断', async () => {
  const s = await inspectTeamRuntime(context('capability-team', names, 'fixture error'), agent);
  assert.equal(s.ready, false); assert.equal(s.activationError, 'fixture error');
});
test('只读诊断命令不启动模型，注册受上下文管理', async () => {
  let definition; let disposed = false;
  const ctx = context('standard', []);
  ctx.effect = cb => cb();
  ctx.commands = { register: d => { definition = d; return () => { disposed = true; }; } };
  apply(ctx);
  const result = await definition.handler({ agent });
  assert.equal(definition.name, 'capability-status');
  assert.equal(JSON.parse(result.text).ready, false);
  assert.equal(disposed, false);
});
