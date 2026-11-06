import { m as modelText } from './i18n.js';
// The (profile-wide) model policy is applied to a resolved role before the failover state chooses a route.
// Entries are exact provider/model routes, or prefix rules ending in "*" that match either the full
// route or the bare model id (so "@cf/*" covers every provider). No lower-tier substitution.
export const routeKey = route => `${route.provider}/${route.model}`;
export const isPrefixRule = entry => entry.endsWith('*');
export function validateDisabledRoutes(value) {
  if (!Array.isArray(value) || value.length > 2000) throw new Error(modelText('model-policy.311'));
  for (const v of value) {
    if (typeof v !== 'string' || !v.trim() || v.length > 512 || /[\r\n\0\s]/.test(v)) throw new Error(modelText('model-policy.312'));
    if (isPrefixRule(v)) {
      if (v.length < 3 || v.slice(0, -1).includes('*')) throw new Error(modelText('model-policy.313', { 0: v }));
    } else if (!v.includes('/') || v.includes('*')) throw new Error(modelText('model-policy.314'));
  }
  return [...new Set(value)].sort();
}
/** Predicate over provider/model keys for a validated disabled list. */
export function routeMatcher(disabledRoutes = []) {
  const exact = new Set(), prefixes = [];
  for (const entry of validateDisabledRoutes(disabledRoutes)) (isPrefixRule(entry) ? prefixes.push(entry.slice(0, -1)) : exact.add(entry));
  return key => {
    if (exact.has(key)) return true;
    const model = key.slice(key.indexOf('/') + 1);
    return prefixes.some(p => key.startsWith(p) || model.startsWith(p));
  };
}
export function applyModelPolicy(role, disabledRoutes = []) {
  const disabled = routeMatcher(disabledRoutes);
  if (role.unassigned || !role.provider || !role.model) return role;
  const candidates = [{ provider: role.provider, model: role.model }, ...(role.fallbacks ?? [])];
  const allowed = candidates.filter(r => !disabled(routeKey(r)));
  if (!allowed.length) throw new Error(modelText('model-policy.315', { 0: role.displayName ?? role.id }));
  const [primary, ...fallbacks] = allowed;
  // A disabled long-context route is dropped; requests then stay on the allowed primary and backups.
  const { longContext, ...rest } = role;
  const keep = longContext && !disabled(routeKey(longContext)) ? { longContext } : {};
  return { ...rest, ...primary, fallbacks, ...keep, policyExcluded: candidates.filter(r => disabled(routeKey(r))).map(routeKey) };
}
/** Roles as requests see them under the policy: excluded routes dropped, roles with no allowed route marked blocked. */
export function policyRoleView(roles, disabledRoutes = []) {
  return roles.map(role => {
    try { return applyModelPolicy(role, disabledRoutes); }
    catch (error) { return { ...role, provider: undefined, model: undefined, fallbacks: [], blocked: error.message }; }
  });
}
export function allocationPreview(roles, disabledRoutes) {
  return roles.map(role => {
    try {
      const resolved = applyModelPolicy(role, disabledRoutes);
      return { id: role.id, displayName: role.displayName ?? role.id,
        status: resolved.provider && resolved.model ? 'eligible' : 'unassigned',
        primary: resolved.provider && resolved.model ? routeKey(resolved) : null,
        fallbacks: (resolved.fallbacks ?? []).map(routeKey) };
    } catch (error) {
      return { id: role.id, displayName: role.displayName ?? role.id, status: 'blocked', primary: null, fallbacks: [], reason: error.message };
    }
  });
}
export function modelPolicyRows(tiers, roles, disabledRoutes = [], catalog = []) {
  const disabledList = validateDisabledRoutes(disabledRoutes);
  const isDisabled = routeMatcher(disabledList);
  const rows = new Map();
  for (const entry of catalog) {
    const slash = typeof entry === 'string' ? entry.indexOf('/') : -1;
    const candidate = typeof entry === 'string'
      ? { provider: entry.slice(0, slash), model: entry.slice(slash + 1) } : entry;
    if (!candidate?.provider || !candidate.model || (typeof entry === 'string' && slash < 1)) continue;
    const key = routeKey(candidate);
    rows.set(key, { key, provider: candidate.provider, model: candidate.model,
      tiers: candidate.tier ? [candidate.tier] : [], primaryFor: [], fallbackFor: [],
      disabled: isDisabled(key), verified: false });
  }
  for (const role of roles) {
    if (!role.provider || !role.model) continue;
    for (const [index, route] of [{ provider: role.provider, model: role.model }, ...(role.fallbacks ?? [])].entries()) {
      const key = routeKey(route);
      const row = rows.get(key) ?? { key, provider: route.provider, model: route.model, tiers: [], primaryFor: [], fallbackFor: [], disabled: isDisabled(key), verified: false };
      if (!row.tiers.includes(role.tier)) row.tiers.push(role.tier);
      row[index === 0 ? 'primaryFor' : 'fallbackFor'].push(role.id);
      rows.set(key, row);
    }
  }
  // Catalog tier membership may contain unallocated IDs; don't invent a provider for them.
  return { rows: [...rows.values()], tierCatalog: tiers, disabledRoutes: disabledList, allocations: allocationPreview(roles, disabledRoutes) };
}
