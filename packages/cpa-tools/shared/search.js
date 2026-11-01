import { params } from './tool-schema.js';
import { INTEGRATION_DEFAULTS, keyOf, refreshCredentials, resolveIntegrations } from './integrations-config.js';
/** What a gateway status means for the caller; error bodies are never echoed (they may carry upstream secrets). */
export const STATUS_HINT = { 400: '参数无效', 401: '客户端鉴权失败，检查密钥', 403: '被拒绝，检查密钥或网关要求的请求头', 404: '网关没有这个路径', 413: '内容超过网关上限', 429: '限流，请退避后重试', 502: '上游失败', 504: '上游超时' };
export const httpError = (label, status) => new Error(`${label} HTTP ${status}${STATUS_HINT[status] ? `（${STATUS_HINT[status]}）` : ''}`);
// Gateway, paths, headers and the provider lists are configuration (integrations.search), never code.
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
/** Gateway base from configuration; only a credential-free https origin (optional path prefix) is accepted. */
export function gatewayBase(raw) {
  if (!raw) throw new Error('聚合搜索未配置网关地址：在 integrations.json 配置 search.baseUrl，或在 Host 环境设置 CPA_SEARCH_BASE_URL');
  let url;
  try { url = new URL(raw); } catch { throw new Error('CPA_SEARCH_BASE_URL 不是合法地址'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('CPA_SEARCH_BASE_URL 必须是不含账号、查询参数的 https 地址');
  return url.href.replace(/\/+$/, '');
}
/** Search/fetch config and key as resolved now; tests and callers may pass them explicitly. */
export function searchSettings(resolved = resolveIntegrations()) {
  return { config: resolved.effective.search, key: keyOf('search', resolved), keyEnv: resolved.keys.search.env };
}
/** A 200 still has to carry a real result: search needs a results list, fetch needs page content. */
export function checkResult(kind, data) {
  if (kind === 'search' && !Array.isArray(data?.results)) throw new Error('聚合网关返回 200 但没有 results 列表，未取得搜索结果');
  if (kind === 'fetch' && !(typeof data?.content === 'string' && data.content.trim())) throw new Error('聚合网关返回 200 但没有网页正文，请改用搜索摘要');
  if (kind === 'providers' && !Array.isArray(data?.data)) throw new Error('聚合网关返回 200 但没有渠道列表');
  return data;
}
export async function gateway(kind, args, { fetcher = fetch, settings, key, base, signal } = {}) {
  if (!settings && key === undefined) await refreshCredentials();
  const current = settings ?? searchSettings();
  const config = { ...current.config, ...(base !== undefined ? { baseUrl: base } : {}) };
  const secret = key !== undefined ? key : current.key;
  const body = kind === 'providers' ? undefined : requestBody(kind, args, config);
  if (!secret) throw new Error(`聚合搜索缺少密钥：在 DSH 设置中保存凭据 ${current.keyEnv ?? 'CPA_SEARCH_API_KEY'}，或在 Host 环境设置同名变量（名称由 integrations.json 的 apiKeyEnv 指定）`);
  const origin = gatewayBase(config.baseUrl);
  if (kind === 'providers' && !config.providersPath) throw new Error('未配置渠道查询路径 search.providersPath');
  const timeout = AbortSignal.timeout(kind === 'fetch' ? config.fetchTimeoutMs : config.timeoutMs);
  const path = { search: config.searchPath, fetch: config.fetchPath, providers: config.providersPath }[kind];
  const response = await fetcher(`${origin}${path}`, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { ...config.headers, Authorization: `Bearer ${secret}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  // Never echo error bodies: gateways may include secrets or upstream headers.
  if (!response.ok) throw httpError('聚合网关', response.status);
  if (!response.body) throw new Error('聚合网关返回空响应');
  const reader = response.body.getReader(); const parts = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1024 * 1024) { await reader.cancel(); throw new Error('聚合搜索响应超过1MB'); } parts.push(value); }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(parts).toString('utf8');
  if (text.includes(secret)) throw new Error('响应包含凭据，已阻止回传');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('聚合网关返回非JSON数据'); }
  return checkResult(kind, data);
}
/** Tool schemas; a configured provider list becomes the enum, otherwise provider is a free name. */
export function searchSchemas(config = INTEGRATION_DEFAULTS.search) {
  const provider = list => (list.length ? { type: 'string', enum: list } : { type: 'string', description: '可选：网关支持的渠道名，省略由网关自动选择' });
  return {
    cpa_search: params({ query: { type: 'string', description: '搜索关键词' }, max_results: { type: 'integer', description: '结果数量，1–20' }, search_type: { type: 'string', enum: ['web','news','code'] }, provider: provider(config.providers) }, ['query']),
    cpa_web_fetch: params({ url: { type: 'string', description: '公开网页URL，不含凭据' }, format: { type: 'string', enum: ['markdown','html'] }, provider: provider(config.fetchProviders) }, ['url']),
    ...(config.providersPath ? { cpa_search_providers: params({}, []) } : {}),
  };
}
export const schemas = searchSchemas();
