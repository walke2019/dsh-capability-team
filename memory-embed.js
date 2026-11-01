// Embeddings for the memory hub over an OpenAI-compatible embeddings endpoint. Everything about the
// endpoint is configuration (integrations.embeddings): base URL, path, extra headers, model, and the optional
// provider / dimensions / task fields some gateways (e.g. a Jina-backed one) accept. Nothing is assumed.
// Any failure returns undefined: the hub then uses full-text search and embeds missing vectors later.
import { keyOf, refreshCredentials, resolveIntegrations } from './integrations-config.js';
const STATUS_HINT = { 400: '模型或参数不被接受', 401: '客户端鉴权失败，检查密钥', 403: '被拒绝（检查密钥或网关要求的请求头）', 404: '网关没有这个路径', 429: '限流，稍后重试', 502: '上游失败', 504: '上游超时' };
/** Embeddings config and key as resolved now. */
export function embedSettings(resolved = resolveIntegrations()) {
  return { config: resolved.effective.embeddings, key: keyOf('embeddings', resolved), keyEnv: resolved.keys.embeddings.env };
}
/** Vectors are only comparable within one model and dimension count; this tags them. */
export const vectorKey = config => `${config.model}@${config.dimensions ?? 'default'}`;
function missing(settings) {
  const { config, key, keyEnv } = settings;
  const gaps = [!config.baseUrl && 'embeddings.baseUrl', !config.model && 'embeddings.model', !key && `环境变量 ${keyEnv}`].filter(Boolean);
  return gaps.length ? `未配置嵌入：缺少 ${gaps.join('、')}（在团队总览“集成”页填写）` : null;
}
/**
 * `settings` is a function returning { config, key, keyEnv } (re-read on every call, so edits apply at once)
 * or a fixed object. `embed(texts, purpose)` takes purpose 'passage' (stored) or 'query' (searching).
 */
export function createEmbedder({ settings = embedSettings, fetcher = fetch } = {}) {
  const current = () => { try { return typeof settings === 'function' ? settings() : settings; } catch (error) { return { error: error.message }; } };
  let lastError = null;
  return {
    get available() { const s = current(); return !s.error && !missing(s); },
    get lastError() { const s = current(); return s.error ?? missing(s) ?? lastError; },
    get vectorKey() { const s = current(); return s.error || missing(s) ? null : vectorKey(s.config); },
    async embed(texts, purpose = 'passage') {
      if (settings === embedSettings) await refreshCredentials().catch(() => {});
      const s = current();
      if (s.error || missing(s) || !texts.length) return undefined;
      const { config, key } = s;
      const task = purpose === 'query' ? config.queryTask : config.passageTask;
      const vectors = [];
      for (let i = 0; i < texts.length; i += config.batch) {
        const input = texts.slice(i, i + config.batch);
        let response;
        try {
          response = await fetcher(`${config.baseUrl}${config.path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs),
            headers: { ...config.headers, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
            body: JSON.stringify({ model: config.model, input, ...(config.provider ? { provider: config.provider } : {}),
              ...(config.dimensions ? { dimensions: config.dimensions } : {}), ...(task ? { task } : {}) }) });
        } catch (error) { lastError = `嵌入请求失败：${error.message ?? error}`; return undefined; }
        if (!response.ok) { lastError = `嵌入接口返回 ${response.status}${STATUS_HINT[response.status] ? `（${STATUS_HINT[response.status]}）` : ''}`; return undefined; }
        let body;
        try { body = await response.json(); } catch { lastError = '嵌入接口返回的不是 JSON'; return undefined; }
        const rows = Array.isArray(body?.data) ? [...body.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
        // A 200 with a status page or route list instead of vectors is a failure, not a result.
        if (rows.length !== input.length || rows.some(r => !Array.isArray(r.embedding) || !r.embedding.length)) { lastError = '嵌入接口没有返回与输入条数一致的非空向量（检查 baseUrl 与 path）'; return undefined; }
        vectors.push(...rows.map(r => normalize(r.embedding)));
      }
      lastError = null;
      return { model: vectorKey(config), dimensions: vectors[0]?.length, vectors };
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
