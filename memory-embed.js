import { m as modelText } from './i18n.js';
// Embeddings for the memory hub over an OpenAI-compatible embeddings endpoint. Everything about the
// endpoint is configuration (integrations.embeddings): base URL, path, extra headers, model, and the optional
// provider / dimensions / task fields some gateways (e.g. a Jina-backed one) accept. Nothing is assumed.
// Environment: EMBEDDING_BASE_URL / EMBEDDING_API_KEY / EMBEDDING_MODEL / EMBEDDING_DIMENSIONS (legacy
// CPA_EMBED_* names are still read when the standard ones are unset; see integrations-config.js).
// Any failure returns undefined: the hub then uses full-text search and embeds missing vectors later.
import { keyOf, refreshCredentials, resolveIntegrations } from './integrations-config.js';
const STATUS_HINT = { 400: modelText('memory-embed.267'), 401: modelText('memory-embed.268'), 403: modelText('memory-embed.269'), 404: modelText('memory-embed.270'), 429: modelText('memory-embed.271'), 502: modelText('memory-embed.272'), 504: modelText('memory-embed.273') };
/** Embeddings config and key as resolved now. */
export function embedSettings(resolved = resolveIntegrations()) {
  return { config: resolved.effective.embeddings, key: keyOf('embeddings', resolved), keyEnv: resolved.keys.embeddings.env };
}
/** Vectors are only comparable within one model and dimension count; this tags them. */
export const vectorKey = config => `${config.model}@${config.dimensions ?? 'default'}`;
function missing(settings) {
  const { config, key, keyEnv } = settings;
  const gaps = [!config.baseUrl && 'embeddings.baseUrl', !config.model && 'embeddings.model', !key && modelText('memory-embed.274', { 0: keyEnv })].filter(Boolean);
  return gaps.length ? modelText('memory-embed.275', { 0: gaps.join('、') }) : null;
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
        } catch (error) { lastError = modelText('memory-embed.276', { 0: error.message ?? error }); return undefined; }
        if (!response.ok) { lastError = modelText('memory-embed.277', { 0: response.status, 1: STATUS_HINT[response.status] ? `（${STATUS_HINT[response.status]}）` : '' }); return undefined; }
        let body;
        try { body = await response.json(); } catch { lastError = modelText('memory-embed.278'); return undefined; }
        const rows = Array.isArray(body?.data) ? [...body.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
        // A 200 with a status page or route list instead of vectors is a failure, not a result.
        if (rows.length !== input.length || rows.some(r => !Array.isArray(r.embedding) || !r.embedding.length)) { lastError = modelText('memory-embed.279'); return undefined; }
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
