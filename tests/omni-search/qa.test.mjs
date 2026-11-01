import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { temporaryArchive } from '../../scripts/pack-package.mjs';
import { apply } from '../../packages/omni-search/index.js';
import { applyAccess } from '../../access.js';
import { seed } from '../../config.js';
import { readAudio } from '../../packages/omni-search/shared/transcribe.js';
const names = ['omni_search','omni_fetch','omni_search_providers','omni_transcribe','omni_transcribe_status'];
for (const preset of [undefined, 'standard', 'subagent', 'capability-team']) {
  test(`QA profile registration ignores preset ${preset ?? 'plain'}`, async t => {
    // Isolated from the user's real integrations.json; zero config has no custom-engine providers tool.
    const home = process.env.CAPABILITY_TEAM_HOME; process.env.CAPABILITY_TEAM_HOME = await mkdtemp(join(tmpdir(), 'qa-omni-home-'));
    t.after(() => { if (home === undefined) delete process.env.CAPABILITY_TEAM_HOME; else process.env.CAPABILITY_TEAM_HOME = home; });
    const defs = new Map(), effects = [];
    const ctx = { agentPresets: { composedPreset: () => preset }, effect: fn => effects.push(fn()), tools: { register: def => { assert.ok(!defs.has(def.name)); defs.set(def.name, def); return () => defs.delete(def.name); } } };
    apply(ctx); assert.deepEqual([...defs.keys()], names.filter(n => n !== 'omni_search_providers'));
    effects.reverse().forEach(fn => fn?.()); assert.equal(defs.size, 0);
  });
}
test('QA every external tool observes search switch only for owned teammates', () => {
  let guard, preset = 'capability-team', enabled = false;
  const effective = structuredClone(seed), member = Object.keys(effective.roles).find(k => effective.roles[k].capability !== 'orchestrator');
  const capability = effective.roles[member].capability;
  const agent = { ctx: {}, session: {} };
  const ctx = { agentPresets: { composedPreset: () => preset }, agentTeams: { tryMembership: () => ({ role: 'teammate', name: member }) }, effect: fn => fn(), tools: { guard: fn => { guard = fn; } }, workingDirectory: { get: () => 'example' } };
  const team = { pinned: () => 'example', loadSync: () => { effective.capabilities[capability].search = enabled; return { effective }; } };
  applyAccess(ctx, team);
  for (const name of names) assert.match(guard({ agent, name }), /search=true/);
  enabled = true;
  for (const name of names) assert.equal(guard({ agent, name }), undefined);
  preset = undefined; enabled = false;
  for (const name of names) assert.equal(guard({ agent, name }), undefined);
});
test('QA denial does not reach audio byte read', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qa-omni-'));
  const path = join(dir, 'clip.wav'); await writeFile(path, 'safe mock audio');
  let asked = 0;
  await assert.rejects(readAudio(path, 100, async () => { asked++; throw Error('denied'); }), /denied/);
  assert.equal(asked, 1);
  const source = await readFile('packages/omni-search/shared/transcribe.js', 'utf8');
  assert.ok(source.indexOf('await approve(stat.size)') < source.indexOf('await handle.readFile()'));
});
test('QA team source and built UI retain result cards but no integration settings', async () => {
  const integration = await readFile('integrations.js', 'utf8');
  assert.doesNotMatch(integration, /omni_search|applyTranscribe/);
  assert.doesNotMatch(await readFile('ui.js', 'utf8'), /applyIntegrationsApi|capability-team\.integrations/);
  const client = await readFile('client.js', 'utf8');
  assert.doesNotMatch(client, /IntegrationsPanel|int\.noSession|tab\.integrations|['"]int\./);
  for (const name of ['omni_search', 'omni_fetch']) assert.ok(client.includes(name), name);
});
test('QA both delivery archives contain current JS sources, not stale copied modules', async t => {
  for (const pkg of ['global-memory', 'omni-search']) {
    const base = `packages/${pkg}/`, archive = await temporaryArchive(t, base);
    let count = 0;
    for (let p = 0; p + 512 <= archive.length;) {
      const h = archive.subarray(p, p + 512); if (h.every(b => b === 0)) break;
      const name = h.subarray(0, 100).toString().replace(/\0.*$/, '');
      const size = parseInt(h.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8) || 0; p += 512;
      if (name.endsWith('.js')) { assert.deepEqual(archive.subarray(p, p + size), await readFile(base + name.replace(/^package\//, '')), name); count++; }
      p += Math.ceil(size / 512) * 512;
    }
    assert.ok(count > 10);
  }
});
