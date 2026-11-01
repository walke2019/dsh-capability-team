// Engine drivers and failover with mocked fetch only; no real network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INTEGRATION_DEFAULTS } from '../../integrations-config.js';
import { activeEngines, omni } from '../../search.js';

const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const settings = (config = {}, keys = {}) => ({ config: { ...INTEGRATION_DEFAULTS.search, ...config }, keys, key: keys.custom, keyEnv: 'OMNI_SEARCH_API_KEY' });
// Records each call and answers from a route table keyed by URL prefix.
function mock(routes) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.redirect, 'error'); assert.ok(init.signal);
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!hit) throw new TypeError('fetch failed');
    // A fixed Response is cloned so a route can answer more than once.
    return typeof hit[1] === 'function' ? hit[1](url, init) : hit[1].clone();
  };
  return { calls, fetcher };
}

test('自动模式：只启用已配置的引擎，按 tavily → brave → searxng → custom 排序', () => {
  assert.deepEqual(activeEngines(settings()), []);
  assert.deepEqual(activeEngines(settings({ searxngUrl: 'http://127.0.0.1:8888', baseUrl: 'https://gateway.example.com' }, { brave: 'b' })), ['brave', 'searxng', 'custom']);
  assert.deepEqual(activeEngines(settings({ engines: ['searxng', 'tavily'] }, { brave: 'b' })), ['searxng', 'tavily'], '显式列表原样使用');
});

test('没有任何搜索引擎时明确报错，提示可用的环境变量', async () => {
  await assert.rejects(omni('search', { query: 'q' }, { settings: settings(), fetcher: async () => assert.fail('不应请求') }), /TAVILY_API_KEY.*BRAVE_API_KEY.*SEARXNG_URL/);
});

test('Tavily：POST /search，Bearer 密钥，news 映射为 topic=news，结果归一化', async () => {
  const m = mock({ 'https://api.tavily.com/search': reply(200, { results: [{ title: '<b>T</b>', url: 'https://a.example.com', content: 'snip', published_date: '2026-01-01' }, { title: 'no url' }] }) });
  const out = await omni('search', { query: 'q', search_type: 'news', max_results: 3 }, { settings: settings({}, { tavily: 'tk' }), fetcher: m.fetcher });
  assert.deepEqual(out, { engine: 'tavily', results: [{ title: 'T', url: 'https://a.example.com', snippet: 'snip', published: '2026-01-01' }] });
  const { init } = m.calls[0];
  assert.equal(init.method, 'POST'); assert.equal(init.headers.Authorization, 'Bearer tk');
  assert.deepEqual(JSON.parse(init.body), { query: 'q', max_results: 3, topic: 'news', search_depth: 'basic' });
});

test('Brave：GET web/news 端点，X-Subscription-Token 头，不带 Authorization', async () => {
  const m = mock({
    'https://api.search.brave.com/res/v1/web/search': reply(200, { type: 'search', web: { results: [{ title: 'W', url: 'https://w.example.com', description: 'd', page_age: '2026-02-02' }] } }),
    'https://api.search.brave.com/res/v1/news/search': reply(200, { results: [{ title: 'N', url: 'https://n.example.com', description: 'nd' }] }),
  });
  const web = await omni('search', { query: 'hello world' }, { settings: settings({}, { brave: 'bk' }), fetcher: m.fetcher });
  assert.deepEqual(web, { engine: 'brave', results: [{ title: 'W', url: 'https://w.example.com', snippet: 'd', published: '2026-02-02' }] });
  const url = new URL(m.calls[0].url);
  assert.equal(url.searchParams.get('q'), 'hello world'); assert.equal(url.searchParams.get('count'), '5');
  assert.equal(m.calls[0].init.headers['X-Subscription-Token'], 'bk'); assert.equal(m.calls[0].init.headers.Authorization, undefined);
  const news = await omni('search', { query: 'q', search_type: 'news' }, { settings: settings({}, { brave: 'bk' }), fetcher: m.fetcher });
  assert.equal(news.results[0].title, 'N');
  assert.match(m.calls[1].url, /\/res\/v1\/news\/search\?/);
  const empty = await omni('search', { query: 'q' }, { settings: settings({}, { brave: 'bk' }), fetcher: async () => reply(200, { type: 'search' }) });
  assert.deepEqual(empty.results, [], '没有 web 块时视为零结果');
});

test('SearXNG：GET {url}/search?format=json，news/code 映射分类，密钥可选', async () => {
  const m = mock({ 'http://127.0.0.1:8888/search': reply(200, { results: [{ title: 'S', url: 'https://s.example.com', content: 'c', publishedDate: '2026-03-03' }] }) });
  const s = settings({ searxngUrl: 'http://127.0.0.1:8888' });
  const out = await omni('search', { query: 'q', search_type: 'code' }, { settings: s, fetcher: m.fetcher });
  assert.deepEqual(out, { engine: 'searxng', results: [{ title: 'S', url: 'https://s.example.com', snippet: 'c', published: '2026-03-03' }] });
  const url = new URL(m.calls[0].url);
  assert.equal(url.searchParams.get('format'), 'json'); assert.equal(url.searchParams.get('categories'), 'it');
  assert.equal(m.calls[0].init.headers.Authorization, undefined, '无密钥时不发送鉴权头');
  await omni('search', { query: 'q', search_type: 'news' }, { settings: { ...s, keys: { searxng: 'sx' } }, fetcher: m.fetcher });
  assert.equal(new URL(m.calls[1].url).searchParams.get('categories'), 'news');
  assert.equal(m.calls[1].init.headers.Authorization, 'Bearer sx');
});

test('custom：沿用网关协议（路径、请求头、provider），结果归一化', async () => {
  const m = mock({ 'https://gateway.example.com/v1/search': (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer ck'); assert.equal(init.headers['X-Team'], 'a');
    assert.deepEqual(JSON.parse(init.body), { query: 'q', max_results: 5, search_type: 'web', provider: 'p1' });
    return reply(200, { provider: 'p1', results: [{ title: 'C', url: 'https://c.example.com', snippet: 's' }] });
  } });
  const s = settings({ baseUrl: 'https://gateway.example.com', headers: { 'X-Team': 'a' }, providers: ['p1'] }, { custom: 'ck' });
  assert.deepEqual(await omni('search', { query: 'q', provider: 'p1' }, { settings: s, fetcher: m.fetcher }), { engine: 'custom', results: [{ title: 'C', url: 'https://c.example.com', snippet: 's' }] });
  await assert.rejects(omni('search', { query: 'q', provider: 'p1' }, { settings: settings({}, { tavily: 't' }), fetcher: m.fetcher }), /provider 参数只适用于自定义/);
});

test('容灾：超时、网络错误、401/403、429、5xx 换下一个引擎；400 不换', async () => {
  const brave = reply(200, { type: 'search', web: { results: [{ title: 'B', url: 'https://b.example.com' }] } });
  for (const failure of [401, 403, 429, 500, 502, 503, 'network', 'timeout']) {
    const m = mock({
      'https://api.tavily.com/search': () => {
        if (failure === 'network') throw new TypeError('fetch failed');
        if (failure === 'timeout') throw new DOMException('timed out', 'TimeoutError');
        return reply(failure, 'upstream says tk secret');
      },
      'https://api.search.brave.com/': brave.clone(),
    });
    const out = await omni('search', { query: 'q' }, { settings: settings({}, { tavily: 'tk', brave: 'bk' }), fetcher: m.fetcher });
    assert.equal(out.engine, 'brave', String(failure)); assert.equal(m.calls.length, 2);
  }
  const bad = mock({ 'https://api.tavily.com/search': () => reply(400, 'detail tk'), 'https://api.search.brave.com/': brave.clone() });
  await assert.rejects(omni('search', { query: 'q' }, { settings: settings({}, { tavily: 'tk', brave: 'bk' }), fetcher: bad.fetcher }), e => /HTTP 400/.test(e.message) && !e.message.includes('tk'));
  assert.equal(bad.calls.length, 1, '参数错误不换引擎');
  // All engines down: the error lists each one without upstream bodies or keys.
  const down = mock({ 'https://api.tavily.com/search': () => reply(503, 'tk leaked'), 'https://api.search.brave.com/': () => reply(429, 'bk leaked') });
  await assert.rejects(omni('search', { query: 'q' }, { settings: settings({}, { tavily: 'tk', brave: 'bk' }), fetcher: down.fetcher }),
    e => /全部引擎不可用/.test(e.message) && /tavily: .*503/.test(e.message) && /brave: .*429/.test(e.message) && !/leaked|tk|bk/.test(e.message.replace(/tavily|brave/gi, '')));
});

test('输入无效时不发任何请求；调用方取消时不换引擎', async () => {
  const m = mock({});
  await assert.rejects(omni('search', { query: ' ' }, { settings: settings({}, { tavily: 't' }), fetcher: m.fetcher }), /搜索词无效/);
  await assert.rejects(omni('search', { query: 'q', max_results: 50 }, { settings: settings({}, { tavily: 't' }), fetcher: m.fetcher }), /1–20/);
  assert.equal(m.calls.length, 0);
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(omni('search', { query: 'q' }, { settings: settings({}, { tavily: 't', brave: 'b' }), signal: controller.signal, fetcher: async () => { calls++; throw new DOMException('aborted', 'AbortError'); } }), /aborted/);
  assert.equal(calls, 1);
});

test('响应含密钥被拦截且不换引擎；超过 1MB 被拒绝；200 无结果列表视为不可用', async () => {
  const echo = mock({ 'https://api.tavily.com/search': reply(200, { results: [{ url: 'https://x.example.com', content: 'tk' }] }), 'https://api.search.brave.com/': reply(200, { web: { results: [] } }) });
  await assert.rejects(omni('search', { query: 'q' }, { settings: settings({}, { tavily: 'tk', brave: 'bk' }), fetcher: echo.fetcher }), /响应包含凭据/);
  assert.equal(echo.calls.length, 1);
  const big = JSON.stringify({ results: [{ url: 'https://x.example.com', content: 'x'.repeat(1024 * 1024 + 10) }] });
  await assert.rejects(omni('search', { query: 'q' }, { settings: settings({}, { tavily: 'tk' }), fetcher: async () => reply(200, big) }), /超过1MB/);
  const shape = mock({ 'https://api.tavily.com/search': reply(200, { answer: 'x' }), 'https://api.search.brave.com/': reply(200, { type: 'search', web: { results: [] } }) });
  assert.equal((await omni('search', { query: 'q' }, { settings: settings({}, { tavily: 'tk', brave: 'bk' }), fetcher: shape.fetcher })).engine, 'brave');
});

test('抓取：默认 Jina 无需密钥，请求 markdown；可选 JINA_API_KEY 作为 Bearer', async () => {
  const m = mock({ 'https://r.jina.ai/': reply(200, { code: 200, data: { title: 'Page', url: 'https://public.example.com/a', content: '# Hello' } }) });
  const out = await omni('fetch', { url: 'https://public.example.com/a' }, { settings: settings(), fetcher: m.fetcher });
  assert.deepEqual(out, { engine: 'jina', url: 'https://public.example.com/a', title: 'Page', content: '# Hello' });
  assert.equal(m.calls[0].url, 'https://r.jina.ai/https://public.example.com/a');
  assert.equal(m.calls[0].init.headers['X-Return-Format'], 'markdown');
  assert.equal(m.calls[0].init.headers.Authorization, undefined);
  await omni('fetch', { url: 'https://public.example.com/a' }, { settings: settings({}, { jina: 'jk' }), fetcher: m.fetcher });
  assert.equal(m.calls[1].init.headers.Authorization, 'Bearer jk');
});

test('抓取：Tavily extract 与 custom 抓取，按 fetchEngines 顺序容灾；私网地址拒绝', async () => {
  const m = mock({
    'https://r.jina.ai/': () => reply(429, {}),
    'https://api.tavily.com/extract': (url, init) => { assert.deepEqual(JSON.parse(init.body), { urls: ['https://public.example.com/'], format: 'markdown' }); return reply(503, {}); },
    'https://gateway.example.com/v1/web/fetch': reply(200, { content: 'gateway page', title: 'G' }),
  });
  const s = settings({ fetchEngines: ['jina', 'tavily', 'custom'], baseUrl: 'https://gateway.example.com' }, { tavily: 'tk', custom: 'ck' });
  assert.deepEqual(await omni('fetch', { url: 'https://public.example.com' }, { settings: s, fetcher: m.fetcher }), { engine: 'custom', url: 'https://public.example.com/', title: 'G', content: 'gateway page' });
  assert.equal(m.calls.length, 3);
  const t = mock({ 'https://api.tavily.com/extract': reply(200, { results: [{ url: 'https://public.example.com/', raw_content: 'body' }] }) });
  assert.deepEqual(await omni('fetch', { url: 'https://public.example.com' }, { settings: settings({ fetchEngines: ['tavily'] }, { tavily: 'tk' }), fetcher: t.fetcher }), { engine: 'tavily', url: 'https://public.example.com/', content: 'body' });
  for (const url of ['http://127.0.0.1/', 'http://192.168.1.1/', 'http://10.0.0.1/', 'http://169.254.169.254/']) await assert.rejects(omni('fetch', { url }, { settings: settings(), fetcher: async () => assert.fail('不应请求') }), /公开/);
  await assert.rejects(omni('fetch', { url: 'https://public.example.com' }, { settings: settings(), fetcher: async () => reply(200, { data: { content: ' ' } }) }), /全部引擎不可用.*没有网页正文/);
});

test('渠道列表只在 custom 引擎可用时工作', async () => {
  await assert.rejects(omni('providers', {}, { settings: settings({ providersPath: '/p' }, { tavily: 't' }), fetcher: async () => assert.fail() }), /自定义搜索引擎/);
  const out = await omni('providers', {}, { settings: settings({ baseUrl: 'https://gateway.example.com', providersPath: '/p' }, { custom: 'ck' }), fetcher: async () => reply(200, { data: ['a'] }) });
  assert.deepEqual(out.data, ['a']);
});
