// External integrations (search engines, embeddings, speech, memory) are per-user data, never code: base URLs,
// paths, headers, models and engine order all come from configuration, and nothing assumes a particular vendor.
// Keys are never stored: the config names the environment variable (or DSH credential) that holds each key.
// Read-only layers: environment variables › user integrations.json › defaults. No HTTP/config writer.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultRoot } from './theme.js';
/** Search engines in their default (auto) order, and the page-fetch engines. */
export const SEARCH_ENGINES = Object.freeze(['tavily', 'brave', 'searxng', 'custom']);
export const FETCH_ENGINES = Object.freeze(['jina', 'tavily', 'custom']);
export const MEMORY_BACKENDS = Object.freeze(['local', 'openviking']);
export const INTEGRATION_DEFAULTS = Object.freeze({
  // engines: null = auto (every configured engine, in SEARCH_ENGINES order). baseUrl/apiKeyEnv/paths/providers
  // belong to the `custom` engine (any gateway speaking the generic search/fetch protocol). Custom gateways may
  // fall back across upstream providers, so a full answer can take up to two minutes.
  search: Object.freeze({ engines: null, fetchEngines: Object.freeze(['jina']), tavilyKeyEnv: 'TAVILY_API_KEY', braveKeyEnv: 'BRAVE_API_KEY', searxngUrl: null, searxngKeyEnv: 'SEARXNG_API_KEY', jinaKeyEnv: 'JINA_API_KEY',
    baseUrl: null, apiKeyEnv: 'OMNI_SEARCH_API_KEY', searchPath: '/v1/search', fetchPath: '/v1/web/fetch', providersPath: null, headers: {}, providers: [], fetchProviders: [], timeoutMs: 120000, fetchTimeoutMs: 120000,
    // Direct engines (tavily, brave, searxng, jina) answer fast; a short timeout keeps failover snappy.
    engineTimeoutMs: 30000 }),
  // Any OpenAI-compatible /v1/embeddings endpoint (OpenAI, Ollama, vLLM, Jina, a gateway...).
  embeddings: Object.freeze({ baseUrl: null, apiKeyEnv: 'EMBEDDING_API_KEY', path: '/v1/embeddings', headers: {}, model: null, provider: null, dimensions: null, queryTask: null, passageTask: null, timeoutMs: 15000, batch: 32 }),
  // Speech to text: multipart upload of a user-approved local file. maxBytes mirrors a typical gateway cap;
  // the gateway's own limit wins when it is lower (a 413 is reported, never retried).
  audio: Object.freeze({ baseUrl: null, apiKeyEnv: 'OMNI_AUDIO_API_KEY', path: '/v1/audio/transcriptions', statusPath: null, headers: {}, model: null, timeoutMs: 125000, maxBytes: 8388608 }),
  // Memory hub backend (one of MEMORY_BACKENDS): 'local' (team store only) or 'openviking' (also shared
  // long-term memory on that server). The OpenViking key is optional: a local dev-mode server needs none.
  memory: Object.freeze({ backend: 'local', url: null, apiKeyEnv: 'OPENVIKING_API_KEY', account: null, user: null, timeoutMs: 8000, recallLimit: 4 }),
});
/**
 * Names that override single fields. A list means primary first, then legacy fallbacks: a later name is
 * consulted only when every earlier one is unset. Each name is read from the DSH credential store first (a
 * fleet manager can push settings there) and from the environment second.
 */
export const ENV_OVERRIDES = Object.freeze({
  search: { baseUrl: 'OMNI_SEARCH_BASE_URL', searxngUrl: 'SEARXNG_URL', engines: 'OMNI_SEARCH_ENGINES', fetchEngines: 'OMNI_FETCH_ENGINES', providersPath: 'OMNI_SEARCH_PROVIDERS_PATH' },
  embeddings: { baseUrl: ['EMBEDDING_BASE_URL', 'CPA_EMBED_BASE_URL'], model: ['EMBEDDING_MODEL', 'CPA_EMBED_MODEL'], dimensions: ['EMBEDDING_DIMENSIONS', 'CPA_EMBED_DIMENSIONS'] },
  audio: { baseUrl: 'OMNI_AUDIO_BASE_URL' },
  memory: { url: 'OPENVIKING_URL', backend: 'MEMORY_BACKEND' },
});
/** Every override name (primary and legacy), e.g. for refreshing them from the credential store. */
export const overrideNames = () => [...new Set(Object.values(ENV_OVERRIDES).flatMap(fields => Object.values(fields).flat()))];
// List fields arrive as one comma-separated string from the environment or a credential.
const LIST_FIELDS = ['engines', 'fetchEngines'];
const overrideValue = (key, raw) => (LIST_FIELDS.includes(key) ? String(raw).split(',').map(v => v.trim()).filter(Boolean) : raw);
/** Legacy key names consulted when a section still uses its default key name and that one is unset. */
export const LEGACY_KEY_ENV = Object.freeze({ embeddings: Object.freeze({ EMBEDDING_API_KEY: 'CPA_EMBED_API_KEY' }) });
/** Per-engine key fields of integrations.search (the `custom` engine uses apiKeyEnv). */
export const SEARCH_KEY_FIELDS = Object.freeze({ tavily: 'tavilyKeyEnv', brave: 'braveKeyEnv', searxng: 'searxngKeyEnv', jina: 'jinaKeyEnv', custom: 'apiKeyEnv' });
const SECTIONS = Object.keys(INTEGRATION_DEFAULTS);
const KEY_FIELDS = ['apiKeyEnv', 'tavilyKeyEnv', 'braveKeyEnv', 'searxngKeyEnv', 'jinaKeyEnv'];
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const FORBIDDEN_HEADERS = ['authorization', 'cookie', 'host', 'content-length', 'content-type', 'proxy-authorization'];
const fail = (label, rule) => { throw new Error(`${label} ${rule}`); };
const integerIn = (value, min, max, label, rule) => { const n = Number(value); return Number.isSafeInteger(n) && n >= min && n <= max ? n : fail(label, rule); };
/** An https URL, or plain http only for a server on this machine; never with credentials, query or hash. */
export function localOrHttpsUrl(value, label) {
  let url; try { url = new URL(String(value)); } catch { fail(label, '不是合法地址'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) fail(label, '须为 https 地址（本机可用 http://127.0.0.1），不含账号和查询参数');
  return url.href.replace(/\/+$/, '');
}
const engineList = (value, allowed, label) => {
  if (!Array.isArray(value) || !value.length || value.some(v => !allowed.includes(v))) fail(label, `须为非空列表，取值 ${allowed.join(' / ')}`);
  return [...new Set(value)];
};
function validateField(section, key, value) {
  const label = `${section}.${key}`;
  if (value === null) return null;
  switch (key) {
    case 'engines': return engineList(value, SEARCH_ENGINES, label);
    case 'fetchEngines': return engineList(value, FETCH_ENGINES, label);
    case 'searxngUrl': return localOrHttpsUrl(value, label);
    case 'baseUrl': {
      let url; try { url = new URL(String(value)); } catch { fail(label, '不是合法地址'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail(label, '须为不含账号、查询参数的 https 地址');
      return url.href.replace(/\/+$/, '');
    }
    case 'tavilyKeyEnv': case 'braveKeyEnv': case 'searxngKeyEnv': case 'jinaKeyEnv':
    case 'apiKeyEnv': return /^[A-Z_][A-Z0-9_]{0,63}$/.test(value) ? value : fail(label, '须为环境变量名（大写字母、数字、下划线）');
    case 'searchPath': case 'fetchPath': case 'providersPath': case 'statusPath': case 'path':
      return typeof value === 'string' && /^\/[A-Za-z0-9._~\/-]{0,200}$/.test(value) && !value.includes('..') ? value : fail(label, '须为以 / 开头的路径');
    case 'headers': {
      if (typeof value !== 'object' || Array.isArray(value)) fail(label, '须为 {名称: 值} 对象');
      const out = {};
      for (const [name, v] of Object.entries(value)) {
        if (!HEADER_NAME.test(name) || FORBIDDEN_HEADERS.includes(name.toLowerCase())) fail(label, `不能设置请求头 ${name}（密钥通过 apiKeyEnv 注入）`);
        if (typeof v !== 'string' || v.length > 512 || /[\r\n]/.test(v)) fail(label, `请求头 ${name} 的值无效`);
        out[name] = v;
      }
      return out;
    }
    case 'providers': case 'fetchProviders':
      if (!Array.isArray(value) || value.length > 50 || value.some(v => typeof v !== 'string' || !/^[\w.:-]{1,64}$/.test(v))) fail(label, '须为渠道名列表');
      return [...new Set(value)];
    case 'model': case 'provider': case 'queryTask': case 'passageTask':
      return typeof value === 'string' && value.trim() && value.length <= 200 && !/\s/.test(value.trim()) ? value.trim() : fail(label, '须为不含空白的字符串');
    case 'dimensions': return integerIn(value, 1, 8192, label, '须为 1–8192 的整数');
    case 'timeoutMs': case 'fetchTimeoutMs': case 'engineTimeoutMs': return integerIn(value, 1000, 300000, label, '须为 1000–300000 毫秒');
    case 'batch': return integerIn(value, 1, 256, label, '须为 1–256 的整数');
    case 'maxBytes': return integerIn(value, 1024, 104857600, label, '须为 1024–104857600 字节');
    case 'backend': return MEMORY_BACKENDS.includes(value) ? value : fail(label, `须为 ${MEMORY_BACKENDS.join(' 或 ')}`);
    // Plain http is accepted only for a server on this machine; anything remote must use https.
    case 'url': return localOrHttpsUrl(value, label);
    case 'account': case 'user':
      return typeof value === 'string' && /^[\w.@-]{1,64}$/.test(value) ? value : fail(label, '须为 1–64 位字母、数字或 ._@-');
    case 'recallLimit': return integerIn(value, 0, 20, label, '须为 0–20 的整数');
    default: return fail(label, '不是支持的字段');
  }
}
/** Validate a partial config ({search?, embeddings?}); unknown sections or fields are rejected. */
export function validateIntegrations(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('integrations 须为对象');
  const out = {};
  for (const [section, fields] of Object.entries(value)) {
    if (!SECTIONS.includes(section)) throw new Error(`integrations 不支持 ${section}`);
    if (fields === null) continue;
    if (typeof fields !== 'object' || Array.isArray(fields)) throw new Error(`integrations.${section} 须为对象`);
    out[section] = {};
    for (const [key, v] of Object.entries(fields)) {
      if (!Object.hasOwn(INTEGRATION_DEFAULTS[section], key)) throw new Error(`integrations.${section}.${key} 不是支持的字段`);
      out[section][key] = validateField(section, key, v);
    }
  }
  return out;
}
export const integrationsPath = (root = defaultRoot()) => join(root, 'integrations.json');
function readFileLayer(root) {
  try { const raw = JSON.parse(readFileSync(integrationsPath(root), 'utf8')); return { revision: raw.revision ?? 0, value: validateIntegrations(raw.integrations) }; }
  catch (error) { if (error.code === 'ENOENT') return { revision: 0, value: {} }; throw new Error(`集成配置文件损坏：${error.message}`); }
}
/**
 * Effective config with the source of every field, plus whether each section's key is present.
 * Key values never leave this function except through `keyOf`.
 */
export function resolveIntegrations({ root = defaultRoot(), env = process.env } = {}) {
  const file = readFileLayer(root);
  const effective = {}, sources = {}, keys = {};
  // The credential store only backs the real process environment (tests pass their own env to isolate).
  const useStore = env === process.env;
  for (const section of SECTIONS) {
    effective[section] = {}; sources[section] = {};
    for (const key of Object.keys(INTEGRATION_DEFAULTS[section])) {
      // Primary name first (credential, then environment); a legacy name only when every earlier one is unset.
      let override;
      for (const name of [ENV_OVERRIDES[section][key] ?? []].flat()) {
        const stored = useStore ? credentialCache.get(name) : undefined;
        if (stored) { override = { raw: stored, source: `credential:${name}` }; break; }
        if (env[name]) { override = { raw: env[name], source: `env:${name}` }; break; }
      }
      let value = INTEGRATION_DEFAULTS[section][key], source = 'default';
      if (file.value[section]?.[key] !== undefined) { value = file.value[section][key]; source = 'file'; }
      if (override) {
        try { value = validateField(section, key, overrideValue(key, override.raw)); source = override.source; } catch { /* an invalid override is ignored, not trusted */ }
      }
      effective[section][key] = value; sources[section][key] = source;
    }
    keys[section] = { env: effective[section].apiKeyEnv, present: !!lookup(sectionKeyNames(section, effective[section]), env, false) };
  }
  keys.search.engines = Object.fromEntries(Object.entries(SEARCH_KEY_FIELDS).map(([engine, field]) => [engine, { env: effective.search[field], present: !!lookup([effective.search[field]], env, false) }]));
  const resolved = { revision: file.revision, effective, sources, keys, fileLayer: file.value };
  // The environment stays attached but non-enumerable, so a serialized view never carries it.
  Object.defineProperty(resolved, 'env', { value: env });
  return resolved;
}
/** Key names for a section's apiKeyEnv: the configured one, plus its legacy fallback while it is the default. */
function sectionKeyNames(section, config) {
  const name = config.apiKeyEnv, legacy = LEGACY_KEY_ENV[section]?.[name];
  return legacy && name === INTEGRATION_DEFAULTS[section].apiKeyEnv ? [name, legacy] : [name];
}
// Each name is tried in order, the DSH store before the environment for the same name.
function lookup(names, env, useStore = env === process.env) {
  for (const name of names) { const value = (useStore ? credentialCache.get(name) : undefined) || env[name]; if (value) return value; }
  return undefined;
}
/** The API key for a section, read from the credential/environment variable its config names. */
export const keyOf = (section, resolved, env = resolved.env ?? process.env) => lookup(sectionKeyNames(section, resolved.effective[section]), env);
/** The key of one search/fetch engine (tavily, brave, searxng, jina, custom); undefined when not set. */
export const engineKeyOf = (engine, resolved, env = resolved.env ?? process.env) => {
  if (engine === 'custom') return keyOf('search', resolved, env);
  const field = SEARCH_KEY_FIELDS[engine];
  return field ? lookup([resolved.effective.search[field]], env) : undefined;
};
/** Every key name the effective config can read (section keys, legacy fallbacks, search engine keys). */
export function keyNames(resolved) {
  const names = SECTIONS.flatMap(section => sectionKeyNames(section, resolved.effective[section]));
  for (const field of KEY_FIELDS) if (resolved.effective.search[field]) names.push(resolved.effective.search[field]);
  return [...new Set(names)];
}
// DSH's credential store (ctx.credentials, the keys saved in Settings) is consulted first, so every key name
// is a DSH credential reference and the process environment is the fallback.
// Values are cached in memory only, refreshed before each request, and only ever placed in a request header.
let credentialResolver;
const credentialCache = new Map();
export function setCredentialResolver(fn) { credentialResolver = fn; credentialCache.clear(); }
/**
 * Re-read every key name the config uses and every override name (ENV_OVERRIDES, legacy included) from the
 * DSH credential store (no-op without the store). Values stay in memory and are never logged.
 */
export async function refreshCredentials(resolved = resolveIntegrations()) {
  if (!credentialResolver) return;
  const resolver = credentialResolver;
  for (const name of new Set([...keyNames(resolved), ...overrideNames()])) {
    try {
      const credential = await resolver(name);
      const value = typeof credential === 'string' ? credential : credential?.value;
      if (value) credentialCache.set(name, value); else credentialCache.delete(name);
    } catch { credentialCache.delete(name); }
  }
}
/** Every configured key value (store and environment), only for redacting them out of stored text. */
export function knownSecretValues(resolved = resolveIntegrations()) {
  const env = resolved.env ?? process.env;
  return [...new Set(keyNames(resolved).map(name => lookup([name], env)).filter(Boolean))];
}
/** Whether each section's (and search engine's) key is configured (DSH store or environment), never the value. */
export async function keyPresence(resolved) {
  await refreshCredentials(resolved);
  const out = {};
  for (const section of SECTIONS) out[section] = { ...resolved.keys[section], present: !!keyOf(section, resolved) };
  out.search.engines = Object.fromEntries(Object.entries(SEARCH_KEY_FIELDS).map(([engine, field]) => [engine, { env: resolved.effective.search[field], present: !!engineKeyOf(engine, resolved) }]));
  return out;
}
/** Safe view for the Overview: effective values, the layer each came from, and key presence (never key values). */
export function describeIntegrations(resolved) {
  return { schemaVersion: 1, revision: resolved.revision, effective: resolved.effective, sources: resolved.sources, keys: resolved.keys, file: resolved.fileLayer, envOverrides: ENV_OVERRIDES };
}
