import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, boardDetailsOf } from './helpers/client-harness.mjs';

test('MVP-B 1: Activity 投影未知 schemaVersion 显示 "版本不支持"', () => {
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
          capabilityTeamActivity: {
            schemaVersion: 999, // unsupported
            phase: 'tool',
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
  assert.ok(board, 'TeamBoard should be found');
  const boardTree = boardDetailsOf(board);
  const card = h.find(boardTree, n => n.props?.['data-card'] === 'diao-chan');
  assert.ok(card, 'diao-chan card should exist');
  const unsupported = h.find(card, n => JSON.stringify(n).includes('version.unsupported'));
  assert.ok(unsupported, 'Should display version unsupported message');
});

test('MVP-B 2: Activity 并行 activeCount > 1 显示并行工具数且不显示"全部完成"', () => {
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
          capabilityTeamActivity: {
            schemaVersion: 1,
            phase: 'tool',
            activeCount: 3,
            current: { tool: 'edit', summary: 'Editing files', target: 'client.js' },
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
  assert.ok(card, 'card should exist');
  const str = JSON.stringify(card);
  assert.ok(str.includes('activity.parallel'), 'Should display parallel tool badge');
  assert.equal(str.includes('全部完成'), false, 'Must never claim all completed');
});

test('MVP-B 3: 成员非 running 但条目仍为 running 时标记 "历史未收尾"', () => {
  const state = {
    byId: { m1: { running: false } }, // member is stopped/idle
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
          capabilityTeamActivity: {
            schemaVersion: 1,
            phase: 'tool',
            activeCount: 0,
            current: { status: 'running', summary: 'Orphaned task', target: 'index.js' },
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
  assert.ok(card, 'card should exist');
  assert.ok(JSON.stringify(card).includes('activity.unsettled'), 'Should mark unsettled historical item');
});

test('MVP-B 4: 运行时冷却倒计时到 0 隐藏，不自称已恢复/健康', () => {
  const state = {
    byId: { m1: { running: false } },
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
    },
  };
  const runtimeFuture = {
    data: {
      schemaVersion: 1,
      members: [
        {
          sessionId: 'm1',
          cooling: [{ route: 'provider-a/gemini-3.8-flash-high', until: Date.now() + 5000 }],
        },
      ],
    },
  };
  const runtimeExpired = {
    data: {
      schemaVersion: 1,
      members: [
        {
          sessionId: 'm1',
          cooling: [{ route: 'provider-a/gemini-3.8-flash-high', until: Date.now() - 5000 }],
        },
      ],
    },
  };

  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);
  const board = h.find(tree, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);

  // Future cooling: renders badge
  const boardTree1 = boardDetailsOf(board, { ...board.props, runtimeState: runtimeFuture });
  const card1 = h.find(boardTree1, n => n.props?.['data-card'] === 'diao-chan');
  assert.ok(JSON.stringify(card1).includes('runtime.cooling'), 'Future cooling shows countdown badge');

  // Expired cooling: hides badge, never says "healthy" or "recovered"
  const boardTree2 = boardDetailsOf(board, { ...board.props, runtimeState: runtimeExpired });
  const card2 = h.find(boardTree2, n => n.props?.['data-card'] === 'diao-chan');
  assert.equal(JSON.stringify(card2).includes('runtime.cooling'), false, 'Expired cooling hides badge');
  assert.equal(JSON.stringify(card2).includes('healthy'), false);
  assert.equal(JSON.stringify(card2).includes('recovered'), false);
  assert.equal(JSON.stringify(card2).includes('已恢复'), false);
  assert.equal(JSON.stringify(card2).includes('正常'), false);
});

test('MVP-B 5: 路由切换按 id 去重，显示原因 (容灾/长上下文 + code/status) 且不妄言切换成功', () => {
  const state = {
    byId: { m1: { running: false } },
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
    },
  };
  const runtimeWithSwitches = {
    data: {
      schemaVersion: 1,
      members: [
        {
          sessionId: 'm1',
          switches: [
            {
              id: 'sw1',
              from: { provider: 'provider-a', model: 'gemini-3.8-flash-high' },
              to: { provider: 'provider-a', model: 'gpt-6.1-sol' },
              reason: 'failover',
              code: 'quota_exceeded',
              status: 429,
            },
            {
              id: 'sw1', // Duplicate ID
              from: { provider: 'provider-a', model: 'gemini-3.8-flash-high' },
              to: { provider: 'provider-a', model: 'gpt-6.1-sol' },
              reason: 'failover',
              code: 'quota_exceeded',
              status: 429,
            },
          ],
        },
      ],
    },
  };

  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);
  const board = h.find(tree, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);
  const boardTree = boardDetailsOf(board, { ...board.props, runtimeState: runtimeWithSwitches });
  const card = h.find(boardTree, n => n.props?.['data-card'] === 'diao-chan');
  assert.ok(card, 'Card exists');
  const switches = h.findAll(card, n => n.props?.className === 'ctm-bd-switch');
  assert.equal(switches.length, 1, 'Duplicate switch must be deduplicated by id');
  const sText = JSON.stringify(switches[0]);
  assert.ok(sText.includes('provider-a/gemini-3.8-flash-high'), 'Route preserved without splitting model');
  assert.ok(sText.includes('quota_exceeded/429'), 'Details formatted');
  assert.equal(sText.includes('成功'), false, 'Never claims switch succeeded');
});

test('MVP-B 6: 成果货架 (artifacts) 按 (at, sessionId, presentSeq, fileIndex) 降序排序且上限 100', () => {
  const items = [];
  for (let i = 0; i < 150; i++) {
    items.push({
      path: `file_${i}.txt`,
      presentSeq: i,
      fileIndex: 0,
      at: 1000 + i,
      sessionId: 'm1',
    });
  }
  const state = {
    byId: { m1: { running: false } },
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
          capabilityTeamArtifacts: {
            schemaVersion: 1,
            items,
          },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);
  const artPanel = h.find(tree, n => n.props?.['data-panel'] === 'artifacts');
  assert.ok(artPanel, 'Artifacts panel should exist');
  const rack = h.find(artPanel, n => typeof n.type === 'function' && 'sessionId' in n.props);
  const rackTree = rack.type(rack.props);
  const cards = h.findAll(rackTree, n => n.props?.className === 'ctm-art-card');
  assert.equal(cards.length, 100, 'Must cap at 100 items');
  // First item should be the highest (at: 1149)
  const firstPath = h.find(cards[0], n => n.props?.className === 'ctm-art-path');
  assert.equal(firstPath.children[0], 'file_149.txt');
});

test('MVP-B 7: 成果货架打开文件使用 POST /api/present.open 携带 presentSeq 与 fileIndex', async () => {
  const fetchCalls = [];
  const fakeFetch = async (url, opts) => {
    fetchCalls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const state = {
    byId: { m1: { running: false } },
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [{ id: 'm1', name: 'diao-chan', role: 'frontend' }],
          },
        },
      },
      m1: {
        values: {
          capabilityTeamArtifacts: {
            schemaVersion: 1,
            items: [{ path: 'dist/app.js', presentSeq: 42, fileIndex: 1, at: 1000, sessionId: 'm1' }],
          },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions, { extraGlobals: { fetch: fakeFetch } });
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);
  const artPanel = h.find(tree, n => n.props?.['data-panel'] === 'artifacts');
  const rack = h.find(artPanel, n => typeof n.type === 'function' && 'sessionId' in n.props);
  const rackTree = rack.type(rack.props);
  const openBtn = h.find(rackTree, n => n.type === 'button' && n.children?.some(c => typeof c === 'string' && c.includes('artifacts.openDesktop')));
  assert.ok(openBtn, 'Open desktop button should exist');
  await openBtn.props.onClick();
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].opts?.method, 'POST');
  assert.ok(fetchCalls[0].url.includes('api/present.open?sessionId=m1&seq=42&index=1'));
  assert.equal(fetchCalls[0].url.startsWith('/'), false, 'Must be document-relative URL');
});

test('MVP-B 8: 本会话变更 diff 遇到 404 显示 "基线已失效" 而非空 diff', async () => {
  const fakeFetch = async url => {
    if (url.includes('api/changes.summary')) {
      return { ok: true, status: 200, json: async () => ({ files: [{ path: 'client.js' }] }) };
    }
    if (url.includes('api/changes.diff')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: false, status: 500 };
  };
  const state = {
    byId: { m1: { running: false } },
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [{ id: 'm1', name: 'diao-chan', role: 'frontend' }],
          },
        },
      },
      m1: {
        values: {
          capabilityTeamArtifacts: {
            schemaVersion: 1,
            changes: [{ seq: 10, turn: 2, at: 2000 }],
          },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions, { extraGlobals: { fetch: fakeFetch } });
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);
  const artPanel = h.find(tree, n => n.props?.['data-panel'] === 'artifacts');
  const rack = h.find(artPanel, n => typeof n.type === 'function' && 'sessionId' in n.props);
  let rackTree = rack.type(rack.props);
  const chgItem = h.find(rackTree, n => n.props?.className === 'ctm-chg-item');
  assert.ok(chgItem, 'Changes details item should exist');
  await chgItem.props.onToggle({ target: { open: true } });
  // Wait for all microtasks in handleToggleChange to complete
  await new Promise(r => setTimeout(r, 20));
  const newTree = h.render(element.type, element.props);
  const newArt = h.find(newTree, n => n.props?.['data-panel'] === 'artifacts');
  // The artifacts panel now wraps its content in an ErrorBoundary (also typeof 'function', being a class);
  // require the ArtifactsRack-specific `sessionId` prop so this does not match that wrapper instead.
  const newRack = h.find(newArt, n => typeof n.type === 'function' && 'sessionId' in n.props);
  const finalRackTree = newRack.type(newRack.props);
  assert.ok(JSON.stringify(finalRackTree).includes('artifacts.baselineInvalid'), 'Should render "基线已失效" when diff returns 404');
});

test('MVP-B 9: 战报 (report) 仅 Lead 取 boardMutations（非 Lead 显示 "—"），缓存读取单独列出，且禁止评级/人民币成本', () => {
  const state = {
    byId: { s_lead: { running: false }, m1: { running: false } },
    projectionsBySession: {
      s_lead: {
        values: {
          agentTeam: {
            members: [
              { id: 's_lead', name: 'lead', role: 'lead' },
              { id: 'm1', name: 'diao-chan', role: 'frontend' },
            ],
          },
          capabilityTeamReport: {
            schemaVersion: 1,
            turns: 5,
            steps: 20,
            completedTurnMs: 50000,
            firstTurnAt: 1000,
            lastTurnEndAt: 60000,
            usage: {
              uncachedInputTokens: 1000,
              cacheReadTokens: 5000,
              cacheWriteTokens: 200,
              outputTokens: 800,
            },
            counters: {
              boardMutations: 7,
            },
          },
        },
      },
      m1: {
        values: {
          capabilityTeamReport: {
            schemaVersion: 1,
            turns: 3,
            steps: 10,
            completedTurnMs: 30000,
            usage: {
              uncachedInputTokens: 500,
              cacheReadTokens: 2000,
              cacheWriteTokens: 100,
              outputTokens: 400,
            },
            counters: {
              boardMutations: 999, // Should NOT be taken because m1 is not lead
            },
          },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);
  const rptPanel = h.find(tree, n => n.props?.['data-panel'] === 'report');
  assert.ok(rptPanel, 'Report panel should exist');
  const reportComponent = h.find(rptPanel, n => typeof n.type === 'function' && 'sessionId' in n.props);
  const reportTree = reportComponent.type(reportComponent.props);

  // Verify boardMutations took lead value (7) and not sum (1006)
  const mutationBox = h.find(reportTree, n => n.props?.className === 'ctm-rpt-box' && JSON.stringify(n).includes('report.mutations'));
  assert.ok(mutationBox, 'Mutation metric box should exist');
  const val = h.find(mutationBox, n => n.type === 'strong');
  assert.equal(val.children[0], '7');

  // Verify cacheRead is separated
  const cacheBox = h.find(reportTree, n => n.props?.className === 'ctm-rpt-box' && JSON.stringify(n).includes('report.cacheRead'));
  assert.ok(cacheBox, 'Cache read box should exist');

  // Verify absence of prohibited rating / RMB cost
  const forbiddenRmb = h.find(reportTree, n => typeof n === 'string' && (n.includes('¥') || n.includes('元') || n.includes('RMB') || n.includes('成本')));
  assert.equal(forbiddenRmb, undefined, 'Must not display RMB cost');
  const forbiddenRating = h.find(reportTree, n => typeof n === 'string' && (n.includes('评级') || n.includes('评分') || n.includes('★')));
  assert.equal(forbiddenRating, undefined, 'Must not display agent rating');
});

test('MVP-B 10: 缺少 Lead 时 boardMutations 显示 "—" 而非 0', () => {
  const state = {
    byId: { m1: { running: false } },
    projectionsBySession: {
      s_sub: {
        values: {
          agentTeam: {
            members: [{ id: 'm1', name: 'diao-chan', role: 'frontend' }],
          },
        },
      },
      m1: {
        values: {
          capabilityTeamReport: {
            schemaVersion: 1,
            counters: { boardMutations: 12 },
          },
        },
      },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  const h = createHarness({ commands: {} }, sessions);
  const element = h.view({ sessionId: 's_sub', t: key => key });
  const tree = h.render(element.type, element.props);
  const rptPanel = h.find(tree, n => n.props?.['data-panel'] === 'report');
  const reportComponent = h.find(rptPanel, n => typeof n.type === 'function' && 'sessionId' in n.props);
  const reportTree = reportComponent.type(reportComponent.props);
  const mutationBox = h.find(reportTree, n => n.props?.className === 'ctm-rpt-box' && JSON.stringify(n).includes('report.mutations'));
  const val = h.find(mutationBox, n => n.type === 'strong');
  assert.equal(val.children[0], '—');
});
