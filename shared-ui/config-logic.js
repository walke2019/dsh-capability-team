// Pure logic of the config panel (no DOM, no React, no host imports) so it is testable and reused verbatim in the
// browser bundle. Nothing here ever receives a secret value: secrets are described (configured / source) only.

/** Credentials `describe` accepts at most this many refs per call. */
export const DESCRIBE_BATCH = 64;
export const SECRET_STATES = Object.freeze(['unset', 'stored', 'env', 'managed']);

export const chunk = (list, size = DESCRIBE_BATCH) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** Relative (base-href aware) URL of an extension's values-free manifest route; mirrors managed-config-route.js. */
export const managedConfigUrl = extension => `api/aiwuk.managed-config.${extension}`;

/** Remote replies are `{ok, value}` / `{ok:false, error}`; a bare value passes through. Throws on a refusal. */
export function unwrapReply(reply) {
  if (reply && typeof reply === 'object' && typeof reply.ok === 'boolean') {
    if (!reply.ok) throw new Error(String(reply.error?.code ?? reply.error?.message ?? 'remote-error'));
    return reply.value;
  }
  return reply;
}

/** Wire manifest → Map(ref → {locked, secret}); null when the payload is not a manifest. */
export function manifestFromWire(wire) {
  if (!wire || typeof wire !== 'object' || !Array.isArray(wire.entries)) return null;
  const entries = new Map();
  for (const item of wire.entries) {
    if (item && typeof item.ref === 'string') entries.set(item.ref, { locked: item.locked === true, secret: item.secret === true });
  }
  return { revision: Number.isSafeInteger(wire.revision) ? wire.revision : 0, entries };
}

/** 'locked' | 'default' (managed but editable) | 'none' for a ref. */
export function lockMode(manifest, ref) {
  const entry = ref ? manifest?.entries?.get(ref) : undefined;
  return !entry ? 'none' : entry.locked ? 'locked' : 'default';
}

/**
 * State of a secret field from the host's `describe` view (`{configured, source?, writable}`) and the lock mode.
 * Locked managed refs read as managed whatever the store says; the value itself is never involved.
 */
export function secretState(info, mode = 'none') {
  const readOnly = mode === 'locked' || info?.writable === false;
  if (mode === 'locked') return { kind: 'managed', configured: info?.configured === true, editable: false, clearable: false };
  const configured = info?.configured === true;
  const kind = !configured ? 'unset' : info?.source === 'file' ? 'stored' : 'env';
  // The environment is not writable by the product: Replace writes a stored value that then takes precedence,
  // Clear only removes the stored value (it cannot unset the environment), so it is offered for stored values only.
  return { kind, configured, editable: !readOnly, clearable: !readOnly && kind === 'stored' };
}

/** Text of an input for a stored settings value. */
export function fieldText(field, value) {
  if (value === undefined || value === null) return '';
  return field.multiple && Array.isArray(value) ? value.join(',') : String(value);
}

/** Whether a (non-secret) field currently has a value, for the summary count. */
export function hasValue(field, value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '';
}

/** Validation key (a dictionary key under `err.`) for an edited value, or null when acceptable. */
export function validateValue(field, raw) {
  if (field.kind === 'number') {
    const n = Number(raw);
    return Number.isInteger(n) && n >= field.min && n <= field.max ? null : 'number';
  }
  if (field.kind === 'url') {
    if (raw === '') return null;
    try { const url = new URL(raw); return url.protocol === 'https:' || url.protocol === 'http:' ? null : 'url'; } catch { return 'url'; }
  }
  if (field.kind === 'enum' && field.multiple) return Array.isArray(raw) && raw.every(v => field.options.includes(v)) ? null : 'enum';
  if (field.kind === 'enum') return raw === '' || field.options.includes(raw) ? null : 'enum';
  return null;
}

/** Whether a field is visible given the current (draft over saved) values. */
export const isShown = (field, current) => !field.showWhen || Object.entries(field.showWhen).every(([key, want]) => current[key] === want);

/**
 * form.mutate operations for the edited fields. `values` are the saved settings, `drafts` maps field id → edited
 * value (string, boolean or array). Locked managed fields are never written; an emptied field is unset so the layers
 * below apply again. Returns `{ops, invalid}` where `invalid` maps field id → error key.
 */
export function buildOps(fields, values, drafts, manifest) {
  const ops = [], invalid = {};
  for (const field of fields) {
    if (field.kind === 'secret' || !field.path || !Object.hasOwn(drafts, field.id)) continue;
    if (lockMode(manifest, field.ref) === 'locked') continue;
    let next = drafts[field.id];
    if (typeof next === 'string') next = next.trim();
    if (field.kind === 'number') {
      if (next === '') { if (hasValue(field, values?.[field.path])) ops.push({ op: 'unset', path: [field.path] }); continue; }
      const problem = validateValue(field, next);
      if (problem) { invalid[field.id] = problem; continue; }
      next = Number(next);
    } else if (field.multiple && typeof next === 'string') {
      next = next.split(',').map(v => v.trim()).filter(Boolean);
    }
    const problem = field.kind === 'number' ? null : validateValue(field, next);
    if (problem) { invalid[field.id] = problem; continue; }
    const saved = values?.[field.path];
    const same = Array.isArray(next) ? Array.isArray(saved) && saved.length === next.length && saved.every((v, i) => v === next[i]) : saved === next;
    if (same) continue;
    if (next === '' || (Array.isArray(next) && !next.length)) { if (hasValue(field, saved)) ops.push({ op: 'unset', path: [field.path] }); continue; }
    ops.push({ op: 'set', path: [field.path], value: next });
  }
  return { ops, invalid };
}

/**
 * Summary numbers: how many integration fields (those with a ref) hold a value, and how many are managed.
 * `states` maps secret ref → secretState(); `values` are saved settings.
 */
export function summaryCounts(fields, values, states, manifest) {
  let configured = 0, total = 0, managed = 0;
  for (const field of fields) {
    if (!field.ref) continue;
    total++;
    const mode = lockMode(manifest, field.ref);
    if (mode !== 'none') managed++;
    const set = field.kind === 'secret' ? states?.[field.ref]?.configured === true : hasValue(field, values?.[field.path]);
    if (set || mode === 'locked') configured++;
  }
  return { configured, total, managed };
}

/** Refs whose state the panel asks the host to describe. */
export const secretRefs = fields => fields.filter(field => field.kind === 'secret').map(field => field.ref);

/**
 * Describe the refs through `credentials.describe` in batches of DESCRIBE_BATCH. Returns `{ref: {configured, source?,
 * writable}}`; a failed batch leaves its refs out (the panel then shows them as unknown, never as "set").
 */
export async function describeSecrets(credentials, refs) {
  const out = {};
  if (typeof credentials?.describe !== 'function') return out;
  for (const batch of chunk(refs)) {
    try {
      const view = unwrapReply(await credentials.describe(batch)) ?? {};
      for (const ref of batch) if (view[ref] && typeof view[ref] === 'object') out[ref] = { configured: view[ref].configured === true, source: view[ref].source, writable: view[ref].writable !== false };
    } catch { /* leave this batch unknown */ }
  }
  return out;
}

/** Store a new value (write-only). Rejects an empty value, a locked ref and a missing API; resolves to true. */
export async function writeSecret(credentials, ref, value, mode = 'none') {
  if (mode === 'locked') throw new Error('locked');
  if (typeof value !== 'string' || !value.trim()) throw new Error('empty');
  if (typeof credentials?.set !== 'function') throw new Error('unavailable');
  unwrapReply(await credentials.set(ref, value));
  return true;
}

/** Remove the stored value of a ref. Rejects a locked ref and a missing API; resolves to true. */
export async function clearSecret(credentials, ref, mode = 'none') {
  if (mode === 'locked') throw new Error('locked');
  if (typeof credentials?.unset !== 'function') throw new Error('unavailable');
  unwrapReply(await credentials.unset(ref));
  return true;
}
