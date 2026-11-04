// The Lead follows the model the user picked in the conversation. DSH puts that pick on the request config it
// passes to agent/request; this plugin used to overwrite it with the configured lead route. Teammates keep strict
// per-role routing. Same-tier failover still applies: configured lead routes in the chosen model's tier stay
// as fallbacks, and a model outside that tier gets none, so a failure never degrades across tiers.
import { routeKey, routeMatcher } from './model-policy.js';
/** The user's pick from DSH's request config, or null when the request names no model. */
export function userChoice(previous) {
  const { provider, model } = previous ?? {};
  return typeof provider === 'string' && provider && typeof model === 'string' && model ? { provider, model } : null;
}
/**
 * The Lead role re-pointed at the user's pick. `tierModels` lists the model ids of the configured lead tier;
 * `disabledRoutes` is the profile-wide model policy. A pick the policy disables keeps the configured route.
 */
export function followUserChoice(role, previous, { tierModels = [], disabledRoutes = [] } = {}) {
  const choice = userChoice(previous);
  if (!choice) return role;
  if (routeMatcher(disabledRoutes)(routeKey(choice))) return { ...role, userChoiceRejected: routeKey(choice) };
  const configured = role.unassigned || !role.provider ? [] : [{ provider: role.provider, model: role.model }, ...(role.fallbacks ?? [])];
  const same = r => routeKey(r) === routeKey(choice);
  const sameTier = configured.some(same) || tierModels.includes(choice.model);
  // The long-context switch is a configured-route feature; the user's explicit pick is not swapped out.
  const { longContext: _longContext, unassigned: _unassigned, ...rest } = role;
  return { ...rest, ...choice, fallbacks: sameTier ? configured.filter(r => !same(r)) : [], userChoice: true };
}
/** The outgoing request: the user's own settings survive when the user's pick is the route actually used. */
export function leadRequest(previous, selected) {
  const choice = userChoice(previous);
  return choice && routeKey(choice) === routeKey(selected) ? { ...previous, provider: selected.provider, model: selected.model } : null;
}
