// Persistence for per-task routes confirmed in the dispatch card ("this task only"). Lead sessions survive a
// DSH restart, so their confirmed routes do too: one small JSON file per Lead under the plugin root, written
// atomically (temp file + rename) and read lazily the first time a Lead is seen after start.
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const MAX_AGE_MS = 30 * 86400000; // a Lead untouched for 30 days has finished that task
export function createRouteStore(root, { now = Date.now } = {}) {
  const dir = join(root, 'dispatch-routes');
  const fileOf = leadId => join(dir, `${createHash('sha256').update(String(leadId)).digest('hex').slice(0, 32)}.json`);
  return {
    /** { routes: [[role, route]], confirmed: [[role, key]] } for a Lead, or undefined. */
    load(leadId) {
      try {
        const data = JSON.parse(readFileSync(fileOf(leadId), 'utf8'));
        if (data?.leadId !== leadId || !Array.isArray(data.routes) || !Array.isArray(data.confirmed)) return undefined;
        if (now() - (data.savedAt ?? 0) > MAX_AGE_MS) { this.remove(leadId); return undefined; }
        return data;
      } catch { return undefined; }
    },
    save(leadId, routes, confirmed) {
      const file = fileOf(leadId), temp = `${file}.${randomUUID()}.tmp`;
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(temp, JSON.stringify({ schemaVersion: 1, leadId, savedAt: now(), routes: [...routes], confirmed: [...confirmed] }) + '\n');
        renameSync(temp, file);
      } catch { /* routing still works from memory for this run */ } finally { try { unlinkSync(temp); } catch { /* renamed */ } }
    },
    remove(leadId) { try { unlinkSync(fileOf(leadId)); } catch { /* absent */ } },
  };
}
