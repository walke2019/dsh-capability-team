import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { boardDetailsOf } from './helpers/client-harness.mjs';

function createHarness(remote = { commands: {} }, sessions, { runEffects = false } = {}) {
  let plugin, cursor = 0, states = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return states[index] ??= { current: initial }; },
    useEffect(fn) { if (runEffects) fn(); },
    useMemo(fn) { return fn(); },
  };
  new Script(readFileSync(new URL('../client.js', import.meta.url), 'utf8')).runInNewContext({
    window: {
      __ModuleLoader__: {
        load: spec => { plugin = spec.factory(() => React); },
      },
    },
  });
  let view;
  plugin.apply({
    effect() {},
    locale: { bind: () => key => key },
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
    if (predicate(node)) return node;
    for (const child of node.children ?? []) {
      const result = find(child, predicate);
      if (result) return result;
    }
  };
  const findAll = (node, predicate, acc = []) => {
    if (!node || typeof node !== 'object') return acc;
    if (predicate(node)) acc.push(node);
    for (const child of node.children ?? []) {
      findAll(child, predicate, acc);
    }
    return acc;
  };
  return { view, render, find, findAll };
}

test('MVP-A 1: 上下文压力条与预算条（无 maxTokens 时不画，有 maxTokens 时画，缺失压力时显示未知且不画条）', () => {
  const state = {
    byId: {},
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [
              { id: 's_lead', name: 'lead', role: 'lead', phase: 'active' },
              { id: 's_diao', name: 'diao-chan', role: 'teammate', phase: 'active' },
              { id: 's_zhou', name: 'zhou-yu', role: 'teammate', phase: 'active' },
            ],
            tasks: [],
          },
        },
      },
      s_diao: {
        values: {
          contextPressure: { projectedTokens: 4000, contextWindow: 8000 },
          capabilityTeamUsage: { totals: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 }, routes: [{ route: 'provider-a/gemini', uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 }], coverage: 'complete', reportedSamples: 1, attemptsWithoutUsage: 0 },
        },
      },
      s_zhou: {
        values: {
          contextPressure: { projectedTokens: 2000, contextWindow: 10000 },
          capabilityTeamUsage: { totals: { uncachedInputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 }, routes: [{ route: 'provider-a/gpt-6.1-sol', uncachedInputTokens: 1200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 }], coverage: 'complete', reportedSamples: 1, attemptsWithoutUsage: 0 },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);

  // 提供带 maxTokens 的配置快照
  const snapshot = {
    team: {
      roles: [
        { id: 'lead', displayName: '孙权', capability: 'orchestrator' },
        { id: 'diao-chan', displayName: '貂蝉', capability: 'frontend' }, // 无 maxTokens
        { id: 'zhou-yu', displayName: '周瑜', capability: 'qa', maxTokens: 5000 }, // 有 maxTokens
      ],
      modelPolicy: { revision: 0, rows: [] },
    },
  };

  const element = h.view({ sessionId: 's_lead', t: (k, vals) => k + (vals ? JSON.stringify(vals) : ''), load: async () => snapshot });
  const tree = h.render(element.type, { ...element.props, load: async () => snapshot });
  const board = h.find(tree, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);
  // 传带有 role.maxTokens 的 roles 给 board
  const view = boardDetailsOf(board, { ...board.props, roles: snapshot.team.roles });

  // 1) diao-chan: 有 contextPressure (50%)，无 maxTokens -> 仅 1 个进度条（上下文压力条）
  const diaoCard = h.find(view, n => n.props?.['data-card'] === 'diao-chan');
  assert.ok(diaoCard);
  const diaoMeters = h.findAll(diaoCard, n => n.props?.className === 'ctm-us-meter');
  assert.equal(diaoMeters.length, 1, '无 maxTokens 时不画预算条');
  assert.ok(JSON.stringify(diaoCard).includes('50%'));

  // 2) zhou-yu: 有 contextPressure (20%)，有 maxTokens (5000) -> 2 个进度条（压力条 + 预算条）
  const zhouCard = h.find(view, n => n.props?.['data-card'] === 'zhou-yu');
  assert.ok(zhouCard);
  const zhouMeters = h.findAll(zhouCard, n => n.props?.className === 'ctm-us-meter');
  assert.equal(zhouMeters.length, 2, '有 maxTokens 时画预算条，连同上下文压力条共 2 条');
  assert.ok(JSON.stringify(zhouCard).includes('live.budgetTitle'), '包含预算标题');

  // 3) lead: 缺失 contextPressure -> 显示未知，且不画假条（0 个进度条）
  const leadCard = h.find(view, n => n.props?.['data-card'] === 'lead');
  assert.ok(leadCard);
  const leadMeters = h.findAll(leadCard, n => n.props?.className === 'ctm-us-meter');
  assert.equal(leadMeters.length, 0, '缺失 contextPressure 时不画假条');
  assert.ok(JSON.stringify(leadCard).includes('live.contextUnknown'), '缺失时显示未知');
});

test('MVP-A 2: 卡片显示打开会话按钮，支持点击、Enter 键与 Space 键，且阻止冒泡', () => {
  const opened = [];
  const state = {
    byId: {},
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [
              { id: 's_lead', name: 'lead', role: 'lead', phase: 'active' },
              { id: 's_diao', name: 'diao-chan', role: 'teammate', phase: 'active' },
            ],
            tasks: [],
          },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, {
    ...element.props,
    openMember: (parent, child) => opened.push([parent, child]),
  });
  const board = h.find(tree, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);
  const view = boardDetailsOf(board);

  const diaoCard = h.find(view, n => n.props?.['data-card'] === 'diao-chan');
  const openBtn = h.find(diaoCard, n => n.props?.className === 'ctm-bd-open-btn');
  assert.ok(openBtn, '应该渲染打开会话按钮');

  // 1) 鼠标点击
  let stoppedClick = false;
  openBtn.props.onClick({ stopPropagation: () => { stoppedClick = true; } });
  assert.ok(stoppedClick, '按钮点击阻止冒泡');
  assert.deepEqual(opened, [['s_lead', 's_diao']]);

  // 2) 键盘 Enter 键
  let preventedEnter = false;
  openBtn.props.onKeyDown({ key: 'Enter', preventDefault: () => { preventedEnter = true; }, stopPropagation: () => {} });
  assert.ok(preventedEnter, 'Enter 键阻止默认行为');
  assert.deepEqual(opened, [['s_lead', 's_diao'], ['s_lead', 's_diao']]);

  // 3) 键盘 Space 键
  let preventedSpace = false;
  openBtn.props.onKeyDown({ key: ' ', preventDefault: () => { preventedSpace = true; }, stopPropagation: () => {} });
  assert.ok(preventedSpace, 'Space 键阻止默认行为');
  assert.deepEqual(opened, [['s_lead', 's_diao'], ['s_lead', 's_diao'], ['s_lead', 's_diao']]);
});

test('MVP-A 3: 模型徽章映射与色阶，tooltip 保留真实 ID 与运行状态', () => {
  const state = {
    byId: {},
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [
              { id: 's_lead', name: 'lead', role: 'lead', phase: 'active' },
              { id: 's_m1', name: 'm1', role: 'teammate', phase: 'active' },
              { id: 's_m2', name: 'm2', role: 'teammate', phase: 'active' },
              { id: 's_m3', name: 'm3', role: 'teammate', phase: 'active' },
              { id: 's_m4', name: 'm4', role: 'teammate', phase: 'active' },
            ],
            tasks: [],
          },
        },
      },
      s_m1: { values: { modelSelection: { next: { provider: 'provider-a', model: 'gpt-6.1-sol' } }, capabilityTeamUsage: { routes: [{ route: 'provider-a/gpt-6.1-sol' }] } } },
      s_m2: { values: { modelSelection: { next: { provider: 'provider-a', model: 'claude-opus-5-5' } }, capabilityTeamUsage: { routes: [{ route: 'provider-a/claude-opus-5-5' }] } } },
      s_m3: { values: { modelSelection: { next: { provider: 'provider-a', model: 'gemini-3.8-flash' } }, capabilityTeamUsage: { routes: [{ route: 'provider-a/gemini-3.8-flash' }] } } },
      s_m4: { values: { modelSelection: { next: { provider: 'opencode', model: 'build-agent' } }, capabilityTeamUsage: { routes: [{ route: 'opencode/build-agent' }] } } },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);
  const board = h.find(tree, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);
  const view = boardDetailsOf(board);

  // gpt-6.1-sol -> 史诗紫
  const m1Card = h.find(view, n => n.props?.['data-card'] === 'm1');
  assert.ok(h.find(m1Card, n => n.props?.['data-grade'] === 'epic'), 'gpt-6.1-sol 对应史诗紫');
  const m1Model = h.find(m1Card, n => n.props?.className === 'ctm-bd-model');
  assert.ok(m1Model.props.title.includes('provider-a/gpt-6.1-sol'));
  assert.ok(m1Model.props.title.includes('live.liveModel'));

  // claude-opus-* -> 传说金
  const m2Card = h.find(view, n => n.props?.['data-card'] === 'm2');
  assert.ok(h.find(m2Card, n => n.props?.['data-grade'] === 'legendary'), 'claude-opus-* 对应传说金');

  // gemini-*-flash -> 稀有蓝
  const m3Card = h.find(view, n => n.props?.['data-card'] === 'm3');
  assert.ok(h.find(m3Card, n => n.props?.['data-grade'] === 'rare'), 'gemini-*-flash 对应稀有蓝');

  // opencode -> 布衣
  const m4Card = h.find(view, n => n.props?.['data-card'] === 'm4');
  assert.ok(h.find(m4Card, n => n.props?.['data-grade'] === 'cloth'), 'opencode 通道对应布衣');
});

test('MVP-A 4: teamActivityFrom 保留 blockedBy，最长依赖链计算（DAG 序列/分支选最长/空图/环唯一性/缺失ID/无依赖）', () => {
  // 提取 client.js 内部的 computeLongestChain 进行单元测试断言
  const clientSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  const computeLongestChainMatch = clientSource.match(/function computeLongestChain\([\s\S]*?\n {4}\}/);
  assert.ok(computeLongestChainMatch, '找到了 computeLongestChain 函数定义');
  const computeLongestChain = new Function(`${computeLongestChainMatch[0]}; return computeLongestChain;`)();

  // 1. 空图 [] -> []
  assert.deepEqual(computeLongestChain([]), []);
  assert.deepEqual(computeLongestChain(null), []);

  // 2. DAG a -> b -> c 得 ['a', 'b', 'c']
  const dag1 = [
    { id: 'a', blockedBy: [] },
    { id: 'b', blockedBy: ['a'] },
    { id: 'c', blockedBy: ['b'] },
  ];
  assert.deepEqual(computeLongestChain(dag1), ['a', 'b', 'c']);

  // 3. 有分支时选更长的：a -> b -> c (长3)，a -> d (长2)
  const dagBranch = [
    { id: 'a', blockedBy: [] },
    { id: 'b', blockedBy: ['a'] },
    { id: 'c', blockedBy: ['b'] },
    { id: 'd', blockedBy: ['a'] },
  ];
  assert.deepEqual(computeLongestChain(dagBranch), ['a', 'b', 'c']);

  // 4. 自环（a -> a）：无重复节点，返回 ['a']
  const selfLoop = [{ id: 'a', blockedBy: ['a'] }];
  assert.deepEqual(computeLongestChain(selfLoop), ['a']);

  // 5. 两节点环（a -> b, b -> a）：节点绝对唯一，不出现重复节点
  const twoCycle = [
    { id: 'a', blockedBy: ['b'] },
    { id: 'b', blockedBy: ['a'] },
  ];
  const cycleRes = computeLongestChain(twoCycle);
  assert.equal(new Set(cycleRes).size, cycleRes.length, '环处理后结果链节点必须唯一');
  assert.ok(cycleRes.length <= 2);

  // 6. 缺失依赖 ID 不崩溃，正常过滤
  const missingDep = [
    { id: 't1', blockedBy: ['nonexistent-task'] },
  ];
  assert.deepEqual(computeLongestChain(missingDep), ['t1']);

  // 7. blockedBy: [] 显示 live.noDeps（空数组不误判为有依赖）
  const stateNoDeps = {
    byId: {},
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [{ id: 's_lead', name: 'lead', role: 'lead', phase: 'active' }],
            tasks: [
              { id: 't1', subject: 'Task 1', status: 'pending', blockedBy: [] },
              { id: 't2', subject: 'Task 2', status: 'pending', blockedBy: [] },
            ],
          },
        },
      },
    },
  };
  const sessionsNoDeps = { list: { getSnapshot: () => stateNoDeps, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const hNoDeps = createHarness({ commands: {} }, sessionsNoDeps);
  const elNoDeps = hNoDeps.view({ sessionId: 's_lead', t: key => key });
  const treeNoDeps = hNoDeps.render(elNoDeps.type, elNoDeps.props);
  const boardNoDeps = hNoDeps.find(treeNoDeps, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);
  const viewNoDeps = boardNoDeps.type(boardNoDeps.props);
  const depsViewNoDeps = hNoDeps.find(viewNoDeps, n => n.props?.className === 'ctm-bd-deps');
  assert.ok(depsViewNoDeps);
  assert.ok(JSON.stringify(depsViewNoDeps).includes('live.noDeps'), 'blockedBy: [] 应显示 live.noDeps');

  // 8. 在有实际依赖的视图中正确标出最长依赖链
  const stateWithDeps = {
    byId: {},
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [{ id: 's_lead', name: 'lead', role: 'lead', phase: 'active' }],
            tasks: [
              { id: 't1', subject: 'Task 1', status: 'completed', blockedBy: [] },
              { id: 't2', subject: 'Task 2', status: 'in_progress', blockedBy: ['t1'] },
              { id: 't3', subject: 'Task 3', status: 'pending', blockedBy: ['t2'] },
            ],
          },
        },
      },
    },
  };
  const sessionsWithDeps = { list: { getSnapshot: () => stateWithDeps, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const hWithDeps = createHarness({ commands: {} }, sessionsWithDeps);
  const elWithDeps = hWithDeps.view({ sessionId: 's_lead', t: key => key });
  const treeWithDeps = hWithDeps.render(elWithDeps.type, elWithDeps.props);
  const boardWithDeps = hWithDeps.find(treeWithDeps, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);
  const viewWithDeps = boardWithDeps.type(boardWithDeps.props);
  const depsViewWithDeps = hWithDeps.find(viewWithDeps, n => n.props?.className === 'ctm-bd-deps');
  assert.ok(depsViewWithDeps);
  assert.ok(JSON.stringify(depsViewWithDeps).includes('live.longestChain'), '标出最长依赖链');
  assert.ok(JSON.stringify(depsViewWithDeps).includes('#t1') && JSON.stringify(depsViewWithDeps).includes('#t2') && JSON.stringify(depsViewWithDeps).includes('#t3'));
});

test('MVP-A 5: 状态气泡在空闲时显示静态三国台词，有任务时显示 subject 与状态文案', () => {
  const state = {
    byId: {},
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [
              { id: 's_lead', name: 'lead', role: 'lead', phase: 'active' },
              { id: 's_diao', name: 'frontend', role: 'teammate', phase: 'active' },
            ],
            tasks: [
              { id: 't10', subject: 'UI增强', status: 'in_progress', ownerName: 'frontend' },
            ],
          },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);
  const board = h.find(tree, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);
  const view = boardDetailsOf(board);

  // diao-chan 有任务：应显示 UI增强
  const diaoCard = h.find(view, n => n.props?.['data-card'] === 'frontend');
  const diaoBubble = h.find(diaoCard, n => n.props?.className === 'ctm-bd-bubble');
  assert.ok(diaoBubble);
  assert.ok(JSON.stringify(diaoBubble).includes('UI增强'));

  // lead 没有任务：应显示静态台词 (live.quote.lead)
  const leadCard = h.find(view, n => n.props?.['data-card'] === 'lead');
  const leadBubble = h.find(leadCard, n => n.props?.className === 'ctm-bd-bubble');
  assert.ok(leadBubble);
  assert.ok(JSON.stringify(leadBubble).includes('live.quote.lead'));
});

test('卡片无任务且 phase 为 model 时状态气泡文案不重复，且使用 live.busyNoTask', () => {
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
            tasks: [], // 无任务
          },
        },
      },
      m1: {
        values: {
          capabilityTeamActivity: {
            schemaVersion: 1,
            phase: 'model',
            activeCount: 0,
          },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);
  const board = h.find(tree, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);
  const boardTree = boardDetailsOf(board);
  const card = h.find(boardTree, n => n.props?.['data-card'] === 'diao-chan');
  assert.ok(card, 'diao-chan 卡片应存在');

  const bubble = h.find(card, n => n.props?.className === 'ctm-bd-bubble');
  assert.ok(bubble, '气泡应存在');

  // 验证 head 包含 activity.processing，body 包含 live.busyNoTask，且两者绝不相同（避免“正在处理”重复出现）
  const bubbleHead = h.find(bubble, n => n.props?.className === 'ctm-bd-bubble-head');
  const bubbleBody = h.find(bubble, n => n.props?.className?.includes('ctm-bd-bubble-body'));
  assert.ok(bubbleHead);
  assert.ok(bubbleBody);

  const headJson = JSON.stringify(bubbleHead);
  const bodyJson = JSON.stringify(bubbleBody);
  assert.ok(headJson.includes('activity.processing'), '气泡头部标签应为 activity.processing');
  assert.ok(bodyJson.includes('live.busyNoTask'), '气泡正文无任务时应使用 live.busyNoTask');
  assert.equal(bodyJson.includes('activity.processing'), false, '气泡正文绝不重复 activity.processing');
});

test('MVP-A 6 (item 1 regression): 宿主 tokenUsage 伪造的用量必须被忽略，渲染为未知而非假数字', () => {
  const state = {
    byId: {},
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [
              { id: 's_lead', name: 'lead', role: 'lead', phase: 'active' },
              { id: 's_diao', name: 'diao-chan', role: 'teammate', phase: 'active' },
            ],
            tasks: [],
          },
        },
      },
      s_diao: {
        values: {
          // Only the host's generic token-meter projection is present (as if a non-capability-team plugin's
          // tokenUsage leaked into this session's projections); capabilityTeamUsage is absent. The UI must not
          // fall back to this host field for budget/usage display — doing so would silently show fork-skewed
          // numbers that do not correspond to this team's own accounted usage.
          tokenUsage: { uncachedInputTokens: 999999, outputTokens: 999999, cacheReadTokens: 0, cacheWriteTokens: 0 },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const snapshot = {
    team: {
      roles: [
        { id: 'lead', displayName: '孙权', capability: 'orchestrator' },
        { id: 'diao-chan', displayName: '貂蝉', capability: 'frontend', maxTokens: 5000 },
      ],
      modelPolicy: { revision: 0, rows: [] },
    },
  };
  const element = h.view({ sessionId: 's_lead', t: (k, vals) => k + (vals ? JSON.stringify(vals) : ''), load: async () => snapshot });
  const tree = h.render(element.type, { ...element.props, load: async () => snapshot });
  const board = h.find(tree, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);
  const view = boardDetailsOf(board, { ...board.props, roles: snapshot.team.roles });

  const diaoCard = h.find(view, n => n.props?.['data-card'] === 'diao-chan');
  assert.ok(diaoCard);
  // No budget meter bar may be drawn from the host's tokenUsage — it is not capabilityTeamUsage.
  const diaoMeters = h.findAll(diaoCard, n => n.props?.className === 'ctm-us-meter');
  assert.equal(diaoMeters.length, 0, '宿主 tokenUsage 不能驱动预算条，必须视为未知');
  // The fabricated 999999 number must never surface anywhere in this card's rendered tree.
  assert.ok(!JSON.stringify(diaoCard).includes('999999'), '伪造的宿主 tokenUsage 数值不得出现在渲染结果中');
});

test('MVP-A 7 (item 9): 配置模型与"上次请求"模型不一致时双徽章并存，备选与非配置路由区分标注', () => {
  const state = {
    byId: {},
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [
              { id: 's_lead', name: 'lead', role: 'lead', phase: 'active' },
              { id: 's_m1', name: 'm1', role: 'teammate', phase: 'active' },
              { id: 's_m2', name: 'm2', role: 'teammate', phase: 'active' },
            ],
            tasks: [],
          },
        },
      },
      // m1's last request used its declared fallback (e.g. a failover switch happened).
      s_m1: { values: { modelSelection: { next: { provider: 'provider-a', model: 'claude-opus-5-5' } }, capabilityTeamUsage: { routes: [{ route: 'provider-a/claude-opus-5-5' }] } } },
      // m2's last request used a route that is neither the configured primary nor a declared fallback.
      s_m2: { values: { modelSelection: { next: { provider: 'provider-a', model: 'gemini-3.8-flash' } }, capabilityTeamUsage: { routes: [{ route: 'provider-a/gemini-3.8-flash' }] } } },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const roles = [
    { id: 'lead', displayName: '孙权', capability: 'orchestrator' },
    { id: 'm1', displayName: 'm1', capability: 'frontend', provider: 'provider-a', model: 'gpt-6.1-sol', fallbacks: [{ provider: 'provider-a', model: 'claude-opus-5-5' }] },
    { id: 'm2', displayName: 'm2', capability: 'backend', provider: 'provider-a', model: 'gpt-6.1-sol', fallbacks: [] },
  ];
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);
  const board = h.find(tree, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);
  const view = boardDetailsOf(board, { ...board.props, roles });

  // m1: configured gpt-6.1-sol, last request claude-opus-5-5 (its declared fallback) -> both badges, tagged "fallback".
  const m1Card = h.find(view, n => n.props?.['data-card'] === 'm1');
  assert.ok(m1Card);
  const m1Models = h.findAll(m1Card, n => n.props?.className === 'ctm-bd-model');
  assert.equal(m1Models.length, 2, '配置与上次请求不同路由时应渲染两枚徽章');
  assert.ok(JSON.stringify(m1Card).includes('provider-a/gpt-6.1-sol'), '保留配置路由');
  assert.ok(JSON.stringify(m1Card).includes('provider-a/claude-opus-5-5'), '保留上次请求路由');
  assert.ok(JSON.stringify(m1Card).includes('live.fallback'), '命中声明的备选应标注 fallback');

  // m2: configured gpt-6.1-sol, last request gemini-3.8-flash, no declared fallback matches -> tagged "not in config".
  const m2Card = h.find(view, n => n.props?.['data-card'] === 'm2');
  assert.ok(m2Card);
  const m2Models = h.findAll(m2Card, n => n.props?.className === 'ctm-bd-model');
  assert.equal(m2Models.length, 2);
  assert.ok(h.find(m2Card, n => n.props?.['data-route-warn'] === ''), '非声明备选的路由应显示告警标记');

  // lead: no member.model at all -> single badge path still works (regression guard for MVP-A 3).
  const leadCard = h.find(view, n => n.props?.['data-card'] === 'lead');
  const leadModels = h.findAll(leadCard, n => n.props?.className === 'ctm-bd-model');
  assert.equal(leadModels.length, 0, 'lead 既无配置路由也无上次请求路由时不渲染徽章');
});
