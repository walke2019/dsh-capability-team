import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seed, effectiveConfig, resolveRole, baseConfig } from '../config.js';
import { loadProject, saveProject, themePath } from '../theme.js';
import { DEFAULT_ROLES, THREE_KINGDOMS_ROLES, themePatch } from '../roster-defaults.js';
import { apply } from '../theme-plugin.js';
import { createTeam } from '../team.js';
import { CATALOG, fakeLlm } from './fixture.mjs';
const temp = () => mkdtemp(join(tmpdir(), 'roster-'));
const names = e => Object.fromEntries(Object.entries(e.roles).map(([id, r]) => [id, r.displayName]));
const HEROES = ['lead', 'zhuge-liang', 'lv-bu', 'diao-chan', 'zhao-yun', 'chen-lin', 'zhou-yu'];

test('fresh install shows the neutral roster, in the seed and the shipped preset bindings', async () => {
  assert.deepEqual(Object.keys(seed.roles), ['lead', 'architect', 'backend', 'frontend', 'researcher', 'writer', 'qa']);
  assert.deepEqual(names(effectiveConfig({})), { lead: 'Lead', architect: 'Architect', backend: 'Backend', frontend: 'Frontend', researcher: 'Researcher', writer: 'Writer', qa: 'QA' });
  assert.equal(seed.roles.researcher.capability, 'research');
  assert.equal(seed.roles.architect.capability, 'technical-director');
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  const bindings = Object.fromEntries([...patch.matchAll(/^ {16}([a-z-]+): \{ displayName: ([^,]+), capability: ([a-z-]+) \}$/gm)].map(m => [m[1], { displayName: m[2], capability: m[3] }]));
  assert.deepEqual(bindings, Object.fromEntries(Object.entries(DEFAULT_ROLES).map(([id, r]) => [id, { ...r }])));
  assert.doesNotMatch(patch, /孙权|吕布|貂蝉|诸葛亮/);
  const root = await temp();
  try { assert.deepEqual(Object.keys((await loadProject(join(root, 'p'), baseConfig({ bindings }), root)).effective.roles), Object.keys(DEFAULT_ROLES)); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test('a config saved before 4.0 with hero ids still loads, validates and routes', async () => {
  const root = await temp();
  try {
    const project = join(root, 'legacy'); await mkdir(project);
    // Shapes written by 3.x: a rename, a deletion and a description on top of the hero default.
    await writeFile(themePath(project, root), JSON.stringify({ revision: 4, project, roles: { 'lv-bu': { displayName: '后端' }, 'chen-lin': null, 'zhou-yu': { description: '回归' } } }));
    const { effective, revision } = await loadProject(project, seed, root);
    assert.equal(revision, 4);
    assert.deepEqual(Object.keys(effective.roles).sort(), HEROES.filter(id => id !== 'chen-lin').sort());
    assert.deepEqual([effective.roles.lead.displayName, effective.roles['lv-bu'].displayName, effective.roles['zhou-yu'].description], ['孙权', '后端', '回归']);
    assert.equal(resolveRole({ role: 'teammate', name: 'lv-bu-r2' }, effective).capability, 'backend');
    // The next save pins the hero roster explicitly, so it no longer depends on detection.
    const saved = await saveProject(project, { roles: { 'zhao-yun': { displayName: '侦察' } } }, 4, { root });
    assert.equal(saved.effective.roles['zhao-yun'].displayName, '侦察');
    const stored = JSON.parse(await readFile(themePath(project, root), 'utf8'));
    assert.equal(stored.roster, 2);
    assert.equal(stored.roles.architect, null);
    const again = (await loadProject(project, seed, root)).effective;
    assert.deepEqual(names(again), { ...names(saved.effective) });
    assert.equal(again.roles['chen-lin'], undefined); assert.equal(again.roles['lv-bu'].displayName, '后端');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a 3.x save holding complete hero roles keeps the hero roster without duplicating neutral roles', async () => {
  const root = await temp();
  try {
    const project = join(root, 'full'); await mkdir(project);
    // A 3.x template import wrote complete roles, without renames or deletions and without the 4.0 marker.
    const roles = Object.fromEntries(Object.entries(THREE_KINGDOMS_ROLES).map(([id, r]) => [id, { ...r }]));
    await writeFile(themePath(project, root), JSON.stringify({ revision: 2, project, roles }));
    const { effective } = await loadProject(project, seed, root);
    assert.deepEqual(Object.keys(effective.roles).sort(), [...HEROES].sort());
    const perCapability = Object.values(effective.roles).reduce((m, r) => ({ ...m, [r.capability]: (m[r.capability] ?? 0) + 1 }), {});
    assert.ok(Object.values(perCapability).every(n => n === 1), JSON.stringify(perCapability));
    // A 4.0 save carrying the marker is taken as written, even with complete hero roles.
    await writeFile(themePath(project, root), JSON.stringify({ revision: 3, project, roster: 2, roles: { extra: { displayName: '额外', capability: 'qa' } } }));
    assert.deepEqual(Object.keys((await loadProject(project, seed, root)).effective.roles).sort(), [...Object.keys(DEFAULT_ROLES), 'extra'].sort());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('members spawned under hero ids keep routing on the neutral roster', () => {
  const e = effectiveConfig({});
  for (const [hero, id] of [['zhuge-liang', 'architect'], ['lv-bu', 'backend'], ['diao-chan', 'frontend'], ['zhao-yun', 'researcher'], ['chen-lin', 'writer'], ['zhou-yu', 'qa'], ['diao-chan-r3', 'frontend']]) {
    assert.equal(resolveRole({ role: 'teammate', name: hero }, e).id, id, hero);
  }
  assert.throws(() => resolveRole({ role: 'teammate', name: 'guan-yu' }, e), /未在当前项目/);
});

test('applying the three-kingdoms theme yields the hero roster and default restores the neutral one', async () => {
  const root = await temp();
  try {
    const project = join(root, 'p'); await mkdir(project);
    await saveProject(project, { roles: { lead: { description: '只做验收' }, extra: { displayName: '额外', capability: 'qa' } } }, 0, { root });
    let { effective } = await loadProject(project, seed, root);
    await saveProject(project, themePatch('three-kingdoms', effective), 1, { root });
    ({ effective } = await loadProject(project, seed, root));
    assert.deepEqual(names(effective), Object.fromEntries(Object.entries(THREE_KINGDOMS_ROLES).map(([id, r]) => [id, r.displayName])));
    assert.equal(effective.roles['zhou-yu'].capability, 'qa');
    await saveProject(project, themePatch('default', effective), 2, { root });
    ({ effective } = await loadProject(project, seed, root));
    assert.deepEqual(Object.keys(effective.roles).sort(), Object.keys(DEFAULT_ROLES).sort());
    assert.equal(effective.roles.lead.description, '只做验收'); // shared role keeps its per-role description
    assert.throws(() => themePatch('nope', effective), /未知的内置角色主题/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('capability_team_import { theme } applies the skin through the confirmed save flow', async () => {
  const root = await temp();
  try {
    const tools = {}; const membership = () => ({ role: 'lead', name: 'lead' }); const asked = [];
    const ctx = { agentPresets: { composedPreset: () => 'capability-team' }, effect: fn => fn(), skills: { register: () => () => {} },
      tools: { register: v => { tools[v.name] = v; return () => {}; } }, agentTeams: { membership, tryMembership: membership }, agents: { list: () => [] },
      workingDirectory: { ensure: async () => root }, llm: fakeLlm(CATALOG), on: () => {},
      userQuestions: { ask: async req => { asked.push(req); return { answers: [{ id: 'confirm', selected: ['保存'] }] }; } } };
    const team = createTeam(ctx, {}, { root }); apply(ctx, team);
    const exec = { agent: { ctx: { systemPrompt: { context: () => () => {} } } } };
    assert.deepEqual(tools.capability_team_import.parameters.properties.theme.enum, ['default', 'three-kingdoms']);
    await assert.rejects(tools.capability_team_import.execute({ expected_revision: 0 }, exec), /只能提供一个/);
    const saved = JSON.parse(await tools.capability_team_import.execute({ expected_revision: 0, theme: 'three-kingdoms' }, exec));
    assert.deepEqual(saved.roles.map(r => r.id).sort(), [...HEROES].sort());
    assert.match(asked[0].questions[0].detail, /诸葛亮/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
