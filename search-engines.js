// Direct search/fetch engine drivers (Tavily, Brave, SearXNG, Jina) plus the HTTP plumbing they share with the
// custom gateway driver in search.js. Every driver returns normalized data:
//   search -> [{ title, url, snippet, published? }]     fetch -> { url, title?, content }
// Errors carry `retryable`: availability failures (timeout, network, 401/403, 404, 429, 5xx, malformed 200)
// let the dispatcher fall over to the next engine; invalid input (400, 413, 422) does not.
// Upstream bodies are never echoed and a response that contains the key is blocked.
/** What an upstream status means for the caller; error bodies are never echoed (they may carry secrets). */
import { m } from './i18n.js';
export const STATUS_HINT = Object.fromEntries([400, 401, 403, 404, 413, 422, 429, 502, 504].map((status, index) => [status, m(`search-engines.${373 + index}`)]));
const NOT_RETRYABLE = new Set([400, 413, 422]);
export const RESPONSE_CAP = 1024 * 1024;
export function httpError(label, status) {
  const error = new Error(`${label} HTTP ${status}${STATUS_HINT[status] ? ` (${STATUS_HINT[status]})` : ''}`);
  error.status = status; error.retryable = !NOT_RETRYABLE.has(status) && (status >= 401);
  return error;
}
/** An error from an engine; `retryable` decides whether the dispatcher tries the next engine. */
export function engineError(message, retryable = true) { const error = new Error(message); error.retryable = retryable; return error; }
/** Read a response body as text with the 1MB cap. */
export async function readCapped(response, label) {
  if (!response.body) throw engineError(m('search-engines.382', { 0: label }));
  const reader = response.body.getReader(); const parts = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_CAP) { await reader.cancel(); throw engineError(m('search-engines.383', { 0: label })); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts).toString('utf8');
}
/** Combine the caller's abort signal with a per-request timeout. */
export const withTimeout = (signal, ms) => { const timeout = AbortSignal.timeout(ms); return signal ? AbortSignal.any([signal, timeout]) : timeout; };
/**
 * One JSON request: redirects are errors, the body is capped, a body echoing the key is blocked and an error
 * body is never read. A network failure or timeout is retryable unless the caller itself aborted.
 */
export async function requestJson(label, url, init, { fetcher = fetch, key, timeoutMs, signal } = {}) {
  let response;
  try { response = await fetcher(url, { ...init, redirect: 'error', signal: withTimeout(signal, timeoutMs) }); }
  catch (error) {
    if (signal?.aborted) throw error;
    throw engineError(`${label}: ${m(error?.name === 'TimeoutError' ? 'search-engines.384' : 'search-engines.385')}`);
  }
  if (!response.ok) throw httpError(label, response.status);
  const text = await readCapped(response, label);
  if (key && text.includes(key)) throw engineError(m('search-engines.386'), false);
  try { return JSON.parse(text); } catch { throw engineError(m('search-engines.387', { 0: label })); }
}
const clean = value => (typeof value === 'string' ? value.replace(/<[^>]{0,200}>/g, '').replace(/\s+/g, ' ').trim() : '');
/** Normalize one result row; rows without a URL are dropped. */
export function resultRow(row, { title = 'title', url = 'url', snippet = ['snippet', 'content', 'description'], published = [] } = {}) {
  if (!row || typeof row !== 'object' || typeof row[url] !== 'string' || !row[url]) return undefined;
  const out = { title: clean(row[title]) || row[url], url: row[url], snippet: clean(snippet.map(k => row[k]).find(v => typeof v === 'string' && v)) };
  const date = published.map(k => row[k]).find(v => typeof v === 'string' && v);
  if (date) out.published = date;
  return out;
}
const rows = (list, limit, shape) => {
  if (!Array.isArray(list)) return undefined;
  return list.map(row => resultRow(row, shape)).filter(Boolean).slice(0, limit);
};
const noResults = label => engineError(m('search-engines.388', { 0: label }));
const json = { 'Content-Type': 'application/json', Accept: 'application/json' };
export const TAVILY_ORIGIN = 'https://api.tavily.com';
export const BRAVE_ORIGIN = 'https://api.search.brave.com';
export const JINA_READER = 'https://r.jina.ai/';

/** Tavily search: POST /search with a Bearer key; news maps to topic "news". */
export async function tavilySearch(body, { key, config, fetcher, signal }) {
  if (!key) throw engineError(m('search-engines.389', { 0: config.tavilyKeyEnv }));
  const payload = { query: body.query, max_results: body.max_results, topic: body.search_type === 'news' ? 'news' : 'general', search_depth: 'basic' };
  const data = await requestJson('Tavily', `${TAVILY_ORIGIN}/search`, { method: 'POST', headers: { ...json, Authorization: `Bearer ${key}` }, body: JSON.stringify(payload) }, { fetcher, key, timeoutMs: config.engineTimeoutMs, signal });
  return rows(data?.results, body.max_results, { snippet: ['content'], published: ['published_date'] }) ?? Promise.reject(noResults('Tavily'));
}
/** Brave Search API: GET web search (news uses the news endpoint) with X-Subscription-Token. */
export async function braveSearch(body, { key, config, fetcher, signal }) {
  if (!key) throw engineError(m('search-engines.390', { 0: config.braveKeyEnv }));
  const news = body.search_type === 'news';
  const url = new URL(`${BRAVE_ORIGIN}/res/v1/${news ? 'news' : 'web'}/search`);
  url.searchParams.set('q', body.query); url.searchParams.set('count', String(Math.min(body.max_results, 20)));
  const data = await requestJson('Brave', url.href, { method: 'GET', headers: { Accept: 'application/json', 'X-Subscription-Token': key } }, { fetcher, key, timeoutMs: config.engineTimeoutMs, signal });
  // Brave omits the `web` block when a query has no hits; a reply of type "search" is still a valid answer.
  const list = news ? data?.results : data?.web?.results ?? (data?.type === 'search' ? [] : undefined);
  return rows(list, body.max_results, { snippet: ['description'], published: ['page_age', 'age'] }) ?? Promise.reject(noResults('Brave'));
}
/** SearXNG instance: GET {searxngUrl}/search?format=json; news and code map to the news / it categories. */
export async function searxngSearch(body, { key, config, fetcher, signal }) {
  if (!config.searxngUrl) throw engineError(m('search-engines.391'));
  const url = new URL(`${config.searxngUrl}/search`);
  url.searchParams.set('q', body.query); url.searchParams.set('format', 'json');
  const category = { news: 'news', code: 'it' }[body.search_type];
  if (category) url.searchParams.set('categories', category);
  const headers = { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  const data = await requestJson('SearXNG', url.href, { method: 'GET', headers }, { fetcher, key, timeoutMs: config.engineTimeoutMs, signal });
  return rows(data?.results, body.max_results, { snippet: ['content'], published: ['publishedDate'] }) ?? Promise.reject(noResults('SearXNG'));
}
const pageContent = (label, url, title, content) => {
  if (typeof content !== 'string' || !content.trim()) throw engineError(m('search-engines.392', { 0: label }));
  return { url, ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}), content };
};
/** Jina Reader: GET r.jina.ai/{url}; works without a key, an optional key raises the rate limit. */
export async function jinaFetch(body, { key, config, fetcher, signal }) {
  const headers = { Accept: 'application/json', 'X-Return-Format': body.format === 'html' ? 'html' : 'markdown', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  const data = await requestJson('Jina', `${JINA_READER}${body.url}`, { method: 'GET', headers }, { fetcher, key, timeoutMs: config.engineTimeoutMs, signal });
  const page = data?.data ?? data;
  return pageContent('Jina', page?.url || body.url, page?.title, page?.content ?? page?.html);
}
/** Tavily Extract: POST /extract for one URL. */
export async function tavilyFetch(body, { key, config, fetcher, signal }) {
  if (!key) throw engineError(m('search-engines.389', { 0: config.tavilyKeyEnv }));
  const payload = { urls: [body.url], format: body.format === 'html' ? 'text' : 'markdown' };
  const data = await requestJson('Tavily', `${TAVILY_ORIGIN}/extract`, { method: 'POST', headers: { ...json, Authorization: `Bearer ${key}` }, body: JSON.stringify(payload) }, { fetcher, key, timeoutMs: config.engineTimeoutMs, signal });
  const page = Array.isArray(data?.results) ? data.results[0] : undefined;
  return pageContent('Tavily', page?.url || body.url, page?.title, page?.raw_content);
}
export const SEARCH_DRIVERS = Object.freeze({ tavily: tavilySearch, brave: braveSearch, searxng: searxngSearch });
export const FETCH_DRIVERS = Object.freeze({ jina: jinaFetch, tavily: tavilyFetch });
