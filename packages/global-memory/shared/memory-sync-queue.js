import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
// Atomic disk snapshots; overflow is explicit and never silently drops older messages.
export function createSyncQueue(path, { max = 200, warn = () => {} } = {}) {
  let rows = [], revoked = [];
  if (path) {
    try { const saved = JSON.parse(readFileSync(path, 'utf8')); rows = saved.rows ?? []; revoked = saved.revoked ?? []; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const persist = () => {
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify({ rows, revoked }), { mode: 0o600 }); renameSync(temp, path);
  };
  return {
    push(row) {
      if (rows.length >= max) { warn('OpenViking sync queue full; memory retained locally'); throw new Error('OpenViking sync queue full'); }
      rows.push({ ...row, queueId: randomUUID() }); persist();
    },
    peek: (n = 40) => rows.slice(0, n),
    ack(batch) { const ids = new Set(batch.map(r => r.queueId)); rows = rows.filter(r => !ids.has(r.queueId)); persist(); },
    revoke(texts) { revoked = [...new Set([...revoked, ...texts])]; persist(); },
    revoked: () => [...revoked],
    size: () => rows.length,
  };
}
