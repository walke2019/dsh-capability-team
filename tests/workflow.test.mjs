import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflow, validatePlan, decide } from '../workflow.js';
import { effectiveConfig, applyPatch, describeChanges } from '../config.js';
import { base } from './fixture.mjs';

const legacyWorkflow = { mode: 'enforce' };
const effective = effectiveConfig({ workflow: legacyWorkflow }, base);
const W = effective.workflow;

function harness(overrides = {}) {
  const eff = effectiveConfig({ ...overrides, workflow: { ...legacyWorkflow, ...overrides.workflow } }, base);
  let guard; let claimed; const tools = {};
  const lead = { id: 'lead' }; const mate = { id: 'mate' };
  const ctx = { agentPresets: { composedPreset: () => 'capability-team' },
    effect: f => f(), on: (name, fn) => { if (name === 'agent/inbox/claimed') claimed = fn; },
    tools: { guard: g => { guard = g; return () => {}; }, register: t => { tools[t.name] = t; return () => {}; } },
    agentTeams: { tryMembership: a => a === lead ? { role: 'lead' } : a === mate ? { role: 'teammate', name: 'backend' } : undefined },
  };
  const team = { base, pinned: () => 'P', loadSync: () => ({ effective: eff }), load: async () => ({ effective: eff }) };
  const wf = createWorkflow(ctx, team); wf.register();
  const call = (agent, name, args = {}) => guard({ agent, name, arguments: args });
  const plan = args => tools.capability_dispatch_plan.execute(args, { agent: lead });
  const user = () => claimed({ agent: lead, message: { source: { kind: 'user' } } });
  return { wf, lead, mate, call, plan, user, tools, claimed: m => claimed({ agent: lead, message: m }) };
}

test('Explicit enforcement preserves workflow validation', () => {
  assert.equal(W.mode, 'enforce');
  assert.ok(W.coordinationTools.includes('spawn_teammate'));
  assert.throws(() => effectiveConfig({ workflow: { mode: 'always' } }, base), /Workflow mode/);
  assert.throws(() => effectiveConfig({ workflow: { analysisTools: ['read'], coordinationTools: ['read'] } }, base), /cannot be both/);
  assert.throws(() => effectiveConfig({ workflow: { extra: 1 } }, base), /unknown fields/);
});

test('未制定计划时：少量只读分析可以，执行类工具被拒绝并引导调用 capability_dispatch_plan', () => {
  const h = harness();
  h.user();
  for (let i = 0; i < W.analysisBudget; i++) assert.equal(h.call(h.lead, 'read'), undefined);
  assert.match(h.call(h.lead, 'read'), /read-only analysis budget exhausted/);
  assert.match(h.call(h.lead, 'pwsh'), /capability_dispatch_plan/);
  assert.match(h.call(h.lead, 'spawn_teammate', { name: 'backend' }), /Call capability_dispatch_plan/);
  assert.equal(h.call(h.lead, 'list_agents'), undefined, '协调类工具不受限');
});

test('队友不受主控工作流约束', () => {
  const h = harness();
  assert.equal(h.call(h.mate, 'pwsh'), undefined);
  assert.equal(h.call(undefined, 'pwsh'), undefined);
});

test('delegate：只能创建计划内角色，主控不能亲自执行', async () => {
  const h = harness();
  h.user();
  const out = await h.plan({ analysis: '需要后端接口和测试', mode: 'delegate', assignments: [{ role: 'backend', task: '实现接口' }, { role: 'qa', task: '回归测试' }] });
  const result = JSON.parse(out);
  assert.equal(result.decision, 'Delegate to teammates');
  assert.deepEqual(result.assignments.map(a => [a.displayName, a.role, a.task]), [['Backend', 'backend', '实现接口'], ['QA', 'qa', '回归测试']]);
  assert.ok(result.assignments.every(a => a.capability && a.model), '每项带能力与模型');
  assert.equal(h.call(h.lead, 'spawn_teammate', { name: 'backend' }), undefined);
  assert.match(h.call(h.lead, 'spawn_teammate', { name: 'frontend' }), /not assigned in this turn's plan/);
  assert.match(h.call(h.lead, 'pwsh'), /Lead only dispatches/);
  assert.match(h.call(h.lead, 'write'), /Lead only dispatches/);
  assert.equal(h.call(h.lead, 'read'), undefined, '验收时可只读查看');
  assert.match(h.wf.status(h.lead, W), /Backend\(backend\)、QA\(qa\)/);
});

test('direct：有理由且执行次数有限，超出后要求改为指派', async () => {
  const h = harness();
  h.user();
  await h.plan({ analysis: '查看版本号', mode: 'direct', reason: '单条命令即可' });
  for (let i = 0; i < W.directBudget; i++) assert.equal(h.call(h.lead, 'pwsh'), undefined);
  assert.match(h.call(h.lead, 'pwsh'), /reached this turn's direct execution limit/);
  // Replanning replaces the plan.
  await h.plan({ analysis: '扩大为排查', mode: 'delegate', assignments: [{ role: 'researcher', task: '排查' }] });
  assert.match(h.call(h.lead, 'pwsh'), /Lead only dispatches/);
});

test('direct + userRequested：没有确认通道时模型声明不生效，仍受执行预算限制', async () => {
  const h = harness();
  h.user();
  const out = JSON.parse(await h.plan({ analysis: '用户要求主控亲自修复', mode: 'direct', reason: '用户说“你自己改，不要派人”', userRequested: true }));
  assert.equal(out.directBudget, W.directBudget);
  assert.equal(out.userRequested, undefined);
  assert.equal(h.wf.state(h.lead).plan.userRequested, undefined);
  for (let i = 0; i < W.directBudget; i++) assert.equal(h.call(h.lead, 'pwsh'), undefined);
  assert.match(h.call(h.lead, 'pwsh'), /reached this turn's direct execution limit/);
  assert.doesNotMatch(h.wf.status(h.lead, W), /不限执行/);
  assert.doesNotMatch(out.next, /不限执行/);
  // Model flags and user-looking reason strings never establish confirmation.
  h.user();
  await h.plan({ analysis: '小事', mode: 'direct', reason: '一条命令', userRequested: 'yes' });
  for (let i = 0; i < W.directBudget; i++) assert.equal(h.call(h.lead, 'pwsh'), undefined);
  assert.match(h.call(h.lead, 'pwsh'), /reached this turn's direct execution limit/);
  assert.match(decide({ plan: { mode: 'direct', userRequested: true }, directUsed: W.directBudget }, { name: 'pwsh' }, W), /reached this turn's direct execution limit/);
  assert.equal(validatePlan({ analysis: 'a', mode: 'free', reason: 'r', userRequested: true }, effective).userRequested, undefined);
});

test('free：只能调用免费通道，主控不能自己执行；其他模式下不能调用免费通道', async () => {
  const h = harness();
  h.user();
  assert.match(h.call(h.lead, 'capability_free_task'), /capability_dispatch_plan/);
  const out = await h.plan({ analysis: '总结给定的长文', mode: 'free', reason: '纯文本、输出长、无敏感内容' });
  assert.match(out, /free model/);
  assert.match(out, /no tools/);
  assert.equal(h.call(h.lead, 'capability_free_task'), undefined);
  assert.match(h.call(h.lead, 'pwsh'), /This turn selected free/);
  assert.match(h.call(h.lead, 'spawn_teammate', { name: 'backend' }), /not assigned in this turn's plan/);
  assert.equal(h.call(h.lead, 'read'), undefined, '验收可只读查看');
  await h.plan({ analysis: '改为小事', mode: 'direct', reason: '一条命令' });
  assert.match(h.call(h.lead, 'capability_free_task'), /not free/);
});
test('free 计划提示随工具级别变化，级别与模型列表可校验', async () => {
  for (const [tools, re] of [['none', /no tools/], ['read', /read and search project files/], ['write', /create and edit project files/]]) {
    const h = harness({ workflow: { freeTools: tools } });
    h.user();
    assert.match(await h.plan({ analysis: 'a', mode: 'free', reason: 'r' }), re, tools);
  }
  assert.equal(effective.workflow.freeTools, 'none', '默认无工具');
  assert.deepEqual(effective.workflow.freeModels, [], '默认使用目录中全部免费模型');
  assert.throws(() => effectiveConfig({ workflow: { freeTools: 'shell' } }, base), /none \/ read \/ write/);
  assert.throws(() => effectiveConfig({ workflow: { freeModels: 'x' } }, base), /Free-model list/);
  assert.throws(() => validatePlan({ analysis: 'a', mode: 'free' }, effective), /[Rr]eason/);
});
test('新的用户消息开启新一轮，队友汇报不重置计划', async () => {
  const h = harness();
  h.user();
  await h.plan({ analysis: 'x', mode: 'delegate', assignments: [{ role: 'backend', task: 't' }] });
  h.claimed({ source: { kind: 'team' } });
  assert.match(h.wf.status(h.lead, W), /backend/);
  h.user();
  assert.match(h.wf.status(h.lead, W), /not dispatched yet/);
  assert.match(h.call(h.lead, 'pwsh'), /capability_dispatch_plan/);
});

test('remind / off 模式不拦截', () => {
  for (const mode of ['remind', 'off']) {
    const h = harness({ workflow: { mode } });
    h.user();
    assert.equal(h.call(h.lead, 'pwsh'), undefined, mode);
  }
  assert.equal(harness({ workflow: { mode: 'off' } }).wf.status({}, { mode: 'off' }), undefined);
});

test('计划校验：未登记角色、指派给主控、direct 无理由、delegate 无指派均被拒绝', () => {
  assert.throws(() => validatePlan({ analysis: 'a', mode: 'delegate', assignments: [{ role: 'ghost', task: 't' }] }, effective), /not registered in this project/);
  assert.throws(() => validatePlan({ analysis: 'a', mode: 'delegate', assignments: [{ role: 'lead', task: 't' }] }, effective), /Lead itself/);
  assert.throws(() => validatePlan({ analysis: 'a', mode: 'direct' }, effective), /[Rr]eason/);
  assert.throws(() => validatePlan({ analysis: 'a', mode: 'delegate', assignments: [] }, effective), /at least/);
  assert.throws(() => validatePlan({ analysis: 'a', mode: 'direct', reason: 'r', assignments: [{ role: 'backend', task: 't' }] }, effective), /cannot also assign teammates/);
  assert.throws(() => validatePlan({ analysis: 'a', mode: 'delegate', assignments: [{ role: 'backend', task: 't' }, { role: 'backend', task: 'u' }] }, effective), /assigned twice/);
});

test('计划随项目配置的角色变化：对话新增的角色可被指派', () => {
  const eff = effectiveConfig({ roles: { 'guan-yu': { displayName: '关羽', capability: 'backend' } } }, base);
  const plan = validatePlan({ analysis: 'a', mode: 'delegate', assignments: [{ role: 'guan-yu', task: 't' }] }, eff);
  assert.equal(plan.assignments[0].displayName, '关羽');
});

test('工具分类可通过项目配置调整', () => {
  const custom = effectiveConfig({ workflow: { analysisTools: ['read', 'pwsh'] } }, base).workflow;
  const s = { plan: { mode: 'delegate', assignments: [{ role: 'backend' }] }, analysisUsed: 0, directUsed: 0 };
  assert.equal(decide(s, { name: 'pwsh' }, custom, ''), undefined);
});

test('对话保存：workflow 按字段合并、null 恢复默认，变更出现在确认差异中', () => {
  const o1 = applyPatch({}, { workflow: { directBudget: 5 } });
  assert.deepEqual(o1.workflow, { directBudget: 5 });
  const o2 = applyPatch(o1, { workflow: { mode: 'remind' } });
  assert.deepEqual(o2.workflow, { directBudget: 5, mode: 'remind' });
  assert.equal(applyPatch(o2, { workflow: null }).workflow, undefined);
  const lines = describeChanges(effective, effectiveConfig(o2, base));
  assert.ok(lines.some(l => l.startsWith('Workflow constraints')), lines.join('\n'));
  assert.throws(() => applyPatch({}, { workflow: { bogus: 1 } }), /unknown fields/);
});

test('delegate 计划把被指派的角色交给 onDelegate（用于让旧的队友计划批准失效）；planFirst 写入指派结果', async () => {
  const eff = effectiveConfig({ capabilities: { backend: { planFirst: true } } }, base);
  const tools = {}; const calls = [];
  const lead = { id: 'lead' };
  const ctx = { agentPresets: { composedPreset: () => 'capability-team' }, effect: f => f(), on: () => {},
    tools: { guard: () => () => {}, register: t => { tools[t.name] = t; return () => {}; } },
    agentTeams: { tryMembership: () => ({ id: 'T', role: 'lead' }), membership: () => ({ id: 'T', role: 'lead', name: 'lead' }) } };
  const team = { base, pinned: () => 'P', loadSync: () => ({ effective: eff }), load: async () => ({ effective: eff }) };
  createWorkflow(ctx, team, { onDelegate: (m, roles) => calls.push([m.id, roles]) }).register();
  const out = JSON.parse(await tools.capability_dispatch_plan.execute({ analysis: 'x', mode: 'delegate', assignments: [{ role: 'backend', task: 't' }, { role: 'qa', task: 'q' }] }, { agent: lead }));
  assert.deepEqual(calls, [['T', ['backend', 'qa']]]);
  assert.match(out.assignments[0].planFirst, /capability_review_plan/);
  assert.equal(out.assignments[1].planFirst, undefined);
  await tools.capability_dispatch_plan.execute({ analysis: 'x', mode: 'direct', reason: '小事' }, { agent: lead });
  assert.equal(calls.length, 1);
});
