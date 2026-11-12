import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createRuntime } from '../packages/global-memory/runtime.js';
import { configuration } from '../packages/global-memory/config.js';

// DSH announces agents with ctx.serial('agent/created'): the first listener returning anything other than
// null, undefined or false stops the chain, so later listeners (the native Team tool installer among them)
// never run and Team members lose spawn_teammate, send_message, wait_agent and team_task_*.
const root = join(import.meta.dirname, '..');
const skip = new Set(['node_modules', 'tests', 'client', 'shared', 'shared-ui', '.git', '.work']);
async function sources(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await sources(path));
    else if (/\.m?js$/.test(entry.name) && entry.name !== 'client.js') out.push(path);
  }
  return out;
}
/** Mirrors cordis Context#serial: stop at the first bailed (non-nullish, non-false) result. */
async function serial(listeners, payload) {
  for (const listener of listeners) {
    const result = await listener(payload);
    if (result !== null && result !== false && result !== undefined) return result;
  }
}

test('every agent/created listener uses a block body so it cannot bail the serial chain', async () => {
  const offenders = [];
  const seen = new Set();
  const expected = ['memory-hub.js', 'native-compat.js', 'packages/global-memory/runtime.js', 'roles.js', 'teammate-context.js', 'theme-plugin.js'];
  for (const file of await sources(root)) {
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/on\(\s*['"]agent\/created['"]\s*,\s*(?:async\s*)?(\([^)]*\)|\w+)\s*=>\s*(\S)/g)) {
      seen.add(relative(root, file).split('\\').join('/'));
      if (match[2] !== '{') offenders.push(`${relative(root, file)}: ${match[0]}`);
    }
  }
  assert.deepEqual([...seen].sort(), expected, 'Known creation-hook sources remain covered after native-start migration');
  assert.deepEqual(offenders, []);
});

test('global-memory agent/created listener lets later listeners run', async () => {
  const listeners = new Map();
  const agent = { id: 'a', ctx: { preset: 'standard', tools: { register: () => () => {} }, systemPrompt: { context: () => () => {} } } };
  const ctx = { agents: { list: () => [] }, agentPresets: { composedPreset: c => c.preset }, workingDirectory: { ensure: async () => '/example' },
    on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name); }, effect() {} };
  const runtime = createRuntime(ctx, configuration(), { clean: async s => s, search: async () => ({ results: [] }) }, { format: () => '' });
  let nativeInstalled = false;
  const result = await serial([listeners.get('agent/created'), () => { nativeInstalled = true; }], { agent });
  assert.equal(result, undefined);
  assert.equal(nativeInstalled, true);
  assert.ok(runtime.states.has('a'), 'memory still installs for an eligible agent');
  runtime.cleanup();
});
