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
const flush = () => new Promise(resolve => queueMicrotask(resolve));
function host(preference = 'zh') {
  const listeners = new Set();
  const fixture = { preference, reads: 0, fail: false, missing: false, duringRead: null,
    emit(ns = 'locale') { for (const listener of [...listeners]) listener(ns); },
    settings: { describe() {
      fixture.reads++;
      fixture.duringRead?.();
      if (fixture.fail) throw Error('unavailable');
      return fixture.missing ? [] : [{ ns: 'locale', value: { preference: fixture.preference } }];
    } },
    bind(testContext, settings = fixture.settings) {
      const cleanup = [];
      configureI18n({ inject(names, setup) {
        assert.deepEqual(names, ['settings']);
        setup({ settings,
          on(name, callback) {
            assert.equal(name, 'settings/document-updated'); listeners.add(callback);
            return () => listeners.delete(callback);
          },
          effect(factory) { cleanup.push(factory()); },
        });
      } });
      const dispose = () => { for (const fn of cleanup) fn(); };
      testContext.after(dispose);
      return dispose;
    },
  };
  return fixture;
}
function clearOverride(testContext) {
  const previous = process.env.AIWUK_LOCALE;
  delete process.env.AIWUK_LOCALE;
  testContext.after(() => {
    if (previous === undefined) delete process.env.AIWUK_LOCALE;
    else process.env.AIWUK_LOCALE = previous;
  });
}
test('optional settings binding refreshes only on coalesced locale events', async context => {
  clearOverride(context);
  const fixture = host();
  const dispose = fixture.bind(context);
  assert.equal(locale(), 'zh');
  fixture.preference = 'en';
  assert.equal(locale(), 'zh');
  fixture.emit('other'); await flush();
  assert.equal(fixture.reads, 1);
  fixture.emit(); fixture.emit(); fixture.emit();
  assert.equal(locale(), 'zh');
  await flush();
  assert.equal(locale(), 'en'); assert.equal(fixture.reads, 2);
  dispose(); assert.equal(locale(), 'en');
  fixture.emit(); await flush(); assert.equal(fixture.reads, 2);
});
test('synchronous describe notifications cannot trigger recursive refreshes', async context => {
  clearOverride(context);
  const fixture = host();
  fixture.duringRead = () => fixture.emit();
  fixture.bind(context);
  await flush();
  assert.equal(fixture.reads, 1);
  fixture.preference = 'en'; fixture.emit();
  await flush(); await flush();
  assert.equal(fixture.reads, 2); assert.equal(locale(), 'en');
});
test('translation hot paths reuse memory and environment removal restores the snapshot', async context => {
  clearOverride(context);
  const fixture = host('en');
  process.env.AIWUK_LOCALE = 'zh';
  fixture.bind(context);
  assert.equal(fixture.reads, 1); assert.equal(locale(), 'zh');
  delete process.env.AIWUK_LOCALE;
  assert.equal(locale(), 'en');
  for (let i = 0; i < 10000; i++) {
    t('activity-summary.019'); roleText('roster-defaults.365'); locale();
  }
  assert.equal(fixture.reads, 1);
  process.env.AIWUK_LOCALE = 'en-US';
  fixture.preference = 'zh'; fixture.emit(); await flush();
  assert.equal(locale(), 'en'); delete process.env.AIWUK_LOCALE;
  assert.equal(locale(), 'zh'); assert.equal(fixture.reads, 2);
});
test('failed and missing locale reads are cached and recover after events', async context => {
  clearOverride(context);
  const fixture = host(); fixture.fail = true;
  fixture.bind(context);
  for (let i = 0; i < 100; i++) assert.equal(locale(), 'en');
  assert.equal(fixture.reads, 1);
  fixture.fail = false; fixture.emit(); await flush();
  assert.equal(locale(), 'zh');
  fixture.missing = true; fixture.emit(); await flush();
  assert.equal(locale(), 'en');
  fixture.missing = false; fixture.emit(); await flush();
  assert.equal(locale(), 'zh'); assert.equal(fixture.reads, 4);
});
test('explicit settings handles cache successful and failed snapshots without subscriptions', () => {
  const fixture = host();
  assert.equal(locale({ env: { AIWUK_LOCALE: 'en' }, settings: fixture.settings }), 'en');
  assert.equal(fixture.reads, 0);
  for (let i = 0; i < 100; i++) assert.equal(locale({ env: {}, settings: fixture.settings }), 'zh');
  assert.equal(fixture.reads, 1);
  fixture.preference = 'en';
  assert.equal(locale({ env: {}, settings: fixture.settings }), 'zh');
  const failed = host(); failed.fail = true;
  for (let i = 0; i < 100; i++) assert.equal(locale({ env: {}, settings: failed.settings }), 'en');
  assert.equal(failed.reads, 1);
  assert.equal(locale({ env: {}, settings: null }), 'en');
});
test('shared scopes initialize and refresh once and survive partial disposal', async context => {
  clearOverride(context);
  const fixture = host();
  const first = fixture.bind(context);
  const second = fixture.bind(context);
  assert.equal(fixture.reads, 1);
  fixture.preference = 'en'; fixture.emit(); await flush();
  assert.equal(fixture.reads, 2); assert.equal(locale(), 'en');
  first();
  fixture.preference = 'zh'; fixture.emit(); await flush();
  assert.equal(fixture.reads, 3); assert.equal(locale(), 'zh');
  second();
  assert.equal(locale(), 'en');
  fixture.preference = 'en'; fixture.bind(context);
  assert.equal(fixture.reads, 4); assert.equal(locale(), 'en');
});
test('newest active service wins and old cleanup does not clear it', context => {
  clearOverride(context);
  const older = host('zh'), newer = host('en');
  const removeOlder = older.bind(context);
  const removeNewer = newer.bind(context);
  assert.equal(locale(), 'en');
  removeOlder(); assert.equal(locale(), 'en');
  older.bind(context); assert.equal(locale(), 'zh');
  const removeLatest = newer.bind(context); assert.equal(locale(), 'en');
  removeLatest(); assert.equal(locale(), 'zh');
  removeNewer(); assert.equal(locale(), 'zh');
  assert.equal(locale({ env: {}, settings: undefined }), 'zh');
  assert.equal(locale({ env: {}, settings: null }), 'en');
});
test('queued work is discarded after final release even when the service rebinds', async context => {
  clearOverride(context);
  const fixture = host();
  const dispose = fixture.bind(context);
  fixture.emit(); dispose();
  fixture.preference = 'en'; fixture.bind(context);
  assert.equal(fixture.reads, 2);
  await flush();
  assert.equal(fixture.reads, 2); assert.equal(locale(), 'en');
});
test('shared queued work survives disposal of the scope that queued it', async context => {
  clearOverride(context);
  const fixture = host();
  const first = fixture.bind(context); fixture.bind(context);
  fixture.preference = 'en'; fixture.emit(); first();
  await flush();
  assert.equal(fixture.reads, 2); assert.equal(locale(), 'en');
});
test('distinct Cordis-style proxies share identity but refresh through a live scope', async context => {
  clearOverride(context);
  const fixture = host();
  function consumer() {
    let live = true;
    const proxy = new Proxy(fixture.settings, { get(target, key) {
      if (key === Symbol.for('cordis.original')) return target;
      if (key === 'describe') return options => {
        assert.equal(live, true, 'disposed scope must never read settings');
        return target.describe(options);
      };
      return Reflect.get(target, key);
    } });
    const dispose = fixture.bind(context, proxy);
    return () => { live = false; dispose(); };
  }
  const first = consumer(), second = consumer();
  assert.equal(fixture.reads, 1);
  assert.equal(locale({ env: {}, settings: fixture.settings }), 'zh');
  fixture.preference = 'en'; fixture.emit(); first();
  await flush();
  assert.equal(fixture.reads, 2); assert.equal(locale(), 'en');
  fixture.emit(); second();
  consumer();
  assert.equal(fixture.reads, 3);
  await flush(); assert.equal(fixture.reads, 3);
});
