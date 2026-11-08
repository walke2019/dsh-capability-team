import { m as modelText, roleText } from './i18n.js';
import { allocatedRequest } from './allocation.js';
import { followUserChoice, leadRequest } from './lead-route.js';
import { budgetDenial, sessionUsage } from './usage.js';
import { createLongContext, promptTokens } from './long-context.js';
import { ensurePreset } from './access.js';
import { bindRuntime } from './runtime-observability.js';
import { FILE_LIMITS, fileLimitRules } from './file-limits.js';
import { TOKEN_RULES, tokenRuleText } from './token-discipline.js';
// `allowed` is the free list resolved from OpenCode's catalog (opencode.js); nothing is fixed here.
export function freeArgs(prompt, model, allowed = []) {
  if (typeof model !== 'string' || !allowed.includes(model)) throw new Error(modelText('roles.359'));
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) throw new Error(modelText('roles.360'));
  return ['run', '--format', 'json', '--model', model, '--', prompt];
}
// Static rules hold no role names, models or tiers: those come from the per-Agent team context.
export const policy = roleText('roles.361', { 0: fileLimitRules(FILE_LIMITS), 1: tokenRuleText(TOKEN_RULES) });
/**
 * Route every model request by the native Team identity.
 * The loop re-runs agent/request for each retry, so the failover state picks the attempt's route.
 */
export function apply(ctx, team, failover, observability, taskControl) {
  const installed = new WeakSet();
  const installPolicy = agent => {
    if (!team.owns(agent) || installed.has(agent)) return;
    installed.add(agent);
    agent.ctx.systemPrompt.context({ name: 'capability-team:policy', order: 95, text: () => team.owns(agent) ? policy : '' });
  };
  ctx.on('agent/created', async ({ agent }) => { installPolicy(agent); await preselect(ctx, team, failover, agent); });
  for (const agent of ctx.agents?.list?.() ?? []) installPolicy(agent);
  const longContext = createLongContext();
  const hadOverride = new WeakSet();
  ctx.on('agent/request', async ({ agent, turn, step }, next) => {
    const previous = await next();
    if (!team.owns(agent)) return previous;
    const resolved = await team.resolve(agent);
    const lead = ctx.agentTeams?.tryMembership?.(agent)?.role === 'lead';
    const { leadContext, ...configuredRole } = resolved;
    // The Lead uses the model the user picked in the conversation; teammates are routed strictly by role.
    const role = lead ? followUserChoice(configuredRole, previous, leadContext) : configuredRole;
    if (role.userChoiceRejected) ctx.logger?.warn?.(modelText('roles.362', { 0: role.userChoiceRejected }));
    // Fail closed: silently inheriting the Lead model defeats capability tiers and hides misconfiguration.
    if (role.unassigned) throw new Error(modelText('roles.363', { 0: role.displayName ?? role.id, 1: role.capability }));
    // DSH's own sandbox preset for read-only roles; re-checked every request so config edits take effect.
    ensurePreset(ctx.get?.('permissionPresets'), agent.session, role.access, message => ctx.logger?.warn?.(`capability-team: ${message}`));
    const projections = ctx.get?.('sessionProjections');
    const overBudget = budgetDenial(role, sessionUsage(projections, agent.session));
    if (overBudget) throw new Error(overBudget);
    const controlled = taskControl ? await taskControl.route(agent, role) : role;
    if (hadOverride.has(agent) && !controlled.taskLeaseSignature) { longContext.reset(agent.session); hadOverride.delete(agent); }
    if (controlled.taskLeaseSignature) hadOverride.add(agent);
    const routed = controlled.taskLeaseSignature ? controlled : longContext.apply(agent.session, controlled, promptTokens(projections, agent.session));
    // Always explicit: the loop pins the last logged header, so the primary must be restored by name.
    const selected = failover.route(agent, turn, step, routed);
    if (observability) {
      try {
        bindRuntime(agent, observability, ctx.agentTeams);
        observability.request(agent, { turn, step, role, routed, selected });
      } catch { /* telemetry must never change model selection */ }
    }
    // DSH fixes provider/model before step preparation; a different route can only take effect from the next step.
    if (agent.model?.select && !sameRoute(previous, selected)) {
      agent.model.select({ provider: selected.provider, model: selected.model });
      ctx.logger?.info?.(`capability-team: ${previous.provider}/${previous.model} -> ${selected.provider}/${selected.model} from the next step`);
      return previous;
    }
    if (agent.model?.select) return (lead && leadRequest(previous, selected)) || keepEffort(previous, allocatedRequest(previous, selected));
    return (lead && leadRequest(previous, selected)) || allocatedRequest(previous, selected);
  });
  ctx.on('agent/request-error', async ({ agent, failure, signal }, next) => {
    const downstream = await next(); // DSH provider retry policy keeps priority.
    if (team.owns(agent)) { try { observability?.failure(agent, failure); } catch { /* read-only telemetry */ } }
    if (downstream?.kind === 'retry' || !team.owns(agent)) return downstream;
    const before = failover.status(agent)?.active;
    if (!(await failover.recover(agent, failure, signal))) return undefined;
    const after = failover.status(agent)?.active;
    // A retry reuses the step's fixed route, so a switch is recorded for the next step instead of retried here.
    if (agent.model?.select && after && after !== before) {
      const slash = after.indexOf('/');
      agent.model.select({ provider: after.slice(0, slash), model: after.slice(slash + 1) });
      return undefined;
    }
    return { kind: 'retry' };
  });
}
const sameRoute = (a, b) => a?.provider === b?.provider && a?.model === b?.model;
/** Same route as the step's selection: its reasoning effort is part of the fixed selection and must be kept. */
function keepEffort(previous, request) {
  return previous.reasoningEffort === undefined ? request : { ...request, reasoningEffort: previous.reasoningEffort };
}
/**
 * Select a teammate's role route when it is created, before its first step fixes a model. Without this the
 * teammate starts on the inherited Lead model and DSH rejects the per-role route in agent/request.
 */
export async function preselect(ctx, team, failover, agent) {
  try {
    if (!agent?.model?.select || !team.owns(agent) || ctx.agentTeams?.tryMembership?.(agent)?.role !== 'teammate') return;
    const role = await team.resolve(agent);
    if (role.unassigned || !role.provider) return; // agent/request fails closed with guidance
    const route = failover.route(agent, 0, 0, role);
    if (!sameRoute(agent.model.current?.(), route)) agent.model.select({ provider: route.provider, model: route.model });
  } catch (error) {
    ctx.logger?.warn?.(`capability-team: route preselection failed: ${String(error?.message ?? error)}`);
  }
}
