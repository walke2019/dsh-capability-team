import test from 'node:test';
import { rootFixtureNative } from './helpers/backend-native-fixture.mjs';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPreferences, createModelPrefs, habitOf, unhealthyRoutes } from '../model-prefs.js';
import { answerPending, createDispatchConfirm, forgetLead, pendingView } from '../dispatch-confirm.js';
import { effectiveConfig } from '../config.js';

const c = (primary, fallbacks = [], at = 0) => ({ primary, fallbacks, at });

test('习惯：最近选择中出现至少 2 次且占多数才算；连续 3 次相同算稳定', () => {
  assert.equal(habitOf([c('a/x')]), undefined, '一次不算习惯');
  assert.equal(habitOf([c('a/x'), c('b/y'), c('c/z')]), undefined, '没有多数不算');
  assert.deepEqual(habitOf([c('b/y'), c('a/x', ['b/y']), c('a/x', ['c/z'])]), { primary: 'a/x', fallbacks: ['c/z'], count: 2, of: 3, settled: false }, '回退取最近一次');
  assert.equal(habitOf([c('a/x', ['b/y']), c('a/x', ['b/y']), c('a/x', ['b/y'])]).settled, true);
});

test('最近总失败的模型不预选，并排到回退最后', () => {
  const unhealthy = unhealthyRoutes({ 'win/gpt-6.1-sol': { strikes: 2, cooling: false }, 'provider-a/ok': { strikes: 1, cooling: false }, 'provider-a/hot': { strikes: 1, cooling: true } });
  assert.deepEqual(unhealthy, { 'win/gpt-6.1-sol': 2, 'provider-a/hot': 1 });
  const row = { primary: { provider: 'provider-a', model: 'm1' }, fallbacks: [{ provider: 'provider-a', model: 'hot' }, { provider: 'provider-a', model: 'ok' }],
    candidates: [{ provider: 'win', model: 'gpt-6.1-sol' }, { provider: 'provider-a', model: 'm1' }, { provider: 'provider-a', model: 'ok' }, { provider: 'provider-a', model: 'hot' }] };
  const habit = { primary: 'win/gpt-6.1-sol', fallbacks: [], count: 3, of: 3, settled: true };
  const out = applyPreferences(row, habit, unhealthy);
  assert.equal(out.primary.model, 'm1', '习惯里的模型正在失败，不预选');
  assert.equal(out.learned.habit, undefined);
  assert.deepEqual(out.fallbacks.map(f => f.model), ['ok', 'hot']);
  assert.deepEqual(out.learned.unhealthy, { 'win/gpt-6.1-sol': 2, 'provider-a/hot': 1 });
  const good = applyPreferences(row, { primary: 'provider-a/ok', fallbacks: ['provider-a/m1'], count: 2, of: 3, settled: false }, {});
  assert.equal(good.primary.model, 'ok');
  assert.deepEqual(good.fallbacks.map(f => f.model), ['m1']);
  assert.equal(good.learned.preselected, true);
});

const effective = effectiveConfig({
  tiers: { medium: ['m1', 'm2', 'm3'] },
  capabilities: { frontend: { provider: 'provider-a', model: 'm1', tier: 'medium', fallbacks: [] } },
  roles: { 'diao-chan': { displayName: '貂蝉', capability: 'frontend', description: '前端' } },
});
const llm = { listProviders: () => [{ id: 'provider-a', name: 'Provider A' }], listModels: async () => ['m1', 'm2', 'm3'].map(id => ({ id, name: id })) };
const plan = { mode: 'delegate', assignments: [{ role: 'diao-chan', displayName: '貂蝉', capability: 'frontend', task: '改前端' }] };
const flush = () => new Promise(resolve => setTimeout(resolve, 10));
// Wait until the card is registered: confirm() does file I/O first, whose latency differs by OS.
const pendingFor = async (lead, callId) => {
  for (let i = 0; i < 500; i++) { if (pendingView(lead, callId).status === 'pending') return; await flush(); }
  throw new Error(`no pending dispatch for ${lead}`);
};

test('确认分派会被记录，之后的新会话预选你的习惯；“保存为项目默认”仍按配置比较', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prefs-'));
  const prefs = createModelPrefs(root);
  const team = { native: rootFixtureNative, pin: async () => '/proj', load: async () => ({ revision: 0 }) };
  const confirm = createDispatchConfirm({ llm }, team, { prefs, graceMs: 1000 });
  for (const lead of ['L1', 'L2']) {
    forgetLead(lead);
    const p = confirm.confirm({ agent: { id: lead }, callId: 'c' }, plan, effective, { disabledRoutes: [] }, 'always');
    await pendingFor(lead, 'c');
    answerPending(lead, 'c', { decision: 'confirm', routes: [{ role: 'diao-chan', primary: 'provider-a/m2', fallbacks: ['provider-a/m3'] }] });
    await p; await flush();
  }
  assert.deepEqual(await prefs.habits('/proj'), { frontend: { primary: 'provider-a/m2', fallbacks: ['provider-a/m3'], count: 2, of: 2, settled: false } });
  forgetLead('L3');
  const p = confirm.confirm({ agent: { id: 'L3' }, callId: 'c' }, plan, effective, { disabledRoutes: [] }, 'always');
  await pendingFor('L3', 'c');
  const view = pendingView('L3', 'c');
  assert.equal(view.routes[0].primary.model, 'm2', '新会话预选习惯');
  assert.equal(view.routes[0].learned.preselected, true);
  assert.equal(view.routes[0].base.primary.model, 'm1', '保留配置值供对比');
  answerPending('L3', 'c', { decision: 'confirm' });
  const result = await p;
  assert.equal(result.routes[0].changed, true, '与配置不同，算作改动，因此会按习惯路由');
  await prefs.clear('/proj');
  assert.deepEqual(await prefs.habits('/proj'), {});
});
