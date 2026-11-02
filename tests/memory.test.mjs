import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cosine, createEmbedder, embedSettings, normalize, vectorKey } from '../memory-embed.js';
import { INTEGRATION_DEFAULTS, resolveIntegrations } from '../integrations-config.js';
import { createMemoryStore, rank, tokenize, visible } from '../memory-store.js';
import { createMemoryHub } from '../memory-hub.js';

const tmp = () => mkdtemp(join(tmpdir(), 'mem-'));
// Never read the user's real integrations (a configured shared-memory server would make tests hit the network).
process.env.CAPABILITY_TEAM_HOME = await tmp();
const P = '/proj';
const role = r => ({ kind: 'role', project: P, role: r });

test('分词：英文单词与中文单字+双字', () => {
  assert.deepEqual(tokenize('client.js 拆分'), ['client.js', '拆', '拆分', '分']);
});

test('写入：相同内容合并，同主题的新决定替换旧的', async () => {
  const store = createMemoryStore(await tmp());
  const a = await store.write({ scope: role('fe'), kind: 'pitfall', text: '不要整文件覆盖 client.js' });
  const b = await store.write({ scope: role('fe'), kind: 'pitfall', text: '不要整文件覆盖   client.js' });
  assert.equal(b.merged, true);
  assert.equal(b.memory.id, a.memory.id);
  await store.write({ scope: { kind: 'project', project: P }, kind: 'decision', key: 'embed', text: '嵌入走 Jina 直连' });
  await store.write({ scope: { kind: 'project', project: P }, kind: 'decision', key: 'embed', text: '嵌入改走 CPA 网关 /v1/embeddings' });
  const found = await store.search({ project: P, query: '嵌入', k: 10 });
  assert.deepEqual(found.map(r => r.memory.text), ['嵌入改走 CPA 网关 /v1/embeddings'], '旧决定被替换后不再出现');
  await assert.rejects(store.write({ scope: role('fe'), kind: 'bogus', text: 'xxxxx' }), /记忆类型/);
});

test('可见范围：角色记忆只给本角色，其他项目看不到', async () => {
  const store = createMemoryStore(await tmp());
  await store.write({ scope: role('fe'), kind: 'note', text: '前端字典在 client/00-core-zh.js' });
  await store.write({ scope: { kind: 'project', project: '/other' }, kind: 'note', text: '前端在别的项目' });
  await store.write({ scope: { kind: 'global' }, kind: 'note', text: '前端相关的全局约定' });
  const fe = await store.search({ project: P, role: 'fe', query: '前端' });
  const qa = await store.search({ project: P, role: 'qa', query: '前端' });
  assert.equal(fe.length, 2);
  assert.deepEqual(qa.map(r => r.memory.scope.kind), ['global']);
  assert.equal(visible({ scope: { kind: 'session', project: P, session: 's1' } }, { project: P, session: 's2' }), false);
});

test('混合检索：向量能找到全文找不到的近义内容', () => {
  const docs = [
    { id: 'a', text: '缓存读取占比过高', vector: normalize([1, 0, 0]), updatedAt: Date.now() },
    { id: 'b', text: '与此无关的内容', vector: normalize([0, 1, 0]), updatedAt: Date.now() },
  ];
  assert.deepEqual(rank(docs, 'token 太多', normalize([0.9, 0.1, 0])).map(r => [r.memory.id, r.via.join()]), [['a', 'vector']]);
  assert.deepEqual(rank(docs, '缓存读取', undefined).map(r => r.memory.id), ['a']);
});

test('衰减与遗忘：旧的未用记忆被清理，常用的保留', async () => {
  let now = Date.now();
  const store = createMemoryStore(await tmp(), { now: () => now });
  const old = await store.write({ scope: role('fe'), kind: 'note', text: '很久以前的笔记甲' });
  const used = await store.write({ scope: role('fe'), kind: 'note', text: '很久以前但常用的笔记乙' });
  await store.markUsed([used.memory]);
  now += 200 * 86400000;
  assert.equal(await store.prune(role('fe')), 1);
  const left = await store.search({ project: P, role: 'fe', query: '笔记' });
  assert.deepEqual(left.map(r => r.memory.id), [used.memory.id]);
  assert.notEqual(old.memory.id, used.memory.id);
});

test('持久化：重新打开后还在；注入文本受字数上限约束', async () => {
  const root = await tmp();
  const s1 = createMemoryStore(root);
  for (let i = 0; i < 5; i++) await s1.write({ scope: role('fe'), kind: 'note', text: `第${i}条：${'内容'.repeat(100)}` });
  const s2 = createMemoryStore(root);
  const results = await s2.search({ project: P, role: 'fe', query: '内容', k: 10 });
  assert.equal(results.length, 5);
  assert.ok(s2.format(results, 500).length <= 500);
});

test('嵌入配置：只来自集成配置与显式环境变量，不从 CPA_BASE_URL 猜测', async () => {
  const root = await tmp();
  const none = embedSettings(resolveIntegrations({ root, env: { CPA_BASE_URL: 'https://gw.example/gateway/v1', CPA_API_KEY: 'k' } }));
  assert.equal(none.config.baseUrl, null);
  assert.match(createEmbedder({ settings: none }).lastError, /embeddings\.baseUrl.*embeddings\.model.*EMBEDDING_API_KEY/);
  await writeFile(join(root, 'integrations.json'), JSON.stringify({ revision: 1, integrations: { embeddings: { baseUrl: 'https://emb.example/', apiKeyEnv: 'MY_EMBED_KEY', model: 'my-model', dimensions: 256 } } }));
  const s = embedSettings(resolveIntegrations({ root, env: { MY_EMBED_KEY: 'secret', CPA_EMBED_MODEL: 'env-model' } }));
  assert.equal(s.config.baseUrl, 'https://emb.example');
  assert.equal(s.config.model, 'env-model', '环境变量覆盖文件');
  assert.equal(s.key, 'secret');
  assert.equal(vectorKey(s.config), 'env-model@256');
});

test('嵌入配置：标准 EMBEDDING_* 环境变量优先，旧 CPA_EMBED_* 仅在标准变量缺失时回落', async () => {
  const root = await tmp();
  const std = embedSettings(resolveIntegrations({ root, env: { EMBEDDING_BASE_URL: 'https://emb.example.com', EMBEDDING_API_KEY: 'std-key', EMBEDDING_MODEL: 'std-model', EMBEDDING_DIMENSIONS: '128',
    CPA_EMBED_BASE_URL: 'https://legacy.example.com', CPA_EMBED_API_KEY: 'legacy-key', CPA_EMBED_MODEL: 'legacy-model' } }));
  assert.deepEqual([std.config.baseUrl, std.config.model, std.config.dimensions, std.key, std.keyEnv], ['https://emb.example.com', 'std-model', 128, 'std-key', 'EMBEDDING_API_KEY']);
  assert.equal(createEmbedder({ settings: std }).available, true);
  const legacy = embedSettings(resolveIntegrations({ root, env: { CPA_EMBED_BASE_URL: 'https://legacy.example.com', CPA_EMBED_API_KEY: 'legacy-key', CPA_EMBED_MODEL: 'legacy-model' } }));
  assert.deepEqual([legacy.config.baseUrl, legacy.config.model, legacy.key], ['https://legacy.example.com', 'legacy-model', 'legacy-key']);
  assert.equal(createEmbedder({ settings: legacy }).available, true);
});

const settingsWith = extra => ({ config: { ...INTEGRATION_DEFAULTS.embeddings, baseUrl: 'https://gw.example', model: 'm', ...extra }, key: 'k', keyEnv: 'K' });
test('嵌入请求：只发送配置了的可选字段，路径与请求头来自配置', async () => {
  let sent, url, headers;
  const fetcher = async (u, init) => { url = u; headers = init.headers; sent = JSON.parse(init.body); return new Response(JSON.stringify({ data: [{ index: 0, embedding: [3, 4, 0] }] })); };
  const plain = await createEmbedder({ settings: settingsWith(), fetcher }).embed(['你好'], 'query');
  assert.deepEqual(sent, { model: 'm', input: ['你好'] }, '没配置 provider/dimensions/task 就不发送');
  assert.equal(url, 'https://gw.example/v1/embeddings');
  assert.deepEqual(plain.vectors[0], [0.6, 0.8, 0]);
  await createEmbedder({ settings: settingsWith({ path: '/api/embed', provider: 'jina', dimensions: 512, queryTask: 'retrieval.query', passageTask: 'retrieval.passage', headers: { 'User-Agent': 'X/1' } }), fetcher }).embed(['a'], 'query');
  assert.equal(url, 'https://gw.example/api/embed');
  assert.equal(headers['User-Agent'], 'X/1');
  assert.deepEqual(sent, { model: 'm', input: ['a'], provider: 'jina', dimensions: 512, task: 'retrieval.query' });
});

test('嵌入失败：空向量、状态页、限流都降级并说明原因', async () => {
  const s = settingsWith();
  const empty = createEmbedder({ settings: s, fetcher: async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [] }] })) });
  assert.equal(await empty.embed(['x']), undefined);
  const statusPage = createEmbedder({ settings: s, fetcher: async () => new Response(JSON.stringify({ status: 'ok', available_routes: ['/v1/search'] })) });
  assert.equal(await statusPage.embed(['x']), undefined);
  assert.match(statusPage.lastError, /非空向量/);
  const limited = createEmbedder({ settings: s, fetcher: async () => new Response('{}', { status: 429 }) });
  await limited.embed(['x']);
  assert.match(limited.lastError, /429（限流/);
  assert.equal(cosine([1, 0], [1, 0]), 1);
});

test('不同模型的向量不混用', () => {
  const now = Date.now();
  const docs = [{ id: 'a', text: '甲', vector: [1, 0], model: 'old@2', updatedAt: now }, { id: 'b', text: '乙', vector: [1, 0], model: 'new@2', updatedAt: now }];
  assert.deepEqual(rank(docs, 'zzz', [1, 0], { vectorModel: 'new@2' }).map(r => r.memory.id), ['b']);
});

function fakeCtx() {
  const lead = { id: 'lead', ctx: { systemPrompt: { context() {} } } };
  const fe = { id: 'fe1', ctx: { systemPrompt: { context: c => { fe.context = c; } } } };
  const agents = new Map([['lead', lead], ['fe1', fe]]);
  const handlers = {};
  const tools = {};
  const ctx = { agentPresets: { composedPreset: () => 'capability-team' }, agents, on: (name, fn) => { handlers[name] = fn; }, effect: fn => fn(), tools: { register: t => { tools[t.name] = t; } },
    agentTeams: { tryMembership: a => (a === lead ? { role: 'lead' } : a === fe ? { role: 'teammate', name: 'diao-chan-r2', root: lead } : undefined) } };
  return { ctx, lead, fe, handlers, tools };
}

test('记忆枢纽：交接自动入库，接到任务时自动召回，队友最终汇报入库', async () => {
  const root = await tmp();
  const { ctx, fe, handlers, tools } = fakeCtx();
  const hub = createMemoryHub(ctx, { root, pinned: () => P }, { embedder: createEmbedder({ settings: settingsWith({ baseUrl: null }) }) });
  hub.register();
  handlers['agent/created']({ agent: fe });
  await hub.ingestHandoff({ session: 'fe1', role: 'diao-chan', member: 'diao-chan', lead: 'lead', written: { done: '任务控制面板完成', remaining: '本地化分隔符', pitfalls: 'client.js 是生成文件，改 client/ 下的源文件' } });
  handlers['agent/inbox/claimed']({ agent: fe, message: { content: [{ type: 'text', text: '继续完成本地化和任务控制面板' }] } });
  await new Promise(resolve => setTimeout(resolve, 20));
  const text = fe.context.text();
  assert.match(text, /记忆枢纽/);
  assert.match(text, /本地化分隔符/);
  handlers['session/event']({ id: 'fe1' }, { type: 'tool/call', data: { name: 'send_message', callId: 'c1', arguments: JSON.stringify({ target: 'lead', message: '最终结果：'.padEnd(220, '好') }) } });
  handlers['session/event']({ id: 'fe1' }, { type: 'tool/result', data: { message: { toolCallId: 'c1', isError: false } } });
  await new Promise(resolve => setTimeout(resolve, 20));
  const found = JSON.parse(await tools.capability_memory_search.execute({ query: '最终结果', kinds: ['result'] }, { agent: fe }));
  assert.equal(found.mode, 'text');
  assert.match(found.note, /未配置嵌入/);
  assert.equal(found.results.length, 1);
  await assert.rejects(tools.capability_memory_write.execute({ kind: 'note', text: '全局约定内容', scope: 'global' }, { agent: fe }), /只有主控/);
  const saved = JSON.parse(await tools.capability_memory_write.execute({ kind: 'pitfall', text: '测试前要先 build:client' }, { agent: fe }));
  assert.equal(saved.scope, 'role');
  const file = await readFile(join(root, 'memory', (await import('node:crypto')).createHash('sha256').update(P).digest('hex').slice(0, 32) + '.jsonl'), 'utf8');
  assert.ok(file.includes('build:client'));
});

test('记忆文件不会因召回无限增长：重复追加超过阈值后自动压缩，且不丢记录', async () => {
  const { mkdtemp, readdir, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { createMemoryStore } = await import('../memory-store.js');
  const root = await mkdtemp(join(tmpdir(), 'mem-compact-'));
  const store = createMemoryStore(root);
  const scope = { kind: 'project', project: '/p' };
  for (let i = 0; i < 20; i++) await store.write({ scope, kind: 'note', text: `distinct memory number ${i} about topic ${i * 7}` });
  for (let r = 0; r < 300; r++) { const found = await store.search({ project: '/p', query: 'memory topic', k: 8 }); await store.markUsed(found.map(x => x.memory)); }
  const [file] = (await readdir(join(root, 'memory'))).filter(name => name.endsWith('.jsonl'));
  const lineCount = (await readFile(join(root, 'memory', file), 'utf8')).split('\n').filter(Boolean).length;
  assert.ok(lineCount <= 2 * 20 + 201, `文件行数应受控，实际 ${lineCount}`);
  const fresh = await createMemoryStore(root).search({ project: '/p', query: 'distinct memory', k: 100 });
  assert.equal(fresh.length, 20, '压缩后新进程仍能读到全部记录');
});
