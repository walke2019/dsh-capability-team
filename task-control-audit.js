// Threat boundary: trusted local root; lstat/O_NOFOLLOW block non-racing symlinks.
// Node path APIs lack dirfd-relative operations: hostile concurrent directory swaps
// are NOT prevented. Append completion is not a power-loss durability guarantee.
// Retention: current file plus four rotated segments (five total).
// Permissions: 0o700/0o600 apply on POSIX; on Windows chmod only toggles read-only, and privacy comes from
// the per-user profile ACL that the DSH home directory inherits.
import { createHash } from 'node:crypto';
import { mkdir, lstat, open, readdir, unlink, rename, chmod, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
export function redactReason(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/(?:sk-|ghp_|Bearer\s+)[\w.\-]+/gi, '[redacted]').replace(/(?:password|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, '[redacted]').slice(0, 240);
}
export function createTaskAudit(root, { now = Date.now } = {}) {
  const queues = new Map();
  let trustedRoot;
  const resolveRoot = () => trustedRoot ??= mkdir(root, { recursive: true, mode: 0o700 }).then(() => realpath(root));
  async function directory(dir) {
    // Reject existing symlinks before mkdir can follow them.
    for (let p = dir; p !== path.dirname(p); p = path.dirname(p)) {
      try { if ((await lstat(p)).isSymbolicLink()) throw new Error('Unsafe audit ancestor'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    await chmod(path.dirname(dir), 0o700);
    const info = await lstat(dir); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Unsafe audit directory');
    // Check every existing ancestor, not only the leaf (no symlink escape).
    for (let p = dir; p !== path.dirname(p); p = path.dirname(p)) if ((await lstat(p)).isSymbolicLink()) throw new Error('Unsafe audit ancestor');
  }
  return {
    append(leadId, record) {
      const run = async () => {
        const dir = path.join(await resolveRoot(), 'task-controls', createHash('sha256').update(leadId).digest('hex'));
        await directory(dir); const file = path.join(dir, 'audit.jsonl');
        let stat; try { stat = await lstat(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (stat?.isSymbolicLink() || stat && !stat.isFile()) throw new Error('Unsafe audit file');
        let lines = 0;
        if (stat) { const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); try { lines = (await handle.readFile('utf8')).split('\n').length - 1; } finally { await handle.close(); } }
        if (stat && (stat.size >= 2 * 1024 * 1024 || lines >= 10000)) {
          const rotated = path.join(dir, `audit-${now()}-${Math.random().toString(16).slice(2)}.jsonl`); await rename(file, rotated);
        }
        const segments = [];
        for (const name of await readdir(dir)) if (/^audit-.*\.jsonl$/.test(name)) {
          const target = path.join(dir, name), s = await lstat(target); if (s.isSymbolicLink() || !s.isFile()) throw new Error('Unsafe audit segment');
          segments.push({ target, at: s.mtimeMs });
        }
        segments.sort((a, b) => b.at - a.at);
        for (let i = 0; i < segments.length; i++) if (i >= 4 || now() - segments[i].at > 30 * 86400000) {
          const target = segments[i].target; if (path.dirname(target) !== dir) throw new Error('Invalid audit deletion'); await unlink(target);
        }
        const handle = await open(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
        try { await handle.chmod(0o600); await handle.writeFile(`${JSON.stringify(Object.fromEntries(['eventId','intentEventId','at','leadSessionId','memberSessionId','roleId','leaseId','revision','actor','action','from','to','reasonCode','reason','source','startsUsed','estimatedSteps','complexity','taskId','assignmentId'].map(key=>[key,key==='reason'?redactReason(record.reason):key==='reasonCode'?redactReason(record[key]):['from','to'].includes(key)?record[key]?{provider:record[key].provider,model:record[key].model,tier:record[key].tier??null}:null:key==='actor'?record.actor?{kind:record.actor.kind,id:record.actor.id}:null:record[key]??null])))}\n`); } finally { await handle.close(); }
      };
      const task = (queues.get(leadId) ?? Promise.resolve()).catch(() => {}).then(run);
      queues.set(leadId, task); return task.finally(() => { if (queues.get(leadId) === task) queues.delete(leadId); });
    },
  };
}
