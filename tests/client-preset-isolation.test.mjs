import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/client-harness.mjs';

test('预设隔离 1: 非能力团队预设会话（agentPreset: standard）下，插槽显示未挂载空状态，不渲染团队看板', () => {
  const state = {
    byId: {
      s_other: { running: true, preset: 'standard' },
    },
    projectionsBySession: {
      s_other: {
        values: {
          agentPreset: 'standard',
          agentTeam: {
            members: [
              { id: 's_other', name: 'lead', role: 'lead' },
              { id: 's_sub', name: 'worker', role: 'teammate' },
            ],
            tasks: [],
          },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);

  const element = h.view({ sessionId: 's_other', t: key => key });
  const tree = typeof element?.type === 'function' ? h.render(element.type, element.props) : element;

  // 插槽本身直接返回未挂载空状态
  const notMountedNode = h.find(tree, n => n.props?.className?.includes('ctm-not-mounted') || n.props?.['data-ctm-not-mounted'] !== undefined);
  assert.ok(notMountedNode, '应该渲染未挂载空状态节点');

  // 绝不能渲染团队看板
  const board = h.find(tree, n => typeof n.type === 'function' && n.props?.roles && 'activity' in n.props);
  assert.equal(board, undefined, '非本预设会话不应该渲染团队看板');
});

test('预设隔离 2: 能力团队预设会话（agentPreset: capability-team）下，正常渲染总览与看板', () => {
  const state = {
    byId: {
      s_ctm: { running: true, preset: 'capability-team' },
    },
    projectionsBySession: {
      s_ctm: {
        values: {
          agentPreset: 'capability-team',
          agentTeam: {
            members: [
              { id: 's_ctm', name: 'lead', role: 'lead' },
              { id: 's_fe', name: 'diao-chan', role: 'teammate' },
            ],
            tasks: [],
          },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);

  const element = h.view({ sessionId: 's_ctm', t: key => key });
  const tree = h.render(element.type, element.props);

  const board = h.find(tree, n => typeof n.type === 'function' && n.props?.roles && 'activity' in n.props);
  assert.ok(board, '能力团队会话应该正常渲染团队看板');
});

test('预设隔离 3: 非本预设会话即使有 agentTeam 投影，也不调用 live.children 且不自动调用 refresh', async () => {
  let childrenCalled = false;
  let refreshCalled = false;
  const state = {
    byId: {},
    projectionsBySession: {
      s_foreign: {
        values: {
          agentPreset: 'other-preset',
          agentTeam: {
            members: [
              { id: 's_foreign', name: 'lead', role: 'lead' },
              { id: 's_other', name: 'helper', role: 'teammate' },
            ],
            tasks: [],
          },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const fakeLive = {
    isCapabilityTeam: id => id === 's_foreign' ? false : undefined,
    parentSessionId: () => undefined,
    isOrphanSubagent: () => false,
    projections: id => state.projectionsBySession[id]?.values,
    subscribe: () => () => {},
    rosterVersion: () => 0,
    children: async () => {
      childrenCalled = true;
      return [];
    },
  };
  const fakeLoad = async () => {
    refreshCalled = true;
    return { preset: 'other-preset', ready: false };
  };

  const h = createHarness({ commands: {} }, sessions, { runEffects: true });
  // 直接以 Overview 形式渲染测试组件内 useEffect 行为
  const element = h.view({ sessionId: 's_foreign', t: key => key, live: fakeLive, load: fakeLoad });
  if (typeof element?.type === 'function') {
    h.render(element.type, element.props);
  }

  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(childrenCalled, false, '非本预设会话绝不调用 live.children');
  assert.equal(refreshCalled, false, '非本预设会话绝不自动调用 load/refresh');
});

test('预设隔离 4: 能力团队会话在 formed 状态下自动调用 children 与 refresh', async () => {
  let childrenCalled = false;
  let refreshCalled = false;
  const state = {
    byId: {},
    projectionsBySession: {
      s_ctm_lead: {
        values: {
          agentPreset: 'capability-team',
          agentTeam: {
            members: [
              { id: 's_ctm_lead', name: 'lead', role: 'lead' },
              { id: 's_ctm_fe', name: 'diao-chan', role: 'teammate' },
            ],
            tasks: [],
          },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const fakeLive = {
    isCapabilityTeam: id => id === 's_ctm_lead' ? true : undefined,
    parentSessionId: () => undefined,
    isOrphanSubagent: () => false,
    projections: id => state.projectionsBySession[id]?.values,
    subscribe: () => () => {},
    rosterVersion: () => 0,
    children: async () => {
      childrenCalled = true;
      return [];
    },
  };
  const fakeLoad = async () => {
    refreshCalled = true;
    return { preset: 'capability-team', ready: true, team: { roles: [] } };
  };

  const h = createHarness({ commands: {} }, sessions, { runEffects: true });
  const element = h.view({ sessionId: 's_ctm_lead', t: key => key, live: fakeLive, load: fakeLoad });
  h.render(element.type, element.props);

  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(childrenCalled, true, '本预设会话应自动调用 children');
  assert.equal(refreshCalled, true, '本预设会话形成团队时应自动调用 load/refresh');
});

test('预设隔离 5: 子智能体通过 parentSessionId 继承父会话的 capability-team 预设并正常显示', () => {
  const state = {
    byId: {
      s_lead: { running: true, preset: 'capability-team' },
      s_sub: { running: true },
    },
    projectionsBySession: {
      s_lead: {
        values: {
          agentPreset: 'capability-team',
          agentTeam: {
            members: [
              { id: 's_lead', name: 'lead', role: 'lead' },
              { id: 's_sub', name: 'diao-chan', role: 'teammate' },
            ],
            tasks: [],
          },
        },
      },
      s_sub: {
        values: {
          agentTeam: { parentSessionId: 's_lead' },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);

  const element = h.view({ sessionId: 's_sub', t: key => key });
  const tree = typeof element?.type === 'function' ? h.render(element.type, element.props) : element;

  // 子智能体应该识别父会话是 capability-team，进入正常的角色视图（身份栏），而不是未挂载空状态
  const notMountedNode = h.find(tree, n => n.props?.['data-ctm-not-mounted'] !== undefined);
  assert.equal(notMountedNode, undefined, '队友子会话不应被误判为未挂载');

  const teammateBar = h.find(tree, n => n.props?.className?.includes('ctm-teammate-bar'));
  assert.ok(teammateBar, '子会话应正常渲染队友身份栏');
});
