// Search/fetch dispatcher: picks engines from integrations.search, falls over on availability failures and
// returns normalized results. Direct engine drivers live in search-engines.js; the `custom` engine is any
// gateway speaking the generic search/fetch/providers protocol, implemented here by `gateway`.
import { params } from './tool-schema.js';
import { INTEGRATION_DEFAULTS, SEARCH_ENGINES, SEARCH_KEY_FIELDS, engineKeyOf, keyOf, refreshCredentials, resolveIntegrations } from './integrations-config.js';
import { FETCH_DRIVERS, SEARCH_DRIVERS, engineError, httpError, readCapped, resultRow, withTimeout } from './search-engines.js';
export { STATUS_HINT, httpError } from './search-engines.js';
// Engine order, paths, headers and the provider lists are configuration (integrations.search), never code.
export function requestBody(kind, args, config = INTEGRATION_DEFAULTS.search) {
  const allowed = kind === 'search' ? ['query','max_results','search_type','provider'] : ['url','format','provider'];
  if (!args || Object.keys(args).some(key => !allowed.includes(key))) throw new Error('包含未知参数');
  const body = {};
  if (kind === 'search') {
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 4000) throw new Error('搜索词无效');
    body.query = args.query; body.max_results = args.max_results ?? 5; body.search_type = args.search_type ?? 'web';
    if (!Number.isInteger(body.max_results) || body.max_results < 1 || body.max_results > 20) throw new Error('条数须为1–20');
    if (!['web','news','code'].includes(body.search_type)) throw new Error('搜索类型无效');
  } else {
    const url = new URL(args.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|.*\.local$)/i.test(url.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)) throw new Error('仅允许公开 HTTP(S) 网页');
    body.url = url.href; body.format = args.format ?? 'markdown';
    if (!['markdown','html'].includes(body.format)) throw new Error('格式无效');
  }
  if (args.provider !== undefined) {
    const allowed = kind === 'search' ? config.providers : config.fetchProviders;
    // With a configured list only those providers pass; without one, any provider token goes to the gateway.
    if (typeof args.provider !== 'string' || !/^[\w.:-]{1,64}$/.test(args.provider) || (allowed.length && !allowed.includes(args.provider))) throw new Error('检索渠道无效');
    body.provider = args.provider;
  }
  return body;
}
/**
 * Gateway base from configuration; only a credential-free https origin (optional path prefix) is accepted.
 * `field`/`envName` name where the address comes from, for the error message.
 */
export function gatewayBase(raw, { what = '自定义搜索引擎', field = 'search.baseUrl', envName = 'OMNI_SEARCH_BASE_URL' } = {}) {
  if (!raw) throw new Error(`${what}未配置网关地址：在 integrations.json 配置 ${field}，或在 Host 环境设置 ${envName}`);
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${envName} 不是合法地址`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(`${envName} 必须是不含账号、查询参数的 https 地址`);
  return url.href.replace(/\/+$/, '');
}
/** Search/fetch config and every engine key as resolved now; tests and callers may pass them explicitly. */
export function searchSettings(resolved = resolveIntegrations()) {
  const keys = Object.fromEntries(Object.keys(SEARCH_KEY_FIELDS).map(engine => [engine, engineKeyOf(engine, resolved)]));
  return { config: resolved.effective.search, key: keyOf('search', resolved), keyEnv: resolved.keys.search.env, keys };
}
const engineKey = (settings, engine) => (engine === 'custom' ? settings.keys?.custom ?? settings.key : settings.keys?.[engine]);
/** Whether an engine has what it needs to be tried in auto mode (a key, or a URL for SearXNG / custom). */
export function engineConfigured(engine, settings) {
  const { config } = settings;
  if (engine === 'searxng') return !!config.searxngUrl;
  if (engine === 'custom') return !!config.baseUrl;
  return !!engineKey(settings, engine);
}
/** Ordered search engines: the configured list, or auto = every configured engine in default order. */
export function activeEngines(settings) {
  return settings.config.engines ?? SEARCH_ENGINES.filter(engine => engineConfigured(engine, settings));
}
/** Whether `custom` takes part in search (explicit list, or auto with a gateway address). */
export const customActive = config => (config.engines ? config.engines.includes('custom') : !!config.baseUrl);
const fetchEnginesOf = config => config.fetchEngines ?? INTEGRATION_DEFAULTS.search.fetchEngines;
/** A 200 still has to carry a real result: search needs a results list, fetch needs page content. */
export function checkResult(kind, data) {
  if (kind === 'search' && !Array.isArray(data?.results)) throw engineError('自定义网关返回 200 但没有 results 列表，未取得搜索结果');
  if (kind === 'fetch' && !(typeof data?.content === 'string' && data.content.trim())) throw engineError('自定义网关返回 200 但没有网页正文，请改用搜索摘要');
  if (kind === 'providers' && !Array.isArray(data?.data)) throw engineError('自定义网关返回 200 但没有渠道列表');
  return data;
}
/** The `custom` engine: one request to the configured gateway (search, fetch or providers), raw checked data. */
export async function gateway(kind, args, { fetcher = fetch, settings, key, base, signal } = {}) {
  if (!settings && key === undefined) await refreshCredentials();
  const current = settings ?? searchSettings();
  const config = { ...current.config, ...(base !== undefined ? { baseUrl: base } : {}) };
  const secret = key !== undefined ? key : engineKey(current, 'custom');
  const body = kind === 'providers' ? undefined : requestBody(kind, args, config);
  if (!secret) throw engineError(`自定义搜索引擎缺少密钥：在 DSH 设置中保存凭据 ${current.keyEnv ?? config.apiKeyEnv}，或在 Host 环境设置同名变量（名称由 integrations.json 的 apiKeyEnv 指定）`);
  const origin = gatewayBase(config.baseUrl);
  if (kind === 'providers' && !config.providersPath) throw new Error('未配置渠道查询路径 search.providersPath');
  const path = { search: config.searchPath, fetch: config.fetchPath, providers: config.providersPath }[kind];
  let response;
  try {
    response = await fetcher(`${origin}${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: withTimeout(signal, kind === 'fetch' ? config.fetchTimeoutMs : config.timeoutMs),
      headers: { ...config.headers, Authorization: `Bearer ${secret}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) { if (signal?.aborted) throw error; throw engineError(`自定义网关${error?.name === 'TimeoutError' ? '请求超时' : '网络错误'}`); }
  // Never echo error bodies: gateways may include secrets or upstream headers.
  if (!response.ok) throw httpError('自定义网关', response.status);
  const text = await readCapped(response, '自定义网关');
  if (text.includes(secret)) throw engineError('响应包含凭据，已阻止回传', false);
  let data;
  try { data = JSON.parse(text); } catch { throw engineError('自定义网关返回非JSON数据'); }
  return checkResult(kind, data);
}
const RESULT_SHAPE = { snippet: ['snippet', 'content', 'description'], published: ['published', 'published_date', 'publishedDate'] };
async function customSearch(body, { args, ...opts }) {
  const data = await gateway('search', args, opts);
  return data.results.map(row => resultRow(row, RESULT_SHAPE)).filter(Boolean).slice(0, body.max_results);
}
async function customFetch(body, { args, ...opts }) {
  const data = await gateway('fetch', args, opts);
  return { url: typeof data.url === 'string' && data.url ? data.url : body.url, ...(typeof data.title === 'string' && data.title.trim() ? { title: data.title.trim() } : {}), content: data.content };
}
// Run engines in order; only a retryable failure moves on. The final error lists each engine's (safe) reason.
async function failover(label, engines, attempt) {
  const reasons = [];
  for (const engine of engines) {
    try { return await attempt(engine); }
    catch (error) {
      if (error?.retryable !== true) throw error;
      reasons.push(`${engine}: ${error.message}`);
    }
  }
  throw new Error(`${label}全部引擎不可用：${reasons.join('；')}`);
}
const NO_ENGINE = '未配置搜索引擎：设置 TAVILY_API_KEY、BRAVE_API_KEY、SEARXNG_URL 之一，或配置自定义网关 OMNI_SEARCH_BASE_URL（也可在 integrations.json 的 search.engines 指定顺序）';
/**
 * Search, fetch or list custom providers. Search -> { engine, results }, fetch -> { engine, url, title?, content },
 * providers -> the custom gateway's raw list.
 */
export async function omni(kind, args, { fetcher = fetch, settings, signal } = {}) {
  if (!settings) await refreshCredentials();
  const current = settings ?? searchSettings();
  const { config } = current;
  if (kind === 'providers') {
    if (!customActive(config)) throw new Error('渠道列表只适用于自定义搜索引擎（search.engines 含 custom 或配置了 search.baseUrl）');
    return gateway('providers', args, { fetcher, settings: current, signal });
  }
  const body = requestBody(kind, args, config);
  const opts = key => ({ key, config, fetcher, signal, args, settings: current });
  if (kind === 'search') {
    const engines = activeEngines(current);
    if (args.provider !== undefined && !engines.includes('custom')) throw new Error('provider 参数只适用于自定义搜索引擎');
    if (!engines.length) throw new Error(NO_ENGINE);
    return failover('搜索', engines, async engine => {
      const driver = engine === 'custom' ? customSearch : SEARCH_DRIVERS[engine];
      return { engine, results: await driver(body, opts(engineKey(current, engine))) };
    });
  }
  const engines = fetchEnginesOf(config);
  if (args.provider !== undefined && !engines.includes('custom')) throw new Error('provider 参数只适用于自定义抓取引擎');
  return failover('网页抓取', engines, async engine => {
    const driver = engine === 'custom' ? customFetch : FETCH_DRIVERS[engine];
    return { engine, ...(await driver(body, opts(engineKey(current, engine)))) };
  });
}
/**
 * Tool schemas. `provider` exists only when the custom engine takes part; a configured provider list becomes
 * its enum. The providers tool needs the custom engine and a providersPath.
 */
export function searchSchemas(config = INTEGRATION_DEFAULTS.search) {
  const provider = list => (list.length ? { type: 'string', enum: list } : { type: 'string', description: '可选：自定义网关的渠道名，省略由网关自动选择' });
  const custom = customActive(config);
  return {
    omni_search: params({ query: { type: 'string', description: '搜索关键词' }, max_results: { type: 'integer', description: '结果数量，1–20' }, search_type: { type: 'string', enum: ['web','news','code'] },
      ...(custom ? { provider: provider(config.providers) } : {}) }, ['query']),
    omni_fetch: params({ url: { type: 'string', description: '公开网页URL，不含凭据' }, format: { type: 'string', enum: ['markdown','html'] },
      ...(fetchEnginesOf(config).includes('custom') ? { provider: provider(config.fetchProviders) } : {}) }, ['url']),
    ...(custom && config.providersPath ? { omni_search_providers: params({}, []) } : {}),
  };
}
export const schemas = searchSchemas();
