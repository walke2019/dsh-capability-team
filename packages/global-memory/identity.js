import { ownsCapabilityTeam } from './shared/preset-guard.js';
import { projectRoot } from './shared/theme.js';
export function eligible(ctx, agent, config) {
  if (!config.enabled || !agent?.ctx) return false;
  try {
    const presets = ctx.agentPresets ?? ctx.get?.('agentPresets');
    if (typeof presets?.composedPreset !== 'function') return false;
    const membership = (ctx.agentTeams ?? ctx.get?.('agentTeams'))?.tryMembership(agent);
    presets.composedPreset((membership?.root ?? agent).ctx); // distinguish service failure from helper false
    return !ownsCapabilityTeam(ctx, agent);
  } catch { return false; }
}
export function identities(ctx) {
  const pinned = new Map();
  return {
    get(agent) {
      if (!pinned.has(agent.id)) pinned.set(agent.id, Promise.resolve().then(async () => {
        let cwd; try { cwd = await ctx.workingDirectory.ensure(agent); } catch { /* session/global remain available */ }
        return { project: typeof cwd === 'string' && cwd ? projectRoot(cwd) : undefined, role: 'global-memory', session: agent.id };
      }));
      return pinned.get(agent.id);
    },
    remove: id => pinned.delete(id), clear: () => pinned.clear(),
  };
}
export const localProject = who => who.project ?? `global-memory:session:${who.session}`;
