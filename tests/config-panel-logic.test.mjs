// Pure panel logic (no DOM): secret state derivation, lock behavior, write ops, credential calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DESCRIBE_BATCH, buildOps, chunk, clearSecret, describeSecrets, isShown, lockMode, manifestFromWire, secretRefs, secretState, summaryCounts, unwrapReply, validateValue, writeSecret } from '../shared-ui/config-logic.js';
import { PANELS } from '../shared-ui/fields.js';

const manifest = (...entries) => manifestFromWire({ revision: 1, entries: entries.map(([ref, locked]) => ({ ref, locked, secret: false })) });
const field = (panel, id) => PANELS[panel].fields.find(f => f.id === id);

test('secret state: only a state is derived, never a value', () => {
  assert.deepEqual(secretState({ configured: false, writable: true }), { kind: 'unset', configured: false, editable: true, clearable: false });
  assert.deepEqual(secretState({ configured: true, source: 'file', writable: true }), { kind: 'stored', configured: true, editable: true, clearable: true });
  assert.deepEqual(secretState({ configured: true, source: 'env', writable: true }), { kind: 'env', configured: true, editable: true, clearable: false });
  assert.deepEqual(secretState({ configured: true, source: 'file', writable: false }), { kind: 'stored', configured: true, editable: false, clearable: false });
  assert.equal(secretState(undefined).kind, 'unset');
  for (const info of [{ configured: true, source: 'file', writable: true, value: 'sk-leak' }]) assert.ok(!JSON.stringify(secretState(info)).includes('sk-leak'));
});

test('locked managed secret reads as managed and offers no edit or clear; unlocked stays editable', () => {
  assert.deepEqual(secretState({ configured: false, writable: true }, 'locked'), { kind: 'managed', configured: false, editable: false, clearable: false });
  assert.deepEqual(secretState({ configured: true, source: 'file', writable: true }, 'locked'), { kind: 'managed', configured: true, editable: false, clearable: false });
  assert.equal(secretState({ configured: true, source: 'file', writable: true }, 'default').editable, true);
  const m = manifest(['TAVILY_API_KEY', true], ['BRAVE_API_KEY', false]);
  assert.deepEqual(['TAVILY_API_KEY', 'BRAVE_API_KEY', 'JINA_API_KEY', undefined].map(ref => lockMode(m, ref)), ['locked', 'default', 'none', 'none']);
  assert.equal(lockMode(null, 'TAVILY_API_KEY'), 'none');
});

test('manifest from the wire: bad payloads are null, entries keep only lock and secret flags', () => {
  assert.equal(manifestFromWire(null), null);
  assert.equal(manifestFromWire({ entries: 'x' }), null);
  const m = manifestFromWire({ revision: 3, entries: [{ ref: 'A_B_C', locked: true, secret: true, value: 'sk-leak' }, null, { nope: 1 }] });
  assert.deepEqual([...m.entries], [['A_B_C', { locked: true, secret: true }]]);
});

test('credentials.describe is called in batches of at most 64 refs and a failed batch stays unknown', async () => {
  const refs = Array.from({ length: 150 }, (_, i) => `REF_${i}`);
  assert.deepEqual(chunk(refs).map(b => b.length), [64, 64, 22]);
  assert.equal(DESCRIBE_BATCH, 64);
  const calls = [];
  const credentials = { describe: async batch => {
    calls.push(batch.length);
    if (calls.length === 2) throw new Error('down');
    return { ok: true, value: Object.fromEntries(batch.map(ref => [ref, { configured: true, source: 'file', writable: true, value: 'sk-leak' }])) };
  } };
  const out = await describeSecrets(credentials, refs);
  assert.deepEqual(calls, [64, 64, 22]);
  assert.equal(Object.keys(out).length, 86, 'the failed batch is simply absent');
  assert.ok(!JSON.stringify(out).includes('sk-leak'), 'only the three safe fields survive');
  assert.deepEqual(await describeSecrets(undefined, refs), {});
  assert.deepEqual(await describeSecrets({ describe: async () => ({ ok: false, error: { code: 'x' } }) }, ['A_B_C']), {});
});

test('setting and clearing go through credentials; locked, empty and missing APIs are refused', async () => {
  const calls = [];
  const credentials = { set: async (ref, value) => { calls.push(['set', ref, value]); return { ok: true }; }, unset: async ref => { calls.push(['unset', ref]); } };
  assert.equal(await writeSecret(credentials, 'TAVILY_API_KEY', 'abc'), true);
  assert.equal(await clearSecret(credentials, 'TAVILY_API_KEY'), true);
  assert.deepEqual(calls, [['set', 'TAVILY_API_KEY', 'abc'], ['unset', 'TAVILY_API_KEY']]);
  await assert.rejects(writeSecret(credentials, 'TAVILY_API_KEY', 'abc', 'locked'), /locked/);
  await assert.rejects(clearSecret(credentials, 'TAVILY_API_KEY', 'locked'), /locked/);
  await assert.rejects(writeSecret(credentials, 'TAVILY_API_KEY', '   '), /empty/);
  await assert.rejects(writeSecret({}, 'TAVILY_API_KEY', 'abc'), /unavailable/);
  await assert.rejects(writeSecret({ set: async () => ({ ok: false, error: { code: 'credential/rejected' } }) }, 'TAVILY_API_KEY', 'abc'), /credential\/rejected/);
  assert.equal(calls.length, 2, 'refused attempts never reach the host');
});

test('unwrapReply handles wrapped and bare replies', () => {
  assert.equal(unwrapReply({ ok: true, value: 5 }), 5);
  assert.equal(unwrapReply(7), 7);
  assert.throws(() => unwrapReply({ ok: false, error: { code: 'nope' } }), /nope/);
});

test('buildOps: set, unset on empty, no-op when unchanged, number and enum validation, multi lists', () => {
  const fields = PANELS.search.fields;
  const values = { engines: ['tavily'], baseUrl: 'https://old.example.com' };
  let r = buildOps(fields, values, { engines: 'brave, searxng', baseUrl: '', searxngUrl: 'https://s.example.com' }, null);
  assert.deepEqual(r.ops, [{ op: 'set', path: ['engines'], value: ['brave', 'searxng'] }, { op: 'unset', path: ['baseUrl'] }, { op: 'set', path: ['searxngUrl'], value: 'https://s.example.com' }]);
  r = buildOps(fields, values, { engines: ['tavily'], baseUrl: 'https://old.example.com' }, null);
  assert.deepEqual(r, { ops: [], invalid: {} });
  r = buildOps(fields, values, { baseUrl: 'ftp://x', engines: ['nope'] }, null);
  assert.deepEqual(r, { ops: [], invalid: { baseUrl: 'url', engines: 'enum' } });
  const ac = PANELS.autocomplete.fields;
  r = buildOps(ac, { maxSuggestions: 3 }, { maxSuggestions: '9', typePauseMs: '700', mobileBar: false, routeMode: 'fixed' }, null);
  assert.deepEqual(r.invalid, { maxSuggestions: 'number' });
  assert.deepEqual(r.ops, [{ op: 'set', path: ['routeMode'], value: 'fixed' }, { op: 'set', path: ['typePauseMs'], value: 700 }, { op: 'set', path: ['mobileBar'], value: false }]);
  assert.deepEqual(buildOps(ac, { maxSuggestions: 3 }, { maxSuggestions: '' }, null).ops, [{ op: 'unset', path: ['maxSuggestions'] }]);
});

test('buildOps never writes a locked managed field and never touches secrets', () => {
  const m = manifest(['SEARXNG_URL', true], ['OMNI_SEARCH_BASE_URL', false]);
  const r = buildOps(PANELS.search.fields, {}, { searxngUrl: 'https://mine.example.com', baseUrl: 'https://base.example.com', TAVILY_API_KEY: 'sk-leak' }, m);
  assert.deepEqual(r.ops, [{ op: 'set', path: ['baseUrl'], value: 'https://base.example.com' }], 'unlocked managed stays editable');
  assert.ok(!JSON.stringify(r).includes('sk-leak'));
});

test('autocomplete provider and model only show for the fixed route', () => {
  const provider = field('autocomplete', 'provider');
  assert.equal(isShown(provider, { routeMode: 'session' }), false);
  assert.equal(isShown(provider, { routeMode: 'fixed' }), true);
  assert.equal(isShown(field('autocomplete', 'routeMode'), {}), true);
});

test('validation helpers', () => {
  const n = { kind: 'number', min: 1, max: 5 };
  assert.deepEqual([validateValue(n, '3'), validateValue(n, '0'), validateValue(n, '2.5'), validateValue(n, 'x')], [null, 'number', 'number', 'number']);
  assert.deepEqual([validateValue({ kind: 'url' }, ''), validateValue({ kind: 'url' }, 'https://a.example.com'), validateValue({ kind: 'url' }, 'a.example.com')], [null, null, 'url']);
  assert.equal(validateValue({ kind: 'enum', options: ['a'] }, 'b'), 'enum');
});

test('summary counts: configured of total with managed locked counting as configured; enabled is not a panel field', () => {
  const m = manifest(['EMBEDDING_API_KEY', true], ['EMBEDDING_BASE_URL', false]);
  const states = { OPENVIKING_API_KEY: { configured: true }, EMBEDDING_API_KEY: { configured: false } };
  const c = summaryCounts(PANELS.memory.fields, { memoryUrl: 'https://m.example.com' }, states, m);
  assert.deepEqual(c, { configured: 3, total: 6, managed: 2 });
  assert.deepEqual(summaryCounts(PANELS.memory.fields, {}, {}, null), { configured: 0, total: 6, managed: 0 });
  for (const panel of Object.values(PANELS)) assert.ok(!panel.fields.some(f => f.id === 'enabled'), `${panel.extension}: on/off is DSH's own plugin switch`);
});

test('panel secret refs are exactly the catalog secrets of that extension', async () => {
  const { catalogOf } = await import('../shared-ui/catalog.js');
  for (const key of ['search', 'memory']) {
    assert.deepEqual(secretRefs(PANELS[key].fields).sort(), catalogOf(key).filter(e => e.secret).map(e => e.ref).sort(), key);
  }
});
