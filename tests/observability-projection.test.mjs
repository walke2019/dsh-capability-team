import test from 'node:test';
import assert from 'node:assert/strict';
import { activityDefinition as a, artifactsDefinition as f, reportDefinition as r, ownUsageDefinition, observabilityDefinitions } from '../observability-projection.js';
const event = (seq, type, data = {}, time = seq * 100) => ({ seq, type, data, time });
const init = d => d.init({ id: 's', cwd: '/project' }, 2);
const apply = (d, events) => events.reduce(d.apply, init(d));
test('projection inheritance, unrelated identity, stable view and replay', () => {
  for (const d of observabilityDefinitions) {
    const s = init(d); assert.equal(d.apply(s, event(0, 'tool/call')), s); assert.equal(d.apply(s, event(3, 'unrelated')), s); assert.equal(d.wire.view(s), d.wire.view(s));
    assert.equal(d.stateVersion, d === r ? 3 : 1); assert.deepEqual(d.stateSchema.parse(JSON.parse(JSON.stringify(s))), s); assert.throws(() => d.stateSchema.parse({}));
  }
});
test('activity concurrent pairs, source.callId, fail, turn-end and bounded secret-free wire', () => {
  let s = init(a);
  s = a.apply(s, event(2, 'tool/call', { callId: 'a', name: 'bash', arguments: '{"command":"sk-BAIT","description":"sk-BAIT"}' }));
  s = a.apply(s, event(3, 'tool/call', { callId: 'b', name: 'read', arguments: '{"file_path":"src/x"}' }));
  s = a.apply(s, event(4, 'tool/result', { message: { source: { callId: 'b' }, isError: true, content: 'sk-BAIT' } }));
  assert.equal(s.view.current.status, 'failed'); assert.equal(s.view.activeCount, 1); assert.equal(s.view.phase, 'tool');
  assert.equal(a.apply(s, event(5, 'tool/result', { message: { source: { callId: 'orphan' } } })), s);
  s = a.apply(s, event(6, 'turn/end', { reason: { kind: 'cancelled' } })); assert.equal(s.view.activeCount, 0); assert.equal(s.view.recent[1].status, 'interrupted');
  for (let i = 7; i < 90; i++) s = a.apply(s, event(i, 'tool/call', { callId: `c${i}`, name: 'bash', arguments: 'sk-BAIT' }));
  assert.equal(s.pending.length, 64); assert.equal(s.view.recent.length, 8); assert.ok(s.view.truncated); assert.ok(!JSON.stringify(s).includes('sk-BAIT'));
});
test('artifact coordinates separate presented/changes; duplicates retained, sensitive omitted and bytes bounded', () => {
  let s = apply(f, [event(2, 'workspace/changes', { turn: 1 }), event(3, 'deliverables/presented', { turn: 1, files: [{ path: 'a.md', description: 'sk-BAIT' }, { path: '.env' }] }), event(4, 'deliverables/presented', { files: [{ path: 'a.md' }] })]);
  assert.equal(s.view.items.length, 2); assert.equal(s.view.items[0].presentSeq, 4); assert.equal(s.view.changes[0].seq, 2); assert.equal(s.view.items[0].changeRef, null); assert.ok(!JSON.stringify(s.view).includes('sk-BAIT')); assert.ok(!JSON.stringify(s.view).includes('.env'));
  assert.equal(f.apply(s, event(4, 'deliverables/presented', { files: [{ path: 'a.md' }] })), s);
  for (let i = 5; i < 40; i++) s = f.apply(s, event(i, 'deliverables/presented', { files: [{ path: 'x.md' }] }));
  assert.equal(s.view.items.length, 20); assert.ok(Buffer.byteLength(JSON.stringify(s.view)) < 32768);
});
test('stepsStarted excludes inheritance and duplicate seq while retries do not add steps',()=>{let s=r.init({id:'s'},2);s=r.apply(s,event(1,'step/start',{turn:1,step:1}));const e=event(2,'step/start',{turn:2,step:1});s=r.apply(s,e);s=r.apply(s,e);s=r.apply(s,event(3,'llm/retry-started',{turn:2,step:1}));assert.equal(s.view.stepsStarted,1);assert.equal(s.view.steps,0);});
test('own usage projection and report exclude parent usage and agree on plugin attempts', () => {
  const events = [event(0, 'assistant/message', { turn: 1, step: 1, usage: { inputTokens: 30 } }), event(1, 'assistant/message', { turn: 1, step: 2, usage: { inputTokens: 999 } }), event(2, 'request/header', { header: { config: { provider: 'p', model: 'm' } } }), event(3, 'assistant/attempt', { turn: 2, step: 1, stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 4 } } }] }), event(4, 'assistant/message', { turn: 2, step: 1, usage: { inputTokens: 7 } })];
  const own = apply(ownUsageDefinition, events), report = apply(r, events);
  assert.equal(own.view.totals.uncachedInputTokens, 11); assert.deepEqual(report.view.usage, own.view.totals);
  assert.equal(report.view.usageCoverage.coverage, 'complete');
  assert.equal(ownUsageDefinition.apply(own, events.at(-1)), own);
});
test('report slot replacement, host retries, timing and own-event counters', () => {
  const events = [event(2, 'turn/start'), event(3, 'step/start', { turn: 1, step: 1 }), event(4, 'assistant/attempt', { turn: 1, step: 1, stream: [{ type: 'chunk', time: 350, chunk: { type: 'text-delta', text: 'sk-BAIT' } }, { type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } } }] }), event(5, 'assistant/message', { turn: 1, step: 1, usage: { inputTokens: 20, outputTokens: 3 } }), event(6, 'llm/retry-started', { turn: 1, step: 1 }), event(7, 'assistant/message', { turn: 1, step: 1, usage: { inputTokens: 5, outputTokens: 1 } }), event(8, 'tool/call', { callId: 'x', name: 'send_message' }), event(9, 'tool/result', { message: { source: { callId: 'x' } } }), event(10, 'team/task'), event(11, 'step/end', { turn: 1, step: 1 }), event(12, 'turn/end', { reason: { kind: 'error' } })];
  const s = apply(r, events); assert.equal(s.view.usage.uncachedInputTokens, 35); assert.equal(s.view.timing.llmMs, 200); assert.equal(s.view.timing.ttftMs, 50); assert.equal(s.view.timing.toolMs, 100); assert.equal(s.view.counters.hostRetriesStarted, 1); assert.equal(s.view.counters.failedTurns, 1); assert.equal(s.view.counters.sendMessageAccepted, 1); assert.equal(s.view.counters.boardMutations, 1); assert.ok(!JSON.stringify(s).includes('sk-BAIT')); assert.deepEqual(apply(r, events), s);
  assert.equal(r.init({ origin: 'subagent' }).view.counters.boardMutations, null);
  const cancelled = apply(r, [event(2, 'step/start', { turn: 1, step: 1 }), event(3, 'assistant/attempt', { turn: 1, step: 1, stream: [{ type: 'chunk', time: 250, chunk: { type: 'text-delta', text: 'secret' } }] }), event(4, 'step/end', { turn: 1, step: 1 }), event(5, 'turn/end', { reason: { kind: 'cancelled' } })]);
  assert.equal(cancelled.view.timing.llmMs, 0); assert.equal(cancelled.view.timing.ttftMs, 0); assert.equal(cancelled.view.counters.failedTurns, 0);
});
