import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { Script } from 'node:vm';
import { FIELD_TEXT, DEFAULT_CONFIG, createConfig } from '../../packages/autocomplete/schema.js';
import { apply } from '../../packages/autocomplete/index.js';

const source = readFileSync(new URL('../../packages/autocomplete/client.js', import.meta.url), 'utf8');
/** Load client.js with a hook-state React and a configurable `(pointer: coarse)` media query. */
function load({ coarse }) {
  let hooks, cursor = 0;
  const states = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useRef: initial => ({ current: initial }), useCallback: fn => fn, useEffect() {}, useLayoutEffect() {}, Fragment: 'Fragment',
  };
  const window = { matchMedia: q => ({ matches: q === '(pointer: coarse)' && coarse, addEventListener() {}, removeEventListener() {} }),
    __ModuleLoader__: { load: spec => spec.factory(() => React) }, __acTestHook: v => { hooks = v; } };
  new Script(source).runInNewContext({ window, document: { hidden: false, execCommand() {}, addEventListener() {}, removeEventListener() {} } });
  return { hooks, render: (component, props) => { cursor = 0; return component(props); }, states };
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

test('touch devices get the tap bar, keyboards get ghost text, and the bar can be switched off', () => {
  const touch = load({ coarse: true });
  assert.equal(touch.render(touch.hooks.ComposerOverlay, { sessionId: 's', form: readyForm({}) }).type, touch.hooks.TouchSuggestionBar);
  assert.equal(touch.render(touch.hooks.ComposerOverlay, { sessionId: 's', form: readyForm({ mobileBar: false }) }).type, touch.hooks.GhostOverlay);
  const desk = load({ coarse: false });
  assert.equal(desk.render(desk.hooks.ComposerOverlay, { sessionId: 's', form: readyForm({}) }).type, desk.hooks.GhostOverlay);
  assert.equal(desk.render(desk.hooks.ComposerOverlay, { sessionId: 's', form: readyForm({ enabled: false }) }), null);
});

test('tap bar shows a suggest button, tappable chips and inserts without sending', () => {
  const { hooks, render, states } = load({ coarse: true });
  const inserted = [];
  const props = { sessionId: 's', config: DEFAULT_CONFIG, t: k => k, useInput: sel => sel({ draft: '' }), useSession: sel => sel({ running: false }),
    inputActions: { captureInsertion: () => ({ at: 0 }), insertText: (text, span) => { inserted.push([text, span.at]); return true; }, submit() { throw new Error('must not send'); } } };
  let tree = render(hooks.TouchSuggestionBar, props);
  assert.equal(tree.props.role, 'toolbar');
  assert.ok(walk(tree).some(n => n.props?.['data-action'] === 'suggest'));
  states[0] = { mode: 'next', items: ['Run the tests', 'Summarize'], index: 0, stream: '', active: false };
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
