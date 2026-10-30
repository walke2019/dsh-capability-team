import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanGate, SUBMIT_TOOL, REVIEW_TOOL } from '../plan-gate.js';
import { effectiveConfig } from '../config.js';
function fixture(planFirst = true) {
  const effective = effectiveConfig({ capabilities: { backend: { planFirst } } });
  const guards = []; const tools = new Map(); const sent = [];
  const lead = { id: 'L', session: {} }; const mate = { id: 'M', session: {} };
  const members = new Map([[lead, { id: 'T', role: 'lead', name: 'lead' }], [mate, { id: 'T', role: 'teammate', name: 'lv-bu' }]]);
  const ctx = { effect: fn => fn(), tools: { guard: fn => guards.push(fn), register: tool => tools.set(tool.name, tool) },
    agentTeams: { tryMembership: a => members.get(a), membership: a => members.get(a), sendMessage: async (from, request) => { sent.push({ from: from.id, to: request.target, text: request.content[0].text }); } } };
  const gate = createPlanGate(ctx, { pinned: () => '/repo', loadSync: () => ({ effective }), base: effective });
  gate.register();
  const call = (agent, name, args = {}) => guards.map(g => g({ agent, name, arguments: args })).find(Boolean);
  const run = (agent, name, args) => tools.get(name).execute(args, { agent, signal: undefined });
  return { gate, call, run, sent, lead, mate };
}
test('未提交或待批时只能只读分析与协调；批准后放行', async () => {
  const f = fixture();
  assert.match(f.call(f.mate, 'write', { file_path: 'a.js' }), /须先调用 capability_submit_plan/);
  assert.equal(f.call(f.mate, 'read', { file_path: 'a.js' }), undefined);
  assert.equal(f.call(f.mate, 'send_message'), undefined);
  assert.equal(f.call(f.mate, SUBMIT_TOOL), undefined);
  await f.run(f.mate, SUBMIT_TOOL, { plan: '改 a.js 的接口并补测试' });
  assert.deepEqual([f.sent[0].from, f.sent[0].to], ['M', 'lead']);
  assert.match(f.sent[0].text, /role=lv-bu/);
  assert.match(f.call(f.mate, 'bash'), /已提交，等待主控批准/);
  await f.run(f.lead, REVIEW_TOOL, { role: 'lv-bu', approve: true });
  assert.deepEqual([f.sent[1].from, f.sent[1].to], ['L', 'lv-bu']);
  assert.equal(f.call(f.mate, 'bash'), undefined);
  assert.equal(f.call(f.lead, 'bash'), undefined); // the Lead is governed by the dispatch workflow, not this gate
});
test('退回必须写意见；新的派活计划使旧批准失效', async () => {
  const f = fixture();
  await f.run(f.mate, SUBMIT_TOOL, { plan: 'v1' });
  await assert.rejects(f.run(f.lead, REVIEW_TOOL, { role: 'lv-bu', approve: false }), /必须写明修改意见/);
  await f.run(f.lead, REVIEW_TOOL, { role: 'lv-bu', approve: false, feedback: '先别动数据库' });
  assert.match(f.call(f.mate, 'edit', { file_path: 'a.js' }), /被退回.*先别动数据库/);
  await assert.rejects(f.run(f.lead, REVIEW_TOOL, { role: 'lv-bu', approve: true }), /没有待审批的计划/);
  await f.run(f.mate, SUBMIT_TOOL, { plan: 'v2' });
  await f.run(f.lead, REVIEW_TOOL, { role: 'lv-bu', approve: true });
  assert.equal(f.call(f.mate, 'edit', { file_path: 'a.js' }), undefined);
  f.gate.reset({ id: 'T' }, ['lv-bu']);
  assert.match(f.call(f.mate, 'edit', { file_path: 'a.js' }), /尚未提交计划/);
});
test('未开启 planFirst 的角色不受影响，也不能提交计划；只有主控能审批', async () => {
  const f = fixture(false);
  assert.equal(f.call(f.mate, 'bash'), undefined);
  await assert.rejects(f.run(f.mate, SUBMIT_TOOL, { plan: 'x' }), /不需要提交计划/);
  await assert.rejects(f.run(f.mate, REVIEW_TOOL, { role: 'lv-bu', approve: true }), /只有主控/);
  assert.throws(() => effectiveConfig({ capabilities: { qa: { planFirst: 'yes' } } }), /planFirst 必须为布尔值/);
});
