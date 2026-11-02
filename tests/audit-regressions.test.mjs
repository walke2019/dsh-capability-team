// Regressions from the project audit: catalog drift, ungraded route adoption, Windows activity paths,
// what leaves the machine (memory queries, project paths, subprocess environment) and unknown usage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoMatch } from '../defaults.js';
import { seed, withAutoRoutes, effectiveConfig } from '../config.js';
import { loadProject, loadProjectSync, saveProject } from '../theme.js';
import { safeTarget, summarizeActivity } from '../activity-summary.js';
import { artifactsDefinition } from '../observability-projection.js';
import { createMemoryHub } from '../memory-hub.js';
import { createOpenViking } from '../memory-openviking.js';
import { REDACTED, redactSecrets } from '../memory-redact.js';
import { runFreeWorker, workerEnv } from '../free-worker.mjs';
import { createHarness } from './helpers/client-harness.mjs';

const catalog = (...models) => models.map(model => ({ provider: 'p', model }));
const baseFor = (...models) => withAutoRoutes(seed, autoMatch(catalog(...models), seed.capabilities));
const withTemp = async fn => {
  const dir = await mkdtemp(join(tmpdir(), 'ctm-audit-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};

test('显式路由：拒绝非聊天与免费变体，放行未识别厂商与旧版本；写进 tiers 仍可启用', () => {
  const base = baseFor('gpt-6.1-sol', 'claude-sonnet-5');
  const route = model => ({ capabilities: { backend: { provider: 'p', model, fallbacks: [] } } });
  assert.throws(() => effectiveConfig(route('whisper-1'), base), /非聊天/);
  assert.throws(() => effectiveConfig(route('text-embedding-3-large'), base), /非聊天/);
  assert.throws(() => effectiveConfig(route('claude-sonnet-5:free'), base), /免费或试用/);
  assert.throws(() => effectiveConfig({ capabilities: { backend: { fallbacks: [{ provider: 'p', model: 'whisper-1' }] } } }, base), /非聊天/);
  for (const model of ['house-model-x', 'gpt-4.1']) {
    assert.ok(effectiveConfig(route(model), base).tiers.upper.includes(model), `${model} 由用户选择时可用`);
  }
  const listed = effectiveConfig({ tiers: { upper: [...base.tiers.upper, 'whisper-1'] }, ...route('whisper-1') }, base);
  assert.equal(listed.capabilities.backend.model, 'whisper-1', '项目明确写进档位是显式决定');
});

test('目录变化后：已保存的路由仍可加载并被报告，主控不会被锁死', () => withTemp(async dir => {
  const project = join(dir, 'project'); const root = join(dir, 'home');
  const before = baseFor('gpt-6.1-sol', 'claude-sonnet-5');
  const saved = { capabilities: { backend: { provider: 'p', model: 'gpt-6.1-sol', fallbacks: [{ provider: 'p', model: 'claude-sonnet-5' }] } } };
  const first = await saveProject(project, saved, 0, { base: before, root });
  assert.equal(first.effective.tierDrift, undefined);

  // A newer major in the catalog regrades the saved model one tier lower.
  const after = baseFor('gpt-6.1-sol', 'claude-sonnet-5', 'gpt-7-sol', 'gemini-3-flash');
  assert.ok(after.tiers.medium.includes('gpt-6.1-sol') && !after.tiers.upper.includes('gpt-6.1-sol'), '前提：模型确实被降档');
  assert.throws(() => effectiveConfig(saved, after), /已归入 medium 档/, '不带信任来源时仍是严格校验');

  for (const { effective } of [await loadProject(project, after, root), loadProjectSync(project, after, root)]) {
    assert.equal(effective.capabilities.backend.model, 'gpt-6.1-sol', '用户确认过的路由不被静默替换');
    assert.deepEqual(effective.tierDrift, [{ capability: 'backend', model: 'gpt-6.1-sol', tier: 'upper', gradedAs: 'medium' }]);
    assert.ok(effective.capabilities.qa.provider, '其他能力不受影响');
  }

  // Other edits still save, and a route that is new or changed is still checked strictly.
  const renamed = await saveProject(project, { roles: { 'lv-bu': { displayName: '后端' } } }, 1, { base: after, root });
  assert.equal(renamed.revision, 2);
  await assert.rejects(saveProject(project, { capabilities: { frontend: { provider: 'p', model: 'gpt-6.1-sol', tier: 'upper', fallbacks: [] } } }, 2, { base: after, root }), /已归入 medium 档/);
  await assert.rejects(saveProject(project, { capabilities: { backend: { provider: 'p', model: 'gemini-3-flash', fallbacks: [] } } }, 2, { base: after, root }), /已归入 \w+ 档/);
}));

test('升档后补了低档模型：确认卡存下的路由同样不会让配置失效', () => withTemp(async dir => {
  const project = join(dir, 'project'); const root = join(dir, 'home');
  const onlyUpper = baseFor('claude-sonnet-5', 'gpt-6.1-sol');
  assert.equal(onlyUpper.capabilities.frontend.tier, 'upper', '前提：frontend 被升档');
  await saveProject(project, { capabilities: { frontend: { provider: 'p', model: 'claude-sonnet-5', fallbacks: [] } } }, 0, { base: onlyUpper, root });
  const { effective } = await loadProject(project, baseFor('claude-sonnet-5', 'gpt-6.1-sol', 'gemini-3-flash'), root);
  assert.equal(effective.capabilities.frontend.model, 'claude-sonnet-5');
  assert.equal(effective.tierDrift?.[0]?.capability, 'frontend');
}));

test('只改主模型：继承的自动备选若等于新主模型或跨档，被剔除而不是报错', () => {
  const base = baseFor('gpt-6.1-sol', 'claude-sonnet-5', 'gemini-4-argon');
  const [fallback] = base.capabilities.backend.fallbacks;
  assert.ok(fallback, '前提：存在自动备选');
  const { capabilities } = effectiveConfig({ capabilities: { backend: { provider: fallback.provider, model: fallback.model } } }, base);
  assert.equal(capabilities.backend.model, fallback.model);
  assert.ok(!capabilities.backend.fallbacks.some(f => f.model === fallback.model));
});

test('Windows 工作目录：活动目标与成果路径可解析，越界与敏感路径规则不变', () => {
  const win = 'C:\\work\\x';
  for (const cwd of [win, 'C:/work/x', 'c:\\work\\X']) {
    assert.equal(safeTarget('src/a.js', cwd, 240, win), 'src/a.js', cwd);
    assert.equal(safeTarget('src\\a.js', cwd, 240, win), 'src/a.js', cwd);
  }
  assert.equal(safeTarget('C:\\work\\x\\src\\a.js', win), 'src/a.js');
  assert.equal(safeTarget('c:/work/x/src/a.js', win), 'src/a.js', '盘符与路径大小写不敏感');
  assert.equal(safeTarget('src/a.js', '\\\\host\\share\\x'), 'src/a.js');
  for (const p of ['..\\escape', '../escape', 'D:\\other\\a.js', 'C:\\work\\other\\a.js', '\\\\host\\share\\a.js', 'https://evil/a', 'a?secret=x']) assert.equal(safeTarget(p, win), null, p);
  for (const p of ['.env', 'config\\.env.local', '.SSH\\id_rsa', 'secrets.json', 'cert.pem']) assert.equal(safeTarget(p, win), '[敏感路径]', p);
  assert.equal(safeTarget('a.js', win, 240, '/project'), null, '工作目录与根目录风格必须一致');
  assert.equal(safeTarget('src\\..\\..\\etc', '/project'), null, 'POSIX 下反斜杠仍被拒绝');
  assert.equal(safeTarget('src/a.js', '/project'), 'src/a.js');
  assert.equal(summarizeActivity('edit', JSON.stringify({ file_path: 'C:\\work\\x\\client\\a.js' }), win).target, 'client/a.js');

  let state = artifactsDefinition.init({ id: 's', cwd: win }, 0);
  state = artifactsDefinition.apply(state, { seq: 1, time: 5, type: 'deliverables/presented', data: { turn: 1, files: [{ path: 'C:\\work\\x\\docs\\a.md' }] } });
  assert.deepEqual(state.view.items.map(i => i.displayPath), ['docs/a.md']);
});

test('记忆检索：发往嵌入服务和共享后端的查询先脱敏', async () => {
  const seen = { embed: [], recall: [], local: [] };
  const key = 'configured-secret-value';
  const hub = createMemoryHub({}, { root: '.' }, {
    secrets: () => [key],
    store: { search: async ({ query }) => { seen.local.push(query); return []; }, unembedded: async () => [] },
    embedder: { available: false, embed: async ([text]) => { seen.embed.push(text); return null; } },
    backend: { enabled: true, recall: async query => { seen.recall.push(query); return []; } },
  });
  const who = { project: 'p', role: 'backend', session: 's', lead: false };
  await hub.search(who, { query: `部署时报错 OPENVIKING_API_KEY=abcdefghijklmnop 和 ${key} 以及 tvly-abcdefghijklmnop123` });
  for (const [where, [text]] of Object.entries(seen)) {
    assert.ok(!/abcdefghijklmnop|configured-secret/.test(text), `${where}: ${text}`);
    assert.match(text, /部署时报错/, '有用的内容保留');
  }
  const long = await hub.search(who, { query: 'x'.repeat(5000) });
  assert.equal(long.mode, 'text');
  assert.equal(seen.embed.at(-1).length, 2000, '查询长度上限不变');
});

test('脱敏规则覆盖本插件集成服务的密钥格式与带前缀的变量名', () => {
  for (const secret of ['tvly-abcdefghijklmnop123', 'jina_abcdefghijklmnop123', 'glpat-abcdefghijklmnop', 'hf_abcdefghijklmnop123', 'npm_abcdefghijklmnop123', 'xai-abcdefghijklmnop123', 'BSAabcdefghijklmnop12345']) {
    assert.equal(redactSecrets(`值 ${secret} 结束`), `值 ${REDACTED} 结束`, secret);
  }
  for (const [text, name] of [['key=abcdefghijklmnop', 'key='], ['OPENVIKING_API_KEY=abcdefghijklmnop', 'OPENVIKING_API_KEY='], ['GH_TOKEN: abcdefghijklmnop', 'GH_TOKEN: '], ['"db_password": "abcdefghijklmnop"', '"db_password": "']]) {
    const out = redactSecrets(text);
    assert.ok(out.startsWith(name) && out.includes(REDACTED) && !out.includes('abcdefghijklmnop'), out);
  }
  assert.equal(redactSecrets('普通的踩坑：Windows 路径用 path.join'), '普通的踩坑：Windows 路径用 path.join');
  assert.equal(redactSecrets('key: short'), 'key: short', '短值不是密钥');
});

test('OpenViking：上送内容只带项目目录名，不带本机绝对路径', async () => {
  const bodies = [];
  const fetcher = async (_url, init) => { if (init.body) bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, text: async () => '{"status":"ok","result":{}}' }; };
  const ov = createOpenViking({ settings: { config: { backend: 'openviking', url: 'https://viking.example.com', timeoutMs: 1000 }, key: 'k' }, fetcher, now: () => 1, schedule: () => null });
  for (const project of ['C:\\Users\\someone\\work\\demo', '/home/someone/work/demo/', 'demo']) ov.enqueue({ kind: 'note', scope: { kind: 'project' }, text: '内容' }, { project });
  ov.enqueue({ kind: 'note', scope: { kind: 'project' }, text: '无项目' }, {});
  await ov.flush();
  const sent = bodies.map(b => b.content).filter(Boolean);
  assert.deepEqual(sent, ['【记忆 · 项目 demo】内容', '【记忆 · 项目 demo】内容', '【记忆 · 项目 demo】内容', '【记忆】无项目']);
});

test('免费模型子进程：只继承运行所需环境变量，密钥不外泄', async () => {
  const env = workerEnv({ Path: 'x', USERPROFILE: 'u', SystemRoot: 'r', HTTPS_PROXY: 'h', TEMP: 't', LC_ALL: 'c', OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_API_KEY: 's', TAVILY_API_KEY: 's', ANTHROPIC_API_KEY: 's', OPENAI_API_KEY: 's', GITHUB_TOKEN: 's', AWS_SECRET_ACCESS_KEY: 's', OMNI_SEARCH_BASE_URL: 's', EMBEDDING_KEY: 's' });
  assert.deepEqual(Object.keys(env).sort(), ['HTTPS_PROXY', 'LC_ALL', 'OPENCODE_DISABLE_AUTOUPDATE', 'Path', 'SystemRoot', 'TEMP', 'USERPROFILE'].sort());

  process.env.TAVILY_API_KEY = 'must-not-leak';
  try {
    let options;
    const launch = (_exe, _args, o) => {
      options = o;
      const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {};
      queueMicrotask(() => { c.stdout.emit('data', '{"type":"text","part":{"text":"好"}}\n'); c.emit('close', 0, null); });
      return c;
    };
    await runFreeWorker('总结', { executable: 'mock', resolveModels: async () => ['opencode/x-free'], launch });
    assert.equal(options.env.TAVILY_API_KEY, undefined);
    assert.ok(options.env.OPENCODE_CONFIG_CONTENT && options.env.OPENCODE_PERMISSION, '子进程自身配置仍然传入');
    const pathKey = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH');
    assert.equal(options.env[pathKey], process.env[pathKey], 'PATH 保留，否则子进程起不来');
  } finally { delete process.env.TAVILY_API_KEY; }
});

test('用量未知时显示未知，不显示 0 和进度条；已知用量不受影响', () => {
  const zero = { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
  const state = {
    byId: { m1: { running: false }, m2: { running: false } },
    projectionsBySession: {
      s_lead: { values: { agentTeam: { members: [{ id: 's_lead', name: 'lead', role: 'lead', phase: 'active' }, { id: 'm1', name: 'lv-bu', phase: 'active' }, { id: 'm2', name: 'zhou-yu', phase: 'active' }] } } },
      m1: { values: { capabilityTeamUsage: { totals: zero, routes: [], coverage: 'unknown', reportedSamples: 0 } } },
      m2: { values: { capabilityTeamUsage: { totals: { ...zero, outputTokens: 1500 }, routes: [], coverage: 'complete', reportedSamples: 1 } } },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);
  const panel = h.find(tree, n => n.props?.['data-panel'] === 'usage');
  const groups = h.find(panel, n => typeof n.type === 'function' && Array.isArray(n.props.rows));
  const view = groups.type({ ...groups.props, roles: [{ id: 'lv-bu', displayName: '吕布', maxTokens: 10000 }, { id: 'zhou-yu', displayName: '周瑜' }] });
  const details = h.findAll(view, n => n.type === 'details');
  assert.equal(details.length, 2);
  const [unknown, known] = details.map(d => JSON.stringify(d));
  assert.match(unknown, /usage\.unknown/);
  assert.ok(!unknown.includes('usage.billable') && !unknown.includes('ctm-us-meter'), '未知不能画成 0');
  assert.match(known, /usage\.billable/);
  assert.match(known, /ctm-us-meter/);
});

test('记忆库：写入落盘前被并发重载时，记录不会对后续检索隐身', () => withTemp(async dir => {
  const { createMemoryStore } = await import('../memory-store.js');
  const { createHash } = await import('node:crypto');
  const { appendFile, unlink, writeFile } = await import('node:fs/promises');
  const store = createMemoryStore(dir);
  const scope = { kind: 'role', project: 'P', role: 'backend' };
  const query = { project: 'P', role: 'backend', session: 's', query: '记录', k: 100 };
  await store.write({ scope, kind: 'note', text: '最早的一条记录内容' });
  const file = join(dir, 'memory', `${createHash('sha256').update('P').digest('hex').slice(0, 32)}.jsonl`);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  // Hold the file lock so the write stops between adding to the cached list and appending to the file.
  await writeFile(`${file}.lock`, JSON.stringify({ pid: process.pid, at: Date.now() }));
  const writing = store.write({ scope, kind: 'result', text: '正在写入的这条记录' });
  await wait(30);
  // Another process appends meanwhile, so the next read reloads this store's cache from the file.
  const foreign = { id: 'other-process', scope, kind: 'note', text: '其他进程写入的记录', tags: [], source: {}, key: null, vector: null, model: null, createdAt: Date.now(), updatedAt: Date.now(), hits: 0 };
  await appendFile(file, JSON.stringify(foreign) + '\n');
  const searching = store.search(query);
  await wait(30);
  await unlink(`${file}.lock`);
  await Promise.all([writing, searching]);

  const found = (await store.search(query)).map(r => r.memory.text).sort();
  assert.deepEqual(found, ['其他进程写入的记录', '最早的一条记录内容', '正在写入的这条记录'].sort());
  assert.equal((await createMemoryStore(dir).search(query)).length, 3, '落盘内容与内存一致');
}));
