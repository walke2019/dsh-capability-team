import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { temporaryArchive } from '../../scripts/pack-package.mjs';
import { pathToFileURL } from 'node:url';
test('actual omni-search archive has standalone import closure and no client/config writer', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'omni-pack-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const archive = await temporaryArchive(t, 'packages/omni-search');
  for (let pos = 0; pos + 512 <= archive.length;) {
    const header = archive.subarray(pos, pos + 512); if (header.every(b => b === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8) || 0;
    assert.ok(!name.includes('..') && !name.startsWith('/')); pos += 512;
    if (header[156] === 0 || header[156] === 48) {
      const target = join(temp, name); await mkdir(dirname(target), { recursive: true }); await writeFile(target, archive.subarray(pos, pos + size));
    }
    pos += Math.ceil(size / 512) * 512;
  }
  const plugin = await import(pathToFileURL(join(temp, 'package/index.js')));
  assert.equal(typeof plugin.apply, 'function');
  const pkg = JSON.parse(await readFile(join(temp, 'package/package.json'), 'utf8'));
  assert.equal(pkg.dsh.client, undefined); assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  const config = await import(pathToFileURL(join(temp, 'package/shared/integrations-config.js')));
  assert.equal(config.handleIntegrations, undefined); assert.equal(config.saveIntegrations, undefined);
});
