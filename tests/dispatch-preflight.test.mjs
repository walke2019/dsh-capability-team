import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyDispatchPreflight } from '../dispatch-preflight.js';
import { createFailover } from '../failover.js';
import { createTeam } from '../team.js';
import { seed } from '../config.js';
import { fakeLlm } from './fixture.mjs';
import { setRouteStore, forgetLead } from '../dispatch-confirm.js';

const args = { name: 'backend', description: 'Implement backend', prompt: 'Implement and test', context: 'fresh' };
function harness() {
  const lead = { id: 'preflight-lead' }, mate = { id: 'mate' };
  let preset = 'capability-team', hook, calls = 0;
  const ctx = { agentPresets: { composedPreset: () => preset },
    agentTeams: { tryMembership: agent => ({ role: agent === lead ? 'lead' : 'teammate' }) },
    on: (name, fn) => { assert.equal(name, 'tools/pre-execute'); hook = fn; } };
  const team = { resolveMember: async () => { calls++; return { id: 'backend', provider: 'p', model: 'm' }; } };
  const failover = createFailover();
  applyDispatchPreflight(ctx, team, failover);
  return { ctx, team, failover, lead, mate, count: () => calls, preset: value => { preset = value; },
    run: (overrides = {}, downstream = { kind: 'allow' }) => hook({ agent: lead, name: 'spawn_teammate', arguments: args, ...overrides }, async () => downstream) };
}
test('Only capability-team Lead spawn is checked, independent of workflow mode', async () => {
  const h = harness();
  for (const name of ['spawn_teammate', 'brisk_spawn_teammate', 'mcp__s__brisk_spawn_teammate']) assert.equal((await h.run({ name })).kind, 'allow');
  assert.equal(h.count(), 3);
  await h.run({ name: 'send_message' }); await h.run({ agent: h.mate });
  h.preset('standard'); await h.run();
  assert.equal(h.count(), 3);
});
test('Native policy ask/deny/cancel and malformed arguments pass through without catalog reads', async () => {
  const h = harness();
  for (const kind of ['ask', 'deny', 'cancel']) {
    const gate = { kind, reason: 'native', info: { original: true } };
    assert.equal(await h.run({}, gate), gate);
  }
  for (const name of [undefined, null, '', ' lead ', 'lead', 'UPPER', 'bad_name', 'x'.repeat(65)]) await h.run({ arguments: { ...args, name } });
  for (const invalid of [{ description: undefined }, { description: 1 }, { prompt: undefined }, { prompt: false }, { context: 'other' }]) await h.run({ arguments: { ...args, ...invalid } });
  assert.equal(h.count(), 0);
});
test('Unassigned, unknown, disabled and unregistered routes return actionable denial before creation', async () => {
  const h = harness();
  h.team.resolveMember = async () => ({ unassigned: true });
  assert.match((await h.run()).reason, /not created.*no assigned model.*capability_team_save/);
  h.team.resolveMember = async () => { throw new Error('SENTINEL_PRIVATE_CONFIGURATION'); };
  const denied = await h.run();
  assert.match(denied.reason, /not created.*capability_team_read.*register the role/);
  assert.doesNotMatch(denied.reason, /SENTINEL_PRIVATE_CONFIGURATION/);
  h.team.resolveMember = async () => ({ provider: 'missing', model: 'm' });
  const f = createFailover({ registered: () => false });
  let hook; applyDispatchPreflight({ ...h.ctx, on: (_name, fn) => { hook = fn; } }, h.team, f);
  assert.match((await hook({ agent: h.lead, name: 'spawn_teammate', arguments: args }, async () => ({ kind: 'allow' }))).reason, /registered provider/);
});
test('Eligibility observes cooldown and backups without consuming route state or calling a provider', async () => {
  let now = 100;
  const f = createFailover({ now: () => now, registered: p => p !== 'missing', sleep: async () => true });
  const role = { provider: 'p', model: 'primary', fallbacks: [{ provider: 'q', model: 'backup' }], failover: seed.failover };
  const failed = {};
  f.route(failed, 1, 1, role);
  await f.recover(failed, { code: 'AUTH', status: 401, message: 'denied' });
  const before = structuredClone(f.status(failed));
  assert.equal(f.eligibility(role).eligible, true);
  assert.deepEqual(f.status(failed), before);
  assert.equal(f.status({}), undefined);
  assert.equal(f.eligibility({ ...role, fallbacks: [] }).reason, 'cooling');
  const fresh = {};
  assert.equal(f.route(fresh, 1, 1, role).provider, 'q');
  now += seed.failover.cooldownMs + 1;
  assert.equal(f.eligibility({ ...role, fallbacks: [] }).eligible, true);
});
test('Cancellation before or during async resolution remains native cancellation', async () => {
  const h = harness(), c = new AbortController(); c.abort();
  assert.equal((await h.run({ signal: c.signal })).kind, 'cancel');
  assert.equal(h.count(), 0);
  const during = new AbortController(); h.team.resolveMember = async () => { during.abort(); throw new Error('aborted'); };
  assert.equal((await h.run({ signal: during.signal })).kind, 'cancel');
});
test('Preset or membership changes during resolution return the original native decision', async () => {
  const h = harness(), allow = { kind: 'allow', marker: 'native' };
  h.team.resolveMember = async () => { h.preset('standard'); return { unassigned: true }; };
  assert.equal(await h.run({}, allow), allow);
  h.preset('capability-team');
  h.team.resolveMember = async () => { h.preset('standard'); throw new Error('unknown role'); };
  assert.equal(await h.run({}, allow), allow);
  h.preset('capability-team');
  h.team.resolveMember = async () => { h.ctx.agentTeams.tryMembership = () => ({ role: 'teammate' }); return { unassigned: true }; };
  assert.equal(await h.run({}, allow), allow);
});
test('Creation preview shares request resolution for legacy, rotation, confirmed and disabled routes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'preflight-'));
  const lead = { id: 'preflight-real-lead' }, mate = { id: 'real-mate' };
  let name = 'lv-bu-r2';
  const ctx = { llm: fakeLlm(), workingDirectory: { ensure: async () => root },
    agentTeams: { membership: agent => agent === lead ? { role: 'lead', root: lead } : { role: 'teammate', name, root: lead } } };
  const team = createTeam(ctx, {}, { root });
  try {
    assert.deepEqual(await team.resolveMember(lead, name), await team.resolve(mate));
    const primary = { provider: 'confirmed', model: 'confirmed-model' };
    setRouteStore({ load: () => ({ routes: [['lv-bu', { primary, fallbacks: [] }]] }) });
    assert.deepEqual(await team.resolveMember(lead, name), await team.resolve(mate));
    assert.equal((await team.resolveMember(lead, name)).provider, 'confirmed');
    await team.savePolicy(lead, ['confirmed/confirmed-model'], 0);
    await assert.rejects(team.resolveMember(lead, name), /disabled/);
    await assert.rejects(team.resolve(mate), /disabled/);
    name = 'unknown';
    await assert.rejects(team.resolveMember(lead, name), /not registered/);
  } finally { setRouteStore(undefined); forgetLead(lead.id); await rm(root, { recursive: true, force: true }); }
});
