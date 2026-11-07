import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureI18n, locale, m, normalizeLocale, roleText, t } from '../i18n.js';
const load = name => JSON.parse(readFileSync(new URL(`../i18n/${name}.json`, import.meta.url), 'utf8'));
test('server dictionaries have matching keys and placeholder sets', () => {
  for (const prefix of ['server', 'roles']) {
    const en = load(`${prefix}.en`), zh = load(`${prefix}.zh`);
    assert.deepEqual(Object.keys(en), Object.keys(zh));
    for (const key of Object.keys(en)) {
      const slots = text => [...text.matchAll(/\{(\d+)\}/g)].map(m => m[1]).sort();
      assert.deepEqual(slots(en[key]), slots(zh[key]), key);
      assert.equal(/[\u3400-\u9fff]/.test(en[key]), false, key);
    }
  }
});
test('locale uses explicit environment override, host settings and English fallback', () => {
  const settings = { describe: () => [{ ns: 'locale', value: { preference: 'zh-CN' } }] };
  assert.equal(locale({ env: {}, settings }), 'zh');
  assert.equal(locale({ env: { AIWUK_LOCALE: 'en-US' }, settings }), 'en');
  assert.equal(locale({ env: {}, settings: { describe: () => { throw Error('unavailable'); } } }), 'en');
  for (const value of ['system', 'fr', '', undefined]) assert.equal(normalizeLocale(value), 'en');
  assert.equal(normalizeLocale('zh_TW'), 'zh');
});
test('translations interpolate literally, preserve missing variables and isolate model English', () => {
  assert.equal(t('dispatch-confirm.178', { 0: '$&', 1: 'backend', 2: 'p/m', 3: 'none' }, 'en'), '$& (backend): primary p/m; fallbacks none');
  assert.match(t('dispatch-confirm.178', {}, 'zh'), /主/);
  assert.equal(t('missing.key'), 'missing.key');
  const before = process.env.AIWUK_LOCALE;
  process.env.AIWUK_LOCALE = 'zh';
  try { assert.equal(m('dispatch-confirm.167'), 'decision must be confirm or cancel'); }
  finally { if (before === undefined) delete process.env.AIWUK_LOCALE; else process.env.AIWUK_LOCALE = before; }
});
test('cultural roster data preserves original Chinese names and provides English romanization', () => {
  assert.equal(roleText('roster-defaults.365', {}, 'zh'), '诸葛亮');
  assert.equal(roleText('roster-defaults.365', {}, 'en'), 'Zhuge Liang');
});
test('optional host settings binding is live and cleaned up', () => {
  let dispose, preference = 'zh';
  configureI18n({ inject(names, setup) { assert.deepEqual(names, ['settings']); setup({ settings: { describe: () => [{ ns: 'locale', value: { preference } }] }, effect(fn) { dispose = fn(); } }); } });
  assert.equal(locale({ env: {} }), 'zh'); preference = 'en'; assert.equal(locale({ env: {} }), 'en');
  dispose(); assert.equal(locale({ env: {} }), 'en');
});
