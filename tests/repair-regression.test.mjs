import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile, mkdir, utimes } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { runFreeWorker } from '../free-worker.mjs';
import { createTeam } from '../team.js';
import { teamContext } from '../theme-plugin.js';
import { fakeLlm, base } from './fixture.mjs';
import { createFailover } from '../failover.js';
import { createWorkflow } from '../workflow.js';
import { saveSessionPolicy, sessionPolicyPath } from '../session-policy.js';
import { saveProject, themePath, STALE_LOCK_MS } from '../theme.js';
import { inspectTeamRuntime } from '../ui.js';
import { registerTeamReader } from '../runtime-view.js';
import { readTeamEvidence } from '../request-evidence.js';

const models = ['opencode/fixture-a-free', 'opencode/fixture-b-free'];
const options = { executable: 'fixture', resolveModels: async () => models };
const event = text => JSON.stringify({ type: 'text', part: { text } }) + '\n';
function child(run) {
  const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.closed = false;
  c.finish = (code, signal = null) => { if (!c.closed) { c.closed = true; c.emit('close', code, signal); } };
  c.kill = () => { queueMicrotask(() => c.finish(null, 'SIGTERM')); return true; };
  queueMicrotask(() => run(c)); return c;
}
test('修复：UTF-8按单字节分块仍保留中文与emoji', async () => {
  const result = await runFreeWorker('x', { ...options, launch: () => child(c => {
    for (const byte of Buffer.from(event('完成中文🙂'))) c.stdout.emit('data', Buffer.from([byte]));
    c.finish(0);
  }) });
  assert.equal(result.text, '完成中文🙂');
});
for (const newline of ['', '\n']) test(`修复：跨块额度错误切换免费备用，行尾=${JSON.stringify(newline)}`, async () => {
  let calls = 0;
  const result = await runFreeWorker('x', { ...options, launch: () => {
    calls++;
    return calls === 1 ? child(c => {
      c.stderr.emit('data', Buffer.from('level=ERROR error.err'));
      c.stderr.emit('data', Buffer.from('or="AI_APICallError: Free usage limit reached"' + newline));
      setImmediate(() => c.finish(1));
    }) : child(c => { c.stdout.emit('data', event('备用完成')); c.finish(0); });
  } });
  assert.equal(calls, 2); assert.equal(result.text, '备用完成'); assert.equal(result.model, models[1]);
});
test('修复：允许16000字符输入但拒绝空白和超限输入', async () => {
  let calls = 0;
  const launch = () => { calls++; return child(c => { c.stdout.emit('data', event('accepted')); c.finish(0); }); };
  for (const tools of ['none', 'read', 'write']) assert.equal((await runFreeWorker('a'.repeat(16000), { ...options, tools, launch })).text, 'accepted');
  for (const prompt of ['', '   ', 'a'.repeat(16001)]) await assert.rejects(runFreeWorker(prompt, { ...options, launch }), /任务/);
  assert.equal(calls, 3);
});
test('修复：同一步备用失败后仍可使用刚结束冷却的主模型，且不循环重试', async () => {
  let now = 0;
  const f = createFailover({ now: () => now });
  const role = { provider: 'a', model: 'm', fallbacks: [{ provider: 'b', model: 'm' }], failover: { ...base.failover, retries: 0, cooldownMs: 10 } };
  const warmup = {}, agent = {};
  f.route(warmup, 1, 1, role); await f.recover(warmup, { code: 'QUOTA' });
  assert.equal(f.route(agent, 1, 1, role).provider, 'b'); now = 11;
  assert.equal(await f.recover(agent, { code: 'QUOTA' }), true);
  assert.equal(f.route(agent, 1, 1, role).provider, 'a'); now = 30;
  assert.equal(await f.recover(agent, { code: 'QUOTA' }), false);
});
test('修复：会话策略同时影响同步提示词和异步请求，恢复后立即一致', async () => {
  const root = await mkdtemp(join(tmpdir(), 'repair-policy-'));
  try {
    const lead = { id: 'fixture-lead' }, mate = { id: 'fixture-mate' };
    const membership = agent => ({ role: agent === lead ? 'lead' : 'teammate', name: agent === lead ? 'lead' : 'lv-bu', root: lead });
    const ctx = { llm: fakeLlm(), agentTeams: { membership, tryMembership: membership }, workingDirectory: { ensure: async () => root } };
    const team = createTeam(ctx, {}, { root }); const before = await team.resolve(mate);
    await team.savePolicy(lead, [`${before.provider}/${before.model}`], 0);
    const after = await team.resolve(mate);
    assert.notEqual(`${after.provider}/${after.model}`, `${before.provider}/${before.model}`);
    const context = teamContext(team, mate, membership(mate));
    const self = JSON.parse(context.split('\n')[1].replace('你的角色：', ''));
    assert.equal(self.provider, after.provider); assert.equal(self.model, after.model);
    assert.equal(team.loadSync(root, mate).policy.revision, 1);
    await team.savePolicy(lead, [], 1);
    assert.equal((await team.resolve(mate)).model, before.model);
    assert.equal(team.loadSync(root, mate).policy.revision, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('修复：主控配置损坏时不放行执行工具', () => {
  const agent = {};
  const ctx = { agentTeams: { tryMembership: () => ({ role: 'lead' }) } };
  const team = { pinned: () => 'fixture', loadSync: () => { throw new Error('broken fixture'); } };
  assert.match(createWorkflow(ctx, team).guard({ agent, name: 'pwsh' }), /配置读取失败/);
});
test('修复：等待真人确认的活动锁超过30秒也不能抢占', async () => {
  const root = await mkdtemp(join(tmpdir(), 'repair-live-lock-'));
  try {
    await writeFile(themePath(root, root) + '.lock', JSON.stringify({ pid: process.pid, at: Date.now() - STALE_LOCK_MS - 1000 }));
    await assert.rejects(saveProject(root, { name: 'override' }, 0, { root }), /正在被/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('修复：崩溃遗留的旧版空策略锁可恢复，活动进程锁不回收', async () => {
  const root = await mkdtemp(join(tmpdir(), 'repair-policy-lock-'));
  try {
    const lock = sessionPolicyPath('fixture', root) + '.lock'; await mkdir(dirname(lock), { recursive: true });
    await writeFile(lock, ''); const old = new Date(Date.now() - STALE_LOCK_MS - 1000); await utimes(lock, old, old);
    assert.equal((await saveSessionPolicy('fixture', [], 0, root)).revision, 1);
    await writeFile(lock, JSON.stringify({ pid: process.pid, at: +old }));
    await assert.rejects(saveSessionPolicy('fixture', [], 1, root), /正在被/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('修复：预设未注册或激活失败时不能报告已就绪', async () => {
  const agent = { id: 'fixture', ctx: {} }; const off = registerTeamReader(agent, () => ({ roles: [] }));
  const ctx = { agentPresets: { composedPreset: () => 'capability-team', list: async () => [] },
    tools: { schemas: () => ['capability_team_read', 'capability_dispatch_plan', 'capability_free_task'].map(name => ({ name })) } };
  try {
    const missing = await inspectTeamRuntime(ctx, agent); assert.equal(missing.ready, false); assert.match(missing.explanation, /未注册/);
    ctx.agentPresets.list = async () => [{ id: 'capability-team', broken: 'fixture load failed' }];
    const broken = await inspectTeamRuntime(ctx, agent); assert.equal(broken.ready, false); assert.match(broken.explanation, /激活失败/);
  } finally { off(); }
});
test('修复：团队服务尚未就绪时只读诊断保留自身日志而非整体崩溃', async () => {
  const result = await readTeamEvidence({ readSession: async () => ({ events: [] }) }, { listMembers() { throw new Error('not initialized'); } }, { id: 'fixture' });
  assert.equal(result[0].sessionId, 'fixture'); assert.deepEqual(result[0].records, []); assert.match(result[0].unavailable, /not initialized/);
});
