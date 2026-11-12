import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROTATION, baseName, createRotation, emptyMetrics, foldEvent, rotationLevel, successorName, validateRotation } from '../session-rotation.js';
import { effectiveConfig, resolveRole } from '../config.js';

test('接替者命名：角色-rN，逐代递增，可还原角色名', () => {
  assert.equal(successorName('diao-chan'), 'diao-chan-r2');
  assert.equal(successorName('diao-chan-r2'), 'diao-chan-r3');
  assert.equal(baseName('diao-chan-r7'), 'diao-chan');
});

test('事件折叠：压缩、轮数、重复读取、最后一次测试', () => {
  const m = emptyMetrics();
  for (let i = 0; i < 3; i++) foldEvent(m, { type: 'compaction/end', data: {} });
  foldEvent(m, { type: 'turn/start', data: {} });
  for (let i = 0; i < 4; i++) foldEvent(m, { type: 'tool/call', data: { name: 'read', arguments: '{"file_path":"client.js"}' } });
  foldEvent(m, { type: 'tool/call', data: { name: 'bash', callId: 'b1', arguments: JSON.stringify({ command: 'npm test' }) } });
  foldEvent(m, { type: 'tool/result', time: 5, data: { message: { toolCallId: 'b1', isError: false, content: [{ text: 'noise\nℹ pass 270\nℹ fail 0' }] } } });
  assert.equal(m.compactions, 3);
  assert.equal(m.turns, 1);
  assert.equal(m.maxRepeat, 4);
  assert.deepEqual(m.lastTest, { command: 'npm test', isError: false, summary: 'ℹ pass 270\nℹ fail 0', at: 5 });
});

test('阈值：软线只提醒；硬线要有进展（改过文件或被压缩过）才要求轮换', () => {
  const base = { ...emptyMetrics() };
  const worked = { ...base, edits: 2 };
  assert.equal(rotationLevel(base, 0.3, ROTATION).level, 'ok');
  assert.equal(rotationLevel(base, 0.65, ROTATION).level, 'ok', '60% 不再触发');
  assert.equal(rotationLevel(base, 0.78, ROTATION).level, 'soft');
  assert.equal(rotationLevel({ ...base, compactions: 2 }, undefined, ROTATION).level, 'soft');
  assert.equal(rotationLevel({ ...base, compactions: 3 }, undefined, ROTATION).level, 'hard', '压缩过本身就是进展');
  assert.equal(rotationLevel(worked, 0.92, ROTATION).level, 'hard');
  assert.equal(rotationLevel({ ...worked, turns: 8 }, undefined, ROTATION).level, 'hard');
  assert.equal(rotationLevel({ ...base, maxRepeat: 15 }, undefined, ROTATION).level, 'soft');
  assert.equal(rotationLevel({ ...base, compactions: 9 }, undefined, false).level, 'ok', '关闭后不触发');
});

test('只读调研、还没改任何文件的会话不会被轮换（避免接替者重读一遍）', () => {
  const stalled = rotationLevel({ ...emptyMetrics() }, 0.95, ROTATION);
  assert.equal(stalled.level, 'soft');
  assert.equal(stalled.stalled, true);
  const m = emptyMetrics();
  foldEvent(m, { type: 'tool/call', data: { name: 'str_replace_editor', arguments: '{"command":"view","path":"a.js"}' } });
  assert.equal(m.edits, 0, '查看不算改动');
  foldEvent(m, { type: 'tool/call', data: { name: 'edit', arguments: '{"file_path":"a.js"}' } });
  assert.equal(m.edits, 1);
  assert.equal(rotationLevel(m, 0.95, ROTATION).level, 'hard');
});

test('aliased calls still count reads, edits and PowerShell test evidence', () => {
  const m = emptyMetrics();
  for (const name of ['read', 'brisk_read', 'mcp__s__brisk_read']) foldEvent(m, { type: 'tool/call', data: { name, arguments: { file_path: 'a.js' } } });
  for (const name of ['brisk_edit', 'mcp__s__brisk_write']) foldEvent(m, { type: 'tool/call', data: { name, arguments: {} } });
  foldEvent(m, { type: 'tool/call', data: { name: 'mcp__s__brisk_pwsh', callId: 'p1', arguments: { command: 'node --test' } } });
  assert.equal(m.maxRepeat, 3);
  assert.equal(m.edits, 2);
  assert.equal(m.pendingTest.callId, 'p1');
});

test('rotation 配置校验', () => {
  assert.deepEqual(validateRotation(undefined), ROTATION);
  assert.equal(validateRotation(false), false);
  assert.throws(() => validateRotation({ softRatio: 2 }), /greater than 0 and at most 1/);
  assert.throws(() => validateRotation({ softCompactions: 5, hardCompactions: 3 }), /soft thresholds/);
  assert.throws(() => validateRotation({ nope: 1 }), /does not support/);
  assert.deepEqual(effectiveConfig({ workflow: { rotation: {} } }).workflow.rotation, ROTATION);
});

test('接替者沿用原角色的模型和权限', () => {
  const effective = effectiveConfig({});
  const [id] = Object.keys(effective.roles).filter(r => r !== 'lead');
  const original = resolveRole({ role: 'teammate', name: id }, effective);
  const successor = resolveRole({ role: 'teammate', name: `${id}-r3` }, effective);
  assert.equal(successor.id, id);
  assert.equal(successor.model, original.model);
  assert.throws(() => resolveRole({ role: 'teammate', name: 'nobody-r2' }, effective), /is not registered in this project's team configuration/);
});

function fakeTeam(root, members, { tasks = [] } = {}) {
  const lead = { id: 'lead-1', session: {} };
  const agents = new Map([[lead.id, lead], ...members.map(m => [m.id, { id: m.id, session: {}, ctx: {} }])]);
  const roster = [{ id: lead.id, name: 'lead', role: 'lead' }, ...members.map(m => ({ ...m, role: 'teammate' }))];
  const ctx = { agentPresets: { composedPreset: () => 'capability-team' },
    agents,
    agentTeams: {
      tryMembership: a => (a === lead ? { role: 'lead', root: lead } : members.some(m => m.id === a?.id) ? { role: 'teammate', root: lead, name: members.find(m => m.id === a.id).name } : undefined),
      listMembers: () => roster, listTasks: () => tasks,
    },
  };
  const team = { root, pinned: () => '/p', loadSync: () => ({ effective: effectiveConfig({ workflow: { rotation: {} } }) }) };
  return { ctx, team, lead, agents };
}

test('交接写入并带上插件采集的事实；轮换生成接替者与调用步骤', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rot-'));
  const { ctx, team, lead, agents } = fakeTeam(root, [{ id: 'm1', name: 'diao-chan' }], { tasks: [{ id: 'task-3', subject: '本地化', status: 'in_progress', ownerId: 'm1' }] });
  const r = createRotation(ctx, team, { diffStat: async () => ' client/00.js | 2 +-' });
  const before = await r.rotate(lead, { role: 'diao-chan' });
  assert.equal(before.rotated, false);
  assert.match(before.next, /capability_handoff/);
  await assert.rejects(r.writeHandoff(agents.get('m1'), { goal: 'x' }), /done/);
  const h = await r.writeHandoff(agents.get('m1'), { done: 'A 完成', remaining: 'B 未做', verify: 'npm test' });
  assert.equal(h.facts.diffStat, ' client/00.js | 2 +-');
  assert.deepEqual(h.facts.openTasks, [{ id: 'task-3', subject: '本地化', status: 'in_progress' }]);
  const plan = await r.rotate(lead, { role: 'diao-chan', task: '原任务' });
  assert.equal(plan.to, 'diao-chan-r2');
  assert.match(plan.prompt, /B 未做/);
  assert.match(plan.prompt, /client\/00\.js/);
  assert.match(plan.next, /interrupt_agent target=diao-chan/);
  assert.match(plan.next, /task-3/);
  assert.equal(r.plannedSuccessor('lead-1', 'diao-chan-r2'), true);
  assert.match(r.guard({ agent: lead, name: 'send_message', arguments: { target: 'diao-chan' } }), /handed off to diao-chan-r2/);
  const fresh = createRotation(ctx, team, { diffStat: async () => null });
  assert.equal((await fresh.readHandoff('lead-1', 'diao-chan')).written.remaining, 'B 未做', '交接持久化到磁盘');
});

test('名额用完时不轮换，改为省上下文模式', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rot-'));
  const members = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, name: `r${i}` }));
  const { ctx, team, lead } = fakeTeam(root, members);
  const r = createRotation(ctx, team, { diffStat: async () => null });
  const out = await r.rotate(lead, { role: 'r1', without_handoff: true });
  assert.equal(out.rotated, false);
  assert.match(out.reason, /capacity exhausted \(8\/8\)/);
});

test('硬线时主控不能再给该队友派新活', () => {
  const { ctx, team, lead, agents } = fakeTeam('/tmp', [{ id: 'm1', name: 'diao-chan' }]);
  const r = createRotation(ctx, team);
  ctx.on = (name, fn) => { if (name === 'session/event') ctx.onEvent = fn; };
  ctx.effect = () => {}; ctx.tools = { guard() {}, register() {} };
  r.register();
  for (let i = 0; i < 3; i++) ctx.onEvent(agents.get('m1').session = { id: 'm1' }, { type: 'compaction/end', data: {} });
  for (const name of ['send_message', 'brisk_send_message', 'mcp__s__brisk_send_message']) assert.match(r.guard({ agent: lead, name, arguments: { target: 'diao-chan' } }), /reached the session rotation threshold.*capability_rotate_member/);
});

test('接替者沿用用户为该角色确认的路由', async () => {
  const { createTeam } = await import('../team.js');
  const { answerPending, createDispatchConfirm, forgetLead, pendingView } = await import('../dispatch-confirm.js');
  assert.equal(typeof createTeam, 'function');
  const effective = effectiveConfig({ tiers: { medium: ['m1', 'm2'] }, capabilities: { frontend: { provider: 'provider-a', model: 'm1', tier: 'medium', fallbacks: [] } }, roles: { 'diao-chan': { displayName: '貂蝉', capability: 'frontend', description: 'x' } } });
  const llm = { listProviders: () => [{ id: 'provider-a', name: 'c' }], listModels: async () => [{ id: 'm1' }, { id: 'm2' }] };
  forgetLead('LR');
  const confirm = createDispatchConfirm({ llm }, { pin: async () => '/p' }, { graceMs: 1000 });
  const p = confirm.confirm({ agent: { id: 'LR' }, callId: 'c' }, { mode: 'delegate', assignments: [{ role: 'diao-chan', capability: 'frontend', task: 't' }] }, effective, { disabledRoutes: [] }, 'always');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(pendingView('LR', 'c').status, 'pending');
  answerPending('LR', 'c', { decision: 'confirm', routes: [{ role: 'diao-chan', primary: 'provider-a/m2' }] });
  await p;
  const { confirmedRoute } = await import('../dispatch-confirm.js');
  assert.equal(confirmedRoute('LR', baseName('diao-chan-r3')).primary.model, 'm2');
});
