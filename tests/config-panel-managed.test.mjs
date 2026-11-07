// Mothership-configured panels: the route carries values for non-secret refs only, the panel shows a "configured by
// the Mothership" banner, displays the managed values in locked fields and folds unmanaged integration fields away.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { handleManagedConfig } from '../managed-config-route.js';
import { handleManagedConfig as handleAutocomplete } from '../packages/autocomplete/managed-route.js';
import { managedValues } from '../shared/managed-config.js';
import { managedStatus, managedValueOf, manifestFromWire } from '../shared-ui/config-logic.js';
import { PANELS } from '../shared-ui/fields.js';

const payload = { revision: 4, entries: [
  { ref: 'OMNI_SEARCH_BASE_URL', locked: true, secret: false }, { ref: 'OMNI_SEARCH_ENGINES', locked: true, secret: false },
  { ref: 'OMNI_SEARCH_API_KEY', locked: true, secret: true }, { ref: 'SNEAKY_TOKEN', locked: true, secret: false },
] };
const store = { OMNI_SEARCH_BASE_URL: 'https://gateway.example.com', OMNI_SEARCH_ENGINES: 'custom', OMNI_SEARCH_API_KEY: 'sk-never-leak', SNEAKY_TOKEN: 'tok-never-leak' };
const resolved = [];
const credentials = { readRecord: async () => ({ kind: 'grant', payload }), resolve: async ref => { resolved.push(ref); return store[ref] ? { value: store[ref], source: 'file' } : undefined; } };
const get = () => new Request('http://dsh.internal/api/aiwuk.managed-config.search', { headers: { host: 'h' } });

test('route: non-secret managed refs carry their value; secrets and forced-secret names are never read or sent', async () => {
  resolved.length = 0;
  const body = await (await handleManagedConfig({ credentials }, get(), { home: '/nonexistent' })).json();
  const byRef = Object.fromEntries(body.entries.map(e => [e.ref, e]));
  assert.equal(byRef.OMNI_SEARCH_BASE_URL.value, 'https://gateway.example.com');
  assert.equal(byRef.OMNI_SEARCH_ENGINES.value, 'custom');
  assert.equal(byRef.OMNI_SEARCH_API_KEY.value, undefined);
  assert.equal(byRef.SNEAKY_TOKEN.secret, true, 'a forced-secret name is secret whatever the manifest says');
  assert.equal(byRef.SNEAKY_TOKEN.value, undefined);
  assert.ok(!resolved.includes('OMNI_SEARCH_API_KEY') && !resolved.includes('SNEAKY_TOKEN'), 'secret values are never even resolved');
  assert.ok(!JSON.stringify(body).includes('never-leak'));
});

test('autocomplete route follows the same rule', async () => {
  const auto = { revision: 1, entries: [{ ref: 'AUTOCOMPLETE_MODEL', locked: true, secret: false }, { ref: 'AUTOCOMPLETE_API_KEY', locked: true, secret: false }] };
  const creds = { readRecord: async () => ({ kind: 'grant', payload: auto }), resolve: async ref => ({ value: ref === 'AUTOCOMPLETE_MODEL' ? 'model-x' : 'sk-never-leak' }) };
  const body = await (await handleAutocomplete(creds, get(), { home: '/nonexistent' })).json();
  assert.deepEqual(body.entries, [{ ref: 'AUTOCOMPLETE_API_KEY', locked: true, secret: true }, { ref: 'AUTOCOMPLETE_MODEL', locked: true, secret: false, value: 'model-x' }]);
});

test('managedValues: no store, failing lookups and over-long values are left out', async () => {
  const manifest = { revision: 1, entries: new Map([['A_URL', { locked: true, secret: false }], ['B_URL', { locked: false, secret: false }], ['C_URL', { locked: true, secret: false }]]) };
  assert.deepEqual(await managedValues(undefined, manifest), {});
  const values = await managedValues({ resolve: async ref => { if (ref === 'B_URL') throw new Error('x'); return { value: ref === 'C_URL' ? 'x'.repeat(600) : 'https://a.example.com' }; } }, manifest);
  assert.deepEqual(values, { A_URL: 'https://a.example.com' });
});

test('wire parsing keeps a value only for non-secret entries; status counts managed and locked panel fields', () => {
  const m = manifestFromWire({ revision: 2, entries: [{ ref: 'OPENVIKING_URL', locked: true, secret: false, value: 'https://m.example.com' }, { ref: 'OPENVIKING_API_KEY', locked: true, secret: true, value: 'sk-leak' }] });
  assert.equal(managedValueOf(m, 'OPENVIKING_URL'), 'https://m.example.com');
  assert.equal(managedValueOf(m, 'OPENVIKING_API_KEY'), undefined);
  assert.deepEqual(managedStatus(PANELS.memory.fields, null), { managed: 0, locked: 0, total: 6, mode: 'none' });
  assert.deepEqual(managedStatus(PANELS.memory.fields, m), { managed: 2, locked: 2, total: 6, mode: 'partial' });
});

// Fake React host (same approach as config-panel-render.test.mjs).
function mountSearch(wire) {
  let cursor = 0; const states = []; const effects = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return states[i] ??= { current: initial }; },
    useEffect(fn) { effects.push(fn); },
    useCallback(fn, deps) { const i = cursor++; const prev = states[i]; if (prev && prev.deps.length === deps.length && prev.deps.every((d, n) => Object.is(d, deps[n]))) return prev.fn; states[i] = { fn, deps }; return fn; },
  };
  let plugin;
  const fetch = async () => ({ ok: true, json: async () => wire });
  new Script(readFileSync(new URL('../packages/omni-search/client.js', import.meta.url), 'utf8')).runInNewContext({ setTimeout, clearTimeout, URL, fetch, window: { __ModuleLoader__: { load: spec => { plugin = spec.factory(() => React); } } } });
  const registered = [];
  plugin.apply({ effect: fn => fn(), locale: { register: () => {}, bind: () => key => key }, slots: { inject: (_n, fn) => fn(), register: (o, c) => registered.push(c) },
    remote: { credentials: { describe: async () => ({ ok: true, value: {} }), set: async () => ({ ok: true }), unset: async () => ({ ok: true }) }, $on: () => () => {} }, configForms: null });
  const form = { state: { status: 'ready', value: {}, revision: 1, writable: true }, mutate: async () => true };
  const expand = node => (Array.isArray(node) ? node.map(expand) : !node || typeof node !== 'object' ? node
    : typeof node.type === 'function' ? expand(node.type({ ...node.props, children: node.children })) : { ...node, children: (node.children ?? []).map(expand) });
  const render = () => { cursor = 0; return expand(registered[0]({ view: 'page', form, t: key => key })); };
  return { render, runEffects: async () => { for (const fn of effects.splice(0)) await fn(); await new Promise(r => setTimeout(r, 5)); } };
}
const walk = (node, out = []) => { if (Array.isArray(node)) node.forEach(n => walk(n, out)); else if (node && typeof node === 'object') { out.push(node); walk(node.children, out); } return out; };

test('panel: banner, managed values shown read-only, unmanaged integration fields folded into an optional group', async () => {
  const wire = { revision: 3, entries: [
    { ref: 'OMNI_SEARCH_BASE_URL', locked: true, secret: false, value: 'https://gateway.example.com' },
    { ref: 'OMNI_SEARCH_ENGINES', locked: true, secret: false, value: 'custom' },
    { ref: 'OMNI_SEARCH_API_KEY', locked: true, secret: true },
  ] };
  const m = mountSearch(wire);
  m.render(); await m.runEffects();
  const tree = m.render();
  const banner = walk(tree).find(n => n.props?.['data-managed-banner']);
  assert.equal(banner.props['data-managed-banner'], 'partial');
  const base = walk(tree).find(n => n.props?.['data-field'] === 'baseUrl');
  const input = walk(base).find(n => n.type === 'input');
  assert.equal(input.props.value, 'https://gateway.example.com');
  assert.equal(input.props.disabled, true);
  const engines = walk(walk(tree).find(n => n.props?.['data-field'] === 'engines')).filter(n => n.type === 'input');
  assert.deepEqual(engines.filter(n => n.props.checked).map(n => n.props.name), ['engines.custom']);
  const optional = walk(tree).find(n => n.type === 'details');
  const folded = walk(optional).filter(n => n.props?.['data-field']).map(n => n.props['data-field']);
  assert.ok(folded.includes('TAVILY_API_KEY') && folded.includes('searxngUrl') && !folded.includes('baseUrl'));
  assert.ok(!folded.includes('OMNI_SEARCH_API_KEY'), 'managed secrets stay in the main list');
});

test('panel without a Mothership shows no banner and no optional group', async () => {
  const m = mountSearch({ revision: 0, entries: [] });
  m.render(); await m.runEffects();
  const tree = m.render();
  assert.equal(walk(tree).some(n => n.props?.['data-managed-banner']), false);
  assert.equal(walk(tree).some(n => n.type === 'details'), false);
});
