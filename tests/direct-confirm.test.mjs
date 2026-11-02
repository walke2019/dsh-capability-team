// The Lead's step limit lifts only when the user allows it, and only until their next message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { createWorkflow } from '../workflow.js';
import { answerPending, createDispatchConfirm, forgetLead, pendingView } from '../dispatch-confirm.js';
import { effectiveConfig } from '../config.js';
import { base } from './fixture.mjs';

const W = effectiveConfig({}, base).workflow;

function harness(answer, overrides = {}) {
  const eff = effectiveConfig(overrides, base);
  let guard; let claimed; const tools = {}; const asked = [];
  const lead = { id: 'lead' };
  const ctx = { agentPresets: { composedPreset: () => 'capability-team' }, effect: f => f(), on: (name, fn) => { if (name === 'agent/inbox/claimed') claimed = fn; },
    tools: { guard: g => { guard = g; return () => {}; }, register: t => { tools[t.name] = t; return () => {}; } },
    agentTeams: { tryMembership: a => (a === lead ? { role: 'lead' } : undefined), membership: () => ({}) } };
  const team = { base, pinned: () => 'P', loadSync: () => ({ effective: eff }), load: async () => ({ effective: eff, policy: { disabledRoutes: [] } }) };
  const dispatchConfirm = { confirmDirect: async (_exec, plan) => { asked.push(plan); return answer(); }, confirm: async () => ({ asked: false, routes: [] }) };
  const wf = createWorkflow(ctx, team, { dispatchConfirm }); wf.register();
  return { wf, lead, asked, user: () => claimed({ agent: lead, message: { source: { kind: 'user' } } }),
    plan: args => tools.capability_dispatch_plan.execute(args, { agent: lead }), call: name => guard({ agent: lead, name, arguments: {} }) };
}
const personal = { analysis: '用户要主控亲自修复', mode: 'direct', reason: '用户说你自己改', userRequested: true };
const plain = { analysis: '小事', mode: 'direct', reason: '一条命令' };

test('用户允许后：主控本轮不限步数，下一条用户消息恢复限制', async () => {
  const h = harness(() => true);
  h.user();
  const out = JSON.parse(await h.plan(personal));
  assert.equal(h.asked.length, 1);
  assert.equal(out.directBudget, null);
  assert.equal(out.confirmed.by, 'user');
  for (let i = 0; i < W.directBudget + 5; i++) assert.equal(h.call('pwsh'), undefined);
  assert.match(h.wf.status(h.lead, W), /不限执行次数/);
  h.user();
  await h.plan(plain);
  for (let i = 0; i < W.directBudget; i++) assert.equal(h.call('pwsh'), undefined);
  assert.match(h.call('pwsh'), /已达本轮上限/);
});

test('用户拒绝：计划不生效，执行类工具仍被拦截', async () => {
  const h = harness(() => { throw new Error('用户没有放开主控的执行限制'); });
  h.user();
  await assert.rejects(h.plan(personal), /没有放开/);
  assert.equal(h.wf.state(h.lead).plan, undefined);
  assert.match(h.call('pwsh'), /capability_dispatch_plan/);
});

test('只有 userRequested 严格为 true 才询问；其他模式和非强制工作流不询问', async () => {
  const h = harness(() => true);
  h.user();
  await h.plan({ ...personal, userRequested: 'yes' });
  await h.plan(plain);
  await h.plan({ analysis: 'a', mode: 'free', reason: 'r', userRequested: true });
  assert.equal(h.asked.length, 0);
  const remind = harness(() => true, { workflow: { mode: 'remind' } });
  remind.user();
  assert.equal(JSON.parse(await remind.plan(personal)).directBudget, W.directBudget);
  assert.equal(remind.asked.length, 0);
});

test('放行不跨计划：换成普通计划恢复预算，改为 delegate 后主控不能执行', async () => {
  const h = harness(() => true);
  h.user();
  await h.plan(personal);
  await h.plan(plain);
  assert.equal(h.wf.state(h.lead).directConfirmed, false);
  await h.plan(personal);
  await h.plan({ analysis: 'a', mode: 'delegate', assignments: [{ role: 'lv-bu', task: 't' }] });
  assert.match(h.call('pwsh'), /主控只负责分派/);
});

test('确认期间用户发来新消息：这次放行失效，不带入新一轮', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const h = harness(async () => { await gate; return true; });
  h.user();
  const pending = h.plan(personal);
  await new Promise(r => setTimeout(r, 5));
  h.user();
  release();
  await assert.rejects(pending, /放行已失效/);
  assert.equal(h.wf.state(h.lead).directConfirmed, undefined);
  assert.equal(h.wf.state(h.lead).plan, undefined);
});

const exec = (id, callId, signal) => ({ agent: { id }, callId, signal });
const directPlan = { mode: 'direct', analysis: personal.analysis, reason: personal.reason, assignments: [] };

test('确认请求：卡片看到需求和理由，允许后返回 true', async () => {
  const waiting = createDispatchConfirm({}, {}, { graceMs: 1000 }).confirmDirect(exec('direct-1', 'c1'), directPlan);
  const view = pendingView('direct-1', 'c1');
  assert.deepEqual([view.status, view.kind, view.analysis, view.reason], ['pending', 'direct', directPlan.analysis, directPlan.reason]);
  assert.equal(view.routes, undefined);
  assert.equal(answerPending('direct-1', 'c1', { decision: 'confirm' }).decision, 'confirm');
  assert.equal(await waiting, true);
  assert.equal(pendingView('direct-1', 'c1').status, 'none');
  forgetLead('direct-1');
});

test('确认请求：拒绝抛错，无效答复不算放行', async () => {
  const waiting = createDispatchConfirm({}, {}, { graceMs: 1000 }).confirmDirect(exec('direct-2', 'c1'), directPlan);
  assert.throws(() => answerPending('direct-2', 'c1', { decision: 'yes' }), e => e.status === 422);
  assert.throws(() => answerPending('direct-2', 'c1', {}), e => e.status === 422);
  assert.equal(pendingView('direct-2', 'c1').status, 'pending');
  answerPending('direct-2', 'c1', { decision: 'cancel' });
  await assert.rejects(waiting, /没有放开/);
  forgetLead('direct-2');
});

test('确认请求：没有卡片时回退到问答框，只有选“允许”才放行', async () => {
  for (const [label, allowed] of [['允许', true], ['不允许', false]]) {
    const questions = [];
    const userQuestions = { ask: async q => { questions.push(q.questions[0]); return { answers: [{ id: 'direct', selected: [label] }] }; } };
    const waiting = createDispatchConfirm({ userQuestions }, {}, { graceMs: 10, heartbeatMs: 10, timeoutMs: 5000 }).confirmDirect(exec(`direct-3-${label}`, 'c1'), directPlan);
    if (allowed) assert.equal(await waiting, true); else await assert.rejects(waiting, /没有放开/);
    assert.ok(questions[0].detail.includes(directPlan.reason));
    forgetLead(`direct-3-${label}`);
  }
});

test('确认请求：超时或中止都不放行，错误说明限制没有放开', async () => {
  await assert.rejects(createDispatchConfirm({}, {}, { graceMs: 10, heartbeatMs: 10, timeoutMs: 40 }).confirmDirect(exec('direct-4', 'c1'), directPlan), /主控亲自完成确认超时.*执行限制没有放开/);
  const abort = new AbortController();
  const waiting = createDispatchConfirm({}, {}, { graceMs: 1000 }).confirmDirect(exec('direct-4', 'c2', abort.signal), directPlan);
  abort.abort();
  await assert.rejects(waiting, /主控亲自完成确认已中止/);
  assert.equal(pendingView('direct-4', 'c2').status, 'none');
  forgetLead('direct-4');
});

// Client card, run from the built client.js against a minimal React stand-in.
const flush = () => new Promise(resolve => setTimeout(resolve, 5));
function loadCard(fetchImpl) {
  let exposed, cursor = 0;
  const states = [], effects = [], cleanups = [], calls = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return states[i] ??= { current: initial }; },
    useEffect(fn) { effects.push(fn); },
    useMemo: fn => fn(),
    Fragment: Symbol.for('react.fragment'),
  };
  const fetch = async (url, init = {}) => { calls.push({ url, init }); return fetchImpl(url, init); };
  const timer = { setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); id.unref?.(); return id; }, clearTimeout };
  const sandbox = { window: { __ModuleLoader__: { load: spec => spec.factory(() => React) }, __ctmTestHook: x => { exposed = x; } }, fetch, AbortController, URLSearchParams, console, ...timer };
  new Script(readFileSync(new URL('../client.js', import.meta.url), 'utf8')).runInNewContext(sandbox);
  let ran = false;
  const render = () => {
    cursor = 0; effects.length = 0;
    const tree = exposed.DirectConfirmCard({ t: k => k, sessionId: 'lead-1', callId: 'c1' });
    if (!ran) { ran = true; for (const fn of effects.splice(0)) cleanups.push(fn()); }
    return tree;
  };
  return { render, calls, unmount: () => { for (const fn of cleanups.splice(0)) fn?.(); } };
}
const text = n => (typeof n === 'string' ? n : (n?.children ?? []).map(text).join(''));
const find = (node, pred) => { if (!node || typeof node !== 'object') return undefined; if (pred(node)) return node; for (const c of node.children ?? []) { const r = find(c, pred); if (r) return r; } return undefined; };
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
const directPending = { schemaVersion: 1, status: 'pending', kind: 'direct', callId: 'c1', analysis: '需求', reason: '用户说你自己改' };
const button = (tree, label) => find(tree, n => n.type === 'button' && text(n) === label);

test('确认卡片：显示理由，点允许提交 confirm 且不带路由', async () => {
  const h = loadCard(async (_url, init) => (init.method === 'POST' ? json(200, { status: 'resolved' }) : json(200, directPending)));
  h.render(); await flush();
  const tree = h.render();
  assert.ok(text(tree).includes(directPending.reason));
  button(tree, 'direct.allow').props.onClick();
  await flush();
  assert.deepEqual(JSON.parse(h.calls.find(c => c.init.method === 'POST').init.body), { sessionId: 'lead-1', callId: 'c1', decision: 'confirm' });
  assert.ok(text(h.render()).includes('direct.sent'));
  h.unmount();
});

test('确认卡片：提交失败显示错误，点不允许提交 cancel', async () => {
  let ok = false;
  const h = loadCard(async (_url, init) => (init.method === 'POST' ? json(ok ? 200 : 500, {}) : json(200, directPending)));
  h.render(); await flush();
  button(h.render(), 'direct.deny').props.onClick(); await flush();
  assert.ok(text(h.render()).includes('confirm.error.other'));
  ok = true;
  button(h.render(), 'direct.deny').props.onClick(); await flush();
  assert.equal(JSON.parse(h.calls.filter(c => c.init.method === 'POST').at(-1).init.body).decision, 'cancel');
  assert.ok(text(h.render()).includes('direct.cancelled'));
  h.unmount();
});

test('端到端：工作流经真实确认通道等待用户，允许后才放开', async () => {
  const eff = effectiveConfig({}, base);
  let guard; const tools = {};
  const lead = { id: 'direct-e2e' };
  const ctx = { agentPresets: { composedPreset: () => 'capability-team' }, effect: f => f(), on: () => {},
    tools: { guard: g => { guard = g; return () => {}; }, register: t => { tools[t.name] = t; return () => {}; } },
    agentTeams: { tryMembership: a => (a === lead ? { role: 'lead' } : undefined) } };
  const team = { base, pinned: () => 'P', loadSync: () => ({ effective: eff }), load: async () => ({ effective: eff, policy: { disabledRoutes: [] } }) };
  createWorkflow(ctx, team, { dispatchConfirm: createDispatchConfirm(ctx, team, { graceMs: 1000 }) }).register();
  const call = () => guard({ agent: lead, name: 'pwsh', arguments: {} });
  const pending = tools.capability_dispatch_plan.execute(personal, { agent: lead, callId: 'e2e' });
  await flush();
  assert.equal(pendingView(lead.id, 'e2e').kind, 'direct');
  assert.match(call(), /capability_dispatch_plan/, '用户回答前不放行');
  answerPending(lead.id, 'e2e', { decision: 'confirm' });
  assert.equal(JSON.parse(await pending).directBudget, null);
  for (let i = 0; i < W.directBudget + 3; i++) assert.equal(call(), undefined);
  forgetLead(lead.id);
});

test('计划卡片：只有运行中的 direct 且 userRequested 为 true 才挂确认卡片', () => {
  let exposed;
  const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }), useState: v => [v, () => {}], useRef: current => ({ current }), useEffect() {}, useMemo: fn => fn(), Fragment: Symbol.for('react.fragment') };
  const sandbox = { window: { __ModuleLoader__: { load: spec => spec.factory(() => React) }, __ctmTestHook: x => { exposed = x; } }, fetch: async () => {}, AbortController, URLSearchParams, console, setTimeout, clearTimeout };
  new Script(readFileSync(new URL('../client.js', import.meta.url), 'utf8')).runInNewContext(sandbox);
  const view = args => exposed.DispatchPlanView({ t: k => k, phase: 'start', block: { argsRaw: JSON.stringify(args) }, callId: 'c1', sessionId: 'lead-1' });
  const hasCard = tree => Boolean(find(tree, n => n.type === exposed.DirectConfirmCard));
  assert.equal(hasCard(view(personal)), true);
  assert.equal(hasCard(view({ ...personal, userRequested: 'yes' })), false);
  assert.equal(hasCard(view(plain)), false);
  assert.equal(hasCard(view({ analysis: 'a', mode: 'free', reason: 'r', userRequested: true })), false);
});
