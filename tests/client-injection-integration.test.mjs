import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const entry = process.env.DSH_CORDIS_ENTRY;
test('generated client activates through real sibling-scoped Cordis injection and cleans up', { skip: !entry }, async () => {
  const { Context } = await import(pathToFileURL(entry).href);
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  let plugin;
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(spec) { plugin = spec.factory(() => ({ createElement() {} })); } } },
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} }, documentElement: { dataset: {} } },
  });
  const root = new Context(), views = new Map(), tabs = new Set();
  let subscriptions = 0;
  const subscribe = () => { subscriptions++; return () => subscriptions--; };
  const store = { getSnapshot: () => ({ ids: [], byId: {} }), subscribe };
  const values = {
    slots: { inject: (_name, fn) => fn(), register(options) { const key = `${options.name}:${options.id ?? options.key}`; views.set(key, options); return () => views.delete(key); } },
    locale: { register: () => () => {}, bind: () => key => key },
    remote: { commands: {}, credentials: {}, $on: subscribe }, 'remote.commands': {}, 'remote.credentials': {},
    configForms: {}, sidebarRightTabs: { register(row) { tabs.add(row.id); return () => tabs.delete(row.id); } },
    sessions: { list: store }, uiWorkspace: {}, uiSession: { sessionStatus: { getSnapshot: () => new Map(), subscribe } },
  };
  const provider = root.plugin({ apply(ctx) { for (const [name, value] of Object.entries(values)) ctx.provide(name, value); } });
  await provider.await();
  try {
    const broken = root.plugin({ ...plugin, inject: plugin.inject.filter(name => name !== 'uiSession') });
    await assert.rejects(broken.await(), /cannot get property "uiSession" without inject/);
    await broken.dispose();
    const active = root.plugin(plugin);
    await active.await();
    assert.ok(tabs.has('capability-team-overview'));
    assert.ok([...views.values()].some(row => row.id === 'capability-team-overview'));
    assert.ok([...views.values()].some(row => row.id === 'capability-team-confirm'));
    assert.equal([...views.values()].filter(row => row.name === 'tool.call.toolview').length, 16);
    assert.ok(subscriptions > 0, 'native stores and remote events are actually subscribed');
    await active.dispose();
    assert.equal(subscriptions, 0);
    assert.equal(tabs.size, 0);
  } finally { await provider.dispose(); await root.fiber.dispose(); }
});
