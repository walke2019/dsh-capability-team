import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

// Same inline VM harness as tests/client-subagent-view.test.mjs — kept local (not the shared helper) so this
// file matches that file's exact createHarness shape, including its own useState/useRef/Component stubs.
function createHarness(remote = { commands: {} }, sessions, { extraGlobals = {} } = {}) {
  let plugin, cursor = 0, states = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return states[index] ??= { current: initial }; },
    useEffect() {},
    useMemo(fn) { return fn(); },
    Fragment: Symbol.for('react.fragment'),
    Component: class Component {
      constructor(props) { this.props = props; this.state = {}; }
      setState(updater) { this.state = { ...this.state, ...(typeof updater === 'function' ? updater(this.state) : updater) }; }
    },
  };
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: spec => { plugin = spec.factory(() => React); },
      },
      localStorage: {
        getItem: key => sandbox._storage?.[key] ?? null,
        setItem: (key, val) => { sandbox._storage = sandbox._storage || {}; sandbox._storage[key] = String(val); },
      },
    },
    _storage: {},
    fetch: extraGlobals.fetch ?? globalThis.fetch,
    AbortController: globalThis.AbortController,
    ...extraGlobals,
  };
  new Script(readFileSync(new URL('../client.js', import.meta.url), 'utf8')).runInNewContext(sandbox);
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
  return { view, render, find, sandbox, reset: () => { states = []; cursor = 0; } };
}

const teammateState = {
  byId: { m1: { running: true } },
  projectionsBySession: {
    s_lead: {
      values: {
        agentTeam: {
          members: [
            { id: 's_lead', name: 'lead', role: 'lead' },
            { id: 'm1', name: 'diao-chan', role: 'frontend' },
          ],
        },
      },
    },
    m1: { values: { agentTeam: { parentSessionId: 's_lead' } } },
  },
};

test('队友会话默认显示角色视图，且没有模型分配（PolicyEditor）', () => {
  const sessions = { list: { getSnapshot: () => teammateState, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 'm1', t: key => key });
  const tree = h.render(element.type, element.props);

  // 整个原有的标签导航必须被角色视图整体替代，不能同时出现。
  assert.equal(h.find(tree, n => n.props?.className === 'ctm-ov-tabs'), undefined, '队友会话不应渲染团队标签导航');

  const roleViewNode = h.find(tree, n => typeof n.type === 'function' && n.type.name === 'RoleView');
  assert.ok(roleViewNode, '队友会话必须渲染 RoleView');
  const inner = roleViewNode.type(roleViewNode.props);
  assert.ok(JSON.stringify(inner).includes('ctm-rv'), 'RoleView 必须渲染角色视图容器');

  // RoleView 内部绝不能引入 PolicyEditor（无 policy 字段的组件调用）。
  const policyNode = h.find(inner, n => typeof n.type === 'function' && Object.prototype.hasOwnProperty.call(n.props ?? {}, 'policy'));
  assert.equal(policyNode, undefined, '角色视图不应包含模型分配编辑器');
});

test('队友会话可以切到团队总览，并能切回角色视图', () => {
  const sessions = { list: { getSnapshot: () => teammateState, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const props = { sessionId: 'm1', t: key => key };
  const element = h.view(props);
  let tree = h.render(element.type, element.props);

  const toggleBtn = h.find(tree, n => n.type === 'button' && n.props?.className?.includes('ctm-ov-roleview-toggle'));
  assert.ok(toggleBtn, '队友会话必须有切换按钮');
  assert.ok(JSON.stringify(toggleBtn).includes('roleview.viewOverview'));

  toggleBtn.props.onClick();
  tree = h.render(element.type, element.props);
  assert.equal(h.find(tree, n => typeof n.type === 'function' && n.type.name === 'RoleView'), undefined, '切到总览后不应再渲染角色视图');
  assert.ok(h.find(tree, n => n.props?.className === 'ctm-ov-tabs'), '切到总览后应显示团队标签导航');
  const backBtn = h.find(tree, n => n.type === 'button' && n.props?.className?.includes('ctm-ov-roleview-toggle'));
  assert.ok(JSON.stringify(backBtn).includes('roleview.backToRole'));

  backBtn.props.onClick();
  tree = h.render(element.type, element.props);
  assert.ok(h.find(tree, n => typeof n.type === 'function' && n.type.name === 'RoleView'), '再次点击应切回角色视图');
  assert.equal(h.find(tree, n => n.props?.className === 'ctm-ov-tabs'), undefined, '切回角色视图后不应显示团队标签导航');
});

test('主控会话没有角色视图切换按钮', () => {
  const state = {
    byId: {},
    projectionsBySession: {
      s_lead: { values: { agentTeam: { members: [{ id: 's_lead', name: 'lead', role: 'lead' }] } } },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);

  assert.equal(h.find(tree, n => n.type === 'button' && n.props?.className?.includes('ctm-ov-roleview-toggle')), undefined,
    '主控会话不应出现角色视图切换按钮');
  assert.equal(h.find(tree, n => typeof n.type === 'function' && n.type.name === 'RoleView'), undefined,
    '主控会话不应渲染角色视图');
});

test('模型面板二级标签默认选中第一个，点击后能切换', () => {
  const state = {
    byId: {},
    projectionsBySession: {
      s_lead: { values: { agentTeam: { members: [{ id: 's_lead', name: 'lead', role: 'lead' }] } } },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const props = { sessionId: 's_lead', t: key => key };
  const element = h.view(props);
  const tree = h.render(element.type, element.props);

  const subTabsNode = h.find(tree, n => typeof n.type === 'function' && n.type.name === 'ModelSubTabs');
  assert.ok(subTabsNode, '模型面板必须使用 ModelSubTabs');

  // Reset the fake hook slots before rendering this subtree in isolation — otherwise its own useState(0)
  // call collides with slots already claimed by Overview's own hooks during the outer render above.
  h.reset();
  let view = h.render(subTabsNode.type, subTabsNode.props);
  let buttons = [];
  const collect = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) collect(item); return; }
    if (node.type === 'button' && node.props?.className === 'ctm-ov-subtab') buttons.push(node);
    for (const child of node.children ?? []) collect(child);
  };
  collect(view);
  assert.equal(buttons.length, 3, '应有三个二级标签');
  assert.equal(buttons[0].props['aria-pressed'], true, '默认必须选中第一个二级标签');
  assert.equal(buttons[1].props['aria-pressed'], false);
  assert.equal(buttons[2].props['aria-pressed'], false);

  buttons[1].props.onClick();
  view = h.render(subTabsNode.type, subTabsNode.props);
  buttons = [];
  collect(view);
  assert.equal(buttons[0].props['aria-pressed'], false, '点击后第一个标签不再选中');
  assert.equal(buttons[1].props['aria-pressed'], true, '点击的标签应变为选中');
});
