import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createNativeCompat } from '../native-compat.js';
import { apply as applyRoles } from '../roles.js';
import { applySpawnConfirm } from '../spawn-confirm.js';
import { createDispatchConfirm, answerPending, pendingView, forgetLead } from '../dispatch-confirm.js';
import { effectiveConfig, resolveRole } from '../config.js';
import { base } from './fixture.mjs';
import './keep-alive.mjs';

const entry = process.env.DSH_RC2_SUBAGENT_ENTRY;
async function nativeModule(moduleEntry, exposed) {
  const require = createRequire(moduleEntry);
  let source = await readFile(moduleEntry, 'utf8');
  // Run the complete official module, exposing only its otherwise private manager for host-boundary tests.
  source = source.replace(/from "([^\"]+)"/g, (_match, name) => `from ${JSON.stringify(name.startsWith('node:') ? name : pathToFileURL(require.resolve(name)).href)}`);
  return import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport { ${exposed} };`).toString('base64')}`);
}
function session(id, origin) {
  return { id, seq: 1, header: { id, cwd: '/workspace', agentPreset: 'capability-team', origin }, append() {}, requestHeader: () => ({}), isOwnSeq: () => false };
}
async function localHarness({ unassigned = false } = {}) {
  const { SubagentManager } = await nativeModule(entry, 'SubagentManager');
  const loopEntry = createRequire(entry).resolve('@deepseek-ai/dsh-agent-loop');
  const { ReactLoopAgent } = await nativeModule(loopEntry, 'ReactLoopAgent');
  const rows = new Map(), listeners = new Map(), requests = [], edges = [];
  const parent = { id: 'root', session: session('root'), options: {}, ctx: { fiber: { state: 2 }, get() {} } };
  rows.set(parent.id, parent);
  const workingDirectory = { async set(agent, cwd) { agent.session.header.cwd = cwd; }, get: agent => agent.session.header.cwd };
  const ctx = {
    workingDirectory: { ensure: async () => '/workspace' },
    agents: { get: id => rows.get(id) },
    get(name) { return { sessionPersistence: {}, workingDirectory }[name]; },
    on(name, fn) { listeners.set(name, fn); return () => {}; },
    effect(fn) { fn(); }, plugin() { return { ctx: { agents: ctx.agents }, dispose() {} }; },
    logger: { warn() {} },
  };
  let manager;
  const native = {
    rootOf: agent => manager.rootOf(agent), namesOf: agent => manager.namesOf(agent),
    resolveName() {}, listDescendants() {},
  };
  const compat = createNativeCompat({ ...ctx, agentTeams: { isEnabled() {}, createTask() {}, getTask() {}, listTasks() {}, updateTask() {} }, inject(_names, fn) { fn({ subagents: native, effect() {} }); } });
  const role = unassigned ? { unassigned: true, id: 'backend' } : { provider: 'role-provider', model: 'role-model' };
  const team = { native: compat, owns: agent => Boolean(compat.identity(agent)), resolveSync: () => role, resolve: async () => role };
  applyRoles(ctx, team, { route: (_agent, _turn, _step, selected) => selected });
  // Preserve multiple independent native lifecycle observers, as Cordis does.
  const routeStart = listeners.get('subagent/start');
  listeners.set('subagent/start', info => { routeStart(info); edges.push(compat.identity(rows.get(info.id)).address); });
  const pending = [];
  ctx.agents.create = async ({ sessionId, setup, agentOptions }) => {
    const childCtx = { systemPrompt: { context() {}, getContextOrder: () => 0 }, on() {}, get: name => name === 'workingDirectory' ? workingDirectory : undefined, fiber: { state: 2 } };
    let selected = { provider: 'inherited-lead', model: 'lead-model' };
    const child = { id: sessionId, session: session(sessionId, 'subagent'), options: { ...agentOptions }, ctx: childCtx,
      model: { current: () => selected, select: route => { selected = route; } },
      loopCtx: { llm: { async prepareCall(config) { requests.push(config); return { config }; } } },
      dispatch: { waterfall: (_event, payload, next) => listeners.get('agent/request')({ agent: child, ...payload }, next) },
      inbox: { nextStep: [], nextTurn: [] }, followup() {
        pending.push(ReactLoopAgent.prototype.prepareRequest.call(child, 1, 1, child.model.current(), new AbortController().signal));
      } };
    rows.set(child.id, child);
    await setup(childCtx, child);
    return { agent: child, async dispose() { rows.delete(child.id); } };
  };
  manager = new SubagentManager(ctx, { identityOf: () => undefined, catalogOf: () => [],
    emitLifecycle(name, info) { listeners.get(name)?.(info); } }, () => 8);
  // Settlement execution is outside this first-admission contract; never start a real provider or background agent.
  manager.watchLocalSettlement = () => {};
  return { manager, compat, rows, parent, requests, edges, pending, ctx,
    start: (signal = new AbortController().signal) => manager.startLocal({ parent, provider: 'local', label: 'backend test', name: 'backend', prompt: 'test', delivery: 'parent', maxDepth: 2, signal }, async () => ({})) };
}
test('real rc2 local startup publishes native identity before first admitted model request', { skip: !entry }, async () => {
  const { start, compat, rows, parent, requests, edges, pending } = await localHarness();
  const receipt = await start();
  await Promise.all(pending);
  assert.ok(receipt.childId);
  assert.deepEqual(edges, ['backend']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].provider, 'role-provider');
  assert.equal(requests[0].model, 'role-model');
  assert.equal(compat.identity(rows.get(receipt.childId)).rootId, parent.id);
  assert.equal(compat.identity({ ...rows.get(receipt.childId) }), undefined, 'same id forged Agent is not native identity');
  assert.equal(compat.identity(parent).address, 'lead');
});
test('real rc2 abort rejects before activation and unknown role never reaches provider', { skip: !entry }, async () => {
  const cancelled = await localHarness();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(cancelled.start(controller.signal));
  assert.equal(cancelled.manager.resident.size, 0);
  assert.equal(cancelled.requests.length, 0);
  const unknown = await localHarness({ unassigned: true });
  await unknown.start();
  await assert.rejects(Promise.all(unknown.pending));
  assert.equal(unknown.requests.length, 0, 'inherited Lead provider must never be requested');
});
test('real rc2 approval precedes model confirmation; cancel creates zero activations', { skip: !entry }, async () => {
  const h = await localHarness();
  const pipelineEntry = createRequire(entry).resolve('@deepseek-ai/dsh-tools/pipeline');
  const { ToolExecutionPipeline } = await import(pathToFileURL(pipelineEntry).href);
  const events = [], hooks = new Map();
  const effective = effectiveConfig({ workflow: { mode: 'off', confirmDispatch: 'on-change' } }, base);
  const entries = Object.values(effective.capabilities).flatMap(c => [c, ...(c.fallbacks ?? [])]).filter(r => r.provider);
  const role = resolveRole({ role: 'teammate', name: 'backend' }, effective);
  const ctx = {
    tools: { checkGuards() { events.push('guard'); } },
    agentTeams: {},
    llm: { listProviders: () => [...new Set(entries.map(r => r.provider))].map(id => ({ id })), listModels: async id => entries.filter(r => r.provider === id).map(r => ({ id: r.model })) },
    on: (name, fn) => hooks.set(name, fn),
    waterfall: (_carrier, name, exec, next) => name === 'tools/pre-execute' ? Promise.resolve({ kind: 'ask' }) : hooks.get(name)(exec, next),
    get: () => ({ request: async () => { events.push('approval'); return 'allowed-once'; } }),
  };
  const team = { native: h.compat, load: async () => ({ effective, policy: { disabledRoutes: [] }, revision: 0 }), resolveMember: async () => role };
  const confirmation = createDispatchConfirm(ctx, team, { graceMs: 100000, timeoutMs: 3000 });
  applySpawnConfirm(ctx, team, { eligibility: () => ({ eligible: true }) }, confirmation);
  const pipeline = new ToolExecutionPipeline(ctx, { get: () => ({}) });
  pipeline.normalizeDispatchResult = (_exec, result) => result;
  pipeline.materializeFinalResult = result => result;
  pipeline.dispatchToolBody = async () => { events.push('native-start'); await h.start(); return { content: [], isError: false }; };
  try {
    const prepared = await pipeline.prepare({ agent: h.parent, name: 'subagent', callId: 'cancel-native', signal: new AbortController().signal,
      arguments: { name: 'backend', prompt: 'Implement safely', description: 'Build' } });
    assert.equal(prepared.kind, 'dispatch');
    const running = pipeline.dispatch(prepared.exec);
    for (let i = 0; i < 30 && pendingView(h.parent.id, 'cancel-native').status !== 'pending'; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(pendingView(h.parent.id, 'cancel-native').status, 'pending');
    assert.deepEqual(events, ['approval', 'guard']);
    answerPending(h.parent.id, 'cancel-native', { decision: 'cancel' });
    assert.equal((await running).result.isError, true);
    assert.equal(h.manager.resident.size, 0);
    assert.equal(h.requests.length, 0);
    const allowed = await pipeline.prepare({ agent: h.parent, name: 'subagent', callId: 'allow-native', signal: new AbortController().signal,
      arguments: { name: 'backend', prompt: 'Implement safely', description: 'Build' } });
    const starting = pipeline.dispatch(allowed.exec);
    for (let i = 0; i < 30 && pendingView(h.parent.id, 'allow-native').status !== 'pending'; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(pendingView(h.parent.id, 'allow-native').status, 'pending');
    answerPending(h.parent.id, 'allow-native', { decision: 'confirm' });
    assert.equal((await starting).result.isError, false);
    await Promise.all(h.pending);
    assert.equal(events.at(-1), 'native-start');
    assert.equal(h.manager.resident.size, 1);
    assert.equal(h.requests.length, 1);
  } finally { forgetLead(h.parent.id); }
});
