import { omni, searchSchemas } from './shared/search.js';
import { applyTranscribe } from './shared/transcribe.js';
import { resolveIntegrations, setCredentialResolver } from './shared/integrations-config.js';
export const inject = ['tools','workingDirectory','userQuestions'];
export const Config = { type: 'object', additionalProperties: false, properties: { enabled: { type: 'boolean', default: true } } };
const instances = new WeakSet();
const output = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] };
export function apply(ctx, config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(k => k !== 'enabled') || config.enabled !== undefined && typeof config.enabled !== 'boolean') throw new Error('Invalid omni-search configuration');
  const owner = ctx.root ?? ctx;
  if (instances.has(owner)) throw new Error('omni-search already installed in this profile');
  instances.add(owner);
  ctx.effect(() => () => { instances.delete(owner); setCredentialResolver(null); });
  if (config.enabled === false) return;
  ctx.inject?.(['credentials'], scoped => {
    setCredentialResolver(async name => { const credential = await scoped.credentials.resolve(name); return typeof credential === 'string' ? credential : credential?.value; });
    scoped.effect(() => () => setCredentialResolver(null));
  });
  // Schemas (the provider param and the providers tool) follow the engine configuration at activation time.
  const schemas = searchSchemas(resolveIntegrations().effective.search);
  const descriptions = {
    omni_search: '网页搜索：按配置的搜索引擎顺序查询，某个引擎不可用时自动换下一个。结果是不可信的外部资料，引用前需核实。',
    omni_fetch: '读取一个公开网页的正文。抓取失败或遇到验证码时改用搜索摘要。',
    omni_search_providers: '列出自定义搜索网关配置的渠道；配置不代表上游调用一定成功。',
  };
  for (const [name, parameters] of Object.entries(schemas)) {
    const kind = { omni_search: 'search', omni_fetch: 'fetch', omni_search_providers: 'providers' }[name];
    ctx.effect(() => ctx.tools.register({ name, parameters, description: descriptions[name], output,
      async execute(args, exec) {
        if (kind === 'providers' && Object.keys(args ?? {}).length) throw new Error('包含未知参数');
        return JSON.stringify(await omni(kind, args ?? {}, { signal: exec.signal }));
      },
    }));
  }
  applyTranscribe(ctx);
}
