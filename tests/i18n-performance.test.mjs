import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { configureI18n, locale, roleText, t } from '../i18n.js';
import { summarizeActivity } from '../activity-summary.js';
import { activityDefinition, artifactsDefinition } from '../observability-projection.js';

const nativeTest = process.env.DSH_CORDIS_ENTRY ? test : test.skip;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const settle = () => new Promise(resolve => setImmediate(resolve));
function withoutOverride(context) {
  const saved = process.env.AIWUK_LOCALE;
  delete process.env.AIWUK_LOCALE;
  context.after(() => {
    if (saved === undefined) delete process.env.AIWUK_LOCALE;
    else process.env.AIWUK_LOCALE = saved;
  });
}

// This counting fixture models read cost and event delivery, not SettingsForms internals.
function fixture({ preference = 'zh', cost = false } = {}) {
  const listeners = new Set();
  const state = { preference, reads: 0, fail: false, selfEmit: false, checksum: 0 };
  const emit = (ns = 'locale', revision = 1) => {
    for (const listener of [...listeners]) listener(ns, revision);
  };
  const settings = { describe(options) {
    assert.deepEqual(options, { redactSecrets: true });
    state.reads++;
    if (state.selfEmit) emit();
    if (cost) {
      const rows = Array.from({ length: 500 }, (_, index) => ({
        ns: `synthetic-${index}`, value: { inherited: Array(20).fill(index) },
      }));
      state.checksum += JSON.stringify(rows).length;
    }
    if (state.fail) throw new Error('Settings fixture unavailable');
    return [{ ns: 'locale', value: { preference: state.preference } }];
  } };
  function bind() {
    const cleanups = [];
    configureI18n({ inject(names, setup) {
      assert.deepEqual(names, ['settings']);
      setup({ settings,
        on(event, listener) {
          assert.equal(event, 'settings/document-updated');
          listeners.add(listener);
          const stop = () => listeners.delete(listener);
          cleanups.push(stop);
          return stop;
        },
        effect(factory) { cleanups.push(factory()); },
      });
    } });
    let alive = true;
    return () => {
      if (!alive) return;
      alive = false;
      for (const cleanup of cleanups.reverse()) cleanup?.();
    };
  }
  return { state, settings, emit, bind, listeners };
}

function replayActivity(count) {
  let state = activityDefinition.init({ id: 'history', cwd: '/project' }, 0);
  for (let seq = 0; seq < count; seq++) {
    state = activityDefinition.apply(state, {
      seq, time: seq, type: 'tool/call',
      data: { callId: `call-${seq}`, name: 'read', arguments: '{"file_path":"src/example.js"}' },
    });
  }
  return state;
}
function replayArtifacts(count) {
  let state = artifactsDefinition.init({ id: 'artifacts', cwd: '/project' }, 0);
  const files = Array.from({ length: 256 }, (_, index) => ({ path: `output-${index}.md` }));
  for (let seq = 0; seq < count; seq++) {
    state = artifactsDefinition.apply(state, {
      seq, time: seq, type: 'deliverables/presented', data: { files },
    });
  }
  return state;
}

test('translations, summaries and real projection folds share a constant settings snapshot', async context => {
  withoutOverride(context);
  const host = fixture();
  const dispose = host.bind();
  context.after(dispose);
  assert.equal(host.state.reads, 1);
  const expectedSummary = t('activity-summary.019', {}, 'zh');
  for (let index = 0; index < 10000; index++) {
    assert.equal(t('activity-summary.019'), expectedSummary);
    assert.equal(roleText('roster-defaults.365'), roleText('roster-defaults.365', {}, 'zh'));
    assert.equal(locale(), 'zh');
    assert.deepEqual(summarizeActivity('read', '{"file_path":"src/example.js"}', '/project'), {
      tool: 'read', summary: expectedSummary, target: 'src/example.js',
    });
  }
  const activity = replayActivity(10000);
  assert.equal(activity.cursor, 9999);
  assert.equal(activity.pending.length, 64);
  assert.equal(activity.view.recent.length, 8);
  assert.equal(activity.view.current.summary, expectedSummary);
  assert.equal(activity.view.current.target, 'src/example.js');
  assert.equal(activity.view.current.status, 'running');
  assert.equal(activity.view.truncated, true);
  assert.deepEqual(replayActivity(10000), activity);
  const artifacts = replayArtifacts(100);
  assert.equal(artifacts.view.items.length, 20);
  assert.equal(artifacts.view.items[0].presentSeq, 99);
  assert.equal(artifacts.view.items[0].displayPath, 'output-0.md');
  assert.equal(artifacts.view.truncated, true);
  assert.deepEqual(replayArtifacts(100), artifacts);
  assert.equal(host.state.reads, 1);
  host.state.preference = 'en';
  for (let index = 0; index < 10000; index++) host.emit('locale', index);
  assert.equal(host.state.reads, 1);
  await flush();
  assert.equal(host.state.reads, 2);
  assert.equal(replayActivity(10000).view.current.summary, t('activity-summary.019', {}, 'en'));
  replayArtifacts(100);
  assert.equal(host.state.reads, 2);
  context.diagnostic('10,000 translations/summaries and historical events; 25,600 artifact candidates per fold; one initial read, one refresh.');
});

test('snapshot failures, synchronous self-events and overrides never amplify reads', async context => {
  withoutOverride(context);
  const host = fixture();
  host.state.fail = true;
  host.state.selfEmit = true;
  process.env.AIWUK_LOCALE = 'zh';
  const dispose = host.bind();
  context.after(dispose);
  assert.equal(host.state.reads, 1, 'binding initializes even under an override');
  delete process.env.AIWUK_LOCALE;
  for (let index = 0; index < 10000; index++) assert.equal(locale(), 'en');
  await flush();
  assert.equal(host.state.reads, 1, 'failure and self-emission must not schedule retries');
  host.state.fail = false;
  host.emit('other-namespace');
  await flush();
  assert.equal(host.state.reads, 1);
  host.emit();
  await flush();
  assert.equal(host.state.reads, 2);
  assert.equal(locale(), 'zh');
  await flush();
  assert.equal(host.state.reads, 2);
  const explicit = fixture({ preference: 'en' });
  for (let index = 0; index < 10000; index++) {
    assert.equal(locale({ env: {}, settings: explicit.settings }), 'en');
  }
  explicit.state.preference = 'zh';
  assert.equal(locale({ env: {}, settings: explicit.settings }), 'en');
  assert.equal(explicit.state.reads, 1, 'unbound explicit handles are cached snapshots');
});

test('shared scopes survive first disposal, latest live service wins and queued disposal cannot revive', async context => {
  withoutOverride(context);
  const first = fixture(), second = fixture({ preference: 'en' });
  const disposeA = first.bind(), disposeB = first.bind();
  context.after(disposeA); context.after(disposeB);
  assert.equal(first.state.reads, 1);
  disposeA();
  first.state.preference = 'en'; first.emit();
  await flush();
  assert.equal(first.state.reads, 2);
  assert.equal(locale(), 'en');
  const disposeC = second.bind(); context.after(disposeC);
  first.state.preference = 'zh'; first.emit();
  await flush();
  assert.equal(locale(), 'en', 'old service refresh must not replace latest binding');
  disposeC();
  assert.equal(locale(), 'zh', 'disposing latest binding restores the earlier live service');
  const before = first.state.reads;
  first.emit(); disposeB();
  await flush();
  assert.equal(first.state.reads, before);
  assert.equal(locale(), 'en');
  assert.equal(first.listeners.size, 0);
  const disposeNew = first.bind(); context.after(disposeNew);
  assert.equal(first.state.reads, before + 1, 'last disposal clears the old snapshot');
  assert.equal(locale(), 'zh');
});

nativeTest('real Cordis sibling settings requires injection and optional consumers survive provider replacement', async context => {
  withoutOverride(context);
  const { Context, Service } = await import(pathToFileURL(process.env.DSH_CORDIS_ENTRY).href);
  let disposedContextCalls = 0;
  class CountingSettings extends Service {
    constructor(ctx, host) { super(ctx, 'settings'); this.host = host; }
    describe(options) {
      if (this.ctx.fiber.uid === null) disposedContextCalls++;
      assert.notEqual(this.ctx.fiber.uid, null, 'settings calls must not use a disposed consumer context');
      return this.host.settings.describe(options);
    }
  }
  const root = new Context();
  context.after(async () => { await root.fiber.dispose(); });
  const first = fixture();
  let providerContext;
  const provider = root.plugin({ apply(ctx) {
    providerContext = ctx;
    new CountingSettings(ctx, first);
  } });
  await provider;
  const missing = root.plugin({ apply(ctx) { void ctx.settings; } });
  await assert.rejects(async () => { await missing; }, /settings.*without inject/);
  await missing.dispose();
  const mount = () => root.plugin({ apply(ctx) { configureI18n(ctx); } });
  const consumerA = mount(), consumerB = mount();
  await consumerA; await consumerB; await settle();
  assert.equal(first.state.reads, 1, 'real service proxies must share one snapshot');
  assert.equal(locale(), 'zh');
  first.state.preference = 'en';
  for (let index = 0; index < 100; index++) providerContext.emit('settings/document-updated', 'locale', index);
  const disposingFirst = consumerA.dispose();
  await disposingFirst; await settle();
  assert.equal(first.state.reads, 2, 'queued refresh must use the surviving consumer proxy');
  assert.equal(locale(), 'en');
  first.state.preference = 'zh';
  providerContext.emit('settings/document-updated', 'locale', 100);
  await settle();
  assert.equal(first.state.reads, 3, 'remaining consumer keeps its event subscription');
  assert.equal(locale(), 'zh');
  const beforeDispose = first.state.reads;
  providerContext.emit('settings/document-updated', 'locale', 101);
  // Cordis unload is asynchronous: an already queued read may precede actual cleanup.
  await consumerB.dispose(); await settle();
  assert.ok(first.state.reads >= beforeDispose && first.state.reads <= beforeDispose + 1);
  const disposedReads = first.state.reads;
  providerContext.emit('settings/document-updated', 'locale', 102);
  await settle();
  assert.equal(first.state.reads, disposedReads, 'completed disposal must not revive the cache');
  assert.equal(locale(), 'en');
  const persistent = mount(); await persistent; await settle();
  assert.equal(locale(), 'zh');
  await provider.dispose(); await settle();
  const removedReads = first.state.reads;
  const late = mount(); await late; await settle();
  assert.equal(locale(), 'en', 'optional subscription starts without a provider');
  const replacement = fixture({ preference: 'zh' });
  let replacementContext;
  const provider2 = root.plugin({ apply(ctx) {
    replacementContext = ctx; new CountingSettings(ctx, replacement);
  } });
  await provider2; await settle();
  assert.equal(replacement.state.reads, 1);
  assert.equal(locale(), 'zh');
  replacement.state.preference = 'en';
  replacementContext.emit('settings/document-updated', 'locale', 1);
  await settle();
  assert.equal(replacement.state.reads, 2);
  assert.equal(locale(), 'en');
  assert.equal(first.state.reads, removedReads);
  await provider2.dispose(); await settle();
  assert.equal(locale(), 'en');
  await late.dispose(); await persistent.dispose();
  assert.equal(disposedContextCalls, 0, 'no stale proxy calls may be hidden by English error fallback');
  context.diagnostic('Real Cordis lifecycle and sibling injection; counting provider fixture, not full SettingsForms or GUI acceptance.');
});

test('synthetic expensive snapshot and replay report timer latency without brittle time thresholds', async context => {
  withoutOverride(context);
  const host = fixture({ cost: true });
  const started = performance.now();
  const dispose = host.bind(); context.after(dispose);
  const snapshotMs = performance.now() - started;
  const replayStart = performance.now();
  let timerFired = false;
  const timer = new Promise(resolve => setTimeout(() => { timerFired = true; resolve(); }, 0));
  replayActivity(10000);
  replayArtifacts(100);
  const replayMs = performance.now() - replayStart;
  assert.equal(host.state.reads, 1);
  assert.ok(host.state.checksum > 0);
  await timer;
  assert.equal(timerFired, true);
  context.diagnostic(JSON.stringify({ syntheticSnapshotMs: snapshotMs, replayMs,
    timerObservedAfterMs: performance.now() - replayStart, describeCalls: host.state.reads,
    boundary: 'Synthetic read cost and synchronous folds; not a production HTTP responsiveness measurement' }));
});
