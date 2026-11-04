// CI smoke check: verify this repo's DSH contract against an installed @deepseek-ai/dsh CLI.
// Usage: node scripts/ci-dsh-smoke.mjs [dshPackageDir]   (or set DSH_PACKAGE_DIR)
// Without an argument the global npm root is used.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const repo = resolve(import.meta.dirname, '..');
const manifests = ['package.json', 'packages/omni-search/package.json', 'packages/global-memory/package.json'];
const profilePackage = '@deepseek-ai/dsh-experimental-agent-team-profile';
const failures = [];

function globalDshDir() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`npm root -g failed: ${result.stderr || result.error?.message}`);
  return join(result.stdout.trim(), '@deepseek-ai', 'dsh');
}

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const dshDir = resolve(process.argv[2] || process.env.DSH_PACKAGE_DIR || globalDshDir());
if (!existsSync(join(dshDir, 'package.json'))) {
  console.error(`FAIL: @deepseek-ai/dsh is not installed at ${dshDir}`);
  process.exit(1);
}
const dsh = readJson(join(dshDir, 'package.json'));
console.log(`Installed ${dsh.name}@${dsh.version} at ${dshDir}`);

// Reuse the semver copy shipped with the CLI instead of adding a dependency.
const requireFromDsh = createRequire(join(dshDir, 'package.json'));
let semver;
try { semver = requireFromDsh('semver'); } catch {
  console.error('FAIL: semver is not resolvable from the installed DSH package');
  process.exit(1);
}

/** Return the installed version of a @deepseek-ai package, or undefined. */
function installedVersion(name) {
  if (name === dsh.name) return dsh.version;
  for (const base of [join(dshDir, 'node_modules'), join(dshDir, '..', '..')]) {
    const file = join(base, ...name.split('/'), 'package.json');
    if (existsSync(file)) return readJson(file).version;
  }
  return undefined;
}

let checked = 0;
for (const manifest of manifests) {
  const pkg = readJson(join(repo, manifest));
  const label = `${pkg.name} (${manifest})`;
  const peers = Object.entries(pkg.peerDependencies ?? {}).filter(([name]) => name.startsWith('@deepseek-ai/'));
  for (const [name, range] of peers) {
    checked++;
    const version = installedVersion(name);
    if (!version) failures.push(`${label}: peer ${name}@${range} is not installed in the DSH CLI`);
    else if (!semver.satisfies(version, range, { includePrerelease: true }))
      failures.push(`${label}: peer ${name}@${range} is not satisfied by installed ${version}`);
    else console.log(`ok  ${label}: ${name}@${range} <- ${version}`);
  }
  for (const name of pkg.dsh?.client?.inject ?? []) {
    checked++;
    if (!installedVersion(name)) failures.push(`${label}: injected client package ${name} is missing from the DSH CLI`);
    else console.log(`ok  ${label}: client inject ${name}`);
  }
}

const profileVersion = installedVersion(profilePackage);
if (!profileVersion) failures.push(`Official agent-team profile ${profilePackage} is missing from the DSH CLI`);
else console.log(`ok  ${profilePackage}@${profileVersion}`);

if (failures.length) {
  console.error(`\nDSH compatibility smoke FAILED against ${dsh.name}@${dsh.version}:`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`\nDSH compatibility smoke passed (${checked + 1} checks) against ${dsh.name}@${dsh.version}.`);
