// Route failures that outlive a DSH restart. The failover layer keeps cooldowns in memory, so after a restart
// a route with a dead key looked healthy again and could even be preselected as a habit. Failures are kept
// here: credential errors (the key is wrong until someone fixes it) for a day, other failures for an hour.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
export const CREDENTIAL_CODES = new Set(['AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL']);
export const KEEP_MS = { credential: 24 * 3600_000, other: 3600_000 };
/** Whether a failure means the route's key is wrong or missing (it stays bad until someone fixes it). */
export const isCredential = (code, status) => CREDENTIAL_CODES.has(code) || status === 401 || status === 403;
export function createRouteHealth(root, { now = Date.now } = {}) {
  const path = join(root, 'route-health.json');
  let data;
  const load = () => {
    if (data) return data;
    try { data = JSON.parse(readFileSync(path, 'utf8')); } catch { data = {}; }
    return data;
  };
  const save = () => {
    try { mkdirSync(root, { recursive: true }); const temp = `${path}.${process.pid}.tmp`; writeFileSync(temp, JSON.stringify(data)); renameSync(temp, path); } catch { /* best effort */ }
  };
  const alive = (entry, at) => at - entry.lastFailureAt < (entry.credential ? KEEP_MS.credential : KEEP_MS.other);
  return {
    /** Failover telemetry: remember each cooldown with its error class. */
    record(event) {
      if (event?.kind !== 'cooldown' || !event.route) return;
      const key = `${event.route.provider}/${event.route.model}`;
      load()[key] = { strikes: event.strikes ?? 1, lastFailureAt: now(), code: event.code ?? null, credential: isCredential(event.code, event.status) };
      for (const [k, v] of Object.entries(data)) if (!alive(v, now())) delete data[k];
      save();
    },
    /** Recent failures, in the same shape as failover.health(). */
    recent() {
      const at = now();
      return Object.fromEntries(Object.entries(load()).filter(([, v]) => alive(v, at)).map(([k, v]) => [k, { strikes: v.strikes, lastFailureAt: v.lastFailureAt, cooling: false, credential: v.credential }]));
    },
  };
}
/** Persisted failures merged with the live failover state (live state wins). */
export const mergeHealth = (persisted, live) => ({ ...persisted, ...live });
