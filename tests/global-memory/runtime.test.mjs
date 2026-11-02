import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, CONTEXT } from '../../packages/global-memory/runtime.js';
import { configuration } from '../../packages/global-memory/config.js';
import { eligible } from '../../packages/global-memory/identity.js';
const tick = () => new Promise(r => setImmediate(r));
function fixture(options = {}) {
  const listeners = new Map(), tools = new Map(), contexts = new Map();
  const agent = { id: 'a', ctx: { preset: options.preset ?? 'ordinary', tools: { register(def) { tools.set(def.name, def); return () => tools.delete(def.name); } }, systemPrompt: { context(def) { contexts.set(def.name, def); return () => contexts.delete(def.name); } } } };
  const ctx = { agents: { list: () => [agent] }, agentPresets: { composedPreset: c => c.preset }, workingDirectory: { ensure: async () => '/example/project' }, on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name); }, effect() {} };
  let calls = 0;
  const service = { clean: async s => s, search: async (_who, args) => { calls++; return options.search ? options.search(args) : { results: [{ id: 'r', kind: 'note', scope: 'project', text: args.query }] }; } };
  const config = configuration(options.config);
  const store = { format: (rows, budget) => rows.map(r => r.memory.text).join('\n').slice(0, budget) };
  const runtime = createRuntime(ctx, config, service, store);
  const claim = text => runtime.claimed({ agent, message: { source: { kind: 'user' }, content: [{ type: 'text', text }] } });
  const assembly = async (overrides = {}) => {
    const value = { contexts: [{ name: CONTEXT, text: '' }, { name: 'other', text: 'unchanged' }], tools: ['stable'], sections: ['policy'] };
    return runtime.assemble(value, { agent, ...overrides }, async () => value);
  };
  ctx.listeners = listeners;
  return { ctx, agent, tools, contexts, runtime, claim, assembly, calls: () => calls };
}
test('1 ordinary/other presets/subagents eligible; team root and failed services safely yield', () => {
  for (const preset of ['ordinary','other','subagent']) { const f = fixture({ preset }); assert.equal(f.tools.size, 2); f.runtime.cleanup(); }
  const f = fixture({ preset: 'capability-team' }); assert.equal(f.tools.size, 0);
  f.agent.ctx.preset = 'ordinary';
  f.ctx.agentTeams = { tryMembership: () => ({ root: { ctx: { preset: 'capability-team' } } }) };
  assert.equal(eligible(f.ctx, f.agent, configuration()), false);
  f.ctx.agentTeams.tryMembership = () => { throw Error('unavailable'); };
  assert.equal(eligible(f.ctx, f.agent, configuration()), false);
});
test('2 first assembly waits, task stable, non-user ignored, next task refreshes', async () => {
  const f = fixture(); f.claim('first task');
  assert.match((await f.assembly()).contexts[0].text, /first task/);
  f.claim('first   task'); await f.assembly(); assert.equal(f.calls(), 1);
  await f.runtime.claimed({ agent: f.agent, message: { source: { kind: 'tool' }, text: 'ignored' } });
  assert.equal(f.calls(), 1);
  f.claim('second task'); assert.match((await f.assembly()).contexts[0].text, /second task/);
  assert.equal(f.calls(), 2); f.runtime.cleanup();
});
test('2 generation prevents stale, abort/dispose prevent commit; timeout clears old result', async () => {
  const pending = [];
  const f = fixture({ search: args => new Promise(resolve => pending.push({ args, resolve })) });
  f.claim('old'); await tick(); f.claim('new'); await tick();
  pending[1].resolve({ results: [{ text: 'new', kind: 'note', scope: 'project' }] });
  assert.match((await f.assembly()).contexts[0].text, /new/);
  pending[0].resolve({ results: [{ text: 'old', kind: 'note', scope: 'project' }] }); await tick();
  assert.doesNotMatch((await f.assembly()).contexts[0].text, /old/);
  f.claim('abort'); await tick(); const c = new AbortController(); c.abort();
  await f.assembly({ signal: c.signal }); f.runtime.cleanup();
  pending[2].resolve({ results: [] }); await tick(); assert.equal(f.runtime.states.size, 0);
  const slow = fixture({ config: { recallTimeoutMs: 100 }, search: () => new Promise(() => {}) });
  slow.claim('timeout'); assert.equal((await slow.assembly()).contexts[0].text, ''); slow.runtime.cleanup();
});
test('3 changes only existing placeholder; suppression respected, cleanup/backfill bounded', async () => {
  const f = fixture(); f.claim('task'); const a = await f.assembly();
  assert.equal(a.contexts[1].text, 'unchanged'); assert.deepEqual(a.sections, ['policy']);
  assert.deepEqual(a.tools, ['stable']);
  const empty = { contexts: [], sections: [] };
  assert.deepEqual(await f.runtime.assemble(empty, { agent: f.agent }, async () => empty), empty);
  f.runtime.install(f.agent); assert.equal(f.tools.size, 2); assert.equal(f.contexts.size, 1);
  f.agent.ctx.preset = 'capability-team'; await f.assembly(); assert.equal(f.tools.size, 0); assert.equal(f.contexts.size, 0);
  f.runtime.cleanup();
});
test('4 independent switches and 6 injection title counts toward budget', async () => {
  const off = fixture({ config: { enabled: false } }); assert.equal(off.tools.size, 0); off.runtime.cleanup();
  const manual = fixture({ config: { autoRecall: false } }); manual.claim('task'); await manual.assembly(); assert.equal(manual.calls(), 0); assert.equal(manual.tools.size, 2); manual.runtime.cleanup();
  const f = fixture({ search: async () => ({ results: [{ kind: 'note', scope: 'project', text: 'x'.repeat(5000) }] }) });
  f.claim('task'); assert.equal((await f.assembly()).contexts[0].text.length, 2400); f.runtime.cleanup();
  assert.throws(() => configuration({ unknown: true })); assert.throws(() => configuration({ injectChars: 10 }));
});
test('pre-step is a waterfall: listener passes the downstream decision through for every agent', async () => {
  const f = fixture();
  const handler = f.ctx.listeners?.get?.('agent/pre-step');
  assert.equal(typeof handler, 'function');
  const decision = { kind: 'enter', messages: [] };
  for (const agent of [f.agent, undefined, { id: 'x' }]) assert.equal(await handler({ agent, messages: [], turn: 1, step: 1 }, async () => decision), decision);
  f.runtime.cleanup();
});
test('recalled memory is served by the context provider, so the per-request refreshContext keeps it', async () => {
  const f = fixture(); f.claim('provider task');
  const assembled = await f.assembly();
  assert.match(assembled.contexts[0].text, /provider task/);
  assert.equal(f.contexts.get(CONTEXT).text(), assembled.contexts[0].text);
  f.runtime.cleanup();
});
