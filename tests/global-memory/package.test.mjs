import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { temporaryArchive } from '../../scripts/pack-package.mjs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createMemoryStore } from '../../packages/global-memory/shared/memory-store.js';
import { buildShared } from '../../packages/global-memory/scripts/build-shared.mjs';
const root = resolve('packages/global-memory');
test('8 cross-process writers preserve shared store and cache invalidates', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'gm-process-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const moduleUrl = pathToFileURL(resolve(root, 'shared/memory-store.js')).href;
  const store = createMemoryStore(temp);
  await store.search({ project: 'project', query: 'process lesson' });
  const run = n => new Promise((done, reject) => {
    const code = `import { createMemoryStore } from ${JSON.stringify(moduleUrl)}; await createMemoryStore(${JSON.stringify(temp)}).write({kind:'note',text:'process lesson ${n}',scope:{kind:'project',project:'project'}});`;
    const child = spawn(process.execPath, ['--input-type=module','-e',code], { stdio: 'inherit' });
    child.on('error', reject); child.on('exit', code => code === 0 ? done() : reject(Error('child failure')));
  });
  await Promise.all([run(1), run(2)]);
  assert.equal((await store.search({ project: 'project', query: 'process lesson' })).length, 2);
});
test('9 shared sources and recursive hash manifest remain verbatim', async () => {
  const manifest = await buildShared(true);
  assert.ok(Object.keys(manifest).includes('theme.js'));
  assert.ok(Object.keys(manifest).includes('config.js'));
  for (const [file, hash] of Object.entries(manifest)) {
    const source = await readFile(file);
    assert.equal(createHash('sha256').update(source).digest('hex'), hash);
    assert.deepEqual(await readFile(join(root, 'shared', file)), source);
  }
});
test('9 actual packed archive imports outside repository with no parent dependencies', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'gm-pack-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const archive = await temporaryArchive(t, root);
  const entries = [];
  for (let pos = 0; pos + 512 <= archive.length;) {
    const header = archive.subarray(pos, pos + 512); if (header.every(b => b === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8) || 0;
    assert.ok(!name.includes('..') && !name.startsWith('/'));
    pos += 512;
    if (header[156] === 0 || header[156] === 48) {
      const path = join(temp, name); await mkdir(dirname(path), { recursive: true });
      await writeFile(path, archive.subarray(pos, pos + size)); entries.push(name);
    }
    pos += Math.ceil(size / 512) * 512;
  }
  assert.ok(entries.includes('package/index.js')); assert.ok(!entries.some(n => n.includes('scripts/')));
  const plugin = await import(pathToFileURL(join(temp, 'package/index.js')));
  assert.equal(typeof plugin.apply, 'function');
  assert.deepEqual(plugin.inject, ['agents','systemPrompt','tools','workingDirectory','agentPresets']);
  const pkg = JSON.parse(await readFile(join(temp, 'package/package.json'), 'utf8'));
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.ok(entries.includes('package/client.js'));
  const effects = []; const ctx = { effect: fn => effects.push(fn()) };
  plugin.apply(ctx, { enabled: false }); assert.throws(() => plugin.apply(ctx, { enabled: false }), /already installed/);
  effects.forEach(fn => fn?.());
});
