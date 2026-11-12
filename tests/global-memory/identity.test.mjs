import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { eligible } from '../../packages/global-memory/identity.js';
const config = { enabled: true };
test('Current native composition is the only eligibility source for rc1 and rc2 roots and children', () => {
  for (const agentTeams of [{ tryMembership: () => { throw new Error('Must not query legacy membership'); } }, { isEnabled: () => true }]) {
    const ctx = { agentTeams, agentPresets: { composedPreset: c => c.preset } };
    for (const preset of ['standard', 'ordinary', 'subagent']) assert.equal(eligible(ctx, { ctx: { preset } }, config), true);
    assert.equal(eligible(ctx, { ctx: { preset: 'capability-team' } }, config), false);
    assert.equal(eligible(ctx, { ctx: { preset: undefined } }, config), false);
    assert.equal(eligible(ctx, { ctx: { preset: null } }, config), false);
    assert.equal(eligible(ctx, { ctx: { preset: 'standard' } }, { enabled: false }), false);
  }
});
test('Missing or failing preset services fail closed without reading optional native services', () => {
  const ctx = { agentPresets: { composedPreset: () => { throw new Error('Unavailable'); } } };
  Object.defineProperty(ctx, 'agentTeams', { get: () => { throw new Error('Undeclared service'); } });
  assert.equal(eligible(ctx, { ctx: {} }, config), false);
  assert.equal(eligible({}, { ctx: {} }, config), false);
});
const nativeTest = process.env.DSH_CORDIS_ENTRY ? test : test.skip;
nativeTest('Real Cordis declared preset service supports ordinary memory without team injection', async () => {
  const { Context } = await import(pathToFileURL(process.env.DSH_CORDIS_ENTRY).href);
  const root = new Context();
  const provider = root.plugin({ apply(ctx) { ctx.provide('agentPresets', { composedPreset: c => c.preset }); ctx.provide('agentTeams', { isEnabled: () => true }); } });
  await provider;
  let results;
  try {
    const active = root.plugin({ inject: ['agentPresets'], apply(ctx) {
      assert.throws(() => ctx.agentTeams, /without inject/);
      results = ['standard', 'capability-team', undefined].map(preset => eligible(ctx, { ctx: { preset } }, config));
    } });
    await active; assert.deepEqual(results, [true, false, false]); await active.dispose();
  } finally { await provider.dispose(); await root.fiber.dispose(); }
});
