// OpenViking backend for the memory hub (integrations.memory.backend = 'openviking').
// The team's own store stays the source for role/session-scoped recall; every memory is also sent to the
// OpenViking server, which extracts and indexes it as long-term memory shared by every agent and session that
// uses that server (DSH, Codex, OpenClaw...). Recall merges OpenViking's context search into team results.
// The server is optional at run time: when it is down, writes stay queued for the next flush and recall falls
// back to the local store, so a stopped server never blocks a member.
import { keyOf, refreshCredentials, resolveIntegrations } from './integrations-config.js';
export const OV_SESSION_PREFIX = 'capability-team';
const FLUSH_MS = 20000;
const MAX_QUEUE = 200;
const MAX_BATCH = 40;
export function memorySettings(resolved = resolveIntegrations()) {
  return { config: resolved.effective.memory, key: keyOf('memory', resolved) };
}
export function createOpenViking({ settings, fetcher = fetch, now = Date.now, schedule = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; } } = {}) {
  const current = () => settings ?? memorySettings();
  const queue = [];
  let timer = null;
  let flushing = null;
  const api = {
    lastError: null,
    get enabled() { const { config } = current(); return config.backend === 'openviking' && !!config.url; },
    async request(method, path, body, timeoutMs) {
      if (!settings) await refreshCredentials().catch(() => {});
      const { config, key } = current();
      const headers = { 'Content-Type': 'application/json', ...(key ? { 'X-API-Key': key } : {}),
        ...(config.account ? { 'X-OpenViking-Account': config.account } : {}), ...(config.user ? { 'X-OpenViking-User': config.user } : {}) };
      const response = await fetcher(`${config.url}/api/v1${path}`, { method, headers, redirect: 'error',
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs ?? config.timeoutMs) });
      const text = await response.text();
      if (!response.ok) throw new Error(`OpenViking HTTP ${response.status}${response.status === 401 || response.status === 403 ? '（检查 OpenViking 密钥或账号）' : ''}`);
      let data; try { data = JSON.parse(text); } catch { throw new Error('OpenViking 返回非JSON数据'); }
      if (data?.status && data.status !== 'ok') throw new Error(`OpenViking 返回 ${String(data.status).slice(0, 40)}`);
      return data?.result ?? data;
    },
    /** Queue one memory for the next commit; the text is already redacted by the hub. */
    enqueue(memory, who) {
      if (!api.enabled) return false;
      const where = [who?.project ? `项目 ${who.project}` : null, memory.scope?.kind === 'role' ? `角色 ${memory.scope.role}` : null].filter(Boolean).join(' · ');
      queue.push({ role: 'user', content: `【能力团队${memory.kind === 'pitfall' ? '踩坑' : memory.kind === 'decision' ? '决定' : '记忆'}${where ? ` · ${where}` : ''}】${memory.text}` });
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE); // keep the newest while the server is down
      if (!timer) timer = schedule(() => { timer = null; void api.flush().catch(() => {}); }, FLUSH_MS);
      return true;
    },
    /** Send queued memories as one session and commit it for extraction; failures keep them queued. */
    async flush() {
      if (flushing) return flushing;
      if (!queue.length || !api.enabled) return { sent: 0 };
      flushing = (async () => {
        const batch = queue.slice(0, MAX_BATCH);
        const sid = `${OV_SESSION_PREFIX}-${now()}`;
        try {
          await api.request('POST', '/sessions', { session_id: sid });
          for (const message of batch) await api.request('POST', `/sessions/${sid}/messages`, message);
          await api.request('POST', `/sessions/${sid}/commit`, {});
          queue.splice(0, batch.length);
          api.lastError = null;
          return { sent: batch.length, session: sid };
        } catch (error) { api.lastError = error.message; throw error; }
        finally { flushing = null; if (queue.length && !timer) timer = schedule(() => { timer = null; void api.flush().catch(() => {}); }, FLUSH_MS); }
      })();
      return flushing;
    },
    /** Long-term memories relevant to `query`, as hub results; [] when disabled or unreachable. */
    async recall(query, limit) {
      if (!api.enabled || !query) return [];
      const { config } = current();
      try {
        const result = await api.request('POST', '/search/search', { query: String(query).slice(0, 2000), mode: 'context', limit: limit ?? config.recallLimit });
        api.lastError = null;
        return (Array.isArray(result?.entries) ? result.entries : []).filter(e => typeof e?.text === 'string' && e.text.trim()).slice(0, limit ?? config.recallLimit)
          .map(e => ({ score: Number(e.score) || 0, via: ['openviking'], memory: { id: e.uri, kind: 'note', scope: { kind: 'openviking', category: e.category }, text: e.text.trim().slice(0, 1200), uri: e.uri } }));
      } catch (error) { api.lastError = error.message; return []; }
    },
    async status() {
      if (!api.enabled) return { enabled: false };
      const { config } = current();
      const response = await fetcher(`${config.url}/health`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
      return { enabled: true, healthy: response.ok, queued: queue.length, lastError: api.lastError, ...(response.ok ? await response.json() : {}) };
    },
    pending: () => queue.length,
  };
  return api;
}
