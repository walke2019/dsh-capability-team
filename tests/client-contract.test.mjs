import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
test('客户端可解析并注册总览与全部工具卡片，不导入内部UI包', () => {
  let plugin;
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  new Script(source).runInNewContext({ window: { __ModuleLoader__: { load: spec => {
    plugin = spec.factory(name => { assert.equal(name, 'react'); return { createElement() {} }; });
  } } } });
  const views = [], callbacks = [], tabs = [];
  let dictionaries;
  plugin.apply({ effect: fn => callbacks.push(fn), locale: { bind: () => key => key, register: (_ns, dict) => { dictionaries = dict; } },
    remote: { commands: {} }, sidebarRightTabs: { register: definition => { tabs.push(definition); return () => {}; } },
    slots: { inject: (_name, fn) => fn(), register: (options, component) => { views.push({ options, component }); } } });
  callbacks[0]();
  callbacks[2]();
  assert.deepEqual(Object.keys(dictionaries.zh).sort(), Object.keys(dictionaries.en).sort());
  const keys = views.filter(v => v.options.name === 'tool.call.toolview').map(v => v.options.key).sort();
  // Every capability-team tool that returns JSON has a card, so raw JSON never reaches the conversation.
  assert.deepEqual(keys, ['capability_dispatch_plan', 'capability_free_task', 'capability_handoff', 'capability_member_override', 'capability_memory_search', 'capability_memory_write', 'capability_model_catalog', 'capability_rotate_member', 'capability_task_budget',
    'capability_team_export', 'capability_team_import', 'capability_team_read', 'capability_team_save', 'cpa_search', 'cpa_web_fetch']);
  assert.ok(views.filter(v => v.options.name === 'tool.call.toolview').every(v => v.options.inject?.('s1').sessionId === 's1'), '卡片拿到会话 id');
  assert.ok(views.some(v => v.options.id === 'capability-team-overview'));
  assert.equal(tabs[0].kind, 'capability-team-overview');
  assert.equal(tabs[0].guide[0].title(), 'overview.title');
  assert.equal(views.find(v => v.options.id === 'capability-team-overview').options.name, 'sidebar.right.pane.tab');
  assert.equal(views.some(v => v.options.name === 'conversation.view'), false);
});
