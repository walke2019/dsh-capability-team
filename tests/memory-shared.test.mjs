// Shared long-term memory (OpenViking backend), secret redaction and multi-process store safety.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REDACTED, redactSecrets } from '../memory-redact.js';
import { createOpenViking, OV_SESSION_PREFIX } from '../memory-openviking.js';
import { MEMORY_BACKENDS, validateIntegrations } from '../integrations-config.js';
import { createMemoryStore } from '../memory-store.js';
import { createMemoryHub } from '../memory-hub.js';
import { createMemoryBackend, MEMORY_BACKEND_REGISTRY } from '../memory-backends.js';

const tmp = () => mkdtemp(join(tmpdir(), 'memsh-'));
process.env.CAPABILITY_TEAM_HOME = await tmp(); // isolated from the user's real integrations
const P = '/proj';
const settings = (over = {}) => ({ config: { backend: 'openviking', url: 'https://ov.example.test', apiKeyEnv: 'K', account: null, user: null, timeoutMs: 1000, recallLimit: 4, ...over }, key: 'ov-test-key-0123456789' });
/** Fake OpenViking server: records calls, answers like /api/v1. */
function fakeServer({ fail = false, entries = [] } = {}) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    if (fail) throw new Error('connect ECONNREFUSED');
    const path = new URL(url).pathname;
    const result = path.endsWith('/search/search') ? { entries } : path.endsWith('/commit') ? { task_id: 't1' } : {};
    return new Response(JSON.stringify({ status: 'ok', result }), { status: 200 });
  };
  return { calls, fetcher };
}
const noTimer = () => null;

test('脱敏：常见密钥格式与已知凭据值都被隐去，正文保留', () => {
  const secret = 'my-cred-store-value-123456';
  const text = [
    '调用 sk-abc123def456ghi789jkl0 失败', 'Authorization: Bearer abcdefghijklmnop1234', 'ghp_' + 'a'.repeat(36),
    'https://user:pa55word@example.com/x', 'api_key=supersecretvalue1', `凭据是 ${secret}`, 'AKIA' + 'B'.repeat(16),
  ].join('\n');
  const out = redactSecrets(text, [secret, 'short']);
  for (const leak of ['sk-abc123', 'abcdefghijklmnop1234', 'ghp_', 'pa55word', 'supersecretvalue1', secret, 'AKIAB']) assert.ok(!out.includes(leak), leak);
  assert.match(out, /Bearer \[Credentials redacted\]/);
  assert.match(out, /https:\/\/\[Credentials redacted\]@example\.com/);
  assert.match(out, /api_key=\[Credentials redacted\]/);
  assert.ok(out.includes('调用') && out.includes('失败'), '正文保留');
  assert.equal(redactSecrets('普通的踩坑：Windows 路径用 path.join'), '普通的踩坑：Windows 路径用 path.join');
});

test('配置：memory 地址远程只收 https，本机可 http，不允许内嵌账号', () => {
  assert.doesNotThrow(() => validateIntegrations({ memory: { backend: 'openviking', url: 'https://aidb.example.com' } }));
  assert.doesNotThrow(() => validateIntegrations({ memory: { url: 'http://127.0.0.1:1933' } }));
  assert.throws(() => validateIntegrations({ memory: { url: 'http://aidb.example.com' } }));
  assert.throws(() => validateIntegrations({ memory: { url: 'https://u:p@aidb.example.com' } }));
  assert.throws(() => validateIntegrations({ memory: { backend: 'redis' } }));
  assert.throws(() => validateIntegrations({ memory: { account: 'bad account!' } }));
});

test('OpenViking：未启用时不排队也不请求', async () => {
  const srv = fakeServer();
  const ov = createOpenViking({ settings: settings({ backend: 'local' }), fetcher: srv.fetcher, schedule: noTimer });
  assert.equal(ov.enabled, false);
  assert.equal(ov.enqueue({ kind: 'note', scope: { kind: 'project' }, text: 'x' }), false);
  assert.deepEqual(await ov.recall('x'), []);
  assert.equal(srv.calls.length, 0);
});

test('OpenViking：批量提交为一个会话，带密钥头；失败保留队列下次重试', async () => {
  const down = fakeServer({ fail: true });
  let fetcher = down.fetcher;
  const ov = createOpenViking({ settings: settings({ account: 'team', user: 'me' }), label: '能力团队', fetcher: (...a) => fetcher(...a), now: () => 42, schedule: noTimer });
  ov.enqueue({ kind: 'pitfall', scope: { kind: 'role', role: 'backend' }, text: '别整文件覆盖' }, { project: 'demo' });
  ov.enqueue({ kind: 'decision', scope: { kind: 'project' }, text: '嵌入走网关' }, { project: 'demo' });
  await assert.rejects(ov.flush(), /ECONNREFUSED/);
  assert.equal(ov.pending(), 2, '失败后仍在队列');
  assert.match(ov.lastError, /ECONNREFUSED/);
  const up = fakeServer();
  fetcher = up.fetcher;
  assert.deepEqual(await ov.flush(), { sent: 2, session: `${OV_SESSION_PREFIX}-42` });
  assert.equal(ov.pending(), 0);
  assert.deepEqual(up.calls.map(c => `${c.method} ${new URL(c.url).pathname}`), [
    'POST /api/v1/sessions', `POST /api/v1/sessions/${OV_SESSION_PREFIX}-42/messages`, `POST /api/v1/sessions/${OV_SESSION_PREFIX}-42/messages`, `POST /api/v1/sessions/${OV_SESSION_PREFIX}-42/commit`]);
  assert.equal(up.calls[0].headers['X-API-Key'], 'ov-test-key-0123456789');
  assert.equal(up.calls[0].headers['X-OpenViking-Account'], 'team');
  assert.match(up.calls[1].body.content, /^【能力团队Pitfall · Project demo · Role backend】别整文件覆盖$/);
  assert.match(up.calls[2].body.content, /Decision/);
});

test('OpenViking：召回映射成记忆结果；服务器不可用时返回空并记录错误', async () => {
  const srv = fakeServer({ entries: [{ uri: 'viking://user/u/memories/a.md', category: 'preferences', score: 0.9, text: ' 路径用 path.join ' }, { uri: 'viking://x', text: '' }] });
  const ov = createOpenViking({ settings: settings(), fetcher: srv.fetcher, schedule: noTimer });
  const hits = await ov.recall('路径', 3);
  assert.equal(hits.length, 1, '空文本被过滤');
  assert.deepEqual(hits[0], { score: 0.9, via: ['openviking'], memory: { id: 'viking://user/u/memories/a.md', kind: 'note', scope: { kind: 'openviking', category: 'preferences' }, text: '路径用 path.join', uri: 'viking://user/u/memories/a.md' } });
  assert.deepEqual(srv.calls[0].body, { query: '路径', mode: 'context', limit: 3 });
  const bad = createOpenViking({ settings: settings(), fetcher: fakeServer({ fail: true }).fetcher, schedule: noTimer });
  assert.deepEqual(await bad.recall('路径'), []);
  assert.match(bad.lastError, /ECONNREFUSED/);
});

test('记忆枢纽：写入前脱敏，项目记忆同步到共享记忆，会话记忆不外发；检索合并共享结果', async () => {
  const store = createMemoryStore(await tmp());
  const queued = [];
  const backend = {
    name: 'openviking', enabled: true,
    enqueue: (memory, who) => queued.push({ memory, who }),
    recall: async () => [{ score: 0.8, via: ['openviking'], memory: { id: 'viking://m/1', kind: 'note', scope: { kind: 'openviking' }, text: '共享：Windows 上跳过 chmod 断言', uri: 'viking://m/1' } }],
    flush: async () => ({ sent: 0 }), lastError: null,
  };
  const ctx = { agentTeams: { tryMembership: () => null } };
  const team = { root: await tmp(), pinned: () => P };
  const embedder = { available: false, lastError: null, embed: async () => null };
  const hub = createMemoryHub(ctx, team, { store, embedder, backend, secrets: () => ['cred-value-abcdef123'] });
  const who = { project: P, role: 'backend', name: 'backend', lead: false };
  const { memory } = await hub.write(who, { kind: 'pitfall', scope: 'project', text: '部署时 cred-value-abcdef123 别写进日志，Bearer abcdefghijklmnop1234 也是' });
  assert.ok(!memory.text.includes('cred-value-abcdef123') && !memory.text.includes('abcdefghijklmnop1234'));
  assert.ok(memory.text.includes(REDACTED));
  assert.equal(queued.length, 1);
  assert.equal(queued[0].memory.text, memory.text, '外发的是脱敏后的文本');
  await hub.write(who, { kind: 'note', scope: 'session', text: '只在本会话有用的笔记内容' });
  assert.equal(queued.length, 1, '会话记忆不外发');
  const { results, shared } = await hub.search(who, { query: '部署 日志' });
  assert.deepEqual(shared, { backend: 'openviking', count: 1, error: null });
  assert.equal(results[0].memory.scope.kind, 'project', '本地结果在前');
  assert.ok(results.some(r => r.memory.uri === 'viking://m/1'), '共享结果被合并');
});

test('后端工厂：local 为空实现，openviking 走现有实现；未知 id 回落 local；标签由调用方给出', async () => {
  const local = createMemoryBackend({ settings: settings({ backend: 'local' }), schedule: noTimer });
  assert.equal(local.name, 'local');
  assert.equal(local.enabled, false);
  assert.equal(local.enqueue({ kind: 'note', scope: { kind: 'project' }, text: 'x' }, {}), false);
  assert.deepEqual(await local.recall('x'), []);
  assert.deepEqual(await local.flush(), { sent: 0 });
  assert.deepEqual(await local.status(), { enabled: false });
  assert.equal(local.pending(), 0);
  local.revoke([{ text: 'x' }]);
  assert.equal(createMemoryBackend({ settings: settings({ backend: 'mem0-not-installed' }), schedule: noTimer }).name, 'local');
  assert.deepEqual(Object.keys(MEMORY_BACKEND_REGISTRY).sort(), [...MEMORY_BACKENDS].sort(), '注册表与配置校验列表一致');
  const srv = fakeServer();
  const paths = [];
  const ov = createMemoryBackend({ settings: settings(), fetcher: srv.fetcher, now: () => 7, schedule: noTimer, queuePath: name => { paths.push(name); return null; } });
  assert.equal(ov.name, 'openviking');
  assert.equal(ov.enabled, true);
  assert.deepEqual(paths, ['openviking'], '队列路径按后端 id 区分');
  assert.equal(ov.enqueue({ kind: 'note', scope: { kind: 'project' }, text: '中性前缀' }, { project: 'demo' }), true);
  await ov.flush();
  assert.equal(srv.calls[1].body.content, '【Memory · Project demo】中性前缀', '默认不带调用方名称');
  const lazy = createMemoryBackend({ lazy: true, settings: settings(), schedule: noTimer, queuePath: name => { paths.push(`lazy:${name}`); return null; } });
  assert.equal(paths.length, 1, 'lazy 时不提前创建');
  assert.equal(lazy.pending(), 0);
  assert.deepEqual(paths.slice(1), ['lazy:openviking']);
  const g = fakeServer();
  const gm = createOpenViking({ settings: settings(), label: '全局记忆', fetcher: g.fetcher, schedule: noTimer });
  gm.enqueue({ kind: 'decision', scope: { kind: 'global' }, text: '统一用 path.join' }, {});
  await gm.flush();
  assert.equal(g.calls[1].body.content, '【全局记忆Decision】统一用 path.join');
});

test('存储：另一进程追加的记忆会被重新读入，清理时不丢失', async () => {
  const dir = await tmp();
  const a = createMemoryStore(dir);
  const b = createMemoryStore(dir); // a second DSH process sharing the files
  await a.write({ scope: { kind: 'project', project: P }, kind: 'note', text: '第一个进程写的记忆内容' });
  assert.equal((await b.search({ project: P, query: '第一个进程', k: 5 })).length, 1);
  await b.write({ scope: { kind: 'project', project: P }, kind: 'note', text: '第二个进程写的记忆内容' });
  assert.ok((await a.search({ project: P, query: '第二个进程', k: 5 })).some(r => r.memory.text === '第二个进程写的记忆内容'), 'a 读到了 b 的追加');
  await a.prune({ kind: 'project', project: P });
  assert.equal((await b.search({ project: P, query: '进程 记忆', k: 10 })).length, 2, '清理后两条都在');
});
