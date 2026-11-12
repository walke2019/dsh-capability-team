import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeCompat } from '../native-compat.js';
import { readFile } from 'node:fs/promises';
function rc2() {
  const root = { id: 'root', ctx: {} }, child = { id: 'child', ctx: {} }, events = {}, cleanups = [];
  const tasks = Object.fromEntries(['isEnabled', 'createTask', 'getTask', 'listTasks', 'updateTask'].map(k => [k, () => []]));
  const service = { rootOf: a => { if (![root, child].includes(a)) throw new Error('not live'); return root; }, namesOf: a => a === root ? { self: 'lead' } : { self: 'backend/helper-r2', parent: 'backend' }, resolveName: async () => 'child', listDescendants: async () => [{ kind: 'child', id: 'child', path: 'backend/helper-r2', parentId: 'parent', mode: 'continuable', label: 'Work' }], sendMessage: async (...args) => args, interrupt: (...args) => args };
  let selected = 'capability-team';
  const ctx = { agentTeams: tasks, agents: { get: id => id === 'child' ? child : root }, get: name => name === 'agentPresets' ? { composedPreset: () => selected } : undefined,
    inject: (keys, fn) => { assert.deepEqual(keys, ['subagents']); fn({ subagents: service, effect: fn => cleanups.push(fn()) }); }, on: (event, fn) => { events[event] = fn; return () => {}; } };
  return { ctx, root, child, service, events, cleanups, preset: p => { selected = p; } };
}
test('rc2 derives exact live identity and full address without requiring a legacy roster', async () => {
  const h = rc2(), native = createNativeCompat(h.ctx);
  assert.equal(native.kind(), 'rc2');
  const id = native.identity(h.child);
  assert.equal(id.rootId, 'root'); assert.equal(id.address, 'backend/helper-r2'); assert.equal(id.parentAddress, 'backend'); assert.equal(id.roleName, 'helper-r2');
  assert.equal(native.identity({ id: 'child' }), undefined);
  const list = await native.list(h.root); assert.equal(list[1].name, 'backend/helper-r2'); assert.equal(list[1].parentSessionId, 'parent');
  assert.equal(await native.resolveTarget(h.root, id.address), 'child');
  h.preset('standard'); assert.equal(native.identity(h.root), undefined);
});
test('Optional service is read only in injected context and removed on lifecycle disposal', () => {
  const h = rc2(); Object.defineProperty(h.ctx, 'subagents', { get() { throw new Error('undeclared access'); } });
  const native = createNativeCompat(h.ctx); assert.equal(native.kind(), 'rc2'); h.cleanups[0](); assert.equal(native.kind(), 'unavailable');
  assert.equal(native.identity(h.root), undefined);
});
test('Incomplete rc2 capability and ordinary roots fail closed', () => {
  const h = rc2(); delete h.ctx.agentTeams.updateTask; const native = createNativeCompat(h.ctx); assert.equal(native.kind(), 'unavailable'); assert.equal(native.identity(h.root), undefined);
});
test('Local start derives native identity synchronously and ignores external activations', () => {
  const h = rc2(), native = createNativeCompat(h.ctx), seen = [];
  native.onLocalStart(event => seen.push(event));
  h.events['agent/created']({ agent: h.child }); assert.equal(seen.length, 0);
  h.events['subagent/start']({ id: 'child', runId: 'epoch', local: true }); assert.equal(seen[0].identity.address, 'backend/helper-r2'); assert.equal(seen[0].runId, 'epoch');
  h.events['subagent/start']({ id: 'remote', local: false }); assert.equal(seen.length, 1);
});
test('Creation preserves official tools and requires callers to handle absent role names explicitly', () => {
  const h = rc2(), native = createNativeCompat(h.ctx);
  const creation = native.creation({ agent: h.child, name: 'subagent_fork', arguments: { name: 'qa' } }); assert.equal(creation.address, 'backend/helper-r2/qa'); assert.equal(creation.kind, 'fork');
  assert.equal(native.creation({ agent: h.root, name: 'subagent', arguments: {} }).roleName, undefined);
  assert.equal(native.creation({ agent: h.root, name: 'fake_subagent', arguments: {} }), null);
});
test('Package declares mutually optional native generations and keeps base composition native', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['@deepseek-ai/dsh-experimental-agent-team', '@deepseek-ai/dsh-agent-team', '@deepseek-ai/dsh-subagent']) assert.equal(pkg.peerDependenciesMeta[name].optional, true);
  assert.ok(pkg.files.includes('native-compat.js'));
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(patch, /name: '@deepseek-ai\/dsh-(?:agent-team|subagent|tool-subagent)'/);
  assert.match(patch, /name: '@aiwuk\/team\/roles'/);
});
test('rc1 uses original membership and list operations and never invents missing root ownership', async () => {
  const root = { id: 'root', ctx: {} }, child = { id: 'child', ctx: {} };
  const ctx = { get: () => ({ composedPreset: () => 'capability-team' }), agentTeams: { tryMembership: a => a === child ? { role: 'teammate', name: 'backend-r2', root, address: 'wrong' } : a === root ? { role: 'lead', name: 'lead' } : undefined, listMembers: () => [{ id: 'root', name: 'lead' }, { id: 'child', name: 'backend-r2' }] } };
  const native = createNativeCompat(ctx); assert.equal(native.kind(), 'rc1'); assert.equal(native.identity(child).address, 'backend-r2'); assert.equal((await native.list(root)).length, 2);
  assert.equal(native.creation({ agent: root, name: 'fake_spawn_teammate', arguments: {} }), null);
});
