import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

// Loads the built client.js with a fake host that records every slot registration.
function load({ pluginManager, configForms, fetch } = {}) {
  let plugin, cursor = 0, states = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return states[i] ??= { current: initial }; },
    useEffect() {}, useMemo: fn => fn(), Fragment: Symbol.for('react.fragment'),
    Component: class { constructor(props) { this.props = props; } },
  };
  new Script(readFileSync(new URL('../client.js', import.meta.url), 'utf8')).runInNewContext({ window: { __ModuleLoader__: { load: spec => { plugin = spec.factory(() => React); } } }, fetch, AbortController });
  const registered = [];
  const slots = { inject: (_n, fn) => fn(), register: (options, component) => { registered.push({ options, component }); } };
  const services = { 'remote.pluginManager': pluginManager && { slots, remote: { pluginManager }, effect() {} }, configForms: configForms && { slots, configForms, effect() {} } };
  plugin.apply({ effect() {}, locale: { bind: () => k => k, register() {} }, remote: { commands: {} }, slots,
    inject: (names, fn) => { const scoped = services[names[0]]; if (scoped) fn(scoped); } });
  const slot = (name, key) => registered.find(r => r.options.name === name && (r.options.key ?? r.options.id) === key);
  const render = (component, props) => { cursor = 0; return component(props); };
  const reset = () => { states = []; cursor = 0; };
  return { slot, render, reset, registered };
}
const flat = (node, out = []) => { if (Array.isArray(node)) node.forEach(n => flat(n, out)); else if (node && typeof node === 'object') { out.push(node); flat(node.children, out); } return out; };
const textOf = node => flat(node).flatMap(n => n.children ?? []).filter(c => typeof c === 'string').join(' ');
const expand = (tree, depth = 3) => { // render nested function components so their markup is inspectable
  if (Array.isArray(tree)) return tree.map(n => expand(n, depth));
  if (!tree || typeof tree !== 'object') return tree;
  if (typeof tree.type === 'function' && depth > 0) return expand(tree.type({ ...tree.props }), depth - 1);
  return { ...tree, children: (tree.children ?? []).map(c => expand(c, depth)) };
};

test('activation card warns about profile-wide effect and only enables after the click; applied / restart / failed', async () => {
  const calls = [];
  let answer = { ok: true, value: { application: 'applied' } };
  const pluginManager = {
    listBundles: async () => { calls.push('list'); return { ok: true, value: [{ name: '@deepseek-ai/dsh-experimental-agent-team-profile', availability: 'installation', enabled: false }] }; },
    setBundleEnabled: async (name, enabled) => { calls.push(['set', name, enabled]); return answer; },
  };
  const h = load({ pluginManager });
  const entry = h.slot('plugins.bundle.activation', '@aiwuk/team');
  assert.ok(entry);
  const card = expand(h.render(entry.component, { onDismiss() {} }));
  assert.match(textOf(card), /onb\.teamWarning/);
  assert.deepEqual(calls, []); // rendering never touches the plugin manager
  const button = flat(card).find(n => n.props?.['data-action'] === 'enable-agent-teams');
  const run = async () => { h.reset(); const tree = expand(h.render(entry.component, {})); const btn = flat(tree).find(n => n.props?.['data-action'] === 'enable-agent-teams'); await btn.props.onClick(); return expand(h.render(entry.component, {})); };
  assert.ok(button);
  let after = await run();
  assert.deepEqual(calls, ['list', ['set', '@deepseek-ai/dsh-experimental-agent-team-profile', true]]);
  assert.equal(flat(after).find(n => n.props?.['data-outcome'])?.props['data-outcome'], 'applied');
  answer = { ok: true, value: { application: 'restart-required', restartReason: 'no-hmr' } };
  after = await run();
  assert.match(textOf(after), /onb\.restart/);
  answer = { ok: true, value: { application: 'failed', error: { code: 'incompatible-version' } } };
  after = await run();
  const failed = flat(after).find(n => n.props?.['data-outcome'] === 'failed');
  assert.ok(failed);
  answer = { ok: false, error: { code: 'FORBIDDEN' } };
  assert.equal(flat(await run()).find(n => n.props?.['data-outcome'])?.props['data-outcome'], 'failed');
});

test('without a plugin manager the click reports a failure code instead of acting', async () => {
  const h = load();
  const entry = h.slot('plugins.bundle.activation', '@aiwuk/team');
  const btn = flat(expand(h.render(entry.component, {}))).find(n => n.props?.['data-action'] === 'enable-agent-teams');
  await btn.props.onClick();
  assert.match(textOf(expand(h.render(entry.component, {}))), /onb\.failed/);
});

test('the old key-name editor is gone; the team bundle only registers its integrations summary', () => {
  const h = load({ configForms: { get: () => ({ getSnapshot: () => ({ status: 'ready', value: {} }), subscribe: () => () => {} }) } });
  const keys = h.registered.filter(r => r.options.name === 'plugins.bundle.config').map(r => r.options.key);
  assert.deepEqual(keys, ['@aiwuk/team'], 'Memory and Search ship their own panels in their own bundles');
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /tavilyKeyEnv|BundleSettingsCard|cfg\.hint/);
});

function fakeForm(value, writable = true) {
  const writes = [];
  return { writes, getSnapshot: () => ({ status: 'ready', value, revision: 3, writable }), subscribe: () => () => {},
    mutate: async (ops, revision) => { writes.push({ ops, revision }); return true; }, set: async (field, v) => { writes.push({ set: field, v }); return true; } };
}

test('welcome step persists its acknowledgement and completes; acknowledged steps render nothing', async () => {
  const form = fakeForm({});
  const fetch = async () => ({ ok: true, json: async () => ({ teamServicePresent: true, coverage: { known: true, covered: 7, capabilities: 7, models: 9, unassigned: [] } }) });
  const h = load({ configForms: { get: () => form }, fetch });
  const entry = h.slot('settings.onboarding', 'capability-team-welcome');
  assert.ok(entry);
  let completed = 0;
  const props = { complete: () => { completed++; } };
  assert.equal(h.render(entry.component, props).type({ ...h.render(entry.component, props).props }), null); // status still loading
  const done = fakeForm({ welcomeVersion: '4.0.0' });
  const h2 = load({ configForms: { get: () => done }, fetch });
  const welcome = h2.render(h2.slot('settings.onboarding', 'capability-team-welcome').component, props);
  assert.equal(welcome.type({ ...welcome.props }), null);
  assert.equal(completed, 0);
});

test('single-model badge on team tool cards and role cards', () => {
  const h = load();
  const reg = h.registered.find(r => r.options.key === 'capability_team_read');
  const result = JSON.stringify({ revision: 1, effective: { name: 'x' }, roles: [{ id: 'backend', provider: 'only', model: 'one', singleModel: true, fallbacks: [] }, { id: 'qa', provider: 'p', model: 'm', fallbacks: [] }] });
  const block = { kind: 'tool-result', call: { argsRaw: '{}' }, content: [{ type: 'text', text: result }] };
  const wrapper = h.render(reg.component, { t: k => k, block });
  const card = wrapper.type(wrapper.props); // withT wrapper → TeamView output: the Card element
  const all = flat(card.props.body);
  assert.equal(all.filter(n => n.props?.['data-single-model'] !== undefined).length, 1);
});
