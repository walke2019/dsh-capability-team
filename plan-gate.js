import { m as modelText } from './i18n.js';
// Plan-first teammates: a capability with `planFirst` submits a plan to the Lead and waits for approval before it may
// run execution tools. A new dispatch plan that assigns the role asks for a fresh plan, so one approval covers one task.
import { params } from './tool-schema.js';
import { ownsCapabilityTeam } from './preset-guard.js';
import { resolveRole } from './config.js';
import { toolClass } from './workflow.js';
export const SUBMIT_TOOL = 'capability_submit_plan';
export const REVIEW_TOOL = 'capability_review_plan';
const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
const STATUS = { pending: modelText('plan-gate.324'), approved: modelText('plan-gate.325'), rejected: modelText('plan-gate.326') };
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(modelText('plan-gate.327', { 0: label, 1: max }));
  return value.trim();
}
/** Pure decision for one teammate call under plan-first; returns a denial reason or undefined. */
export function planDenial(exec, role, plan, workflow) {
  if (!role.planFirst || exec.name === SUBMIT_TOOL || plan?.status === 'approved') return undefined;
  const kind = toolClass(exec.name, workflow);
  if (kind === 'analysis' || kind === 'coordination') return undefined;
  const state = plan ? modelText('plan-gate.328', { 0: STATUS[plan.status], 1: plan.feedback ? modelText('plan-gate.329', { 0: plan.feedback }) : '' }) : modelText('plan-gate.330');
  return modelText('plan-gate.331', { 0: role.displayName, 1: role.capability, 2: SUBMIT_TOOL, 3: exec.name, 4: state });
}
export function createPlanGate(ctx, team) {
  const plans = new Map(); // `${teamId}:${role}` → { status, plan, feedback?, at }
  const keyOf = (membership, role = membership.name) => `${membership.id}:${role}`;
  const roleOf = (agent, membership) => {
    const project = team.pinned(agent);
    const effective = project ? team.loadSync(project, agent).effective : team.base;
    return { role: resolveRole(membership, effective), effective };
  };
  return {
    plans,
    /** Model-facing plan state for a teammate's own context, or undefined when its capability is not plan-first. */
    status(agent, membership, role) {
      if (!role?.planFirst || membership?.role !== 'teammate') return undefined;
      const plan = plans.get(keyOf(membership));
      return plan ? `${STATUS[plan.status]}${plan.feedback ? modelText('plan-gate.332', { 0: plan.feedback }) : ''}` : modelText('plan-gate.333', { 0: SUBMIT_TOOL });
    },
    /** The Lead assigned these roles in a new dispatch plan: earlier approvals do not cover the new task. */
    reset(leadMembership, roles) {
      for (const role of roles) plans.delete(keyOf(leadMembership, role));
    },
    guard(exec) {
      const membership = ctx.agentTeams.tryMembership(exec.agent);
      if (!ownsCapabilityTeam(ctx, exec.agent) || membership?.role !== 'teammate') return undefined;
      let resolved;
      try { resolved = roleOf(exec.agent, membership); } catch { return undefined; } // Routing and the access guard report config errors.
      return planDenial(exec, resolved.role, plans.get(keyOf(membership)), resolved.effective.workflow);
    },
    register() {
      ctx.effect(() => ctx.tools.guard(exec => this.guard(exec)));
      ctx.effect(() => ctx.tools.register({ name: SUBMIT_TOOL, output,
        description: modelText('plan-gate.334'),
        parameters: params({ plan: { type: 'string', description: modelText('plan-gate.335') } }, ['plan']),
        async execute(args, exec) {
          const membership = ctx.agentTeams.membership(exec.agent);
          if (membership.role !== 'teammate') throw new Error(modelText('plan-gate.336'));
          const { role } = roleOf(exec.agent, membership);
          if (!role.planFirst) throw new Error(modelText('plan-gate.337', { 0: role.displayName }));
          const plan = text(args.plan, 8000, modelText('plan-gate.338'));
          plans.set(keyOf(membership), { status: 'pending', plan, at: Date.now() });
          await ctx.agentTeams.sendMessage(exec.agent, { target: 'lead', signal: exec.signal, content: [{ type: 'text',
            text: modelText('plan-gate.339', { 0: role.displayName, 1: membership.name, 2: REVIEW_TOOL, 3: membership.name, 4: plan }) }] });
          return modelText('plan-gate.340', { 0: STATUS.pending });
        },
      }));
      ctx.effect(() => ctx.tools.register({ name: REVIEW_TOOL, output,
        description: modelText('plan-gate.341'),
        parameters: params({
          role: { type: 'string', description: modelText('plan-gate.342') },
          approve: { type: 'boolean', description: modelText('plan-gate.343') },
          feedback: { type: 'string', description: modelText('plan-gate.344') },
        }, ['role', 'approve']),
        async execute(args, exec) {
          const membership = ctx.agentTeams.membership(exec.agent);
          if (membership.role !== 'lead') throw new Error(modelText('plan-gate.345'));
          const role = text(args.role, 64, modelText('plan-gate.346'));
          const plan = plans.get(keyOf(membership, role));
          if (!plan || plan.status !== 'pending') throw new Error(modelText('plan-gate.347', { 0: role }));
          if (args.approve !== true && args.approve !== false) throw new Error(modelText('plan-gate.348'));
          const feedback = args.feedback === undefined || args.feedback === '' ? undefined : text(args.feedback, 2000, modelText('plan-gate.349'));
          if (!args.approve && !feedback) throw new Error(modelText('plan-gate.350'));
          plans.set(keyOf(membership, role), { ...plan, status: args.approve ? 'approved' : 'rejected', feedback, at: Date.now() });
          await ctx.agentTeams.sendMessage(exec.agent, { target: role, signal: exec.signal, content: [{ type: 'text',
            text: args.approve ? modelText('plan-gate.351', { 0: feedback ? modelText('plan-gate.352', { 0: feedback }) : '' }) : modelText('plan-gate.353', { 0: SUBMIT_TOOL, 1: feedback }) }] });
          return modelText('plan-gate.354', { 0: args.approve ? modelText('plan-gate.355') : modelText('plan-gate.356'), 1: role });
        },
      }));
    },
  };
}
