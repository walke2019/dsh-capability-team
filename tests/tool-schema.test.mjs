import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.js';
import { assertToolSchema } from '../tool-schema.js';

// Regression: the shorthand `{x: {type, required: true}}` reached Anthropic as invalid
// draft 2020-12 JSON Schema (HTTP 400 "tools.N.custom.input_schema"), failing every turn.
test('每个注册的工具参数都是合法的对象根 JSON Schema，且只用 DSH 支持的关键字', () => {
  const tools = {};
  const created = [];
  const ctx = { agentPresets: { composedPreset: () => 'capability-team' }, effect: f => f(), on: (name, fn) => { if (name === 'agent/created') created.push(fn); }, systemPrompt: { section: () => () => {} },
    tools: { register: t => { tools[t.name] = t; return () => {}; }, guard: () => () => {} }, skills: { register: () => () => {} },
    agents: { list: () => [] }, agentTeams: { membership: () => ({ role: 'lead' }), tryMembership: () => undefined }, workingDirectory: {}, userQuestions: {},
    llm: { listProviders: () => [], listModels: async () => [] } };
  apply(ctx, {});
  // Lead-only and teammate-only tools are installed per agent; collect them by creating one of each.
  const agentCtx = { tools: { register: t => { tools[t.name] = t; return () => {}; } }, systemPrompt: { context: () => () => {} } };
  for (const fn of created) { try { fn({ agent: { id: 'lead', ctx: agentCtx, session: { header: {} } } }); fn({ agent: { id: 'mate', ctx: agentCtx, session: { header: { parentSession: 'lead' } } } }); } catch { /* listeners that need a real team */ } }
  const names = Object.keys(tools);
  assert.ok(names.length >= 6, names.join(','));
  for (const name of names) {
    const p = tools[name].parameters;
    assert.doesNotThrow(() => assertToolSchema(p), name);
    for (const [key, prop] of Object.entries(p.properties)) assert.ok(!('required' in prop), `${name}.${key} 不得使用 required: true 简写`);
  }
  assert.equal(tools.omni_search, undefined, 'omni-search tools belong to the independent profile bundle');
  assert.deepEqual(tools.capability_team_save.parameters.required, ['expected_revision']);
  assert.deepEqual(tools.capability_team_read.parameters, { type: 'object', properties: {} });
});
test('assertToolSchema 拒绝简写 required 与不支持的关键字', () => {
  assert.throws(() => assertToolSchema({ type: 'object', properties: { q: { type: 'string', required: true } } }), /required/);
  assert.throws(() => assertToolSchema({ type: 'object', properties: { n: { type: 'integer', minimum: 1 } } }), /minimum/);
  assert.throws(() => assertToolSchema({ q: { type: 'string' } }), /not a supported keyword/);
});
