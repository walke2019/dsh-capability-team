// External integrations (search gateway, embeddings) are per-user data, never code: the base URL, paths,
// headers, model, provider and optional request fields all come from configuration, and nothing assumes a
// particular gateway. Keys are never stored: the config names the environment variable that holds the key.
// Read-only layers: environment variables › user integrations.json › defaults. No HTTP/config writer.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultRoot } from './theme.js';
export const INTEGRATION_DEFAULTS = Object.freeze({
  // Search gateways fall back across upstream providers, so a full answer can take up to two minutes.
  search: Object.freeze({ baseUrl: null, apiKeyEnv: 'CPA_SEARCH_API_KEY', searchPath: '/v1/search', fetchPath: '/v1/web/fetch', providersPath: null, headers: {}, providers: [], fetchProviders: [], timeoutMs: 120000, fetchTimeoutMs: 120000 }),
  embeddings: Object.freeze({ baseUrl: null, apiKeyEnv: 'CPA_EMBED_API_KEY', path: '/v1/embeddings', headers: {}, model: null, provider: null, dimensions: null, queryTask: null, passageTask: null, timeoutMs: 15000, batch: 32 }),
  // Speech to text: multipart upload of a user-approved local file. maxBytes mirrors the gateway's current cap;
  // the gateway's own limit wins when it is lower (a 413 is reported, never retried).
  audio: Object.freeze({ baseUrl: null, apiKeyEnv: 'CPA_AUDIO_API_KEY', path: '/v1/audio/transcriptions', statusPath: null, headers: {}, model: null, timeoutMs: 125000, maxBytes: 8388608 }),
  // Memory hub backend: 'local' (team store only) or 'openviking' (also shared long-term memory on that server).
  // The OpenViking key is optional: a local dev-mode server on 127.0.0.1 needs none.
  memory: Object.freeze({ backend: 'local', url: null, apiKeyEnv: 'OPENVIKING_API_KEY', account: null, user: null, timeoutMs: 8000, recallLimit: 4 }),
});
/** Environment variables that override single fields (kept for existing setups). */
export const ENV_OVERRIDES = Object.freeze({
  search: { baseUrl: 'CPA_SEARCH_BASE_URL' },
  embeddings: { baseUrl: 'CPA_EMBED_BASE_URL', model: 'CPA_EMBED_MODEL', dimensions: 'CPA_EMBED_DIMENSIONS' },
  audio: { baseUrl: 'CPA_AUDIO_BASE_URL' },
  memory: { url: 'OPENVIKING_URL' },
});
const SECTIONS = Object.keys(INTEGRATION_DEFAULTS);
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
const FORBIDDEN_HEADERS = ['authorization', 'cookie', 'host', 'content-length', 'content-type', 'proxy-authorization'];
const fail = (label, rule) => { throw new Error(`${label} ${rule}`); };
const integerIn = (value, min, max, label, rule) => { const n = Number(value); return Number.isSafeInteger(n) && n >= min && n <= max ? n : fail(label, rule); };
function validateField(section, key, value) {
  const label = `${section}.${key}`;
  if (value === null) return null;
  switch (key) {
    case 'baseUrl': {
      let url; try { url = new URL(String(value)); } catch { fail(label, '不是合法地址'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail(label, '须为不含账号、查询参数的 https 地址');
      return url.href.replace(/\/+$/, '');
    }
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
    case 'timeoutMs': case 'fetchTimeoutMs': return integerIn(value, 1000, 300000, label, '须为 1000–300000 毫秒');
    case 'batch': return integerIn(value, 1, 256, label, '须为 1–256 的整数');
    case 'maxBytes': return integerIn(value, 1024, 104857600, label, '须为 1024–104857600 字节');
    case 'backend': return ['local', 'openviking'].includes(value) ? value : fail(label, '须为 local 或 openviking');
    case 'url': {
      // Plain http is accepted only for a server on this machine; anything remote must use https.
      let url; try { url = new URL(String(value)); } catch { fail(label, '不是合法地址'); }
      const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) fail(label, '须为 https 地址（本机可用 http://127.0.0.1），不含账号和查询参数');
      return url.href.replace(/\/+$/, '');
    }
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
  for (const section of SECTIONS) {
    effective[section] = {}; sources[section] = {};
    for (const key of Object.keys(INTEGRATION_DEFAULTS[section])) {
      const envName = ENV_OVERRIDES[section][key];
      let value = INTEGRATION_DEFAULTS[section][key], source = 'default';
      if (file.value[section]?.[key] !== undefined) { value = file.value[section][key]; source = 'file'; }
      if (envName && env[envName]) {
        try { value = validateField(section, key, env[envName]); source = `env:${envName}`; } catch { /* an invalid env value is ignored, not trusted */ }
      }
      effective[section][key] = value; sources[section][key] = source;
    }
    keys[section] = { env: effective[section].apiKeyEnv, present: !!env[effective[section].apiKeyEnv] };
  }
  const resolved = { revision: file.revision, effective, sources, keys, fileLayer: file.value };
  // The environment stays attached but non-enumerable, so a serialized view never carries it.
  Object.defineProperty(resolved, 'env', { value: env });
  return resolved;
}
/** The API key for a section, read from the environment variable its config names. */
export const keyOf = (section, resolved, env = resolved.env ?? process.env) => {
  const name = resolved.effective[section].apiKeyEnv;
  return (env === process.env ? credentialCache.get(name) : undefined) || env[name] || undefined;
};
// DSH's credential store (ctx.credentials, the keys saved in Settings such as a provider's CPA_API_KEY) is
// consulted first, so `apiKeyEnv` names a DSH credential reference and the process environment is the fallback.
// Values are cached in memory only, refreshed before each request, and only ever placed in a request header.
let credentialResolver;
const credentialCache = new Map();
export function setCredentialResolver(fn) { credentialResolver = fn; credentialCache.clear(); }
/** Re-read the keys every section names from the DSH credential store (no-op without the store). */
export async function refreshCredentials(resolved = resolveIntegrations()) {
  if (!credentialResolver) return;
  for (const section of SECTIONS) {
    const name = resolved.effective[section].apiKeyEnv;
    try { const value = await credentialResolver(name); if (value) credentialCache.set(name, value); else credentialCache.delete(name); }
    catch { credentialCache.delete(name); }
  }
}
/** Every configured key value (store and environment), only for redacting them out of stored text. */
export function knownSecretValues(resolved = resolveIntegrations()) {
  return [...new Set(SECTIONS.map(section => keyOf(section, resolved)).filter(Boolean))];
}
/** Whether each section's key is configured (DSH store or environment), never the value. */
export async function keyPresence(resolved) {
  await refreshCredentials(resolved);
  const out = {};
  for (const section of SECTIONS) out[section] = { ...resolved.keys[section], present: !!keyOf(section, resolved) };
  return out;
}
/** Safe view for the Overview: effective values, the layer each came from, and key presence (never key values). */
export function describeIntegrations(resolved) {
  return { schemaVersion: 1, revision: resolved.revision, effective: resolved.effective, sources: resolved.sources, keys: resolved.keys, file: resolved.fileLayer, envOverrides: ENV_OVERRIDES };
}
