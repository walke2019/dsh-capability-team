import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { defaultRoot, acquireLock } from './theme.js';
import { validateDisabledRoutes } from './model-policy.js';
const profileNamespace = () => process.env.DSH_PROFILE_DIR ?? process.env.DSH_PROFILE ?? 'default';
export function sessionPolicyPath(sessionId, root = defaultRoot()) {
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('缺少会话标识');
  return join(root, 'sessions', createHash('sha256').update(JSON.stringify([profileNamespace(), sessionId])).digest('hex') + '.json');
}
/** One model policy per DSH profile, shared by every capability-team session. */
export function globalPolicyPath(root = defaultRoot()) {
  return join(root, 'model-policy', createHash('sha256').update(JSON.stringify([profileNamespace(), 'global'])).digest('hex') + '.json');
}
function parsePolicy(raw) {
  try {
    const data = JSON.parse(raw);
    if (!Number.isSafeInteger(data.revision) || data.revision < 1) throw new Error('版本无效');
    return { revision: data.revision, disabledRoutes: validateDisabledRoutes(data.disabledRoutes) };
  } catch (error) { throw new Error(`模型策略文件损坏，已停止分配：${error.message}`); }
}
async function readPolicyAt(path) {
  let raw;
  try { raw = await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { revision: 0, disabledRoutes: [] }; throw error; }
  return parsePolicy(raw);
}
function readPolicyAtSync(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return { revision: 0, disabledRoutes: [] }; throw error; }
  return parsePolicy(raw);
}
export const readSessionPolicy = (sessionId, root) => readPolicyAt(sessionPolicyPath(sessionId, root));
export const readSessionPolicySync = (sessionId, root) => readPolicyAtSync(sessionPolicyPath(sessionId, root));
export const saveSessionPolicy = (sessionId, disabledRoutes, expectedRevision, root) => savePolicyAt(sessionPolicyPath(sessionId, root), disabledRoutes, expectedRevision);
export const readGlobalPolicy = root => readPolicyAt(globalPolicyPath(root));
export const readGlobalPolicySync = root => readPolicyAtSync(globalPolicyPath(root));
export const saveGlobalPolicy = (disabledRoutes, expectedRevision, root) => savePolicyAt(globalPolicyPath(root), disabledRoutes, expectedRevision);
async function savePolicyAt(path, disabledRoutes, expectedRevision) {
  const disabled = validateDisabledRoutes(disabledRoutes);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('无效的策略版本');
  await mkdir(join(path, '..'), { recursive: true });
  const lock = await acquireLock(path + '.lock');
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const current = await readPolicyAt(path);
    if (current.revision !== expectedRevision) throw new Error('模型策略已变化，请刷新后重新选择');
    const next = { revision: current.revision + 1, disabledRoutes: disabled };
    await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx' });
    await rename(temporary, path);
    return next;
  } finally {
    try { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    finally { try { await lock.close(); } finally { await unlink(path + '.lock').catch(error => { if (error.code !== 'ENOENT') throw error; }); } }
  }
}
