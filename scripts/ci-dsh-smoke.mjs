// CI smoke check: verify this repo's DSH contract against an installed @deepseek-ai/dsh CLI.
// Usage: node scripts/ci-dsh-smoke.mjs [dshPackageDir]   (or set DSH_PACKAGE_DIR)
// Without an argument the global npm root is used.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
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
function packageFile(name) {
  if (name === dsh.name) return join(dshDir, 'package.json');
  for (const parent of [join(dshDir, 'package.json'), ...['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-experimental-voice-input-bundle'].map(bundle => { try { return requireFromDsh.resolve(`${bundle}/package.json`); } catch { return join(dshDir, 'package.json'); } })]) {
    try { return createRequire(parent).resolve(`${name}/package.json`); } catch { /* older packages may not export metadata */ }
    for (const base of [join(dirname(parent), 'node_modules'), join(dshDir, '..', '..')]) {
      const file = join(base, ...name.split('/'), 'package.json');
      if (existsSync(file)) return file;
    }
  }
}
const installedVersion = name => { const file = packageFile(name); return file ? readJson(file).version : undefined; };
const nativeTeam = packageFile('@deepseek-ai/dsh-agent-team');
const generation = nativeTeam && !installedVersion('@deepseek-ai/dsh-experimental-agent-team') ? 'rc2' : 'rc1';
const generationPeers = new Set(generation === 'rc2' ? ['@deepseek-ai/dsh-agent-team', '@deepseek-ai/dsh-subagent'] : ['@deepseek-ai/dsh-experimental-agent-team']);

let checked = 0;
for (const manifest of manifests) {
  const pkg = readJson(join(repo, manifest));
  const label = `${pkg.name} (${manifest})`;
  const peers = Object.entries(pkg.peerDependencies ?? {}).filter(([name]) => name.startsWith('@deepseek-ai/'));
  for (const [name, range] of peers) {
    if (['@deepseek-ai/dsh-experimental-agent-team', '@deepseek-ai/dsh-agent-team', '@deepseek-ai/dsh-subagent'].includes(name) && !generationPeers.has(name)) continue;
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

if (generation === 'rc1') {
  const profileVersion = installedVersion(profilePackage);
  if (!profileVersion) failures.push(`Official agent-team profile ${profilePackage} is missing from the DSH CLI`);
  else console.log(`ok  ${profilePackage}@${profileVersion}`);
} else {
  for (const [name, methods] of [['@deepseek-ai/dsh-agent-team', ['isEnabled', 'createTask', 'getTask', 'listTasks', 'updateTask']], ['@deepseek-ai/dsh-subagent', ['rootOf', 'namesOf', 'listDescendants', 'resolveName', 'sendMessage', 'startActivation']]]) {
    try {
      const file = packageFile(name);
      if (!file) throw new Error('package missing');
      const entry = resolve(dirname(file), readJson(file).main ?? 'lib/index.js');
      const loaded = await import(pathToFileURL(entry).href);
      const prototype = (loaded.default ?? loaded.TeamService ?? loaded.SubagentRuntime)?.prototype;
      for (const method of methods) if (typeof prototype?.[method] !== 'function') failures.push(`${name}: required native method ${method} is missing`);
      console.log(`ok  ${name}: native service imported`);
    } catch (error) { failures.push(`${name}: native import failed: ${error.message}`); }
  }
  const baseFile = packageFile('@deepseek-ai/dsh-base');
  const patch = baseFile ? readFileSync(join(dirname(baseFile), 'cordis.patch.yml'), 'utf8') : '';
  for (const name of ['@deepseek-ai/dsh-agent-team', '@deepseek-ai/dsh-tool-agent-team', '@deepseek-ai/dsh-tool-subagent', '@deepseek-ai/dsh-tool-subagent-control']) if (!patch.includes(`name: '${name}'`)) failures.push(`Native base composition is missing ${name}`);
}

if (failures.length) {
  console.error(`\nDSH compatibility smoke FAILED against ${dsh.name}@${dsh.version}:`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`\nDSH compatibility smoke passed (${checked + 1} checks) against ${dsh.name}@${dsh.version}.`);
