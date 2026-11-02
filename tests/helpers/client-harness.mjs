// Shared VM harness for the MVP-B client tests: loads the built client.js with a fake host.
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

export function createHarness(remote = { commands: {} }, sessions, { runEffects = false, extraGlobals = {} } = {}) {
  let plugin, cursor = 0, states = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return states[index] ??= { current: initial }; },
    useEffect(fn) { if (runEffects) fn(); },
    useMemo(fn) { return fn(); },
    Fragment: Symbol.for('react.fragment'),
  };
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: spec => { plugin = spec.factory(() => React); },
      },
    },
    fetch: extraGlobals.fetch ?? globalThis.fetch,
    AbortController: globalThis.AbortController,
    ...extraGlobals,
  };
  new Script(readFileSync(new URL('../../client.js', import.meta.url), 'utf8')).runInNewContext(sandbox);
  let view;
  plugin.apply({
    effect() {},
    locale: { bind: () => (k, vals) => k + (vals ? JSON.stringify(vals) : '') },
    remote,
    sessions,
    slots: {
      inject: (_name, fn) => fn(),
      register(options, component) {
        if (options.id === 'capability-team-overview') view = component;
      },
    },
  });
  const render = (component, props) => { cursor = 0; return component(props); };
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) {
      for (const item of node) {
        const res = find(item, predicate);
        if (res) return res;
      }
      return undefined;
    }
    if (predicate(node)) return node;
    for (const child of node.children ?? []) {
      const result = find(child, predicate);
      if (result) return result;
    }
  };
  const findAll = (node, predicate, acc = []) => {
    if (!node || typeof node !== 'object') return acc;
    if (Array.isArray(node)) {
      for (const item of node) findAll(item, predicate, acc);
      return acc;
    }
    if (predicate(node)) acc.push(node);
    for (const child of node.children ?? []) {
      findAll(child, predicate, acc);
    }
    return acc;
  };
  // resetState clears the shared hook slots so a component rendered on its own does not inherit another component's state.
  return { view, render, find, findAll, resetCursor: () => { cursor = 0; }, resetState: () => { states = []; cursor = 0; } };
}
