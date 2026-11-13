import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { BRAND, EXTENSIONS, RENAME_MAP } from '../brand.js';

const root = new URL('../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));

// Literal copy of contract section A.1 (do not derive from brand.js).
const EXPECTED_RENAME = {
  'dsh-capability-team': '@aiwuk/team',
  'dsh-capability-autocomplete': '@aiwuk/autocomplete',
  'dsh-capability-memory': '@aiwuk/memory',
  'dsh-omni-search': '@aiwuk/search',
  '@dsh-mothership/connector': '@aiwuk/connector',
  '@dsh-mothership/connector-bundle': '@aiwuk/connector-bundle',
  '@dsh-mothership/connector-updater': '@aiwuk/connector-updater',
};
const PACKAGES = [
  { dir: '.', key: 'team', name: '@aiwuk/team', version: '5.3.1' },
  { dir: 'packages/autocomplete', key: 'autocomplete', name: '@aiwuk/autocomplete', version: '1.0.4' },
  { dir: 'packages/global-memory', key: 'memory', name: '@aiwuk/memory', version: '1.0.6' },
  { dir: 'packages/omni-search', key: 'search', name: '@aiwuk/search', version: '1.1.0' },
];

test('brand constants and rename map match the contract', () => {
  assert.deepEqual({ ...BRAND }, { id: 'aiwuk', en: 'AIWUK', zh: 'AI悟空', domain: 'aiwuk.com', scope: '@aiwuk' });
  assert.deepEqual({ ...RENAME_MAP }, EXPECTED_RENAME);
  assert.deepEqual(Object.keys(EXTENSIONS), ['team', 'autocomplete', 'memory', 'search', 'connector']);
  for (const [key, ext] of Object.entries(EXTENSIONS)) {
    assert.ok(ext.pkg.startsWith(`${BRAND.scope}/`), key);
    for (const field of [ext.en, ext.zh, ext.description.en, ext.description.zh]) assert.ok(field && field.length > 0, key);
    assert.ok(ext.en.startsWith(BRAND.en) && ext.zh.startsWith(BRAND.zh), key);
  }
});

for (const pkg of PACKAGES) {
  test(`${pkg.name}: name, version, engines, peers and locale titles`, async () => {
    const manifest = await json(`${pkg.dir}/package.json`);
    assert.equal(manifest.name, pkg.name);
    assert.equal(manifest.name, EXTENSIONS[pkg.key].pkg);
    assert.equal(manifest.version, pkg.version);
    assert.deepEqual(manifest.engines, { node: '>=24.9', dsh: '>=0.2.2-rc.1 <0.3.0' });
    for (const [peer, range] of Object.entries(manifest.peerDependencies ?? {})) {
      const generationRanges = { '@deepseek-ai/dsh-experimental-agent-team': '>=0.2.2-rc.1 <0.2.2-rc.2', '@deepseek-ai/dsh-agent-team': '>=0.2.2-rc.2', '@deepseek-ai/dsh-subagent': '>=0.2.2-rc.2' };
      if (peer.startsWith('@deepseek-ai/dsh-')) assert.equal(range, generationRanges[peer] ?? '>=0.2.2-rc.1', peer);
      if (generationRanges[peer]) assert.equal(manifest.peerDependenciesMeta[peer].optional, true, peer);
    }
    assert.match(manifest.description, /^AIWUK /, 'public description stays English');
    assert.doesNotMatch(manifest.description, /[\u4e00-\u9fff]/);
    for (const [file, lang] of [['en', 'en'], ['zh', 'zh']]) {
      const { meta } = await json(`${pkg.dir}/locale/${file}.json`);
      assert.equal(meta.title, EXTENSIONS[pkg.key][lang]);
      assert.equal(meta.description, EXTENSIONS[pkg.key].description[lang]);
    }
  });
}

test('every bundle patch names only new packages', async () => {
  for (const pkg of PACKAGES) {
    const text = await readFile(new URL(`${pkg.dir}/cordis.patch.yml`, root), 'utf8');
    assert.ok(text.includes(`name: '${pkg.name}'`), pkg.dir);
  }
  assert.ok((await readFile(new URL('cordis.patch.yml', root), 'utf8')).includes("name: '@aiwuk/team/roles'"));
});

test('shared closures ship brand.js', async () => {
  for (const dir of ['packages/global-memory', 'packages/omni-search']) {
    const script = await readFile(new URL(`${dir}/scripts/build-shared.mjs`, root), 'utf8');
    assert.match(script, /'brand\.js'/, dir);
  }
});

// Old package names may remain only in history/migration material, the map itself, and the owner-pending files below.
const ALLOWED = new Set(['CHANGELOG.md', 'brand.js', 'docs/migration-aiwuk.md', 'tests/brand.test.mjs',
  'packages/global-memory/README.md', 'packages/omni-search/README.md']); // the last two keep a short rename history note
// Files owned by other work packages that still carry old names; shrink this list as they land.
const PENDING_OWNERS = new Set();
const GENERATED = /^(client\.js|packages\/autocomplete\/client\.js|packages\/[^/]+\/shared\/)/;
// Skips URLs (github.com/.../dsh-capability-team), storage keys and file globs (dsh-capability-team-locale, local-dsh-...).
const OLD_NAME = /(?<![\w@./-])(?:dsh-capability-(?:team|autocomplete|memory)|dsh-omni-search|@dsh-mothership\/connector(?:-bundle|-updater)?)(?![\w-])/g;

test('no old package name remains outside the allowed places', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: fileURLToPath(root), encoding: 'utf8' }).split('\0').filter(Boolean);
  const unexpected = [];
  const pending = new Set();
  for (const file of files) {
    if (ALLOWED.has(file) || GENERATED.test(file) || file.endsWith('.tgz')) continue;
    const text = readFileSync(new URL(file, root), 'utf8');
    if (!new RegExp(OLD_NAME).test(text)) continue;
    if (PENDING_OWNERS.has(file)) pending.add(file);
    else unexpected.push(file);
  }
  assert.deepEqual(unexpected, [], 'old package names found');
  for (const file of PENDING_OWNERS) assert.ok(pending.has(file), `${file} is clean now: remove it from PENDING_OWNERS`);
});
