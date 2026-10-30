import test from 'node:test';
import assert from 'node:assert/strict';
import { configDefinition, applyConfigProjection } from '../config-projection.js';
const fold = events => events.reduce((s, e) => configDefinition.apply(s, e), configDefinition.init());
const view = s => configDefinition.wire.viewSchema.parse(configDefinition.wire.view(s));
test('只统计成功的团队配置保存、导入与模型策略保存', () => {
  const state = fold([
    { type: 'tool/call', data: { name: 'capability_team_save', callId: 'a' } },
    { type: 'tool/result', data: { message: { toolCallId: 'a', isError: false } } },
    { type: 'tool/call', data: { name: 'capability_team_import', callId: 'b' } },
    { type: 'tool/result', data: { message: { toolCallId: 'b', isError: true } } }, // rejected or cancelled
    { type: 'tool/call', data: { name: 'read', callId: 'c' } },
    { type: 'tool/result', data: { message: { toolCallId: 'c', isError: false } } },
    { type: 'command/run', data: { name: 'capability-model-policy', commandId: 'p1' } },
    { type: 'command/done', data: { commandId: 'p1', kind: 'success' } },
    { type: 'command/run', data: { name: 'capability-status', commandId: 's1' } },
    { type: 'command/done', data: { commandId: 's1', kind: 'success' } },
  ]);
  assert.deepEqual(view(state), { version: 2 });
  assert.deepEqual(state.pending, []);
  assert.equal(configDefinition.stateSchema.parse(JSON.parse(JSON.stringify(state))).version, 2);
  const idle = fold([]);
  assert.equal(configDefinition.apply(idle, { type: 'step/start', data: {} }), idle);
});
test('注册表缺席时不注册', () => {
  const keys = [];
  applyConfigProjection({ inject: (deps, fn) => fn({ effect: f => f(), sessionProjections: { register: d => keys.push(d.key) } }) });
  assert.deepEqual(keys, ['capabilityTeamConfig']);
  applyConfigProjection({});
});
