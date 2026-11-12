import test from 'node:test';
import assert from 'node:assert/strict';
import { applySpawnConfirm } from '../spawn-confirm.js';
import { applyDispatchPreflight } from '../dispatch-preflight.js';
import { applyTeammateWait } from '../teammate-wait.js';
import { apply as applyRoles } from '../roles.js';
import { confirmationAddress } from '../dispatch-confirm.js';

function fixture(kind = 'rc2') {
  const root = { id: 'root' }, agent = { id: 'child' };
  const hooks = {}, effects = [];
  const native = { kind: () => kind, identity: a => a === root ? { role: 'lead', root, rootId: 'root', agentId: 'root', address: 'lead' }
    : a === agent ? { role: 'teammate', root, rootId: 'root', agentId: 'child', address: 'backend/helper', roleName: 'helper' } : undefined,
    creation: exec => ['subagent', 'spawn_teammate'].includes(exec.name) ? { name: exec.arguments.name, roleName: exec.arguments.name, address: `backend/${exec.arguments.name}`, rootId: 'root' } : null,
    onLocalStart: cb => { native.start = cb; return () => {}; } };
  const role = { id: 'helper', displayName: 'Helper', capability: 'backend', provider: 'p', model: 'm' };
  const loaded = { revision: 0, effective: { workflow: { confirmDispatch: 'never' }, roles: {}, capabilities: {} }, policy: { disabledRoutes: [] } };
  const team = { native, owns: a => !!native.identity(a), load: async () => loaded, resolveMember: async () => role, resolveSync: () => role };
  const ctx = { on: (name, fn) => { hooks[name] = fn; }, effect: fn => { effects.push(fn()); }, tools: { guard: fn => { ctx.guard = fn; return () => {}; } }, agents: { list: () => [] } };
  return { root, agent, native, team, ctx, hooks, role };
}

test('rc2 unnamed creation fails closed while standard callers pass through', async () => {
  const h = fixture(); let bodies = 0;
  applySpawnConfirm(h.ctx, h.team, {}, {});
  const exec = { agent: h.root, name: 'subagent', arguments: {} };
  await assert.rejects(h.hooks['tools/execute'](exec, async () => bodies++), /explicit registered role name/);
  await h.hooks['tools/execute']({ ...exec, agent: {} }, async () => bodies++);
  assert.equal(bodies, 1);
});

test('rc2 static preflight preserves native ask and rejects unassigned named roles', async () => {
  const h = fixture(); h.team.resolveMember = async () => ({ unassigned: true });
  applyDispatchPreflight(h.ctx, h.team, {});
  const exec = { agent: h.root, name: 'subagent', arguments: { name: 'helper' } };
  assert.deepEqual(await h.hooks['tools/pre-execute'](exec, async () => ({ kind: 'ask' })), { kind: 'ask' });
  assert.equal((await h.hooks['tools/pre-execute'](exec, async () => ({ kind: 'allow' }))).kind, 'deny');
});

test('owned preflight losing native identity never reaches creation body; initially standard still passes', async () => {
  for (const phase of ['load', 'resolve']) {
    const h = fixture(); let bodies = 0;
    if (phase === 'load') h.team.load = async () => { h.native.identity = () => undefined; return { effective: { workflow: { confirmDispatch: 'never' } } }; };
    else h.team.resolveMember = async () => { h.native.identity = () => undefined; return h.role; };
    applyDispatchPreflight(h.ctx, h.team, { eligibility: () => ({ eligible: true }) });
    const run = async agent => {
      const decision = await h.hooks['tools/pre-execute']({ agent, name: 'subagent', arguments: { name: 'helper' } }, async () => ({ kind: 'allow' }));
      if (decision.kind === 'allow') bodies++;
      return decision;
    };
    assert.equal((await run(h.root)).kind, 'cancel'); assert.equal(bodies, 0);
    assert.equal((await run({ id: 'standard' })).kind, 'allow'); assert.equal(bodies, 1);
  }
});

test('rc2 wait is native while rc1 teammate policy remains active', () => {
  for (const kind of ['rc1', 'rc2']) {
    const h = fixture(kind); applyTeammateWait(h.ctx, h.native);
    const result = h.ctx.guard({ agent: h.agent, name: 'wait_agent' });
    assert.equal(typeof result, kind === 'rc1' ? 'string' : 'undefined');
  }
});

test('rc2 local start synchronously selects child route before initial delivery', () => {
  const h = fixture(); let selected;
  h.agent.model = { current: () => ({ provider: 'lead', model: 'expensive' }), select: value => { selected = value; } };
  h.agent.ctx = { systemPrompt: { context() {} } };
  applyRoles(h.ctx, h.team, { route: () => ({ provider: 'p', model: 'm' }) });
  h.native.start({ agent: h.agent, identity: h.native.identity(h.agent), runId: 'activation' });
  assert.deepEqual(selected, { provider: 'p', model: 'm' });
});

test('confirmation normalization retains ancestor paths and only strips final rotation', () => {
  assert.equal(confirmationAddress('backend-r2/helper-r3'), 'backend-r2/helper');
  assert.notEqual(confirmationAddress('backend/helper'), confirmationAddress('research/helper'));
});
