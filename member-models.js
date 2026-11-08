// DSH's native roster (list_agents, spawn_teammate) reports a teammate's model from the AgentOptions it was
// created with, which is the Lead's model it inherited. Role routing then records the real route with
// agent.model.select(), so the roster told the Lead every teammate ran on the Lead's model. This rewrites the
// roster rows a capability-team Lead sees to each live member's selected route; DSH stays the source of truth.
import { ownsCapabilityTeam } from './preset-guard.js';
import { restrictiveToolName } from './tool-names.js';
const ROSTER_TOOLS = new Set(['list_agents', 'spawn_teammate']);
/** The provider/model a live Agent currently runs (its recorded selection), or undefined. */
export function selectedRoute(agent) {
  try {
    const current = agent?.model?.current?.();
    return current?.provider && current?.model ? { provider: current.provider, model: current.model } : undefined;
  } catch { return undefined; }
}
/** One roster row with `model` replaced by the member's selected model id. The row's `provider` is the subagent backend (spawn/fork), not the LLM provider, so it is left as is. */
export function correctRow(row, lookup) {
  if (!row || typeof row !== 'object' || typeof row.target !== 'string') return row;
  const route = lookup(row.target);
  if (!route || row.model === route.model) return row;
  return { ...row, model: route.model };
}
/** Rewrite a native roster value (list_agents array or spawn_teammate `{ member }`); other values pass through. */
export function correctRoster(value, lookup) {
  if (Array.isArray(value)) {
    let changed = false;
    const rows = value.map(row => { const next = correctRow(row, lookup); if (next !== row) changed = true; return next; });
    return changed ? rows : value;
  }
  if (value && typeof value === 'object' && value.member) {
    const member = correctRow(value.member, lookup);
    return member === value.member ? value : { ...value, member };
  }
  return value;
}
export function applyMemberModels(ctx) {
  const lookupFor = lead => target => {
    if (target === 'lead') return selectedRoute(lead);
    const member = ctx.agentTeams.listMembers(lead).find(m => m.name === target && m.role !== 'lead');
    return member ? selectedRoute(ctx.agents?.get?.(member.id)) : undefined;
  };
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next();
    try {
      if (decision?.kind !== 'accept' || Object.hasOwn(decision, 'value') || Object.hasOwn(decision, 'content') || result?.isError) return decision;
      if (!ROSTER_TOOLS.has(restrictiveToolName(exec?.name, ROSTER_TOOLS)) || !ownsCapabilityTeam(ctx, exec.agent)) return decision;
      const membership = ctx.agentTeams.tryMembership(exec.agent);
      if (!membership?.root) return decision;
      const value = correctRoster(result.value, lookupFor(membership.root));
      return value === result.value ? decision : { ...decision, value };
    } catch { return decision; } // display correction must never break the native tool
  });
}
