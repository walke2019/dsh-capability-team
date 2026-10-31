import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
/** Loads the built client with a hook-tracking React and returns TaskControl plus a tiny renderer. */
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
  const fetch = async (url, init = {}) => { calls.push({ url, init }); return fetchImpl(url, init); };
  const sandbox = { window: { __ModuleLoader__: { load: spec => spec.factory(() => React) }, __ctmTestHook: x => { exposed = x; } }, fetch, AbortController, URLSearchParams, crypto };
  new Script(readFileSync(new URL('../client.js', import.meta.url), 'utf8')).runInNewContext(sandbox);
  // Every key echoes the placeholders fmt() fills, so rendered text shows both the key and its values.
  const t = k => `${k}[{used}/{est}|{from}->{to}|{name}|{tier}]`;
  const render = props => { cursor = 0; effects.length = 0; const tree = exposed.TaskControl({ t, ...props }); for (const fn of effects.splice(0)) fn(); return tree; };
  return { render, calls, exposed };
}
const find = (node, pred) => {
  if (!node || typeof node !== 'object') return undefined;
  if (pred(node)) return node;
  for (const c of node.children ?? []) { const r = find(c, pred); if (r) return r; }
};
const text = node => (typeof node === 'string' || typeof node === 'number' ? String(node) : (node?.children ?? []).map(text).join(''));
const button = (tree, key) => find(tree, n => n.type === 'button' && text(n).startsWith(key));
const ok = body => ({ ok: true, status: 200, json: async () => body });
const fail = (status, body = { code: 'X', message: 'm' }) => ({ ok: false, status, json: async () => body });
const lease = (extra = {}) => ({ leaseId: 'L1', revision: 3, roleId: 'diao-chan', status: 'running', estimatedSteps: 40, startsUsed: 10, judgment: 'within', override: null, expiresAt: 0, ...extra });
const candidates = { schemaVersion: 1, role: 'diao-chan', catalogVersion: 'cv1', candidates: [{ provider: 'provider-a', model: 'claude-sonnet-5', tier: 'medium' }] };
const props = control => ({ leadSessionId: 'lead-1', roleId: 'diao-chan', name: '貂蝉', configured: 'provider-a/gemini-3.8-flash-high', control });

test('步数条按判定着色，并注明不是质量评级', () => {
  const { render } = load(async () => ok(candidates));
  for (const [judgment, tone] of [['within', 'ok'], ['warning', 'warn'], ['unqualified', 'error']]) {
    const tree = render(props({ leases: [lease({ judgment })], auditTail: [] }));
    assert.equal(tree.props['data-tone'], tone);
    assert.ok(text(tree).includes('control.steps.disclaimer'));
    assert.ok(text(tree).includes('control.steps.label[10/40'));
  }
});

test('未确认不发 POST；确认后带 CAS 与目录版本发送', async () => {
  const h = load(async (url, init) => (init.method === 'POST' ? ok(lease()) : ok(candidates)));
  const p = props({ leases: [lease()], auditTail: [] });
  let tree = h.render(p);
  tree.props.onToggle({ currentTarget: { open: true } });
  tree = h.render(p); await flush(); tree = h.render(p);
  find(tree, n => n.type === 'select').props.onChange({ target: { value: 'provider-a/claude-sonnet-5' } });
  tree = h.render(p);
  button(tree, 'control.override.setAction').props.onClick();
  tree = h.render(p);
  assert.equal(h.calls.filter(c => c.init.method === 'POST').length, 0, '只打开确认框，不发请求');
  assert.ok(text(tree).includes('control.override.confirm.cost'));
  assert.ok(text(tree).includes('provider-a/gemini-3.8-flash-high'), '确认框写明原模型');
  button(tree, 'control.override.confirm.ok').props.onClick();
  await flush();
  const posts = h.calls.filter(c => c.init.method === 'POST');
  assert.equal(posts.length, 1);
  const body = JSON.parse(posts[0].init.body);
  assert.equal(posts[0].url, 'api/capability-team.task-control');
  assert.deepEqual({ ...body, requestId: undefined }, { sessionId: 'lead-1', requestId: undefined, role: 'diao-chan', action: 'set-override', lease_id: 'L1', expected_revision: 3, provider: 'provider-a', model: 'claude-sonnet-5', catalog_version: 'cv1', reason: '' });
});

test('409 不自动重试并提示重新确认；各状态码有对应提示', async () => {
  for (const [status, key] of [[400, 'badRequest'], [403, 'forbidden'], [404, 'notFound'], [409, 'conflict'], [422, 'invalid'], [503, 'unavailable'], [500, 'unknown']]) {
    const h = load(async (url, init) => (init.method === 'POST' ? fail(status) : ok(candidates)));
    const p = props({ leases: [lease()], auditTail: [] });
    let tree = h.render(p);
    button(tree, 'control.action.end').props.onClick();
    await flush();
    tree = h.render(p);
    assert.equal(h.calls.filter(c => c.init.method === 'POST').length, 1, `${status} 只请求一次`);
    const alert = find(tree, n => n.props?.role === 'alert');
    assert.ok(text(alert).includes(`control.error.${key}`), `${status} → ${key}`);
    if (status === 409) assert.ok(text(alert).includes('control.error.reconfirm'));
  }
});

test('网络失败显示网络错误', async () => {
  const h = load(async () => { throw new TypeError('offline'); });
  const p = props({ leases: [lease()], auditTail: [] });
  button(h.render(p), 'control.action.end').props.onClick();
  await flush();
  assert.ok(text(find(h.render(p), n => n.props?.role === 'alert')).includes('control.error.network'));
});

test('租约结束后不显示临时模型操作，只能开始新的预算', async () => {
  const h = load(async () => ok({}));
  const tree = h.render(props({ leases: [lease({ status: 'ended' })], auditTail: [] }));
  assert.equal(button(tree, 'control.override.setAction'), undefined);
  assert.equal(button(tree, 'control.action.end'), undefined);
  button(tree, 'control.budget.startAction').props.onClick();
  await flush();
  const body = JSON.parse(h.calls[0].init.body);
  assert.equal(body.action, 'start-budget');
  assert.equal(body.complexity, 'medium');
});

test('审计列表按角色过滤，以纯文本渲染', () => {
  const h = load(async () => ok(candidates));
  const tree = h.render(props({ leases: [lease()], auditTail: [
    { eventId: 'e1', at: 0, roleId: 'diao-chan', action: 'override-set', to: { provider: 'provider-a', model: 'x' }, reason: '<img src=x onerror=alert(1)>' },
    { eventId: 'e2', at: 0, roleId: 'lv-bu', action: 'override-set' },
  ] }));
  const list = find(tree, n => n.type === 'ul');
  assert.equal(list.children.length, 1);
  assert.equal(typeof list.children[0].children[0], 'string', '原因按文本渲染，不注入 HTML');
});

test('中英文字典的 control.* 键一致', () => {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  const keys = block => [...block.matchAll(/'(control\.[^']+)'/g)].map(m => m[1]).sort();
  const zh = src.slice(src.indexOf('const zh = {'), src.indexOf('const en = {'));
  const en = src.slice(src.indexOf('const en = {'), src.indexOf('const CSS = `'));
  assert.deepEqual(keys(zh), keys(en));
  const used = [...readFileSync(new URL('../client/08a-task-control.js', import.meta.url), 'utf8').matchAll(/t\('(control\.[a-z.]+)'/g)].map(m => m[1]);
  for (const k of used) assert.ok(keys(en).includes(k), `缺少键 ${k}`);
});
