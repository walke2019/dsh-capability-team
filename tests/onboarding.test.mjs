import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onboardingStatus, teamBundleStatus, tierCoverage, AGENT_TEAM_BUNDLE, applyOnboardingApi, ONBOARDING_PATH } from '../onboarding.js';
import { inspectTeamRuntime } from '../ui.js';
import { fakeLlm } from './fixture.mjs';

const ctxWith = services => ({ get: name => services[name] });

test('team service absent → teamServicePresent=false with bundle state from listBundles (Remote reply or bare)', async () => {
  const row = { name: AGENT_TEAM_BUNDLE, enabled: false, installed: false, availability: 'installation' };
  const status = await onboardingStatus(ctxWith({ pluginManager: { listBundles: async () => [row] } }));
  assert.equal(status.teamServicePresent, false);
  assert.deepEqual(status.bundle, { known: true, listed: true, enabled: false, installed: false, availability: 'installation' });
  assert.deepEqual(await teamBundleStatus({ listBundles: async () => ({ ok: true, value: [{ ...row, enabled: true, error: { code: 'not-bundle' } }] }) }),
    { known: true, listed: true, enabled: true, installed: false, availability: 'installation', error: 'not-bundle' });
  assert.deepEqual(await teamBundleStatus({ listBundles: async () => [] }), { known: true, listed: false });
  assert.deepEqual(await teamBundleStatus(undefined), { known: false });
  assert.equal((await teamBundleStatus({ listBundles: async () => { throw new Error('locked'); } })).known, false);
});

test('team service present and coverage counted from the live catalog without model calls', async () => {
  const status = await onboardingStatus(ctxWith({ agentTeams: {}, llm: fakeLlm(), agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) } }));
  assert.equal(status.teamServicePresent, true);
  assert.equal(status.coverage.known, true);
  assert.equal(status.coverage.covered + status.coverage.unassigned.length, status.coverage.capabilities);
  assert.equal(status.defaultModel, 'p/m');
  const empty = await tierCoverage({ listProviders: () => [], listModels: async () => [] });
  assert.deepEqual([empty.covered, empty.models, empty.unassigned.length > 0], [0, 0, true]);
  assert.deepEqual(await tierCoverage(undefined), { known: false });
});

test('onboarding route is GET-only, served through connection.fetch, never fails hard', async () => {
  let route;
  const ctx = { get: () => undefined, inject: (_names, fn) => fn({ connection: { fetch: { register: r => { route = r; } } } }) };
  applyOnboardingApi(ctx);
  assert.equal(route.path, ONBOARDING_PATH);
  assert.deepEqual(route.methods, ['GET']);
  const body = await (await route.fetch(new Request('http://dsh.internal' + ONBOARDING_PATH))).json();
  assert.equal(body.teamServicePresent, false);
});

test('session status carries teamServicePresent', async () => {
  const agent = { id: 's1', ctx: {} };
  const ctx = { get: () => undefined, agentPresets: { composedPreset: () => 'standard', list: async () => [] }, tools: { schemas: () => [] } };
  assert.equal((await inspectTeamRuntime(ctx, agent)).teamServicePresent, false);
});
