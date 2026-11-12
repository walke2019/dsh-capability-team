import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveConfig, applyPatch, seed } from '../config.js';
import { policyText, apply as applyRoles, preselect } from '../roles.js';
import { createWorkflow } from '../workflow.js';
import { createTokenDiscipline, TOKEN_RULES } from '../token-discipline.js';
import { ROTATION, createRotation } from '../session-rotation.js';
import { teamContext } from '../theme-plugin.js';
import { fixtureNative } from './helpers/backend-native-fixture.mjs';

const defaults = { mode: 'off', confirmDispatch: 'on-change', enforceWriteScopes: false, fileLimits: false, rotation: false, tokens: false };
test('Native-first defaults preserve explicit legacy settings without mutation', () => {
  const effective = effectiveConfig();
  for (const [key, value] of Object.entries(defaults)) assert.equal(effective.workflow[key], value);
  const old = { workflow: { mode: 'enforce', confirmDispatch: 'on-change', enforceWriteScopes: true, fileLimits: {}, rotation: {}, tokens: {} } };
  const before = structuredClone(old);
  const legacy = effectiveConfig(old);
  assert.equal(legacy.workflow.mode, 'enforce');
  assert.equal(legacy.workflow.confirmDispatch, 'on-change');
  assert.deepEqual(legacy.workflow.rotation, ROTATION);
  assert.deepEqual(legacy.workflow.tokens, TOKEN_RULES);
  assert.deepEqual(old, before);
  assert.equal(effectiveConfig({ workflow: { tokens: false } }).workflow.tokens, false);
  assert.deepEqual(effectiveConfig({ workflow: { tokens: null } }).workflow.tokens, TOKEN_RULES);
  assert.equal(effectiveConfig(applyPatch(old, { workflow: null })).workflow.mode, 'off');
  assert.equal(effective.capabilities.backend.planFirst, undefined);
  assert.equal(effective.capabilities.backend.maxTokens, undefined);
});

test('Policy is stable and optional rules follow effective config, not counters or time', () => {
  const plain = policyText(effectiveConfig());
  assert.doesNotMatch(plain, /capability_dispatch_plan|Token rules|source files|rotation thresholds|execution limit/);
  const enabled = effectiveConfig({ workflow: { mode: 'enforce', fileLimits: {}, tokens: {}, rotation: {}, enforceWriteScopes: true } });
  assert.match(policyText(enabled), /capability_dispatch_plan/);
  assert.match(policyText(enabled), /Token rules/);
  assert.equal(policyText(enabled), policyText(enabled));
  assert.equal(policyText(effectiveConfig()), plain);
});

function harness() {
  const lead = { id: 'lead', session: {} }, mate = { id: 'mate', session: {} };
  let effective = effectiveConfig();
  const events = {}, tools = {};
  const ctx = { agentPresets: { composedPreset: () => 'capability-team' },
    agentTeams: { tryMembership: a => a === lead ? { role: 'lead', name: 'lead' } : { role: 'teammate', name: 'backend', root: lead } },
    on: (name, fn) => { events[name] = fn; }, effect: fn => fn(),
    tools: { guard: () => () => {}, register: tool => { tools[tool.name] = tool; return () => {}; } },
    get: name => name === 'sessionProjections' ? { stateOf: (_session, key) => key === 'tokenUsage' ? { inputTokens: 100, outputTokens: 10 } : undefined } : undefined };
  const team = { native: fixtureNative(ctx), base: seed, pinned: () => '/project', loadSync: () => ({ effective }), load: async () => ({ effective }) };
  return { ctx, team, lead, mate, events, tools, set: patch => { effective = effectiveConfig(patch); } };
}
test('Dynamic off leaves native spawn/send/board unrestricted and hides dispatch status', () => {
  const h = harness(), wf = createWorkflow(h.ctx, h.team);
  for (const name of ['spawn_teammate', 'send_message', 'team_task_create', 'write']) assert.equal(wf.guard({ agent: h.lead, name, arguments: { name: 'backend' } }), undefined);
  h.set({ workflow: { mode: 'enforce' } });
  assert.match(wf.guard({ agent: h.lead, name: 'spawn_teammate', arguments: { name: 'backend' } }), /capability_dispatch_plan/);
  h.set({ workflow: { mode: 'off' } });
  assert.equal(wf.guard({ agent: h.lead, name: 'write' }), undefined);
  const text = teamContext(h.team, h.lead, { role: 'lead', name: 'lead' }, undefined, { status: () => { throw new Error('Disabled status called'); } });
  assert.doesNotMatch(text, /Disabled status called/);
});

test('tokens false disables output rewriting and idle compaction but keeps native usage samples', async () => {
  const h = harness(), td = createTokenDiscipline(h.ctx, h.team);
  td.register();
  assert.equal(await td.trim({ agent: h.mate, name: 'bash' }, { content: [{ type: 'text', text: 'x'.repeat(9000) }] }), undefined);
  assert.equal(await td.compactIdle(h.mate), false);
  await h.events['agent/request']({ agent: h.mate, turn: 1, step: 1 }, async () => ({ provider: 'p', model: 'm' }));
  assert.equal(td.metrics.snapshot(h.mate).steps[0].prompt, 100);
  assert.equal(td.metrics.snapshot(h.mate).steps[0].output, 10);
});

test('rotation false does not guard messages and retains manual handoff APIs', async () => {
  const h = harness(), rotation = createRotation(h.ctx, h.team);
  assert.equal(await rotation.guard({ agent: h.lead, name: 'send_message', arguments: { target: 'backend' } }), undefined);
  assert.equal(typeof rotation.writeHandoff, 'function');
  assert.equal(typeof rotation.rotate, 'function');
  assert.deepEqual(rotation.status(h.mate), { level: 'ok', reasons: [] });
});

test('Unavailable failover routes stop before selection and are skipped by preselection', async () => {
  const h = harness();
  h.team.owns = () => true;
  h.team.resolve = async () => ({ id: 'backend', provider: 'p', model: 'm' });
  let selections = 0;
  h.mate.model = { select: () => { selections++; }, current: () => ({ provider: 'parent', model: 'parent' }) };
  const failover = { route: () => ({ unavailable: true, reason: 'no-healthy-untried-route' }) };
  applyRoles(h.ctx, h.team, failover);
  await assert.rejects(h.events['agent/request']({ agent: h.mate, turn: 1, step: 1 }, async () => ({ provider: 'parent', model: 'parent' })), /no healthy untried model route/);
  await preselect(h.ctx, h.team, failover, h.mate);
  assert.equal(selections, 0);
});
