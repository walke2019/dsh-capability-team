import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const allowlist = JSON.parse(readFileSync(new URL('./i18n-allowlist.json', import.meta.url), 'utf8'));
const cjk = /[\u3400-\u9fff\uf900-\ufaff]/u;
function sources(dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['locale', 'tests', 'node_modules', '.git', '.work'].includes(entry.name)) return [];
    const path = join(dir, entry.name), name = relative(root, path).split('\\').join('/');
    if (entry.isDirectory()) return /^packages\/[^/]+\/shared$/.test(name) ? [] : sources(path);
    if (!/\.(?:js|mjs)$/.test(name) || name === 'client.js' || /^packages\/[^/]+\/client\.js$/.test(name) || name === 'client/00-core-zh.js' || name === 'brand.js') return [];
    return [name];
  });
}
test('source code contains no unreviewed CJK outside locale resources', () => {
  const violations = [], seen = new Set();
  for (const name of sources()) {
    const text = readFileSync(resolve(root, name), 'utf8');
    if (text.startsWith('// @generated')) continue;
    text.split('\n').forEach((line, index) => {
      if (!cjk.test(line)) return;
      if (allowlist[name]?.lines.includes(line)) seen.add(`${name}:${line}`);
      else violations.push(`${name}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(violations, [], violations.join('\n'));
  for (const [name, entry] of Object.entries(allowlist)) {
    assert.ok(entry.reason, `Missing justification: ${name}`);
    for (const line of entry.lines) assert.ok(seen.has(`${name}:${line}`), `Stale allow-list entry: ${name}`);
  }
});
