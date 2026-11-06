import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadProject, saveProject, themePath, projectRoot, STALE_LOCK_MS } from '../theme.js';
import { seed, effectiveConfig, validateConfig, roleView, resolveRole, baseConfig, describeChanges } from '../config.js';
import { base } from './fixture.mjs';
const temp = () => mkdtemp(join(tmpdir(), 'team-config-'));
test('持久化、项目隔离与版本冲突保护', async () => {
  const root = await temp();
  try {
    const a = join(root, 'a'); const b = join(root, 'b');
    assert.equal((await loadProject(a, seed, root)).revision, 0);
    await saveProject(a, { roles: { 'frontend': { displayName: '前端工程师' } } }, 0, { root });
    assert.equal((await loadProject(a, seed, root)).effective.roles['frontend'].displayName, '前端工程师');
    assert.equal((await loadProject(b, seed, root)).revision, 0);
    await assert.rejects(saveProject(a, { name: 'x' }, 0, { root }), /revision conflict/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('档位、能力与角色都可配置，并与名称、描述统一生成', () => {
  const e = effectiveConfig({
    tiers: { premium: ['brand-new'] },
    capabilities: { frontend: { provider: 'custom', model: 'brand-new', tier: 'premium', fallbacks: [] }, ops: { job: '部署', provider: 'p', model: 'gpt-6-luna', tier: 'low' } },
    roles: { 'frontend': { displayName: '界面工程师', description: '交互与无障碍验收' }, 'guan-yu': { displayName: '运维', capability: 'ops' }, 'writer': null },
  }, base);
  const ui = roleView(e).find(r => r.id === 'frontend');
  assert.deepEqual([ui.displayName, ui.description, ui.provider, ui.model, ui.tier], ['界面工程师', '交互与无障碍验收', 'custom', 'brand-new', 'premium']);
  assert.equal(JSON.stringify(ui).includes('Frontend'), false);
  assert.equal(resolveRole({ role: 'teammate', name: 'guan-yu' }, e).capability, 'ops');
  assert.equal(e.roles['writer'], undefined); // stored null marks a deleted entry
});
test('null 恢复默认，false 删除角色', async () => {
  const root = await temp();
  try {
    await saveProject(root, { roles: { 'backend': { displayName: '后端' }, 'writer': false } }, 0, { root });
    let { effective } = await loadProject(root, seed, root);
    assert.equal(effective.roles['backend'].displayName, '后端'); assert.equal(effective.roles['writer'], undefined);
    await saveProject(root, { roles: { 'backend': null, 'writer': null } }, 1, { root });
    ({ effective } = await loadProject(root, seed, root));
    assert.equal(effective.roles['backend'].displayName, 'Backend'); assert.equal(effective.roles['writer'].displayName, 'Writer');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('拒绝越界：主控能力、重复名、未分档模型、未知字段', () => {
  const bad = patch => () => effectiveConfig(patch, base);
  assert.throws(bad({ roles: { x: { displayName: '甲', capability: 'orchestrator' } } }), /orchestrator/);
  assert.throws(bad({ roles: { 'backend': { displayName: 'Lead' } } }), /[Dd]uplicate/);
  // An ungraded model is adopted into the tier of the capability the user assigns it to; a model graded into
  // another tier is a cross-tier route and stays rejected.
  const qaTier = base.capabilities.qa.tier;
  const adopted = effectiveConfig({ capabilities: { qa: { provider: 'relay', model: 'house-model-y', fallbacks: [{ provider: 'relay', model: 'house-model-z' }] } } }, base);
  assert.ok(adopted.tiers[qaTier].includes('house-model-y') && adopted.tiers[qaTier].includes('house-model-z'), '未分级的主模型与备选都登记进该能力的档位');
  const [otherTier, [foreign]] = Object.entries(base.tiers).find(([t, list]) => t !== qaTier && list.length);
  assert.throws(bad({ capabilities: { qa: { provider: 'relay', model: foreign, fallbacks: [] } } }), new RegExp(`already in tier ${otherTier}`));
  assert.throws(bad({ capabilities: { qa: { fallbacks: [{ provider: 'relay', model: foreign }] } } }), /not tier/);
  assert.throws(bad({ roles: { lead: { displayName: 'A', permissions: 'all' } } }), /unknown fields/);
  assert.throws(bad({ roles: { lead: false } }), /lead/);
  assert.throws(bad({ roles: { Bad_Id: { displayName: 'A', capability: 'qa' } } }), /lower-kebab-case/);
  // Emptying a tier list keeps the models that capabilities still route to: an explicit route grades itself.
  assert.ok(validateConfig({ ...base, tiers: { ...base.tiers, upper: [] } }).tiers.upper.length > 0);
});
test('失败的校验或确认不写入文件', async () => {
  const root = await temp();
  try {
    await assert.rejects(saveProject(root, { roles: { lead: { displayName: '主控' } } }, 0, { root, check: async () => { throw new Error('User did not confirm'); } }), /did not confirm/);
    assert.equal((await loadProject(root, seed, root)).revision, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('过期锁自动回收，活动锁仍然拒绝', async () => {
  const root = await temp();
  try {
    const lock = themePath(root, root) + '.lock'; await mkdir(dirname(lock), { recursive: true });
    await writeFile(lock, JSON.stringify({ pid: process.pid, at: Date.now() }));
    await assert.rejects(saveProject(root, { name: 'x' }, 0, { root }), /Another session is saving team configuration/);
    await writeFile(lock, JSON.stringify({ at: Date.now() - STALE_LOCK_MS - 1 }));
    assert.equal((await saveProject(root, { name: 'x' }, 0, { root })).revision, 1);
    await writeFile(lock, '');
    await assert.rejects(saveProject(root, { name: 'y' }, 1, { root }), /Another session is saving/); // fresh empty lock
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('子目录归属到已有配置的上级项目', async () => {
  const root = await temp();
  try {
    const project = join(root, 'p'); const sub = join(project, 'a', 'b');
    assert.equal(projectRoot(sub, root), sub);
    await saveProject(project, { name: '项目' }, 0, { root });
    assert.equal(projectRoot(sub, root), project);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('旧版 names/descriptions/routes 文件自动迁移', async () => {
  const root = await temp();
  try {
    const path = themePath(root, root); await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ revision: 3, name: '旧', names: { 'qa': '测试官' }, descriptions: { 'qa': '回归' }, routes: { qa: { provider: 'win', model: 'claude-sonnet-5-5', tier: 'upper', fallbacks: [] } } }));
    const { revision, effective } = await loadProject(root, base, root);
    assert.equal(revision, 3);
    assert.deepEqual([effective.roles['qa'].displayName, effective.roles['qa'].description, effective.capabilities.qa.model], ['测试官', '回归', 'claude-sonnet-5-5']);
    await saveProject(root, { name: '新' }, 3, { root, base });
    assert.equal(JSON.parse(await readFile(path, 'utf8')).names, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('预设 bindings 可改名与新增，差异可读', () => {
  const base = baseConfig({ bindings: { lead: { displayName: '主控', capability: 'orchestrator' }, dev: { displayName: '开发', capability: 'backend' } } });
  assert.deepEqual(Object.keys(base.roles), ['lead', 'dev']);
  const lines = describeChanges(effectiveConfig({}), effectiveConfig({ roles: { lead: { displayName: '统帅' } } }));
  assert.equal(lines.length, 1); assert.match(lines[0], /统帅/);
});
