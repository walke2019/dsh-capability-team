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
test('免费通道禁止付费与参数注入', () => {
  assert.throws(() => freeArgs('test', 'paid/model'), /免费/);
  assert.throws(() => freeArgs(''), /任务/);
  assert.deepEqual(freeArgs('--model paid/x').slice(-2), ['--', '--model paid/x']);
});
