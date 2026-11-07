// Renders the generated panel (packages/*/client.js) with a fake React: secrets show a state only and clear the
// typed input after saving, locks disable editing, non-secret writes use form.mutate, text comes from dictionaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { build, TARGETS } from '../shared-ui/build.mjs';

globalThis.__panelFetch = async () => ({ ok: false });
function boot(file) {
  let cursor = 0, states = [], effects = [], cleanups = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return states[i] ??= { current: initial }; },
    useEffect(fn) { effects.push(fn); },
    useCallback(fn, deps) { const i = cursor++; const prev = states[i]; if (prev && prev.deps.length === deps.length && prev.deps.every((d, n) => Object.is(d, deps[n]))) return prev.fn; states[i] = { fn, deps }; return fn; },
  };
  let plugin, moduleId;
  new Script(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).runInNewContext({ setTimeout, clearTimeout, window: { __ModuleLoader__: { load: spec => { moduleId = spec.id; plugin = spec.factory(() => React); } } }, URL, fetch: (...args) => globalThis.__panelFetch(...args) });
  return { plugin, moduleId, React, rerender: () => { cursor = 0; }, runEffects: async () => { const run = effects; effects = []; for (const fn of run) { const cleanup = await fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); } }, unmount: () => { const run = cleanups; cleanups = []; for (const fn of run) fn(); }, reset: () => { states = []; cursor = 0; effects = []; } };
}
const walk = (node, out = []) => { if (Array.isArray(node)) node.forEach(n => walk(n, out)); else if (node && typeof node === 'object') { out.push(node); walk(node.children, out); } return out; };
const expand = (node, depth = 6) => {
  if (Array.isArray(node)) return node.map(n => expand(n, depth));
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function' && depth > 0) return expand(node.type({ ...node.props, children: node.children }), depth - 1);
  return { ...node, children: (node.children ?? []).map(c => expand(c, depth)) };
};
const textOf = node => walk(node).flatMap(n => (typeof n.children?.[0] === 'string' ? n.children : [])).join('|');

function mount({ file = 'packages/omni-search/client.js', form, described = {}, manifest, credentials, configForms = null } = {}) {
  const host = boot(file);
  const registered = [], dictionaries = {}, listeners = [];
  const t = key => key;
  host.plugin.apply({
    effect: fn => fn(), locale: { register: (ns, dicts) => { Object.assign(dictionaries, dicts); }, bind: () => t },
    slots: { inject: (_n, fn) => fn(), register: (options, component) => registered.push({ options, component }) },
    remote: { credentials: credentials ?? { describe: async refs => ({ ok: true, value: Object.fromEntries(refs.filter(r => described[r]).map(r => [r, described[r]])) }), set: async () => ({ ok: true }), unset: async () => ({ ok: true }) }, $on: (event, fn) => { listeners.push([event, fn]); return () => {}; } },
    configForms,
  });
  const entry = registered[0];
  const props = view => ({ view, form, t });
  return { host, entry, dictionaries, emit: (event, ...args) => listeners.filter(([name]) => name === event).forEach(([, fn]) => fn(...args)), render: view => { host.rerender(); return expand(entry.component(props(view))); } };
}
const readyForm = (value = {}, writable = true) => { const writes = []; return { writes, state: { status: 'ready', value, revision: 5, writable }, mutate: async (ops, rev) => { writes.push({ ops, rev }); return true; } }; };

test('memory and search register their bundle keys, the module id equals the package name, and both dictionaries match', () => {
  const memory = mount({ file: 'packages/global-memory/client.js', form: readyForm() });
  const search = mount({ form: readyForm() });
  assert.deepEqual([memory.host.moduleId, memory.entry.options.name, memory.entry.options.key], ['@aiwuk/memory', 'plugins.bundle.config', '@aiwuk/memory']);
  assert.deepEqual([search.host.moduleId, search.entry.options.key], ['@aiwuk/search', '@aiwuk/search']);
  for (const m of [memory, search]) {
    assert.deepEqual(Object.keys(m.dictionaries.en).sort(), Object.keys(m.dictionaries.zh).sort());
    assert.equal(m.dictionaries.en['lock.locked'], 'Managed by AIWUK Mothership');
    assert.equal(m.dictionaries.zh['lock.locked'], '由 AI悟空 母舰托管');
    assert.equal(m.dictionaries.en['lock.default'], 'Default from Mothership');
    assert.equal(m.dictionaries.zh['lock.default'], '母舰默认值');
    assert.equal(m.dictionaries.en['secret.unset'], 'Not set');
    assert.equal(m.dictionaries.en['secret.stored'], 'Set (stored)');
    assert.equal(m.dictionaries.en['secret.env'], 'Set (environment)');
    assert.equal(m.dictionaries.en['secret.managed'], 'Managed by AIWUK Mothership');
  }
  assert.equal(search.dictionaries.zh['ref.OMNI_SEARCH_API_KEY'], '搜索网关密钥');
});

test('summary view is one line of text', () => {
  const m = mount({ form: readyForm({ baseUrl: 'https://s.example.com' }) });
  assert.match(m.render('summary'), /^summary\.configured/);
  assert.equal(typeof m.render('summary'), 'string');
});

test('page: every secret row shows a state and never an input until Set is pressed; no value is rendered', async () => {
  const m = mount({ form: readyForm(), described: { TAVILY_API_KEY: { configured: true, source: 'file', writable: true }, BRAVE_API_KEY: { configured: true, source: 'env', writable: true } } });
  const tree = m.render('page');
  const rows = walk(tree).filter(n => n.props?.['data-field']);
  const secretRows = rows.filter(n => /_KEY$/.test(n.props['data-field']));
  assert.equal(secretRows.length, 6);
  assert.equal(walk(tree).filter(n => n.type === 'input' && n.props.type === 'password').length, 0);
  assert.ok(walk(tree).every(n => n.type !== 'input' || n.props.type !== 'password'));
  // Before describe resolves every state is "unknown", never "set".
  assert.ok(walk(secretRows).filter(n => n.props?.['data-secret-state']).every(n => n.props['data-secret-state'] === 'unknown'));
});

test('secret Set → typed value is cleared after save; the value only travels through credentials.set', async () => {
  const sets = [];
  const credentials = { describe: async () => ({ ok: true, value: {} }), set: async (ref, value) => { sets.push([ref, value]); return { ok: true }; }, unset: async () => ({ ok: true }) };
  const m = mount({ form: readyForm(), credentials });
  let tree = m.render('page');
  const row = tree2 => walk(tree2).find(n => n.props?.['data-field'] === 'TAVILY_API_KEY');
  walk(row(tree)).find(n => n.props?.['data-action'] === 'set-secret').props.onClick();
  tree = m.render('page');
  const input = walk(row(tree)).find(n => n.type === 'input');
  assert.equal(input.props.type, 'password');
  assert.equal(input.props.autoComplete, 'new-password');
  input.props.onChange({ target: { value: 'sk-typed-123' } });
  tree = m.render('page');
  await walk(row(tree)).find(n => n.props?.['data-action'] === 'save-secret').props.onClick();
  assert.deepEqual(sets, [['TAVILY_API_KEY', 'sk-typed-123']]);
  tree = m.render('page');
  assert.equal(walk(tree).filter(n => n.type === 'input' && n.props.type === 'password').length, 0, 'the input is gone after save');
  assert.ok(!JSON.stringify(tree).includes('sk-typed-123'), 'the typed value is not retained anywhere in the rendered tree');
});

test('page with a locked managed ref: read-only field, lock badge, no Set or Clear on the secret', async () => {
  const m = mount({ form: readyForm({ searxngUrl: 'https://mine.example.com' }), described: { TAVILY_API_KEY: { configured: true, source: 'file', writable: true } } });
  // Inject the manifest through fetch by replaying the hook: the panel reads it from the plugin route.
  const wire = { revision: 2, entries: [{ ref: 'TAVILY_API_KEY', locked: true, secret: true }, { ref: 'SEARXNG_URL', locked: true, secret: false }, { ref: 'OMNI_SEARCH_BASE_URL', locked: false, secret: false }] };
  globalThis.__panelFetch = async url => { assert.equal(url, 'api/aiwuk.managed-config.search'); return { ok: true, json: async () => wire }; };
  m.render('page'); await m.host.runEffects(); await new Promise(r => setTimeout(r, 5));
  m.host.rerender();
  const tree = m.render('page');
  const lockedField = walk(tree).find(n => n.props?.['data-field'] === 'searxngUrl');
  assert.equal(walk(lockedField).find(n => n.type === 'input').props.disabled, true);
  assert.deepEqual(walk(lockedField).filter(n => n.props?.['data-lock']).map(n => n.props['data-lock']), ['locked']);
  const defaultField = walk(tree).find(n => n.props?.['data-field'] === 'baseUrl');
  assert.equal(walk(defaultField).find(n => n.type === 'input').props.disabled, false, 'unlocked managed stays editable');
  assert.deepEqual(walk(defaultField).filter(n => n.props?.['data-lock']).map(n => n.props['data-lock']), ['default']);
  const secret = walk(tree).find(n => n.props?.['data-field'] === 'TAVILY_API_KEY');
  assert.equal(walk(secret).some(n => ['set-secret', 'clear-secret'].includes(n.props?.['data-action'])), false);
  assert.ok(walk(secret).some(n => n.props?.['data-secret-state'] === 'managed'));
  delete globalThis.__panelFetch;
});

test('non-secret writes go through form.mutate with the snapshot revision; read-only forms cannot save', async () => {
  const form = readyForm({ baseUrl: 'https://old.example.com' });
  const m = mount({ form });
  let tree = m.render('page');
  walk(tree).find(n => n.props?.['data-field'] === 'baseUrl' && n.props['data-field']) && walk(walk(tree).find(n => n.props?.['data-field'] === 'baseUrl')).find(n => n.type === 'input').props.onChange({ target: { value: 'https://new.example.com' } });
  tree = m.render('page');
  await walk(tree).find(n => n.props?.['data-action'] === 'save').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(form.writes)), [{ ops: [{ op: 'set', path: ['baseUrl'], value: 'https://new.example.com' }], rev: 5 }]);
  const locked = mount({ form: readyForm({}, false) });
  assert.equal(walk(locked.render('page')).find(n => n.props?.['data-action'] === 'save').props.disabled, true);
});

test('no hardcoded colors or raw CJK in the generated clients; only --dsw-* tokens', () => {
  for (const file of ['packages/global-memory/client.js', 'packages/omni-search/client.js', 'packages/autocomplete/client/02c-config-panel.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, `${file}: hardcoded color`);
    assert.doesNotMatch(source, /[\u4e00-\u9fff]/, `${file}: raw CJK`);
    assert.doesNotMatch(source, /prefers-color-scheme/);
    for (const [, token] of source.matchAll(/var\((--[a-z0-9-]+)/g)) assert.match(token, /^--dsw-/);
  }
});

test('generated panel outputs are current with shared-ui sources', async () => {
  assert.deepEqual(await build({ check: true }), [], 'run node shared-ui/build.mjs');
  assert.ok(TARGETS.length >= 3);
});

// A lock that appears while the page is open (the Connector applies it later) must win over the stale first fetch.
const lockWire = refs => ({ revision: 9, entries: refs.map(ref => ({ ref, locked: true, secret: /_KEY$/.test(ref) })) });
const settle = () => new Promise(r => setTimeout(r, 5));

test('a lock applied after the first render drops the field from the mutate ops', async () => {
  let wire = { revision: 1, entries: [] };
  globalThis.__panelFetch = async () => ({ ok: true, status: 200, json: async () => wire });
  try {
    const form = readyForm({ searxngUrl: 'https://old.example.com' });
    const m = mount({ form });
    m.render('page'); await m.host.runEffects(); await settle();
    let tree = m.render('page');
    const input = () => walk(walk(tree).find(n => n.props?.['data-field'] === 'searxngUrl')).find(n => n.type === 'input');
    assert.equal(input().props.disabled, false, 'unlocked at first render');
    input().props.onChange({ target: { value: 'https://mine.example.com' } });
    tree = m.render('page');
    wire = lockWire(['SEARXNG_URL']); // the lock lands after the first render; the page has not re-fetched yet
    await walk(tree).find(n => n.props?.['data-action'] === 'save').props.onClick();
    assert.deepEqual(form.writes, [], 'the locked field is not written (save re-reads the manifest)');
    // The next render shows the lock from the reload that save triggered.
    tree = m.render('page');
    assert.equal(input().props.disabled, true);
  } finally { globalThis.__panelFetch = async () => ({ ok: false }); }
});

test('a lock applied after the first render blocks secret Set and Clear', async () => {
  let wire = { revision: 1, entries: [] };
  globalThis.__panelFetch = async () => ({ ok: true, status: 200, json: async () => wire });
  try {
    const calls = [];
    const credentials = { describe: async () => ({ ok: true, value: { TAVILY_API_KEY: { configured: true, source: 'file', writable: true } } }),
      set: async (...a) => { calls.push(['set', ...a]); return { ok: true }; }, unset: async (...a) => { calls.push(['unset', ...a]); return { ok: true }; } };
    const m = mount({ form: readyForm(), credentials });
    m.render('page'); await m.host.runEffects(); await settle();
    let tree = m.render('page');
    const row = () => walk(tree).find(n => n.props?.['data-field'] === 'TAVILY_API_KEY');
    walk(row()).find(n => n.props?.['data-action'] === 'set-secret').props.onClick();
    tree = m.render('page');
    walk(row()).find(n => n.type === 'input').props.onChange({ target: { value: 'sk-late-lock' } });
    tree = m.render('page');
    wire = lockWire(['TAVILY_API_KEY']);
    await walk(row()).find(n => n.props?.['data-action'] === 'save-secret').props.onClick();
    assert.deepEqual(calls, [], 'Set is refused once the manifest says locked');
    // Clear goes through the same re-check.
    tree = m.render('page');
    wire = { revision: 1, entries: [] };
    await m.host.runEffects(); await settle();
    tree = m.render('page');
    walk(row()).find(n => n.props?.['data-action'] === 'clear-secret').props.onClick();
    tree = m.render('page');
    wire = lockWire(['TAVILY_API_KEY']);
    await walk(row()).find(n => n.props?.['data-action'] === 'confirm-clear').props.onClick();
    assert.deepEqual(calls, [], 'Clear is refused once the manifest says locked');
  } finally { globalThis.__panelFetch = async () => ({ ok: false }); }
});

test('manifest reload keeps the known lock on a transient failure and does not refetch on re-render', async () => {
  let fetches = 0, mode = 'ok';
  globalThis.__panelFetch = async () => { fetches++; if (mode === 'down') throw new Error('offline'); return { ok: true, status: 200, json: async () => lockWire(['SEARXNG_URL']) }; };
  try {
    const form = readyForm({ searxngUrl: 'https://old.example.com' });
    const m = mount({ form });
    m.render('page'); await m.host.runEffects(); await settle();
    const first = fetches;
    for (let i = 0; i < 3; i++) m.render('page'); // re-rendering alone never triggers a fetch (stable callback identity)
    assert.equal(fetches, first);
    mode = 'down';
    let tree = m.render('page');
    walk(walk(tree).find(n => n.props?.['data-field'] === 'searxngUrl')).find(n => n.type === 'input').props.onChange({ target: { value: 'https://mine.example.com' } });
    tree = m.render('page');
    await walk(tree).find(n => n.props?.['data-action'] === 'save').props.onClick();
    assert.deepEqual(form.writes, [], 'a failed refresh keeps the previously known lock');
  } finally { globalThis.__panelFetch = async () => ({ ok: false }); }
});

test('every generated client declares remote.credentials and configForms statically', () => {
  const required = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms'];
  for (const file of ['packages/global-memory/client.js', 'packages/omni-search/client.js', 'packages/autocomplete/client.js']) {
    const { plugin } = boot(file);
    for (const name of required) assert.ok(plugin.inject.includes(name), `${file}: inject lists ${name}`);
  }
  const root = readFileSync(new URL('../client.js', import.meta.url), 'utf8').match(/inject: \[([^\]]*)\]/g) ?? [];
  assert.ok(root.some(list => required.every(name => list.includes(`'${name}'`))), 'root client.js inject lists the required services');
});

test('a secret row leaves "unknown" once ctx.remote.credentials.describe resolves,', async () => {
  const host = mount({ form: readyForm(), described: { TAVILY_API_KEY: { configured: true, source: 'file', writable: true } } });
  assert.ok(host.entry, 'panel registered with services taken directly from ctx');
  host.host.rerender();
  const stateOf = () => walk(host.render('page')).find(n => n.props?.['data-field'] === 'TAVILY_API_KEY');
  assert.equal(walk(stateOf()).find(n => n.props?.['data-secret-state']).props['data-secret-state'], 'unknown');
  await host.host.runEffects(); await settle();
  assert.equal(walk(stateOf()).find(n => n.props?.['data-secret-state']).props['data-secret-state'], 'stored');
});

test('an unlocked managed field shows the "using default" placeholder and never a value', async () => {
  globalThis.__panelFetch = async () => ({ ok: true, status: 200, json: async () => ({ revision: 1, entries: [{ ref: 'OMNI_SEARCH_BASE_URL', locked: false, secret: false }, { ref: 'SEARXNG_URL', locked: true, secret: false }] }) });
  try {
    const m = mount({ form: readyForm() });
    m.render('page'); await m.host.runEffects(); await settle();
    const tree = m.render('page');
    const inputOf = id => walk(walk(tree).find(n => n.props?.['data-field'] === id)).find(n => n.type === 'input');
    assert.equal(inputOf('baseUrl').props.placeholder, 'value.default');
    assert.equal(inputOf('baseUrl').props.value, '');
    assert.equal(inputOf('searxngUrl').props.placeholder, 'value.managed');
    assert.equal(m.dictionaries.en['value.default'], 'Using Mothership default');
    assert.equal(m.dictionaries.zh['value.default'], '使用母舰默认值');
  } finally { globalThis.__panelFetch = async () => ({ ok: false }); }
});

// ---- secret describe robustness: no endless "Checking..." (ticket, absent refs, failure state, auto retry) ----
const secretStates = m => walk(m.render('page')).filter(n => n.props?.['data-secret-state']).map(n => n.props['data-secret-state']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const searchRefs = ['OMNI_SEARCH_API_KEY', 'TAVILY_API_KEY', 'BRAVE_API_KEY', 'SEARXNG_API_KEY', 'JINA_API_KEY', 'OMNI_AUDIO_API_KEY'];

test('a ref missing from a successful describe reply reads as "unset", never "unknown"', async () => {
  const credentials = { describe: async () => ({ ok: true, value: { TAVILY_API_KEY: { configured: true, source: 'file', writable: true } } }), set: async () => ({ ok: true }), unset: async () => ({ ok: true }) };
  const m = mount({ form: readyForm(), credentials });
  m.render('page'); await m.host.runEffects(); await settle();
  const states = secretStates(m);
  assert.equal(states.length, 6);
  assert.deepEqual(states.filter(s => s === 'stored').length, 1);
  assert.equal(states.filter(s => s === 'unset').length, 5);
  assert.ok(!states.includes('unknown'));
});

test('a bare (unwrapped) describe reply and an empty one both settle', async () => {
  for (const reply of [Object.fromEntries(searchRefs.map(r => [r, { configured: false, writable: true }])), {}]) {
    const m = mount({ form: readyForm(), credentials: { describe: async () => reply, set: async () => ({ ok: true }), unset: async () => ({ ok: true }) } });
    m.render('page'); await m.host.runEffects(); await settle();
    assert.deepEqual([...new Set(secretStates(m))], ['unset']);
  }
});

test('a thrown describe is retried once automatically and then settles', async () => {
  let calls = 0;
  const credentials = { describe: async refs => { if (++calls === 1) throw new Error('transport down'); return { ok: true, value: Object.fromEntries(refs.map(r => [r, { configured: false, writable: true }])) }; }, set: async () => ({ ok: true }), unset: async () => ({ ok: true }) };
  const m = mount({ form: readyForm(), credentials });
  m.render('page'); await m.host.runEffects(); await settle();
  assert.ok(secretStates(m).every(s => s === 'unknown'), 'still checking while the retry is pending (not failed yet)');
  await sleep(450);
  assert.equal(calls, 2);
  assert.deepEqual([...new Set(secretStates(m))], ['unset']);
});

test('a persistent failure shows "Could not check" with Retry (no endless Checking), and Retry recovers', async () => {
  let calls = 0, healthy = false;
  const credentials = { describe: async refs => { calls++; if (!healthy) return { ok: false, error: { code: 'gateway/unavailable' } }; return { ok: true, value: Object.fromEntries(refs.map(r => [r, { configured: false, writable: true }])) }; }, set: async () => ({ ok: true }), unset: async () => ({ ok: true }) };
  const m = mount({ form: readyForm(), credentials });
  m.render('page'); await m.host.runEffects(); await sleep(450);
  assert.equal(calls, 2, 'one attempt plus exactly one automatic retry');
  assert.deepEqual([...new Set(secretStates(m))], ['failed']);
  let tree = m.render('page');
  const textOf1 = walk(tree).find(n => n.props?.['data-secret-state'] === 'failed').children.join('');
  assert.equal(textOf1, 'secret.failed');
  const retry = walk(tree).filter(n => n.props?.['data-action'] === 'retry-secret');
  assert.equal(retry.length, 6);
  assert.equal(walk(tree).find(n => n.props?.['data-action'] === 'retry-secret').children.join(''), 'action.retry');
  await sleep(450); assert.equal(calls, 2, 'no further automatic retries');
  healthy = true;
  await retry[0].props.onClick(); await settle();
  assert.deepEqual([...new Set(secretStates(m))], ['unset']);
});

test('a missing credentials service fails fast into "Could not check"', async () => {
  const m = mount({ form: readyForm() });
  m.render('page'); // services.credentials exists here; emulate the host losing it
  const credentialsGone = mount({ form: readyForm(), credentials: { set: async () => ({ ok: true }) } }); // no describe API
  credentialsGone.render('page'); await credentialsGone.host.runEffects(); await sleep(450);
  assert.deepEqual([...new Set(secretStates(credentialsGone))], ['failed']);
});

test('a stale describe result never overwrites a newer one (ticket counter)', async () => {
  const resolvers = [];
  const credentials = { describe: refs => { const configured = resolvers.length === 0; return new Promise(resolve => resolvers.push(() => resolve({ ok: true, value: Object.fromEntries(refs.map(r => [r, { configured, source: 'file', writable: true }])) }))); }, set: async () => ({ ok: true }), unset: async () => ({ ok: true }) };
  const m = mount({ form: readyForm(), credentials });
  m.render('page'); await m.host.runEffects(); // run 1 in flight
  m.emit('credentials/reference-updated', 'TAVILY_API_KEY'); // run 2 starts
  await settle();
  assert.equal(resolvers.length, 2);
  // Re-describe settles first (not configured) ...
  const [first, second] = resolvers;
  second(); await settle();
  assert.deepEqual([...new Set(secretStates(m))], ['unset']);
  // ... then the older describe lands late with an outdated "configured" view and is ignored.
  first(); await settle();
  assert.deepEqual([...new Set(secretStates(m))], ['unset'], 'late stale result is dropped');
});

test('a describe that lands after unmount is ignored and its retry timer is cancelled', async () => {
  let release, calls = 0;
  const credentials = { describe: refs => { calls++; return new Promise(resolve => { release = () => resolve({ ok: true, value: Object.fromEntries(refs.map(r => [r, { configured: true, source: 'file', writable: true }])) }); }); }, set: async () => ({ ok: true }), unset: async () => ({ ok: true }) };
  const m = mount({ form: readyForm(), credentials });
  m.render('page'); await m.host.runEffects();
  m.host.unmount();
  release(); await settle();
  assert.ok(secretStates(m).every(s => s === 'unknown'), 'nothing was written after unmount');
  const failing = mount({ form: readyForm(), credentials: { describe: async () => { throw new Error('x'); }, set: async () => ({ ok: true }), unset: async () => ({ ok: true }) } });
  failing.render('page'); await failing.host.runEffects(); failing.host.unmount(); await sleep(450);
  assert.ok(secretStates(failing).every(s => s === 'unknown'), 'the cancelled retry did not run');
});

// ---- web search provider selection on the host `web` entry (another namespace) ----
function webForm(value = { searchProvider: 'deepseek-official' }, extra = {}) {
  const calls = [], listeners = new Set();
  const form = { calls, snapshot: { status: 'ready', value, revision: 7, writable: true, ...extra },
    getSnapshot() { return form.snapshot; }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async mutate(ops, rev) { calls.push({ ops, rev }); return true; } };
  return { form, forms: { get: id => { calls.push({ get: id }); return form; } } };
}
const hostRow = m => walk(m.render('page')).find(n => n.props?.['data-field'] === 'host.webSearch');
const hostSwitch = m => walk(hostRow(m)).find(n => n.type === 'input');

test('search panel offers a switch that selects aiwuk-search on the host web entry, and unsets it to restore the default', async () => {
  const { form, forms } = webForm();
  const m = mount({ form: readyForm(), configForms: forms });
  assert.ok(form && forms);
  assert.equal(hostSwitch(m).props.checked, false);
  assert.equal(hostSwitch(m).props['data-host-selection'], 'off');
  assert.equal(m.dictionaries.en['host.webSearch.label'], 'Use AIWUK Search for DSH web search');
  assert.equal(m.dictionaries.zh['host.webSearch.label'], '让 DSH 网页搜索使用 AI悟空 全能搜索');
  hostSwitch(m).props.onChange({ target: { checked: true } }); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(form.calls.filter(c => c.ops))), [{ ops: [{ op: 'set', path: ['searchProvider'], value: 'aiwuk-search' }], rev: 7 }]);
  assert.ok(form.calls.some(c => c.get === 'web'), 'the form of the host `web` entry is used');
  form.snapshot = { ...form.snapshot, value: { searchProvider: 'aiwuk-search' }, revision: 8 };
  assert.equal(hostSwitch(m).props.checked, true);
  hostSwitch(m).props.onChange({ target: { checked: false } }); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(form.calls.filter(c => c.ops).at(-1))), { ops: [{ op: 'unset', path: ['searchProvider'] }], rev: 8 });
});

test('the current host selection is shown, including the automatic case and an unavailable web namespace', () => {
  const current = key => walk(hostRow(key)).filter(n => typeof n.children?.[0] === 'string').map(n => n.children[0]).join('|');
  const named = mount({ form: readyForm(), configForms: webForm({ searchProvider: 'deepseek-official' }).forms });
  assert.match(current(named), /host\.webSearch\.current/);
  const unavailable = webForm(undefined, { status: 'unavailable', value: undefined, writable: false });
  const m = mount({ form: readyForm(), configForms: unavailable.forms });
  assert.equal(hostSwitch(m).props.disabled, true);
  assert.match(current(m), /host\.webSearch\.unavailable/);
  const noForms = mount({ form: readyForm(), configForms: null });
  assert.equal(hostSwitch(noForms).props.disabled, true, 'no configForms service: read-only, no crash');
});

test('a refused or failing host write shows an error and does not claim success; other panels have no such row', async () => {
  const { form, forms } = webForm();
  form.mutate = async () => { throw new Error('offline'); };
  const m = mount({ form: readyForm(), configForms: forms });
  hostSwitch(m).props.onChange({ target: { checked: true } }); await settle();
  assert.ok(walk(hostRow(m)).some(n => n.props?.role === 'alert'));
  assert.ok(!walk(hostRow(m)).some(n => n.props?.role === 'status'));
  const memory = mount({ file: 'packages/global-memory/client.js', form: readyForm(), configForms: webForm().forms });
  assert.equal(hostRow(memory), undefined);
});
