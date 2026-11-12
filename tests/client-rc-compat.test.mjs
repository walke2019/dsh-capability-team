import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { onboardingStatus } from '../onboarding.js';
import { teamActivity, inject as uiInject } from '../ui.js';
const src = name => readFileSync(new URL(`../client/${name}`, import.meta.url), 'utf8');
const baseName = name => String(name ?? '').replace(/-r\d+$/, '');
const helpers = runInNewContext(`${src('06c-native-team.js')}\n${src('06-usage.js')}\n${src('07-board-parts.js')}\n({resolveTeamView,usageRows,teamActivityFrom,boardCards})`, {
  baseName, trustedRoute: values => values?.capabilityTeamUsage?.routes?.[0]?.route,
  routeOutsideConfig: () => false, routeText: value => value,
});

test('server UI explicitly injects native task service and awaits native root listing', async () => {
  assert.ok(uiInject.includes('agentTeams'));
  const root = { id: 'root' }, child = { id: 'child' };
  let listed;
  const native = { identity: () => ({ root, rootId: 'root' }), list: async target => { listed = target; return [{ id: 'child', name: 'backend/helper', role: 'teammate' }]; } };
  const activity = await teamActivity({ get: () => ({ listTasks: () => [] }) }, child, native);
  assert.equal(listed, root);
  assert.equal(activity.members[0].status, 'unknown');
  assert.equal(activity.members[0].name, 'backend/helper');
});
test('rc2 onboarding generation does not query legacy bundle or assert mode enabled', async () => {
  const status = await onboardingStatus({ get: key => key === 'agentTeams' ? { isEnabled() {}, listTasks() {} } : key === 'pluginManager' ? { listBundles() { throw new Error('must not query'); } } : undefined });
  assert.equal(status.nativeGeneration, 'rc2');
  assert.equal(status.legacyBundleRequired, false);
  assert.equal('teamEnabled' in status, false);
  assert.equal(status.bundle.required, false);
});
test('rc1 uses official member and task projection unchanged', () => {
  const team = { members: [{ id: 'root', name: 'lead', role: 'lead', phase: 'active' }], tasks: [{ id: 'task-1', status: 'pending' }] };
  const view = helpers.resolveTeamView({ rootSessionId: 'root', nativeProjections: { root: { agentTeam: team } } });
  assert.equal(view.members, team.members);
  assert.equal(view.tasks, team.tasks);
});
test('rc2 native catalog preserves nested names and parent lineage without residency inference', () => {
  const native = {
    root: { agentTeam: { enabled: true, tasks: [] }, subagentCatalog: [{ id: 'back', name: 'backend', label: 'Backend', mode: 'continuable' }, { id: 'external', name: 'remote', mode: 'external' }] },
    back: { subagentCatalog: [{ id: 'one', name: 'helper', label: 'Helper', mode: 'continuable' }] },
  };
  const view = helpers.resolveTeamView({ rootSessionId: 'root', nativeProjections: native });
  assert.equal(view.members.map(m => m.name).join(','), 'lead,backend,backend/helper');
  assert.equal(view.members[2].parentSessionId, 'back');
  assert.equal(view.members.some(m => 'running' in m || 'status' in m), false);
  const activity = helpers.teamActivityFrom(view, { running: () => undefined });
  assert.equal(activity.members[2].status, 'unknown');
});
test('server-only detached native snapshot preserves members until native projections arrive', () => {
  const snapshot = { members: [{ id: 'root', name: 'lead', role: 'lead' }, { id: 'worker', name: 'qa', role: 'teammate' }], tasks: [] };
  const view = helpers.resolveTeamView({ rootSessionId: 'root', nativeProjections: {}, statusSnapshot: snapshot });
  assert.equal(view.members, snapshot.members);
});
test('authoritative empty catalog cannot resurrect removed members from old snapshots', () => {
  const view = helpers.resolveTeamView({ rootSessionId: 'root', nativeProjections: { root: { agentTeam: { enabled: true, tasks: [] }, subagentCatalog: [] } },
    statusSnapshot: { members: [{ id: 'old', name: 'backend', status: 'running' }] },
    childrenSnapshot: [{ id: 'old', name: 'backend', kind: 'child', activity: 'running', mode: 'continuable' }] });
  assert.equal(view.members.length, 1);
  const activity = helpers.teamActivityFrom(view, { running: () => undefined });
  assert.equal(activity.members[0].status, 'unknown');
});
test('nested sibling cards keep full identity keys and shared final-segment role display', () => {
  const cards = helpers.boardCards([{ id: 'helper', displayName: 'Reviewer', provider: 'p', model: 'm' }], { members: [
    { id: 'a', name: 'backend/helper', status: 'running' }, { id: 'b', name: 'frontend/helper', status: 'idle' },
  ], tasks: [] });
  assert.equal(cards.filter(c => c.member).map(c => c.id).join(','), 'backend/helper,frontend/helper');
  assert.equal(cards.filter(c => c.member).every(c => c.name === 'Reviewer'), true);
});
test('native parent address resolves nested root and preserves direct parent navigation', () => {
  const registration = src('11-register.js');
  const body = registration.slice(registration.indexOf('    function liveStore'), registration.indexOf('\n    const VIEWS'));
  const addresses = { child: { parentSessionId: 'back', childSessionId: 'child', mode: 'continuable' }, back: { parentSessionId: 'root', childSessionId: 'back', mode: 'continuable' } };
  const values = { ids: ['root'], byId: {}, projectionsBySession: {} };
  const live = runInNewContext(`${body}\nliveStore`, {} )({
    sessions: { subagentAddress: id => addresses[id], list: { getSnapshot: () => values } },
    effect: fn => fn(), remote: {},
  });
  assert.equal(live.parentSessionId('child'), 'root');
  assert.equal(live.memberTarget('root', 'child'), addresses.child);
});
test('usage follows unified native ids and consumes pushed own usage without old agentTeam', () => {
  let output = 10;
  const view = { members: [{ id: 'nested', name: 'backend/helper' }] };
  const live = { projections: () => ({ capabilityTeamUsage: { totals: { outputTokens: output }, routes: [], coverage: 'complete', reportedSamples: 1 }, sessionStats: { steps: output } }) };
  assert.equal(helpers.usageRows({}, view, live)[0].totals.outputTokens, 10);
  output = 20;
  assert.equal(helpers.usageRows({}, view, live)[0].stats.steps, 20);
  const d = { memberEvidence: [{ sessionId: 'nested', name: 'backend/helper', usage: { totals: { outputTokens: 1 } } }] };
  assert.equal(helpers.usageRows(d, null, live)[0].totals.outputTokens, 20);
});
