import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { INTEGRATION_DEFAULTS, describeIntegrations, handleIntegrations, keyOf, resolveIntegrations, saveIntegrations, setPluginIntegrations, validateIntegrations } from '../integrations-config.js';

const tmp = () => mkdtemp(join(tmpdir(), 'intcfg-'));

test('默认不指向任何网关，也不带任何厂商专用字段', () => {
  assert.equal(INTEGRATION_DEFAULTS.search.baseUrl, null);
  assert.equal(INTEGRATION_DEFAULTS.embeddings.baseUrl, null);
  assert.equal(INTEGRATION_DEFAULTS.embeddings.model, null);
  assert.equal(INTEGRATION_DEFAULTS.embeddings.provider, null);
  assert.deepEqual(INTEGRATION_DEFAULTS.search.headers, {});
});

test('校验：https、路径、环境变量名、请求头；密钥不能放进请求头', () => {
  assert.deepEqual(validateIntegrations({ search: { baseUrl: 'https://gw.example/api/' } }), { search: { baseUrl: 'https://gw.example/api' } });
  assert.throws(() => validateIntegrations({ search: { baseUrl: 'http://gw.example' } }), /https/);
  assert.throws(() => validateIntegrations({ search: { searchPath: 'v1/search' } }), /以 \/ 开头/);
  assert.throws(() => validateIntegrations({ search: { searchPath: '/a/../b' } }), /以 \/ 开头/);
  assert.throws(() => validateIntegrations({ embeddings: { apiKeyEnv: 'sk-123' } }), /环境变量名/);
  assert.throws(() => validateIntegrations({ embeddings: { headers: { Authorization: 'Bearer x' } } }), /apiKeyEnv/);
  assert.throws(() => validateIntegrations({ embeddings: { apiKey: 'x' } }), /不是支持的字段/);
  assert.throws(() => validateIntegrations({ other: {} }), /不支持/);
});

test('分层：环境变量 › 本页文件 › 插件配置 › 默认值，并标注来源', async () => {
  const root = await tmp();
  setPluginIntegrations({ embeddings: { model: 'plugin-model', path: '/plugin/embed' } });
  try {
    await saveIntegrations({ embeddings: { model: 'file-model', baseUrl: 'https://file.example' } }, 0, { root });
    const r = resolveIntegrations({ root, env: { CPA_EMBED_BASE_URL: 'https://env.example', CPA_EMBED_API_KEY: 'k' } });
    assert.equal(r.effective.embeddings.baseUrl, 'https://env.example');
    assert.equal(r.sources.embeddings.baseUrl, 'env:CPA_EMBED_BASE_URL');
    assert.equal(r.effective.embeddings.model, 'file-model');
    assert.equal(r.sources.embeddings.model, 'file');
    assert.equal(r.effective.embeddings.path, '/plugin/embed');
    assert.equal(r.sources.embeddings.path, 'plugin');
    assert.equal(r.sources.embeddings.batch, 'default');
    assert.equal(keyOf('embeddings', r), 'k');
    const view = JSON.stringify(describeIntegrations(r));
    assert.ok(!view.includes('"k"') && !view.includes('CPA_EMBED_API_KEY":"k'), '描述里没有密钥值');
    assert.equal(describeIntegrations(r).keys.embeddings.present, true);
  } finally { setPluginIntegrations(undefined); }
});

test('保存：按字段合并，null 恢复下一层，版本冲突返回 409', async () => {
  const root = await tmp();
  const a = await saveIntegrations({ search: { baseUrl: 'https://a.example', providers: ['x'] } }, 0, { root });
  await saveIntegrations({ search: { providers: null, searchPath: '/find' } }, a.revision, { root });
  const r = resolveIntegrations({ root, env: {} });
  assert.equal(r.effective.search.baseUrl, 'https://a.example');
  assert.deepEqual(r.effective.search.providers, []);
  assert.equal(r.effective.search.searchPath, '/find');
  await assert.rejects(saveIntegrations({ search: { baseUrl: 'https://b.example' } }, 0, { root }), e => e.status === 409);
});

test('HTTP：GET 读描述，POST 需同源 JSON，校验失败 422', async () => {
  const root = await tmp();
  const base = 'http://dsh.test/api/capability-team.integrations';
  const got = await (await handleIntegrations(new Request(base), { root, env: {} })).json();
  assert.equal(got.revision, 0);
  assert.equal(got.keys.search.present, false);
  const post = (headers, body) => handleIntegrations(new Request(base, { method: 'POST', headers, body: JSON.stringify(body) }), { root, env: {} });
  const json = { 'content-type': 'application/json', origin: 'http://dsh.test' };
  assert.equal((await post({ ...json, origin: 'http://evil.test' }, { expectedRevision: 0, patch: {} })).status, 403);
  assert.equal((await post(json, { expectedRevision: 0, patch: { search: { baseUrl: 'http://x' } } })).status, 422);
  const ok = await post(json, { expectedRevision: 0, patch: { search: { baseUrl: 'https://x.example' } } });
  assert.equal(ok.status, 200);
  assert.equal((await post(json, { expectedRevision: 0, patch: { search: { baseUrl: 'https://y.example' } } })).status, 409);
});

function loadPanel(fetchImpl) {
  let exposed, cursor = 0; const states = [], effects = [];
  const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState(i) { const n = cursor++; if (!(n in states)) states[n] = i; return [states[n], v => { states[n] = typeof v === 'function' ? v(states[n]) : v; }]; },
    useRef: v => ({ current: v }), useEffect(fn) { effects.push(fn); }, useMemo: f => f(), Fragment: Symbol.for('f') };
  const calls = [];
  const fetch = async (url, init = {}) => { calls.push({ url, init }); return fetchImpl(url, init); };
  new Script(readFileSync(new URL('../client.js', import.meta.url), 'utf8')).runInNewContext({ window: { __ModuleLoader__: { load: spec => spec.factory(() => React) }, __ctmTestHook: x => { exposed = x; } }, fetch, AbortController });
  const t = k => `${k}[{name}|{field}]`;
  let first = true;
  const render = () => { cursor = 0; effects.length = 0; const tree = exposed.IntegrationsPanel({ t, sessionId: 's1' }); if (first) { first = false; for (const f of effects.splice(0)) f(); } return tree; };
  return { render, calls, exposed };
}
const find = (n, p) => { if (!n || typeof n !== 'object') return; if (p(n)) return n; for (const c of n.children ?? []) { const r = find(c, p); if (r) return r; } };
const text = n => (typeof n === 'string' ? n : (n?.children ?? []).map(text).join(''));

test('集成页：显示来源与密钥是否设置；环境变量覆盖的字段只读；保存只发改动的字段', async () => {
  const root = await tmp();
  const env = { CPA_SEARCH_BASE_URL: 'https://env.example', CPA_SEARCH_API_KEY: 'secret' };
  const view = describeIntegrations(resolveIntegrations({ root, env }));
  const h = loadPanel(async (url, init) => (init.method === 'POST' ? new Response(JSON.stringify({ revision: 1 })) : new Response(JSON.stringify(view))));
  h.render(); await new Promise(r => setTimeout(r, 5));
  let tree = h.render();
  assert.ok(text(tree).includes('int.keySet[CPA_SEARCH_API_KEY|]'));
  assert.ok(!text(tree).includes('secret'), '不显示密钥值');
  const baseUrl = find(tree, n => n.props?.id === 'ctm-int-search-baseUrl');
  assert.equal(baseUrl.props.disabled, true);
  assert.equal(baseUrl.props.value, 'https://env.example');
  find(tree, n => n.props?.id === 'ctm-int-embeddings-model').props.onChange({ target: { value: 'my-model' } });
  find(h.render(), n => n.props?.id === 'ctm-int-embeddings-headers').props.onChange({ target: { value: 'User-Agent: X/1' } });
  tree = h.render();
  find(tree, n => n.type === 'button' && text(n).startsWith('int.save')).props.onClick();
  await new Promise(r => setTimeout(r, 5));
  const post = h.calls.find(c => c.init.method === 'POST');
  assert.deepEqual(JSON.parse(post.init.body), { expectedRevision: 0, patch: { embeddings: { model: 'my-model', headers: { 'User-Agent': 'X/1' } } } });
  assert.equal(h.exposed.integrationFromInput('number', ''), null, '清空表示恢复下一层');
  assert.equal(h.exposed.integrationFromInput('headers', 'bad line'), undefined);
});
