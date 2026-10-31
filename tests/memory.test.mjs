import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cosine, createEmbedder, embedConfig, normalize } from '../memory-embed.js';
import { createMemoryStore, rank, tokenize, visible } from '../memory-store.js';
import { createMemoryHub } from '../memory-hub.js';

const tmp = () => mkdtemp(join(tmpdir(), 'mem-'));
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

test('嵌入配置：默认复用搜索网关，只接受 https', () => {
  assert.equal(embedConfig({}), undefined);
  const c = embedConfig({ CPA_SEARCH_BASE_URL: 'https://gw.example/x', CPA_SEARCH_API_KEY: 'k' });
  assert.equal(c.endpoint, 'https://gw.example/v1/embeddings');
  assert.equal(c.model, 'jina-embeddings-v3');
  assert.equal(c.dimensions, 512);
  assert.equal(embedConfig({ CPA_EMBED_BASE_URL: 'http://gw.example', CPA_API_KEY: 'k' }), undefined);
  assert.equal(embedConfig({ CPA_BASE_URL: 'https://gw.example/gateway/v1', CPA_API_KEY: 'k' }).endpoint, 'https://gw.example/v1/embeddings', '默认用 CPA_BASE_URL 的同源网关');
});

test('嵌入请求：成功返回归一化向量；404 时降级并说明原因', async () => {
  const config = { endpoint: 'https://gw.example/v1/embeddings', key: 'k', model: 'jina-embeddings-v3', dimensions: 3 };
  let sent;
  const ok = createEmbedder({ config, fetcher: async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ data: [{ index: 0, embedding: [3, 4, 0] }] })); } });
  const out = await ok.embed(['你好'], 'retrieval.query');
  assert.deepEqual(out.vectors[0], [0.6, 0.8, 0]);
  assert.deepEqual(sent, { provider: 'jina', model: 'jina-embeddings-v3', input: ['你好'], dimensions: 3, task: 'retrieval.query' });
  const empty = createEmbedder({ config, fetcher: async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [] }] })) });
  assert.equal(await empty.embed(['x']), undefined, '空向量不算成功');
  const limited = createEmbedder({ config, fetcher: async () => new Response('{}', { status: 429 }) });
  await limited.embed(['x']);
  assert.match(limited.lastError, /429（限流/);
  const missing = createEmbedder({ config, fetcher: async () => new Response('{}', { status: 404 }) });
  assert.equal(await missing.embed(['x']), undefined);
  assert.match(missing.lastError, /尚未提供 \/v1\/embeddings/);
  const routeList = createEmbedder({ config, fetcher: async () => new Response(JSON.stringify({ status: 'ok', available_routes: ['/provider-a/', '/v1/search'] })) });
  assert.equal(await routeList.embed(['x']), undefined);
  assert.match(routeList.lastError, /尚未提供 \/v1\/embeddings（现有路由：\/provider-a\/ \/v1\/search）/);
  assert.equal(cosine([1, 0], [1, 0]), 1);
});

function fakeCtx() {
  const lead = { id: 'lead', ctx: { systemPrompt: { context() {} } } };
  const fe = { id: 'fe1', ctx: { systemPrompt: { context: c => { fe.context = c; } } } };
  const agents = new Map([['lead', lead], ['fe1', fe]]);
  const handlers = {};
  const tools = {};
  const ctx = { agents, on: (name, fn) => { handlers[name] = fn; }, effect: fn => fn(), tools: { register: t => { tools[t.name] = t; } },
    agentTeams: { tryMembership: a => (a === lead ? { role: 'lead' } : a === fe ? { role: 'teammate', name: 'diao-chan-r2', root: lead } : undefined) } };
  return { ctx, lead, fe, handlers, tools };
}

test('记忆枢纽：交接自动入库，接到任务时自动召回，队友最终汇报入库', async () => {
  const root = await tmp();
  const { ctx, fe, handlers, tools } = fakeCtx();
  const hub = createMemoryHub(ctx, { root, pinned: () => P }, { embedder: createEmbedder({ config: null }) });
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
  assert.match(found.note, /未配置嵌入网关/);
  assert.equal(found.results.length, 1);
  await assert.rejects(tools.capability_memory_write.execute({ kind: 'note', text: '全局约定内容', scope: 'global' }, { agent: fe }), /只有主控/);
  const saved = JSON.parse(await tools.capability_memory_write.execute({ kind: 'pitfall', text: '测试前要先 build:client' }, { agent: fe }));
  assert.equal(saved.scope, 'role');
  const file = await readFile(join(root, 'memory', (await import('node:crypto')).createHash('sha256').update(P).digest('hex').slice(0, 32) + '.jsonl'), 'utf8');
  assert.ok(file.includes('build:client'));
});
