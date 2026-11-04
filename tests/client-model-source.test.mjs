// The board shows a teammate's model from this plugin's own request records, never from the host roster.
// The Lead shows the model the user picked in the conversation, which its requests now follow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, boardDetailsOf } from './helpers/client-harness.mjs';

const lead = { id: 'lead', displayName: 'Lead', capability: 'orchestrator', provider: 'provider-a', model: 'claude-opus-5-5', fallbacks: [{ provider: 'provider-b', model: 'claude-opus-5-5' }] };
const dev = { ...lead, id: 'dev', displayName: 'Dev', capability: 'backend' };
const usage = route => ({ capabilityTeamUsage: { routes: [{ route, uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }], coverage: 'complete', reportedSamples: 1 } });
/** A Lead board whose host roster reports a stale model for every member; `values` are the target member's projections. */
function boardFor(values, { roles = [lead, dev], hostModel = 'gemini-3.8-flash-high', target = 'dev' } = {}) {
  const host = { provider: 'provider-x', model: hostModel, phase: 'active' };
  const team = { agentTeam: { members: [{ id: 's_lead', name: 'lead', role: 'lead', ...host }, { id: 's_dev', name: 'dev', role: 'teammate', ...host }], tasks: [] } };
  const state = { byId: {}, projectionsBySession: { s_lead: { values: { ...team, ...(target === 'lead' ? values : {}) } },
    ...(target === 'dev' ? { s_dev: { values } } : {}) } };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);
  const board = h.find(tree, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);
  // TeamBoard renders one member's card in its detail panel; the helper renders the card of every member.
  const view = boardDetailsOf(board, { ...board.props, roles });
  return { h, view, card: h.find(view, n => n.props?.['data-card'] === target) };
}

test('teammate: host roster says gemini-3.8-flash-high, real route is opus-5-5: board shows opus-5-5 without a warning', () => {
  const { h, card, view } = boardFor({ modelSelection: { next: { provider: 'provider-a', model: 'claude-opus-5-5' } }, ...usage('provider-a/claude-opus-5-5') });
  const text = JSON.stringify(card);
  assert.ok(text.includes('claude-opus-5-5'), 'shows the route of the latest real request');
  assert.ok(!JSON.stringify(view).includes('gemini-3.8-flash-high'), 'host roster model is never shown');
  assert.equal(h.find(card, n => n.props?.['data-route-warn'] === ''), undefined, 'a configured route does not warn');
  assert.equal(h.find(card, n => n.props?.['data-config-model'] === ''), undefined, 'a real route is not labelled as config');
  const badge = h.find(card, n => n.props?.className === 'ctm-bd-model');
  assert.ok(badge.props.title.includes('live.liveModel'));
});

test('a fallback route is trusted and does not warn', () => {
  const { h, card } = boardFor(usage('provider-b/claude-opus-5-5'));
  assert.ok(JSON.stringify(card).includes('provider-b/claude-opus-5-5'));
  assert.ok(JSON.stringify(card).includes('live.fallback'));
  assert.equal(h.find(card, n => n.props?.['data-route-warn'] === ''), undefined);
});

test('a real route outside the primary and fallbacks shows the warning marker', () => {
  const { h, card } = boardFor(usage('provider-x/gemini-3.8-flash-high'));
  assert.ok(JSON.stringify(card).includes('provider-x/gemini-3.8-flash-high'));
  const warn = h.find(card, n => n.props?.['data-route-warn'] === '');
  assert.ok(warn, 'warning marker rendered');
  assert.equal(warn.props.title, 'live.routeWarnHint');
  assert.ok(warn.children.includes('live.routeWarn'));
});

test('modelSelection alone is not trusted: without a recorded route the configured primary is shown, labelled config', () => {
  const { h, card } = boardFor({ modelSelection: { next: { provider: 'provider-x', model: 'gemini-3.8-flash-high' } } });
  const text = JSON.stringify(card);
  assert.ok(text.includes('claude-opus-5-5'), 'falls back to the configured primary');
  assert.ok(!text.includes('gemini-3.8-flash-high'));
  assert.ok(h.find(card, n => n.props?.['data-config-model'] === ''), 'labelled as config');
  assert.equal(h.find(card, n => n.props?.['data-route-warn'] === ''), undefined);
});

test('modelSelection.next wins over the last recorded route only when it is one of the recorded routes', () => {
  const routes = { capabilityTeamUsage: { routes: [{ route: 'provider-b/claude-opus-5-5' }, { route: 'provider-a/claude-opus-5-5' }] } };
  const picked = boardFor({ ...routes, modelSelection: { next: { provider: 'provider-b', model: 'claude-opus-5-5' } } });
  assert.ok(JSON.stringify(picked.card).includes('provider-b/claude-opus-5-5'));
  const ignored = boardFor({ ...routes, modelSelection: { next: { provider: 'provider-x', model: 'gemini-3.8-flash-high' } } });
  assert.ok(JSON.stringify(ignored.card).includes('provider-a/claude-opus-5-5'), 'unrecorded pick falls back to the latest recorded route');
  assert.ok(!JSON.stringify(ignored.card).includes('gemini-3.8-flash-high'));
});

test('a recorded route with no configured routes to compare never warns', () => {
  const { h, card } = boardFor(usage('provider-x/anything'), { roles: [lead, { id: 'dev', displayName: 'Dev', capability: 'backend' }] });
  assert.ok(JSON.stringify(card).includes('provider-x/anything'));
  assert.equal(h.find(card, n => n.props?.['data-route-warn'] === ''), undefined);
});

test('lead: shows the model the user picked in the conversation, even before any request is recorded', () => {
  const { h, card, view } = boardFor({ modelSelection: { next: { provider: 'provider-a', model: 'claude-opus-5-5' } } }, { target: 'lead' });
  assert.ok(JSON.stringify(card).includes('provider-a/claude-opus-5-5'));
  assert.ok(!JSON.stringify(card).includes('gemini-3.8-flash-high'), 'host roster model is not shown for the lead either');
  const badge = h.find(card, n => n.props?.className === 'ctm-bd-model');
  assert.ok(badge.props.title.includes('live.leadPick'), 'labelled as the conversation pick, not yet a real request');
  assert.equal(h.find(card, n => n.props?.['data-config-model'] === ''), undefined);
  assert.ok(view);
});

const failedOver = (pick, actual) => ({ modelSelection: { next: pick }, capabilityTeamUsage: { routes: [{ route: `${pick.provider}/${pick.model}` }, { route: actual }], lastRoute: actual } });

test('lead: during failover it shows the model actually requested, not the conversation pick', () => {
  const { h, card } = boardFor(failedOver({ provider: 'provider-a', model: 'claude-opus-5-5-high' }, 'provider-a/claude-opus-5-5'), { target: 'lead' });
  assert.ok(JSON.stringify(card).includes('provider-a/claude-opus-5-5'), 'shows the actual route');
  assert.ok(!JSON.stringify(card).includes('claude-opus-5-5-high'), 'the failed pick is not shown');
  const badge = h.find(card, n => n.props?.className === 'ctm-bd-model');
  assert.ok(badge.props.title.includes('live.liveModel'));
});

test('lead: an actual route outside the configured lead routes is shown alone, without a warning or a second badge', () => {
  const { h, card } = boardFor({ modelSelection: { next: { provider: 'provider-x', model: 'gpt-6.1-sol' } }, capabilityTeamUsage: { routes: [{ route: 'provider-x/gpt-6.1-sol' }], lastRoute: 'provider-x/gpt-6.1-sol' } }, { target: 'lead' });
  assert.ok(JSON.stringify(card).includes('provider-x/gpt-6.1-sol'));
  assert.equal(h.findAll(card, n => n.props?.className === 'ctm-bd-model').length, 1);
  assert.equal(h.find(card, n => n.props?.['data-route-warn'] === ''), undefined);
});

test('lead: without a pick it shows its latest recorded route, else the configured default labelled config', () => {
  const recorded = boardFor(usage('provider-b/claude-opus-5-5'), { target: 'lead' });
  assert.ok(JSON.stringify(recorded.card).includes('provider-b/claude-opus-5-5'));
  const none = boardFor({}, { target: 'lead' });
  assert.ok(JSON.stringify(none.card).includes('provider-a/claude-opus-5-5'));
  assert.ok(none.h.find(none.card, n => n.props?.['data-config-model'] === ''));
});

test('teammate: lastRoute wins over the order routes were first recorded in', () => {
  const { card } = boardFor({ capabilityTeamUsage: { routes: [{ route: 'provider-a/claude-opus-5-5' }, { route: 'provider-b/claude-opus-5-5' }], lastRoute: 'provider-a/claude-opus-5-5' } });
  assert.ok(JSON.stringify(card).includes('provider-a/claude-opus-5-5'));
  assert.ok(!JSON.stringify(card).includes('provider-b/claude-opus-5-5"'), 'an older route that is no longer used is not shown as current');
});
