import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freeArgs, apply as applyRoles, policy } from '../roles.js';
import { createTeam } from '../team.js';
import { saveProject } from '../theme.js';
import { seed } from '../config.js';
import { base, fakeLlm } from './fixture.mjs';
import { createFailover } from '../failover.js';
function fakeCtx(membership, cwd) {
  const listeners = {}; const sections = [];
  const ctx = {
    effect: fn => fn(),
    systemPrompt: { section: s => { sections.push(s); return () => {}; } },
    agentTeams: { membership: () => membership(), tryMembership: () => membership() },
    workingDirectory: { ensure: async () => cwd() },
    llm: fakeLlm(),
    on: (event, fn) => { listeners[event] = fn; },
  };
  return { ctx, sections, request: (agent, prev, turn = 1, step = 1) => listeners['agent/request']({ agent, turn, step }, async () => prev),
    error: (agent, failure, downstream) => listeners['agent/request-error']({ agent, failure, signal: new AbortController().signal }, async () => downstream) };
}
const apply = (ctx, team, failover = createFailover({ sleep: async () => true })) => applyRoles(ctx, team, failover);
test('每个默认角色按能力路由，且不发起模型调用', async () => {
  const root = await mkdtemp(join(tmpdir(), 'route-'));
  try {
    for (const [id, role] of Object.entries(seed.roles)) {
      const m = { role: id === 'lead' ? 'lead' : 'teammate', name: id };
      const f = fakeCtx(() => m, () => root);
      apply(f.ctx, createTeam(f.ctx, {}, { root }));
      const c = base.capabilities[role.capability];
      assert.deepEqual(await f.request({}, { provider: 'x', model: 'y', reasoningEffort: 'max', maxTokens: 9 }), { provider: c.provider, model: c.model });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('未分配模型时拒绝请求，不静默继承主控模型', async () => {
  const root = await mkdtemp(join(tmpdir(), 'route-unassigned-'));
  try {
    const f = fakeCtx(() => ({ role: 'teammate', name: 'lv-bu' }), () => root);
    f.ctx.llm = { listProviders: () => [], listModels: async () => [] };
    apply(f.ctx, createTeam(f.ctx, {}, { root }));
    await assert.rejects(f.request({}, { provider: 'parent', model: 'inherited' }), /未分配合格模型.*不会自动沿用/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('静态规则不含角色名、模型或档位', () => {
  for (const r of Object.values(seed.roles)) assert.equal(policy.includes(r.displayName), false);
  for (const c of Object.values(base.capabilities)) assert.equal(policy.includes(c.model), false);
});
test('项目配置在请求时生效，未登记队友给出可执行的报错', async () => {
  const root = await mkdtemp(join(tmpdir(), 'route-'));
  try {
    let m = { role: 'teammate', name: 'zhao-yun' };
    const f = fakeCtx(() => m, () => root);
    const team = createTeam(f.ctx, {}, { root }); apply(f.ctx, team);
    await saveProject(root, { tiers: { medium: [...base.tiers.medium, 'new-model'] }, capabilities: { research: { provider: 'p2', model: 'new-model', fallbacks: [] } } }, 0, { root, base });
    assert.deepEqual(await f.request({}, {}), { provider: 'p2', model: 'new-model' });
    m = { role: 'teammate', name: 'guan-yu' };
    await assert.rejects(f.request({}, {}), /未在当前项目的团队配置中登记.*capability_team_save/);
    await saveProject(root, { roles: { 'guan-yu': { displayName: '运维', capability: 'backend' } } }, 1, { root, base });
    assert.equal((await f.request({}, {})).model, base.capabilities.backend.model);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('非团队会话不被改写路由', async () => {
  const f = fakeCtx(() => undefined, () => tmpdir());
  apply(f.ctx, createTeam(f.ctx, {}));
  assert.deepEqual(await f.request({}, { provider: 'a', model: 'b' }), { provider: 'a', model: 'b' });
});
test('项目在首次请求时固定，切换子目录不换配置', async () => {
  const root = await mkdtemp(join(tmpdir(), 'route-'));
  try {
    const project = join(root, 'p'); const sub = join(project, 'src'); await mkdir(sub, { recursive: true });
    await saveProject(project, { capabilities: { research: { provider: 'pinned' } } }, 0, { root, base });
    let cwd = sub;
    const f = fakeCtx(() => ({ role: 'teammate', name: 'zhao-yun' }), () => cwd);
    apply(f.ctx, createTeam(f.ctx, {}, { root }));
    const agent = {};
    assert.equal((await f.request(agent, {})).provider, 'pinned');
    cwd = root;
    assert.equal((await f.request(agent, {})).provider, 'pinned');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('渠道ID不变时显式刷新仍更新模型目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'route-refresh-'));
  try {
    const f = fakeCtx(() => ({ role: 'teammate', name: 'lv-bu' }), () => root);
    let model = 'gpt-6-sol';
    f.ctx.llm = { listProviders: () => [{ id: 'fixture' }], listModels: async () => [{ id: model }] };
    const team = createTeam(f.ctx, {}, { root });
    await team.refresh();
    assert.equal(team.base.capabilities.backend.model, 'gpt-6-sol');
    model = 'gpt-6.1-sol';
    await team.refresh();
    assert.equal(team.base.capabilities.backend.model, model);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('队友共享主会话禁用策略，策略变化立即影响同一步请求', async () => {
  const root = await mkdtemp(join(tmpdir(), 'route-policy-'));
  try {
    const lead = { id: 'fixture-lead' }, mate = { id: 'fixture-mate' };
    let membership = { role: 'lead', root: lead };
    const f = fakeCtx(() => membership, () => root);
    const team = createTeam(f.ctx, {}, { root }); apply(f.ctx, team);
    await team.refresh();
    const role = team.base.capabilities.backend;
    const all = [`${role.provider}/${role.model}`, ...role.fallbacks.map(r => `${r.provider}/${r.model}`)];
    await team.savePolicy(lead, all, 0);
    membership = { role: 'teammate', name: 'lv-bu', root: lead };
    const rerouted = await f.request(mate, {});
    assert.ok(!all.includes(`${rerouted.provider}/${rerouted.model}`));
    await assert.rejects(team.savePolicy(mate, [], 1), /仅主会话/);
    membership = { role: 'lead', root: lead };
    await team.savePolicy(lead, team.detection().entries.map(r => `${r.provider}/${r.model}`), 1);
    membership = { role: 'teammate', name: 'lv-bu', root: lead };
    await assert.rejects(f.request(mate, {}), /未分配合格模型/);
    membership = { role: 'lead', root: lead };
    await team.savePolicy(lead, [], 2);
    membership = { role: 'teammate', name: 'lv-bu', root: lead };
    assert.equal((await f.request(mate, {})).model, role.model);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('免费通道禁止付费与参数注入', () => {
  const allowed = ['opencode/a-free'];
  assert.throws(() => freeArgs('test', 'paid/model', allowed), /免费/);
  assert.throws(() => freeArgs('test', undefined, allowed), /免费/);
  assert.throws(() => freeArgs('', 'opencode/a-free', allowed), /任务/);
  assert.deepEqual(freeArgs('--model paid/x', 'opencode/a-free', allowed).slice(-2), ['--', '--model paid/x']);
});
