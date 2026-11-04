// Settings-form support for the standalone omni-search and memory bundles (copied into packages/*/shared/).
// cordis validates an exported `Config` through Standard Schema (`Config['~standard'].validate`) and DSH's settings
// page projects only `.volatile()` fields, which need @deepseek-ai/schemastery >= 3.18.4 (resolved from the DSH
// installation through the optional peer dependency). Outside DSH (plain `node --test`, no node_modules) the
// library is absent: the bundles then export no Config and keep validating their own plain options.
let lib = null;
try { lib = (await import('@deepseek-ai/schemastery')).default; }
catch (error) { if (error?.code !== 'ERR_MODULE_NOT_FOUND' && error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error; }
/** Refuse a stale copy without `.volatile()` (an old nested node_modules shadowing DSH's) with an actionable error. */
export function assertVolatile(z, owner) {
  let ok = false;
  try { ok = typeof z.string().default('x').volatile === 'function'; } catch { ok = false; }
  if (!ok) throw new Error(`[${owner}] the resolved @deepseek-ai/schemastery has no .volatile() (needs >= 3.18.4). A stale nested copy (node_modules/${owner}/node_modules/@deepseek-ai/schemastery) probably shadows the one DSH ships; delete it or reinstall the plugin, then restart DSH.`);
  return z;
}
/** The schemastery default export, or null when unavailable. `owner` names the bundle in the load error. */
export const schemastery = owner => (lib ? assertVolatile(lib, owner) : null);
/** Current value of a volatile reference or plain value; empty strings and empty lists count as unset. */
export function liveValue(ref) {
  const value = typeof ref?.get === 'function' ? ref.get() : ref;
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length)) return undefined;
  return Array.isArray(value) ? [...value] : typeof value === 'string' ? value.trim() : value;
}
/**
 * Split a bundle config into its plain options and a settings layer reader.
 * `fields` maps each settings key to its integrations target `[section, key]`; the reader returns only set values.
 */
export function splitSettings(input, fields) {
  const plain = {}; const refs = {};
  for (const [key, value] of Object.entries(input ?? {})) (Object.hasOwn(fields, key) ? refs : plain)[key] = value;
  const read = () => {
    const layer = {};
    for (const [key, [section, target]] of Object.entries(fields)) {
      const value = liveValue(refs[key]);
      if (value !== undefined) (layer[section] ??= {})[target] = value;
    }
    return layer;
  };
  return { plain, read };
}
