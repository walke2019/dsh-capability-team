// Resolve ONE named setting (an env-style ref such as AUTOCOMPLETE_MODEL) for consumers that have no integrations
// section. Same rule as the integrations resolver (contract F.3): a locked managed ref wins over everything local;
// otherwise credential > env > unlocked managed value. Values are returned to the server-side caller only.
import { pickLayer } from './managed-resolve.js';
import { readManagedManifest } from './shared/managed-config.js';
export { readManagedManifest };

/**
 * @param {string} ref  env-style name
 * @param {object} [lookups]
 * @param {object|null} [lookups.manifest]    a readManagedManifest() result
 * @param {(name:string)=>unknown} [lookups.credential]  stored value by name
 * @param {object} [lookups.env]              environment (defaults to process.env)
 * @returns {{value: (string|undefined), source: string, locked: boolean}}
 */
export function resolveRef(ref, { manifest = null, credential = () => undefined, env = process.env } = {}) {
  const layer = pickLayer({ names: [ref], entryOf: name => manifest?.entries?.get(name), settings: () => undefined, credential,
    env: name => env[name], file: undefined, validate: raw => String(raw), fallback: undefined });
  return { value: layer.value, source: layer.kind, locked: layer.locked };
}

/**
 * Read the values of `refs` from a DSH credential service (`resolve(name)` → string | {value}) and resolve each against
 * the managed manifest. Never throws; refs that cannot be read resolve as unset. `env` defaults to {} because the
 * credential service already falls back to the environment.
 */
export async function resolveRefs(refs, credentials, { env = {}, manifest } = {}) {
  const managed = manifest === undefined ? await readManagedManifest({ credentials }) : manifest;
  const stored = new Map();
  for (const ref of refs) {
    try {
      const raw = typeof credentials?.resolve === 'function' ? await credentials.resolve(ref) : undefined;
      const value = typeof raw === 'string' ? raw : raw?.value;
      if (value) stored.set(ref, value);
    } catch { /* unreadable: unset */ }
  }
  return Object.fromEntries(refs.map(ref => [ref, resolveRef(ref, { manifest: managed, credential: name => stored.get(name), env })]));
}
