import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import { openCodeCandidates, findOpenCode, catalogFile, freeModelsFromCatalog, resolveFreeModels } from '../opencode.js';

test('可执行文件：Windows 用原生 exe（含 npm 包内），macOS/Linux 用 PATH 中的 opencode；不返回 shell 包装', () => {
  const w = openCodeCandidates({ platform: 'win32', env: { PATH: 'D:\\npm;D:\\bin' }, home: 'D:\\home' });
  assert.ok(w.includes(win32.join('D:\\npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')));
  assert.ok(w.includes(win32.join('D:\\bin', 'opencode.exe')));
  assert.ok(w.every(f => !/\.(cmd|ps1|bat)$/i.test(f)));
  for (const platform of ['darwin', 'linux']) {
    const u = openCodeCandidates({ platform, env: { PATH: '/opt/homebrew/bin:/usr/local/bin' }, home: '/home/u' });
    assert.deepEqual(u, ['/opt/homebrew/bin/opencode', '/usr/local/bin/opencode', posix.join('/home/u', '.opencode', 'bin', 'opencode')]);
  }
});

test('环境变量优先；找不到时给出可执行的提示', async () => {
  assert.equal(await findOpenCode({ env: { CAPABILITY_TEAM_OPENCODE_EXECUTABLE: '/x/opencode', PATH: '' } }), '/x/opencode');
  assert.equal(await findOpenCode({ platform: 'linux', env: { PATH: '/a:/b' }, home: '/h', exists: async f => f === '/b/opencode' }), '/b/opencode');
  await assert.rejects(findOpenCode({ platform: 'linux', env: { PATH: '/a' }, home: '/h', exists: async () => false }), /PATH.*CAPABILITY_TEAM_OPENCODE_EXECUTABLE/);
});

test('模型目录按 XDG 缓存目录定位，跨平台一致，可用环境变量覆盖', () => {
  assert.equal(catalogFile({ platform: 'linux', env: {}, home: '/home/u' }), '/home/u/.cache/opencode/models.json');
  assert.equal(catalogFile({ platform: 'darwin', env: { XDG_CACHE_HOME: '/c' }, home: '/Users/u' }), '/c/opencode/models.json');
  assert.equal(catalogFile({ platform: 'win32', env: {}, home: 'D:\\home' }), win32.join('D:\\home', '.cache', 'opencode', 'models.json'));
  assert.equal(catalogFile({ env: { CAPABILITY_TEAM_OPENCODE_MODELS: '/m.json' } }), '/m.json');
});

const catalog = { opencode: { models: {
  'a-free': { cost: { input: 0, output: 0 }, release_date: '2026-09-01', tool_call: true },
  'b-free': { cost: { input: 0, output: 0 }, release_date: '2026-10-01', tool_call: true },
  pickle: { cost: { input: 0, output: 0 }, release_date: '2025-01-01', tool_call: true },
  'old-free': { cost: { input: 0, output: 0 }, status: 'deprecated' },
  paid: { cost: { input: 1, output: 5 } },
  'cache-paid': { cost: { input: 0, output: 0, cache_read: 0.1 } },
  'no-tools': { cost: { input: 0, output: 0 }, tool_call: false },
} }, other: { models: { 'x:free': { cost: { input: 0, output: 0 } } } } };

test('免费模型来自 OpenCode 目录：成本为 0、未弃用、支持工具，新的在前；不按名字猜', () => {
  assert.deepEqual(freeModelsFromCatalog(catalog), ['opencode/b-free', 'opencode/a-free', 'opencode/pickle']);
  assert.deepEqual(freeModelsFromCatalog({}), []);
});

test('项目指定的顺序只能从免费模型中选，付费或已弃用的被拒绝', async () => {
  const read = async () => JSON.stringify(catalog);
  assert.deepEqual(await resolveFreeModels([], { file: 'f', read }), ['opencode/b-free', 'opencode/a-free', 'opencode/pickle']);
  assert.deepEqual(await resolveFreeModels(['opencode/pickle'], { file: 'f', read }), ['opencode/pickle']);
  await assert.rejects(resolveFreeModels(['opencode/paid'], { file: 'f', read }), /不是 OpenCode 目录中的免费模型/);
  await assert.rejects(resolveFreeModels(['opencode/old-free'], { file: 'f', read }), /不是/);
  await assert.rejects(resolveFreeModels([], { file: 'f', read: async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } }), /opencode models/);
  await assert.rejects(resolveFreeModels([], { file: 'f', read: async () => '{}' }), /没有可用的免费模型/);
});
