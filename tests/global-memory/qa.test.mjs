import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime, CONTEXT } from '../../packages/global-memory/runtime.js';
import { configuration } from '../../packages/global-memory/config.js';
import { memoryService } from '../../packages/global-memory/tools.js';
import { apply } from '../../packages/global-memory/index.js';
import { readFile } from 'node:fs/promises';
import { temporaryArchive } from '../../scripts/pack-package.mjs';
test('QA archive JS bytes match current runtime and shared source snapshots', async t => {
  const archive = await temporaryArchive(t, 'packages/global-memory');
  let checked = 0;
  for (let p = 0; p + 512 <= archive.length;) {
    const h = archive.subarray(p, p + 512); if (h.every(b => b === 0)) break;
    const name = h.subarray(0, 100).toString().replace(/\0.*$/, '');
    const size = parseInt(h.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8) || 0;
    p += 512;
    if (name.endsWith('.js')) {
      assert.deepEqual(archive.subarray(p, p + size), await readFile('packages/global-memory/' + name.replace(/^package\//, '')), name);
      checked++;
    }
    p += Math.ceil(size / 512) * 512;
  }
  assert.ok(checked >= 20);
});
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ preset, teamPreset, search, timeout = 100 } = {}) {
  const tools = new Map(), contexts = new Map(), events = new Map();
  const a = { id: 'qa', ctx: { preset, tools: { register: d => { tools.set(d.name, d); return () => tools.delete(d.name); } }, systemPrompt: { context: d => { contexts.set(d.name, d); return () => contexts.delete(d.name); } } } };
  const ctx = { agents: { list: () => [a] }, agentPresets: { composedPreset: c => c.preset }, workingDirectory: { ensure: async () => undefined }, on: (n, fn) => { events.set(n, fn); return () => events.delete(n); }, effect() {} };
  if (teamPreset) ctx.agentTeams = { tryMembership: () => ({ root: { ctx: { preset: teamPreset } } }) };
  let calls = 0;
  const service = { clean: async x => x, search: async (...args) => { calls++; return search ? search(...args) : { results: [{ text: 'recall '.repeat(1000), scope: 'global', kind: 'note' }] }; } };
  const runtime = createRuntime(ctx, configuration({ recallTimeoutMs: timeout }), service, { format: rows => rows.map(r => r.memory.text).join('') });
  const claim = text => runtime.claimed({ agent: a, message: { source: { kind: 'user' }, text } });
  const assemble = async signal => { const value = { contexts: [{ name: CONTEXT, text: '' }], sections: ['unchanged'] }; return runtime.assemble(value, { agent: a, signal }, async () => value); };
  return { a, ctx, tools, contexts, runtime, claim, assemble, calls: () => calls };
}
for (const [label, options] of [['ordinary', {}], ['other preset', { preset: 'standard' }], ['ordinary subagent', { teamPreset: 'other-team' }]]) {
  test(`QA eligible ${label}: real scoped tools and bounded stable first-step recall`, async () => {
    const f = fixture(options);
    assert.deepEqual([...f.tools.keys()], ['memory_search', 'memory_write']);
    f.claim('same task');
    const first = await f.assemble();
    assert.equal(first.contexts[0].text.length, 2400);
    await f.claim('same   task');
    assert.deepEqual(await f.assemble(), first);
    assert.equal(f.calls(), 1);
    f.runtime.cleanup(); assert.equal(f.tools.size, 0); assert.equal(f.contexts.size, 0);
  });
}
for (const [label, options] of [['root', { preset: 'capability-team' }], ['member', { preset: 'ordinary', teamPreset: 'capability-team' }]]) {
  test(`QA capability ${label}: no tools context or recall`, async () => {
    const f = fixture(options); await f.claim('team task'); await f.assemble();
    assert.equal(f.tools.size, 0); assert.equal(f.contexts.size, 0); assert.equal(f.calls(), 0);
    f.runtime.cleanup();
  });
}
test('QA timeout and assembly abort fence late results', async () => {
  let finish;
  const f = fixture({ search: () => new Promise(r => { finish = r; }) });
  f.claim('slow task');
  assert.equal((await f.assemble()).contexts[0].text, '');
  finish({ results: [{ text: 'late', kind: 'note', scope: 'global' }] }); await tick();
  assert.equal((await f.assemble()).contexts[0].text, '');
  f.claim('aborted task'); await tick();
  const c = new AbortController(), assembling = f.assemble(c.signal); c.abort();
  assert.equal((await assembling).contexts[0].text, '');
  finish({ results: [{ text: 'late abort', kind: 'note', scope: 'global' }] }); await tick();
  assert.equal((await f.assemble()).contexts[0].text, ''); f.runtime.cleanup();
});
test('QA current filter skips shared calls; session skips all remote paths; none degrades safely', async () => {
  const count = { embed: 0, recall: 0, enqueue: 0, revoke: 0 }, written = [];
  const store = { search: async () => [], write: async m => { written.push(m); return { memory: { ...m, id: 'safe' }, superseded: [{ text: 'old' }] }; } };
  const embedder = { embed: async () => { count.embed++; throw Error('private-error'); } };
  const backend = { enabled: true, recall: async () => { count.recall++; throw Error('private-error'); }, enqueue: () => { count.enqueue++; return true; }, revoke: () => { count.revoke++; } };
  const s = memoryService({ store, embedder, backend, config: configuration(), secrets: () => ['qa-secret-value'] });
  const who = { project: 'example', session: 'qa', role: 'global-memory' };
  await s.write(who, { kind: 'note', scope: 'session', text: 'qa-secret-value private note' });
  await s.search(who, { query: 'session query', scope: 'session' });
  assert.deepEqual(count, { embed: 0, recall: 0, enqueue: 0, revoke: 0 });
  assert.doesNotMatch(written[0].text, /qa-secret-value/);
  const local = await s.search(who, { query: 'local query', shared_project_filter: 'current' });
  assert.equal(local.shared.degraded, 'project-filter-unavailable'); assert.equal(count.recall, 0);
  const shared = await s.search(who, { query: 'shared query', shared_project_filter: 'none' });
  assert.equal(shared.mode, 'text'); assert.equal(shared.shared.degraded, 'shared-unavailable'); assert.equal(count.recall, 1);
  assert.doesNotMatch(JSON.stringify(shared), /private-error/);
});
test('QA packed entry API can activate against ordinary host fixture without UI', () => {
  const f = fixture(); f.runtime.cleanup();
  const effects = []; f.ctx.effect = fn => effects.push(fn());
  const r = apply(f.ctx, { autoRecall: false });
  assert.ok(f.tools.has('memory_search')); assert.ok(f.tools.has('memory_write'));
  assert.equal(r.states.size, 1);
  effects.reverse().forEach(fn => fn?.()); assert.equal(f.tools.size, 0);
});
