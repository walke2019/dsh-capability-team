// Precedence core of the integrations resolver (contract F.3), pure and value-agnostic.
//   1. A LOCKED managed ref wins over everything local, settings included; local values for it are ignored.
//   2. Otherwise: settings > credential > env > integrations.json file > unlocked managed value > default.
// A managed value is stored by the connector as a credential under the ref's own name, so for a managed ref the
// credential slot IS the managed value: it is reported as 'managed-locked' / 'managed-default', never 'credential'.
/** Every source kind a resolved field can report. */
export const SOURCE_KINDS = Object.freeze(['managed-locked', 'settings', 'credential', 'env', 'file', 'managed-default', 'default']);

/**
 * Pick the effective value of one field.
 * @param {object} input
 * @param {string[]} input.names        override names, primary first (a later name is a legacy fallback)
 * @param {(name:string)=>({locked:boolean}|undefined)} input.entryOf  managed manifest entry of a name
 * @param {()=>unknown} input.settings  raw settings-form value (undefined when unset)
 * @param {(name:string)=>unknown} input.credential  raw credential-store value of a name
 * @param {(name:string)=>unknown} input.env  raw environment value of a name
 * @param {unknown} input.file          raw integrations.json value
 * @param {(raw:unknown, kind:string)=>unknown} input.validate  returns the normalized value or throws; an invalid layer is skipped
 * @param {unknown} input.fallback      built-in default
 * @returns {{value:unknown, kind:string, name?:string, locked:boolean, managed:boolean}}
 */
export function pickLayer({ names, entryOf, settings, credential, env, file, validate, fallback }) {
  const managedNames = names.filter(name => entryOf(name));
  const lockedName = managedNames.find(name => entryOf(name).locked);
  const tryLayer = (kind, raw, name) => {
    // An explicit null in integrations.json is a deliberate value; for every other layer it means "unset".
    if (kind === 'file' ? raw === undefined : (raw === undefined || raw === null || raw === '')) return undefined;
    try { return { value: validate(raw, kind), kind, ...(name ? { name } : {}), locked: kind === 'managed-locked', managed: managedNames.length > 0 }; } catch { return undefined; }
  };
  const pick = (...layers) => { for (const make of layers) { const hit = make(); if (hit) return hit; } return undefined; };
  if (lockedName) {
    return pick(() => tryLayer('managed-locked', credential(lockedName), lockedName))
      ?? { value: fallback, kind: 'default', locked: true, managed: true };
  }
  return pick(
    () => tryLayer('settings', settings()),
    // Primary name first; a legacy name only when every earlier one is unset.
    ...names.flatMap(name => entryOf(name)
      ? [() => tryLayer('env', env(name), name)]
      : [() => tryLayer('credential', credential(name), name), () => tryLayer('env', env(name), name)]),
    () => tryLayer('file', file),
    ...managedNames.map(name => () => tryLayer('managed-default', credential(name), name)),
  ) ?? { value: fallback, kind: 'default', locked: false, managed: managedNames.length > 0 };
}

/** The legacy `sources` string: `credential:NAME` / `env:NAME`; every other kind is reported bare. */
export const sourceLabel = layer => (layer.name && (layer.kind === 'credential' || layer.kind === 'env') ? `${layer.kind}:${layer.name}` : layer.kind);
