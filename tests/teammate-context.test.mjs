import test from 'node:test';
import assert from 'node:assert/strict';
import { applySkillCatalog, rewriteCatalog, scopeTools, shortDescription, validateSkillsPolicy } from '../teammate-context.js';
import { effectiveConfig } from '../config.js';

test('主控专用工具只装给主控，队友专用工具只装给队友，其他工具照常全局注册', () => {
  const global = [], handlers = {};
  const host = { agentPresets: { composedPreset: () => 'capability-team' }, tools: { register: d => { global.push(d.name); return () => {}; }, guard: () => {} }, on: (n, fn) => { handlers[n] = fn; } };
  const { ctx } = scopeTools(host);
  for (const name of ['capability_dispatch_plan', 'capability_team_save', 'capability_handoff', 'capability_team_read', 'cpa_search']) ctx.tools.register({ name });
  assert.deepEqual(global, ['capability_team_read', 'cpa_search']);
  const install = parentSession => { const got = []; handlers['agent/created']({ agent: { ctx: { tools: { register: d => got.push(d.name) } }, session: { header: parentSession ? { parentSession } : {} } } }); return got; };
  assert.deepEqual(install(undefined), ['capability_dispatch_plan', 'capability_team_save']);
  assert.deepEqual(install('lead'), ['capability_handoff']);
  assert.equal(typeof ctx.tools.guard, 'function', '其他方法照常可用');
});

test('插件晚于会话加载：已存在的主控补装主控工具，队友只补队友工具，重复触发不重复注册', async () => {
  const handlers = {};
  const mk = parentSession => { const got = []; return { got, ctx: { tools: { register: d => { got.push(d.name); return () => {}; } } }, session: { header: parentSession ? { parentSession } : {} } }; };
  const lead = mk(undefined), mate = mk('lead'), late = mk(undefined);
  const host = { agentPresets: { composedPreset: () => 'capability-team' }, tools: { register: () => () => {} }, agents: { list: () => [lead, mate] }, on: (n, fn) => { handlers[n] = fn; } };
  const { ctx } = scopeTools(host);
  for (const name of ['capability_dispatch_plan', 'capability_free_task', 'capability_handoff']) ctx.tools.register({ name });
  await new Promise(resolve => setTimeout(resolve, 0)); // existing agents are backfilled after registration
  assert.deepEqual(lead.got, ['capability_dispatch_plan', 'capability_free_task']);
  assert.deepEqual(mate.got, ['capability_handoff'], '队友拿不到主控工具');
  let continued = 0;
  for (const agent of [lead, mate, late, late]) await handlers['agent/pre-step']({ agent }, async () => { continued++; return { kind: 'continue' }; });
  handlers['agent/created']({ agent: lead });
  assert.equal(continued, 4, 'pre-step 照常放行');
  assert.deepEqual(lead.got, ['capability_dispatch_plan', 'capability_free_task'], '重复触发不重复注册');
  assert.deepEqual(mate.got, ['capability_handoff']);
  assert.deepEqual(late.got, ['capability_dispatch_plan', 'capability_free_task'], '首次 pre-step 补装');
});

test('宿主未提供 agents 服务时补装静默跳过', async () => {
  const handlers = {};
  scopeTools({ tools: { register: () => () => {} }, on: (n, fn) => { handlers[n] = fn; } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(typeof handlers['agent/pre-step'], 'function');
});

const catalog = { role: 'user', source: { kind: 'skill-catalog', form: 'catalog', entries: [
  { name: 'playwright-cli', description: '浏览器自动化与测试。默认优先使用，支持截图、点击、表单等很多很多功能，描述非常长' + '很长'.repeat(200) },
  { name: 'pdf', description: 'Read and write PDF files.' }, { name: 'figma-use', description: 'Figma 操作' } ] }, content: [{ type: 'text', text: 'x'.repeat(5000) }] };

test('技能目录：精简为名字加一句话，可按名单保留，none 时去掉', () => {
  assert.equal(shortDescription('第一句。第二句。'), '第一句。');
  assert.ok(shortDescription('a'.repeat(200)).length <= 72);
  const compact = rewriteCatalog(catalog, 'compact');
  assert.ok(compact.content[0].text.length < 800);
  assert.match(compact.content[0].text, /`playwright-cli`: 浏览器自动化与测试。/);
  assert.deepEqual(compact.source.entries, catalog.source.entries, '条目原样保留给 DSH 做摘要比对');
  const only = rewriteCatalog(catalog, ['playwright*', 'pdf']);
  assert.ok(only.content[0].text.includes('pdf') && !only.content[0].text.includes('figma'));
  assert.equal(rewriteCatalog(catalog, 'none'), undefined);
  assert.equal(rewriteCatalog(catalog, ['nothing']), undefined);
  assert.equal(rewriteCatalog(catalog, 'full'), catalog);
});

test('技能目录处理挂在最外层（prepend），只改队友，不改主控', async () => {
  let registered;
  applySkillCatalog({ agentPresets: { composedPreset: () => 'capability-team' }, on: (name, fn, opts) => { registered = { name, fn, opts }; } }, () => 'compact');
  assert.equal(registered.name, 'agent/pre-step');
  assert.deepEqual(registered.opts, { prepend: true });
  const decision = { kind: 'continue', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }, catalog] };
  const mate = await registered.fn({ agent: { session: { header: { parentSession: 'L' } } } }, async () => decision);
  assert.ok(mate.messages[1].content[0].text.length < 800);
  const lead = await registered.fn({ agent: { session: { header: {} } } }, async () => decision);
  assert.equal(lead, decision, '主控看到完整目录');
});

test('能力的 skills 配置校验', () => {
  assert.equal(validateSkillsPolicy('none', 'x'), 'none');
  assert.deepEqual(validateSkillsPolicy(['a*', 'b', 'a*'], 'x'), ['a*', 'b']);
  assert.throws(() => validateSkillsPolicy('some', 'x'), /compact/);
  const cfg = effectiveConfig({ capabilities: { qa: { skills: ['playwright*'] } } });
  assert.deepEqual(cfg.capabilities.qa.skills, ['playwright*']);
});
