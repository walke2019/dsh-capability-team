// This extension ships native JavaScript: build checks the package, it does not transpile it.
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, posix } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FILE_LIMITS, sizeViolations } from '../file-limits.js';
import { buildClient } from './build-client.mjs';
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
// The standalone Host bundle has a separate publication closure.
for (const bundle of ['global-memory', 'omni-search']) {
const globalRoot = join(root, 'packages', bundle);
  await stat(join(globalRoot, 'package.json'));
  const check = spawnSync(process.execPath, [join(globalRoot, 'scripts/build-shared.mjs'), '--check'], { encoding: 'utf8', windowsHide: true });
  if (check.status !== 0) throw new Error(check.stderr || 'Shared hash check failed');
  const files = await walk(globalRoot);
  for (const path of files.filter(p => /\.js$/.test(p))) {
    const source = await readFile(path, 'utf8');
    for (const m of source.matchAll(/\b(?:import|export)\s+(?:[^;'"()]*?\s+from\s*)?['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const target = join(dirname(path), m[1] ?? m[2]);
      if (relative(globalRoot, target).startsWith('..') || !files.includes(target)) throw new Error(`Global memory import escapes package: ${path}`);
    }
  }
  console.log(`${bundle.toUpperCase().replaceAll('-', '_')}_CLOSURE_OK`);
}
// Autocomplete ships its own generated client.js: it must be current and every published file must exist.
{
  const acRoot = join(root, 'packages', 'autocomplete');
  const check = spawnSync(process.execPath, [join(acRoot, 'scripts/build-client.mjs'), '--check'], { encoding: 'utf8', windowsHide: true });
  if (check.status !== 0) throw new Error(check.stderr || 'Autocomplete client check failed');
  const acPkg = JSON.parse(await readFile(join(acRoot, 'package.json'), 'utf8'));
  for (const entry of [...acPkg.files, ...Object.values(acPkg.exports), acPkg.dsh.bundle.patch]) {
    const file = entry.replace(/^\.\//, '');
    if (!file.includes('*')) { await stat(join(acRoot, file)); continue; }
    // A wildcard entry must match at least one file, and every matched JSON file must parse.
    const [prefix, suffix] = file.slice(file.lastIndexOf('/') + 1).split('*');
    const dir = join(acRoot, file.slice(0, Math.max(0, file.lastIndexOf('/'))));
    const matched = (await readdir(dir)).filter(name => name.startsWith(prefix) && name.endsWith(suffix));
    if (!matched.length) throw new Error(`Empty autocomplete package pattern: ${entry}`);
    for (const name of matched) if (name.endsWith('.json')) JSON.parse(await readFile(join(dir, name), 'utf8'));
  }
  console.log('AUTOCOMPLETE_CLOSURE_OK');
}
let checked = 0;
for (const path of await walk(root)) {
  if (/\.m?js$/.test(path)) {
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `Syntax failure: ${path}`);
    checked++;
  }
}
// File rules apply to the project itself, not only to team members (generated client.js is exempt).
const oversize = sizeViolations((await walk(root)).map(path => relative(root, path).split('\\').join('/')), FILE_LIMITS, undefined, root);
if (oversize.length) throw new Error(`File size limits exceeded:\n${oversize.map(v => `  ${v.file}: ${v.lines} > ${v.max}`).join('\n')}`);
if ((await readFile(join(root, 'client.js'), 'utf8')) !== await buildClient()) throw new Error('client.js is stale: run npm run build:client');
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
  // Validate the actual publication set, including wildcard entries: static relative
  // imports/re-exports and literal dynamic imports must resolve inside that set.
  const shipped = new Set();
  const matches = (file, pattern) => {
    const escaped = pattern.replace(/^\.\//, '').split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
    return new RegExp(`^${escaped}$`).test(file);
  };
  for (const file of await walk(root)) {
    const name = relative(root, file).split('\\').join('/');
    if (pkg.files.some(pattern => matches(name, pattern))) shipped.add(name);
  }
  let imports = 0;
  for (const file of shipped) {
    if (!/\.m?js$/.test(file)) continue;
    const source = await readFile(join(root, file), 'utf8');
    const specs = [...source.matchAll(/\b(?:import|export)\s+(?:[^;'"()]*?\s+from\s*)?['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)];
    for (const match of specs) {
      const specifier = match[1] ?? match[2];
      const target = posix.normalize(posix.join(posix.dirname(file), specifier));
      if (target.startsWith('../') || !shipped.has(target)) throw new Error(`Unpublished relative import: ${file} -> ${specifier} (${target})`);
      imports++;
    }
  }
  console.log(`PACKAGE_CLOSURE_OK files=${shipped.size} imports=${imports}`);
  for (const file of await readdir(join(root, 'locale'))) if (file.endsWith('.json')) JSON.parse(await readFile(join(root, 'locale', file), 'utf8'));
  console.log(`BUILD_CHECK_OK syntax=${checked} exports=${Object.keys(pkg.exports).length}`);
} else console.log(`LINT_OK syntax=${checked}`);
