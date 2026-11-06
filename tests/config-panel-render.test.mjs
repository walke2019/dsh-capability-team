// Renders the generated panel (packages/*/client.js) with a fake React: secrets show a state only and clear the
// typed input after saving, locks disable editing, non-secret writes use form.mutate, text comes from dictionaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { build, TARGETS } from '../shared-ui/build.mjs';

globalThis.__panelFetch = async () => ({ ok: false });
function boot(file) {
  let cursor = 0, states = [], effects = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return states[i] ??= { current: initial }; },
    useEffect(fn) { effects.push(fn); },
    useCallback(fn, deps) { const i = cursor++; const prev = states[i]; if (prev && prev.deps.length === deps.length && prev.deps.every((d, n) => Object.is(d, deps[n]))) return prev.fn; states[i] = { fn, deps }; return fn; },
  };
  let plugin, moduleId;
  new Script(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).runInNewContext({ window: { __ModuleLoader__: { load: spec => { moduleId = spec.id; plugin = spec.factory(() => React); } } }, URL, fetch: (...args) => globalThis.__panelFetch(...args) });
  return { plugin, moduleId, React, rerender: () => { cursor = 0; }, runEffects: async () => { const run = effects; effects = []; for (const fn of run) await fn(); }, reset: () => { states = []; cursor = 0; effects = []; } };
}
const walk = (node, out = []) => { if (Array.isArray(node)) node.forEach(n => walk(n, out)); else if (node && typeof node === 'object') { out.push(node); walk(node.children, out); } return out; };
const expand = (node, depth = 6) => {
  if (Array.isArray(node)) return node.map(n => expand(n, depth));
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function' && depth > 0) return expand(node.type({ ...node.props, children: node.children }), depth - 1);
  return { ...node, children: (node.children ?? []).map(c => expand(c, depth)) };
};
const textOf = node => walk(node).flatMap(n => (typeof n.children?.[0] === 'string' ? n.children : [])).join('|');

function mount({ file = 'packages/omni-search/client.js', form, described = {}, manifest, credentials } = {}) {
  const host = boot(file);
  const registered = [], dictionaries = {};
  const t = key => key;
  host.plugin.apply({
    effect: fn => fn(), locale: { register: (ns, dicts) => { Object.assign(dictionaries, dicts); }, bind: () => t },
    slots: { inject: (_n, fn) => fn(), register: (options, component) => registered.push({ options, component }) },
    inject: (names, fn) => { if (names[0] === 'remote.credentials') fn({ remote: { credentials: credentials ?? { describe: async refs => ({ ok: true, value: Object.fromEntries(refs.filter(r => described[r]).map(r => [r, described[r]])) }), set: async () => ({ ok: true }), unset: async () => ({ ok: true }) } }, effect() {} }); if (names[0] === 'configForms') fn({ configForms: null, effect() {} }); },
  });
  const entry = registered[0];
  const props = view => ({ view, form, t });
  return { host, entry, dictionaries, render: view => { host.rerender(); return expand(entry.component(props(view))); } };
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
