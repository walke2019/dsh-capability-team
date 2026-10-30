import test from 'node:test';
import assert from 'node:assert/strict';
import { toTemplate, templatePatch } from '../template.js';
import { effectiveConfig, applyPatch } from '../config.js';
const tiers = { upper: ['m1', 'm2'], high: [], medium: [], low: [] };
test('导出只含可移植字段，不含渠道、模型、备选与长上下文路由', () => {
  const effective = effectiveConfig({ tiers, capabilities: { backend: { provider: 'p', model: 'm1', fallbacks: [{ provider: 'q', model: 'm2' }], longContext: { thresholdTokens: 9000, provider: 'q', model: 'm2' }, maxTokens: 5000, planFirst: true } } });
  const t = toTemplate(effective);
  assert.equal(t.format, 'capability-team-template');
  assert.deepEqual(Object.keys(t.capabilities.backend).sort(), ['job', 'maxTokens', 'planFirst', 'prefer', 'search', 'tier', 'whenToUse']);
  assert.ok(!JSON.stringify(t).includes('"m1"'));
  assert.equal(t.roles.lead.capability, 'orchestrator');
});
test('导入：策略按模板覆盖、保留已有路由、角色整体替换，结果再导出与模板一致', () => {
  const source = effectiveConfig({ name: '模板团队', capabilities: { qa: { maxTokens: 8000, whenToUse: '验收时', access: { editPaths: ['tests/**'], shell: true } }, writer: { access: null } },
    roles: { 'zhao-yun': null, 'chen-lin': { displayName: '文书' } } });
  const template = JSON.parse(JSON.stringify(toTemplate(source)));
  const projectOverrides = { revision: 3, tiers, capabilities: { backend: { provider: 'p', model: 'm1', planFirst: true } }, roles: { extra: { displayName: '额外', capability: 'qa' } } };
  const current = effectiveConfig(projectOverrides);
  const next = effectiveConfig(applyPatch(projectOverrides, templatePatch(template, current)));
  assert.equal(next.name, '模板团队');
  assert.equal(next.capabilities.backend.provider, 'p'); // route kept
  assert.equal(next.capabilities.backend.planFirst, undefined); // policy follows the template
  assert.equal(next.capabilities.qa.maxTokens, 8000);
  assert.equal(next.capabilities.writer.access, undefined);
  assert.deepEqual(Object.keys(next.roles).sort(), Object.keys(source.roles).sort());
  assert.equal(next.roles['chen-lin'].displayName, '文书');
  assert.deepEqual(toTemplate(next).capabilities, template.capabilities);
});
test('拒绝格式、版本、未知字段、缺少 lead 与带模型的模板', () => {
  const current = effectiveConfig({});
  const good = toTemplate(current);
  assert.throws(() => templatePatch({ ...good, format: 'x' }, current), /不是能力协作团队模板/);
  assert.throws(() => templatePatch({ ...good, version: 2 }, current), /版本 2 不受支持/);
  assert.throws(() => templatePatch({ ...good, tiers: {} }, current), /未知字段 tiers/);
  assert.throws(() => templatePatch({ ...good, roles: { x: { displayName: 'X', capability: 'qa' } } }, current), /须包含 lead/);
  assert.throws(() => templatePatch({ ...good, capabilities: { qa: { ...good.capabilities.qa, model: 'm' } } }, current), /不可导入的字段 model/);
});
