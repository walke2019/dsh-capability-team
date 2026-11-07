// Fleet defaults: a manager (e.g. a Mothership hub) may push a default route through the DSH credential store.
// Unlocked, they only fill fields the user left at the built-in default, so local settings win and an open-source
// install without these credentials behaves exactly as before. Each field the manager LOCKED (managed manifest,
// contract F.3) beats the matching local field on its own. The manifest reader below is a compact copy of shared/managed-config.js
// (this package ships no shared/ closure); tests/autocomplete/fleet-defaults.test.mjs pins them to the same behavior.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from './schema.js';

const MANIFEST_KEY = 'mothership-connector/managed-config';
const REF = /^[A-Z][A-Z0-9_]{2,63}$/;
const FORCED_SECRET = /(_API_KEY|_KEY|_TOKEN|_SECRET|_PASSWORD)$/;
/**
 * The managed manifest (credential record first, then <DSH home>/aiwuk/managed-config.json) as `{revision, entries:
 * Map(ref → {locked, secret})}`, or null when nothing is managed. Never values; never throws.
 */
export async function managedManifest(credentials, { env = process.env, home = env.DSH_HOME || join(homedir(), '.dsh'), read = readFile } = {}) {
  const take = raw => {
    if (!raw || typeof raw !== 'object' || !Number.isSafeInteger(raw.revision) || raw.revision < 0 || !Array.isArray(raw.entries)) return null;
    const entries = new Map();
    for (const item of raw.entries.slice(0, 200)) {
      if (item && typeof item.ref === 'string' && REF.test(item.ref)) entries.set(item.ref, { locked: item.locked === true, secret: item.secret === true || FORCED_SECRET.test(item.ref) });
    }
    return { revision: raw.revision, entries };
  };
  try { const record = await credentials?.readRecord?.(MANIFEST_KEY); const found = record?.kind === 'grant' ? take(record.payload) : null; if (found) return found; } catch { /* fall through to the file */ }
  try { return take(JSON.parse(await read(join(home, 'aiwuk', 'managed-config.json'), 'utf8'))); } catch { return null; }
}
/** Locked refs of the managed manifest; never values. */
export async function lockedRefs(credentials, options) {
  const manifest = await managedManifest(credentials, options);
  return new Set([...(manifest?.entries ?? [])].filter(([, entry]) => entry.locked).map(([ref]) => ref));
}

/** Credential names a fleet manager writes. Plain values, not secrets: provider/model IDs, never API keys. */
export const FLEET_KEYS = Object.freeze({ routeMode: 'AUTOCOMPLETE_ROUTE_MODE', provider: 'AUTOCOMPLETE_PROVIDER', model: 'AUTOCOMPLETE_MODEL' });

const ID = /^[\w.@:/+-]{1,200}$/;

/** Validate raw credential values; invalid or partial fixed routes are dropped instead of guessed. */
export function parseFleetDefaults(raw) {
  const pick = key => (typeof raw?.[key] === 'string' ? raw[key].trim() : '');
  const provider = pick('provider'), model = pick('model');
  let routeMode = pick('routeMode');
  if (!routeMode && provider && model) routeMode = 'fixed';
  if (routeMode !== 'session' && routeMode !== 'fixed') return {};
  if (routeMode === 'session') return { routeMode };
  return ID.test(provider) && ID.test(model) ? { routeMode, provider, model } : {};
}

const LOCKABLE = Object.freeze({ routeMode: value => value === 'session' || value === 'fixed', provider: value => ID.test(value), model: value => ID.test(value) });
const usable = value => typeof value === 'string' && value.trim() !== '';

/**
 * Apply fleet defaults under the user's settings. Unlocked fleet values keep the "route is one unit" rule: once the
 * user picked a route mode or filled a provider/model of their own, the whole unlocked fleet route is ignored, so the
 * two never mix. Then every LOCKED field (`fleet.locked`: routeMode / provider / model, each with its managed value)
 * overrides the matching local field on its own. A fixed route that ends up without a provider AND a model fails safe
 * to the session route instead of calling an incomplete one.
 */
export function withFleetDefaults(config, fleet) {
  const { locked, ...route } = fleet ?? {};
  let next = config;
  if (route.routeMode) {
    const userChoseRoute = config.routeMode !== DEFAULT_CONFIG.routeMode || config.provider !== '' || config.model !== '';
    if (!userChoseRoute) next = { ...config, ...route };
  }
  const overrides = Object.entries(locked ?? {}).filter(([field, value]) => LOCKABLE[field]?.(value));
  if (!overrides.length) return next;
  next = { ...next, ...Object.fromEntries(overrides) };
  return next.routeMode === 'fixed' && !(usable(next.provider) && usable(next.model)) ? { ...next, routeMode: 'session' } : next;
}

/**
 * Read the fleet credentials once; never throws, absent store or values mean no fleet defaults. A locked ref reads
 * only the managed value stored by the connector (an environment variable of the same name is ignored) and is
 * returned under `locked` (field → value); the unlocked fields form the default route.
 */
export async function loadFleetDefaults(credentials, options) {
  if (typeof credentials?.resolve !== 'function') return {};
  const lockedSet = await lockedRefs(credentials, options);
  const raw = {}, lockedRaw = {};
  for (const [field, name] of Object.entries(FLEET_KEYS)) {
    try {
      const value = await credentials.resolve(name);
      const text = typeof value === 'string' ? value : value?.value;
      if (!lockedSet.has(name)) { raw[field] = text; continue; }
      if (value && typeof value === 'object' && value.source !== undefined && value.source !== 'file') continue;
      if (typeof text === 'string' && LOCKABLE[field](text.trim())) lockedRaw[field] = text.trim();
    } catch { /* missing credential: leave unset */ }
  }
  const route = parseFleetDefaults(raw);
  return Object.keys(lockedRaw).length ? { ...route, locked: lockedRaw } : route;
}
