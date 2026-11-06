// Fleet defaults: a manager (e.g. a Mothership hub) may push a default route through the DSH credential store.
// Unlocked, they only fill fields the user left at the built-in default, so local settings win and an open-source
// install without these credentials behaves exactly as before. A route the manager LOCKED (managed manifest, contract
// F.3) beats local settings as one unit. The manifest reader below is a compact copy of shared/managed-config.js
// (this package ships no shared/ closure); tests/autocomplete/fleet-defaults.test.mjs pins them to the same behavior.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from './schema.js';

const MANIFEST_KEY = 'mothership-connector/managed-config';
const REF = /^[A-Z][A-Z0-9_]{2,63}$/;
/** Locked refs of the managed manifest (credential record first, then <DSH home>/aiwuk/managed-config.json); never values. */
export async function lockedRefs(credentials, { env = process.env, home = env.DSH_HOME || join(homedir(), '.dsh'), read = readFile } = {}) {
  const locked = new Set();
  const take = raw => {
    if (!raw || typeof raw !== 'object' || !Number.isSafeInteger(raw.revision) || !Array.isArray(raw.entries)) return false;
    for (const item of raw.entries.slice(0, 200)) if (item && typeof item.ref === 'string' && REF.test(item.ref) && item.locked === true) locked.add(item.ref);
    return true;
  };
  try { const record = await credentials?.readRecord?.(MANIFEST_KEY); if (record?.kind === 'grant' && take(record.payload)) return locked; } catch { /* fall through to the file */ }
  try { take(JSON.parse(await read(join(home, 'aiwuk', 'managed-config.json'), 'utf8'))); } catch { /* nothing managed */ }
  return locked;
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

/**
 * Apply fleet defaults under the user's settings. The route is one unit: once the user picked a route mode or
 * filled a provider/model of their own, the whole fleet route is ignored, so the two never mix. A LOCKED fleet
 * route (`fleet.locked`) is the exception: it replaces the local route.
 */
export function withFleetDefaults(config, fleet) {
  if (!fleet?.routeMode) return config;
  const { locked, ...route } = fleet;
  if (locked) return { ...config, ...route };
  const userChoseRoute = config.routeMode !== DEFAULT_CONFIG.routeMode || config.provider !== '' || config.model !== '';
  return userChoseRoute ? config : { ...config, ...route };
}

/**
 * Read the fleet credentials once; never throws, absent store or values mean no fleet defaults. A locked ref reads
 * only the managed value stored by the connector (an environment variable of the same name is ignored) and marks the
 * result `locked`.
 */
export async function loadFleetDefaults(credentials, options) {
  if (typeof credentials?.resolve !== 'function') return {};
  const locked = await lockedRefs(credentials, options);
  const raw = {};
  let anyLocked = false;
  for (const [field, name] of Object.entries(FLEET_KEYS)) {
    try {
      const value = await credentials.resolve(name);
      if (locked.has(name)) {
        anyLocked = true;
        if (value && typeof value === 'object' && value.source !== undefined && value.source !== 'file') continue;
      }
      raw[field] = typeof value === 'string' ? value : value?.value;
    } catch { /* missing credential: leave unset */ }
  }
  const route = parseFleetDefaults(raw);
  return anyLocked && route.routeMode ? { ...route, locked: true } : route;
}
