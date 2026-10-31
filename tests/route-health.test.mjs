import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEEP_MS, createRouteHealth, mergeHealth } from '../route-health.js';
import { unhealthyRoutes } from '../model-prefs.js';

test('故障记录跨重启保留：密钥错误保留一天，其他故障保留一小时', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rh-'));
  let clock = 1_000_000;
  const a = createRouteHealth(root, { now: () => clock });
  a.record({ kind: 'cooldown', route: { provider: 'win', model: 'gpt-6.1-sol' }, code: 'AUTH', status: 401, strikes: 1 });
  a.record({ kind: 'cooldown', route: { provider: 'provider-a', model: 'gpt-6.1-sol' }, code: 'QUOTA', status: 429, strikes: 1 });
  a.record({ kind: 'switch' });
  const b = createRouteHealth(root, { now: () => clock }); // a new process after a restart
  assert.deepEqual(Object.keys(b.recent()).sort(), ['provider-a/gpt-6.1-sol', 'win/gpt-6.1-sol']);
  assert.equal(b.recent()['win/gpt-6.1-sol'].credential, true);
  clock += KEEP_MS.other + 1;
  assert.deepEqual(Object.keys(createRouteHealth(root, { now: () => clock }).recent()), ['win/gpt-6.1-sol'], '普通故障一小时后过期');
  clock += KEEP_MS.credential;
  assert.deepEqual(createRouteHealth(root, { now: () => clock }).recent(), {}, '密钥错误一天后过期');
});

test('密钥错误一次就算不健康；实时状态优先于持久记录', () => {
  assert.deepEqual(unhealthyRoutes({ 'win/x': { strikes: 1, credential: true }, 'provider-a/y': { strikes: 1 } }), { 'win/x': 1 });
  assert.deepEqual(mergeHealth({ 'a/b': { strikes: 3 } }, { 'a/b': { strikes: 1, cooling: true } }), { 'a/b': { strikes: 1, cooling: true } });
});
