// Per-project team configuration store: overrides on top of the preset base.
import { mkdir, readFile, writeFile, rename, unlink, open, stat } from 'node:fs/promises';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { effectiveConfig, migrateProject, applyPatch, seed } from './config.js';
export const STALE_LOCK_MS = 30000;
export function defaultRoot() {
  return process.env.CAPABILITY_TEAM_HOME || join(homedir(), '.dsh', 'capability-team-themes');
}
function identity(dir) {
  const project = resolve(dir);
  return process.platform === 'win32' ? project.toLowerCase() : project;
}
export function themePath(cwd, root = defaultRoot()) {
  return join(root, createHash('sha256').update(identity(cwd)).digest('hex') + '.json');
}
/** Nearest ancestor (inclusive) that already owns a configuration, else the directory itself. */
export function projectRoot(cwd, root = defaultRoot()) {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(themePath(dir, root))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(cwd);
    dir = parent;
  }
}
const cache = new Map();
function parse(raw, path) {
  try { return migrateProject(JSON.parse(raw)); }
  catch (error) { throw new Error(`项目团队配置损坏（${path}）：${error.message}；请修复或删除该文件后重新配置`); }
}
const EMPTY = Object.freeze({ revision: 0, tiers: {}, capabilities: {}, roles: {} });
function remember(path, info, raw) {
  const value = parse(raw, path);
  cache.set(path, { mtimeMs: info.mtimeMs, size: info.size, value });
  return value;
}
function cached(path, info) {
  const hit = cache.get(path);
  return hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size ? hit.value : undefined;
}
/** Read stored overrides; cached by mtime and size so a request costs one stat. */
export async function readOverrides(project, root = defaultRoot()) {
  const path = themePath(project, root);
  let info;
  try { info = await stat(path); } catch (error) { if (error.code === 'ENOENT') { cache.delete(path); return EMPTY; } throw error; }
  return cached(path, info) ?? remember(path, info, await readFile(path, 'utf8'));
}
/** Synchronous variant for prompt assembly, which cannot await. */
export function readOverridesSync(project, root = defaultRoot()) {
  const path = themePath(project, root);
  let info;
  try { info = statSync(path); } catch (error) { if (error.code === 'ENOENT') { cache.delete(path); return EMPTY; } throw error; }
  return cached(path, info) ?? remember(path, info, readFileSync(path, 'utf8'));
}
export async function loadProject(project, base = seed, root) {
  const overrides = await readOverrides(project, root);
  return { project, revision: overrides.revision, overrides, effective: effectiveConfig(overrides, base) };
}
export function loadProjectSync(project, base = seed, root) {
  const overrides = readOverridesSync(project, root);
  return { project, revision: overrides.revision, overrides, effective: effectiveConfig(overrides, base) };
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
export async function acquireLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, 'wx');
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() })); }
      catch (error) { await handle.close(); await unlink(lockPath); throw error; }
      return handle;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner = {};
      try { owner = JSON.parse(await readFile(lockPath, 'utf8')); } catch { /* empty or partial lock: judged by file age */ }
      const since = Number(owner.at) || (await stat(lockPath).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
      const knownOwner = Number.isSafeInteger(owner.pid) && owner.pid > 0;
      // A confirmation dialog can stay open for minutes. Age never invalidates a live owner's lock.
      const stale = knownOwner ? !alive(owner.pid) : Date.now() - since > STALE_LOCK_MS;
      if (attempt || !stale) throw new Error('团队配置正在被其他会话保存，请稍后重新读取后重试');
      await unlink(lockPath).catch(e => { if (e.code !== 'ENOENT') throw e; });
    }
  }
}
/**
 * Apply one patch under a lock with revision CAS; the merged result must validate.
 * `check(before, after)` may reject, for example on a catalog or confirmation failure.
 */
export async function saveProject(project, patch, expectedRevision, { base = seed, root = defaultRoot(), check } = {}) {
  const path = themePath(project, root);
  await mkdir(dirname(path), { recursive: true });
  const lock = await acquireLock(path + '.lock');
  const tmp = path + '.' + randomUUID() + '.tmp';
  try {
    const previous = await loadProject(project, base, root);
    if (!Number.isSafeInteger(expectedRevision) || previous.revision !== expectedRevision) throw new Error(`团队配置版本冲突（当前 ${previous.revision}），请重新读取并重新确认`);
    const nextOverrides = applyPatch(previous.overrides, patch);
    const effective = effectiveConfig(nextOverrides, base);
    if (check) await check(previous.effective, effective);
    const stored = { ...nextOverrides, revision: previous.revision + 1, project: resolve(project) };
    await writeFile(tmp, JSON.stringify(stored, null, 2), { encoding: 'utf8', flag: 'wx' });
    await rename(tmp, path);
    cache.delete(path);
    return { project: resolve(project), revision: stored.revision, effective };
  } finally {
    try { await unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
    finally { try { await lock.close(); } finally { await unlink(path + '.lock').catch(e => { if (e.code !== 'ENOENT') throw e; }); } }
  }
}
