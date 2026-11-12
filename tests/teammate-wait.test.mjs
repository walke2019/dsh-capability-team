import test from 'node:test';
import assert from 'node:assert/strict';
import { teammateWaitDenial, applyTeammateWait, TEAMMATE_WAIT_DENIAL } from '../teammate-wait.js';
import { policy } from '../roles.js';
import { fixtureNative } from './helpers/backend-native-fixture.mjs';

test('队友调用 wait_agent（含前缀别名）被拒绝并提示结束本轮；主控与其他工具不受影响', () => {
  const mate = { role: 'teammate' };
  assert.equal(teammateWaitDenial({ name: 'wait_agent' }, mate), TEAMMATE_WAIT_DENIAL);
  assert.equal(teammateWaitDenial({ name: 'mcp__x__team_wait_agent' }, mate), TEAMMATE_WAIT_DENIAL);
  assert.equal(teammateWaitDenial({ name: 'wait_agent' }, { role: 'lead' }), undefined);
  assert.equal(teammateWaitDenial({ name: 'wait_agent' }, undefined), undefined);
  assert.equal(teammateWaitDenial({ name: 'list_agents' }, mate), undefined);
  assert.match(TEAMMATE_WAIT_DENIAL, /end this turn/);
});

test('只在能力协作预设内生效：默认预设的队友仍可调用原生 wait_agent', () => {
  let guard;
  const preset = { value: 'standard' };
  const ctx = {
    effect: fn => fn(),
    tools: { guard: fn => { guard = fn; return () => {}; } },
    agentTeams: { tryMembership: agent => ({ role: agent.role, root: owner }) },
    agentPresets: { composedPreset: () => preset.value },
  };
  const owner = { ctx: {} };
  applyTeammateWait(ctx, fixtureNative(ctx));
  const mate = { role: 'teammate', ctx: {} };
  assert.equal(guard({ name: 'wait_agent', agent: mate }), undefined, 'standard preset is untouched');
  preset.value = 'capability-team';
  assert.equal(guard({ name: 'wait_agent', agent: mate }), TEAMMATE_WAIT_DENIAL);
  assert.equal(guard({ name: 'wait_agent', agent: { role: 'lead', ctx: {} } }), undefined, 'the Lead still waits');
});

test('团队策略写明：依赖任务前置完成后再派发；队友不等待', () => {
  assert.match(policy, /Dispatch dependent tasks only after prerequisites finish/);
  assert.match(policy, /Teammates must not call wait_agent/);
});
