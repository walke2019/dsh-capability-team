import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
function harness(remote = { commands: {} }) {
  let plugin, cursor = 0, states = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return states[index] ??= { current: initial }; },
    useEffect() {},
  };
  new Script(readFileSync(new URL('../client.js', import.meta.url), 'utf8')).runInNewContext({ window: { __ModuleLoader__: { load: spec => { plugin = spec.factory(() => React); } } } });
  let view;
  plugin.apply({ effect() {}, locale: { bind: () => key => key }, remote, slots: {
    inject: (_name, fn) => fn(), register(options, component) { if (options.id === 'capability-team-overview') view = component; },
  } });
  const render = (component, props) => { cursor = 0; return component(props); };
  const reset = () => { states = []; cursor = 0; };
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return undefined;
    if (predicate(node)) return node;
    for (const child of node.children ?? []) { const result = find(child, predicate); if (result) return result; }
  };
  return { view, render, reset, find };
}
async function editorFixture(save) {
  const h = harness();
  const policy = { revision: 3, disabledRoutes: [], rows: [{ key: 'p/m', tiers: ['upper'], primaryFor: ['qa'], fallbackFor: [] }] };
  const props = { sessionId: 'fixture', t: key => key, save, load: async () => ({ team: { roles: [], modelPolicy: policy }, requestEvidence: { records: [] } }) };
  const overview = h.view(props).type;
  let tree = h.render(overview, props);
  await h.find(tree, n => n.type === 'button').props.onClick();
  tree = h.render(overview, props);
  const editor = h.find(tree, n => typeof n.type === 'function' && n.props.policy);
  h.reset();
  return { ...h, editor, draw: () => h.render(editor.type, editor.props) };
}
test('总览默认模型分区，面板独立滚动，切换不卸载编辑器', async () => {
  const h = harness();
  const props = { sessionId: 'layout-fixture', t: key => key, load: async () => ({ team: { roles: [], modelPolicy: { revision: 0, rows: [] } }, requestEvidence: { records: [] } }) };
  const overview = h.view(props).type;
  let tree = h.render(overview, props);
  await h.find(tree, n => n.type === 'button').props.onClick();
  tree = h.render(overview, props);
  assert.equal(tree.props.className, 'ctm-ov');
  assert.ok(h.find(tree, n => n.props.className === 'ctm-ov-scroll'));
  const panel = h.find(tree, n => n.props['data-panel'] === 'models');
  assert.equal(panel.props.hidden, false);
  const editor = h.find(panel, n => typeof n.type === 'function' && n.props.policy);
  const logs = h.find(tree, n => n.type === 'button' && n.children.includes('nav.logs'));
  logs.props.onClick();
  tree = h.render(overview, props);
  assert.equal(h.find(tree, n => n.props['data-panel'] === 'models').props.hidden, true);
  assert.equal(h.find(tree, n => typeof n.type === 'function' && n.props.policy).type, editor.type);
  assert.equal(h.find(tree, n => n.type === 'button' && n.children.includes('nav.logs')).props['aria-pressed'], true);
});
test('关闭开关只改草稿，保存携带版本，成功后禁止重复保存', async () => {
  const calls = [];
  const f = await editorFixture(async (...args) => { calls.push(args); return { revision: 4, disabledRoutes: ['p/m'] }; });
  let tree = f.draw();
  assert.equal(f.find(tree, n => n.type === 'button').props.disabled, true);
  f.find(tree, n => n.props.role === 'switch').props.onChange({ target: { checked: false } });
  assert.equal(calls.length, 0);
  tree = f.draw();
  await f.find(tree, n => n.type === 'button').props.onClick();
  assert.equal(calls[0][0], 'fixture'); assert.equal(calls[0][2], 3);
  assert.equal(JSON.stringify(calls[0][1]), '["p/m"]');
  tree = f.draw();
  assert.equal(f.find(tree, n => n.type === 'button').props.disabled, true);
  assert.ok(f.find(tree, n => n.props.role === 'status'));
});
test('读取旧会话的迟到结果不会显示到新会话', async () => {
  const h = harness(); let finish;
  const props = { sessionId: 'old', t: key => key, load: () => new Promise(resolve => { finish = resolve; }) };
  const overview = h.view(props).type;
  let tree = h.render(overview, props);
  const pending = h.find(tree, n => n.type === 'button').props.onClick();
  tree = h.render(overview, { ...props, sessionId: 'new' });
  finish({ explanation: 'old-session-only', requestEvidence: { records: [] } });
  await pending;
  tree = h.render(overview, { ...props, sessionId: 'new' });
  assert.equal(JSON.stringify(tree).includes('old-session-only'), false);
});
test('保存冲突保留草稿并显示错误，不假报成功', async () => {
  const f = await editorFixture(async () => { throw new Error('版本冲突'); });
  let tree = f.draw();
  f.find(tree, n => n.props.role === 'switch').props.onChange({ target: { checked: false } });
  tree = f.draw(); await f.find(tree, n => n.type === 'button').props.onClick();
  tree = f.draw();
  assert.equal(f.find(tree, n => n.props.role === 'switch').props.checked, false);
  assert.ok(f.find(tree, n => n.props.role === 'alert'));
  assert.equal(f.find(tree, n => n.props.role === 'status'), undefined);
});

test('刷新中或刷新失败不卸载已有模型编辑器，保留草稿状态', async () => {
  const h = harness(); let rejectRefresh;
  const props = { sessionId: 'fixture-refresh', t: key => key, load: async () => ({ team: { roles: [], modelPolicy: { revision: 0, rows: [] } } }) };
  const overview = h.view(props).type;
  let tree = h.render(overview, props);
  await h.find(tree, n => n.type === 'button').props.onClick();
  tree = h.render(overview, props);
  const editor = h.find(tree, n => typeof n.type === 'function' && n.props.policy);
  const refreshProps = { ...props, load: () => new Promise((_, reject) => { rejectRefresh = reject; }) };
  tree = h.render(overview, refreshProps);
  const pending = h.find(tree, n => n.type === 'button').props.onClick();
  tree = h.render(overview, refreshProps);
  assert.equal(h.find(tree, n => typeof n.type === 'function' && n.props.policy)?.type, editor.type);
  rejectRefresh(new Error('fixture offline')); await pending;
  tree = h.render(overview, refreshProps);
  assert.equal(h.find(tree, n => typeof n.type === 'function' && n.props.policy)?.props.key, editor.props.key);
  assert.ok(h.find(tree, n => n.props.role === 'alert'));
});

test('档位横向标签默认首个档位，只筛选显示，不改变草稿', async () => {
  const h = harness();
  const policy = { revision: 1, disabledRoutes: [], rows: [
    { key: 'p/a', tiers: ['high'], primaryFor: [], fallbackFor: [] },
    { key: 'p/b', tiers: ['low'], primaryFor: [], fallbackFor: [] }] };
  const props = { sessionId: 'tiers', t: key => key, load: async () => ({ team: { roles: [], modelPolicy: policy } }) };
  const overview = h.view(props).type;
  let tree = h.render(overview, props);
  await h.find(tree, n => n.type === 'button').props.onClick();
  tree = h.render(overview, props);
  const editor = h.find(tree, n => typeof n.type === 'function' && n.props.policy);
  h.reset();
  const switches = node => { const out = []; const walk = n => { if (!n || typeof n !== 'object') return; if (n.props?.role === 'switch') out.push(n); (n.children ?? []).flat(Infinity).forEach(walk); }; walk(node); return out; };
  let view = h.render(editor.type, editor.props);
  assert.deepEqual(switches(view).map(n => n.props['aria-label']), ['models.enabled p/a']);
  h.find(view, n => n.props?.role === 'tab' && n.children.includes('models.allTiers')).props.onClick();
  view = h.render(editor.type, editor.props);
  assert.equal(switches(view).length, 2);
  h.find(view, n => n.props?.role === 'tab' && n.children.includes('low')).props.onClick();
  view = h.render(editor.type, editor.props);
  assert.deepEqual(switches(view).map(n => n.props['aria-label']), ['models.enabled p/b']);
  assert.equal(h.find(view, n => n.type === 'button').props.disabled, true);
});

test('工作台按角色id匹配队友实时状态，未启动角色显示配置模型', async () => {
  const h = harness();
  const roles = [{ id: 'lead', displayName: 'L', capability: 'orchestrator' }, { id: 'qa', displayName: 'Q', capability: 'qa', provider: 'p', model: 'cfg' }, { id: 'fe', displayName: 'F', capability: 'frontend' }];
  const activity = { members: [{ id: 's1', name: 'lead', role: 'lead', status: 'idle', diagnostics: [] }, { id: 's2', name: 'qa', role: 'teammate', status: 'running', provider: 'p', model: 'live', diagnostics: [] }],
    tasks: [{ id: 7, subject: '回归测试', status: 'in_progress', ownerName: 'qa' }] };
  const props = { sessionId: 'board', t: key => key, activity: async () => activity,
    load: async () => ({ preset: 'capability-team', activity, team: { roles, modelPolicy: { revision: 0, rows: [], allocations: [{ id: 'fe', primary: 'p/fe-model' }] } } }) };
  const overview = h.view(props).type;
  let tree = h.render(overview, props);
  await h.find(tree, n => n.type === 'button').props.onClick();
  tree = h.render(overview, props);
  const board = h.find(tree, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);
  const view = board.type(board.props);
  const card = status => h.find(view, n => n.props?.className === 'ctm-bd-card' && n.props['data-status'] === status);
  assert.ok(JSON.stringify(card('running')).includes('回归测试'));
  assert.ok(JSON.stringify(card('running')).includes('p/live'));
  assert.ok(JSON.stringify(card('inactive')).includes('p/fe-model'));
  assert.ok(card('idle'));
  assert.equal(card('running').props['data-delegated'], '');
  assert.equal(card('inactive').props['data-delegated'], undefined);
  assert.equal(card('idle').props['data-delegated'], undefined);
  const canvas = h.find(view, n => n.props?.className === 'ctm-bd-canvas');
  assert.ok(canvas.props.ref && h.find(canvas, n => typeof n.type === 'function' && Array.isArray(n.props.links)));
});

test('大目录分页渲染，在用模型排在前面', async () => {
  const h = harness();
  const rows = Array.from({ length: 100 }, (_, i) => ({ key: `p/m${i}`, tiers: ['low'], primaryFor: i === 99 ? ['qa'] : [], fallbackFor: [] }));
  const props = { sessionId: 'big', t: key => key, load: async () => ({ team: { roles: [], modelPolicy: { revision: 0, disabledRoutes: [], rows } } }) };
  const overview = h.view(props).type;
  let tree = h.render(overview, props);
  await h.find(tree, n => n.type === 'button').props.onClick();
  tree = h.render(overview, props);
  const editor = h.find(tree, n => typeof n.type === 'function' && n.props.policy);
  h.reset();
  const count = node => JSON.stringify(node).split('"role":"switch"').length - 1;
  let view = h.render(editor.type, editor.props);
  assert.equal(count(view), 40);
  assert.ok(JSON.stringify(view).indexOf('p/m99') < JSON.stringify(view).indexOf('p/m0"'));
  h.find(view, n => n.props?.className === 'ctm-btn ctm-ov-more').props.onClick();
  view = h.render(editor.type, editor.props);
  assert.equal(count(view), 100);
});

test('面板渲染不执行命令，仅点击时读取一次；宿主推送的运行状态实时更新卡片', async () => {
  const handlers = {}; const lines = [];
  const snapshot = { preset: 'capability-team', ready: true, memberEvidence: [],
    activity: { members: [{ id: 's1', name: 'lead', role: 'lead', status: 'idle', diagnostics: [] }, { id: 's2', name: 'qa', role: 'teammate', status: 'idle', diagnostics: [] }], tasks: [] },
    team: { roles: [{ id: 'lead', displayName: 'L', capability: 'orchestrator' }, { id: 'qa', displayName: 'Q', capability: 'qa' }],
      modelPolicy: { revision: 0, disabledRoutes: [], allocations: [], rows: [['p/m', 'low', ['qa']]] } } };
  const remote = { $on: (event, fn) => { handlers[event] = fn; },
    commands: { execute: async (_id, line) => { lines.push(line); return { ok: true, value: { result: { kind: 'success', text: JSON.stringify(snapshot) } } }; } } };
  const h = harness(remote);
  const props = { sessionId: 's1', t: key => key };
  const element = h.view(props);
  let tree = h.render(element.type, element.props);
  assert.deepEqual(lines, []);
  await h.find(tree, n => n.type === 'button').props.onClick();
  assert.deepEqual(lines, ['/capability-status']);
  tree = h.render(element.type, element.props);
  const editor = h.find(tree, n => typeof n.type === 'function' && n.props.policy);
  assert.equal(editor.props.policy.rows[0].key, 'p/m');
  assert.equal(JSON.stringify(editor.props.policy.rows[0].primaryFor), '["qa"]');
  handlers['api-session/status']('s2', true);
  tree = h.render(element.type, element.props);
  const board = h.find(tree, n => typeof n.type === 'function' && n.props.roles && 'activity' in n.props);
  const view = board.type(board.props);
  assert.ok(h.find(view, n => n.props?.className === 'ctm-bd-card' && n.props['data-status'] === 'running'));
  assert.deepEqual(lines, ['/capability-status']);
});

test('按前缀排除：预览匹配数、加入草稿并随保存提交，被规则覆盖的模型开关锁定', async () => {
  const calls = [];
  const h = harness();
  const policy = { revision: 5, disabledRoutes: [], rows: [
    { key: 'cpa/@cf/a', tiers: ['low'], primaryFor: [], fallbackFor: [] },
    { key: 'win/@cf/b', tiers: ['low'], primaryFor: [], fallbackFor: [] },
    { key: 'cpa/keep', tiers: ['low'], primaryFor: [], fallbackFor: [] }] };
  const props = { sessionId: 'rules', t: key => key, save: async (...args) => { calls.push(args); return { revision: 6, disabledRoutes: args[1] }; },
    load: async () => ({ team: { roles: [], modelPolicy: policy } }) };
  const overview = h.view(props).type;
  let tree = h.render(overview, props);
  await h.find(tree, n => n.type === 'button').props.onClick();
  tree = h.render(overview, props);
  const editor = h.find(tree, n => typeof n.type === 'function' && n.props.policy);
  h.reset();
  let view = h.render(editor.type, editor.props);
  h.find(view, n => n.props?.placeholder === 'models.prefixPlaceholder').props.onChange({ target: { value: '@cf/' } });
  view = h.render(editor.type, editor.props);
  assert.ok(JSON.stringify(view).includes('models.prefixPreview'));
  h.find(view, n => n.type === 'button' && n.children.includes('models.prefixAdd')).props.onClick();
  view = h.render(editor.type, editor.props);
  const switches = [];
  (function walk(n) { if (!n || typeof n !== 'object') return; if (n.props?.role === 'switch') switches.push(n); (n.children ?? []).flat(Infinity).forEach(walk); })(view);
  const byKey = key => switches.find(n => n.props['aria-label'].endsWith(key));
  assert.equal(byKey('cpa/@cf/a').props.checked, false);
  assert.equal(byKey('cpa/@cf/a').props.disabled, true);
  assert.equal(byKey('cpa/keep').props.checked, true);
  await h.find(view, n => n.type === 'button').props.onClick();
  assert.equal(JSON.stringify(calls[0][1]), '["@cf/*"]');
  assert.equal(calls[0][2], 5);
});
