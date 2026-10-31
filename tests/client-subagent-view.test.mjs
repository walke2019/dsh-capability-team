import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

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
  return { view, render, find, sandbox };
}

test('队友会话视图检测与主控视图导流提示', () => {
  const state = {
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
      m1: {
        values: {
          agentTeam: { parentSessionId: 's_lead' },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 'm1', t: key => key });
  const tree = h.render(element.type, element.props);

  // 必须渲染 teammate notice 卡片
  const notice = h.find(tree, n => JSON.stringify(n).includes('subagent.notice'));
  assert.ok(notice, 'Teammate session must display subagent notice banner');

  const currentMember = h.find(notice, n => JSON.stringify(n).includes('subagent.currentMember'));
  assert.ok(currentMember, 'Must show current member info in banner');
  assert.ok(JSON.stringify(currentMember).includes('diao-chan'));
});

test('ErrorBoundary 优雅降级保护：子组件崩溃不导致整页白屏', () => {
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

  // 查找任意 ErrorBoundary 包装节点
  const errorBoundaries = [];
  const collectEB = node => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'function' && node.type.name === 'ErrorBoundary') {
      errorBoundaries.push(node);
    }
    for (const child of node.children ?? []) collectEB(child);
  };
  collectEB(tree);

  assert.ok(errorBoundaries.length >= 6, 'All tabs must be wrapped in ErrorBoundary');
  const eb = errorBoundaries[0];
  const instance = new eb.type({ t: k => k });
  instance.state = { hasError: true, error: new Error('Simulated Tab Crash') };
  const crashedTree = instance.render();
  assert.ok(JSON.stringify(crashedTree).includes('error.tabCrashed'));
  assert.ok(JSON.stringify(crashedTree).includes('Simulated Tab Crash'));
});

test('语言切换按键与 localStorage 交互', () => {
  const h = createHarness();
  const element = h.view({ sessionId: 's_lead' });
  const tree = h.render(element.type, element.props);

  const toggleBtn = h.find(tree, n => n.props?.className?.includes('ctm-lang-toggle'));
  assert.ok(toggleBtn, 'Language toggle button must be present in header');
  // No `t` is injected by this harness call, so Overview falls back to its own real dictionary (item 3) instead
  // of echoing the raw key; the default locale is English, so the toggle's own label reads the target "中文".
  assert.ok(JSON.stringify(toggleBtn).includes('中文'));

  toggleBtn.props.onClick();
  // 默认从 en 切到 zh
  assert.equal(h.sandbox._storage['dsh-capability-team-locale'], 'zh');
  // 再点切回 en
  toggleBtn.props.onClick();
  assert.equal(h.sandbox._storage['dsh-capability-team-locale'], 'en');
});

test('item 3（真实双语渲染）：不注入 t 时默认渲染英文，切换后渲染中文，并持久化到 localStorage', () => {
  const h = createHarness();
  // No `t` prop injected here — this exercises Overview's own dictionary-backed translator for real, the
  // scenario Lead explicitly called out: the production registration site never injects `t` either.
  const element = h.view({ sessionId: 's_lead' });
  let tree = h.render(element.type, element.props);

  // Default (no stored preference) must be English, not the host's locale and not Chinese.
  const title1 = h.find(tree, n => n.props?.className === 'ctm-ov-title');
  assert.ok(title1);
  assert.deepEqual(title1.children, ['Team overview'], '默认必须渲染英文真实译文，不是原始 key 或中文');
  const toggleBtn1 = h.find(tree, n => n.props?.className?.includes('ctm-lang-toggle'));
  assert.deepEqual(toggleBtn1.children, ['中文'], '英文状态下，切换按钮文案应为目标语言"中文"');

  // Toggle to Chinese.
  toggleBtn1.props.onClick();
  assert.equal(h.sandbox._storage['dsh-capability-team-locale'], 'zh', '切换后必须持久化到 localStorage');
  tree = h.render(element.type, element.props);
  const title2 = h.find(tree, n => n.props?.className === 'ctm-ov-title');
  assert.deepEqual(title2.children, ['团队总览'], '切换后必须渲染真实中文译文');
  const toggleBtn2 = h.find(tree, n => n.props?.className?.includes('ctm-lang-toggle'));
  assert.deepEqual(toggleBtn2.children, ['EN'], '中文状态下，切换按钮文案应为目标语言"EN"');

  // A value that interpolates {vars} must also come through the plugin's own dictionary correctly.
  const refreshBtn = h.find(tree, n => n.type === 'button' && n.props?.className?.includes('ctm-ov-refresh'));
  assert.deepEqual(refreshBtn.children, ['刷新'], '插值与非插值词条都应来自插件自带字典');
});

test('角色面板中 Theme 主题配置展示与一键复制 prompt', async () => {
  const data = {
    team: {
      name: '三国志英杰传',
      roles: [{ id: 'diao-chan', displayName: '貂蝉', capability: 'frontend' }],
      workflow: {},
      modelPolicy: { revision: 0, rows: [] },
    },
  };
  const h = createHarness({
    commands: { execute: async () => ({ ok: true, value: { result: { kind: 'success', text: JSON.stringify(data) } } }) },
  });
  const props = { sessionId: 's_lead', t: key => key, load: async () => data };
  const element = h.view(props);
  let tree = h.render(element.type, props);

  // Click refresh button to load snapshot
  const refreshBtn = h.find(tree, n => n.type === 'button' && n.props?.className?.includes('ctm-ov-refresh'));
  if (refreshBtn) await refreshBtn.props.onClick();
  tree = h.render(element.type, props);

  // Switch to roles tab
  const rolesTabBtn = h.find(tree, n => n.type === 'button' && n.children?.some?.(c => typeof c === 'string' && c.includes('nav.roles')));
  if (rolesTabBtn) rolesTabBtn.props.onClick();
  tree = h.render(element.type, props);

  // 查找主题部分
  const themeSection = h.find(tree, n => n.props?.className?.includes('ctm-theme-section'));
  assert.ok(themeSection, 'Theme section must be present in Roles tab');
  const text = JSON.stringify(themeSection);
  assert.ok(text.includes('theme.title'));
  assert.ok(text.includes('theme.promptWestern'));
  assert.ok(text.includes('theme.promptOutlaws'));
  assert.ok(text.includes('theme.promptSciFi'));
  assert.ok(text.includes('theme.templateInstruction'));
});

test('item 4：复制按钮只在真正写入成功后显示已复制，失败则降级为手动复制提示', async () => {
  const data = {
    team: {
      name: '三国志英杰传',
      roles: [{ id: 'diao-chan', displayName: '貂蝉', capability: 'frontend' }],
      workflow: {},
      modelPolicy: { revision: 0, rows: [] },
    },
  };
  const makeSandboxExtras = clipboard => ({ navigator: { clipboard }, setTimeout: globalThis.setTimeout });
  const run = async clipboardImpl => {
    const h = createHarness(
      { commands: { execute: async () => ({ ok: true, value: { result: { kind: 'success', text: JSON.stringify(data) } } }) } },
      undefined,
      { extraGlobals: makeSandboxExtras(clipboardImpl) },
    );
    const props = { sessionId: 's_lead', t: key => key, load: async () => data };
    const element = h.view(props);
    let tree = h.render(element.type, props);
    const refreshBtn = h.find(tree, n => n.type === 'button' && n.props?.className?.includes('ctm-ov-refresh'));
    if (refreshBtn) await refreshBtn.props.onClick();
    tree = h.render(element.type, props);
    const rolesTabBtn = h.find(tree, n => n.type === 'button' && n.children?.some?.(c => typeof c === 'string' && c.includes('nav.roles')));
    if (rolesTabBtn) rolesTabBtn.props.onClick();
    tree = h.render(element.type, props);
    const themeSection = h.find(tree, n => n.props?.className?.includes('ctm-theme-section'));
    const copyBtn = h.find(themeSection, n => n.type === 'button' && n.children?.includes('theme.promptCopy'));
    assert.ok(copyBtn, 'copy button must exist');
    let textContent = '';
    const fakeBtn = { get textContent() { return textContent; }, set textContent(v) { textContent = v; } };
    await copyBtn.props.onClick({ currentTarget: fakeBtn });
    return textContent;
  };

  // Success path: writeText resolves -> must show "Copied", never claim success before awaiting.
  const successText = await run({ writeText: async () => {} });
  assert.equal(successText, 'theme.promptCopied', '写入成功后才显示已复制');

  // Failure path: writeText rejects -> must fall back to the manual-copy notice, not silently claim success.
  const failureText = await run({ writeText: async () => { throw new Error('denied'); } });
  assert.equal(failureText, 'theme.promptManual', '写入失败必须降级为手动复制提示，不得假称已复制');

  // Unsupported path: no clipboard API at all -> same manual fallback, no throw escapes onClick.
  const unsupportedText = await run(undefined);
  assert.equal(unsupportedText, 'theme.promptManual', '不支持剪贴板 API 时同样降级，不抛出未捕获异常');
});
