import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../../packages/omni-search/index.js';

function wave() {
  const b = Buffer.alloc(32044); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(32000, 40); return b;
}

test('native providers map requests, cancel, and dispose without forcing selection', async t => {
  const root = await mkdtemp(join(tmpdir(), 'native-test-'));
  const saved = { ...process.env }, originalFetch = globalThis.fetch;
  process.env.CAPABILITY_TEAM_HOME = root;
  for (const name of ['TAVILY_API_KEY', 'BRAVE_API_KEY', 'SEARXNG_URL', 'OMNI_SEARCH_BASE_URL']) delete process.env[name];
  t.after(async () => { for (const name of ['CAPABILITY_TEAM_HOME', 'TAVILY_API_KEY', 'BRAVE_API_KEY', 'SEARXNG_URL', 'OMNI_SEARCH_BASE_URL', 'OMNI_AUDIO_BASE_URL', 'OMNI_AUDIO_API_KEY']) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); });
  const disposers = [], providers = {}, ctx = {
    tools: { register: () => () => {} }, effect: fn => disposers.push(fn()),
    web: { registerSearchProvider(p) { providers.search = p; return () => delete providers.search; } },
    speechToText: { register(p) { providers.speech = p; return async () => { delete providers.speech; }; } },
  };
  ctx.inject = ([name], fn) => { if (ctx[name]) fn(ctx); };
  apply(ctx);
  assert.equal(providers.search.available(), false);
  process.env.TAVILY_API_KEY = 'fixture-key';
  process.env.OMNI_AUDIO_BASE_URL = 'https://gateway.example.com'; process.env.OMNI_AUDIO_API_KEY = 'fixture-audio-key';
  assert.equal(providers.search.available(), true);
  globalThis.fetch = async (url, init) => {
    if (init.body instanceof FormData) { assert.equal(init.body.get('language'), 'en'); assert.equal(init.body.get('file').size, 32044); return Response.json({ text: 'hello' }); }
    assert.equal(JSON.parse(init.body).max_results, 2);
    return Response.json({ results: [{ title: 'Title', url: 'https://example.com', content: 'Excerpt', published_date: '2025-01-01' }] });
  };
  assert.deepEqual(await providers.search.search({ query: 'test', maxResults: 2 }), { sources: [{ url: 'https://example.com', title: 'Title', snippet: 'Excerpt', publishedAt: '2025-01-01T00:00:00.000Z' }], truncated: false });
  assert.equal(providers.speech.info.id, 'aiwuk-cloud-stt');
  const result = await providers.speech.transcribe({ audio: wave(), language: 'en' }, new AbortController().signal);
  assert.equal(result.text, 'hello'); assert.equal(result.audioSeconds, 1); assert.ok(result.inferenceSeconds >= 0);
  const signal = AbortSignal.abort();
  await assert.rejects(providers.search.search({ query: 'test' }, signal), { name: 'AbortError' });
  await assert.rejects(providers.speech.transcribe({ audio: wave(), language: 'en' }, signal), { name: 'AbortError' });
  for (const dispose of disposers.reverse()) await dispose?.();
  assert.deepEqual(providers, {});
});

test('registration failures are isolated and missing services are safe', () => {
  const disposers = [], warnings = [];
  const ctx = { tools: { register: () => () => {} }, effect: fn => disposers.push(fn()), logger: { warn: message => warnings.push(message) },
    web: { registerSearchProvider() { throw new Error('duplicate'); } }, speechToText: { register() { return () => {}; } } };
  ctx.inject = ([name], fn) => { if (ctx[name]) fn(ctx); };
  assert.doesNotThrow(() => apply(ctx)); assert.equal(warnings.length, 1); disposers.reverse().forEach(fn => fn?.());
  const bare = { tools: ctx.tools, effect: fn => disposers.push(fn()) };
  assert.doesNotThrow(() => apply(bare)); disposers.reverse().forEach(fn => fn?.());
});
