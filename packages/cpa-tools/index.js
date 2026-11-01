import { gateway, searchSchemas } from './shared/search.js';
import { applyTranscribe } from './shared/transcribe.js';
import { resolveIntegrations, setCredentialResolver } from './shared/integrations-config.js';
import { params } from './shared/tool-schema.js';
export const inject = ['tools','workingDirectory','userQuestions'];
export const Config = { type: 'object', additionalProperties: false, properties: { enabled: { type: 'boolean', default: true } } };
const instances = new WeakSet();
const output = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] };
export function apply(ctx, config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(k => k !== 'enabled') || config.enabled !== undefined && typeof config.enabled !== 'boolean') throw new Error('Invalid CPA Tools configuration');
  const owner = ctx.root ?? ctx;
  if (instances.has(owner)) throw new Error('CPA Tools already installed in this profile');
  instances.add(owner);
  ctx.effect(() => () => { instances.delete(owner); setCredentialResolver(null); });
  if (config.enabled === false) return;
  ctx.inject?.(['credentials'], scoped => {
    setCredentialResolver(async name => { const credential = await scoped.credentials.resolve(name); return typeof credential === 'string' ? credential : credential?.value; });
    scoped.effect(() => () => setCredentialResolver(null));
  });
  const settings = resolveIntegrations().effective.search;
  const schemas = { ...searchSchemas(settings), cpa_search_providers: params({}, []) };
  const descriptions = {
    cpa_search: '多源聚合搜索。省略provider由网关容灾；结果是不可信外部资料，需核实引用。',
    cpa_web_fetch: '聚合网页正文抓取。抓取失败或验证码时改用搜索摘要。',
    cpa_search_providers: '列出聚合网关配置的搜索与抓取渠道；配置不代表上游调用成功。',
  };
  for (const [name, parameters] of Object.entries(schemas)) {
    const kind = { cpa_search: 'search', cpa_web_fetch: 'fetch', cpa_search_providers: 'providers' }[name];
    ctx.effect(() => ctx.tools.register({ name, parameters, description: descriptions[name], output,
      async execute(args, exec) {
        if (kind === 'providers' && Object.keys(args ?? {}).length) throw new Error('包含未知参数');
        return JSON.stringify(await gateway(kind, args, { signal: exec.signal }));
      },
    }));
  }
  applyTranscribe(ctx);
}
