import { join } from 'node:path';
import { t } from './shared/i18n.js';
import { configuration, defaults } from './config.js';
import { createRuntime } from './runtime.js';
import { memoryService } from './tools.js';
import { createMemoryStore } from './shared/memory-store.js';
import { createEmbedder } from './shared/memory-embed.js';
import { createMemoryBackend } from './shared/memory-backends.js';
import { defaultRoot } from './shared/theme.js';
import { knownSecretValues, refreshCredentials, setSettingsReader, useCredentials, registerManagedConfigRoute, MEMORY_BACKENDS } from './shared/integrations-config.js';
import { liveValue, schemastery, splitSettings } from './shared/settings-schema.js';
// Settings-form fields (DSH plugin page) → integrations target. Unset fields keep integrations.json/env/credentials.
export const SETTINGS_FIELDS = Object.freeze({ embeddingBaseUrl: ['embeddings', 'baseUrl'], embeddingModel: ['embeddings', 'model'], embeddingKeyEnv: ['embeddings', 'apiKeyEnv'],
  memoryBackend: ['memory', 'backend'], memoryUrl: ['memory', 'url'], memoryKeyEnv: ['memory', 'apiKeyEnv'] });
// Runtime options that are volatile fields: their values arrive as live references and are read on every use.
export const LIVE_OPTIONS = Object.freeze(['autoRecall', 'injectChars', 'recallK', 'recallTimeoutMs', 'sharedRecall', 'sharedProjectFilter', 'syncWrites']);
const z = schemastery('@aiwuk/memory');
// cordis validates `Config` through Standard Schema; the plain options keep their defaults and configuration() checks.
// Key fields hold credential/environment variable NAMES (role credential-ref), never key values.
// Field descriptions per locale; the settings form shows the one matching the DSH language. `enabled` stays
// non-volatile on purpose: on/off is DSH's own plugin switch.
export const FIELD_TEXT = Object.freeze({
  'en-US': {
    autoRecall: 'Inject relevant memories into the prompt automatically.',
    injectChars: 'Maximum characters of recalled memory injected per request.',
    recallK: 'Number of memories recalled per request.',
    recallTimeoutMs: 'Give up recall after this many milliseconds.',
    sharedRecall: 'Also search the shared memory backend when recalling.',
    sharedProjectFilter: 'Shared recall scope: current project or the whole account (unset follows the deployment setting).',
    syncWrites: 'Mirror memory writes to the shared backend.',
    embeddingBaseUrl: 'Base URL of an OpenAI-compatible embeddings endpoint.',
    embeddingModel: 'Embedding model name.',
    embeddingKeyEnv: 'NAME of the DSH credential or environment variable that holds the embedding key (never the key itself).',
    memoryBackend: 'Where memories live: local only, or also an OpenViking server.',
    memoryUrl: 'OpenViking server URL.',
    memoryKeyEnv: 'NAME of the DSH credential or environment variable that holds the OpenViking key (never the key itself).',
  },
  'zh-CN': {
    autoRecall: '\u81ea\u52a8\u5c06\u76f8\u5173\u8bb0\u5fc6\u6ce8\u5165\u63d0\u793a\u8bcd\u3002',
    injectChars: '\u6bcf\u6b21\u8bf7\u6c42\u6ce8\u5165\u7684\u53ec\u56de\u8bb0\u5fc6\u5b57\u6570\u4e0a\u9650\u3002',
    recallK: '\u6bcf\u6b21\u8bf7\u6c42\u53ec\u56de\u7684\u8bb0\u5fc6\u6761\u6570\u3002',
    recallTimeoutMs: '\u53ec\u56de\u8d85\u8fc7\u8be5\u6beb\u79d2\u6570\u5373\u653e\u5f03\u3002',
    sharedRecall: '\u53ec\u56de\u65f6\u540c\u65f6\u641c\u7d22\u5171\u4eab\u8bb0\u5fc6\u540e\u7aef\u3002',
    sharedProjectFilter: '\u5171\u4eab\u53ec\u56de\u8303\u56f4\uff1a\u5f53\u524d\u9879\u76ee\u6216\u6574\u4e2a\u8d26\u6237\uff08\u7559\u7a7a\u8ddf\u968f\u90e8\u7f72\u8bbe\u7f6e\uff09\u3002',
    syncWrites: '\u5c06\u8bb0\u5fc6\u5199\u5165\u540c\u6b65\u5230\u5171\u4eab\u540e\u7aef\u3002',
    embeddingBaseUrl: '\u517c\u5bb9 OpenAI \u7684\u5411\u91cf\u63a5\u53e3\u57fa\u5740\u3002',
    embeddingModel: '\u5411\u91cf\u6a21\u578b\u540d\u79f0\u3002',
    embeddingKeyEnv: '\u4fdd\u5b58\u5411\u91cf\u670d\u52a1\u5bc6\u94a5\u7684 DSH \u51ed\u636e\u6216\u73af\u5883\u53d8\u91cf\u7684\u540d\u79f0\uff08\u4e0d\u586b\u5bc6\u94a5\u672c\u8eab\uff09\u3002',
    memoryBackend: '\u8bb0\u5fc6\u5b58\u50a8\u4f4d\u7f6e\uff1a\u4ec5\u672c\u5730\uff0c\u6216\u540c\u65f6\u4f7f\u7528 OpenViking \u670d\u52a1\u3002',
    memoryUrl: 'OpenViking \u670d\u52a1\u5730\u5740\u3002',
    memoryKeyEnv: '\u4fdd\u5b58 OpenViking \u5bc6\u94a5\u7684 DSH \u51ed\u636e\u6216\u73af\u5883\u53d8\u91cf\u7684\u540d\u79f0\uff08\u4e0d\u586b\u5bc6\u94a5\u672c\u8eab\uff09\u3002',
  },
});
// cordis validates `Config` through Standard Schema (`Config['~standard'].validate`); the plain options keep their
// defaults and configuration() checks. Key fields hold credential/environment variable NAMES (role credential-ref),
// never key values. Every field except `enabled` is volatile so the Plugins page exposes it.
export const createConfig = z => {
  const en = FIELD_TEXT['en-US'];
  const v = (schema, key) => schema.description(en[key]).volatile();
  const schema = z.object({
    enabled: z.boolean().default(true), autoRecall: v(z.boolean().default(true), 'autoRecall'),
    injectChars: v(z.natural().min(200).max(6000).default(2400), 'injectChars'), recallK: v(z.natural().min(1).max(20).default(6), 'recallK'),
    recallTimeoutMs: v(z.natural().min(100).max(10000).default(2000), 'recallTimeoutMs'), sharedRecall: v(z.boolean().default(true), 'sharedRecall'),
    sharedProjectFilter: v(z.union([z.const('current'), z.const('none'), z.const(null)]), 'sharedProjectFilter'), syncWrites: v(z.boolean().default(true), 'syncWrites'),
    embeddingBaseUrl: v(z.string(), 'embeddingBaseUrl'), embeddingModel: v(z.string(), 'embeddingModel'), embeddingKeyEnv: v(z.string().role('credential-ref'), 'embeddingKeyEnv'),
    memoryBackend: v(z.union(MEMORY_BACKENDS.map(v => z.const(v))), 'memoryBackend'), memoryUrl: v(z.string(), 'memoryUrl'), memoryKeyEnv: v(z.string().role('credential-ref'), 'memoryKeyEnv'),
  });
  return typeof schema.i18n === 'function' ? schema.i18n(FIELD_TEXT) : schema;
};
export const Config = z ? createConfig(z) : undefined;
export const inject = ['agents','systemPrompt','tools','workingDirectory','agentPresets'];
const instances = new WeakSet();
export function apply(ctx, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid configuration');
  const { plain, read } = splitSettings(input, SETTINGS_FIELDS);
  // Volatile runtime options (live references) stay out of the plain validation; plain values still validate.
  const live = Object.fromEntries(LIVE_OPTIONS.filter(key => typeof plain[key]?.get === 'function').map(key => [key, plain[key]]));
  for (const key of Object.keys(live)) delete plain[key];
  const base = configuration(Object.fromEntries(Object.entries(plain).filter(([, v]) => v !== undefined)));
  const config = Object.create(null, Object.fromEntries(Object.entries(base).map(([key, value]) => [key, { enumerable: true,
    get: () => (live[key] ? (liveValue(live[key]) ?? defaults[key]) : value) }])));
  const owner = ctx.root ?? ctx;
  if (instances.has(owner)) throw new Error('global-memory already installed in this profile');
  instances.add(owner);
  ctx.effect(() => () => { instances.delete(owner); useCredentials(null); setSettingsReader(null); });
  setSettingsReader(read);
  if (!config.enabled) return;
  registerManagedConfigRoute(ctx, 'memory');
  ctx.inject?.(['credentials'], scoped => {
    // Key names resolve through the credential store; the managed manifest (lock policy, no values) is read with it.
    useCredentials(scoped.credentials);
    scoped.effect(() => () => useCredentials(null));
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
  backend = createMemoryBackend({ lazy: true, label: t('memory.globalLabel'), schedule,
    queuePath: name => join(defaultRoot(), 'memory', `global-memory-${name}-queue.json`) });
  const secrets = async () => { await refreshCredentials().catch(() => {}); return knownSecretValues(); };
  return createRuntime(ctx, config, memoryService({ store, embedder, backend, secrets, config }), store);
}
