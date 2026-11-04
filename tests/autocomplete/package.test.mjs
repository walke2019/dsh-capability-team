import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { temporaryArchive } from '../../scripts/pack-package.mjs';

test('actual autocomplete archive is self-contained and declares bundle and client halves', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'ac-pack-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const archive = await temporaryArchive(t, 'packages/autocomplete');
  const names = [];
  for (let pos = 0; pos + 512 <= archive.length;) {
    const header = archive.subarray(pos, pos + 512); if (header.every(b => b === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8) || 0;
    assert.ok(!name.includes('..') && !name.startsWith('/')); pos += 512;
    if (header[156] === 0 || header[156] === 48) {
      names.push(name);
      const target = join(temp, name); await mkdir(dirname(target), { recursive: true }); await writeFile(target, archive.subarray(pos, pos + size));
    }
    pos += Math.ceil(size / 512) * 512;
  }
  // Sources and build scripts stay in the repository; only the generated client and host modules ship.
  assert.ok(!names.some(name => name.includes('/client/') || name.includes('/scripts/')), names.join(','));
  const plugin = await import(pathToFileURL(join(temp, 'package/index.js')));
  assert.equal(typeof plugin.apply, 'function');
  const pkg = JSON.parse(await readFile(join(temp, 'package/package.json'), 'utf8'));
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.dsh.client.platform, 'web');
  // The settings form only appears when the host can read a real schemastery Config. A peer dependency is not
  // resolvable from the profile on every install layout, so the package must depend on it directly.
  assert.ok(pkg.dependencies?.['@deepseek-ai/schemastery'], 'schemastery must be a direct dependency');
  assert.equal(pkg.peerDependencies?.['@deepseek-ai/schemastery'], undefined);
  assert.ok(pkg.files.includes('locale/*.json') && pkg.exports['./locale/*.json'], 'bilingual metadata ships and is exported');
  assert.match(await readFile(join(temp, 'package/client.js'), 'utf8'), /^\/\/ @generated/);
});
