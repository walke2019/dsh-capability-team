import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const patchText = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
test('bundle leaves global native Team mounts to the official profile', () => {
  assert.doesNotMatch(patchText, /^\s*- id: (?:agent-team|tool-agent-team|ui-agent-team)\s*$/m);
  assert.match(patchText, /id: capability-team\n/);
  assert.match(patchText, /name: 'dsh-capability-team\/roles'/);
});
import { available, nativeRuntime } from './helpers/native-team-runtime.mjs';

test('native Cordis composes Team support with and without the experimental bundle',
  { skip: !available && 'Set DSH_NATIVE_ASAR to a readable Desktop app archive' }, async () => {
    const runtime = await nativeRuntime();
    try {
      const official = runtime.official.find(row => row.insert).insert;
      for (const bundled of [false, true]) {
        const warnings = [], creates = [];
        const base = bundled ? official.map(row => ({ ...row, config: { ...row.config, hostSetting: true } })) : [];
        const rows = runtime.applyEntryPatches(base, runtime.patch, (...args) => warnings.push(args));
        // Run the real native EntryGroup.update (not a reimplementation or a regex
        // assertion). Its create seam records the rows handed to the plugin loader.
        const group = new runtime.EntryGroup({ fiber: {}, logger: { error: error => { throw error; } } }, {});
        group.create = async row => { creates.push(row); };
        await group.update(rows);
        for (const expected of official) {
          const mounted = creates.filter(row => row.id === expected.id);
          assert.equal(mounted.length, bundled ? 1 : 0, `${expected.id}, bundled=${bundled}`);
          if (bundled) assert.deepEqual(mounted[0], base.find(row => row.id === expected.id), 'preserve host configuration');
        }
        assert.equal(warnings.length, 0);
        assert.deepEqual(base, bundled ? official.map(row => ({ ...row, config: { ...row.config, hostSetting: true } })) : []);
      }
    } finally { runtime.close(); }
  });

test('native Team tool installer leaves existing and future standard agents untouched',
  { skip: !available && 'Set DSH_NATIVE_ASAR to a readable Desktop app archive' }, async () => {
    const runtime = await nativeRuntime();
    try {
      const standard = { id: 'standard' }, events = {};
      let lookups = 0, registrations = 0;
      runtime.toolApply({
        agents: { list: () => [standard] },
        agentTeams: { tryMembership: () => { lookups++; return undefined; } },
        tools: { register: () => { registrations++; } },
        on: (name, listener) => { events[name] = listener; },
        effect: setup => { setup()(); },
      });
      events['agent/created']({ agent: { id: 'standard-later' } });
      events['agent/disposed']({ agent: standard });
      assert.equal(lookups, 2);
      assert.equal(registrations, 0);
    } finally { runtime.close(); }
  });
