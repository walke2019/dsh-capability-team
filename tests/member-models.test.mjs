import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMemberModels, correctRoster, selectedRoute } from '../member-models.js';

const agentOn = (provider, model, preset = 'capability-team') => ({ ctx: { preset }, model: { current: () => ({ provider, model }) } });
function fixture({ preset = 'capability-team' } = {}) {
  const lead = { id: 'L', ...agentOn('cpa', 'claude-opus-5-5', preset) };
  const researcher = { id: 'R', ...agentOn('cpa', 'gemini-3.8-flash-high', preset) };
  const agents = new Map([['L', lead], ['R', researcher]]);
  const listeners = {};
  const ctx = {
    agents: { get: id => agents.get(id) },
    agentPresets: { composedPreset: c => c.preset },
    agentTeams: {
      tryMembership: agent => agent === lead ? { role: 'lead', root: lead, name: 'lead' } : { role: 'teammate', root: lead, name: 'researcher' },
      listMembers: () => [{ id: 'L', name: 'lead', role: 'lead' }, { id: 'R', name: 'researcher', role: 'teammate' }],
    },
    on: (event, fn) => { listeners[event] = fn; },
  };
  applyMemberModels(ctx);
  // DSH's native roster rows: model is the inherited Lead model.
  const rows = [{ target: 'lead', role: 'lead', status: 'running', model: 'claude-opus-5-5', diagnostics: [] },
    { target: 'researcher', role: 'teammate', status: 'inactive', provider: 'spawn', model: 'claude-opus-5-5', diagnostics: [] }];
  const run = (name, value, decision = { kind: 'accept' }, result = { isError: false, value }) =>
    listeners['tools/post-execute']({ name, agent: lead }, result, async () => decision);
  return { run, rows, lead, researcher };
}

test('list_agents reports each teammate with its selected role model, not the inherited Lead model', async () => {
  const f = fixture();
  const decision = await f.run('list_agents', f.rows);
  assert.equal(decision.kind, 'accept');
  assert.equal(decision.value[1].model, 'gemini-3.8-flash-high');
  assert.equal(decision.value[1].provider, 'spawn', 'the backend provider field is untouched');
  assert.equal(decision.value[0].model, 'claude-opus-5-5');
  assert.equal(f.rows[1].model, 'claude-opus-5-5', 'the native value is not mutated');
});

test('spawn_teammate member row and host-prefixed tool names are corrected too', async () => {
  const f = fixture();
  const spawned = await f.run('spawn_teammate', { member: f.rows[1] });
  assert.equal(spawned.value.member.model, 'gemini-3.8-flash-high');
  const prefixed = await f.run('mcp__host__brisk_list_agents', f.rows);
  assert.equal(prefixed.value[1].model, 'gemini-3.8-flash-high');
});

test('rows already correct, other tools, other presets, errors and earlier replacements pass through unchanged', async () => {
  const f = fixture();
  const accurate = f.rows.map(r => ({ ...r, model: r.target === 'lead' ? 'claude-opus-5-5' : 'gemini-3.8-flash-high' }));
  assert.deepEqual(await f.run('list_agents', accurate), { kind: 'accept' });
  assert.deepEqual(await f.run('team_task_list', f.rows), { kind: 'accept' });
  assert.deepEqual(await f.run('list_agents', f.rows, { kind: 'accept' }, { isError: true }), { kind: 'accept' });
  const replaced = { kind: 'accept', content: [{ type: 'text', text: 'x' }] };
  assert.equal(await f.run('list_agents', f.rows, replaced), replaced);
  const other = fixture({ preset: 'standard' });
  assert.deepEqual(await other.run('list_agents', other.rows), { kind: 'accept' });
});

test('helpers tolerate unknown members and broken model readers', () => {
  assert.equal(selectedRoute({ model: { current: () => { throw new Error('gone'); } } }), undefined);
  assert.equal(selectedRoute(undefined), undefined);
  const rows = [{ target: 'ghost', model: 'm' }];
  assert.equal(correctRoster(rows, () => undefined), rows);
  assert.equal(correctRoster('text', () => undefined), 'text');
});
