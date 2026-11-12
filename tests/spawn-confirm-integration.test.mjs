import test from 'node:test';
import { fixtureNative } from './helpers/backend-native-fixture.mjs';
import assert from 'node:assert/strict';
import './keep-alive.mjs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { applySpawnConfirm } from '../spawn-confirm.js';
import { createDispatchConfirm, answerPending, pendingView, forgetLead, confirmedRoute, withConfirmedRoute } from '../dispatch-confirm.js';
import { effectiveConfig, resolveRole } from '../config.js';
import { base } from './fixture.mjs';
import { baseName } from '../session-rotation.js';

const entry = process.env.DSH_NATIVE_LOOP_ENTRY;
test('native approval and guards precede role card, which precedes spawn body', { skip: !entry }, async () => {
  const source = await readFile(resolve(dirname(entry), '../../dsh-tools/lib/pipeline.js'), 'utf8');
  const start = source.indexOf('var ToolExecutionPipeline = class'), end = source.indexOf('//#endregion', start);
  assert.ok(start >= 0 && end > start);
  const Native = vm.runInNewContext(`${source.slice(start, end)};ToolExecutionPipeline`, {
    scopeTarget: (_tools, agent) => agent, snapshotJsonValue: structuredClone, deepFreeze: value => value,
    createExecutionToken: () => ({}), toolErrorResult: error => ({ isError: true, error: { message: String(error.message) } }),
    APPROVAL_ERROR_NAME: 'ApprovalError', APPROVAL_REJECTED: 'APPROVAL_REJECTED', APPROVAL_CANCELLED: 'APPROVAL_CANCELLED', APPROVAL_UNAVAILABLE: 'APPROVAL_UNAVAILABLE',
    approvalDenial: (reason, code) => ({ kind: 'deny', reason, info: { name: 'ApprovalError', code } }),
  });
  const lead = { id: 'native-spawn-confirm-integration' }, events = [];
  let hook, preset = 'capability-team', outcome = 'allowed-once', reads = 0;
  const effective = effectiveConfig({ workflow: { mode: 'off', confirmDispatch: 'on-change' } }, base);
  const entries = Object.values(effective.capabilities).flatMap(c => [c, ...(c.fallbacks ?? [])]).filter(r => r.provider);
  const ctx = {
    agentPresets: { composedPreset: () => preset },
    agentTeams: { tryMembership: () => ({ role: 'lead', root: lead }) },
    tools: { checkGuards() { events.push('guard'); return undefined; } },
    llm: { listProviders: () => [...new Set(entries.map(r => r.provider))].map(id => ({ id })), listModels: async id => entries.filter(r => r.provider === id).map(r => ({ id: r.model })) },
    on(name, fn) { assert.equal(name, 'tools/execute'); hook = fn; },
    waterfall: (_carrier, name, exec, next) => name === 'tools/pre-execute' ? Promise.resolve({ kind: 'ask' }) : hook(exec, next),
    get: () => ({ request: async () => { events.push('approval'); return outcome; } }),
  };
  const team = {
    native: fixtureNative(ctx),
    load: async () => { reads++; return { effective: structuredClone(effective), policy: { disabledRoutes: [] }, revision: 0 }; },
    resolveMember: async (_lead, name) => withConfirmedRoute(resolveRole({ role: 'teammate', name }, effective), confirmedRoute(lead.id, baseName(name))),
  };
  const confirmation = createDispatchConfirm(ctx, team, { graceMs: 100000, timeoutMs: 3000 });
  applySpawnConfirm(ctx, team, { eligibility: () => ({ eligible: true }) }, confirmation);
  const pipeline = new Native(ctx, { get: () => ({}) });
  // Keep native prepare/serviceAsk/dispatch; stub only body work and result output projection.
  pipeline.normalizeDispatchResult = (_exec, result) => result;
  pipeline.materializeFinalResult = result => result;
  pipeline.dispatchToolBody = async () => { events.push('body'); return { content: [], isError: false }; };
  const input = (callId, name = 'backend') => ({ agent: lead, name: 'spawn_teammate', callId, signal: new AbortController().signal,
    arguments: { name, description: 'Build', prompt: 'Implement safely' } });
  try {
    const prepared = await pipeline.prepare(input('first'));
    assert.equal(prepared.kind, 'dispatch'); assert.deepEqual(events, ['approval', 'guard']);
    const running = pipeline.dispatch(prepared.exec);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(pendingView(lead.id, 'first').status, 'pending');
    assert.deepEqual(events, ['approval', 'guard']);
    answerPending(lead.id, 'first', { decision: 'confirm' });
    assert.equal((await running).result.isError, false); assert.equal(events.at(-1), 'body');
    const repeated = await pipeline.prepare(input('rotation', 'backend-r2'));
    assert.equal((await pipeline.dispatch(repeated.exec)).result.isError, false);
    assert.equal(pendingView(lead.id, 'rotation').status, 'none');
    outcome = 'rejected'; const count = reads;
    const denied = await pipeline.prepare(input('rejected')); assert.equal(denied.kind, 'post-result', JSON.stringify(denied.result)); assert.equal(reads, count);
    outcome = 'allowed-once'; preset = 'standard';
    const standard = await pipeline.prepare(input('standard', 'unknown'));
    assert.equal((await pipeline.dispatch(standard.exec)).result.isError, false); assert.equal(reads, count);
    preset = 'capability-team';
    const cancelPrepared = await pipeline.prepare(input('cancel', 'frontend'));
    const cancelled = pipeline.dispatch(cancelPrepared.exec); const bodies = events.filter(e => e === 'body').length;
    await new Promise(resolve => setTimeout(resolve, 10)); answerPending(lead.id, 'cancel', { decision: 'cancel' });
    assert.equal((await cancelled).result.isError, true); assert.equal(events.filter(e => e === 'body').length, bodies);
  } finally { forgetLead(lead.id); }
});
