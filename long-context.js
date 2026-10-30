// Same-tier long-context route: once the next prompt of a member's session reaches its capability's threshold,
// requests go to the configured long-context model first. They return only after the prompt falls below 80% of
// the threshold (for example after compaction), so a session does not flip models, and caches, on every step.
const RELEASE = 0.8;
/** Next-prompt size of a session from token-meter's `contextPressure` state, as its wire view computes it. */
export function promptTokens(projections, session) {
  try {
    const state = projections?.stateOf(session, 'contextPressure');
    if (!state) return undefined;
    if (state.pressureTokens !== undefined && state.sampledSurfaceTokens !== undefined) return Math.max(0, state.pressureTokens + state.surfaceTokens - state.sampledSurfaceTokens);
    return state.surfaceTokens; // No provider sample yet: the heuristic surface is the only estimate.
  } catch { return undefined; }
}
export function createLongContext() {
  const active = new WeakMap(); // session → whether the long-context route is engaged
  return {
    /** The role with its long-context route first while the session's prompt is large; the role itself otherwise. */
    apply(session, role, tokens) {
      const lc = role.longContext;
      if (!lc || tokens === undefined) return role;
      const on = tokens >= lc.thresholdTokens * (active.get(session) ? RELEASE : 1);
      active.set(session, on);
      if (!on) return role;
      const same = r => r.provider === lc.provider && r.model === lc.model;
      const rest = [{ provider: role.provider, model: role.model }, ...(role.fallbacks ?? [])].filter(r => !same(r));
      return { ...role, provider: lc.provider, model: lc.model, fallbacks: rest, longContextActive: true };
    },
  };
}
