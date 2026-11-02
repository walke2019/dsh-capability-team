import { join } from 'node:path';
import { configuration } from './config.js';
import { createRuntime } from './runtime.js';
import { memoryService } from './tools.js';
import { createMemoryStore } from './shared/memory-store.js';
import { createEmbedder } from './shared/memory-embed.js';
import { createMemoryBackend } from './shared/memory-backends.js';
import { defaultRoot } from './shared/theme.js';
import { setCredentialResolver, knownSecretValues, refreshCredentials } from './shared/integrations-config.js';
// No `Config` export: cordis validates an exported Config through Standard Schema (`Config['~standard']`), and the
// plain JSON-Schema object in config.js would make every load fail. `configuration()` validates the input instead.
export const inject = ['agents','systemPrompt','tools','workingDirectory','agentPresets'];
const instances = new WeakSet();
export function apply(ctx, input = {}) {
  const config = configuration(input);
  const owner = ctx.root ?? ctx;
  if (instances.has(owner)) throw new Error('global-memory already installed in this profile');
  instances.add(owner);
  ctx.effect(() => () => { instances.delete(owner); setCredentialResolver(null); });
  if (!config.enabled) return;
  ctx.inject?.(['credentials'], scoped => {
    setCredentialResolver(name => scoped.credentials.resolve(name));
    scoped.effect(() => () => setCredentialResolver(null));
    // Settings pushed to the credential store (EMBEDDING_*, MEMORY_BACKEND, OPENVIKING_URL...) apply at once.
    void refreshCredentials().catch(() => {});
  });
  ctx.inject?.(['agentTeams'], () => {});
  const store = createMemoryStore(defaultRoot());
  const embedder = createEmbedder();
  // Do not recover/schedule a remote queue merely because a team-only profile loads us.
  let backend, stopped = false;
  const timers = new Set();
  ctx.effect(() => () => { stopped = true; for (const timer of timers) clearTimeout(timer); timers.clear(); });
  const schedule = (fn, ms) => {
    if (stopped) return null;
    const timer = setTimeout(() => { timers.delete(timer); if (!stopped) fn(); }, ms);
    timer.unref?.(); timers.add(timer); return timer;
  };
  // The selected backend is created on first use; each backend keeps its own queue file for this package.
  backend = createMemoryBackend({ lazy: true, label: '全局记忆', schedule,
    queuePath: name => join(defaultRoot(), 'memory', `global-memory-${name}-queue.json`) });
  const secrets = async () => { await refreshCredentials().catch(() => {}); return knownSecretValues(); };
  return createRuntime(ctx, config, memoryService({ store, embedder, backend, secrets, config }), store);
}
