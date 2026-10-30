import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTeamReader, readTeamSnapshot } from '../runtime-view.js';
import { inspectTeamRuntime } from '../ui.js';
test('状态读取按Agent隔离，撤销旧注册不会删除新注册', async () => {
  const a = {}, b = {};
  const off1 = registerTeamReader(a, () => ({ revision: 1 }));
  const off2 = registerTeamReader(a, () => ({ revision: 2 }));
  off1();
  assert.equal((await readTeamSnapshot(a)).revision, 2);
  assert.equal(await readTeamSnapshot(b), null);
  off2(); assert.equal(await readTeamSnapshot(a), null);
});
test('配置损坏不掩盖挂载状态，且主会话日志只读取一次', async () => {
  const agent = { id: 'fixture', ctx: {} }; let reads = 0;
  const off = registerTeamReader(agent, () => { throw new Error('策略损坏'); });
  const ctx = { agentPresets: { composedPreset: () => 'capability-team', list: async () => [{ id: 'capability-team' }] },
    tools: { schemas: () => [] }, get: key => key === 'sessionQuery' ? { readSession: async () => { reads++; return { events: [] }; } } : undefined };
  try {
    const result = await inspectTeamRuntime(ctx, agent);
    assert.equal(result.team, null); assert.equal(result.teamError, '策略损坏');
    assert.equal(result.preset, 'capability-team'); assert.equal(reads, 1);
  } finally { off(); }
});
test('团队总览返回真实配置，不生成实际模型调用记录', async () => {
  const agent = { id: 'fixture', ctx: {} };
  const off = registerTeamReader(agent, () => ({ roles: [{ id: 'qa', model: 'fixture-model' }], actualRequest: null }));
  const ctx = { agentPresets: { composedPreset: () => 'capability-team', list: async () => [{ id: 'capability-team' }] },
    tools: { schemas: () => ['capability_team_read', 'capability_dispatch_plan', 'capability_free_task'].map(name => ({ name })) } };
  try {
    const result = await inspectTeamRuntime(ctx, agent);
    assert.equal(result.team.roles[0].model, 'fixture-model');
    assert.equal(result.team.actualRequest, null);
  } finally { off(); }
});
test('团队活动只读取宿主名册与看板，过滤已删除任务，读取失败如实返回', async () => {
  const { teamActivity } = await import('../ui.js');
  const teams = {
    listMembers: () => [{ id: 's1', name: 'lead', role: 'lead', status: 'running', model: 'm', provider: 'p', diagnostics: [], extra: 'secret' }],
    listTasks: () => [{ id: 1, subject: 'a', status: 'in_progress', ownerName: 'lead', description: 'long' }, { id: 2, subject: 'b', status: 'deleted' }],
  };
  const result = teamActivity({ get: key => key === 'agentTeams' ? teams : undefined }, {});
  assert.deepEqual(result.members, [{ id: 's1', name: 'lead', role: 'lead', status: 'running', provider: 'p', model: 'm', diagnostics: [] }]);
  assert.deepEqual(result.tasks, [{ id: 1, subject: 'a', status: 'in_progress', ownerName: 'lead' }]);
  const broken = teamActivity({ get: () => ({ listMembers() { throw new Error('not a member'); } }) }, {});
  assert.deepEqual(broken.members, []); assert.match(broken.unavailable, /not a member/);
  assert.match(teamActivity({}, {}).unavailable, /团队服务/);
});

test('状态命令输出压缩目录行并去掉重复字段，客户端可还原', async () => {
  const { compactStatus } = await import('../ui.js');
  const evidence = { sessionId: 's', name: 'lead', records: [] };
  const status = { sessionId: 's', preset: 'capability-team', requestEvidence: evidence, memberEvidence: [evidence],
    team: { roles: [], autoMatch: [{ big: true }], modelPolicy: { revision: 2, disabledRoutes: [], allocations: [], tierCatalog: { high: ['m'] },
      rows: [{ key: 'p/a', provider: 'p', model: 'a', tiers: ['high'], primaryFor: ['lead'], fallbackFor: [], disabled: false, verified: false },
        { key: 'p/b', provider: 'p', model: 'b', tiers: [], primaryFor: [], fallbackFor: ['qa'] }, { key: 'p/c', tiers: ['low'], primaryFor: [], fallbackFor: [] }] } } };
  const out = compactStatus(status);
  assert.equal(out.requestEvidence, undefined);
  assert.equal(out.team.autoMatch, undefined);
  assert.equal(out.team.modelPolicy.tierCatalog, undefined);
  assert.deepEqual(out.team.modelPolicy.rows, [['p/a', 'high', ['lead']], ['p/b', null, [], ['qa']], ['p/c', 'low']]);
  assert.equal(out.team.modelPolicy.revision, 2);
  assert.ok(JSON.stringify(out).length < JSON.stringify(status).length);
});
