import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeFreeTask } from '../task-bridge.js';
function fakeTeams() {
  let task; const actions = [];
  return { actions, membership: () => ({ role: 'lead' }),
    createTask: async (_agent, fields) => task = { id: '1', revision: 1, status: 'pending', ...fields },
    getTask: () => ({ ...task }),
    updateTask: async (_agent, req) => { assert.equal(req.expectedRevision, task.revision); actions.push(req.action); task = { ...task, ...req, revision: task.revision + 1, status: req.action === 'claim' ? 'in_progress' : req.action === 'complete' ? 'completed' : req.action === 'release' ? 'pending' : task.status }; return task; },
  };
}
test('免费结果先回填再完成', async () => {
  const teams = fakeTeams();
  const result = await executeFreeTask({ teams, agent: {}, prompt: 'test', worker: async () => ({ model: 'free', text: '结果' }) });
  assert.equal(result.status, 'completed'); assert.deepEqual(teams.actions, ['claim','edit','complete']); assert.match(teams.getTask().description, /结果/);
});
test('无效输入在创建持久任务前拒绝', async () => {
  const teams = fakeTeams(); let created = false;
  teams.createTask = async () => { created = true; throw new Error('不应调用'); };
  await assert.rejects(executeFreeTask({ teams, agent: {}, prompt: '' }), /任务/);
  assert.equal(created, false);
});
test('分析期间别人修改任务则不覆盖也不完成', async () => {
  const teams = fakeTeams();
  await assert.rejects(executeFreeTask({ teams, agent: {}, prompt: 'test', worker: async () => {
    const current = teams.getTask();
    await teams.updateTask({}, { expectedRevision: current.revision, action: 'edit', description: '用户改动' });
    return { model: 'free', text: '分析结果' };
  } }), /其他成员修改/);
  assert.equal(teams.getTask().description, '用户改动');
  assert.equal(teams.getTask().status, 'in_progress');
  assert.deepEqual(teams.actions, ['claim','edit']);
});
test('失败保留原因并释放，不标完成', async () => {
  const teams = fakeTeams();
  await assert.rejects(executeFreeTask({ teams, agent: {}, prompt: 'test', worker: async () => { throw new Error('测试失败'); } }));
  assert.deepEqual(teams.actions, ['claim','edit','release']); assert.equal(teams.getTask().status, 'pending'); assert.match(teams.getTask().description, /测试失败/);
});
