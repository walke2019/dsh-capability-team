// This extension ships native JavaScript: build checks the package, it does not transpile it.
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else result.push(path);
  }
  return result;
}
let checked = 0;
for (const path of await walk(root)) {
  if (/\.m?js$/.test(path)) {
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `Syntax failure: ${path}`);
    checked++;
  }
}
if (process.argv[2] === 'package') {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  for (const pattern of [...Object.values(pkg.exports), ...pkg.files, pkg.dsh.bundle.patch]) {
    const normalized = pattern.replace(/^\.\//, '');
    if (normalized.includes('*')) {
      const slash = normalized.lastIndexOf('/');
      const dir = slash < 0 ? root : join(root, normalized.slice(0, slash));
      const [prefix, suffix] = normalized.slice(slash + 1).split('*');
      if (!(await readdir(dir)).some(name => name.startsWith(prefix) && name.endsWith(suffix))) throw new Error(`Empty package pattern: ${pattern}`);
    } else if (!(await stat(join(root, normalized))).isFile()) throw new Error(`Missing package file: ${pattern}`);
  }
  for (const file of await readdir(join(root, 'locale'))) if (file.endsWith('.json')) JSON.parse(await readFile(join(root, 'locale', file), 'utf8'));
  console.log(`BUILD_CHECK_OK syntax=${checked} exports=${Object.keys(pkg.exports).length}`);
} else console.log(`LINT_OK syntax=${checked}`);
