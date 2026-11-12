import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createNativeCompat } from '../native-compat.js';
const nativeTest = process.env.DSH_CORDIS_ENTRY ? test : test.skip;
nativeTest('Real Cordis sibling service enforces declaration and permits optional native subscription', async () => {
  const { Context } = await import(pathToFileURL(process.env.DSH_CORDIS_ENTRY).href);
  const root = new Context();
  const agent = { id: 'root', ctx: {} };
  const tasks = Object.fromEntries(['isEnabled', 'createTask', 'getTask', 'listTasks', 'updateTask'].map(k => [k, () => []]));
  const subagents = { rootOf: () => agent, namesOf: () => ({ self: 'lead' }), resolveName: async () => 'root', listDescendants: async () => [] };
  const provider = root.plugin({ apply(ctx) { ctx.provide('agentTeams', tasks); ctx.provide('subagents', subagents); ctx.provide('agents', { get: () => agent }); } });
  await provider;
  let native;
  try {
    const missing = root.plugin({ inject: ['agentTeams'], apply(ctx) { void ctx.subagents; } });
    await assert.rejects(async () => { await missing; }, /subagents.*without inject/); await missing.dispose();
    const active = root.plugin({ inject: ['agentTeams', 'agents'], apply(ctx) { native = createNativeCompat(ctx); } });
    await active; await new Promise(resolve => setImmediate(resolve));
    assert.equal(native.kind(), 'rc2');
    await active.dispose(); assert.equal(native.kind(), 'unavailable');
  } finally { await provider.dispose(); await root.fiber.dispose(); }
});
