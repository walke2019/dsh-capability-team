import { params } from './tool-schema.js';
const searchProviders = ['anysearch-search','serper-search','tavily-search','exa-search','jina-search','searchapi-search','linkup-search','youcom-search','firecrawl','duckduckgo-free'];
const fetchProviders = ['jina-reader','firecrawl','tavily-search'];
export function requestBody(kind, args) {
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
    if (!(kind === 'search' ? searchProviders : fetchProviders).includes(args.provider)) throw new Error('检索渠道无效');
    body.provider = args.provider;
  }
  return body;
}
/** Gateway origin from the Host environment; only a credential-free https origin (optional path prefix) is accepted. */
export function gatewayBase(raw = process.env.CPA_SEARCH_BASE_URL) {
  if (!raw) throw new Error('聚合搜索未配置 CPA_SEARCH_BASE_URL（网关地址，如 https://gateway.example.com）；请在 Host 环境设置并重启');
  let url;
  try { url = new URL(raw); } catch { throw new Error('CPA_SEARCH_BASE_URL 不是合法地址'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('CPA_SEARCH_BASE_URL 必须是不含账号、查询参数的 https 地址');
  return url.href.replace(/\/+$/, '');
}
export async function gateway(kind, args, { fetcher = fetch, key = process.env.CPA_SEARCH_API_KEY, base = process.env.CPA_SEARCH_BASE_URL, signal } = {}) {
  const body = requestBody(kind, args);
  if (!key) throw new Error('聚合搜索未配置 CPA_SEARCH_API_KEY；请在 Host 环境设置新密钥并重启');
  const origin = gatewayBase(base);
  const timeout = AbortSignal.timeout(kind === 'search' ? 15000 : 30000);
  const response = await fetcher(`${origin}/v1/${kind === 'search' ? 'search' : 'web/fetch'}`, {
    method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' }, body: JSON.stringify(body),
  });
  // Never echo error bodies: gateways may include secrets or upstream headers.
  if (!response.ok) throw new Error(`聚合网关 HTTP ${response.status}；抓取失败时请使用搜索摘要`);
  if (!response.body) throw new Error('聚合网关返回空响应');
  const reader = response.body.getReader(); const parts = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1024 * 1024) { await reader.cancel(); throw new Error('聚合搜索响应超过1MB'); } parts.push(value); }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(parts).toString('utf8');
  if (text.includes(key)) throw new Error('响应包含凭据，已阻止回传');
  try { return JSON.parse(text); } catch { throw new Error('聚合网关返回非JSON数据'); }
}
export const schemas = {
  cpa_search: params({ query: { type: 'string', description: '搜索关键词' }, max_results: { type: 'integer', description: '结果数量，1–20' }, search_type: { type: 'string', enum: ['web','news','code'] }, provider: { type: 'string', enum: searchProviders } }, ['query']),
  cpa_web_fetch: params({ url: { type: 'string', description: '公开网页URL，不含凭据' }, format: { type: 'string', enum: ['markdown','html'] }, provider: { type: 'string', enum: fetchProviders } }, ['url']),
};
