import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

// The confirmation card opens in the dock above the input box; the plan row inside the folded steps only points there.
const flush = () => new Promise(resolve => setTimeout(resolve, 5));
const unref = { setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); id.unref?.(); return id; }, clearTimeout };
function load(fetchImpl) {
  let exposed, cursor = 0;
  const states = [], effects = [], cleanups = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return states[i] ??= { current: initial }; },
    useEffect(fn) { effects.push(fn); },
    useMemo: fn => fn(),
    Fragment: Symbol.for('react.fragment'),
  };
  const calls = [];
  const fetch = async (url, init = {}) => { calls.push(String(url)); return fetchImpl(String(url), init); };
  const sandbox = { window: { __ModuleLoader__: { load: spec => spec.factory(() => React) }, __ctmTestHook: x => { exposed = x; } }, fetch, AbortController, URLSearchParams, console, ...unref };
  new Script(readFileSync(new URL('../client.js', import.meta.url), 'utf8')).runInNewContext(sandbox);
  let ran = false;
  const render = (Component, props) => {
    cursor = 0; effects.length = 0;
    const tree = Component({ t: k => k, ...props });
    if (!ran) { ran = true; for (const fn of effects.splice(0)) cleanups.push(fn()); }
    return tree;
  };
  return { exposed, calls, render, unmount: () => { for (const fn of cleanups.splice(0)) fn?.(); } };
}
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
const find = (node, pred) => { if (!node || typeof node !== 'object') return undefined; if (pred(node)) return node; for (const c of node.children ?? []) { const r = find(c, pred); if (r) return r; } return undefined; };
const text = n => (typeof n === 'string' ? n : (n?.children ?? []).map(text).join(''));
const running = s => s => s({ running: true });

test('确认面板：会话运行时按会话轮询，发现待确认的分派就在输入框上方展开卡片', async () => {
  const h = load(async () => json(200, { schemaVersion: 1, status: 'pending', callId: 'c7', routes: [] }));
  const props = { sessionId: 'lead-1', useSession: running() };
  assert.equal(h.render(h.exposed.ConfirmDock, props), null);
  await flush();
  const tree = h.render(h.exposed.ConfirmDock, props);
  const card = find(tree, n => n.type === h.exposed.DispatchConfirmCard);
  assert.ok(card, '分派确认卡片显示在面板里');
  assert.equal(card.props.callId, 'c7');
  assert.equal(tree.props.className, 'ctm-dock');
  assert.ok(h.calls[0].includes('sessionId=lead-1') && !h.calls[0].includes('callId'), '按会话查询最新请求');
  assert.equal(h.exposed.dockedSessions.has('lead-1'), true);
  h.unmount();
  assert.equal(h.exposed.dockedSessions.has('lead-1'), false);
});

test('确认面板：主控亲自完成的请求显示允许/不允许卡片；非主控会话 404 后停止轮询', async () => {
  const d = load(async () => json(200, { schemaVersion: 1, status: 'pending', kind: 'direct', callId: 'c8' }));
  d.render(d.exposed.ConfirmDock, { sessionId: 'lead-2', useSession: running() }); await flush();
  assert.ok(find(d.render(d.exposed.ConfirmDock, { sessionId: 'lead-2', useSession: running() }), n => n.type === d.exposed.DirectConfirmCard));
  d.unmount();
  const n = load(async () => json(404, {}));
  n.render(n.exposed.ConfirmDock, { sessionId: 'member-1', useSession: running() }); await flush(); await flush();
  assert.equal(n.render(n.exposed.ConfirmDock, { sessionId: 'member-1', useSession: running() }), null);
  assert.equal(n.calls.length, 1, '404 后不再轮询');
  n.unmount();
});

test('确认面板：会话不在运行时不轮询', async () => {
  const h = load(async () => json(200, { status: 'none' }));
  h.render(h.exposed.ConfirmDock, { sessionId: 'lead-3', useSession: s => s({ running: false }) }); await flush();
  assert.equal(h.calls.length, 0);
  h.unmount();
});

test('计划卡片：会话已挂确认面板时只提示去下方确认，不再在步骤里重复一张卡片', () => {
  const h = load(async () => json(200, { status: 'none' }));
  const args = { analysis: 'a', mode: 'delegate', assignments: [{ role: 'r', capability: 'frontend', task: 't' }] };
  const view = () => h.exposed.DispatchPlanView({ t: k => k, phase: 'start', block: { argsRaw: JSON.stringify(args) }, callId: 'c1', sessionId: 'lead-9' });
  assert.ok(find(view(), n => n.type === h.exposed.DispatchConfirmCard), '没有面板时仍在原处显示卡片');
  h.exposed.dockedSessions.add('lead-9');
  const tree = view();
  assert.equal(find(tree, n => n.type === h.exposed.DispatchConfirmCard), undefined);
  assert.ok(text(tree).includes('confirm.docked'));
});
