import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskControl } from '../member-task-control.js';

// A rotation successor (`dev-r2`) continues its predecessor's budget without a manual start.
function setup() {
  const steps = { w: 0, w2: 0 }; const handlers = {}; const logs = [];
  const lead = { id: 'l', status: 'idle', session: { header: { id: 'l' } }, ctx: {} };
  const worker = { id: 'w', status: 'idle', session: { header: { id: 'w' } }, ctx: {} };
  const next = { id: 'w2', status: 'idle', session: { header: { id: 'w2' } }, ctx: {} };
  const agents = new Map([['l', lead], ['w', worker], ['w2', next]]);
  const members = [{ id: 'l', role: 'lead', name: 'lead' }, { id: 'w', role: 'teammate', name: 'dev' }];
  const names = new Map([[worker, 'dev'], [next, 'dev-r2']]);
  const role = { provider: 'p', model: 'mid', tier: 'medium', fallbacks: [] };
  const effective = { roles: { dev: { capability: 'frontend' } }, capabilities: { frontend: role }, tiers: { low: ['low'], medium: ['mid'], upper: ['upper'], high: ['high'] } };
  const ctx = { agentPresets: { composedPreset: () => 'capability-team' }, effect: fn => fn(), on: (key, fn) => { handlers[key] = fn; }, tools: { register: () => () => {} }, agents: { get: id => agents.get(id) },
    agentTeams: { tryMembership: a => (a === lead ? { role: 'lead', name: 'lead', root: lead } : names.has(a) ? { role: 'teammate', name: names.get(a), root: lead } : undefined),
      listMembers: () => members, listTasks: () => [] },
    get: () => ({ stateOf: session => ({ view: { stepsStarted: steps[session.header.id] } }) }),
    llm: { listProviders: () => [{ id: 'p' }], listModels: async () => ['low', 'mid', 'upper'].map(id => ({ id })) } };
  const control = createTaskControl(ctx, { load: async () => ({ effective, policy: { disabledRoutes: [] } }) },
    { now: () => 1000, audit: { append: async (_id, r) => { logs.push(r); } }, predecessorOf: (leadId, name) => (leadId === 'l' && name === 'dev-r2' ? 'dev' : undefined) });
  control.setWorkflow({ state: () => ({ plan: { mode: 'delegate', assignments: [{ role: 'dev' }] } }) });
  return { control, lead, worker, next, members, steps, handlers, logs };
}

test('接替者自动继承前任的任务预算、已用步数与临时模型', async () => {
  const f = setup();
  let l = await f.control.budget(f.lead, { action: 'start', role: 'dev', complexity: 'simple' });
  l = await f.control.override(f.lead, { action: 'set', role: 'dev', lease_id: l.leaseId, expected_revision: l.revision, provider: 'p', model: 'upper' });
  f.steps.w = 12; await f.control.update(f.lead);
  f.members.push({ id: 'w2', role: 'teammate', name: 'dev-r2' });
  f.control.register();
  f.handlers['agent/created']({ agent: f.next });
  await new Promise(r => setImmediate(r));
  const leases = f.control.snapshot(f.lead).leases;
  const old = leases.find(x => x.roleId === 'dev'), cur = leases.find(x => x.roleId === 'dev-r2');
  assert.equal(old.status, 'ended'); assert.equal(old.endReason, 'rotated');
  assert.equal(cur.status, 'armed'); assert.equal(cur.memberSessionId, 'w2');
  assert.equal(cur.startsUsed, 12, '已用步数延续');
  assert.equal(cur.assignmentId, old.assignmentId); assert.equal(cur.complexity, 'simple');
  assert.equal(cur.override.model, 'upper', '本次任务的临时模型随接替者保留');
  f.steps.w2 = 20; await f.control.update(f.lead);
  const after = f.control.snapshot(f.lead).leases.find(x => x.roleId === 'dev-r2');
  assert.equal(after.startsUsed, 32, '接替者的新步数累加在前任之上');
  assert.equal(after.judgment, 'unqualified');
  assert.ok(f.logs.some(r => r.action === 'budget-inherit'));
  f.control.dispose();
});

test('没有前任预算时接替者不会凭空开始计数', async () => {
  const f = setup();
  f.members.push({ id: 'w2', role: 'teammate', name: 'dev-r2' });
  assert.equal(await f.control.inherit(f.lead, 'dev', 'dev-r2'), null);
  assert.deepEqual(f.control.snapshot(f.lead).leases, []);
  f.control.dispose();
});
