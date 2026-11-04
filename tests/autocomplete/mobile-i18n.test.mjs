import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { Script } from 'node:vm';
import { FIELD_TEXT, DEFAULT_CONFIG, createConfig } from '../../packages/autocomplete/schema.js';
import { apply } from '../../packages/autocomplete/index.js';

const source = readFileSync(new URL('../../packages/autocomplete/client.js', import.meta.url), 'utf8');
/** Load client.js with a hook-state React and a configurable `(pointer: coarse)` media query. */
function load({ coarse, narrow = false, docked = false }) {
  let hooks, cursor = 0;
  const states = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useRef: initial => ({ current: initial }), useCallback: fn => fn, useEffect() {}, useLayoutEffect() {}, Fragment: 'Fragment',
  };
  const window = { matchMedia: q => ({ matches: (q === '(pointer: coarse)' && coarse) || (q === '(max-width: 359px)' && narrow),
    addEventListener() {}, removeEventListener() {} }),
    __ModuleLoader__: { load: spec => spec.factory(() => React) }, __acTestHook: v => { hooks = v; } };
  // `docked` simulates a confirmation card (.ctm-dock) shown above the composer.
  const dock = { getBoundingClientRect: () => ({ height: 120 }) };
  const document = { hidden: false, body: {}, execCommand() {}, addEventListener() {}, removeEventListener() {}, querySelectorAll: () => (docked ? [dock] : []) };
  class MutationObserver { observe() {} disconnect() {} }
  // Effects run synchronously and, like React, only when their dependencies change.
  const effectDeps = [];
  React.useEffect = (fn, deps) => {
    const i = cursor++;
    const prev = effectDeps[i];
    if (prev && deps && deps.length === prev.length && deps.every((d, k) => Object.is(d, prev[k]))) return;
    effectDeps[i] = deps;
    fn();
  };
  // Inert timers: the auto-request timer must never fire a real request from a unit test.
  new Script(source).runInNewContext({ window, document, MutationObserver, setTimeout: () => 0, clearTimeout() {} });
  const render = (component, props) => { cursor = 0; return component(props); };
  /** Set the prediction state of a component: find its ghost slot by shape, not by position. */
  const setGhost = value => { const i = states.findIndex(s => s && typeof s === 'object' && 'items' in s && 'mode' in s); states[i] = value; };
  return { hooks, render, states, setGhost };
}
const walk = (node, out = []) => {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const n of node) walk(n, out); return out; }
  out.push(node); for (const c of node.children ?? []) walk(c, out); return out;
};
const readyForm = value => ({ getSnapshot: () => ({ status: 'ready', value }) });

test('plugin title and description ship in Chinese and English', () => {
  for (const lang of ['zh', 'en']) {
    const meta = JSON.parse(readFileSync(new URL(`../../packages/autocomplete/locale/${lang}.json`, import.meta.url), 'utf8')).meta;
    assert.ok(meta.title && meta.description, lang);
  }
  const zh = JSON.parse(readFileSync(new URL('../../packages/autocomplete/locale/zh.json', import.meta.url), 'utf8')).meta;
  assert.match(zh.title, /[\u4e00-\u9fff]/);
});

test('every settings field has Chinese and English descriptions and is passed to schema i18n', () => {
  for (const lang of ['zh-CN', 'en-US']) assert.deepEqual(Object.keys(FIELD_TEXT[lang]).sort(), Object.keys(DEFAULT_CONFIG).sort(), lang);
  let messages;
  const node = () => { const n = {}; for (const m of ['default', 'description', 'volatile', 'min', 'max']) n[m] = () => n; return n; };
  createConfig({ object: shape => ({ shape, i18n(m) { messages = m; return this; } }), boolean: node, string: node, natural: node, union: node });
  assert.equal(messages, FIELD_TEXT);
});

test('client dictionaries have identical keys in both languages', () => {
  const { hooks } = load({ coarse: false });
  assert.deepEqual(Object.keys(hooks.zh).sort(), Object.keys(hooks.en).sort());
  assert.match(hooks.zh.barLabel, /[\u4e00-\u9fff]/);
});

test('the endpoint is page-relative so it works through the hub tunnel and any path prefix', () => {
  const { hooks } = load({ coarse: false });
  assert.equal(hooks.ENDPOINT.startsWith('/'), false);
});

test('touch devices get the dock strip and tool-row button, keyboards get ghost text, and the strip can be switched off', () => {
  const touch = load({ coarse: true });
  const props = { sessionId: 's', useSession: s => s({ running: false }) };
  assert.equal(touch.render(touch.hooks.ComposerOverlay, { ...props, form: readyForm({}) }), null, 'no overlay on touch');
  assert.equal(touch.render(touch.hooks.TouchDock, { ...props, form: readyForm({}) }).type, touch.hooks.TouchSuggestionBar);
  assert.equal(touch.render(touch.hooks.TouchAskButton, { ...props, form: readyForm({}) }).props['data-action'], 'suggest');
  assert.equal(touch.render(touch.hooks.ComposerOverlay, { ...props, form: readyForm({ mobileBar: false }) }).type, touch.hooks.GhostOverlay);
  assert.equal(touch.render(touch.hooks.TouchDock, { ...props, form: readyForm({ mobileBar: false }) }), null);
  assert.equal(touch.render(touch.hooks.TouchAskButton, { ...props, form: readyForm({ mobileBar: false }) }), null);
  const desk = load({ coarse: false });
  assert.equal(desk.render(desk.hooks.ComposerOverlay, { ...props, form: readyForm({}) }).type, desk.hooks.GhostOverlay);
  assert.equal(desk.render(desk.hooks.TouchDock, { ...props, form: readyForm({}) }), null);
  assert.equal(desk.render(desk.hooks.TouchAskButton, { ...props, form: readyForm({}) }), null, 'no tool-row button on desktop');
  assert.equal(desk.render(desk.hooks.ComposerOverlay, { ...props, form: readyForm({ enabled: false }) }), null);
});

test('the strip is in normal flow and takes no space until there are suggestions', () => {
  const { hooks, render, setGhost } = load({ coarse: true });
  const props = { sessionId: 's', config: DEFAULT_CONFIG, t: k => k, useInput: sel => sel({ draft: '' }), useSession: sel => sel({ running: false }) };
  assert.equal(render(hooks.TouchSuggestionBar, props), null, 'empty strip renders nothing');
  setGhost({ mode: 'next', items: ['a'], index: 0, stream: '', active: false });
  const style = render(hooks.TouchSuggestionBar, props).props.style;
  assert.equal(style.position, undefined, 'not absolutely positioned, so it cannot cover the composer controls');
  assert.equal(style.overflowX, 'auto');
});

test('the strip lines up with the input box edges, measured from the strip itself', () => {
  const { hooks, render, setGhost } = load({ coarse: true });
  const props = { sessionId: 's', config: DEFAULT_CONFIG, t: k => k, useInput: sel => sel({ draft: '' }), useSession: sel => sel({ running: false }) };
  render(hooks.TouchSuggestionBar, props);
  setGhost({ mode: 'next', items: ['a'], index: 0, stream: '', active: false });
  const tree = render(hooks.TouchSuggestionBar, props);
  assert.ok(tree.props.ref, 'the strip exposes a ref for measuring');
  assert.equal(tree.props.style.marginLeft, '0px', 'margins come from the measured state');
  // Measured on a phone: the dock column starts 56px left of the input box and ends 16px right of it.
  const card = { getBoundingClientRect: () => ({ left: 72, right: 367, width: 295 }) };
  const strip = { parentElement: { querySelector: () => card, parentElement: null }, getBoundingClientRect: () => ({ left: 16, right: 383, width: 367 }) };
  let inset = { left: 0, right: 0 };
  hooks.measureCardInset(strip, update => { inset = update(inset); });
  assert.equal(JSON.stringify(inset), JSON.stringify({ left: 56, right: 16 }));
  // Once aligned, a re-measure is stable (no oscillation between renders).
  const aligned = { parentElement: strip.parentElement, getBoundingClientRect: () => ({ left: 72, right: 367, width: 295 }) };
  const before = inset;
  hooks.measureCardInset(aligned, update => { inset = update(inset); });
  assert.equal(inset, before);
});

test('on narrow screens the ✦ leaves the crowded tool row and appears in the strip only while drafting', () => {
  // Fresh harness per component: hook slots are positional and differ between components.
  const fresh = () => load({ coarse: true, narrow: true });
  const base = { sessionId: 's', config: DEFAULT_CONFIG, t: k => k, useSession: s => s({ running: false }) };
  let h = fresh();
  assert.equal(h.render(h.hooks.TouchAskButton, { ...base, form: readyForm({}) }), null, 'tool row stays untouched');
  h = fresh();
  assert.equal(h.render(h.hooks.TouchSuggestionBar, { ...base, useInput: s => s({ draft: '' }) }), null, 'idle composer stays compact');
  h = fresh();
  const tree = h.render(h.hooks.TouchSuggestionBar, { ...base, useInput: s => s({ draft: 'fix the' }) });
  assert.ok(walk(tree).some(n => n.props?.['data-action'] === 'suggest'));
});

test('multi-agent sessions: suggestions stand down for a docked dispatch card and a read-only teammate view', () => {
  const props = sel => ({ sessionId: 's', config: DEFAULT_CONFIG, t: k => k, useInput: s => s({ draft: '' }), useSession: s => s(sel), form: readyForm({}) });
  const withItems = h => { h.render(h.hooks.TouchSuggestionBar, props({ running: false })); h.setGhost({ mode: 'next', items: ['a'], index: 0, stream: '', active: false }); return h; };
  // Read-only teammate view (a non-continuable subagent address): nothing to fill, nothing to show.
  let h = withItems(load({ coarse: true }));
  assert.equal(h.render(h.hooks.TouchSuggestionBar, props({ running: false, subagent: { address: { mode: 'readonly' } } })), null);
  // A continuable teammate session can be steered, so suggestions stay available there.
  h = withItems(load({ coarse: true }));
  assert.equal(h.render(h.hooks.TouchSuggestionBar, props({ running: false, subagent: { address: { mode: 'continuable' } } })).props.role, 'toolbar');
  // A docked confirmation card above the composer (the capability-team dispatch dock).
  h = withItems(load({ coarse: true, docked: true }));
  assert.equal(h.render(h.hooks.TouchSuggestionBar, props({ running: false })), null);
  h = load({ coarse: true, docked: true });
  h.render(h.hooks.TouchAskButton, props({ running: false })); // first render observes the dock
  assert.equal(h.render(h.hooks.TouchAskButton, props({ running: false })), null, 'no ✦ while a confirmation is open');
});

test('the tool-row button asks the strip of the same session', () => {
  const { hooks } = load({ coarse: true });
  let asked = 0;
  const off = hooks.touchStore('s1').subscribe(() => { asked += 1; });
  hooks.touchStore('s2').ask();
  hooks.touchStore('s1').ask();
  off();
  hooks.touchStore('s1').ask();
  assert.equal(asked, 1);
});

test('tap strip shows tappable chips and inserts without sending', () => {
  const { hooks, render, setGhost } = load({ coarse: true });
  const inserted = [];
  const props = { sessionId: 's', config: DEFAULT_CONFIG, t: k => k, useInput: sel => sel({ draft: '' }), useSession: sel => sel({ running: false }),
    inputActions: { captureInsertion: () => ({ at: 0 }), insertText: (text, span) => { inserted.push([text, span.at]); return true; }, submit() { throw new Error('must not send'); } } };
  render(hooks.TouchSuggestionBar, props);
  setGhost({ mode: 'next', items: ['Run the tests', 'Summarize'], index: 0, stream: '', active: false });
  let tree = render(hooks.TouchSuggestionBar, props);
  assert.equal(tree.props.role, 'toolbar');
  tree = render(hooks.TouchSuggestionBar, props);
  const chips = walk(tree).filter(n => n.props?.['data-action'] === 'accept');
  assert.equal(chips.length, 2);
  assert.ok(chips.every(c => parseInt(c.props.style.minHeight, 10) >= 36), 'touch targets are at least 36px');
  assert.equal(typeof chips[0].props.onMouseDown, 'function', 'chips keep focus so the soft keyboard stays open');
  chips[0].props.onClick();
  assert.deepEqual(inserted, [['Run the tests', 0]]);
});

test('tap bar hides during a running turn and for slash commands', () => {
  const { hooks, render } = load({ coarse: true });
  const base = { sessionId: 's', config: DEFAULT_CONFIG, t: k => k };
  assert.equal(render(hooks.TouchSuggestionBar, { ...base, useInput: s => s({ draft: '' }), useSession: s => s({ running: true }) }), null);
  assert.equal(render(hooks.TouchSuggestionBar, { ...base, useInput: s => s({ draft: '/model' }), useSession: s => s({ running: false }) }), null);
});

test('requests through a hub tunnel or proxy pass when the forwarded host matches the origin', async () => {
  let handler;
  apply({ connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) }, llm: {}, sessions: { get: () => undefined },
    webServer: { register: r => { handler = r.handler; } }, effect: fn => fn() }, {});
  const call = headers => {
    const request = Readable.from([Buffer.from(JSON.stringify({ sessionId: 'missing' }))]);
    Object.assign(request, { method: 'POST', headers: { 'content-type': 'application/json', ...headers } });
    const out = {};
    return handler(request, { on() {}, off() {}, writeHead(s) { out.status = s; }, write() {}, end() {} }).then(() => out.status);
  };
  const tunnel = { host: '127.0.0.1:18885', 'x-forwarded-host': 'box.hub.example.com', origin: 'https://box.hub.example.com' };
  assert.equal(await call(tunnel), 404, 'reaches session lookup instead of being refused as cross-origin');
  assert.equal(await call({ ...tunnel, origin: 'https://evil.example.com' }), 403);
});
