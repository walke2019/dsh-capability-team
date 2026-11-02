// Fail closed: native team membership alone does not identify this preset.
export const CAPABILITY_PRESET = 'capability-team';
// A service missing from the caller's `inject` throws on direct property access in cordis; ctx.get() does not.
const service = (ctx, name) => { try { const direct = ctx[name]; if (direct) return direct; } catch { /* not injected */ } try { return ctx.get?.(name); } catch { return undefined; } };
export function ownsCapabilityTeam(ctx, agent) {
  if (!agent) return false;
  try {
    const membership = service(ctx, 'agentTeams')?.tryMembership(agent);
    const owner = membership?.root ?? agent;
    const presets = service(ctx, 'agentPresets');
    return presets?.composedPreset(owner.ctx) === CAPABILITY_PRESET;
  } catch { return false; }
}
export function capabilitySession(ctx, session) {
  try { return ownsCapabilityTeam(ctx, ctx.agents?.get(session?.id)); }
  catch { return false; }
}
export function isolatedProjection(ctx, definition) {
  const owns = header => {
    try {
      const agent = ctx.agents?.get(header?.id ?? header?.sessionId);
      return agent ? ownsCapabilityTeam(ctx, agent) : (header?.agentPreset ?? header?.preset) === CAPABILITY_PRESET; // SessionHeader.agentPreset
    } catch { return false; }
  };
  return { ...definition, stateVersion: definition.stateVersion + 1,
    init(header, inherited) {
      const state = definition.init(header, inherited);
      return { ...state, capabilityPreset: owns(header) };
    },
    apply(state, event) {
      // A blank session may switch preset before its first turn: re-decide from the committed selection.
      if (event?.type === 'agent-preset/selected') {
        const owned = event.data?.agentPreset === CAPABILITY_PRESET;
        if (owned !== state.capabilityPreset) return { ...state, capabilityPreset: owned };
      }
      if (!state.capabilityPreset) return state;
      return { ...definition.apply(state, event), capabilityPreset: true };
    },
    wire: { ...definition.wire, view: state => definition.wire.view(state.capabilityPreset ? state : definition.init()) },
  };
}
