import { join } from 'node:path';
import { configuration } from './config.js';
import { createRuntime } from './runtime.js';
import { memoryService } from './tools.js';
import { createMemoryStore } from './shared/memory-store.js';
import { createEmbedder } from './shared/memory-embed.js';
import { createMemoryBackend } from './shared/memory-backends.js';
import { defaultRoot } from './shared/theme.js';
import { setCredentialResolver, knownSecretValues, refreshCredentials, setSettingsReader, MEMORY_BACKENDS } from './shared/integrations-config.js';
import { schemastery, splitSettings } from './shared/settings-schema.js';
// Settings-form fields (DSH plugin page) → integrations target. Unset fields keep integrations.json/env/credentials.
export const SETTINGS_FIELDS = Object.freeze({ embeddingBaseUrl: ['embeddings', 'baseUrl'], embeddingModel: ['embeddings', 'model'], embeddingKeyEnv: ['embeddings', 'apiKeyEnv'],
  memoryBackend: ['memory', 'backend'], memoryUrl: ['memory', 'url'], memoryKeyEnv: ['memory', 'apiKeyEnv'] });
const z = schemastery('dsh-capability-memory');
// cordis validates `Config` through Standard Schema; the plain options keep their defaults and configuration() checks.
// Key fields hold credential/environment variable NAMES (role credential-ref), never key values.
export const createConfig = z => z.object({
  enabled: z.boolean().default(true), autoRecall: z.boolean().default(true),
  injectChars: z.natural().min(200).max(6000).default(2400), recallK: z.natural().min(1).max(20).default(6),
  recallTimeoutMs: z.natural().min(100).max(10000).default(2000), sharedRecall: z.boolean().default(true),
  sharedProjectFilter: z.union([z.const('current'), z.const('none'), z.const(null)]), syncWrites: z.boolean().default(true),
  embeddingBaseUrl: z.string().volatile(), embeddingModel: z.string().volatile(), embeddingKeyEnv: z.string().role('credential-ref').volatile(),
  memoryBackend: z.union(MEMORY_BACKENDS.map(v => z.const(v))).volatile(), memoryUrl: z.string().volatile(), memoryKeyEnv: z.string().role('credential-ref').volatile(),
});
export const Config = z ? createConfig(z) : undefined;
export const inject = ['agents','systemPrompt','tools','workingDirectory','agentPresets'];
const instances = new WeakSet();
export function apply(ctx, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid configuration');
  const { plain, read } = splitSettings(input, SETTINGS_FIELDS);
  const config = configuration(Object.fromEntries(Object.entries(plain).filter(([, v]) => v !== undefined)));
  const owner = ctx.root ?? ctx;
  if (instances.has(owner)) throw new Error('global-memory already installed in this profile');
  instances.add(owner);
  ctx.effect(() => () => { instances.delete(owner); setCredentialResolver(null); setSettingsReader(null); });
  setSettingsReader(read);
  if (!config.enabled) return;
  ctx.inject?.(['credentials'], scoped => {
    setCredentialResolver(name => scoped.credentials.resolve(name));
    scoped.effect(() => () => setCredentialResolver(null));
    // Settings pushed to the credential store (EMBEDDING_*, MEMORY_BACKEND, OPENVIKING_URL...) apply at once.
    void refreshCredentials().catch(() => {});
  });
  // A settings-form edit commits in place (volatile Config): re-read the key names it may have changed.
  ctx.on?.('loader/volatile-update', () => { void refreshCredentials().catch(() => {}); });
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
