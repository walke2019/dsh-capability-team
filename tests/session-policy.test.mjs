import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSessionPolicy, saveSessionPolicy, sessionPolicyPath } from '../session-policy.js';
test('会话策略持久化、隔离、版本冲突及损坏时拒绝', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-policy-'));
  try {
    assert.deepEqual(await readSessionPolicy('a', root), { revision: 0, disabledRoutes: [] });
    await saveSessionPolicy('a', ['fixture/model'], 0, root);
    assert.deepEqual((await readSessionPolicy('a', root)).disabledRoutes, ['fixture/model']);
    assert.deepEqual((await readSessionPolicy('b', root)).disabledRoutes, []);
    await assert.rejects(saveSessionPolicy('a', [], 0, root), /已变化/);
    await saveSessionPolicy('a', [], 1, root);
    assert.equal((await readSessionPolicy('a', root)).revision, 2);
    await writeFile(sessionPolicyPath('a', root), '{broken');
    await assert.rejects(readSessionPolicy('a', root), /损坏/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('两个并发保存不能覆盖同一版本', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-policy-'));
  try {
    const results = await Promise.allSettled([saveSessionPolicy('a', ['p/one'], 0, root), saveSessionPolicy('a', ['p/two'], 0, root)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await readSessionPolicy('a', root)).revision, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('模型策略全局共享：一个主会话保存后，其他会话及新会话读取同一份', async () => {
  const { createTeam } = await import('../team.js');
  const { readGlobalPolicy, globalPolicyPath } = await import('../session-policy.js');
  const root = await mkdtemp(join(tmpdir(), 'global-policy-'));
  try {
    const leadA = { id: 'session-a' }, leadB = { id: 'session-b' }, mateB = { id: 'mate-b' };
    const roles = new Map([[leadA, { role: 'lead', root: leadA }], [leadB, { role: 'lead', root: leadB }], [mateB, { role: 'teammate', name: 'qa', root: leadB }]]);
    const team = createTeam({ agentTeams: { membership: agent => roles.get(agent) } }, {}, { root });
    const saved = await team.savePolicy(leadA, ['@cf/*', 'p/m'], 0);
    assert.equal(saved.revision, 1);
    assert.deepEqual((await team.policy(leadB)).disabledRoutes, ['@cf/*', 'p/m']);
    assert.deepEqual((await team.policy(mateB)).disabledRoutes, ['@cf/*', 'p/m']);
    await assert.rejects(team.savePolicy(leadB, [], 0), /已变化/);
    await assert.rejects(team.savePolicy(mateB, [], 1), /仅主会话/);
    await team.savePolicy(leadB, ['@cf/*'], 1);
    assert.deepEqual((await readGlobalPolicy(root)).disabledRoutes, ['@cf/*']);
    assert.notEqual(globalPolicyPath(root), sessionPolicyPath('session-a', root));
    assert.deepEqual((await readSessionPolicy('session-a', root)).disabledRoutes, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
