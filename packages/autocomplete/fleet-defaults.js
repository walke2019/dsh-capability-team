// Fleet defaults: a manager (e.g. a Mothership hub) may push a default route through the DSH credential store.
// They only fill fields the user left at the built-in default, so local settings always win and an open-source
// install without these credentials behaves exactly as before.
import { DEFAULT_CONFIG } from './schema.js';

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
 * filled a provider/model of their own, the whole fleet route is ignored, so the two never mix.
 */
export function withFleetDefaults(config, fleet) {
  if (!fleet?.routeMode) return config;
  const userChoseRoute = config.routeMode !== DEFAULT_CONFIG.routeMode || config.provider !== '' || config.model !== '';
  return userChoseRoute ? config : { ...config, ...fleet };
}

/** Read the fleet credentials once; never throws, absent store or values mean no fleet defaults. */
export async function loadFleetDefaults(credentials) {
  if (typeof credentials?.resolve !== 'function') return {};
  const raw = {};
  for (const [field, name] of Object.entries(FLEET_KEYS)) {
    try {
      const value = await credentials.resolve(name);
      raw[field] = typeof value === 'string' ? value : value?.value;
    } catch { /* missing credential: leave unset */ }
  }
  return parseFleetDefaults(raw);
}
