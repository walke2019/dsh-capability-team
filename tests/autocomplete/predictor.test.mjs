import test from 'node:test';
import assert from 'node:assert/strict';
import '../keep-alive.mjs';
import { PredictionError, readConfig, parseRequest, resolveRoute, buildPrompt, suggestionsFrom, predict } from '../../packages/autocomplete/predictor.js';
import { DEFAULT_CONFIG, LIMITS, createConfig } from '../../packages/autocomplete/schema.js';

const session = (messages, route = { provider: 'p', model: 'm' }) => ({
  requestHeader: () => ({ config: route }), deriveMessages: () => messages,
});
const code = fn => { try { fn(); } catch (error) { assert.ok(error instanceof PredictionError); return error.code; } assert.fail('expected PredictionError'); };

test('readConfig snapshots volatile getters and rejects out-of-range values', () => {
  assert.deepEqual(readConfig({}), DEFAULT_CONFIG);
  assert.equal(readConfig({ maxSuggestions: { get: () => 5 } }).maxSuggestions, 5);
  assert.equal(code(() => readConfig({ maxSuggestions: 9 })), 'invalid-config');
  assert.equal(code(() => readConfig({ routeMode: 'other' })), 'invalid-config');
  assert.equal(code(() => readConfig({ typePauseMs: 199.5 })), 'invalid-config');
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    assert.equal(readConfig({ [key]: min })[key], min); assert.equal(readConfig({ [key]: max })[key], max);
  }
});

test('parseRequest validates session, mode and draft', () => {
  assert.deepEqual(parseRequest({ sessionId: 's' }), { sessionId: 's', mode: 'next', draft: '' });
  assert.deepEqual(parseRequest({ sessionId: 's', mode: 'next', draft: 'ignored' }).draft, '');
  assert.equal(parseRequest({ sessionId: 's', mode: 'continue', draft: 'abc' }).draft, 'abc');
  assert.equal(code(() => parseRequest(null)), 'invalid-body');
  assert.equal(code(() => parseRequest({ sessionId: ' ' })), 'invalid-session');
  assert.equal(code(() => parseRequest({ sessionId: 's', mode: 'x' })), 'invalid-mode');
  assert.equal(code(() => parseRequest({ sessionId: 's', mode: 'continue', draft: '  ' })), 'empty-draft');
  assert.equal(code(() => parseRequest({ sessionId: 's', draft: 'x'.repeat(4001) })), 'draft-too-large');
});

test('resolveRoute follows the session or requires a complete fixed route', () => {
  assert.deepEqual(resolveRoute(DEFAULT_CONFIG, session([])), { provider: 'p', model: 'm', maxTokens: 220 });
  assert.equal(code(() => resolveRoute(DEFAULT_CONFIG, session([], null))), 'session-route-not-configured');
  const fixed = { ...DEFAULT_CONFIG, routeMode: 'fixed', provider: 'cpa', model: '' };
  assert.equal(code(() => resolveRoute(fixed, session([]))), 'fixed-route-not-configured');
  assert.equal(resolveRoute({ ...fixed, model: ' fast ' }, session([])).model, 'fast');
});

test('buildPrompt sends only user/assistant text and needs an assistant reply for next mode', () => {
  const messages = [{ role: 'user', content: 'hi' }, { role: 'tool', content: 'secret tool output' },
    { role: 'assistant', content: [{ type: 'text', text: 'hello' }, { type: 'tool-call', text: 'x' }] }];
  const prompt = JSON.parse(buildPrompt(session(messages), DEFAULT_CONFIG, { mode: 'next', draft: '' }));
  assert.ok(prompt.conversation.includes('hello') && !prompt.conversation.includes('secret'));
  assert.equal(buildPrompt(session([{ role: 'user', content: 'hi' }]), DEFAULT_CONFIG, { mode: 'next', draft: '' }), null);
  assert.ok(buildPrompt(session([{ role: 'user', content: 'hi' }]), DEFAULT_CONFIG, { mode: 'continue', draft: 'ab' }));
});

test('suggestionsFrom strips list markers, NONE and duplicates', () => {
  assert.deepEqual(suggestionsFrom('1. a\n- b\nNONE\n```\na\nc', 2), ['a', 'b']);
});

test('predict streams deltas and returns suggestions', async () => {
  const deltas = [];
  const llm = { prepareCall: async () => ({ config: {}, stream: async function* () {
    yield { type: 'text-delta', text: 'one\n' }; yield { type: 'text-delta', text: 'two' }; yield { type: 'finish', reason: 'stop' };
  } }) };
  const result = await predict(llm, session([{ role: 'assistant', content: 'ok' }]), DEFAULT_CONFIG, { mode: 'next', draft: '' }, new AbortController().signal, d => deltas.push(d));
  assert.deepEqual(result.suggestions, ['one', 'two']);
  assert.deepEqual(deltas, ['one\n', 'two']);
});

test('predict fails on errored generation and times out an iterator that ignores abort', async () => {
  const bad = { prepareCall: async () => ({ config: {}, stream: async function* () { yield { type: 'finish', reason: 'error' }; } }) };
  await assert.rejects(predict(bad, session([{ role: 'assistant', content: 'ok' }]), DEFAULT_CONFIG, { mode: 'next', draft: '' }, new AbortController().signal, () => {}),
    error => error.code === 'generation-failed');
  const stuck = { prepareCall: async () => ({ config: {}, stream: () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }) }) };
  await assert.rejects(predict(stuck, session([{ role: 'assistant', content: 'ok' }]), { ...DEFAULT_CONFIG, timeoutMs: 1000 }, { mode: 'next', draft: '' }, new AbortController().signal, () => {}),
    error => error.code === 'prediction-aborted');
  assert.deepEqual((await predict(bad, session([]), DEFAULT_CONFIG, { mode: 'next', draft: '' }, new AbortController().signal, () => {})).suggestions, []);
});

test('createConfig declares every field volatile with the documented defaults', () => {
  const calls = [];
  const node = () => { const n = {}; for (const m of ['default', 'description', 'volatile', 'min', 'max']) n[m] = (...a) => { calls.push([m, ...a]); return n; }; return n; };
  const z = { object: shape => shape, boolean: node, string: node, natural: node, union: node };
  const shape = createConfig(z);
  assert.deepEqual(Object.keys(shape).sort(), Object.keys(DEFAULT_CONFIG).sort());
  assert.equal(calls.filter(([m]) => m === 'volatile').length, Object.keys(DEFAULT_CONFIG).length);
});
