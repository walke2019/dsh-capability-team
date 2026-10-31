import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const flush = () => new Promise(resolve => setTimeout(resolve, 5));
function load(fetchImpl) {
  let exposed, cursor = 0;
  const states = [], effects = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return states[i] ??= { current: initial }; },
    useEffect(fn) { effects.push(fn); },
    useMemo: fn => fn(),
    Fragment: Symbol.for('react.fragment'),
  };
  const calls = [];
  const fetch = async (url, init = {}) => { calls.push({ url, init }); return fetchImpl(url, init, calls); };
  const sandbox = { window: { __ModuleLoader__: { load: spec => spec.factory(() => React) }, __ctmTestHook: x => { exposed = x; } }, fetch, AbortController, URLSearchParams, setTimeout, clearTimeout };
  new Script(readFileSync(new URL('../client.js', import.meta.url), 'utf8')).runInNewContext(sandbox);
  const t = k => `${k}[{n}|{list}]`;
  let ran = false;
  const render = (props, runEffects = !ran) => { cursor = 0; effects.length = 0; const tree = exposed.DispatchConfirmCard({ t, ...props }); if (runEffects) { ran = true; for (const fn of effects.splice(0)) fn(); } return tree; };
  return { render, calls, exposed, rerunEffects: () => { ran = false; } };
}
const find = (node, pred) => { if (!node || typeof node !== 'object') return undefined; if (pred(node)) return node; for (const c of node.children ?? []) { const r = find(c, pred); if (r) return r; } };
const findAll = (node, pred, acc = []) => { if (!node || typeof node !== 'object') return acc; if (pred(node)) acc.push(node); for (const c of node.children ?? []) findAll(c, pred, acc); return acc; };
const text = n => (typeof n === 'string' ? n : (n?.children ?? []).map(text).join(''));
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
const pending = { schemaVersion: 1, status: 'pending', callId: 'c1', catalogVersion: 'v1', maxFallbacks: 3, routes: [{
  role: 'diao-chan', displayName: '貂蝉', capability: 'frontend', tier: 'medium', task: '改前端',
  primary: { provider: 'provider-a', model: 'm1' }, fallbacks: [{ provider: 'provider-a', model: 'm2' }],
  candidates: ['m1', 'm2', 'm3', 'm4', 'm5'].map(model => ({ provider: 'provider-a', model })) }] };
const props = { sessionId: 'lead-1', callId: 'c1' };

test('显示角色、主模型与回退；确认按钮发送编辑后的路由', async () => {
  const h = load(async (url, init) => (init.method === 'POST' ? json(200, { status: 'resolved' }) : json(200, pending)));
  h.render(props); await flush();
  let tree = h.render(props);
  assert.ok(text(tree).includes('貂蝉'));
  assert.equal(h.calls[0].url, 'api/capability-team.dispatch-confirm?sessionId=lead-1&callId=c1');
  const selects = findAll(tree, n => n.type === 'select');
  selects[0].props.onChange({ target: { value: 'provider-a/m3' } });
  tree = h.render(props);
  find(tree, n => n.type === 'select' && String(n.props['aria-label']).startsWith('confirm.addFallback')).props.onChange({ target: { value: 'provider-a/m4' } });
  tree = h.render(props);
  find(tree, n => n.type === 'button' && text(n).startsWith('confirm.ok')).props.onClick();
  await flush();
  const post = h.calls.find(c => c.init.method === 'POST');
  assert.deepEqual(JSON.parse(post.init.body), { sessionId: 'lead-1', callId: 'c1', decision: 'confirm', scope: 'task', catalogVersion: 'v1',
    routes: [{ role: 'diao-chan', primary: 'provider-a/m3', fallbacks: ['provider-a/m2', 'provider-a/m4'] }] });
  assert.ok(text(h.render(props)).includes('confirm.sent'));
});

test('回退模型满 3 个后不再提供添加', async () => {
  const full = { ...pending, routes: [{ ...pending.routes[0], fallbacks: ['m2', 'm3', 'm4'].map(model => ({ provider: 'provider-a', model })) }] };
  const h = load(async () => json(200, full));
  h.render(props); await flush();
  const tree = h.render(props);
  assert.equal(find(tree, n => n.type === 'select' && String(n.props['aria-label']).startsWith('confirm.addFallback')), undefined);
  assert.ok(text(tree).includes('confirm.max[3|]'));
});

test('取消发送 cancel；409 时刷新重读而不是重试', async () => {
  let posts = 0;
  const h = load(async (url, init) => { if (init.method === 'POST') { posts++; return json(409, { code: 'CONFLICT' }); } return json(200, pending); });
  h.render(props); await flush();
  let tree = h.render(props);
  find(tree, n => n.type === 'button' && text(n).startsWith('confirm.ok')).props.onClick();
  await flush();
  assert.equal(posts, 1, '409 不自动重试');
  h.rerunEffects(); h.render(props); await flush();
  assert.equal(h.calls.filter(c => !c.init.method).length, 2, '409 后重新读取待确认内容');
  const h2 = load(async (url, init) => (init.method === 'POST' ? json(200, {}) : json(200, pending)));
  h2.render(props); await flush();
  find(h2.render(props), n => n.type === 'button' && text(n).startsWith('confirm.cancel')).props.onClick();
  await flush();
  assert.equal(JSON.parse(h2.calls.find(c => c.init.method === 'POST').init.body).decision, 'cancel');
});

test('没有等待中的请求（未要求确认）时不显示卡片', async () => {
  const h = load(async () => json(200, { schemaVersion: 1, status: 'none' }));
  h.render(props);
  for (let i = 0; i < 7; i++) await new Promise(resolve => setTimeout(resolve, 520));
  assert.equal(h.render(props), null);
});

test('派活计划卡片在等待确认时附带确认卡片', () => {
  const h = load(async () => json(200, pending));
  const t = k => k;
  const block = { argsRaw: JSON.stringify({ mode: 'delegate', analysis: 'a', assignments: [{ role: 'diao-chan', task: 'x' }] }) };
  const tree = h.exposed.DispatchPlanView({ t, phase: 'start', block, callId: 'c1', sessionId: 'lead-1' });
  assert.equal(tree.props.className, 'ctm-dc-wrap');
  assert.equal(tree.children[1].props.callId, 'c1');
});
