// External integrations (search engines, embeddings, speech, memory) are per-user data, never code: base URLs,
// paths, headers, models and engine order all come from configuration, and nothing assumes a particular vendor.
// Keys are never stored: the config names the environment variable (or DSH credential) that holds each key.
// Layers (contract F.3): a LOCKED managed ref (published by the Mothership connector) wins over everything local;
// otherwise bundle settings form › credentials › environment › user integrations.json › unlocked managed value ›
// defaults. Every resolved field reports its source: managed-locked | settings | credential | env | file |
// managed-default | default. Managed values are ordinary credentials; only the lock manifest is extra.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultRoot } from './theme.js';
import { message } from './integrations-messages.js';
import { pickLayer, sourceLabel } from './managed-resolve.js';
import { readManagedManifest } from './shared/managed-config.js';
/** Search engines in their default (auto) order, and the page-fetch engines. */
export const SEARCH_ENGINES = Object.freeze(['tavily', 'brave', 'searxng', 'custom']);
export const FETCH_ENGINES = Object.freeze(['jina', 'tavily', 'custom']);
export const MEMORY_BACKENDS = Object.freeze(['local', 'openviking']);
export const SHARED_RECALL_SCOPES = Object.freeze(['current', 'none']);
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
  // sharedRecall (one of SHARED_RECALL_SCOPES) is a deployment choice: 'current' keeps recall local because
  // shared backends carry no trusted project metadata; 'none' searches the whole shared account.
  memory: Object.freeze({ backend: 'local', url: null, apiKeyEnv: 'OPENVIKING_API_KEY', account: null, user: null, timeoutMs: 8000, recallLimit: 4, sharedRecall: 'current' }),
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
  memory: { url: 'OPENVIKING_URL', backend: 'MEMORY_BACKEND', sharedRecall: 'MEMORY_SHARED_RECALL' },
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
  let url; try { url = new URL(String(value)); } catch { fail(label, message('notUrl')); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) fail(label, message('localOrHttps'));
  return url.href.replace(/\/+$/, '');
}
const engineList = (value, allowed, label) => {
  if (!Array.isArray(value) || !value.length || value.some(v => !allowed.includes(v))) fail(label, message('engineList', { allowed: allowed.join(' / ') }));
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
      let url; try { url = new URL(String(value)); } catch { fail(label, message('notUrl')); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail(label, message('httpsOnly'));
      return url.href.replace(/\/+$/, '');
    }
    case 'tavilyKeyEnv': case 'braveKeyEnv': case 'searxngKeyEnv': case 'jinaKeyEnv':
    case 'apiKeyEnv': return /^[A-Z_][A-Z0-9_]{0,63}$/.test(value) ? value : fail(label, message('envName'));
    case 'searchPath': case 'fetchPath': case 'providersPath': case 'statusPath': case 'path':
      return typeof value === 'string' && /^\/[A-Za-z0-9._~\/-]{0,200}$/.test(value) && !value.includes('..') ? value : fail(label, message('path'));
    case 'headers': {
      if (typeof value !== 'object' || Array.isArray(value)) fail(label, message('headersObject'));
      const out = {};
      for (const [name, v] of Object.entries(value)) {
        if (!HEADER_NAME.test(name) || FORBIDDEN_HEADERS.includes(name.toLowerCase())) fail(label, message('headerForbidden', { name }));
        if (typeof v !== 'string' || v.length > 512 || /[\r\n]/.test(v)) fail(label, message('headerValue', { name }));
        out[name] = v;
      }
      return out;
    }
    case 'providers': case 'fetchProviders':
      if (!Array.isArray(value) || value.length > 50 || value.some(v => typeof v !== 'string' || !/^[\w.:-]{1,64}$/.test(v))) fail(label, message('providerList'));
      return [...new Set(value)];
    case 'model': case 'provider': case 'queryTask': case 'passageTask':
      return typeof value === 'string' && value.trim() && value.length <= 200 && !/\s/.test(value.trim()) ? value.trim() : fail(label, message('noWhitespace'));
    case 'dimensions': return integerIn(value, 1, 8192, label, message('intRange', { min: 1, max: 8192 }));
    case 'timeoutMs': case 'fetchTimeoutMs': case 'engineTimeoutMs': return integerIn(value, 1000, 300000, label, message('msRange', { min: 1000, max: 300000 }));
    case 'batch': return integerIn(value, 1, 256, label, message('intRange', { min: 1, max: 256 }));
    case 'maxBytes': return integerIn(value, 1024, 104857600, label, message('byteRange', { min: 1024, max: 104857600 }));
    case 'backend': return MEMORY_BACKENDS.includes(value) ? value : fail(label, message('oneOf', { values: MEMORY_BACKENDS.join(message('or')) }));
    // Plain http is accepted only for a server on this machine; anything remote must use https.
    case 'url': return localOrHttpsUrl(value, label);
    case 'account': case 'user':
      return typeof value === 'string' && /^[\w.@-]{1,64}$/.test(value) ? value : fail(label, message('accountName'));
    case 'recallLimit': return integerIn(value, 0, 20, label, message('intRange', { min: 0, max: 20 }));
    case 'sharedRecall': return SHARED_RECALL_SCOPES.includes(value) ? value : fail(label, message('oneOf', { values: SHARED_RECALL_SCOPES.join(message('or')) }));
    default: return fail(label, message('unsupportedField'));
  }
}
// Settings layer: the owning bundle's volatile DSH Config (settings-schema.js), read on every resolve.
let settingsReader = () => ({});
export function setSettingsReader(fn) { settingsReader = typeof fn === 'function' ? fn : () => ({}); }
function readSettings() { try { return settingsReader() ?? {}; } catch { return {}; } }
/** Validate a partial config ({search?, embeddings?}); unknown sections or fields are rejected. */
export function validateIntegrations(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(message('integrationsObject'));
  const out = {};
  for (const [section, fields] of Object.entries(value)) {
    if (!SECTIONS.includes(section)) throw new Error(message('integrationsSection', { section }));
    if (fields === null) continue;
    if (typeof fields !== 'object' || Array.isArray(fields)) throw new Error(message('integrationsSectionObject', { section }));
    out[section] = {};
    for (const [key, v] of Object.entries(fields)) {
      if (!Object.hasOwn(INTEGRATION_DEFAULTS[section], key)) throw new Error(`integrations.${section}.${key} ${message('unsupportedField')}`);
      out[section][key] = validateField(section, key, v);
    }
  }
  return out;
}
export const integrationsPath = (root = defaultRoot()) => join(root, 'integrations.json');
function readFileLayer(root) {
  try { const raw = JSON.parse(readFileSync(integrationsPath(root), 'utf8')); return { revision: raw.revision ?? 0, value: validateIntegrations(raw.integrations) }; }
  catch (error) { if (error.code === 'ENOENT') return { revision: 0, value: {} }; throw new Error(message('fileCorrupt', { reason: error.message })); }
}
/**
 * Effective config with the source of every field, plus whether each section's key is present.
 * Key values never leave this function except through `keyOf`.
 */
export function resolveIntegrations({ root = defaultRoot(), env = process.env, managed, credentials, settings: injectedSettings } = {}) {
  const file = readFileLayer(root);
  const effective = {}, sources = {}, keys = {}, locked = {};
  // The credential store only backs the real process environment (tests pass their own env, or their own store).
  const store = credentials ?? (env === process.env ? credentialCache : undefined);
  const manifest = managed === undefined ? (store ? managedManifest : null) : managed;
  const settings = injectedSettings ?? (store ? readSettings() : {});
  const entryOf = name => manifest?.entries?.get(name);
  for (const section of SECTIONS) {
    effective[section] = {}; sources[section] = {}; locked[section] = {};
    for (const key of Object.keys(INTEGRATION_DEFAULTS[section])) {
      const names = [ENV_OVERRIDES[section][key] ?? []].flat();
      const layer = pickLayer({
        names, entryOf,
        settings: () => settings[section]?.[key],
        credential: name => store?.get(name),
        env: name => env[name],
        file: file.value[section]?.[key],
        // A file value was validated when it was read; every other layer is validated here, and an invalid one is skipped.
        validate: (raw, kind) => (kind === 'file' ? raw : validateField(section, key, kind === 'settings' ? raw : overrideValue(key, raw))),
        fallback: INTEGRATION_DEFAULTS[section][key],
      });
      effective[section][key] = layer.value; sources[section][key] = sourceLabel(layer); locked[section][key] = layer.locked;
    }
    keys[section] = keyState(sectionKeyNames(section, effective[section]), env, store, manifest, effective[section].apiKeyEnv);
  }
  keys.search.engines = Object.fromEntries(Object.entries(SEARCH_KEY_FIELDS).map(([engine, field]) => [engine, keyState([effective.search[field]], env, store, manifest, effective.search[field])]));
  const resolved = { revision: file.revision, effective, sources, locked, keys, fileLayer: file.value };
  // The environment, store and manifest stay attached but non-enumerable, so a serialized view never carries them.
  for (const [name, value] of Object.entries({ env, store, managed: manifest })) Object.defineProperty(resolved, name, { value });
  return resolved;
}
/** Presence and source of a key (never its value): `{env: <name>, present, source, locked}`. */
function keyState(names, env, store, manifest, label) {
  const hit = findKey(names, env, store, manifest);
  return { env: label, present: !!hit, source: hit?.source ?? 'default', locked: names.some(name => manifest?.entries?.get(name)?.locked === true) };
}
/** Key names for a section's apiKeyEnv: the configured one, plus its legacy fallback while it is the default. */
function sectionKeyNames(section, config) {
  const name = config.apiKeyEnv, legacy = LEGACY_KEY_ENV[section]?.[name];
  return legacy && name === INTEGRATION_DEFAULTS[section].apiKeyEnv ? [name, legacy] : [name];
}
// Each name is tried in order. A locked managed name reads only the store (the managed value); an unlocked managed
// name lets a local environment value win over it; any other name reads the store before the environment.
function findKey(names, env, store, manifest) {
  for (const name of names) {
    const entry = manifest?.entries?.get(name), stored = store?.get(name), local = env[name];
    if (entry?.locked) { if (stored) return { value: stored, source: 'managed-locked' }; continue; }
    if (entry) { if (local) return { value: local, source: 'env' }; if (stored) return { value: stored, source: 'managed-default' }; continue; }
    if (stored) return { value: stored, source: 'credential' };
    if (local) return { value: local, source: 'env' };
  }
  return undefined;
}
const storeOf = (resolved, env) => (env === resolved.env ? resolved.store : env === process.env ? credentialCache : undefined);
const lookup = (names, resolved, env) => findKey(names, env, storeOf(resolved, env), resolved.managed)?.value;
/** The API key for a section, read from the credential/environment variable its config names. */
export const keyOf = (section, resolved, env = resolved.env ?? process.env) => lookup(sectionKeyNames(section, resolved.effective[section]), resolved, env);
/** The key of one search/fetch engine (tavily, brave, searxng, jina, custom); undefined when not set. */
export const engineKeyOf = (engine, resolved, env = resolved.env ?? process.env) => {
  if (engine === 'custom') return keyOf('search', resolved, env);
  const field = SEARCH_KEY_FIELDS[engine];
  return field ? lookup([resolved.effective.search[field]], resolved, env) : undefined;
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
// Managed manifest (lock policy only, never values): fed by an async reader the host plugin supplies (see
// shared/managed-config.js readManagedManifest) and re-read with the credentials.
let managedManifest = null, managedReader = null;
export function setManagedReader(fn) { managedReader = typeof fn === 'function' ? fn : null; if (!managedReader) managedManifest = null; }
/** Set the manifest directly (tests, or a host that already holds it). */
export function setManagedManifest(manifest) { managedManifest = manifest ?? null; }
export const managedManifestOf = () => managedManifest;
/**
 * Bind a DSH credential service (`ctx.credentials`): key names resolve through `resolve`, and the managed manifest is
 * read through `readRecord` (with the file fallback). Pass null to unbind. Replaces the two separate setters.
 */
let boundService = null;
export function useCredentials(service) {
  boundService = service || null;
  if (!service) { setCredentialResolver(null); setManagedReader(null); return; }
  setCredentialResolver(name => service.resolve(name));
  setManagedReader(() => readManagedManifest({ credentials: service }));
}
/** Unbind `service` only while it is still the bound one, so a late dispose never clears a later re-apply's binding. */
export function releaseCredentials(service) { if (boundService === service) useCredentials(null); }
export { resolveRef } from './managed-ref.js';
// Re-exported so the standalone bundles (memory, search) reach the route through their shared/ closure.
export { registerManagedConfigRoute } from './managed-config-route.js';
/**
 * Re-read every key name the config uses and every override name (ENV_OVERRIDES, legacy included) from the
 * DSH credential store (no-op without the store). Values stay in memory and are never logged.
 */
export async function refreshCredentials(resolved = resolveIntegrations()) {
  if (managedReader) { try { managedManifest = (await managedReader()) ?? null; } catch { managedManifest = null; } }
  if (!credentialResolver) return;
  const resolver = credentialResolver;
  for (const name of new Set([...keyNames(resolved), ...overrideNames(), ...(managedManifest?.entries?.keys() ?? [])])) {
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
  return [...new Set(keyNames(resolved).map(name => lookup([name], resolved, env)).filter(Boolean))];
}
/**
 * Whether each section's (and search engine's) key is configured (DSH store or environment), never the value.
 * Each entry also carries `source` (managed-locked | credential | env | managed-default | default) and `locked`.
 */
export async function keyPresence(resolved) {
  await refreshCredentials(resolved);
  const env = resolved.env ?? process.env, store = storeOf(resolved, env);
  const state = (names, label) => {
    const hit = findKey(names, env, store, resolved.managed);
    return { env: label, present: !!hit, source: hit?.source ?? 'default', locked: names.some(name => resolved.managed?.entries?.get(name)?.locked === true) };
  };
  const out = {};
  for (const section of SECTIONS) out[section] = state(sectionKeyNames(section, resolved.effective[section]), resolved.effective[section].apiKeyEnv);
  out.search.engines = Object.fromEntries(Object.entries(SEARCH_KEY_FIELDS).map(([engine, field]) => [engine, state([resolved.effective.search[field]], resolved.effective.search[field])]));
  return out;
}
/** Safe view for the Overview: effective values, the layer each came from, and key presence (never key values). */
export function describeIntegrations(resolved) {
  return { schemaVersion: 1, revision: resolved.revision, effective: resolved.effective, sources: resolved.sources, keys: resolved.keys, file: resolved.fileLayer, envOverrides: ENV_OVERRIDES };
}
