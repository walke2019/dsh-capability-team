import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectTeamRuntime } from '../ui.js';
const agent = { id: 'diag-session', ctx: {} };
const context = visible => ({ agentPresets: { composedPreset: () => 'capability-team', list: async () => [{ id: 'capability-team' }] },
  tools: { schemas: () => visible.map(name => ({ name })) } });
test('缺少主控工具时诊断写明原因与处置', async () => {
  const s = await inspectTeamRuntime(context(['capability_team_read']), agent);
  assert.equal(s.ready, false);
  assert.deepEqual(s.missingTools, ['capability_dispatch_plan', 'capability_free_task']);
  assert.match(s.explanation, /capability_dispatch_plan、capability_free_task/);
  assert.match(s.explanation, /会话创建之后才加载或中途重载/);
  assert.match(s.explanation, /刷新.*仍缺失.*新建会话.*能力协作团队/);
  assert.doesNotMatch(s.explanation, /检查预设激活诊断/);
});
