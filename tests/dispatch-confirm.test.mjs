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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// An AbortSignal stand-in that counts its listeners, to prove every exit removes the abort listener.
function trackedSignal() {
  const ctrl = new AbortController();
  const listeners = new Set();
  const signal = { get aborted() { return ctrl.signal.aborted; },
    addEventListener: (type, fn) => { listeners.add(fn); ctrl.signal.addEventListener(type, fn, { once: true }); },
    removeEventListener: (type, fn) => { listeners.delete(fn); ctrl.signal.removeEventListener(type, fn); } };
  return { signal, listeners, abort: () => ctrl.abort() };
}

test('卡片正常确认：心跳期间不弹原生问答框，结束后清理监听与等待项', async () => {
  forgetLead('L6');
  let asked = 0;
  const userQuestions = { ask: async () => { asked++; return new Promise(() => {}); } };
  const confirm = createDispatchConfirm({ llm, userQuestions }, team, { graceMs: 30, heartbeatMs: 60, timeoutMs: 5000 });
  const s = trackedSignal();
  const p = confirm.confirm({ agent: lead('L6'), callId: 'k1', signal: s.signal }, plan, effective, { disabledRoutes: [] }, 'always');
  await flush();
  assert.equal(s.listeners.size, 1);
  for (let i = 0; i < 6; i++) { assert.equal(pendingView('L6', 'k1').status, 'pending'); await sleep(25); }
  assert.equal(asked, 0, '卡片持续心跳时不回退原生问答');
  answerPending('L6', 'k1', { decision: 'confirm' });
  assert.equal((await p).asked, true);
  assert.equal(s.listeners.size, 0, 'abort 监听已移除');
  assert.equal(pendingView('L6', 'k1').status, 'none');
});

test('无人确认时按总超时报错，不再永久挂起', async () => {
  forgetLead('L7');
  const confirm = createDispatchConfirm({ llm }, team, { graceMs: 10, heartbeatMs: 10, timeoutMs: 60 });
  const s = trackedSignal();
  const p = confirm.confirm({ agent: lead('L7'), callId: 't1', signal: s.signal }, plan, effective, { disabledRoutes: [] }, 'always');
  await assert.rejects(p, /分派确认超时（\d+(\.\d)? 分钟无人确认），未创建或通知任何队友。请询问用户是否重新分派。/);
  assert.equal(s.listeners.size, 0);
  assert.equal(pendingView('L7', 't1').status, 'none');
});

test('卡片心跳失联后回退原生问答框，且只问一次；原生问答失败时卡片仍可回答', async () => {
  forgetLead('L8');
  let asked = 0, signal;
  const userQuestions = { ask: async q => { asked++; signal = q.signal; throw Object.assign(new Error('no client'), { code: 'NO_PROVIDER' }); } };
  const confirm = createDispatchConfirm({ llm, userQuestions }, team, { graceMs: 1000, heartbeatMs: 30, timeoutMs: 5000 });
  const p = confirm.confirm({ agent: lead('L8'), callId: 'b1', signal: new AbortController().signal }, plan, effective, { disabledRoutes: [] }, 'always');
  await flush();
  pendingView('L8', 'b1'); // the card appears once, then disappears (tab closed)
  await sleep(120);
  assert.equal(asked, 1, '心跳过期后回退原生问答');
  await sleep(80);
  assert.equal(asked, 1, '原生问答只发起一次');
  assert.equal(pendingView('L8', 'b1').status, 'pending', '原生问答失败不让确认立即失败');
  answerPending('L8', 'b1', { decision: 'confirm' });
  assert.equal((await p).asked, true);
  assert.equal(signal.aborted, true, '结束时中止原生问答框的 signal');
});

test('原生问答框回答后中止残留；卡片从未出现时在 graceMs 后回退', async () => {
  forgetLead('L9');
  let signal;
  const userQuestions = { ask: async q => { signal = q.signal; return { answers: [{ id: 'dispatch', selected: ['确认分派'] }] }; } };
  const confirm = createDispatchConfirm({ llm, userQuestions }, team, { graceMs: 20, heartbeatMs: 1000, timeoutMs: 5000 });
  const result = await confirm.confirm({ agent: lead('L9'), callId: 'n1' }, plan, effective, { disabledRoutes: [] }, 'always');
  assert.equal(result.asked, true);
  assert.equal(signal.aborted, true);
  assert.equal(pendingView('L9', 'n1').status, 'none');
});

test('中止后清理监听、定时器与等待项，原生问答框随之中止', async () => {
  forgetLead('L10');
  let signal;
  const userQuestions = { ask: q => { signal = q.signal; return new Promise(() => {}); } };
  const confirm = createDispatchConfirm({ llm, userQuestions }, team, { graceMs: 10, heartbeatMs: 10, timeoutMs: 5000 });
  const s = trackedSignal();
  const p = confirm.confirm({ agent: lead('L10'), callId: 'a1', signal: s.signal }, plan, effective, { disabledRoutes: [] }, 'always');
  await sleep(60);
  assert.ok(signal && !signal.aborted, '原生问答框已发起');
  s.abort();
  await assert.rejects(p, /分派确认已中止/);
  assert.equal(s.listeners.size, 0);
  assert.equal(signal.aborted, true);
  assert.equal(pendingView('L10', 'a1').status, 'none');
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
