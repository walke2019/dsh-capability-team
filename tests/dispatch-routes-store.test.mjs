import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRouteStore } from '../dispatch-routes-store.js';
import { answerPending, confirmedRoute, createDispatchConfirm, forgetLead, pendingView, setRouteStore } from '../dispatch-confirm.js';
import { effectiveConfig } from '../config.js';

const effective = effectiveConfig({
  tiers: { medium: ['m1', 'm2', 'm3'] },
  capabilities: { frontend: { provider: 'provider-a', model: 'm1', tier: 'medium', fallbacks: [] } },
  roles: { 'diao-chan': { displayName: '貂蝉', capability: 'frontend', description: '前端' } },
});
const llm = { listProviders: () => [{ id: 'provider-a', name: 'Provider A' }], listModels: async () => ['m1', 'm2', 'm3'].map(id => ({ id, name: id })) };
const plan = { mode: 'delegate', assignments: [{ role: 'diao-chan', displayName: '貂蝉', capability: 'frontend', task: '改前端' }] };
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('“只用于这次任务”的路由写盘，DSH 重启（内存清空）后仍然生效', async t => {
  const root = await mkdtemp(join(tmpdir(), 'routes-'));
  setRouteStore(createRouteStore(root));
  t.after(() => setRouteStore(undefined));
  const confirm = createDispatchConfirm({ llm }, { pin: async () => '/proj', load: async () => ({ revision: 0 }) }, { graceMs: 1000 });
  forgetLead('LR');
  const p = confirm.confirm({ agent: { id: 'LR' }, callId: 'c' }, plan, effective, { disabledRoutes: [] }, 'always');
  for (let i = 0; i < 500 && pendingView('LR', 'c').status !== 'pending'; i++) await tick();
  answerPending('LR', 'c', { decision: 'confirm', scope: 'task', routes: [{ role: 'diao-chan', primary: 'provider-a/m2', fallbacks: ['provider-a/m3'] }] });
  await p;
  assert.equal((await readdir(join(root, 'dispatch-routes'))).filter(n => n.endsWith('.json')).length, 1);
  forgetLead('LR'); // simulate a restart: nothing in memory
  const route = confirmedRoute('LR', 'diao-chan');
  assert.equal(route.primary.model, 'm2');
  assert.deepEqual(route.fallbacks.map(f => f.model), ['m3']);
  assert.equal(confirmedRoute('other-lead', 'diao-chan'), undefined);
});

test('文件损坏、过期或属于其他主控时被忽略', async () => {
  const root = await mkdtemp(join(tmpdir(), 'routes-'));
  let clock = 0;
  const store = createRouteStore(root, { now: () => clock });
  store.save('A', new Map([['r', { primary: { provider: 'p', model: 'm' }, fallbacks: [] }]]), new Map());
  assert.equal(store.load('A').routes[0][0], 'r');
  assert.equal(store.load('B'), undefined);
  clock = 31 * 86400000;
  assert.equal(store.load('A'), undefined, '超过 30 天视为任务已结束');
  assert.equal(store.load('A'), undefined);
});
