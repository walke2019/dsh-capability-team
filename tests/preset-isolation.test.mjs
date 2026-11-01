import test from 'node:test';
import assert from 'node:assert/strict';
import { ownsCapabilityTeam, isolatedProjection } from '../preset-guard.js';
import { scopeTools, applySkillCatalog } from '../teammate-context.js';
import { createWorkflow } from '../workflow.js';
import { configDefinition } from '../config-projection.js';
import { handleIntegrations } from '../integrations-config.js';
const agent = preset => ({ id: preset ?? 'plain', ctx: { preset, tools: { register() {} } }, session: { header: {} } });
function fixture(preset, member = false, parent = false) {
  const root = agent(preset), a = parent ? agent(undefined) : root;
  if (parent) a.session.header.parentSession = root.id;
  const events = {}, services = { agents: new Map([[a.id, a]]), agentTeams: { tryMembership: x => member && x === a ? { role: parent ? 'teammate' : 'lead', root } : undefined } };
  const ctx = { ...services, agentPresets: { composedPreset: c => c?.preset }, get: k => services[k], on: (k, fn) => { events[k] = fn; }, tools: { register() {} } };
  return { root, a, ctx, events };
}
for (const [label, preset, member, parent] of [
  ['普通会话', undefined, false, false], ['其他预设', 'standard', false, false],
  ['其他团队', 'other-team', true, true], ['普通subagent', undefined, false, true],
]) test(`${label}：工具、技能与工作流不受影响`, async () => {
  const { ctx, a, events } = fixture(preset, member, parent);
  assert.equal(ownsCapabilityTeam(ctx, a), false);
  let registered = 0; a.ctx.tools.register = () => { registered++; };
  const scoped = scopeTools(ctx); scoped.ctx.tools.register({ name: 'capability_dispatch_plan' }); scoped.installExisting();
  events['agent/created']({ agent: a }); assert.equal(registered, 0);
  applySkillCatalog(ctx, () => 'none');
  const decision = { messages: [{ source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: 'unchanged' }] }] };
  assert.equal(await events['agent/pre-step']({ agent: a }, async () => decision), decision);
  assert.equal(createWorkflow(ctx, {}).guard({ agent: a, name: 'pwsh' }), undefined);
  const p = isolatedProjection(ctx, configDefinition), state = p.init({ id: a.id });
  assert.deepEqual(p.wire.view(p.apply(state, { type: 'tool/call', data: { name: 'capability_team_save', callId: 'c' } })), { version: 0 });
  const response = await handleIntegrations(new Request(`https://host.test/api?sessionId=${a.id}`), { ctx });
  assert.equal(response.status, 404);
});
test('本预设主控与成员按根会话识别，缺原生API时关闭', () => {
  for (const parent of [false, true]) {
    const { ctx, a } = fixture('capability-team', true, parent);
    assert.equal(ownsCapabilityTeam(ctx, a), true);
  }
  assert.equal(ownsCapabilityTeam({}, agent('capability-team')), false);
});
