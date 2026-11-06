import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { buildClient } from '../../packages/autocomplete/scripts/build-client.mjs';

const source = readFileSync(new URL('../../packages/autocomplete/client.js', import.meta.url), 'utf8');
function load() {
  let plugin, hooks;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: initial => ({ current: initial }), useCallback: fn => fn, useEffect() {}, useLayoutEffect() {}, Fragment: 'Fragment',
  };
  const window = { __ModuleLoader__: { load: spec => { assert.equal(spec.id, 'dsh-capability-autocomplete'); plugin = spec.factory(() => React); } },
    __acTestHook: value => { hooks = value; } };
  new Script(source).runInNewContext({ window });
  return { plugin, hooks };
}

test('client.js is current with client/ fragments', async () => {
  assert.equal(source, await buildClient());
});

test('registers the composer overlay, settings row and bundle config card', () => {
  const { plugin } = load();
  const registered = [];
  let dictionaries;
  plugin.apply({
    locale: { register: (ns, dicts) => { dictionaries = dicts; }, bind: () => key => key },
    effect: fn => fn(),
    inject: (names, fn) => fn({ configForms: { get: name => ({ name }) }, effect() {} }),
    slots: { inject: (_n, fn) => fn(), register: (meta, component) => registered.push({ meta, component }) },
  });
  assert.deepEqual(registered.map(r => r.meta.name), ['conversation.input.overlay', 'conversation.input.dock', 'conversation.input.right',
    'settings.general.item', 'plugins.bundle.config']);
  assert.equal(registered[4].meta.key, '@aiwuk/autocomplete');
  assert.deepEqual(Object.keys(dictionaries.zh).sort(), Object.keys(dictionaries.en).sort());
  assert.equal(registered[0].component({ sessionId: 's' }).props.form.name, 'autocomplete');
});

test('helpers parse SSE frames, detect trigger tokens and merge ready config', () => {
  const { hooks } = load();
  assert.equal(JSON.stringify(hooks.parseSse('event: done\ndata: {"suggestions":["a"]}\n\nevent: x\ndata: {bad\n\n')), JSON.stringify([{ suggestions: ['a'], type: 'done' }]));
  assert.equal(hooks.isTriggerToken('run /dep'), true);
  assert.equal(hooks.isTriggerToken('see @"file'), true);
  assert.equal(hooks.isTriggerToken('plain text'), false);
  assert.equal(hooks.configOf({ status: 'ready', value: { typePauseMs: 900 } }).typePauseMs, 900);
  assert.equal(hooks.configOf({ status: 'loading' }).enabled, true);
});

test('settings card reports loading/unavailable and saves through the ConfigForm', async () => {
  const { hooks } = load();
  const t = key => key;
  assert.equal(hooks.AutocompleteSettings({ t, view: 'summary', form: null }), 'summary');
  assert.equal(hooks.AutocompleteSettings({ t, form: null }).props['data-unavailable'], '');
  const ops = [];
  const form = { getSnapshot: () => ({ status: 'ready', value: { routeMode: 'fixed' }, revision: 7 }), mutate: async (o, rev) => { ops.push([o, rev]); return true; } };
  const tree = hooks.AutocompleteSettings({ t, form });
  const find = (node, pred) => !node || typeof node !== 'object' ? undefined : pred(node) ? node
    : (node.children ?? []).flat().map(child => find(child, pred)).find(Boolean);
  assert.ok(find(tree, n => n.props?.['data-fixed-route'] === ''));
  await find(tree, n => n.props?.name === 'enabled').props.onChange({ target: { checked: false } });
  // Objects built inside the VM have another realm's prototypes; compare their JSON shape.
  assert.equal(JSON.stringify(ops[0]), JSON.stringify([[{ op: 'set', path: ['enabled'], value: false }], 7]));
});
