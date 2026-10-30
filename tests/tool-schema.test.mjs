import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.js';
import { assertToolSchema } from '../tool-schema.js';

// Regression: the shorthand `{x: {type, required: true}}` reached Anthropic as invalid
// draft 2020-12 JSON Schema (HTTP 400 "tools.N.custom.input_schema"), failing every turn.
test('每个注册的工具参数都是合法的对象根 JSON Schema，且只用 DSH 支持的关键字', () => {
  const tools = {};
  const ctx = { effect: f => f(), on: () => {}, systemPrompt: { section: () => () => {} },
    tools: { register: t => { tools[t.name] = t; return () => {}; }, guard: () => () => {} }, skills: { register: () => () => {} },
    agents: { list: () => [] }, agentTeams: { membership: () => ({ role: 'lead' }) }, workingDirectory: {}, userQuestions: {},
    llm: { listProviders: () => [], listModels: async () => [] } };
  apply(ctx, {});
  const names = Object.keys(tools);
  assert.ok(names.length >= 6, names.join(','));
  for (const name of names) {
    const p = tools[name].parameters;
    assert.doesNotThrow(() => assertToolSchema(p), name);
    for (const [key, prop] of Object.entries(p.properties)) assert.ok(!('required' in prop), `${name}.${key} 不得使用 required: true 简写`);
  }
  assert.deepEqual(tools.cpa_search.parameters.required, ['query']);
  assert.deepEqual(tools.capability_team_save.parameters.required, ['expected_revision']);
  assert.deepEqual(tools.capability_team_read.parameters, { type: 'object', properties: {} });
});
test('assertToolSchema 拒绝简写 required 与不支持的关键字', () => {
  assert.throws(() => assertToolSchema({ type: 'object', properties: { q: { type: 'string', required: true } } }), /required/);
  assert.throws(() => assertToolSchema({ type: 'object', properties: { n: { type: 'integer', minimum: 1 } } }), /minimum/);
  assert.throws(() => assertToolSchema({ q: { type: 'string' } }), /not a supported keyword/);
});
