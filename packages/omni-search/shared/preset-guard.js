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
    // DSH's own SessionHeader.agentPreset decides first. The live Agent is only a fallback for headers without it:
    // a projection can initialise before the Agent's preset is composed, and that early "not ours" used to stick
    // for the whole session, leaving usage, activity and report empty for real capability-team sessions.
    const recorded = header?.agentPreset ?? header?.preset;
    if (recorded !== undefined) return recorded === CAPABILITY_PRESET;
    try {
      const agent = ctx.agents?.get(header?.id ?? header?.sessionId);
      return agent ? ownsCapabilityTeam(ctx, agent) : false;
    } catch { return false; }
  };
  // +2: checkpoints written by the earlier decision are discarded and refolded from the session log.
  return { ...definition, stateVersion: definition.stateVersion + 2,
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
