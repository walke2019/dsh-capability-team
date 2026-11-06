import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { boardDetailsOf } from './helpers/client-harness.mjs';

function createHarness(remote = { commands: {} }, sessions, { extraGlobals = {}, uiWorkspace } = {}) {
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
    uiWorkspace,
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
  assert.ok(JSON.stringify(toggleBtn).includes('Chinese'));

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
  assert.deepEqual(toggleBtn1.children, ['Chinese'], '英文状态下，切换按钮文案应为目标语言"中文"');

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

test('宿主传入 t 时，点按钮仍能切换语言并写入 localStorage', () => {
  const h = createHarness();
  // 模拟宿主 slot 传入的 t（宿主 slot 传 t 会覆盖 ownTranslator 导致切换失效）
  const hostT = key => (key === 'overview.hint' ? '读取本会话真实状态，不启动模型、不修改配置。' : `host:${key}`);
  const element = h.view({ sessionId: 's_lead', t: hostT });
  let tree = h.render(element.type, element.props);

  // 1. 未点击时：跟随宿主传入的 t
  const title1 = h.find(tree, n => n.props?.className === 'ctm-ov-title');
  assert.equal(title1.children[0], 'host:overview.title', '未显式切换前跟随宿主传入的 t');

  const toggleBtn1 = h.find(tree, n => n.props?.className?.includes('ctm-lang-toggle'));
  assert.ok(toggleBtn1, '语言切换按钮必须存在');

  // 2. 宿主初始 probe 为中文，点击切换语言后翻转为英文并持久化
  toggleBtn1.props.onClick();
  assert.equal(h.sandbox._storage['dsh-capability-team-locale'], 'en', '点击后必须持久化到 localStorage');

  tree = h.render(element.type, element.props);
  const title2 = h.find(tree, n => n.props?.className === 'ctm-ov-title');
  assert.deepEqual(title2.children, ['Team overview'], '点击切换后即使宿主传入了 t，也必须使用插件自有词典渲染英文');
  const toggleBtn2 = h.find(tree, n => n.props?.className?.includes('ctm-lang-toggle'));
  assert.deepEqual(toggleBtn2.children, ['Chinese'], '英文状态下切换按钮文案应为"中文"');

  // 3. 再次点击切回中文并持久化
  toggleBtn2.props.onClick();
  assert.equal(h.sandbox._storage['dsh-capability-team-locale'], 'zh', '再次点击后必须持久化 zh 到 localStorage');

  tree = h.render(element.type, element.props);
  const title3 = h.find(tree, n => n.props?.className === 'ctm-ov-title');
  assert.deepEqual(title3.children, ['团队总览'], '切回中文后必须使用插件自有词典渲染中文');
  const toggleBtn3 = h.find(tree, n => n.props?.className?.includes('ctm-lang-toggle'));
  assert.deepEqual(toggleBtn3.children, ['EN'], '中文状态下切换按钮文案应为"EN"');
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

test('修复打开会话报 subagent/unauthorized：打开主控传字符串，打开队友传对象，自身与不可用卡片不可点', () => {
  const openCalls = [];
  const fakeWorkspace = {
    openSession: target => openCalls.push(target),
  };
  const state = {
    byId: {},
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [
              { id: 's_lead', name: 'lead', role: 'lead', phase: 'active' },
              { id: 's_dc', name: 'diao-chan', role: 'teammate', phase: 'active' },
              { id: 's_prov', name: 'lv-bu', role: 'teammate', phase: 'provisioning' },
            ],
            tasks: [],
          },
        },
      },
      s_dc: {
        values: {
          agentTeam: { parentSessionId: 's_lead' },
        },
      },
    },
  };
  const sessions = {
    list: { getSnapshot: () => state, subscribe: () => () => {} },
    refreshProjections: async () => {},
  };
  const h = createHarness({ commands: {} }, sessions, { uiWorkspace: fakeWorkspace });

  // 1. 在子代理会话中渲染（通过 live.parentSessionId 指向主控 s_lead）
  const live = {
    parentSessionId: () => 's_lead',
    running: () => true,
    projections: id => state.projectionsBySession[id]?.values,
  };
  const element = h.view({ sessionId: 's_dc', t: key => key });
  const tree = h.render(element.type, element.props);

  // 2. 找到“打开主控会话”按钮
  const openLeadBtn = h.find(tree, n => n.type === 'button' && JSON.stringify(n).includes('subagent.openLead'));
  assert.ok(openLeadBtn, '打开主控会话按钮应存在');

  // 点击“打开主控会话”按钮
  openLeadBtn.props.onClick();
  // 必须只传主控 sessionId 字符串，绝不可传 { parentSessionId, childSessionId } 导致宿主报错 subagent/unauthorized
  assert.equal(openCalls[0], 's_lead', '打开主控必须传主控 Session ID 字符串');

  // 3. 验证 openMember 接口直接调用
  element.props.openMember('s_lead', 's_lead');
  assert.equal(openCalls[1], 's_lead', '同一 sessionId 打开时必须传普通 Session ID');

  element.props.openMember('s_lead', 's_dc');
  assert.deepEqual({ ...openCalls[2] }, { parentSessionId: 's_lead', childSessionId: 's_dc', mode: 'continuable' }, '打开队友会话必须传 continuable 地址');

  // 4. 验证 TeamBoard 卡片交互：主控面板下 provisioning 卡片不可点，子代理自身卡片不可点
  const leadElement = h.view({ sessionId: 's_lead', t: key => key });
  const leadTree = h.render(leadElement.type, leadElement.props);
  const board = h.find(leadTree, n => typeof n.type === 'function' && n.props?.roles && 'activity' in n.props);
  assert.ok(board, 'TeamBoard 必须挂载');
  const boardView = boardDetailsOf(board);

  const dcCard = h.find(boardView, n => n.props?.['data-card'] === 'diao-chan');
  assert.ok(dcCard, 'diao-chan 卡片应存在');
  assert.ok(dcCard.props.onClick, '活跃队友卡片应可点');

  const provCard = h.find(boardView, n => n.props?.['data-card'] === 'lv-bu');
  assert.ok(provCard, 'lv-bu 卡片应存在');
  assert.equal(provCard.props.onClick, undefined, '处于 provisioning 的卡片不可点');

  // 当在子代理自身视角且展示看板时，自身卡片不可点
  const selfBoardView = boardDetailsOf(board, { ...board.props, currentMemberId: 's_dc' });
  const selfCard = h.find(selfBoardView, n => n.props?.['data-card'] === 'diao-chan');
  assert.equal(selfCard.props.onClick, undefined, '当前会话自身的卡片不可点');
});

test('task-7: 队友会话紧凑身份栏渲染（头像首字、中文名、能力、模型、状态、打开主控与查看团队总览按钮）', async () => {
  const fakeWorkspace = { openSession: async () => {} };
  const state = {
    byId: { s_dc: { running: true } },
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [
              { id: 's_lead', name: 'lead', role: 'lead' },
              { id: 's_dc', name: 'diao-chan', role: 'frontend' },
            ],
            tasks: [],
          },
        },
      },
      s_dc: { values: { agentTeam: { parentSessionId: 's_lead' } } },
    },
  };
  const sessions = {
    list: { getSnapshot: () => state, subscribe: () => () => {} },
    refreshProjections: async () => {},
  };
  const h = createHarness({ commands: {} }, sessions, { uiWorkspace: fakeWorkspace });
  const live = {
    parentSessionId: () => 's_lead',
    running: id => id === 's_dc',
    projections: id => state.projectionsBySession[id]?.values,
    rosterVersion: () => 0,
    status: () => null,
  };
  const load = async () => ({
    team: {
      roles: [
        { id: 'diao-chan', displayName: '貂蝉', capability: 'frontend', provider: 'provider-a', model: 'gemini-3.8-flash-high' },
      ],
      modelPolicy: { revision: 1, rows: [] },
    },
  });
  const props = { sessionId: 's_dc', t: key => key, live, load };
  const element = h.view(props);
  let tree = h.render(element.type, element.props);

  const refreshBtn = h.find(tree, n => n.type === 'button' && n.props?.className?.includes('ctm-ov-refresh'));
  await refreshBtn.props.onClick();
  tree = h.render(element.type, element.props);

  // 1. 紧凑身份栏必须存在
  const bar = h.find(tree, n => n.props?.className === 'ctm-teammate-bar');
  assert.ok(bar, '必须渲染紧凑身份栏 .ctm-teammate-bar');

  // 2. 头像首字
  const avatar = h.find(bar, n => n.props?.className === 'ctm-tm-avatar');
  assert.ok(avatar, '头像必须存在');
  assert.equal(avatar.children[0], '貂', '头像首字必须是中文名首字');

  // 3. 显示名与能力
  const names = h.find(bar, n => n.props?.className === 'ctm-tm-names');
  assert.ok(names, '身份栏名称容器应存在');
  assert.ok(JSON.stringify(names).includes('貂蝉'), '必须包含显示名 貂蝉');
  assert.ok(JSON.stringify(names).includes('frontend'), '必须包含职责/能力 frontend');

  // 4. 当前模型
  const route = h.find(bar, n => n.props?.className === 'ctm-ov-route');
  assert.ok(route, '必须显示模型路由');
  assert.equal(route.children[0], 'provider-a/gemini-3.8-flash-high', '必须显示当前配置模型');

  // 5. 打开主控与切换总览两个按钮
  const openLeadBtn = h.find(bar, n => n.type === 'button' && JSON.stringify(n).includes('subagent.openLead'));
  assert.ok(openLeadBtn, '必须包含打开主控会话按钮');

  const toggleBtn = h.find(bar, n => n.type === 'button' && JSON.stringify(n).includes('roleview.viewOverview'));
  assert.ok(toggleBtn, '必须包含查看团队总览按钮');
});

test('task-7: 队友会话角色视图隐藏团队统计、诊断与目录错误，切到团队总览时显示', async () => {
  const fakeWorkspace = { openSession: async () => {} };
  const state = {
    byId: { s_dc: { running: true } },
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [
              { id: 's_lead', name: 'lead', role: 'lead' },
              { id: 's_dc', name: 'diao-chan', role: 'frontend' },
            ],
            tasks: [],
          },
        },
      },
      s_dc: { values: { agentTeam: { parentSessionId: 's_lead' } } },
    },
  };
  const sessions = {
    list: { getSnapshot: () => state, subscribe: () => () => {} },
    refreshProjections: async () => {},
  };
  const h = createHarness({ commands: {} }, sessions, { uiWorkspace: fakeWorkspace });
  const live = {
    parentSessionId: () => 's_lead',
    running: () => true,
    projections: id => state.projectionsBySession[id]?.values,
    rosterVersion: () => 0,
    status: () => null,
  };
  const load = async () => ({
    team: {
      roles: [{ id: 'diao-chan', displayName: '貂蝉', capability: 'frontend' }],
      modelPolicy: { revision: 1, rows: [] },
      catalogErrors: [{ provider: 'bad-provider', error: '401 Unauthorized' }],
    },
    ready: true,
    diagnostics: ['mock-diagnostic-msg'],
  });
  const props = { sessionId: 's_dc', t: key => key, live, load };
  const element = h.view(props);
  let tree = h.render(element.type, element.props);

  const refreshBtn = h.find(tree, n => n.type === 'button' && n.props?.className?.includes('ctm-ov-refresh'));
  await refreshBtn.props.onClick();
  tree = h.render(element.type, element.props);

  // 1. 角色视图下：团队统计、诊断、目录错误均必须隐藏
  assert.equal(h.find(tree, n => n.props?.className === 'ctm-ov-stats'), undefined, '角色视图下不应渲染团队统计');
  assert.equal(h.find(tree, n => n.props?.className?.includes('ctm-ov-diag')), undefined, '角色视图下不应渲染诊断');
  assert.equal(h.find(tree, n => n.props?.role === 'alert' && JSON.stringify(n).includes('401 Unauthorized')), undefined, '角色视图下不应渲染目录错误');

  // 2. 点击“查看团队总览”切换到总览模式
  const toggleBtn = h.find(tree, n => n.type === 'button' && n.props?.className?.includes('ctm-ov-roleview-toggle'));
  assert.ok(toggleBtn, '切换总览按钮应存在');
  toggleBtn.props.onClick();
  tree = h.render(element.type, element.props);

  // 3. 总览视图下：团队统计、诊断、目录错误均应显示
  assert.ok(h.find(tree, n => n.props?.className === 'ctm-ov-stats'), '团队总览模式下应渲染团队统计');
  assert.ok(h.find(tree, n => n.props?.className?.includes('ctm-ov-diag')), '团队总览模式下应渲染诊断');
  assert.ok(h.find(tree, n => n.props?.role === 'alert' && JSON.stringify(n).includes('401 Unauthorized')), '团队总览模式下应渲染目录错误');
});

test('task-7: RoleView 7 个分区按顺序渲染，我的任务按 in_progress -> pending -> completed 排序与 owner baseName 匹配，空区块显示提示', () => {
  let roleViewComponent;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  };
  new Script(readFileSync(new URL('../client.js', import.meta.url), 'utf8')).runInNewContext({
    window: {
      __ctmTestHook: fns => { roleViewComponent = fns.RoleView; },
      __ModuleLoader__: { load: spec => spec.factory(() => React) },
    },
  });
  assert.ok(roleViewComponent, 'RoleView 必须在 __ctmTestHook 中导出');

  const tasks = [
    { id: 'task-done', subject: '已完成任务', status: 'completed', ownerName: 'diao-chan-r2' },
    { id: 'task-todo', subject: '待办任务', status: 'pending', owner: 'diao-chan' },
    { id: 'task-doing', subject: '进行中任务', status: 'in_progress', ownerName: 'diao-chan' },
    { id: 'task-other', subject: '其他角色任务', status: 'in_progress', ownerName: 'lv-bu' },
  ];

  const role = { id: 'diao-chan', displayName: '貂蝉', capability: 'frontend', provider: 'provider-a', model: 'gemini-3.8-flash-high' };
  const runtimeState = { data: { taskControl: { paused: false } } };
  const live = {
    parentSessionId: () => 's_lead',
    projections: () => ({ activity: { current: { tool: 'edit', summary: 'editing file' }, recent: [] } }),
  };
  const liveTeam = { tasks, members: [{ id: 's_dc', name: 'diao-chan' }] };
  const usage = [{ id: 's_dc', name: '貂蝉', input: 100, output: 50 }];
  const d = { memberEvidence: [{ sessionId: 's_dc', records: [] }] };

  // 1. 7 个分区顺序验证
  const tree1 = roleViewComponent({
    sessionId: 's_dc',
    role,
    liveByRole: new Map(),
    usage,
    d,
    liveTeam,
    live,
    runtimeState,
    t: key => key,
  });

  const sections = [];
  const collectSections = node => {
    if (!node || typeof node !== 'object') return;
    if (node.props?.['data-section']) sections.push(node.props['data-section']);
    for (const ch of node.children ?? []) collectSections(ch);
  };
  collectSections(tree1);

  assert.deepEqual(
    sections,
    ['my-tasks', 'activity', 'model-perms', 'task-control', 'usage', 'artifacts', 'logs'],
    '7 个分区必须按精确顺序渲染'
  );

  // 验证任务排序与过滤：进行中 -> 待办 -> 已完成，且排除其他角色的任务
  const taskSection = tree1.children.find(n => n.props?.['data-section'] === 'my-tasks');
  const taskTitles = [];
  const collectTitles = node => {
    if (!node || typeof node !== 'object') return;
    if (node.props?.className === 'ctm-rv-task') taskTitles.push(node);
    for (const ch of node.children ?? []) collectTitles(ch);
  };
  collectTitles(taskSection);
  assert.equal(taskTitles.length, 3, '必须只包含属于当前角色的 3 个任务');
  assert.ok(JSON.stringify(taskTitles[0]).includes('task-doing'), '首个任务必须是进行中状态');
  assert.ok(JSON.stringify(taskTitles[1]).includes('task-todo'), '第二个任务必须是待办状态');
  assert.ok(JSON.stringify(taskTitles[2]).includes('task-done'), '第三个任务必须是已完成状态（且支持 -r2 baseName 匹配）');

  // 2. 空任务、空活动、空用量时的空提示验证
  const treeEmpty = roleViewComponent({
    sessionId: 's_dc',
    role,
    liveByRole: new Map(),
    usage: [],
    d: null,
    liveTeam: { tasks: [], members: [] },
    live: { parentSessionId: () => 's_lead', projections: () => ({}) },
    runtimeState: {},
    t: key => `[${key}]`,
  });

  const emptyHints = [];
  const collectEmpties = node => {
    if (!node || typeof node !== 'object') return;
    if (node.props?.className === 'ctm-rv-empty') emptyHints.push(node.children[0]);
    for (const ch of node.children ?? []) collectEmpties(ch);
  };
  collectEmpties(treeEmpty);

  assert.ok(emptyHints.includes('[roleview.noTasks]'), '空任务时应显示空任务提示');
  assert.ok(emptyHints.includes('[roleview.noActivity]'), '空活动时应显示空活动提示');
  assert.ok(emptyHints.includes('[roleview.noUsage]'), '空用量时应显示空用量提示');
  assert.ok(emptyHints.includes('[roleview.noLogs]'), '空日志时应显示空日志提示');
});

test('task-8: 压缩团队总览头部高度：最多两行，删掉 lognote 段落并转为刷新按钮的 title 提示', () => {
  const h = createHarness();
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);

  const head = h.find(tree, n => n.type === 'header' && n.props?.className === 'ctm-ov-head');
  assert.ok(head, '头部容器 .ctm-ov-head 应存在');

  // 1. 头部子节点最多两行（标题行 + 小字副标题）
  const directChildren = (head.children ?? []).filter(Boolean);
  assert.equal(directChildren.length, 2, '头部直属子元素必须严格为 2 行');
  assert.equal(directChildren[0].props?.className, 'ctm-ov-titlerow', '第 1 行为标题行');
  assert.ok(directChildren[1].props?.className?.includes('ctm-ov-subrow'), '第 2 行为副标题小字单行');

  // 2. 删掉原来的 lognote 段落
  assert.equal(h.find(head, n => n.props?.className?.includes('ctm-ov-lognote')), undefined, '原 ctm-ov-lognote 段落已被移除');

  // 3. 刷新按钮上附带 logNote 悬浮提示
  const refreshBtn = h.find(head, n => n.type === 'button' && n.props?.className?.includes('ctm-ov-refresh'));
  assert.ok(refreshBtn, '刷新按钮应存在');
  assert.equal(refreshBtn.props.title, 'overview.logNote', '刷新按钮必须带有 overview.logNote 悬停提示');
});
