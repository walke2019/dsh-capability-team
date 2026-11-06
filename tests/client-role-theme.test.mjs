import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

// Evaluate the role-theme fragment the same way build-client concatenates it: inside a scope that owns zh/en.
function loadFragment() {
  const source = readFileSync(new URL('../client/07a-role-theme.js', import.meta.url), 'utf8');
  const sandbox = { zh: {}, en: {} };
  const core = readFileSync(new URL('../client/00-core-zh.js', import.meta.url), 'utf8');
  const dictionary = core.slice(core.indexOf('const zh = ')).replace('const zh = ', 'this.zh = ');
  new Script(dictionary).runInNewContext(sandbox);
  new Script(`${source}\nthis.api = { characterQuoteKey, localizeRoles };`).runInNewContext(sandbox);
  return { ...sandbox.api, zh: sandbox.zh, en: sandbox.en };
}
const coreZh = readFileSync(new URL('../client/00-core-zh.js', import.meta.url), 'utf8');
const coreEn = readFileSync(new URL('../client/01-i18n-en.js', import.meta.url), 'utf8');

test('neutral roster: default names are localized, renamed roles keep their own name', () => {
  const { localizeRoles, zh, en } = loadFragment();
  const t = dict => key => dict[key] ?? key;
  const roles = [{ id: 'lead', displayName: 'Lead' }, { id: 'researcher', displayName: 'Researcher' }, { id: 'backend', displayName: '服务端老王' }];
  const shown = localizeRoles(roles, t(zh));
  assert.deepEqual(shown.map(r => r.displayName), ['主控', '研究员', '服务端老王']);
  assert.deepEqual(localizeRoles(roles, t(en)).map(r => r.displayName), ['Lead', 'Researcher', '服务端老王']);
  assert.deepEqual(shown.map(r => r.quoteKey), ['live.quote.lead', 'live.quote.researcher', 'live.quote.backend']);
  for (const r of shown) assert.ok(zh[r.quoteKey] && en[r.quoteKey], `${r.quoteKey} must be translated`);
});

test('three-kingdoms roster keeps the hero quotes, including Sun Quan for the lead', () => {
  const { localizeRoles } = loadFragment();
  const heroes = [{ id: 'lead', displayName: '孙权' }, { id: 'lv-bu', displayName: '吕布' }, { id: 'zhou-yu', displayName: '周瑜' }, { id: 'guan-yu', displayName: '关羽' }];
  const shown = localizeRoles(heroes, k => k);
  assert.deepEqual(shown.map(r => r.displayName), ['孙权', '吕布', '周瑜', '关羽']);
  assert.deepEqual(shown.map(r => r.quoteKey), ['live.quote.sun-quan', 'live.quote.lv-bu', 'live.quote.zhou-yu', 'live.quote.default']);
  for (const key of ['sun-quan', 'zhuge-liang', 'lv-bu', 'diao-chan', 'zhao-yun', 'chen-lin', 'zhou-yu']) {
    assert.match(coreZh, new RegExp(`'live\\.quote\\.${key}':`)); assert.match(coreEn, new RegExp(`'live\\.quote\\.${key}':`));
  }
});
