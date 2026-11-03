import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertVolatile, liveValue, splitSettings } from '../settings-schema.js';
import { resolveIntegrations, setSettingsReader } from '../integrations-config.js';
import * as omni from '../packages/omni-search/index.js';
import * as memory from '../packages/global-memory/index.js';
import { resolveIntegrations as memoryIntegrations } from '../packages/global-memory/shared/integrations-config.js';

// The real schemastery ships inside DSH; plain CI has no node_modules, so those cases run only next to an install.
const globalRoot = () => { const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' }); return r.status === 0 ? join(r.stdout.trim(), '@deepseek-ai', 'dsh') : undefined; };
const dshSchemastery = [process.env.DSH_PACKAGE_DIR ?? globalRoot()].filter(Boolean)
  .map(dir => join(dir, 'node_modules/@deepseek-ai/schemastery/lib/index.mjs')).find(existsSync);
const z = dshSchemastery ? (await import(pathToFileURL(dshSchemastery).href)).default : null;
const live = value => ({ get: () => value });

test('stale schemastery without .volatile() fails with an actionable load error', () => {
  const stale = { string: () => ({ default: () => ({}) }) };
  assert.throws(() => assertVolatile(stale, 'dsh-omni-search'), /no \.volatile\(\).*node_modules\/dsh-omni-search\/node_modules\/@deepseek-ai\/schemastery.*restart DSH/);
});

test('settings layer: only set fields are read; empty strings and lists count as unset', () => {
  assert.equal(liveValue(live('')), undefined);
  assert.equal(liveValue(live([])), undefined);
  assert.deepEqual(liveValue(live(['tavily'])), ['tavily']);
  const { plain, read } = splitSettings({ enabled: false, searxngUrl: live(' https://searx.example.com '), tavilyKeyEnv: live('') }, omni.SETTINGS_FIELDS);
  assert.deepEqual(plain, { enabled: false });
  assert.deepEqual(read(), { search: { searxngUrl: 'https://searx.example.com' } });
});

test('precedence: settings form > credentials/env > integrations.json > defaults; invalid form values are ignored', async () => {
  const root = await mkdtemp(join(tmpdir(), 'settings-prec-'));
  const saved = { home: process.env.CAPABILITY_TEAM_HOME, url: process.env.SEARXNG_URL };
  try {
    process.env.CAPABILITY_TEAM_HOME = root;
    await writeFile(join(root, 'integrations.json'), JSON.stringify({ integrations: { search: { searxngUrl: 'https://file.example.com', braveKeyEnv: 'FILE_BRAVE' } } }));
    let r = resolveIntegrations();
    assert.deepEqual([r.effective.search.searxngUrl, r.sources.search.searxngUrl], ['https://file.example.com', 'file']);
    process.env.SEARXNG_URL = 'https://env.example.com';
    r = resolveIntegrations();
    assert.deepEqual([r.effective.search.searxngUrl, r.sources.search.searxngUrl], ['https://env.example.com', 'env:SEARXNG_URL']);
    let form = { search: { searxngUrl: 'https://form.example.com' } };
    setSettingsReader(() => form);
    r = resolveIntegrations();
    assert.deepEqual([r.effective.search.searxngUrl, r.sources.search.searxngUrl], ['https://form.example.com', 'settings']);
    assert.equal(r.effective.search.braveKeyEnv, 'FILE_BRAVE'); // unset form field keeps the file value
    form = { search: { searxngUrl: 'ftp://bad' } };
    assert.equal(resolveIntegrations().effective.search.searxngUrl, 'https://env.example.com');
    // A test-supplied env never reads the profile-wide form.
    form = { search: { searxngUrl: 'https://form.example.com' } };
    assert.equal(resolveIntegrations({ root, env: {} }).effective.search.searxngUrl, 'https://file.example.com');
  } finally {
    setSettingsReader(null);
    for (const [key, name] of [['home', 'CAPABILITY_TEAM_HOME'], ['url', 'SEARXNG_URL']]) { if (saved[key] === undefined) delete process.env[name]; else process.env[name] = saved[key]; }
    await rm(root, { recursive: true, force: true });
  }
});

test('without schemastery the bundles export no Config and keep plain validation', () => {
  if (z) return; // resolved through the DSH installation: Config is exported and covered below
  assert.equal(omni.Config, undefined);
  assert.equal(memory.Config, undefined);
});

test('Config schemas: Standard Schema, volatile fields, credential-ref key names, defaults', { skip: !z && 'DSH schemastery not installed' }, () => {
  const O = omni.createConfig(z); const M = memory.createConfig(z);
  for (const C of [O, M]) assert.equal(typeof C['~standard'].validate, 'function');
  const o = O['~standard'].validate({}).value;
  assert.equal(o.enabled, true);
  for (const key of Object.keys(omni.SETTINGS_FIELDS)) assert.equal(typeof o[key].get, 'function', key);
  assert.ok(O['~standard'].validate({ engines: ['nope'] }).issues);
  const m = M['~standard'].validate({ autoRecall: false }).value;
  assert.deepEqual([m.enabled, m.autoRecall, m.injectChars, m.recallK, m.recallTimeoutMs, m.syncWrites], [true, false, 2400, 6, 2000, true]);
  for (const key of Object.keys(memory.SETTINGS_FIELDS)) assert.equal(typeof m[key].get, 'function', key);
  assert.ok(M['~standard'].validate({ memoryBackend: 'other' }).issues);
  const json = JSON.stringify(O.toJSON());
  assert.match(json, /"role":"credential-ref"/);
  assert.doesNotMatch(json, /"role":"secret"/); // key VALUES are never form fields
});

test('validated Config reaches apply(): plain options validate, volatile refs feed the settings layer', { skip: !z && 'DSH schemastery not installed' }, () => {
  const value = memory.createConfig(z)['~standard'].validate({ enabled: false, memoryBackend: 'openviking' }).value;
  const disposers = [];
  memory.apply({ effect: fn => disposers.push(fn()) }, value);
  try { assert.equal(memoryIntegrations().effective.memory.backend, 'openviking'); } // the bundle reads its own shared copy
  finally { for (const d of disposers) d?.(); }
  assert.equal(memoryIntegrations().effective.memory.backend, process.env.MEMORY_BACKEND || 'local');
});
