import { m as modelText } from './i18n.js';
// Pluggable shared long-term memory backends for the memory hub (team plugin) and the global-memory package.
// The local store (memory-store.js) is always the source of truth; a backend only mirrors memories to a
// shared service and merges that service's recall into local results. `integrations.memory.backend` picks one.
//
// Backend interface (every backend factory returns an object with exactly these members):
//   name                      registry id, e.g. 'openviking'
//   enabled                   (getter) true only when the backend is selected and configured
//   lastError                 last failure message, or null; never contains key values
//   enqueue(memory, who)      queue one redacted memory for sync; returns true when queued, false when disabled
//   revoke(memories)          mark superseded memories withdrawn (filtered from recall, withdrawal sent upstream)
//   recall(query, limit)      Promise<[{ score, via: [name], memory: { id, kind, scope: { kind: name }, text } }]>,
//                             [] when disabled or unreachable (never rejects for availability failures)
//   flush()                   Promise<{ sent }>: send queued memories now
//   status()                  Promise<{ enabled, ... }>: health for diagnostics
//   pending()                 number of queued, unsent memories
// A factory receives the options given to createMemoryBackend: { settings, queuePath, label, fetcher, now,
// schedule, warn }; `queuePath` may be a function of the backend id so each backend keeps its own queue file
// (when undefined, the backend picks its default). `label` names the caller (e.g. the team or global-memory) in text sent upstream.
//
// Adding a backend (e.g. mem0): create memory-mem0.js exporting createMem0(options) that implements the
// interface above, then add one line `mem0: createMem0,` (plus its import) to MEMORY_BACKEND_REGISTRY.
// The config validator's MEMORY_BACKENDS list (integrations-config.js) must accept the same id.
import { createOpenViking, memorySettings } from './memory-openviking.js';

/** Backend used when `integrations.memory.backend` is 'local': memories stay in the local store only. */
export function createLocalBackend() {
  return {
    name: 'local',
    enabled: false,
    lastError: null,
    enqueue: () => false,
    revoke() {},
    recall: async () => [],
    flush: async () => ({ sent: 0 }),
    status: async () => ({ enabled: false }),
    pending: () => 0,
  };
}

/** Backend id → factory. One line per backend. */
export const MEMORY_BACKEND_REGISTRY = Object.freeze({
  local: createLocalBackend,
  openviking: createOpenViking,
});

/**
 * The backend selected by `integrations.memory.backend`, re-read on every call so config edits apply without a
 * reload. Backends are created lazily on first use (no queue recovery or timers for an unselected backend) and
 * then reused. `options.backend` pins an id (tests); `options.settings` fixes { config, key } like memorySettings().
 * `options.lazy` false (default) creates the selected backend at once, so a queue left by a previous run is
 * recovered and flushed on start; true defers that to first use (profiles that may never use memory sync).
 */
export function createMemoryBackend(options = {}) {
  const instances = new Map();
  let pickError = null;
  const pick = () => {
    let name = options.backend;
    if (!name) {
      try { name = (options.settings ?? memorySettings()).config.backend; pickError = null; }
      catch (error) { pickError = error.message; name = 'local'; }
    }
    if (!Object.hasOwn(MEMORY_BACKEND_REGISTRY, name)) name = 'local';
    if (!instances.has(name)) {
      const queuePath = typeof options.queuePath === 'function' ? options.queuePath(name) : options.queuePath;
      try { instances.set(name, MEMORY_BACKEND_REGISTRY[name]({ ...options, queuePath })); }
      catch (error) {
        // A corrupt queue file or bad backend settings must not fail every memory search/write; fall back to local.
        pickError = modelText('memory-backends.266', { 0: name, 1: error?.message ?? error });
        if (name === 'local') throw error;
        if (!instances.has('local')) instances.set('local', MEMORY_BACKEND_REGISTRY.local({ ...options, queuePath: typeof options.queuePath === 'function' ? options.queuePath('local') : options.queuePath }));
        return instances.get('local');
      }
    }
    return instances.get(name);
  };
  if (!options.lazy) pick();
  return {
    get name() { return pick().name; },
    get enabled() { return pick().enabled; },
    get lastError() { const b = pick(); return pickError ?? b.lastError; },
    enqueue: (memory, who) => pick().enqueue(memory, who),
    revoke: memories => pick().revoke(memories),
    recall: (query, limit) => pick().recall(query, limit),
    flush: () => pick().flush(),
    status: () => pick().status(),
    pending: () => pick().pending(),
  };
}
