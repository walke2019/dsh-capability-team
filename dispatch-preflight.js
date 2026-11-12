import { m as modelText } from './i18n.js';
import { ownsCapabilityTeam } from './preset-guard.js';
import { restrictiveToolName } from './tool-names.js';
const SPAWN = new Set(['spawn_teammate']);
// This is only a pass-through filter, not a replacement for native argument validation.
// DSH 0.2.2-rc.1 TeamRoster.memberName rejects these shapes without trimming.
export function preflightShape(args) {
  return !!args && typeof args.name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(args.name)
    && args.name.length <= 64 && args.name !== 'lead'
    && typeof args.description === 'string' && !!args.description.trim() && args.description.trim().length <= 200
    && typeof args.prompt === 'string' && !!args.prompt.trim()
    && (args.context === undefined || args.context === 'fresh' || args.context === 'fork');
}
/** Validate static role/route readiness before the native tool creates a durable member. */
export function applyDispatchPreflight(ctx, team, failover) {
  ctx.on('tools/pre-execute', async (exec, next) => {
    const downstream = await next();
    if (downstream?.kind !== 'allow') return downstream;
    if (!ownsCapabilityTeam(ctx, exec.agent) || ctx.agentTeams.tryMembership(exec.agent)?.role !== 'lead'
      || restrictiveToolName(exec.name, SPAWN) !== 'spawn_teammate' || !preflightShape(exec.arguments)) return downstream;
    if (exec.signal?.aborted) return { kind: 'cancel' };
    const leadId = ctx.agentTeams.tryMembership(exec.agent)?.root?.id ?? exec.agent.id;
    const stillLead = () => {
      const membership = ctx.agentTeams.tryMembership(exec.agent);
      return ownsCapabilityTeam(ctx, exec.agent) && membership?.role === 'lead' && (membership.root?.id ?? exec.agent.id) === leadId;
    };
    try {
      if (typeof team.load === 'function') {
        const { effective } = await team.load(exec.agent);
        if (exec.signal?.aborted) return { kind: 'cancel' };
        if (!stillLead()) return downstream;
        if (effective.workflow.confirmDispatch !== 'never') return downstream;
      }
      const role = await team.resolveMember(exec.agent, exec.arguments.name);
      if (exec.signal?.aborted) return { kind: 'cancel' };
      if (!stillLead()) return downstream;
      if (role.unassigned || !role.provider || !role.model) return { kind: 'deny', reason: modelText('dispatch-preflight.unassigned', { 0: exec.arguments.name }) };
      const ready = failover.eligibility(role);
      if (!ready.eligible) return { kind: 'deny', reason: modelText(ready.reason === 'cooling' ? 'dispatch-preflight.cooling' : 'dispatch-preflight.unregistered', { 0: exec.arguments.name }) };
      return downstream;
    } catch (error) {
      if (exec.signal?.aborted || error?.name === 'AbortError') return { kind: 'cancel' };
      if (!stillLead()) return downstream;
      return { kind: 'deny', reason: modelText('dispatch-preflight.resolve', { 0: exec.arguments.name }) };
    }
  });
}
