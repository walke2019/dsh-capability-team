// Embeddings for the memory hub, through the CPA gateway's OpenAI-compatible /v1/embeddings route
// (Jina jina-embeddings-v3 behind it). The gateway is the same one that serves /v1/search, so the base and
// key default to the search settings. Any failure returns undefined: the hub then falls back to full-text
// search and embeds missing vectors on a later write or search.
export const EMBED_DEFAULTS = { provider: 'jina', model: 'jina-embeddings-v3', dimensions: 512, timeoutMs: 15000, batch: 32 };
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const STATUS_HINT = { 400: '模型或参数不被接受', 401: 'CPA 客户端密钥无效', 404: '网关尚未提供 /v1/embeddings', 429: '限流，稍后重试', 502: '上游故障', 504: '上游超时' };
export function embedConfig(env = process.env) {
  // The gateway origin also serves /v1/search; CPA_BASE_URL (…/provider-a/v1) shares that origin on a default setup.
  const raw = env.CPA_EMBED_BASE_URL ?? env.CPA_SEARCH_BASE_URL ?? env.CPA_BASE_URL;
  const key = env.CPA_EMBED_API_KEY ?? env.CPA_SEARCH_API_KEY ?? env.CPA_API_KEY;
  if (!raw || !key) return undefined;
  let url;
  try { url = new URL(raw); } catch { return undefined; }
  if (url.protocol !== 'https:' || url.username || url.password) return undefined;
  return { endpoint: `${url.origin}/v1/embeddings`, key, model: env.CPA_EMBED_MODEL ?? EMBED_DEFAULTS.model,
    dimensions: Number(env.CPA_EMBED_DIMENSIONS ?? EMBED_DEFAULTS.dimensions) || EMBED_DEFAULTS.dimensions };
}
/**
 * Embed texts; `task` is Jina's retrieval.passage (stored memories) or retrieval.query (searches).
 * Returns { model, dimensions, vectors } or undefined when embeddings are unavailable.
 */
export function createEmbedder({ config = embedConfig(), fetcher = fetch, timeoutMs = EMBED_DEFAULTS.timeoutMs } = {}) {
  let lastError = config ? null : '未配置嵌入网关（CPA_EMBED_BASE_URL / CPA_SEARCH_BASE_URL / CPA_BASE_URL，以及对应密钥）';
  return {
    get available() { return !!config; },
    get lastError() { return lastError; },
    async embed(texts, task = 'retrieval.passage') {
      if (!config || !texts.length) return undefined;
      const vectors = [];
      for (let i = 0; i < texts.length; i += EMBED_DEFAULTS.batch) {
        const input = texts.slice(i, i + EMBED_DEFAULTS.batch);
        let response;
        try {
          response = await fetcher(config.endpoint, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
            // The gateway asks for a browser User-Agent to get past its WAF.
            headers: { authorization: `Bearer ${config.key}`, 'content-type': 'application/json', 'user-agent': USER_AGENT },
            body: JSON.stringify({ provider: EMBED_DEFAULTS.provider, model: config.model, input, dimensions: config.dimensions, task }) });
        } catch (error) { lastError = `嵌入请求失败：${error.message ?? error}`; return undefined; }
        if (!response.ok) { lastError = `嵌入网关返回 ${response.status}${STATUS_HINT[response.status] ? `（${STATUS_HINT[response.status]}）` : ''}`; return undefined; }
        let body;
        try { body = await response.json(); } catch { lastError = '嵌入网关返回的不是 JSON'; return undefined; }
        // The gateway answers unknown paths with 200 and its route list; that means the route is not deployed yet.
        if (Array.isArray(body?.available_routes)) { lastError = `嵌入网关尚未提供 /v1/embeddings（现有路由：${body.available_routes.join(' ')}）`; return undefined; }
        const rows = Array.isArray(body?.data) ? [...body.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
        if (rows.length !== input.length || rows.some(r => !Array.isArray(r.embedding) || !r.embedding.length)) { lastError = '嵌入网关没有返回与输入条数一致的非空向量'; return undefined; }
        vectors.push(...rows.map(r => normalize(r.embedding)));
      }
      lastError = null;
      return { model: config.model, dimensions: vectors[0]?.length ?? config.dimensions, vectors };
    },
  };
}
export function normalize(v) {
  let n = 0; for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map(x => x / n);
}
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return undefined;
  let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
