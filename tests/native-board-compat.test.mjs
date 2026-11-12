import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardDispatch } from '../board-dispatch.js';
import { createNativeCompat } from '../native-compat.js';
import { createTaskControl } from '../member-task-control.js';
import { createRotation } from '../session-rotation.js';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fixture() {
  const lead = { id: 'root', ctx: {}, session: {} }, child = { id: 'child', ctx: {}, session: {} };
  const agents = new Map([[lead.id, lead], [child.id, child]]), hooks = {}, tasks = [], updates = [];
  const ctx = {
    agents, agentPresets: { composedPreset: () => 'capability-team' },
    on(name, callback) { (hooks[name] ??= []).push(callback); return () => {}; }, effect: fn => fn(),
    tools: { register: () => () => {}, guard: () => () => {} },
    inject(keys, callback) { if (keys.includes('subagents')) callback({ subagents, effect() {} }); },
    agentTeams: {
      isEnabled: () => true,
      createTask: async (_a, args) => { const task = { ...args, id: `t${tasks.length}`, status: 'pending', ready: true, revision: 1 }; tasks.push(task); return task; },
      getTask: (_a, id) => tasks.find(t => t.id === id), listTasks: () => tasks,
      updateTask: async (_a, args) => { updates.push(args); return args; },
    },
  };
  let listed = false;
  const subagents = {
    rootOf: () => lead, namesOf: a => ({ self: a === lead ? 'lead' : 'backend/helper' }),
    resolveName: async (_a, address) => { assert.equal(address, 'backend/helper'); return child.id; },
    listDescendants: async () => { await Promise.resolve(); listed = true; return [{ id: child.id, path: 'backend/helper', kind: 'child', mode: 'local' }]; },
  };
  const native = createNativeCompat(ctx), team = { native, pinned: () => '/project' };
  return { ctx, team, native, lead, child, tasks, updates, hooks, listed: () => listed };
}

test('rc2 board awaits native roster and resolves full-address owners to SessionId', async () => {
  const f = fixture(), board = createBoardDispatch(f.ctx, f.team);
  await board.create(f.lead, { assignments: [{ role: 'backend/helper', task: 'Implement', displayName: 'Helper' }] });
  assert.equal(f.listed(), true);
  assert.equal(f.updates[0].owner, 'child');
  f.tasks[0].ownerName = 'backend/helper'; f.tasks[0].status = 'in_progress';
  await board.transfer(f.lead, 'backend/helper', 'backend/helper');
  assert.equal(f.updates[1].owner, 'child');
  assert.match(board.context(f.child), /t0/);
  assert.ok(board.guard({ agent: f.child, name: 'edit', arguments: { file_path: '/project/outside' } }) === undefined);
});

test('rc2 budget consumes pending assignment at native local start, not agent created', async () => {
  const f = fixture();
  const control = createTaskControl(f.ctx, f.team, { audit: { append: async () => {} } });
  control.setWorkflow({ state: () => ({ plan: { mode: 'delegate', assignments: [{ role: 'backend/helper' }] } }) });
  const list = f.native.list; f.native.list = async () => [];
  await control.dispatch(f.lead, [{ role: 'backend/helper' }]); f.native.list = list;
  control.register();
  for (const fn of f.hooks['agent/created']) fn({ agent: f.child });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(control.snapshot(f.lead).leases.length, 0);
  for (const fn of f.hooks['subagent/start']) fn({ id: f.child.id, local: true, runId: 'epoch' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(control.snapshot(f.lead).leases[0].memberSessionId, 'child');
  assert.equal(control.snapshot(f.lead).leases[0].roleId, 'backend/helper');
  control.dispose();
});

test('nested handoff keeps full address and safe durable filename', async () => {
  const f = fixture(), root = await mkdtemp(join(tmpdir(), 'native-board-'));
  const rotation = createRotation(f.ctx, { ...f.team, root }, { diffStat: async () => null });
  const handoff = await rotation.writeHandoff(f.child, { done: 'Implemented', remaining: 'Verify' });
  assert.equal(handoff.member, 'backend/helper'); assert.equal(handoff.role, 'helper');
  const fresh = createRotation(f.ctx, { ...f.team, root });
  assert.equal((await fresh.readHandoff('root', 'backend/helper')).written.done, 'Implemented');
  const directories = await readdir(join(root, 'handoffs'));
  assert.match((await readdir(join(root, 'handoffs', directories[0])))[0], /^[a-f0-9]{64}\.json$/);
});
