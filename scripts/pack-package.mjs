// Archive tests use the existing npm/pnpm pack command, never a committed tarball.
import { readdir, readFile, mkdtemp, rm, access, realpath } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
/** npm-cli.js behind the `npm` found on PATH (like `which npm` + realpath); Windows shims sit beside node_modules/npm. */
async function npmOnPath() {
  const found = [];
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    found.push(join(dir, 'node_modules/npm/bin/npm-cli.js'));
    try { const real = await realpath(join(dir, 'npm')); if (/\.[cm]?js$/.test(real)) found.push(real); } catch {}
  }
  return found;
}
/** Run real npm/pnpm pack into a fresh temp directory; return uncompressed tar bytes. */
export async function temporaryArchive(t, packageDir) {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-pack-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const candidates = [process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    ...await npmOnPath(),
    join(homedir(), '.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs')].filter(Boolean);
  let cli;
  for (const candidate of candidates) { try { await access(candidate); cli = candidate; break; } catch {} }
  if (!cli) throw new Error('npm/pnpm CLI required for package tests; set npm_execpath to its JS entry');
  const result = spawnSync(process.execPath, [cli, 'pack', '--pack-destination', temp], { cwd: resolve(packageDir), stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`Package pack failed: ${result.error?.message ?? result.status}`);
  const archives = (await readdir(temp)).filter(name => name.endsWith('.tgz'));
  if (archives.length !== 1) throw new Error('Expected exactly one newly packed archive');
  return gunzipSync(await readFile(join(temp, archives[0])));
}
