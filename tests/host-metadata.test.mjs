// Regression: the DSH host reads every *.json in a plugin's locale/ directory as a language
// dictionary (dsh-app-boot readPluginMeta). Non-language dictionaries must live elsewhere (i18n/).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const PACKAGES = [
  { name: '@aiwuk/team', dir: root },
  { name: '@aiwuk/memory', dir: join(root, 'packages/global-memory') },
  { name: '@aiwuk/search', dir: join(root, 'packages/omni-search') },
  { name: '@aiwuk/autocomplete', dir: join(root, 'packages/autocomplete') }
];
// Same rule as dsh-app-boot dictionariesOf: every locale/*.json basename is a language id.
const LANGUAGE_ID = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

async function hostReader() {
  const candidates = [process.env.DSH_APP_BOOT];
  try {
    const dsh = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json');
    candidates.push(join(dsh, '..', 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'));
  } catch { /* not resolvable from here */ }
  candidates.push('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js');
  for (const file of candidates.filter(Boolean)) {
    if (!existsSync(file)) continue;
    try {
      const mod = await import(pathToFileURL(resolve(file)).href);
      if (typeof mod.readPluginMeta === 'function') return mod.readPluginMeta;
    } catch { /* try the next candidate */ }
  }
  return undefined;
}
const readPluginMeta = await hostReader();

for (const pkg of PACKAGES) {
  test(`${pkg.name}: locale/ holds only language-id dictionaries`, () => {
    for (const file of readdirSync(join(pkg.dir, 'locale')).filter(name => name.endsWith('.json')))
      assert.match(file.slice(0, -5), LANGUAGE_ID, `${pkg.name}/locale/${file} must use a language id as its filename`);
  });
  test(`${pkg.name}: host readPluginMeta reports no error and an AIWUK title`, { skip: readPluginMeta ? false : 'DSH install or readPluginMeta export not found (set DSH_APP_BOOT to dsh-app-boot/lib/index.js)' }, () => {
    // Self-reference through the package's own name/exports resolves the real package directory.
    const meta = readPluginMeta(pkg.name, pathToFileURL(join(pkg.dir, 'index.js')).href);
    assert.ok(meta, 'metadata is returned');
    assert.equal(meta.error, undefined, meta.error);
    for (const language of ['en', 'zh']) {
      assert.match(meta.title[language], /^(AIWUK|AI悟空) /, `${language} title`);
      assert.ok(meta.description[language].length > 0, `${language} description`);
    }
    assert.match(meta.title.en, /^AIWUK /);
  });
}
