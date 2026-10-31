import test from 'node:test';
import assert from 'node:assert/strict';
import { answerPending, confirmedRoute, createDispatchConfirm, forgetLead, handleDispatchConfirm, pendingView, planRoutes, validateAnswer, withConfirmedRoute } from '../dispatch-confirm.js';
import { effectiveConfig } from '../config.js';

const effective = effectiveConfig({
  tiers: { medium: ['m1', 'm2', 'm3', 'm4', 'm5'] },
  capabilities: { frontend: { provider: 'provider-a', model: 'm1', tier: 'medium', fallbacks: [{ provider: 'provider-a', model: 'm2' }] } },
  roles: { 'diao-chan': { displayName: '貂蝉', capability: 'frontend', description: '前端' } },
});
const catalog = { entries: ['m1', 'm2', 'm3', 'm4', 'm5'].map(model => ({ provider: 'provider-a', model })), errors: [] };
const plan = { mode: 'delegate', assignments: [{ role: 'diao-chan', displayName: '貂蝉', capability: 'frontend', task: '改前端' }] };
const offered = planRoutes(plan, effective, [], catalog);
const llm = { listProviders: () => [{ id: 'provider-a', name: 'Provider A' }], listModels: async () => catalog.entries.map(e => ({ id: e.model, name: e.model })) };
const flush = () => new Promise(resolve => setTimeout(resolve, 5));

test('planRoutes：主模型、回退和同档候选，已禁用的模型不出现', () => {
  assert.deepEqual(offered[0].primary, { provider: 'provider-a', model: 'm1' });
  assert.deepEqual(offered[0].fallbacks, [{ provider: 'provider-a', model: 'm2' }]);
  assert.equal(offered[0].candidates.length, 5);
  const blocked = planRoutes(plan, effective, ['provider-a/m1'], catalog)[0];
  assert.deepEqual(blocked.primary, { provider: 'provider-a', model: 'm2' }, '主模型被禁用时用第一个可用回退');
  assert.ok(!blocked.candidates.some(c => c.model === 'm1'));
});

test('validateAnswer：回退最多 3 个、不能重复、必须在同档候选里', () => {
  const ok = validateAnswer(offered, { decision: 'confirm', routes: [{ role: 'diao-chan', primary: 'provider-a/m3', fallbacks: ['provider-a/m1', 'provider-a/m2', 'provider-a/m4'] }] });
  assert.equal(ok.routes[0].changed, true);
  assert.deepEqual(ok.routes[0].primary, { provider: 'provider-a', model: 'm3' });
  assert.throws(() => validateAnswer(offered, { decision: 'confirm', routes: [{ role: 'diao-chan', primary: 'provider-a/m3', fallbacks: ['provider-a/m1', 'provider-a/m2', 'provider-a/m4', 'provider-a/m5'] }] }), /最多 3 个/);
  assert.throws(() => validateAnswer(offered, { decision: 'confirm', routes: [{ role: 'diao-chan', primary: 'provider-a/m3', fallbacks: ['provider-a/m3'] }] }), /重复/);
  assert.throws(() => validateAnswer(offered, { decision: 'confirm', routes: [{ role: 'diao-chan', primary: 'other/x' }] }), /不在同档可用模型中/);
  assert.equal(validateAnswer(offered, { decision: 'confirm', routes: [] }).routes[0].changed, false, '不改就是原样确认');
  assert.deepEqual(validateAnswer(offered, { decision: 'cancel' }), { decision: 'cancel' });
});

const lead = id => ({ id, ctx: {} });
const exec = (id, callId = 'call-1') => ({ agent: lead(id), callId, signal: new AbortController().signal });
const team = { pin: async () => '/p', load: async () => ({ revision: 0 }) };

test('卡片确认后应用到本次任务；同一会话路由没变时不再询问', async () => {
  forgetLead('L1');
  const confirm = createDispatchConfirm({ llm }, team, { graceMs: 1000 });
  const pending = confirm.confirm(exec('L1'), plan, effective, { disabledRoutes: [] }, 'on-change');
  await flush();
  const view = pendingView('L1', 'call-1');
  assert.equal(view.status, 'pending');
  assert.equal(view.maxFallbacks, 3);
  answerPending('L1', 'call-1', { decision: 'confirm', catalogVersion: view.catalogVersion, routes: [{ role: 'diao-chan', primary: 'provider-a/m3', fallbacks: ['provider-a/m4'] }] });
  const result = await pending;
  assert.equal(result.asked, true);
  assert.deepEqual(confirmedRoute('L1', 'diao-chan'), { primary: { provider: 'provider-a', model: 'm3' }, fallbacks: [{ provider: 'provider-a', model: 'm4' }] });
  const role = withConfirmedRoute({ provider: 'provider-a', model: 'm1', fallbacks: [] }, confirmedRoute('L1', 'diao-chan'));
  assert.equal(role.model, 'm3');
  const again = await confirm.confirm(exec('L1', 'call-2'), plan, effective, { disabledRoutes: [] }, 'on-change');
  assert.equal(again.asked, false, '路由没变不再弹');
  assert.equal(again.routes[0].primary.model, 'm3', '沿用已确认的路由');
});

test('always 每次都问；never 从不问；取消会抛错且不留下计划', async () => {
  forgetLead('L2');
  const confirm = createDispatchConfirm({ llm }, team, { graceMs: 1000 });
  assert.equal((await confirm.confirm(exec('L2'), plan, effective, { disabledRoutes: [] }, 'never')).asked, false);
  const p = confirm.confirm(exec('L2', 'c9'), plan, effective, { disabledRoutes: [] }, 'always');
  await flush();
  answerPending('L2', 'c9', { decision: 'cancel' });
  await assert.rejects(p, /用户取消了这次分派/);
  assert.equal(pendingView('L2', 'c9').status, 'none');
});

test('目录版本变化返回 409；校验失败返回 422', async () => {
  forgetLead('L3');
  const confirm = createDispatchConfirm({ llm }, team, { graceMs: 1000 });
  const p = confirm.confirm(exec('L3', 'c1'), plan, effective, { disabledRoutes: [] }, 'always');
  await flush();
  assert.throws(() => answerPending('L3', 'c1', { decision: 'confirm', catalogVersion: 'stale' }), e => e.status === 409);
  assert.throws(() => answerPending('L3', 'c1', { decision: 'confirm', routes: [{ role: 'diao-chan', primary: 'x/y' }] }), e => e.status === 422);
  answerPending('L3', 'c1', { decision: 'confirm' });
  assert.equal((await p).asked, true);
});

test('没有卡片时退回原生提问框，可逐行调整', async () => {
  forgetLead('L4');
  let asked;
  const userQuestions = { ask: async q => { asked = q; return { answers: [{ id: 'dispatch', selected: ['仅本次调整'], custom: 'diao-chan: provider-a/m5, provider-a/m1' }] }; } };
  const confirm = createDispatchConfirm({ llm, userQuestions }, team, { graceMs: 10 });
  const result = await confirm.confirm(exec('L4'), plan, effective, { disabledRoutes: [] }, 'always');
  assert.match(asked.questions[0].detail, /貂蝉（frontend）：主 provider-a\/m1；回退 provider-a\/m2/);
  assert.equal(result.routes[0].primary.model, 'm5');
  assert.deepEqual(result.routes[0].fallbacks.map(f => f.model), ['m1']);
});

test('HTTP：GET 读取等待中的请求，POST 需要同源与 JSON', async () => {
  forgetLead('L5');
  const confirm = createDispatchConfirm({ llm }, team, { graceMs: 1000 });
  const agent = lead('L5');
  const ctx = { get: name => (name === 'agents' ? new Map([['L5', agent]]) : { tryMembership: a => (a === agent ? { role: 'lead' } : undefined) }) };
  const p = confirm.confirm({ agent, callId: 'h1' }, plan, effective, { disabledRoutes: [] }, 'always');
  await flush();
  const base = 'http://dsh.test/api/capability-team.dispatch-confirm';
  const got = await (await handleDispatchConfirm(ctx, new Request(`${base}?sessionId=L5&callId=h1`))).json();
  assert.equal(got.status, 'pending');
  const post = (headers, body) => handleDispatchConfirm(ctx, new Request(base, { method: 'POST', headers, body: JSON.stringify(body) }));
  assert.equal((await post({ 'content-type': 'application/json', origin: 'http://evil.test' }, { sessionId: 'L5', callId: 'h1', decision: 'confirm' })).status, 403);
  assert.equal((await post({ origin: 'http://dsh.test' }, { sessionId: 'L5', callId: 'h1', decision: 'confirm' })).status, 400);
  assert.equal((await post({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, { sessionId: 'L5', callId: 'h1', decision: 'confirm' })).status, 403);
  assert.equal((await post({ 'content-type': 'application/json', origin: 'http://dsh.test' }, { sessionId: 'nobody', callId: 'h1', decision: 'confirm' })).status, 404);
  // As forwarded by the desktop app: no Origin header at all.
  const ok = await post({ 'content-type': 'application/json' }, { sessionId: 'L5', callId: 'h1', decision: 'confirm', catalogVersion: got.catalogVersion });
  assert.equal(ok.status, 200);
  assert.equal((await p).asked, true);
});
