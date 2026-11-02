import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/client-harness.mjs';

// Lead + two teammates: diao-chan is running an edit tool call at 80% context, lv-bu is idle with nothing live.
function fixture() {
  const state = {
    byId: { m1: { running: true }, m2: { running: false } },
    projectionsBySession: {
      s_lead: { values: { agentTeam: {
        members: [{ id: 's_lead', name: 'lead', role: 'lead', phase: 'active' }, { id: 'm1', name: 'diao-chan', role: 'frontend', phase: 'active' }, { id: 'm2', name: 'lv-bu', role: 'backend', phase: 'active' }],
        tasks: [{ id: 7, subject: '像素舞台', status: 'in_progress', ownerName: 'diao-chan' }],
      } } },
      m1: { values: {
        capabilityTeamActivity: { schemaVersion: 1, phase: 'tool', current: { tool: 'edit', summary: '编辑', target: 'client/10-overview.js', status: 'running' }, recent: [], activeCount: 1 },
        contextPressure: { projectedTokens: 80, contextWindow: 100 },
      } },
      m2: { values: {} },
    },
  };
  const sessions = { list: { getSnapshot: () => state, subscribe: () => () => {} }, refreshProjections: async () => {} };
  return createHarness({ commands: {} }, sessions);
}
function stageNode(h) {
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, element.props);
  const board = h.find(tree, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);
  assert.ok(board, 'TeamBoard should be found');
  const boardTree = h.render(board.type, board.props);
  const stage = h.find(boardTree, n => typeof n.type === 'function' && typeof n.type.sprites === 'function');
  assert.ok(stage, 'OfficeStage should be mounted inside TeamBoard');
  return { stage, boardTree };
}

test('像素办公室挂在团队看板顶部，精灵数据与看板卡片同源', () => {
  const h = fixture();
  const { stage, boardTree } = stageNode(h);
  assert.ok(h.find(boardTree, n => n.props?.className === 'ctm-bd-canvas'), 'the card canvas stays below the stage');
  const sprites = stage.type.sprites(stage.props.cards, { live: stage.props.live, t: k => k, canOpen: true });
  const byId = Object.fromEntries(sprites.map(s => [s.id, s]));
  assert.ok(byId.lead?.lead, 'lead sprite is flagged');
  assert.equal(byId['diao-chan'].status, 'running');
  assert.equal(byId['diao-chan'].task?.id, 7);
  assert.equal(byId['diao-chan'].icon, '✍️', 'edit tool call shows the writing glyph');
  assert.match(byId['diao-chan'].bubble, /client\/10-overview\.js/);
  assert.equal(byId['diao-chan'].ctxRatio, 0.8);
  assert.equal(byId['lv-bu'].status, 'idle');
  assert.equal(byId['lv-bu'].icon, '', 'idle members carry no tool glyph');
  assert.equal(byId['lv-bu'].ctxRatio, null, 'no context pressure projection → no meter');
  assert.equal(byId['lv-bu'].openable, true);
  assert.equal(byId.lead.openable, false, 'the Lead is never opened as a teammate');
});

test('没有 DOM 时只渲染头部与空宿主，不抛错', () => {
  const h = fixture();
  const { stage } = stageNode(h);
  h.resetState(); // the stage is rendered on its own here, so it must not inherit the overview's hook slots
  const tree = h.render(stage.type, stage.props);
  assert.equal(tree.props.className, 'ctm-stage');
  assert.ok(h.find(tree, n => n.props?.className === 'ctm-stage-office'), 'expanded by default');
  assert.ok(h.find(tree, n => n.props?.className === 'ctm-stage-canvas'));
  const summary = h.find(tree, n => typeof n.children?.[0] === 'string' && n.children[0].startsWith('stage.summary'));
  assert.ok(summary, 'seated summary is rendered through t()');
  assert.equal(h.find(tree, n => n.props?.className?.includes('ctm-stage-empty')), undefined, 'a formed team shows no empty hint');
});

test('配色由角色 id 决定，道具由能力决定，与主题人名无关', () => {
  const h = fixture();
  const { stage } = stageNode(h);
  const a = stage.type.palette('lv-bu', 'backend'), b = stage.type.palette('lv-bu', 'backend'), c = stage.type.palette('zhao-yun', 'research');
  assert.deepEqual(a, b, 'same id → same look');
  assert.notEqual(a.robe, c.robe, 'different ids differ');
  assert.equal(a.prop, 'gear');
  assert.equal(c.prop, 'glass');
  assert.equal(stage.type.palette('x', 'unknown-capability').prop, 'none');
  for (const key of ['robe', 'leg', 'hat', 'accent']) assert.match(a[key], /^hsl\(/);
});
