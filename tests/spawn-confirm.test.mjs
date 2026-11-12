import test from 'node:test';
import assert from 'node:assert/strict';
import './keep-alive.mjs';
import { applySpawnConfirm } from '../spawn-confirm.js';
import { createDispatchConfirm, answerPending, pendingView, confirmedRoute, forgetLead, setRouteStore, withConfirmedRoute } from '../dispatch-confirm.js';
import { effectiveConfig, resolveRole } from '../config.js';
import { base } from './fixture.mjs';
import { baseName } from '../session-rotation.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProject } from '../theme.js';
import { applyDispatchPreflight } from '../dispatch-preflight.js';
const flush = () => new Promise(resolve => setTimeout(resolve, 5));
let ids = 0;
function harness(mode = 'on-change') {
  const lead = { id: `spawn-${++ids}` }; let hook, bodies = 0, revision = 0, preset = 'capability-team';
  let effective = effectiveConfig({ workflow: { mode: 'off', confirmDispatch: mode } }, base);
  const entries = Object.values(effective.capabilities).flatMap(c => [c, ...(c.fallbacks ?? [])]).filter(c => c.provider);
  const ctx = { llm: { listProviders: () => [...new Set(entries.map(e => e.provider))].map(id => ({ id })), listModels: async id => entries.filter(e => e.provider === id).map(e => ({ id: e.model })) },
    agentPresets: { composedPreset: () => preset }, agentTeams: { tryMembership: () => ({ role: 'lead', root: lead }) }, on: (event, fn) => { assert.equal(event, 'tools/execute'); hook = fn; } };
  const policy = { disabledRoutes: [], revision: 0 };
  const team = { load: async () => ({ effective: structuredClone(effective), policy: structuredClone(policy), revision }),
    resolveMember: async (_lead, name) => withConfirmedRoute(resolveRole({ role: 'teammate', name }, effective), confirmedRoute(lead.id, baseName(name))) };
  const confirm = createDispatchConfirm(ctx, team, { graceMs: 100000, timeoutMs: 1000 });
  applySpawnConfirm(ctx, team, { eligibility: () => ({ eligible: true }) }, confirm);
  const run = (callId, name = 'backend', signal) => hook({ agent: lead, callId, signal, name: 'spawn_teammate', arguments: { name, description: 'Build', prompt: 'Implement', context: 'fresh' } }, async () => { bodies++; return { native: true }; });
  return { ctx, lead, run, bodies: () => bodies, confirm, team, entries, policy, preset: p => { preset = p; }, change: () => { revision++; }, answer: (callId, answer = { decision: 'confirm' }) => answerPending(lead.id, callId, answer), view: callId => pendingView(lead.id, callId) };
}
test('Off-mode confirms first role at execute entry; unchanged rotation cache does not freeze route', async () => {
  const h = harness(); const first = h.run('a'); await flush(); assert.equal(h.bodies(), 0); assert.equal(h.view('a').routes[0].role, 'backend'); h.answer('a'); await first;
  assert.equal(confirmedRoute(h.lead.id, 'backend'), undefined); await h.run('b', 'backend-r2'); assert.equal(h.bodies(), 2); assert.equal(h.view('b').status, 'none');
});
test('Queue deduplicates on-change; always asks each; cancellation does not poison next caller', async () => {
  const h = harness(); const a = h.run('a'), b = h.run('b'); await flush(); h.answer('a'); await Promise.all([a, b]); assert.equal(h.bodies(), 2);
  const all = harness('always'); const x = all.run('x'); const rejected = assert.rejects(x, /cancel/); const y = all.run('y'); await flush(); all.answer('x', { decision: 'cancel' }); await rejected; await flush(); assert.equal(all.view('y').status, 'pending'); all.answer('y'); await y; assert.equal(all.bodies(), 1);
});
test('Never and standard do not ask; configuration changes prevent dispatch', async () => {
  const never = harness('never'); await never.run('n'); assert.equal(never.bodies(), 1);
  const standard = harness(); standard.preset('standard'); await standard.run('s'); assert.equal(standard.bodies(), 1);
  const h = harness(); const result = h.run('race'); await flush(); h.change(); h.answer('race'); await assert.rejects(result, /changed during confirmation/); assert.equal(h.bodies(), 0);
});
test('Abort during confirmation never dispatches or caches', async () => {
  const h = harness(), c = new AbortController(); const pending = h.run('abort', 'backend', c.signal); const rejected = assert.rejects(pending); await flush(); c.abort(); await rejected; assert.equal(h.bodies(), 0); assert.equal(h.view('abort').status, 'none');
});
test('Removed persisted prior clears both maps and persists before on-change comparison', async () => {
  const h = harness(); let saved;
  setRouteStore({ load: () => ({ routes: [['backend', { primary: { provider: 'gone', model: 'removed' }, fallbacks: [] }]], confirmed: [['backend', 'stale']] }), save: (_id, routes, confirmed) => { saved = { routes: [...routes], confirmed: [...confirmed] }; } });
  const pending = h.run('old'); await flush(); assert.deepEqual(saved, { routes: [], confirmed: [] }); assert.notEqual(h.view('old').routes[0].primary.model, 'removed'); h.answer('old'); await pending;
  setRouteStore(undefined); forgetLead(h.lead.id);
});
test('Disabled persisted prior and catalog-removed unchanged confirmation require a fresh card', async () => {
  const h = harness(); const first = h.run('first'); await flush(); h.answer('first'); await first;
  const route = (await h.team.resolveMember(h.lead, 'backend')).model;
  for (let i = h.entries.length - 1; i >= 0; i--) if (h.entries[i].model === route) h.entries.splice(i, 1);
  const pending = h.run('removed'); const rejected = assert.rejects(pending, /cancel/); await flush(); assert.equal(h.view('removed').status, 'pending'); h.answer('removed', { decision: 'cancel' }); await rejected;
  const disabled = harness(); const configured = await disabled.team.resolveMember(disabled.lead, 'backend');
  const alternate = disabled.entries.find(r => r.model !== configured.model);
  disabled.policy.disabledRoutes.push(`${alternate.provider}/${alternate.model}`);
  let saved;
  setRouteStore({ load: () => ({ routes: [['backend', { primary: alternate, fallbacks: [] }]], confirmed: [['backend', 'old']] }), save: (_id, routes, confirmed) => { saved = { routes: [...routes], confirmed: [...confirmed] }; } });
  const fresh = disabled.run('disabled'); await flush(); assert.deepEqual(saved, { routes: [], confirmed: [] }); assert.notEqual(disabled.view('disabled').routes[0].primary.model, alternate.model); disabled.answer('disabled'); await fresh; setRouteStore(undefined); forgetLead(disabled.lead.id);
});
test('Project-scope own save is accepted while external configuration races are rejected', async () => {
  const h = harness(), root = await mkdtemp(join(tmpdir(), 'spawn-project-')), project = join(root, 'project');
  h.team.root = root; h.team.base = base; h.team.pin = async () => project;
  h.team.load = async () => ({ ...await loadProject(project, base, root), policy: h.policy });
  h.team.resolveMember = async (_lead, name) => resolveRole({ role: 'teammate', name }, (await h.team.load()).effective);
  const pending = h.run('project'); await flush(); const view = h.view('project'); const chosen = view.routes[0].candidates.find(c => c.sameTier && c.model !== view.routes[0].primary.model);
  h.answer('project', { decision: 'confirm', scope: 'project', routes: [{ role: 'backend', primary: chosen, fallbacks: [] }] });
  await pending; assert.equal(h.bodies(), 1); assert.equal((await h.team.load()).revision, 1);
});
test('Single-model fallback is offered and resolves to the same confirmed route', async () => {
  const h = harness(); const effective = effectiveConfig({ singleModel: { provider: 'one', model: 'only-model', acceptedAt: '2026-01-01T00:00:00Z' } });
  h.ctx.llm.listProviders = () => [{ id: 'one' }]; h.ctx.llm.listModels = async () => [{ id: 'only-model' }];
  h.team.load = async () => ({ effective, policy: h.policy, revision: 0 });
  h.team.resolveMember = async (_lead, name) => withConfirmedRoute(resolveRole({ role: 'teammate', name }, effective), confirmedRoute(h.lead.id, baseName(name)));
  const pending = h.run('single'); await flush(); assert.deepEqual(h.view('single').routes[0].primary, { provider: 'one', model: 'only-model' }); h.answer('single'); await pending; assert.equal(h.bodies(), 1);
});
test('Confirmation paths defer preflight; explicit never keeps static rejection', async () => {
  const h = harness(); let hook, calls = 0;
  const ctx = { ...h.ctx, on: (_event, fn) => { hook = fn; } };
  h.team.resolveMember = async () => { calls++; throw new Error('disabled prior'); };
  applyDispatchPreflight(ctx, h.team, { eligibility: () => ({ eligible: false }) });
  const exec = { agent: h.lead, name: 'spawn_teammate', arguments: { name: 'backend', description: 'Build', prompt: 'Implement' } };
  assert.equal((await hook(exec, async () => ({ kind: 'allow' }))).kind, 'allow'); assert.equal(calls, 0);
  h.team.load = async () => ({ effective: effectiveConfig({ workflow: { confirmDispatch: 'never' } }, base) });
  assert.equal((await hook(exec, async () => ({ kind: 'allow' }))).kind, 'deny'); assert.equal(calls, 1);
});
