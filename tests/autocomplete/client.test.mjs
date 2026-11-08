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
  const window = { __ModuleLoader__: { load: spec => { assert.equal(spec.id, '@aiwuk/autocomplete'); plugin = spec.factory(() => React); } },
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
    configForms: { get: name => ({ name }) },
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
  assert.equal(hooks.candidateOf({ mode: 'continue', items: ['hello world!'], index: 0 }, 'hello'), ' world!');
  assert.equal(hooks.candidateOf({ mode: 'continue', items: ['Hello World!'], index: 0 }, 'hello'), ' World!');
  assert.equal(hooks.candidateOf({ mode: 'next', items: ['Suggest something'], index: 0 }, ''), 'Suggest something');
});

test('caretAtEnd handles real multi-p DOM: caret at end shows ghost text, in middle hides it', () => {
  const text1 = { nodeType: 3, textContent: 'First line' };
  const span1 = { nodeType: 1, textContent: 'First line', childNodes: [text1] };
  const p1 = { nodeType: 1, textContent: 'First line', childNodes: [span1] };

  const text2 = { nodeType: 3, textContent: 'Second line' };
  const span2 = { nodeType: 1, textContent: 'Second line', childNodes: [text2] };
  const p2 = { nodeType: 1, textContent: 'Second line', childNodes: [span2] };

  // In real browser DOM, element.textContent concatenates text without newlines ("First lineSecond line")
  // while draft is "First line\nSecond line".
  const allNodes = [text1, span1, p1, text2, span2, p2];
  const editor = {
    nodeType: 1,
    textContent: 'First lineSecond line',
    childNodes: [p1, p2],
    contains: node => allNodes.includes(node) || node === editor,
  };

  const createHarness = (container, offset) => {
    const range = {
      collapsed: true,
      startContainer: container,
      startOffset: offset,
      getBoundingClientRect: () => ({ left: container === text2 && offset === 11 ? 190 : 130, top: container === text2 ? 40 : 20, width: 0, height: 20 }),
      getClientRects: () => [{ left: container === text2 && offset === 11 ? 190 : 130, top: container === text2 ? 40 : 20, width: 0, height: 20 }],
    };
    const document = {
      createRange: () => {
        let sc, so;
        return {
          selectNodeContents() {},
          setStart(c, o) { sc = c; so = o; },
          setEnd() {},
          toString: () => {
            // Suffix text after (sc, so):
            if (sc === text2 && so === 11) return '';
            if (sc === text2 && so === 3) return 'ond line';
            if (sc === text1 && so === 10) return 'Second line';
            return 'remaining text';
          },
          getBoundingClientRect: () => ({ left: 180, right: 190, top: 40, width: 10, height: 20 }),
        };
      },
    };
    const window = {
      getSelection: () => ({ rangeCount: 1, getRangeAt: () => range }),
      __ModuleLoader__: { load: spec => spec.factory(() => ({})) },
      __acTestHook: v => { hooks = v; },
    };
    let hooks;
    new Script(source).runInNewContext({ window, document, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 } });
    return hooks;
  };

  // Case A: Caret at the very end of multi-<p> editor (end of Second line)
  const hooksEnd = createHarness(text2, 11);
  const atEnd = hooksEnd.caretAtEnd(editor, 'First line\nSecond line');
  assert.ok(atEnd, 'caret at end of multiline draft must show ghost text');
  assert.equal(atEnd.left, 190);
  assert.equal(atEnd.top, 40);

  // Case B: Caret in middle of second line -> hides ghost text
  const hooksMiddle = createHarness(text2, 3);
  const inMiddle = hooksMiddle.caretAtEnd(editor, 'First line\nSecond line');
  assert.equal(inMiddle, null, 'caret in middle of multiline text must hide ghost text');

  // Case C: Caret at end of first line (middle of document) -> hides ghost text
  const hooksFirstLineEnd = createHarness(text1, 10);
  const atFirstLineEnd = hooksFirstLineEnd.caretAtEnd(editor, 'First line\nSecond line');
  assert.equal(atFirstLineEnd, null, 'caret at end of earlier paragraph must hide ghost text');
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
