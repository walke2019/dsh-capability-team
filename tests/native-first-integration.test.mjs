import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seed } from '../config.js';
import { loadProject, saveProject, themePath } from '../theme.js';
import { toTemplate, templatePatch } from '../template.js';
import { policyText } from '../roles.js';
import { createContinuation } from '../failover-continuation.js';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const assertNative = (effective, confirmDispatch = 'on-change') => {
  assert.equal(effective.workflow.mode, 'off');
  assert.equal(effective.workflow.confirmDispatch, confirmDispatch);
  for (const key of ['fileLimits', 'rotation', 'tokens', 'enforceWriteScopes']) assert.equal(effective.workflow[key], false, key);
  assert.ok(effective.roles.lead);
  assert.ok(effective.capabilities.backend);
  assert.ok(effective.failover.failoverCodes.includes('QUOTA'));
};

test('disk policy loading preserves explicit legacy values without rewriting and null restores native defaults', async () => {
  // Retain temporary evidence until the OS clears it; never delete a computed path.
  const root = await mkdtemp(join(tmpdir(), 'native-policy-integration-'));
  const project = join(root, 'project');
  assertNative((await loadProject(project, seed, root)).effective);
  const legacy = { mode: 'enforce', confirmDispatch: 'on-change', enforceWriteScopes: true, fileLimits: {}, rotation: {}, tokens: {} };
  await saveProject(project, { workflow: legacy, roles: { backend: { displayName: 'Service Engineer' } } }, 0, { root });
  const path = themePath(project, root), bytes = await readFile(path, 'utf8');
  const loaded = await loadProject(project, seed, root);
  assert.equal(loaded.effective.workflow.mode, 'enforce');
  assert.ok(loaded.effective.workflow.fileLimits.sourceMax);
  assert.ok(loaded.effective.workflow.tokens.idleCompactRatio);
  assert.ok(loaded.effective.workflow.rotation.hardTurns);
  assert.equal(await readFile(path, 'utf8'), bytes, 'read must not migrate policy bytes');
  await saveProject(project, { workflow: { mode: 'off', confirmDispatch: 'never', enforceWriteScopes: false, fileLimits: false, rotation: false, tokens: false } }, 1, { root });
  const reset = await loadProject(project, seed, root);
  assertNative(reset.effective, 'never');
  assert.equal(reset.effective.roles.backend.displayName, 'Service Engineer');
  await saveProject(project, { workflow: null }, 2, { root });
  assertNative((await loadProject(project, seed, root)).effective);
});

test('native-first and explicit policies survive portable template import and disk roundtrip', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-template-integration-'));
  const source = join(root, 'source'), target = join(root, 'target');
  for (const workflow of [{ mode: 'off', tokens: false, fileLimits: false, rotation: false, enforceWriteScopes: false },
    { mode: 'enforce', confirmDispatch: 'always', tokens: {}, fileLimits: {}, rotation: {}, enforceWriteScopes: true }]) {
    let before = await loadProject(source, seed, root);
    await saveProject(source, { workflow }, before.revision, { root });
    const original = toTemplate((await loadProject(source, seed, root)).effective);
    before = await loadProject(target, seed, root);
    await saveProject(target, templatePatch(original, before.effective), before.revision, { root });
    const imported = await loadProject(target, seed, root);
    assert.deepEqual(toTemplate(imported.effective), original);
    assert.equal(imported.effective.workflow.tokens === false, workflow.tokens === false);
  }
});

test('native message factory distinguishes owner input from recovery and peer messages', { skip: !process.env.DSH_NATIVE_LOOP_ENTRY }, async () => {
  const require = createRequire(resolve(dirname(process.env.DSH_NATIVE_LOOP_ENTRY), 'contract-test.cjs'));
  const { createUserMessage } = require('@deepseek-ai/dsh-llm');
  const listeners = new Map();
  const ctx = { on: (name, fn) => listeners.set(name, fn), effect() {} };
  const agent = {};
  let resets = 0;
  createContinuation(ctx, { owns: () => true }, { reset: () => resets++ });
  const signal = new AbortController().signal;
  for (const kind of ['capability-team-failover', 'agent-message', 'user']) {
    const message = createUserMessage({ content: [{ type: 'text', text: 'Continue safely' }], source: { kind } });
    await listeners.get('agent/pre-step')({ agent, signal }, async () => ({ kind: 'enter', messages: [message] }));
    assert.equal(resets, kind === 'user' ? 1 : 0);
  }
});

test('absent policy context does not accidentally enable file token or rotation policy', () => {
  const text = policyText(undefined);
  assert.doesNotMatch(text, /500 lines|6000|35%|hard threshold|must call capability_dispatch_plan/i);
  assert.match(text, /permissions|approvals/i);
});
