import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../theme-plugin.js';
import { createTeam } from '../team.js';
import { loadProject } from '../theme.js';
import { seed } from '../config.js';
import { CATALOG, fakeLlm } from './fixture.mjs';
function harness(root, { role = 'lead', answer = '保存', extra = [] } = {}) {
  const tools = {}; const contexts = []; const listeners = {}; const asked = []; let skill;
  const membership = agent => agent.member ?? { role, name: role };
  const ctx = {
    effect: fn => fn(),
    skills: { register: v => { skill = v; return () => {}; } },
    tools: { register: v => { tools[v.name] = v; return () => {}; } },
    agentTeams: { membership, tryMembership: membership },
    agents: { list: () => [] },
    workingDirectory: { ensure: async () => root },
    llm: fakeLlm({ ...CATALOG, openai: [...CATALOG.openai, ...extra] }),
    userQuestions: { ask: async req => { asked.push(req); return { answers: [{ id: 'confirm', selected: [answer] }] }; } },
    on: (event, fn) => { listeners[event] = fn; },
  };
  const team = createTeam(ctx, {}, { root });
  apply(ctx, team);
  const agent = (member) => ({ member, ctx: { systemPrompt: { context: v => { contexts.push(v); return () => { v.disposed = true; }; } } } });
  return { tools, contexts, listeners, asked, team, agent, get skill() { return skill; } };
}
const temp = () => mkdtemp(join(tmpdir(), 'team-plugin-'));
test('技能与工具注册；子角色不能保存', async () => {
  const root = await temp();
  try {
    const h = harness(root, { role: 'teammate' });
    assert.equal(h.skill.name, 'project-role-theme');
    assert.deepEqual(Object.keys(h.tools), ['capability_team_read', 'capability_model_catalog', 'capability_team_save']);
    await assert.rejects(h.tools.capability_team_save.execute({ expected_revision: 0 }, { agent: h.agent() }), /仅主控/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('保存前弹出真人确认框，取消则不写入', async () => {
  const root = await temp();
  try {
    const no = harness(root, { answer: '取消' });
    await assert.rejects(no.tools.capability_team_save.execute({ expected_revision: 0, roles: { 'lv-bu': { displayName: '后端' } } }, { agent: no.agent() }), /未确认/);
    assert.match(no.asked[0].questions[0].detail, /后端/);
    assert.equal((await loadProject(root, seed, root)).revision, 0);
    const yes = harness(root);
    const saved = JSON.parse(await yes.tools.capability_team_save.execute({ expected_revision: 0, roles: { 'lv-bu': { displayName: '后端' } } }, { agent: yes.agent() }));
    assert.equal(saved.revision, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('新模型必须在DSH目录中，档位可同步扩充', async () => {
  const root = await temp();
  try {
    const h = harness(root, { extra: ['fresh-model'] });
    const { tiers } = JSON.parse(await h.tools.capability_team_read.execute({}, { agent: h.agent() })).effective;
    const save = (args) => h.tools.capability_team_save.execute({ expected_revision: 0, ...args }, { agent: h.agent() });
    await assert.rejects(save({ tiers: { upper: [...tiers.upper, 'ghost'] }, capabilities: { qa: { provider: 'openai', model: 'ghost', fallbacks: [] } } }), /不在当前DSH模型目录/);
    assert.equal(h.asked.length, 0); // catalog failure never asks the user
    await save({ tiers: { upper: [...tiers.upper, 'fresh-model'] }, capabilities: { qa: { provider: 'openai', model: 'fresh-model', fallbacks: [] } } });
    assert.equal((await loadProject(root, h.team.base, root)).effective.capabilities.qa.model, 'fresh-model');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('每个团队成员获得自己的动态上下文，随保存即时更新', async () => {
  const root = await temp();
  try {
    const h = harness(root);
    const member = h.agent({ role: 'teammate', name: 'zhou-yu' });
    await h.listeners['agent/created']({ agent: member });
    assert.equal(h.contexts.length, 1);
    assert.match(h.contexts[0].text(), /周瑜/);
    await h.tools.capability_team_save.execute({ expected_revision: 0, roles: { 'zhou-yu': { displayName: '质量负责人', description: '负责回归' } } }, { agent: h.agent() });
    const text = h.contexts[0].text();
    assert.match(text, /质量负责人/); assert.match(text, /负责回归/); assert.doesNotMatch(text, /周瑜/);
    const outsider = h.agent({ role: 'teammate', name: 'nobody' });
    await h.listeners['agent/created']({ agent: outsider });
    assert.match(h.contexts[1].text(), /未在当前项目的团队配置中登记/);
    h.listeners['agent/disposed']({ agent: member });
    assert.equal(h.contexts[0].disposed, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
