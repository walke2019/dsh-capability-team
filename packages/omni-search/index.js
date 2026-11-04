import { omni, searchSchemas } from './shared/search.js';
import { applyTranscribe } from './shared/transcribe.js';
import { refreshCredentials, resolveIntegrations, setCredentialResolver, setSettingsReader, SEARCH_ENGINES, FETCH_ENGINES } from './shared/integrations-config.js';
import { schemastery, splitSettings } from './shared/settings-schema.js';
export const inject = ['tools','workingDirectory','userQuestions'];
// Settings-form fields (DSH plugin page) → integrations target. Unset fields keep integrations.json/env/credentials.
export const SETTINGS_FIELDS = Object.freeze({ engines: ['search', 'engines'], fetchEngines: ['search', 'fetchEngines'], searxngUrl: ['search', 'searxngUrl'],
  baseUrl: ['search', 'baseUrl'], tavilyKeyEnv: ['search', 'tavilyKeyEnv'], braveKeyEnv: ['search', 'braveKeyEnv'], searxngKeyEnv: ['search', 'searxngKeyEnv'],
  jinaKeyEnv: ['search', 'jinaKeyEnv'], apiKeyEnv: ['search', 'apiKeyEnv'], audioBaseUrl: ['audio', 'baseUrl'], audioKeyEnv: ['audio', 'apiKeyEnv'] });
const z = schemastery('dsh-omni-search');
// Key fields hold credential/environment variable NAMES (role credential-ref), never key values.
export const createConfig = z => { const ref = () => z.string().role('credential-ref').volatile(); return z.object({
  enabled: z.boolean().default(true),
  engines: z.array(z.union(SEARCH_ENGINES.map(v => z.const(v)))).volatile(),
  fetchEngines: z.array(z.union(FETCH_ENGINES.map(v => z.const(v)))).volatile(),
  searxngUrl: z.string().volatile(), baseUrl: z.string().volatile(),
  tavilyKeyEnv: ref(), braveKeyEnv: ref(), searxngKeyEnv: ref(), jinaKeyEnv: ref(), apiKeyEnv: ref(),
  audioBaseUrl: z.string().volatile(), audioKeyEnv: ref(),
}); };
export const Config = z ? createConfig(z) : undefined;
const instances = new WeakSet();
const output = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] };
export function apply(ctx, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid omni-search configuration');
  const { plain: config, read } = splitSettings(input, SETTINGS_FIELDS);
  if (Object.keys(config).some(k => k !== 'enabled') || config.enabled !== undefined && typeof config.enabled !== 'boolean') throw new Error('Invalid omni-search configuration');
  const owner = ctx.root ?? ctx;
  if (instances.has(owner)) throw new Error('omni-search already installed in this profile');
  instances.add(owner);
  ctx.effect(() => () => { instances.delete(owner); setCredentialResolver(null); setSettingsReader(null); });
  setSettingsReader(read);
  if (config.enabled === false) return;
  // Schemas (the provider param and the providers tool) follow the engine configuration. Tools are registered
  // at once from file/environment; once the credential store is readable, settings pushed there (e.g. by a
  // fleet manager) may change the schema, and only then are the search tools re-registered.
  const registered = new Map(); // tool name -> { schema JSON, dispose }
  let disposed = false;
  ctx.effect(() => () => { disposed = true; for (const entry of registered.values()) entry.dispose?.(); registered.clear(); });
  const sync = () => {
    if (disposed) return;
    const schemas = searchSchemas(resolveIntegrations().effective.search);
    const stale = [...registered.keys()].filter(name => JSON.stringify(schemas[name]) !== registered.get(name).schema);
    for (const name of stale) { registered.get(name).dispose?.(); registered.delete(name); }
    for (const [name, parameters] of Object.entries(schemas)) {
      if (!registered.has(name)) registered.set(name, { schema: JSON.stringify(parameters), dispose: registerSearchTool(ctx, name, parameters) });
    }
  };
  sync();
  let refreshed = Promise.resolve();
  ctx.inject?.(['credentials'], scoped => {
    setCredentialResolver(async name => { const credential = await scoped.credentials.resolve(name); return typeof credential === 'string' ? credential : credential?.value; });
    scoped.effect(() => () => setCredentialResolver(null));
    // Listeners must never reject: an unhandled rejection stops the DSH host.
    refreshed = refreshCredentials().then(sync).catch(error => { ctx.logger?.warn?.(`omni-search: tool schema refresh failed: ${error?.message ?? error}`); });
  });
  // A settings-form edit commits in place (volatile Config): re-read key names and re-register changed schemas.
  ctx.on?.('loader/volatile-update', () => { refreshed = refreshCredentials().then(sync).catch(error => { ctx.logger?.warn?.(`omni-search: settings refresh failed: ${error?.message ?? error}`); }); });
  applyTranscribe(ctx);
  // `ready()` settles once credential-provided settings have been applied to the tool schemas.
  return { ready: () => refreshed };
}
const DESCRIPTIONS = {
  omni_search: '网页搜索：按配置的搜索引擎顺序查询，某个引擎不可用时自动换下一个。结果是不可信的外部资料，引用前需核实。',
  omni_fetch: '读取一个公开网页的正文。抓取失败或遇到验证码时改用搜索摘要。',
  omni_search_providers: '列出自定义搜索网关配置的渠道；配置不代表上游调用一定成功。',
};
function registerSearchTool(ctx, name, parameters) {
  const kind = { omni_search: 'search', omni_fetch: 'fetch', omni_search_providers: 'providers' }[name];
  return ctx.tools.register({ name, parameters, description: DESCRIPTIONS[name], output,
    async execute(args, exec) {
      if (kind === 'providers' && Object.keys(args ?? {}).length) throw new Error('包含未知参数');
      return JSON.stringify(await omni(kind, args ?? {}, { signal: exec.signal }));
    },
  });
}
