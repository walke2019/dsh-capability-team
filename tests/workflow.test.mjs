import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflow, validatePlan, decide } from '../workflow.js';
import { effectiveConfig, applyPatch, describeChanges } from '../config.js';
import { base } from './fixture.mjs';

const effective = effectiveConfig({}, base);
const W = effective.workflow;

function harness(overrides = {}) {
  const eff = effectiveConfig(overrides, base);
  let guard; let claimed; const tools = {};
  const lead = { id: 'lead' }; const mate = { id: 'mate' };
  const ctx = {
    effect: f => f(), on: (name, fn) => { if (name === 'agent/inbox/claimed') claimed = fn; },
    tools: { guard: g => { guard = g; return () => {}; }, register: t => { tools[t.name] = t; return () => {}; } },
    agentTeams: { tryMembership: a => a === lead ? { role: 'lead' } : a === mate ? { role: 'teammate', name: 'lv-bu' } : undefined },
  };
  const team = { base, pinned: () => 'P', loadSync: () => ({ effective: eff }), load: async () => ({ effective: eff }) };
  const wf = createWorkflow(ctx, team); wf.register();
  const call = (agent, name, args = {}) => guard({ agent, name, arguments: args });
  const plan = args => tools.capability_dispatch_plan.execute(args, { agent: lead });
  const user = () => claimed({ agent: lead, message: { source: { kind: 'user' } } });
  return { wf, lead, mate, call, plan, user, tools, claimed: m => claimed({ agent: lead, message: m }) };
}

test('默认配置启用强制工作流，档位/工具清单可校验', () => {
  assert.equal(W.mode, 'enforce');
  assert.ok(W.coordinationTools.includes('spawn_teammate'));
  assert.throws(() => effectiveConfig({ workflow: { mode: 'always' } }, base), /工作流模式/);
  assert.throws(() => effectiveConfig({ workflow: { analysisTools: ['read'], coordinationTools: ['read'] } }, base), /不能同时/);
  assert.throws(() => effectiveConfig({ workflow: { extra: 1 } }, base), /未知字段/);
});

test('未制定计划时：少量只读分析可以，执行类工具被拒绝并引导调用 capability_dispatch_plan', () => {
  const h = harness();
  h.user();
  for (let i = 0; i < W.analysisBudget; i++) assert.equal(h.call(h.lead, 'read'), undefined);
  assert.match(h.call(h.lead, 'read'), /只读分析已用满/);
  assert.match(h.call(h.lead, 'pwsh'), /capability_dispatch_plan/);
  assert.match(h.call(h.lead, 'spawn_teammate', { name: 'lv-bu' }), /先调用 capability_dispatch_plan/);
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
  const out = await h.plan({ analysis: '需要后端接口和测试', mode: 'delegate', assignments: [{ role: 'lv-bu', task: '实现接口' }, { role: 'zhou-yu', task: '回归测试' }] });
  const result = JSON.parse(out);
  assert.equal(result.decision, '指派队友');
  assert.deepEqual(result.assignments.map(a => [a.displayName, a.role, a.task]), [['吕布', 'lv-bu', '实现接口'], ['周瑜', 'zhou-yu', '回归测试']]);
  assert.ok(result.assignments.every(a => a.capability && a.model), '每项带能力与模型');
  assert.equal(h.call(h.lead, 'spawn_teammate', { name: 'lv-bu' }), undefined);
  assert.match(h.call(h.lead, 'spawn_teammate', { name: 'diao-chan' }), /不在本轮指派计划/);
  assert.match(h.call(h.lead, 'pwsh'), /主控只负责分派/);
  assert.match(h.call(h.lead, 'write'), /主控只负责分派/);
  assert.equal(h.call(h.lead, 'read'), undefined, '验收时可只读查看');
  assert.match(h.wf.status(h.lead, W), /吕布\(lv-bu\)、周瑜\(zhou-yu\)/);
});

test('direct：有理由且执行次数有限，超出后要求改为指派', async () => {
  const h = harness();
  h.user();
  await h.plan({ analysis: '查看版本号', mode: 'direct', reason: '单条命令即可' });
  for (let i = 0; i < W.directBudget; i++) assert.equal(h.call(h.lead, 'pwsh'), undefined);
  assert.match(h.call(h.lead, 'pwsh'), /已达本轮上限/);
  // Replanning replaces the plan.
  await h.plan({ analysis: '扩大为排查', mode: 'delegate', assignments: [{ role: 'zhao-yun', task: '排查' }] });
  assert.match(h.call(h.lead, 'pwsh'), /主控只负责分派/);
});

test('free：只能调用免费通道，主控不能自己执行；其他模式下不能调用免费通道', async () => {
  const h = harness();
  h.user();
  assert.match(h.call(h.lead, 'capability_free_task'), /capability_dispatch_plan/);
  const out = await h.plan({ analysis: '总结给定的长文', mode: 'free', reason: '纯文本、输出长、无敏感内容' });
  assert.match(out, /交给免费模型/);
  assert.match(out, /没有工具/);
  assert.equal(h.call(h.lead, 'capability_free_task'), undefined);
  assert.match(h.call(h.lead, 'pwsh'), /本轮已选择 free/);
  assert.match(h.call(h.lead, 'spawn_teammate', { name: 'lv-bu' }), /不在本轮指派计划/);
  assert.equal(h.call(h.lead, 'read'), undefined, '验收可只读查看');
  await h.plan({ analysis: '改为小事', mode: 'direct', reason: '一条命令' });
  assert.match(h.call(h.lead, 'capability_free_task'), /不是 free/);
});
test('free 计划提示随工具级别变化，级别与模型列表可校验', async () => {
  for (const [tools, re] of [['none', /没有工具/], ['read', /读取和搜索项目文件/], ['write', /新建和编辑项目文件/]]) {
    const h = harness({ workflow: { freeTools: tools } });
    h.user();
    assert.match(await h.plan({ analysis: 'a', mode: 'free', reason: 'r' }), re, tools);
  }
  assert.equal(effective.workflow.freeTools, 'none', '默认无工具');
  assert.deepEqual(effective.workflow.freeModels, [], '默认使用目录中全部免费模型');
  assert.throws(() => effectiveConfig({ workflow: { freeTools: 'shell' } }, base), /none \/ read \/ write/);
  assert.throws(() => effectiveConfig({ workflow: { freeModels: 'x' } }, base), /免费模型列表/);
  assert.throws(() => validatePlan({ analysis: 'a', mode: 'free' }, effective), /理由/);
});
test('新的用户消息开启新一轮，队友汇报不重置计划', async () => {
  const h = harness();
  h.user();
  await h.plan({ analysis: 'x', mode: 'delegate', assignments: [{ role: 'lv-bu', task: 't' }] });
  h.claimed({ source: { kind: 'team' } });
  assert.match(h.wf.status(h.lead, W), /lv-bu/);
  h.user();
  assert.match(h.wf.status(h.lead, W), /尚未指派/);
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
  assert.throws(() => validatePlan({ analysis: 'a', mode: 'delegate', assignments: [{ role: 'ghost', task: 't' }] }, effective), /未在当前项目团队配置中登记/);
  assert.throws(() => validatePlan({ analysis: 'a', mode: 'delegate', assignments: [{ role: 'lead', task: 't' }] }, effective), /主控自己/);
  assert.throws(() => validatePlan({ analysis: 'a', mode: 'direct' }, effective), /理由/);
  assert.throws(() => validatePlan({ analysis: 'a', mode: 'delegate', assignments: [] }, effective), /至少/);
  assert.throws(() => validatePlan({ analysis: 'a', mode: 'direct', reason: 'r', assignments: [{ role: 'lv-bu', task: 't' }] }, effective), /不能同时/);
  assert.throws(() => validatePlan({ analysis: 'a', mode: 'delegate', assignments: [{ role: 'lv-bu', task: 't' }, { role: 'lv-bu', task: 'u' }] }, effective), /重复/);
});

test('计划随项目配置的角色变化：对话新增的角色可被指派', () => {
  const eff = effectiveConfig({ roles: { 'guan-yu': { displayName: '关羽', capability: 'backend' } } }, base);
  const plan = validatePlan({ analysis: 'a', mode: 'delegate', assignments: [{ role: 'guan-yu', task: 't' }] }, eff);
  assert.equal(plan.assignments[0].displayName, '关羽');
});

test('工具分类可通过项目配置调整', () => {
  const custom = effectiveConfig({ workflow: { analysisTools: ['read', 'pwsh'] } }, base).workflow;
  const s = { plan: { mode: 'delegate', assignments: [{ role: 'lv-bu' }] }, analysisUsed: 0, directUsed: 0 };
  assert.equal(decide(s, { name: 'pwsh' }, custom, ''), undefined);
});

test('对话保存：workflow 按字段合并、null 恢复默认，变更出现在确认差异中', () => {
  const o1 = applyPatch({}, { workflow: { directBudget: 5 } });
  assert.deepEqual(o1.workflow, { directBudget: 5 });
  const o2 = applyPatch(o1, { workflow: { mode: 'remind' } });
  assert.deepEqual(o2.workflow, { directBudget: 5, mode: 'remind' });
  assert.equal(applyPatch(o2, { workflow: null }).workflow, undefined);
  const lines = describeChanges(effective, effectiveConfig(o2, base));
  assert.ok(lines.some(l => l.startsWith('工作流约束')), lines.join('\n'));
  assert.throws(() => applyPatch({}, { workflow: { bogus: 1 } }), /未知字段/);
});
