import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { apply, inject } from '../../packages/cpa-tools/index.js';
import { applyAccess } from '../../access.js';
import { seed } from '../../config.js';
import { assertToolSchema } from '../../tool-schema.js';
import { buildShared } from '../../packages/cpa-tools/scripts/build-shared.mjs';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'cpa-plugin-'));
  const old = process.env.CAPABILITY_TEAM_HOME; process.env.CAPABILITY_TEAM_HOME = root;
  t.after(async () => { if (old === undefined) delete process.env.CAPABILITY_TEAM_HOME; else process.env.CAPABILITY_TEAM_HOME = old; await rm(root, { recursive: true, force: true }); });
  const defs = new Map(), disposers = []; let consent = false, asked = 0;
  const ctx = { tools: { register: def => { assert.ok(!defs.has(def.name)); defs.set(def.name, def); return () => defs.delete(def.name); } }, effect: fn => disposers.push(fn()),
    workingDirectory: { ensure: async () => root }, userQuestions: { ask: async () => { asked++; return { answers: [{ id: 'upload', selected: consent ? ['允许上传'] : ['拒绝'] }] }; } },
    inject: (deps, fn) => { if (deps.includes('credentials')) fn({ credentials: { resolve: async () => ({ value: 'credential-test-key' }) }, effect: fn => disposers.push(fn()) }); },
  };
  return { root, ctx, defs, dispose: () => disposers.reverse().forEach(fn => fn?.()), allow: () => { consent = true; }, asked: () => asked };
}
test('profile bundle registers five valid tools independent of team/preset and cleans up', async t => {
  const f = await fixture(t); apply(f.ctx);
  assert.deepEqual(inject, ['tools','workingDirectory','userQuestions']);
  assert.deepEqual([...f.defs.keys()], ['cpa_search','cpa_web_fetch','cpa_search_providers','cpa_transcribe','cpa_transcribe_status']);
  for (const def of f.defs.values()) assert.doesNotThrow(() => assertToolSchema(def.parameters));
  assert.throws(() => apply(f.ctx), /already installed/);
  await assert.rejects(f.defs.get('cpa_search').execute({ query: 'probe' }, { agent: {}, signal: undefined }), /网关地址|密钥/);
  f.dispose(); assert.equal(f.defs.size, 0);
  const off = await fixture(t); apply(off.ctx, { enabled: false }); assert.equal(off.defs.size, 0); off.dispose();
  assert.throws(() => apply({}, { integrations: {} }), /Invalid/);
});
test('credential service is resolved, search/fetch execute in any session; transcription denied until exact-file consent', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'integrations.json'), JSON.stringify({ integrations: { search: { baseUrl: 'https://gateway.example.com', providersPath: '/providers' }, audio: { baseUrl: 'https://gateway.example.com', statusPath: '/health' } } }));
  await writeFile(join(f.root, 'clip.wav'), Buffer.from('test-audio'));
  const oldFetch = globalThis.fetch; let uploads = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer credential-test-key');
    if (init.body instanceof FormData) { uploads++; assert.equal(await init.body.get('file').text(), 'test-audio'); return Response.json({ text: 'transcript' }); }
    if (url.endsWith('/v1/search')) return Response.json({ results: [{ title: 'reference' }] });
    if (url.endsWith('/v1/web/fetch')) return Response.json({ content: 'reference page' });
    return Response.json({ data: ['available'] });
  };
  t.after(() => { globalThis.fetch = oldFetch; });
  apply(f.ctx); const exec = { agent: { id: 'ordinary' } };
  assert.match(await f.defs.get('cpa_search').execute({ query: 'probe' }, exec), /reference/);
  assert.match(await f.defs.get('cpa_web_fetch').execute({ url: 'https://public.example.com' }, exec), /reference page/);
  assert.match(await f.defs.get('cpa_search_providers').execute({}, exec), /available/);
  await assert.rejects(f.defs.get('cpa_transcribe').execute({ file_path: 'clip.wav' }, exec), /未授权/);
  assert.equal(uploads, 0); f.allow();
  assert.match(await f.defs.get('cpa_transcribe').execute({ file_path: 'clip.wav' }, exec), /transcript/);
  assert.equal(uploads, 1); assert.equal(f.asked(), 2); f.dispose();
});
test('team search switch denies external tools; ordinary and other presets unaffected', () => {
  let guard, search = false;
  const agent = { ctx: {}, session: {} };
  const effective = structuredClone(seed);
  const roleName = Object.keys(effective.roles).find(name => effective.roles[name].capability !== 'orchestrator');
  const capability = effective.roles[roleName].capability;
  const ctx = { agentPresets: { composedPreset: () => 'capability-team' }, agentTeams: { tryMembership: () => ({ role: 'teammate', name: roleName }) },
    effect: fn => fn(), tools: { guard: fn => { guard = fn; } }, workingDirectory: { get: () => '/example/project' } };
  const team = { pinned: () => '/example/project', loadSync: () => { effective.capabilities[capability].search = search; return { effective }; } };
  applyAccess(ctx, team);
  for (const name of ['cpa_search','cpa_web_fetch','cpa_search_providers','cpa_transcribe','cpa_transcribe_status']) assert.match(guard({ agent, name }), /search=true/);
  search = true; assert.equal(guard({ agent, name: 'cpa_search' }), undefined);
  ctx.agentPresets.composedPreset = () => 'ordinary'; search = false; assert.equal(guard({ agent, name: 'cpa_web_fetch' }), undefined);
});
test('read-only config/API, team non-registration, roles missing-tool warning and shared hash', async () => {
  await buildShared(true);
  const config = await import('../../packages/cpa-tools/shared/integrations-config.js');
  for (const key of ['saveIntegrations','handleIntegrations','applyIntegrationsApi','setPluginIntegrations']) assert.equal(config[key], undefined);
  const roles = await readFile(new URL('../../roles.js', import.meta.url), 'utf8'); assert.match(roles, /工具未安装、未启用、当前会话不可用/);
  const team = await readFile(new URL('../../integrations.js', import.meta.url), 'utf8'); assert.doesNotMatch(team, /cpa_search|applyTranscribe/);
});
