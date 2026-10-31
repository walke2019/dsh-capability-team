// External integrations (search gateway, embeddings) are per-user data, never code: the base URL, paths,
// headers, model, provider and optional request fields all come from configuration, and nothing assumes a
// particular gateway. Keys are never stored: the config names the environment variable that holds the key.
// Layers, highest first: environment variables › profile file (edited in the Overview) › plugin config › defaults.
import { crossSiteRequest } from './http-guard.js';
import { readFileSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { acquireLock, defaultRoot } from './theme.js';
export const INTEGRATION_DEFAULTS = Object.freeze({
  search: Object.freeze({ baseUrl: null, apiKeyEnv: 'CPA_SEARCH_API_KEY', searchPath: '/v1/search', fetchPath: '/v1/web/fetch', headers: {}, providers: [], fetchProviders: [], timeoutMs: 15000, fetchTimeoutMs: 30000 }),
  embeddings: Object.freeze({ baseUrl: null, apiKeyEnv: 'CPA_EMBED_API_KEY', path: '/v1/embeddings', headers: {}, model: null, provider: null, dimensions: null, queryTask: null, passageTask: null, timeoutMs: 15000, batch: 32 }),
});
/** Environment variables that override single fields (kept for existing setups). */
export const ENV_OVERRIDES = Object.freeze({
  search: { baseUrl: 'CPA_SEARCH_BASE_URL' },
  embeddings: { baseUrl: 'CPA_EMBED_BASE_URL', model: 'CPA_EMBED_MODEL', dimensions: 'CPA_EMBED_DIMENSIONS' },
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
    case 'searchPath': case 'fetchPath': case 'path':
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
    case 'timeoutMs': case 'fetchTimeoutMs': return integerIn(value, 1000, 120000, label, '须为 1000–120000 毫秒');
    case 'batch': return integerIn(value, 1, 256, label, '须为 1–256 的整数');
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
let pluginLayer = {};
/** The plugin config's `integrations` block (cordis.patch.yml), registered once by the routing plugin. */
export function setPluginIntegrations(value) { pluginLayer = validateIntegrations(value); }
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
      if (pluginLayer[section]?.[key] !== undefined) { value = pluginLayer[section][key]; source = 'plugin'; }
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
export const keyOf = (section, resolved, env = resolved.env ?? process.env) => env[resolved.effective[section].apiKeyEnv] || undefined;
/** Save the file layer (merge per field; null restores the lower layer) with an optimistic revision check. */
export async function saveIntegrations(patch, expectedRevision, { root = defaultRoot() } = {}) {
  const changes = validateIntegrations(patch);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('无效的配置版本');
  const path = integrationsPath(root);
  await mkdir(root, { recursive: true });
  const lock = await acquireLock(path + '.lock');
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const current = readFileLayer(root);
    if (current.revision !== expectedRevision) throw Object.assign(new Error('集成配置已变化，请刷新后重试'), { status: 409 });
    const next = structuredClone(current.value);
    for (const [section, fields] of Object.entries(patch ?? {})) {
      if (fields === null) { delete next[section]; continue; }
      next[section] ??= {};
      for (const [key, v] of Object.entries(fields)) { if (v === null) delete next[section][key]; else next[section][key] = changes[section][key]; }
      if (!Object.keys(next[section]).length) delete next[section];
    }
    const revision = current.revision + 1;
    await writeFile(temp, JSON.stringify({ revision, integrations: next }, null, 2) + '\n', { flag: 'wx' });
    await rename(temp, path);
    return { revision };
  } finally {
    await unlink(temp).catch(() => {});
    try { await lock.close(); } finally { await unlink(path + '.lock').catch(() => {}); }
  }
}
/** Safe view for the Overview: effective values, the layer each came from, and key presence (never key values). */
export function describeIntegrations(resolved) {
  return { schemaVersion: 1, revision: resolved.revision, effective: resolved.effective, sources: resolved.sources, keys: resolved.keys, file: resolved.fileLayer, envOverrides: ENV_OVERRIDES };
}
/** GET → described config; POST {expectedRevision, patch} → saved revision. Same-origin JSON only. */
export async function handleIntegrations(request, { root = defaultRoot(), env = process.env } = {}) {
  const fail = (status, code, message) => Response.json({ code, message }, { status });
  try {
    const url = new URL(request.url);
    if (request.method === 'GET') return Response.json(describeIntegrations(resolveIntegrations({ root, env })), { headers: { 'cache-control': 'no-store' } });
    if (request.method !== 'POST') return fail(400, 'BAD_REQUEST', 'Method not allowed');
    if (crossSiteRequest(request)) return fail(403, 'FORBIDDEN', 'Same-origin required');
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return fail(400, 'BAD_REQUEST', 'JSON required');
    const text = await request.text();
    if (text.length > 32768) return fail(400, 'BAD_REQUEST', 'Body too large');
    let body; try { body = JSON.parse(text); } catch { return fail(400, 'BAD_REQUEST', 'Invalid JSON'); }
    const saved = await saveIntegrations(body?.patch, body?.expectedRevision, { root });
    return Response.json({ schemaVersion: 1, ...saved }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return fail(error.status ?? 422, error.status === 409 ? 'CONFLICT' : 'INVALID', error.message); }
}
export const INTEGRATIONS_PATH = '/api/capability-team.integrations';
export function applyIntegrationsApi(ctx) {
  ctx.inject?.(['connection'], scoped => scoped.connection.fetch.register({ path: INTEGRATIONS_PATH, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: req => handleIntegrations(req) }));
}
