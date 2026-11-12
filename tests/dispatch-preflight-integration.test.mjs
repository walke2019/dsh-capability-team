import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { dirname, resolve } from 'node:path';
import { applyDispatchPreflight } from '../dispatch-preflight.js';
import { fixtureNative } from './helpers/backend-native-fixture.mjs';

const entry = process.env.DSH_NATIVE_LOOP_ENTRY;
// Execute the installed pipeline's real prepare/createExecution/check-cancellation methods.
// Stub only the host services and the tool body; no actual teammate or provider is started.
test('native pipeline preserves approval ordering and rejects unknown roles before dispatch', { skip: !entry }, async () => {
  const source = await readFile(resolve(dirname(entry), '../../dsh-tools/lib/pipeline.js'), 'utf8');
  const start = source.indexOf('var ToolExecutionPipeline = class');
  const end = source.indexOf('//#endregion', start);
  assert.ok(start >= 0 && end > start);
  const approvalHelper = source.match(/function approvalDenial\(reason, code\) \{[\s\S]*?\n\}/)?.[0] ?? '';
  const Native = vm.runInNewContext(`${approvalHelper}\n${source.slice(start, end)};ToolExecutionPipeline`, {
    scopeTarget: (_tools, agent) => agent,
    snapshotJsonValue: value => structuredClone(value),
    deepFreeze: value => value,
    createExecutionToken: () => ({}),
    APPROVAL_ERROR_NAME: 'ApprovalError', APPROVAL_UNAVAILABLE: 'APPROVAL_UNAVAILABLE',
  });
  const agent = { id: 'lead' }, controller = new AbortController();
  let preset = 'capability-team', gate = { kind: 'allow' }, reads = 0, guards = 0, body = 0, hook;
  const ctx = {
    agentPresets: { composedPreset: () => preset },
    agentTeams: { tryMembership: () => ({ role: 'lead', root: agent }) },
    on(name, fn) { assert.equal(name, 'tools/pre-execute'); hook = fn; },
    waterfall: (_carrier, _name, exec) => hook(exec, async () => gate),
    tools: { checkGuards() { guards++; return undefined; } },
    get: () => undefined,
  };
  const team = { native: fixtureNative(ctx), async resolveMember(_agent, name) { reads++; if (name === 'unknown') throw new Error('private sentinel'); return { provider: 'p', model: 'm' }; } };
  applyDispatchPreflight(ctx, team, { eligibility: () => ({ eligible: true }) });
  const tool = { execute: () => { body++; } };
  const pipeline = new Native(ctx, { get: () => tool });
  const input = name => ({ agent, name: 'spawn_teammate', callId: 'call', signal: controller.signal,
    arguments: { name, description: 'Implement work', prompt: 'Implement and verify' } });
  const unknown = await pipeline.prepare(input('unknown'));
  assert.equal(unknown.kind, 'post-result');
  assert.equal(unknown.result.isError, true);
  assert.doesNotMatch(JSON.stringify(unknown.result), /private sentinel/);
  assert.equal(reads, 1); assert.equal(guards, 0); assert.equal(body, 0);
  const valid = await pipeline.prepare(input('backend'));
  assert.equal(valid.kind, 'dispatch'); assert.equal(reads, 2); assert.equal(guards, 1);
  // Ask is resolved only after pre-execute returns. No approval service means native denial.
  gate = { kind: 'ask', reason: 'Owner approval needed' };
  const ask = await pipeline.prepare(input('backend'));
  assert.equal(ask.kind, 'post-result'); assert.equal(ask.result.isError, true);
  if (approvalHelper) {
    assert.equal(ask.result.error.info.name, 'ApprovalError');
    assert.equal(ask.result.error.info.code, 'APPROVAL_UNAVAILABLE');
  }
  assert.equal(reads, 2, 'ask must not touch the resolver');
  gate = { kind: 'allow' }; preset = 'standard';
  assert.equal((await pipeline.prepare(input('unknown'))).kind, 'dispatch');
  assert.equal(reads, 2, 'standard mode must not access team/catalog');
  assert.equal(body, 0, 'prepare never executes native spawn');
});
