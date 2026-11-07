import test from 'node:test';
import assert from 'node:assert/strict';
import { arrayArg, createBoardDispatch, inScope, normalizeScope, planTasks } from '../board-dispatch.js';
import { validatePlan } from '../workflow.js';
import { effectiveConfig } from '../config.js';

const assignments = [{ role: 'lv-bu', displayName: '吕布', task: '后端接口' }, { role: 'diao-chan', displayName: '貂蝉', task: '前端页面\n细节' }];

test('子任务：默认每个角色一条；可拆分、带写入范围和依赖；依赖只能指向前面的子任务', () => {
  const plain = planTasks(assignments, {});
  assert.deepEqual(plain.map(t => [t.key, t.subject]), [['lv-bu#1', '后端接口'], ['diao-chan#1', '前端页面']]);
  const split = planTasks(assignments, {
    'lv-bu': [{ key: 'api', subject: '加接口', write_scopes: ['./server/api/'] }],
    'diao-chan': JSON.stringify([{ key: 'ui', subject: '接页面', write_scopes: ['client'], blocked_by: ['api'] }]),
  });
  assert.deepEqual(split.map(t => [t.key, t.writeScopes, t.blockedBy]), [['api', ['server/api'], []], ['ui', ['client'], ['api']]]);
  assert.throws(() => planTasks(assignments, { 'lv-bu': [{ subject: 'x', blocked_by: ['later'] }] }), /previously listed/);
  assert.throws(() => planTasks(assignments, { 'lv-bu': [{ key: 'a', subject: 'x' }], 'diao-chan': [{ key: 'a', subject: 'y' }] }), /[Dd]uplicate/);
  assert.throws(() => normalizeScope('../etc'), /relative/);
  assert.throws(() => normalizeScope('/abs'), /relative/);
  assert.equal(inScope('client/a.js', 'client'), true);
  assert.equal(inScope('client2/a.js', 'client'), false);
});

test('assignments 以 JSON 文本传入时也能识别（模型偶尔这样传）', () => {
  const effective = effectiveConfig({});
  const role = Object.keys(effective.roles).find(r => r !== 'lead');
  const plan = validatePlan({ analysis: 'a', mode: 'delegate', assignments: JSON.stringify([{ role, task: 'x' }]) }, effective);
  assert.equal(plan.assignments[0].role, role);
  assert.deepEqual(arrayArg('[1]'), [1]);
  assert.equal(arrayArg('not json'), 'not json');
});

/** A tiny in-memory board with DSH's create/reassign/claim semantics. */
function fakeTeams(members = []) {
  const tasks = []; const lead = { id: 'lead' };
  const view = t => ({ ...t, ready: t.status === 'pending' && t.blockedBy.every(b => tasks.find(x => x.id === b)?.status === 'completed') });
  const roster = [{ id: 'lead', name: 'lead', role: 'lead' }, ...members.map(n => ({ id: n, name: n, role: 'teammate' }))];
  const teams = {
    createTask: async (_c, r) => { const t = { id: `task-${tasks.length + 1}`, revision: 1, subject: r.subject, description: r.description, status: 'pending', blockedBy: r.blockedBy, writeScopes: r.writeScopes }; tasks.push(t); return view(t); },
    listTasks: () => tasks.map(view),
    listMembers: () => roster,
    updateTask: async (_c, r) => {
      const t = tasks.find(x => x.id === r.taskId);
      if (t.revision !== r.expectedRevision) throw new Error('stale');
      if (r.action === 'reassign') { if (!roster.some(m => m.name === r.owner)) throw new Error('not active'); if (!view(t).ready && t.status === 'pending') throw new Error('blocked'); t.ownerName = r.owner; t.status = 'in_progress'; }
      if (r.action === 'complete') t.status = 'completed';
      t.revision++; return view(t);
    },
    tryMembership: a => (a.id === 'lead' ? { role: 'lead' } : roster.some(m => m.name === a.id) ? { role: 'teammate', name: a.id, root: lead } : undefined),
  };
  return { teams, tasks, lead, roster };
}

test('建看板任务：已存在的队友立刻分到可开始的任务；被依赖挡住的等前置完成', async () => {
  const { teams, tasks, lead } = fakeTeams(['lv-bu']);
  const board = createBoardDispatch({ agentTeams: teams }, { pinned: () => '/p' });
  const byRole = await board.create(lead, { assignments }, { 'lv-bu': [{ key: 'api', subject: '加接口' }], 'diao-chan': [{ key: 'ui', subject: '接页面', blocked_by: ['api'] }] });
  assert.deepEqual(byRole['diao-chan'][0].blockedBy, ['task-1']);
  assert.equal(tasks[0].ownerName, 'lv-bu', '吕布已存在，直接分给他');
  assert.equal(tasks[1].ownerName, undefined, '貂蝉还没创建');
  assert.match(tasks[1].description, /Assigned to: 貂蝉 \(diao-chan\)/);
});

test('队友开工时领到自己的任务；轮换后接替者接手旧成员未完成的任务', async () => {
  const { teams, tasks, lead, roster } = fakeTeams(['diao-chan']);
  const board = createBoardDispatch({ agentTeams: teams }, { pinned: () => '/p' });
  await board.create(lead, { assignments: [assignments[1]] }, {});
  assert.equal(tasks[0].ownerName, 'diao-chan');
  roster.push({ id: 'diao-chan-r2', name: 'diao-chan-r2', role: 'teammate' });
  await board.transfer(lead, 'diao-chan', 'diao-chan-r2');
  assert.equal(tasks[0].ownerName, 'diao-chan-r2');
  assert.match(board.context({ id: 'diao-chan-r2' }), /task-1「前端页面」\(assigned to you, in progress\)/);
  assert.equal(board.context({ id: 'lead' }), '', '主控没有这段上下文');
});

test('写入范围：只拦认领了带范围任务的队友，范围外的修改被拒绝', async () => {
  const { teams, lead } = fakeTeams(['diao-chan']);
  const board = createBoardDispatch({ agentTeams: teams, workingDirectory: { get: () => '/p' } }, { pinned: () => '/p' });
  await board.create(lead, { assignments: [assignments[1]] }, { 'diao-chan': [{ subject: '改前端', write_scopes: ['client'] }] });
  const exec = (name, args) => ({ name, arguments: args, agent: { id: 'diao-chan', session: {} } });
  assert.equal(board.guard(exec('edit', { file_path: 'client/10-overview.js' })), undefined);
  for (const name of ['edit', 'brisk_edit', 'mcp__s__brisk_edit', 'mcp__other__custom_edit']) {
    assert.match(board.guard(exec(name, { file_path: 'server.js' })), /outside the write scopes of your claimed board tasks \(task-1\): client/);
  }
  assert.equal(board.guard(exec('read', { file_path: 'server.js' })), undefined, '读不受限');
  assert.equal(board.guard(exec('edit', { file_path: 'server.js' }), { enforce: false }), undefined, '可关闭');
  assert.equal(board.guard({ name: 'edit', arguments: { file_path: 'server.js' }, agent: { id: 'lead' } }), undefined, '主控不受限');
});

test('队友刚创建时改派会失败，插件稍后重试直到分到任务', async () => {
  const { teams, tasks, lead, roster } = fakeTeams([]);
  const board = createBoardDispatch({ agentTeams: teams }, { pinned: () => '/p' });
  await board.create(lead, { assignments: [assignments[1]] }, {});
  let tries = 0;
  const sleep = async () => { tries++; if (tries === 2) roster.push({ id: 'diao-chan', name: 'diao-chan', role: 'teammate' }); };
  assert.equal(await board.handOut(lead, 'diao-chan', 'diao-chan', { sleep }), true);
  assert.equal(tasks[0].ownerName, 'diao-chan');
  assert.equal(await board.handOut(lead, 'diao-chan', 'nobody', { attempts: 2, sleep: async () => {} }), true, '没有可分的任务时直接成功');
});
