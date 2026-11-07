// Managed-config manifest reader (values-free). The Mothership connector publishes WHICH refs it manages and
// whether each is locked; the values themselves live in the DSH credential store under the same ref names.
// Sources, in order: the credential record `mothership-connector/managed-config` (a GrantRecord whose payload is
// the manifest), then the file `<DSH home>/aiwuk/managed-config.json`. Nothing here ever returns a value.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The record's address: the connector's registered plugin name (its Loader id) and the record id. */
export const MANAGED_CONFIG_RECORD_SCOPE = 'mothership-connector';
export const MANAGED_CONFIG_RECORD_ID = 'managed-config';
/** `credentialKey(scope, id)` is the identity brand over `<scope>/<id>`; the plain string is the same key. */
export const MANAGED_CONFIG_RECORD_KEY = `${MANAGED_CONFIG_RECORD_SCOPE}/${MANAGED_CONFIG_RECORD_ID}`;
export const MANAGED_CONFIG_FILE_PARTS = Object.freeze(['aiwuk', 'managed-config.json']);
export const MANAGED_REF_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
export const FORCED_SECRET_PATTERN = /(_API_KEY|_KEY|_TOKEN|_SECRET|_PASSWORD)$/;
export const MAX_MANAGED_ENTRIES = 200;

/** DSH home directory: `$DSH_HOME`, else `~/.dsh`. */
export const dshHome = (env = process.env) => env.DSH_HOME || join(homedir(), '.dsh');
export const managedConfigFilePath = (home = dshHome()) => join(home, ...MANAGED_CONFIG_FILE_PARTS);

/**
 * Normalize an untrusted manifest into `{revision, entries: Map(ref → {locked, secret})}`, or null when the
 * document is not a manifest. Unknown fields (a stray `value` included) are dropped, malformed entries skipped,
 * and a ref matching the forced-secret pattern is always secret.
 */
export function normalizeManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!Number.isSafeInteger(raw.revision) || raw.revision < 0 || !Array.isArray(raw.entries)) return null;
  const entries = new Map();
  for (const item of raw.entries.slice(0, MAX_MANAGED_ENTRIES)) {
    if (!item || typeof item !== 'object' || typeof item.ref !== 'string' || !MANAGED_REF_PATTERN.test(item.ref)) continue;
    entries.set(item.ref, { locked: item.locked === true, secret: item.secret === true || FORCED_SECRET_PATTERN.test(item.ref) });
  }
  return { revision: raw.revision, entries };
}

/** The wire view served to the browser: sorted `{revision, entries:[{ref, locked, secret}]}`, nothing else. */
export function manifestToWire(manifest) {
  if (!manifest) return { revision: 0, entries: [] };
  return { revision: manifest.revision, entries: [...manifest.entries].map(([ref, e]) => ({ ref, locked: e.locked, secret: e.secret })).sort((a, b) => (a.ref < b.ref ? -1 : 1)) };
}

async function fromRecord(credentials) {
  if (typeof credentials?.readRecord !== 'function') return null;
  try {
    const record = await credentials.readRecord(MANAGED_CONFIG_RECORD_KEY);
    return record?.kind === 'grant' ? normalizeManifest(record.payload) : null;
  } catch { return null; }
}

async function fromFile(path, read) {
  try { return normalizeManifest(JSON.parse(await read(path, 'utf8'))); } catch { return null; }
}

/**
 * Read the manifest: the credential record first, then the file fallback. Never throws; null means "nothing
 * managed". `ctx.credentials` is the DSH credential service; `env`, `home` and `read` exist for tests.
 */
export async function readManagedManifest(ctx, { env = process.env, home = dshHome(env), read = readFile } = {}) {
  return (await fromRecord(ctx?.credentials)) ?? (await fromFile(managedConfigFilePath(home), read));
}

/** Longest non-secret managed value shown in a browser panel (URLs, model ids, engine lists). */
export const MAX_SHOWN_VALUE = 512;
/**
 * Values of the NON-secret managed refs (URLs, models, engine lists), read from the credential store so the panel can
 * show what the Mothership configured. Secret refs (flagged or matching the forced-secret pattern) are never read.
 * Returns `{ref: value}`; a ref without a value or a failing lookup is left out. Never throws.
 */
export async function managedValues(credentials, manifest) {
  const out = {};
  if (!manifest || typeof credentials?.resolve !== 'function') return out;
  for (const [ref, entry] of manifest.entries) {
    if (entry.secret || FORCED_SECRET_PATTERN.test(ref)) continue;
    try {
      const hit = await credentials.resolve(ref);
      const value = typeof hit === 'string' ? hit : hit?.value;
      if (typeof value === 'string' && value && value.length <= MAX_SHOWN_VALUE) out[ref] = value;
    } catch { /* leave it out */ }
  }
  return out;
}
