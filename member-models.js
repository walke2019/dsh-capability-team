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
/** The last `model/selection` recorded in a session log, or undefined. */
export function lastSelection(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const { provider, model } = events[i]?.type === 'model/selection' ? events[i].data ?? {} : {};
    if (typeof provider === 'string' && typeof model === 'string') return { provider, model };
  }
  return undefined;
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
export function applyMemberModels(ctx, native) {
  // An idle teammate is unloaded; DSH then falls back to its creation options (the Lead model) and no live
  // Agent is left to ask. Remember each session's last selection, which DSH records as `model/selection`.
  const recorded = new Map(); // session id → { provider, model }
  try {
    ctx.on('session/event', (session, event) => {
      if (event?.type !== 'model/selection' || !session?.id) return;
      const { provider, model } = event.data ?? {};
      if (typeof provider === 'string' && typeof model === 'string') recorded.set(session.id, { provider, model });
    });
  } catch { /* host without session observers: live selections only */ }
  // After a DSH restart neither is available: read the member's durable log once (DSH's sessionQuery).
  const coldRoute = async id => {
    if (recorded.has(id)) return recorded.get(id);
    try {
      const snapshot = await ctx.get?.('sessionQuery')?.readSession(id);
      const route = lastSelection(snapshot?.events ?? []);
      if (route) recorded.set(id, route);
      return route;
    } catch { return undefined; }
  };
  const routesFor = async (lead, rows) => {
    const members = await native.list(lead);
    const routes = new Map([['lead', selectedRoute(lead)]]);
    for (const row of Array.isArray(rows) ? rows : [rows?.member]) {
      const member = members.find(m => m.name === row?.target && m.role !== 'lead');
      if (member) routes.set(member.name, selectedRoute(ctx.agents?.get?.(member.id)) ?? await coldRoute(member.id));
    }
    return target => routes.get(target);
  };
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next();
    try {
      if (decision?.kind !== 'accept' || Object.hasOwn(decision, 'value') || Object.hasOwn(decision, 'content') || result?.isError) return decision;
      if (!ROSTER_TOOLS.has(restrictiveToolName(exec?.name, ROSTER_TOOLS)) || !ownsCapabilityTeam(ctx, exec.agent, native)) return decision;
      const membership = native.identity(exec.agent);
      if (!membership?.root) return decision;
      const value = correctRoster(result.value, await routesFor(membership.root, result.value));
      return value === result.value ? decision : { ...decision, value };
    } catch { return decision; } // display correction must never break the native tool
  });
}
