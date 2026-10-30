import test from 'node:test';
import assert from 'node:assert/strict';
import { globRegex, checkAccess, applyAccess, accessSummary, presetActive, ensurePreset } from '../access.js';
import { effectiveConfig } from '../config.js';
const where = { project: '/repo', cwd: '/repo', label: '角色 W' };
const docsOnly = { deny: [], editPaths: ['**/*.md', 'docs/**'], shell: false };
test('glob：** 跨目录，* 与 ? 不跨目录', () => {
  assert.ok(globRegex('**/*.md').test('README.md'));
  assert.ok(globRegex('**/*.md').test('a/b/c.md'));
  assert.ok(globRegex('docs/**').test('docs/x/y.ts'));
  assert.ok(!globRegex('src/*.ts').test('src/a/b.ts'));
  assert.ok(globRegex('src/?.ts').test('src/a.ts'));
  assert.ok(!globRegex('*.md').test('a.mdx'));
});
test('只允许范围内的修改；查看、读取不受限', () => {
  assert.equal(checkAccess({ name: 'write', arguments: { file_path: 'docs/guide.ts' } }, docsOnly, where), undefined);
  assert.equal(checkAccess({ name: 'edit', arguments: { file_path: '/repo/sub/README.md' } }, docsOnly, where), undefined);
  assert.match(checkAccess({ name: 'edit', arguments: { file_path: 'src/app.js' } }, docsOnly, where), /src\/app\.js 不在允许范围内/);
  assert.equal(checkAccess({ name: 'str_replace_editor', arguments: { command: 'view', path: 'src/app.js' } }, docsOnly, where), undefined);
  assert.match(checkAccess({ name: 'str_replace_editor', arguments: { command: 'create', path: 'src/app.js' } }, docsOnly, where), /不在允许范围内/);
  assert.equal(checkAccess({ name: 'read', arguments: { file_path: 'src/app.js' } }, docsOnly, where), undefined);
});
test('项目外、上级目录、~ 与缺少路径一律拒绝；相对路径按当前工作目录解析', () => {
  assert.match(checkAccess({ name: 'write', arguments: { file_path: '../other/a.md' } }, docsOnly, where), /不在项目内/);
  assert.match(checkAccess({ name: 'write', arguments: { file_path: '/etc/a.md' } }, docsOnly, where), /不在项目内/);
  assert.match(checkAccess({ name: 'write', arguments: { file_path: '~/a.md' } }, docsOnly, where), /无法确认/);
  assert.match(checkAccess({ name: 'write', arguments: {} }, docsOnly, where), /无法确认/);
  assert.equal(checkAccess({ name: 'write', arguments: { file_path: 'x.ts' } }, docsOnly, { ...where, cwd: '/repo/docs' }), undefined);
});
test('shell 与禁用工具（含前缀规则）；空 editPaths 不能改任何文件', () => {
  assert.match(checkAccess({ name: 'bash', arguments: {} }, docsOnly, where), /不允许执行命令/);
  assert.match(checkAccess({ name: 'terminal_send', arguments: {} }, docsOnly, where), /不允许执行命令/);
  const noFiles = { deny: ['web_*', 'present'], editPaths: [], shell: true };
  assert.equal(checkAccess({ name: 'bash', arguments: {} }, noFiles, where), undefined);
  assert.match(checkAccess({ name: 'web_fetch', arguments: {} }, noFiles, where), /不允许使用工具 web_fetch/);
  assert.match(checkAccess({ name: 'write', arguments: { file_path: 'a.md' } }, noFiles, where), /不允许修改任何文件/);
  assert.equal(checkAccess({ name: 'write', arguments: { file_path: 'a.md' } }, undefined, where), undefined);
  assert.equal(accessSummary(noFiles), '不能修改文件；禁用工具 web_*、present');
});
test('配置校验：默认值、null 取消限制、拒绝越界路径和未知字段', () => {
  const base = effectiveConfig({});
  assert.deepEqual(base.capabilities.research.access, { deny: [], editPaths: [], shell: false, preset: 'read-only' });
  assert.equal(base.capabilities.backend.access, undefined);
  assert.equal(effectiveConfig({ capabilities: { writer: { access: null } } }).capabilities.writer.access, undefined);
  assert.deepEqual(effectiveConfig({ capabilities: { qa: { access: { editPaths: ['./tests/**'] } } } }).capabilities.qa.access, { deny: [], editPaths: ['tests/**'], shell: true });
  assert.throws(() => effectiveConfig({ capabilities: { qa: { access: { editPaths: ['../x/**'] } } } }), /不能含 \.\./);
  assert.throws(() => effectiveConfig({ capabilities: { qa: { access: { editPaths: ['/abs/**'] } } } }), /项目内的相对路径/);
  assert.throws(() => effectiveConfig({ capabilities: { qa: { access: { write: true } } } }), /未知字段/);
  assert.throws(() => effectiveConfig({ capabilities: { qa: { access: { deny: ['a b'] } } } }), /工具名或以 \* 结尾/);
});
test('守卫按队友角色生效，非团队会话与未登记队友不拦截', () => {
  let guard;
  const effective = effectiveConfig({});
  const members = new Map([['w', { role: 'teammate', name: 'chen-lin' }], ['b', { role: 'teammate', name: 'lv-bu' }], ['x', { role: 'teammate', name: 'ghost' }]]);
  const ctx = { effect: fn => fn(), tools: { guard: fn => { guard = fn; } },
    agentTeams: { tryMembership: agent => members.get(agent.id) }, workingDirectory: { get: () => '/repo' } };
  applyAccess(ctx, { pinned: () => '/repo', loadSync: () => ({ effective }) });
  const call = (id, name, args) => guard({ agent: { id, session: {} }, name, arguments: args });
  assert.match(call('w', 'bash', {}), /陈琳（writer）不允许执行命令/);
  assert.equal(call('w', 'write', { file_path: 'docs/a.md' }), undefined);
  assert.equal(call('b', 'bash', {}), undefined);
  assert.equal(call('x', 'bash', {}), undefined);
  assert.equal(call('solo', 'bash', {}), undefined);
});
test('whenToUse：默认写入名册与角色视图，可清除，校验长度与控制字符', async () => {
  const { roleView } = await import('../config.js');
  const base = effectiveConfig({});
  assert.match(base.capabilities.writer.whenToUse, /只改文档/);
  assert.equal(base.capabilities.orchestrator.whenToUse, undefined);
  assert.match(roleView(base).find(r => r.id === 'chen-lin').whenToUse, /README/);
  assert.equal(effectiveConfig({ capabilities: { writer: { whenToUse: null } } }).capabilities.writer.whenToUse, undefined);
  assert.throws(() => effectiveConfig({ capabilities: { qa: { whenToUse: 'x'.repeat(501) } } }), /适用场景/);
  assert.throws(() => effectiveConfig({ capabilities: { qa: { whenToUse: 'a\nb' } } }), /适用场景/);
});

test('官方权限预设：生效后放行命令（由沙箱约束），未生效或不存在时仍拦截；请求前自动切换', () => {
  const research = effectiveConfig({}).capabilities.research.access;
  const where2 = { project: '/repo', cwd: '/repo', label: '角色 R' };
  assert.match(checkAccess({ name: 'bash', arguments: {} }, research, where2), /权限预设 read-only 尚未生效/);
  assert.equal(checkAccess({ name: 'bash', arguments: {} }, research, { ...where2, sandboxed: true }), undefined);
  assert.match(checkAccess({ name: 'write', arguments: { file_path: 'a.md' } }, research, { ...where2, sandboxed: true }), /不允许修改任何文件/); // file tools stay guarded
  const current = new Map(); const logs = [];
  const presets = { current: s => current.get(s) ?? 'danger-full-access', set: (s, name) => { if (name === 'missing') throw new Error('unknown preset'); current.set(s, name); } };
  const session = {};
  assert.equal(presetActive(presets, session, research), false);
  ensurePreset(presets, session, research);
  assert.equal(presetActive(presets, session, research), true);
  ensurePreset(presets, {}, { ...research, preset: 'missing' }, m => logs.push(m));
  assert.match(logs[0], /无法应用权限预设 missing/);
  assert.equal(presetActive(undefined, session, research), false);
  assert.equal(presetActive({ current: () => { throw new Error('x'); } }, session, research), false);
  assert.match(accessSummary(research), /运行在 DSH 权限预设 read-only 中，命令只在该沙箱内执行/);
  assert.throws(() => effectiveConfig({ capabilities: { qa: { access: { preset: 'custom' } } } }), /不能是 custom 或 auto/);
  assert.throws(() => effectiveConfig({ capabilities: { qa: { access: { preset: 'a b' } } } }), /DSH 权限预设名/);
});
test('守卫读取官方预设是否生效来决定是否放行命令', () => {
  let guard;
  const effective = effectiveConfig({});
  let active = false;
  const ctx = { effect: fn => fn(), tools: { guard: fn => { guard = fn; } }, get: key => key === 'permissionPresets' ? { current: () => active ? 'read-only' : 'danger-full-access' } : undefined,
    agentTeams: { tryMembership: () => ({ role: 'teammate', name: 'zhao-yun' }) }, workingDirectory: { get: () => '/repo' } };
  applyAccess(ctx, { pinned: () => '/repo', loadSync: () => ({ effective }) });
  const call = () => guard({ agent: { id: 'r', session: {} }, name: 'bash', arguments: {} });
  assert.match(call(), /尚未生效/);
  active = true;
  assert.equal(call(), undefined);
});
