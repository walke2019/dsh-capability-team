import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { readFileSync } from 'node:fs';

const React = {
  useState: initial => {
    let val = initial;
    const setter = updater => {
      val = typeof updater === 'function' ? updater(val) : updater;
    };
    return [val, setter];
  },
  useRef: initial => ({ current: initial }),
  useEffect: () => {},
  useMemo: fn => fn(),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
};

test('CollapsibleList: 5 条及以内全部渲染且不显示切换按钮', () => {
  let exposed;
  const sandbox = {
    window: {
      __ModuleLoader__: { load: spec => spec.factory(() => React) },
      __ctmTestHook: x => { exposed = x; },
    },
    fetch: () => {},
    AbortController: globalThis.AbortController,
    URLSearchParams: globalThis.URLSearchParams,
    crypto: globalThis.crypto,
  };
  new Script(readFileSync(new URL('../client.js', import.meta.url), 'utf8')).runInNewContext(sandbox);
  assert.ok(exposed.CollapsibleList, 'CollapsibleList must be exported on test hook');

  const items = [1, 2, 3, 4, 5];
  const tree = exposed.CollapsibleList({
    items,
    limit: 5,
    renderItem: n => ({ type: 'div', key: n, props: {}, children: [`item-${n}`] }),
    t: k => k,
  });

  assert.equal(tree.children.length, 5, 'Exactly 5 items rendered');
  const toggleBtn = tree.children.find(c => c?.type === 'button');
  assert.equal(toggleBtn, undefined, 'No toggle button when total <= limit');
});

test('CollapsibleList: 超过 5 条时默认截取 5 条并附带展开按钮，支持展开与收起', () => {
  let exposed;
  let stateVal = false;
  let stateSetter = null;
  const customReact = {
    ...React,
    useState: initial => {
      stateVal = initial;
      stateSetter = updater => {
        stateVal = typeof updater === 'function' ? updater(stateVal) : updater;
      };
      return [stateVal, stateSetter];
    },
  };

  const sandbox = {
    window: {
      __ModuleLoader__: { load: spec => spec.factory(() => customReact) },
      __ctmTestHook: x => { exposed = x; },
    },
    fetch: () => {},
    AbortController: globalThis.AbortController,
    URLSearchParams: globalThis.URLSearchParams,
    crypto: globalThis.crypto,
  };
  new Script(readFileSync(new URL('../client.js', import.meta.url), 'utf8')).runInNewContext(sandbox);

  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  // 1. 默认折叠状态
  let tree = exposed.CollapsibleList({
    items,
    limit: 5,
    renderItem: n => ({ type: 'div', key: n, props: {}, children: [`item-${n}`] }),
    t: k => (k === 'list.more' ? '更多（剩余 {n} 条）' : k === 'list.collapse' ? '收起' : k),
  });

  // 5 个 item + 1 个按钮
  assert.equal(tree.children.length, 6);
  const toggleBtn = tree.children[5];
  assert.equal(toggleBtn.type, 'button');
  assert.equal(toggleBtn.props['aria-expanded'], false);
  assert.equal(toggleBtn.children[0], '更多（剩余 3 条）');

  // 2. 模拟点击展开
  toggleBtn.props.onClick();
  assert.equal(stateVal, true, 'State changed to expanded');

  // 重新渲染展开态
  const expandedReact = {
    ...React,
    useState: () => [true, () => {}],
  };
  // 利用上下文模拟展开渲染
  const sandboxExpanded = {
    window: {
      __ModuleLoader__: { load: spec => spec.factory(() => expandedReact) },
      __ctmTestHook: x => { exposed = x; },
    },
    fetch: () => {},
    AbortController: globalThis.AbortController,
    URLSearchParams: globalThis.URLSearchParams,
    crypto: globalThis.crypto,
  };
  new Script(readFileSync(new URL('../client.js', import.meta.url), 'utf8')).runInNewContext(sandboxExpanded);

  tree = exposed.CollapsibleList({
    items,
    limit: 5,
    renderItem: n => ({ type: 'div', key: n, props: {}, children: [`item-${n}`] }),
    t: k => (k === 'list.more' ? '更多（剩余 {n} 条）' : k === 'list.collapse' ? '收起' : k),
  });

  // 8 个 item + 1 个收起按钮
  assert.equal(tree.children.length, 9);
  const collapseBtn = tree.children[8];
  assert.equal(collapseBtn.type, 'button');
  assert.equal(collapseBtn.props['aria-expanded'], true);
  assert.equal(collapseBtn.children[0], '收起');
});
