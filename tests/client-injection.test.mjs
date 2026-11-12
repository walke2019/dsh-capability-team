import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { buildClient } from '../scripts/build-client.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const source = await buildClient(); // Assemble in memory only; never rewrite the generated bundle.
function loadPlugin() {
  let plugin;
  new Script(source).runInNewContext({ window: { __ModuleLoader__: { load(spec) {
    plugin = spec.factory(() => ({ createElement() {} }));
  } } }, document: {
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { appendChild() {} }, documentElement: { dataset: {} },
  } });
  return plugin;
}

test('uiSession has both service authorization and explicit client package metadata', () => {
  assert.ok(loadPlugin().inject.includes('uiSession'));
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-session'));
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-client-ui-session'], '>=0.2.2-rc.1');
  assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh-client-ui-session'].optional, true);
});

// Strict access proxy is mandatory in ordinary CI; the installed Cordis test below is opt-in.
function services(views) {
  const store = { getSnapshot: () => ({}), subscribe: () => () => {} };
  return {
    slots: { inject: (_name, fn) => fn(), register(options) { views.push(options); return () => {}; } },
    locale: { register: () => () => {}, bind: () => key => key },
    remote: { commands: {}, credentials: {}, $on: () => () => {} },
    'remote.commands': {}, 'remote.credentials': {},
    configForms: {}, sidebarRightTabs: { register: () => () => {} },
    sessions: { list: store }, uiSession: { sessionStatus: { ...store, getSnapshot: () => new Map() } }, uiWorkspace: {},
  };
}
function strictActivation(plugin) {
  const views = [], values = services(views), cleanups = [];
  const base = { effect(fn) { const off = fn(); if (typeof off === 'function') cleanups.push(off); }, on: () => () => {}, inject: () => {} };
  const ctx = new Proxy(base, { get(target, name) {
    if (name in target) return target[name];
    if (!plugin.inject.includes(name)) throw new Error(`cannot get property "${String(name)}" without inject`);
    return values[name];
  } });
  try { plugin.apply(ctx); } finally { for (const off of cleanups.reverse()) off(); }
  return views;
}
test('strict activation registers the overview and tool cards only with declared uiSession', () => {
  const plugin = loadPlugin();
  const views = strictActivation(plugin);
  assert.ok(views.some(view => view.id === 'capability-team-overview'));
  assert.ok(views.some(view => view.name === 'tool.call.toolview'));
  assert.throws(() => strictActivation({ ...plugin, inject: plugin.inject.filter(name => name !== 'uiSession') }), /uiSession.*without inject/);
});

const cordisEntry = process.env.DSH_CORDIS_ENTRY;
const nativeTest = cordisEntry ? test : test.skip;
nativeTest('real Cordis denies undeclared optional access and activates the declared client', async () => {
  const { Context } = await import(pathToFileURL(cordisEntry).href);
  const root = new Context(), views = [], values = services(views);
  // Services must be provided by a sibling plugin, not root: root provisions are inherited authority.
  const provider = root.plugin({ apply(ctx) { for (const [name, value] of Object.entries(values)) ctx.provide(name, value); } });
  await provider;
  try {
    const plugin = loadPlugin();
    const missing = root.plugin({ ...plugin, inject: plugin.inject.filter(name => name !== 'uiSession') });
    await assert.rejects(async () => { await missing; }, /cannot get property "uiSession" without inject/);
    await missing.dispose();
    const active = root.plugin(plugin);
    await active;
    assert.ok(views.some(view => view.id === 'capability-team-overview'));
    assert.ok(views.some(view => view.name === 'tool.call.toolview'));
    await active.dispose();
  } finally { await provider.dispose(); await root.fiber.dispose(); }
});
