import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

function load() {
  let exposed;
  const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }), useState: v => [v, () => {}], useRef: v => ({ current: v }), useEffect() {}, useMemo: f => f() };
  new Script(readFileSync(new URL('../client.js', import.meta.url), 'utf8')).runInNewContext({ window: { __ModuleLoader__: { load: spec => spec.factory(() => React) }, __ctmTestHook: x => { exposed = x; } } });
  return exposed;
}
const text = n => (n == null ? '' : typeof n !== 'object' ? String(n) : typeof n.type === 'function' ? text(n.type(n.props)) : (n.children ?? []).map(text).join(''));
const settled = output => ({ phase: 'result', block: { kind: 'tool-result', call: { argsRaw: '{}' }, content: [{ type: 'text', text: JSON.stringify(output) }] } });
const t = k => `${k}[{n}|{p}|{q}]`;

test('模型目录、预算、搜索、导出卡片显示摘要，不把 JSON 原样放进对话', () => {
  const v = load();
  const cards = [
    [v.CatalogView, { entries: [{ provider: 'provider-a', model: 'm1', tiers: ['medium'] }, { provider: 'x', model: 'm2', tiers: [] }], errors: [] }, 'cards.catalog.summary[2|2|]'],
    [v.BudgetView, { roleId: 'diao-chan', status: 'running', estimatedSteps: 40, startsUsed: 3, override: null }, 'diao-chan'],
    [v.SearchView, { provider: 'jina-search', query: 'dsh', results: [{ title: 'A', url: 'https://a.test' }] }, 'cards.search.summary[1||dsh]'],
    [v.ExportView, { format: 'capability-team-template', version: 1, roles: { a: { displayName: 'A', capability: 'qa' } }, capabilities: {} }, 'cards.export.summary[1||]'],
  ];
  for (const [View, output, expected] of cards) {
    const tree = View({ t, ...settled(output) });
    const rendered = text(tree);
    assert.ok(rendered.includes(expected), `${expected} in ${rendered.slice(0, 120)}`);
    assert.ok(!rendered.includes('{"'), '不出现原始 JSON');
  }
});

test('用量：每步平均输入与缓存读取占比，过大时提示轮换', () => {
  const { contextMetrics } = load();
  assert.equal(contextMetrics(undefined, { steps: 3 }), null);
  assert.equal(contextMetrics({ uncachedInputTokens: 1 }, { steps: 0 }), null);
  // 貂蝉那次会话的量级：1257 步、1150 万未缓存输入、1.77 亿缓存读取、122 万缓存写入
  const m = contextMetrics({ uncachedInputTokens: 11485262, cacheReadTokens: 176768159, cacheWriteTokens: 1221508 }, { steps: 1257 });
  assert.equal(m.avgPrompt, 150736);
  assert.equal(Math.round(m.cacheShare * 100), 93);
  assert.equal(m.heavy, true);
  assert.equal(contextMetrics({ uncachedInputTokens: 2000, cacheReadTokens: 8000 }, { steps: 1 }).heavy, false);
});
