// Fail closed: native team membership alone does not identify this preset.
export const CAPABILITY_PRESET = 'capability-team';
export function ownsCapabilityTeam(ctx, agent) {
  if (!agent) return false;
  try {
    const membership = (ctx.agentTeams ?? ctx.get?.('agentTeams'))?.tryMembership(agent);
    const owner = membership?.root ?? agent;
    const presets = ctx.agentPresets ?? ctx.get?.('agentPresets');
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
      return agent ? ownsCapabilityTeam(ctx, agent) : header?.preset === CAPABILITY_PRESET;
    } catch { return false; }
  };
  return { ...definition, stateVersion: definition.stateVersion + 1,
    init(header, inherited) {
      const state = definition.init(header, inherited);
      return { ...state, capabilityPreset: owns(header) };
    },
    apply(state, event) {
      if (!state.capabilityPreset) return state;
      return { ...definition.apply(state, event), capabilityPreset: true };
    },
    wire: { ...definition.wire, view: state => definition.wire.view(state.capabilityPreset ? state : definition.init()) },
  };
}
