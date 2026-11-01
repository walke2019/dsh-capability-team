import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokenMetrics, estimateCost, usageSample } from '../token-metrics.js';
import { rewriteCatalog, CATALOG_MAX_CHARS } from '../teammate-context.js';
import { createMemoryStore } from '../memory-store.js';
import { TRIMMED_TOOLS } from '../token-discipline.js';
test('official usage sample, per-step replacement, explicit rates and savings', () => {
  const a = {}, m = createTokenMetrics({ ratesOf: () => ({ input: 2, cacheRead: .2, output: 4 }) });
  const u = { inputTokens: 100, cacheReadTokens: 900, outputTokens: 50 };
  assert.deepEqual(usageSample({ stateOf: (_s, key) => { assert.equal(key, 'tokenUsage'); return u; } }, {}), u);
  m.sample(a, 1, 1, u); m.sample(a, 1, 1, u); m.trim(a, 12000, 4700); m.compact(a, 125);
  const v = m.snapshot(a); assert.equal(v.steps.length, 1); assert.equal(v.steps[0].prompt, 1000);
  assert.equal(v.trimmedChars, 7300); assert.equal(v.compactions, 1); assert.equal(v.compactionMs, 125);
  assert.equal(estimateCost(u), null); assert.ok(v.steps[0].estimatedCost > 0);
  assert.ok(TRIMMED_TOOLS.has('web_fetch')); assert.ok(TRIMMED_TOOLS.has('cpa_web_fetch'));
});
test('catalog budget and overlong memory skip improve useful recall', () => {
  const entries = Array.from({ length: 1000 }, (_, i) => ({ name: `skill-${i}`, description: 'd'.repeat(150) }));
  const message = { source: { entries }, content: [] };
  const output = rewriteCatalog(message, 'compact').content[0].text;
  assert.ok(output.length <= CATALOG_MAX_CHARS); assert.ok(output.includes('skill-0'));
  const store = createMemoryStore('unused');
  const rows = ['x'.repeat(3000), 'useful short note'].map(text => ({ memory: { kind: 'note', scope: { kind: 'project' }, text } }));
  assert.match(store.format(rows, 100), /useful short note/);
  assert.ok(store.format(rows, 100).length <= 100);
  console.log(JSON.stringify({ catalogBefore: entries.map(e => e.name + e.description).join('\n').length, catalogAfter: output.length, memoryBefore: 0, memoryAfter: store.format(rows, 100).length }));
});
