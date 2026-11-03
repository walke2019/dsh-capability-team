import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSingleModel, patchSingleModel, effectiveRoute, singleModelChanges, singleModelFrom } from '../single-model.js';
import { effectiveConfig, applyPatch, resolveRole, roleView, describeChanges, migrateProject } from '../config.js';
import { apply as applyRoles } from '../roles.js';
import { createTeam } from '../team.js';
import { saveProject } from '../theme.js';
import { createFailover } from '../failover.js';
import { base } from './fixture.mjs';

const SM = { provider: 'only', model: 'one-model', acceptedAt: '2026-11-03T00:00:00.000Z' };
const emptyLlm = { listProviders: () => [], listModels: async () => [] };
function fakeCtx(membership, cwd, llm = emptyLlm) {
  const listeners = {};
  const ctx = { agentPresets: { composedPreset: () => 'capability-team' }, effect: fn => fn(), systemPrompt: { section: () => () => {} },
    agentTeams: { membership, tryMembership: membership }, workingDirectory: { ensure: async () => cwd }, llm, on: (event, fn) => { listeners[event] = fn; } };
  return { ctx, request: (agent, prev) => listeners['agent/request']({ agent, turn: 1, step: 1 }, async () => prev) };
}

test('singleModel validation: shape, unknown keys, timestamp', () => {
  assert.equal(validateSingleModel(undefined), undefined);
  assert.equal(validateSingleModel(null), undefined);
  assert.deepEqual(validateSingleModel({ ...SM, provider: ' only ' }), SM);
  assert.throws(() => validateSingleModel({ ...SM, extra: 1 }), /未知字段 extra/);
  assert.throws(() => validateSingleModel({ ...SM, acceptedAt: 'yesterday' }), /ISO/);
  assert.throws(() => validateSingleModel({ provider: 'p', acceptedAt: SM.acceptedAt }), /model/);
  assert.throws(() => validateSingleModel('p/m'), /必须为对象/);
});

test('patch rule: undefined keeps, null clears, object replaces', () => {
  assert.deepEqual(patchSingleModel(SM, undefined), { singleModel: SM });
  assert.deepEqual(patchSingleModel(SM, null), {});
  assert.deepEqual(patchSingleModel(undefined, SM), { singleModel: SM });
  const saved = applyPatch({ revision: 2 }, { singleModel: SM });
  assert.deepEqual(saved.singleModel, SM);
  assert.deepEqual(applyPatch(saved, { name: 'x' }).singleModel, SM);
  assert.equal('singleModel' in applyPatch(saved, { singleModel: null }), false);
  assert.deepEqual(migrateProject(saved).singleModel, SM);
});

test('routing: assigned roles keep their routes, unassigned ones use the single model without backups', () => {
  assert.deepEqual(effectiveRoute({ provider: 'a', model: 'b', fallbacks: [{ provider: 'c', model: 'd' }] }, SM).fallbacks.length, 1);
  assert.deepEqual(effectiveRoute({ fallbacks: [] }, SM), { provider: 'only', model: 'one-model', fallbacks: [], singleModel: true });
  assert.equal(effectiveRoute({ fallbacks: [] }, undefined).unassigned, true);
  // seed has no routes: every role is unassigned without the mode and routed with it.
  const off = effectiveConfig({});
  assert.equal(resolveRole({ role: 'teammate', name: 'backend' }, off).unassigned, true);
  const on = effectiveConfig({ singleModel: SM });
  const role = resolveRole({ role: 'teammate', name: 'backend' }, on);
  assert.equal(role.unassigned, undefined);
  assert.deepEqual([role.provider, role.model, role.fallbacks, role.singleModel], ['only', 'one-model', [], true]);
  assert.ok(roleView(on).every(r => r.singleModel === true));
  // A base with real routes: those roles are untouched by the mode.
  const mixed = effectiveConfig({ singleModel: SM }, base);
  assert.ok(roleView(mixed).every(r => !r.singleModel && r.provider !== 'only'));
});

test('confirmation lines name the mode, its lack of backups and how to turn it off', () => {
  assert.match(singleModelChanges(undefined, SM)[0], /单模型模式：开启.*only\/one-model.*无同档备选.*可随时关闭/);
  assert.match(singleModelChanges(SM, undefined)[0], /关闭/);
  assert.deepEqual(singleModelChanges(SM, { ...SM, acceptedAt: '2026-11-04T00:00:00.000Z' }), []);
  assert.ok(describeChanges(effectiveConfig({}), effectiveConfig({ singleModel: SM })).some(l => l.startsWith('单模型模式')));
});

test('source model comes from the DSH default selection; missing selection is an actionable error', () => {
  const now = new Date('2026-11-03T08:00:00Z');
  assert.deepEqual(singleModelFrom({ provider: 'p', model: 'm', reasoningEffort: 'high' }, now), { provider: 'p', model: 'm', acceptedAt: now.toISOString() });
  assert.throws(() => singleModelFrom(undefined), /默认模型/);
});

test('unassigned request is refused with the single-model hint; a saved mode routes it instead', async () => {
  const root = await mkdtemp(join(tmpdir(), 'single-model-'));
  try {
    const f = fakeCtx(() => ({ role: 'teammate', name: 'backend' }), root);
    const team = createTeam(f.ctx, {}, { root });
    applyRoles(f.ctx, team, createFailover({ sleep: async () => true }));
    await assert.rejects(f.request({}, { provider: 'lead', model: 'inherited' }), /未分配合格模型.*single_model=use-default.*单模型模式/);
    await saveProject(root, { singleModel: SM }, 0, { root, base: team.base });
    assert.deepEqual(await f.request({}, { provider: 'lead', model: 'inherited', reasoningEffort: 'max' }), { provider: 'only', model: 'one-model' });
    await saveProject(root, { singleModel: null }, 1, { root, base: team.base });
    await assert.rejects(f.request({}, {}), /未分配合格模型/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
