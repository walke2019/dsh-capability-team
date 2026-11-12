import { m as modelText } from './i18n.js';
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
    const identity = team.native.identity(exec.agent);
    if (!identity) return downstream;
    const creation = team.native.creation(exec);
    if (!creation) return downstream;
    if (exec.signal?.aborted) return { kind: 'cancel' };
    if (!creation.roleName) return { kind: 'deny', reason: modelText('spawn-confirm.named-role') };
    const owner = identity.root;
    const name = creation.address ?? creation.name;
    const stillLead = () => {
      const current = team.native.identity(exec.agent);
      return !!current && current.rootId === identity.rootId && current.agentId === identity.agentId && current.address === identity.address && current.role === identity.role;
    };
    try {
      if (typeof team.load === 'function') {
        const { effective } = await team.load(owner);
        if (exec.signal?.aborted) return { kind: 'cancel' };
        if (!stillLead()) return { kind: 'cancel' };
        if (effective.workflow.confirmDispatch !== 'never') return downstream;
      }
      const role = await team.resolveMember(owner, name);
      if (exec.signal?.aborted) return { kind: 'cancel' };
      if (!stillLead()) return { kind: 'cancel' };
      if (role.unassigned || !role.provider || !role.model) return { kind: 'deny', reason: modelText('dispatch-preflight.unassigned', { 0: exec.arguments.name }) };
      const ready = failover.eligibility(role);
      if (!ready.eligible) return { kind: 'deny', reason: modelText(ready.reason === 'cooling' ? 'dispatch-preflight.cooling' : 'dispatch-preflight.unregistered', { 0: exec.arguments.name }) };
      return downstream;
    } catch (error) {
      if (exec.signal?.aborted || error?.name === 'AbortError') return { kind: 'cancel' };
      if (!stillLead()) return { kind: 'cancel' };
      return { kind: 'deny', reason: modelText('dispatch-preflight.resolve', { 0: exec.arguments.name }) };
    }
  });
}
