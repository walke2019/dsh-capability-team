// The Lead follows the model the user picked in the conversation; teammates stay on strict role routing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { followUserChoice, leadRequest, userChoice } from '../lead-route.js';
import { apply as applyRoles } from '../roles.js';
import { createFailover } from '../failover.js';
import { seed } from '../config.js';

const lead = { id: 'lead', capability: 'orchestrator', tier: 'high', provider: 'provider-a', model: 'claude-opus-5-5',
  fallbacks: [{ provider: 'provider-b', model: 'claude-opus-5-5' }], failover: seed.failover, longContext: { provider: 'provider-a', model: 'long', thresholdTokens: 10 } };
const context = { tierModels: ['claude-opus-5-5', 'gpt-6.1-sol'], disabledRoutes: [] };
const key = r => `${r.provider}/${r.model}`;

test('no model on the request keeps the configured lead route', () => {
  assert.equal(userChoice({}), null);
  assert.equal(followUserChoice(lead, {}, context), lead);
});

test('picking the configured primary keeps its configured fallbacks', () => {
  const r = followUserChoice(lead, { provider: 'provider-a', model: 'claude-opus-5-5' }, context);
  assert.equal(key(r), 'provider-a/claude-opus-5-5');
  assert.deepEqual(r.fallbacks.map(key), ['provider-b/claude-opus-5-5']);
  assert.equal(r.userChoice, true);
  assert.equal(r.longContext, undefined, 'the user pick is not swapped for the long-context route');
});

test('picking a configured fallback puts the primary behind it', () => {
  const r = followUserChoice(lead, { provider: 'provider-b', model: 'claude-opus-5-5' }, context);
  assert.equal(key(r), 'provider-b/claude-opus-5-5');
  assert.deepEqual(r.fallbacks.map(key), ['provider-a/claude-opus-5-5']);
});

test('an unconfigured pick in the lead tier keeps every configured route as same-tier fallback', () => {
  const r = followUserChoice(lead, { provider: 'provider-c', model: 'gpt-6.1-sol' }, context);
  assert.equal(key(r), 'provider-c/gpt-6.1-sol');
  assert.deepEqual(r.fallbacks.map(key), ['provider-a/claude-opus-5-5', 'provider-b/claude-opus-5-5']);
});

test('a pick outside the lead tier gets no fallbacks, so failure never degrades across tiers', () => {
  const r = followUserChoice(lead, { provider: 'provider-x', model: 'gemini-3.8-flash-high' }, context);
  assert.equal(key(r), 'provider-x/gemini-3.8-flash-high');
  assert.deepEqual(r.fallbacks, []);
});

test('a pick disabled by the global model policy keeps the configured route', () => {
  const r = followUserChoice(lead, { provider: 'provider-x', model: 'gemini-3.8-flash-high' }, { ...context, disabledRoutes: ['provider-x/*'] });
  assert.equal(key(r), 'provider-a/claude-opus-5-5');
  assert.equal(r.userChoiceRejected, 'provider-x/gemini-3.8-flash-high');
});

test('an unassigned lead role still runs on the user pick', () => {
  const r = followUserChoice({ id: 'lead', unassigned: true }, { provider: 'provider-x', model: 'm' }, context);
  assert.equal(key(r), 'provider-x/m');
  assert.equal(r.unassigned, undefined);
});

test('leadRequest keeps the user request settings only while the pick is the route in use', () => {
  const previous = { provider: 'provider-x', model: 'm', reasoningEffort: 'max' };
  assert.deepEqual(leadRequest(previous, { provider: 'provider-x', model: 'm' }), previous);
  assert.equal(leadRequest(previous, { provider: 'provider-a', model: 'claude-opus-5-5' }), null);
});

function hook(membership, resolved) {
  const listeners = {};
  const ctx = { effect: fn => fn(), systemPrompt: { section: () => () => {} }, on: (e, fn) => { listeners[e] = fn; },
    agentTeams: { tryMembership: () => membership, membership: () => membership } };
  const failover = createFailover({ sleep: async () => true });
  applyRoles(ctx, { owns: () => true, resolve: async () => resolved }, failover);
  const agent = {}; const signal = new AbortController().signal;
  return {
    request: prev => listeners['agent/request']({ agent, turn: 1, step: 1 }, async () => prev),
    fail: () => listeners['agent/request-error']({ agent, failure: { code: 'SERVER', status: 502, message: 'down' }, signal }, async () => undefined),
  };
}

test('request hook: the Lead sends the user pick with its own settings', async () => {
  const h = hook({ role: 'lead' }, { ...lead, leadContext: context });
  const pick = { provider: 'provider-x', model: 'gemini-3.8-flash-high', reasoningEffort: 'high' };
  assert.deepEqual(await h.request(pick), pick);
});

test('request hook: a failing same-tier pick fails over to a configured lead route, settings dropped', async () => {
  const h = hook({ role: 'lead' }, { ...lead, leadContext: context });
  const pick = { provider: 'provider-c', model: 'gpt-6.1-sol', reasoningEffort: 'high' };
  assert.deepEqual(await h.request(pick), pick);
  // Same-route retries first (3), then the next request moves to the first configured same-tier route.
  for (let i = 0; i < seed.failover.retries + 1; i++) assert.deepEqual(await h.fail(), { kind: 'retry' });
  assert.deepEqual(await h.request(pick), { provider: 'provider-a', model: 'claude-opus-5-5' });
});

test('request hook: a teammate ignores the user pick and keeps its role route', async () => {
  const mate = { id: 'dev', capability: 'backend', provider: 'provider-a', model: 'gpt-6.1-sol', fallbacks: [] };
  const h = hook({ role: 'teammate', name: 'dev' }, mate);
  assert.deepEqual(await h.request({ provider: 'provider-x', model: 'gemini-3.8-flash-high', reasoningEffort: 'high' }), { provider: 'provider-a', model: 'gpt-6.1-sol' });
});
