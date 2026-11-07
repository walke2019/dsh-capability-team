import { m as modelText } from './i18n.js';
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
  if (!args || Object.keys(args).some(key => !allowed.includes(key))) throw new Error(modelText('search.394'));
  const body = {};
  if (kind === 'search') {
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 4000) throw new Error(modelText('search.395'));
    body.query = args.query; body.max_results = args.max_results ?? 5; body.search_type = args.search_type ?? 'web';
    if (!Number.isInteger(body.max_results) || body.max_results < 1 || body.max_results > 20) throw new Error(modelText('search.396'));
    if (!['web','news','code'].includes(body.search_type)) throw new Error(modelText('search.397'));
  } else {
    const url = new URL(args.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|.*\.local$)/i.test(url.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)) throw new Error(modelText('search.398'));
    body.url = url.href; body.format = args.format ?? 'markdown';
    if (!['markdown','html'].includes(body.format)) throw new Error(modelText('search.399'));
  }
  if (args.provider !== undefined) {
    const allowed = kind === 'search' ? config.providers : config.fetchProviders;
    // With a configured list only those providers pass; without one, any provider token goes to the gateway.
    if (typeof args.provider !== 'string' || !/^[\w.:-]{1,64}$/.test(args.provider) || (allowed.length && !allowed.includes(args.provider))) throw new Error(modelText('search.400'));
    body.provider = args.provider;
  }
  return body;
}
/**
 * Gateway base from configuration; only a credential-free https origin (optional path prefix) is accepted.
 * `field`/`envName` name where the address comes from, for the error message.
 */
export function gatewayBase(raw, { what = modelText('search.401'), field = 'search.baseUrl', envName = 'OMNI_SEARCH_BASE_URL' } = {}) {
  if (!raw) throw new Error(modelText('search.402', { 0: what, 1: field, 2: envName }));
  let url;
  try { url = new URL(raw); } catch { throw new Error(modelText('search.403', { 0: envName })); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(modelText('search.404', { 0: envName }));
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
  if (kind === 'search' && !Array.isArray(data?.results)) throw engineError(modelText('search.405'));
  if (kind === 'fetch' && !(typeof data?.content === 'string' && data.content.trim())) throw engineError(modelText('search.406'));
  if (kind === 'providers' && !Array.isArray(data?.data)) throw engineError(modelText('search.407'));
  return data;
}
/** The `custom` engine: one request to the configured gateway (search, fetch or providers), raw checked data. */
export async function gateway(kind, args, { fetcher = fetch, settings, key, base, signal } = {}) {
  if (!settings && key === undefined) await refreshCredentials();
  const current = settings ?? searchSettings();
  const config = { ...current.config, ...(base !== undefined ? { baseUrl: base } : {}) };
  const secret = key !== undefined ? key : engineKey(current, 'custom');
  const body = kind === 'providers' ? undefined : requestBody(kind, args, config);
  if (!secret) throw engineError(modelText('search.408', { 0: current.keyEnv ?? config.apiKeyEnv }));
  const origin = gatewayBase(config.baseUrl);
  if (kind === 'providers' && !config.providersPath) throw new Error(modelText('search.409'));
  const path = { search: config.searchPath, fetch: config.fetchPath, providers: config.providersPath }[kind];
  let response;
  try {
    response = await fetcher(`${origin}${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: withTimeout(signal, kind === 'fetch' ? config.fetchTimeoutMs : config.timeoutMs),
      headers: { ...config.headers, Authorization: `Bearer ${secret}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) { if (signal?.aborted) throw error; throw engineError(modelText('search.410', { 0: error?.name === 'TimeoutError' ? modelText('search.411') : modelText('search.412') })); }
  // Never echo error bodies: gateways may include secrets or upstream headers.
  if (!response.ok) throw httpError(modelText('search.413'), response.status);
  const text = await readCapped(response, modelText('search.414'));
  if (text.includes(secret)) throw engineError(modelText('search.415'), false);
  let data;
  try { data = JSON.parse(text); } catch { throw engineError(modelText('search.416')); }
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
  throw new Error(modelText('search.417', { 0: label, 1: reasons.join('；') }));
}
const NO_ENGINE = modelText('search.418');
/**
 * Search, fetch or list custom providers. Search -> { engine, results }, fetch -> { engine, url, title?, content },
 * providers -> the custom gateway's raw list.
 */
export async function omni(kind, args, { fetcher = fetch, settings, signal } = {}) {
  if (!settings) await refreshCredentials();
  const current = settings ?? searchSettings();
  const { config } = current;
  if (kind === 'providers') {
    if (!customActive(config)) throw new Error(modelText('search.419'));
    return gateway('providers', args, { fetcher, settings: current, signal });
  }
  const body = requestBody(kind, args, config);
  const opts = key => ({ key, config, fetcher, signal, args, settings: current });
  if (kind === 'search') {
    const engines = activeEngines(current);
    if (args.provider !== undefined && !engines.includes('custom')) throw new Error(modelText('search.420'));
    if (!engines.length) throw new Error(NO_ENGINE);
    return failover(modelText('search.421'), engines, async engine => {
      const driver = engine === 'custom' ? customSearch : SEARCH_DRIVERS[engine];
      return { engine, results: await driver(body, opts(engineKey(current, engine))) };
    });
  }
  const engines = fetchEnginesOf(config);
  if (args.provider !== undefined && !engines.includes('custom')) throw new Error(modelText('search.422'));
  return failover(modelText('search.423'), engines, async engine => {
    const driver = engine === 'custom' ? customFetch : FETCH_DRIVERS[engine];
    return { engine, ...(await driver(body, opts(engineKey(current, engine)))) };
  });
}
/**
 * Tool schemas. `provider` exists only when the custom engine takes part; a configured provider list becomes
 * its enum. The providers tool needs the custom engine and a providersPath.
 */
export function searchSchemas(config = INTEGRATION_DEFAULTS.search) {
  const provider = list => (list.length ? { type: 'string', enum: list } : { type: 'string', description: modelText('search.424') });
  const custom = customActive(config);
  return {
    omni_search: params({ query: { type: 'string', description: modelText('search.425') }, max_results: { type: 'integer', description: modelText('search.426') }, search_type: { type: 'string', enum: ['web','news','code'] },
      ...(custom ? { provider: provider(config.providers) } : {}) }, ['query']),
    omni_fetch: params({ url: { type: 'string', description: modelText('search.427') }, format: { type: 'string', enum: ['markdown','html'] },
      ...(fetchEnginesOf(config).includes('custom') ? { provider: provider(config.fetchProviders) } : {}) }, ['url']),
    ...(custom && config.providersPath ? { omni_search_providers: params({}, []) } : {}),
  };
}
export const schemas = searchSchemas();
