import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from './helpers/client-harness.mjs';

// Lead + two teammates: diao-chan is running an edit tool call at 80% context, lv-bu is idle with nothing live.
function fixture() {
  const state = {
    // Listed host summaries carry authoritative running baselines, unlike catalog-only placeholders.
    ids: ['m1', 'm2'],
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
  assert.equal(h.find(boardTree, n => n.props?.className === 'ctm-bd-canvas'), undefined, 'the card canvas below the stage is gone');
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
  assert.equal(byId['diao-chan'].activity, 'writing');
  assert.equal(byId['diao-chan'].activityLabel, 'writing', 'untranslated key falls back to the activity id');
  const zh = stage.type.sprites(stage.props.cards, { live: stage.props.live, t: k => k === 'stage.act.writing' ? '写代码' : k });
  assert.equal(zh.find(s => s.id === 'diao-chan').activityLabel, '写代码', 'plate label comes from t()');
  assert.equal(byId['lv-bu'].activity, 'idle');
  assert.equal(byId['lv-bu'].bubble, '', 'idle members stay quiet');
});

test('活动细分：状态与工具名映射到 thinking/reading/writing/terminal/... ', () => {
  const h = fixture();
  const { stage } = stageNode(h);
  const of = stage.type.activityOf;
  const tool = name => ({ schemaVersion: 1, phase: 'tool', current: { tool: name, status: 'running' }, activeCount: 1 });
  assert.equal(of('inactive', undefined), 'offline');
  assert.equal(of('failed', tool('edit')), 'failed');
  assert.equal(of('provisioning', undefined), 'arriving');
  assert.equal(of('idle', tool('edit')), 'idle', 'a stale running entry never animates an idle member');
  assert.equal(of('running', undefined), 'thinking', 'running without a projection yet → thinking');
  assert.equal(of('running', { schemaVersion: 1, phase: 'model', current: null }), 'thinking');
  assert.equal(of('running', { schemaVersion: 1, phase: 'settled', current: { tool: 'read', status: 'succeeded' } }), 'thinking');
  const table = { read: 'reading', read_image: 'reading', edit: 'writing', write: 'writing', bash: 'terminal', pwsh: 'terminal',
    grep: 'searching', glob: 'searching', web_search: 'browsing', web_fetch: 'browsing', send_message: 'messaging',
    team_task_update: 'board', wait_agent: 'waiting', mystery: 'working' };
  for (const [name, want] of Object.entries(table)) assert.equal(of('running', tool(name)), want, name);
  assert.equal(of('running', { schemaVersion: 2, phase: 'tool', current: { tool: 'edit', status: 'running' } }), 'thinking', 'unknown schema falls back');
  assert.equal(stage.type.toolGlyph('wait_agent'), '⏳');
  assert.equal(stage.type.toolGlyph(''), '');
});

test('气泡：model 阶段显示思考+任务号，工具阶段显示 summary+target，带时长与并行数', () => {
  const h = fixture();
  const { stage } = stageNode(h);
  const card = (id, status, task) => ({ id, name: id, status, task, member: { id: `s_${id}` }, role: { capability: 'backend' } });
  const proj = {
    s_a: { capabilityTeamActivity: { schemaVersion: 1, phase: 'model', current: null, recent: [], activeCount: 0 } },
    s_b: { capabilityTeamActivity: { schemaVersion: 1, phase: 'tool', current: { tool: 'bash', summary: '执行命令', target: null, status: 'running', startedAt: 10_000 }, recent: [], activeCount: 3 } },
    s_c: {},
  };
  const live = { projections: id => proj[id] };
  const since = new Map([['s_a', 4_000]]);
  const [a, b, c] = stage.type.sprites([card('a', 'running', { id: 9, subject: '舞台', status: 'in_progress' }), card('b', 'running'), card('c', 'failed')], { live, since });
  assert.equal(a.activity, 'thinking');
  assert.equal(a.bubble, 'stage.act.thinkingBubble #9 舞台');
  assert.equal(a.bubbleSince, 4_000, 'thinking counts from when the member started running');
  assert.equal(stage.type.bubbleText(a, 9_000), 'stage.act.thinkingBubble #9 舞台 · 5s');
  assert.equal(b.activity, 'terminal');
  assert.equal(b.bubble, '执行命令');
  assert.equal(b.bubbleSince, 10_000, 'tool bubbles count from the call start');
  assert.equal(b.parallel, 3);
  assert.equal(stage.type.bubbleText(b, 75_000, (k, v) => k + (v ? JSON.stringify(v) : '')), '执行命令 · 1:05 stage.parallel');
  assert.equal(c.activity, 'failed');
  assert.equal(c.bubble, 'stage.act.failedBubble');
  assert.equal(c.icon, '❗');
  assert.equal(stage.type.bubbleText({ bubble: '' }, 1), '');
});

test('事件：派活/send_message 飞信、汇报回信、完成庆祝、路由闪烁、上下文冒汗', () => {
  const h = fixture();
  const { stage } = stageNode(h);
  const ev = (a, b) => JSON.parse(JSON.stringify(stage.type.events(a, b))); // VM-realm objects → plain
  const lead = (activity = 'thinking', actKey = '') => ({ id: 'lead', lead: true, status: 'running', activity, actKey, route: 'p/l' });
  const mate = (over = {}) => ({ id: 'm', status: 'idle', activity: 'idle', actKey: '', task: null, route: 'p/m', ctxRatio: .5, ...over });
  const task = { id: 7, status: 'in_progress' };
  assert.deepEqual(ev([lead(), mate()], [lead(), mate({ task })]), [{ type: 'mail', from: 'lead', to: 'm' }], 'task turns in_progress → letter to the teammate');
  assert.deepEqual(ev([lead('messaging', 'c1'), mate()], [lead('messaging', 'c1'), mate({ status: 'running', activity: 'thinking' })]),
    [{ type: 'mail', from: 'lead', to: 'm' }], 'teammate wakes while the Lead is messaging → letter to it');
  assert.deepEqual(ev([lead(), mate()], [lead('messaging', 'c2'), mate()]), [{ type: 'mail', from: 'lead', to: null }], 'Lead messaging with no woken target → broadcast');
  assert.deepEqual(ev([lead(), mate({ status: 'running', activity: 'thinking' })], [lead(), mate({ status: 'running', activity: 'messaging', actKey: 'x' })]),
    [{ type: 'mail', from: 'm', to: 'lead' }], 'teammate send_message → report flies back');
  assert.deepEqual(ev([lead(), mate({ task })], [lead(), mate()]), [{ type: 'celebrate', id: 'm' }], 'in-progress task leaves the teammate → celebrate');
  assert.deepEqual(ev([lead(), mate()], [lead(), mate({ route: 'p/other' })]), [{ type: 'flash', id: 'm' }]);
  assert.deepEqual(ev([lead(), mate()], [lead(), mate({ ctxRatio: .93 })]), [{ type: 'sweat', id: 'm' }]);
  assert.deepEqual(ev([lead(), mate({ ctxRatio: .93 })], [lead(), mate({ ctxRatio: .95 })]), [], 'sweat fires once per crossing');
  assert.deepEqual(ev([lead(), mate()], [lead(), mate()]), [], 'no change → no effect');
  assert.deepEqual(ev([], [lead(), mate({ task })]), [], 'first sync never replays history');
});

test('空闲小动作确定性：同一时间窗结果相同，长时间内既有伸懒腰也有喝咖啡', () => {
  const h = fixture();
  const { stage } = stageNode(h);
  const g = stage.type.idleGesture;
  assert.equal(g('lv-bu', 12_000), g('lv-bu', 15_999), 'same 4 s window → same gesture');
  const seen = new Set(Array.from({ length: 200 }, (_, i) => g('lv-bu', i * 4000)));
  assert.ok(seen.has('stretch') && seen.has('coffee') && seen.has(null), 'mostly still, with occasional stretch/coffee');
});

test('点击精灵后舞台下方显示成员详情卡（复用原卡片结构）', () => {
  const h = fixture();
  const element = h.view({ sessionId: 's_lead', t: key => key });
  const tree = h.render(element.type, { ...element.props, openMember: () => {} });
  const board = h.find(tree, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);
  const plain = board.type(board.props);
  assert.ok(h.find(plain, n => n.props?.className?.includes('ctm-stage-detail-hint')), 'hint row when nothing is selected');
  assert.equal(h.find(plain, n => n.props?.['data-card']), undefined);
  const detail = board.type.detail(board.props, 'diao-chan');
  const card = h.find(detail, n => n.props?.['data-card'] === 'diao-chan');
  assert.ok(card && card.props.className === 'ctm-bd-card' && card.props['data-status'] === 'running');
  assert.ok(JSON.stringify(card).includes('#7') && JSON.stringify(card).includes('client/10-overview.js'), 'status bubble (task id + live tool target) kept');
  assert.ok(h.find(card, n => n.props?.className === 'ctm-us-meter'), 'context meter kept');
  assert.ok(h.find(card, n => n.props?.className === 'ctm-bd-open-btn'), 'open-session button kept');
  const stage = h.find(detail, n => typeof n.type === 'function' && typeof n.type.sprites === 'function');
  assert.equal(stage.props.selected, 'diao-chan', 'selection is mirrored into the scene');
  assert.equal(h.find(board.type.detail(board.props, 'ghost'), n => n.props?.['data-card']), undefined, 'unknown id shows no card');
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
