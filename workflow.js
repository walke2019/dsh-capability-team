import { m as modelText } from './i18n.js';
// Dispatch workflow: for each user request the Lead analyses the conversation, then either assigns
// registered roles or justifies handling it alone. A tool guard enforces the declared plan, so the
// Lead cannot silently do specialist work itself. All limits are project data (config.workflow).
import { fileLimitRules } from './file-limits.js';
import { tokenRuleText } from './token-discipline.js';
import { baseName } from './session-rotation.js';
import { arrayArg, planTasks } from './board-dispatch.js';
import { params } from './tool-schema.js';
import { accessSummary } from './access.js';

export const WORKFLOW_MODES = ['enforce', 'remind', 'off'];
const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };

/** Classify one tool name for the Lead under the given workflow policy. */
export const FREE_TOOL = 'capability_free_task';
const FREE_TOOL_TEXT = {
  none: modelText('workflow.608'),
  read: modelText('workflow.609'),
  write: modelText('workflow.610'),
};
const DECISION = { delegate: modelText('workflow.611'), free: modelText('workflow.612'), direct: modelText('workflow.613') };
const OWN_TOOLS = ['capability_dispatch_plan', 'capability_submit_plan', 'capability_review_plan', 'capability_task_budget', 'capability_member_override', 'capability_handoff', 'capability_rotate_member', 'capability_memory_search', 'capability_memory_write', 'capability_model_prefs'];
/** Hosts may expose tools as `mcp__<server>__<word>_<name>` (e.g. `brisk_spawn_teammate`); match on `<name>`. */
export function canonicalTool(name, workflow) {
  const raw = String(name ?? '').replace(/^mcp__.+?__/, '');
  const known = [FREE_TOOL, ...OWN_TOOLS, ...workflow.coordinationTools, ...workflow.analysisTools];
  if (known.includes(raw)) return raw;
  const tail = raw.slice(raw.indexOf('_') + 1);
  return raw.includes('_') && known.includes(tail) ? tail : raw;
}
export function toolClass(name, workflow) {
  name = canonicalTool(name, workflow);
  if (name === FREE_TOOL) return 'free';
  // The team's own planning tools always coordinate, whatever a project lists.
  if (OWN_TOOLS.includes(name) || workflow.coordinationTools.includes(name)) return 'coordination';
  if (workflow.analysisTools.includes(name)) return 'analysis';
  return 'execution';
}

/**
 * Pure decision for one Lead tool call; mutates `state` counters only when the call is allowed.
 * Returns a denial reason string, or undefined to allow.
 */
export function decide(state, exec, workflow) {
  const kind = toolClass(exec.name, workflow);
  const plan = state.plan;
  const replan = modelText('workflow.614');
  if (kind === 'coordination') {
    if (!['spawn_teammate', 'subagent', 'subagent_fork'].includes(canonicalTool(exec.name, workflow))) return undefined;
    const name = exec.arguments?.name;
    if (!plan) return modelText('workflow.615');
    if (plan.mode !== 'delegate' || !plan.assignments.some(a => a.role === name)) {
      return modelText('workflow.616', { 0: name, 1: planSummary(plan), 2: replan });
    }
    return undefined;
  }
  if (!plan) {
    if (kind === 'analysis' && state.analysisUsed < workflow.analysisBudget) { state.analysisUsed += 1; return undefined; }
    const why = kind === 'analysis' ? modelText('workflow.617', { 0: workflow.analysisBudget }) : modelText('workflow.618', { 0: exec.name });
    return modelText('workflow.619', { 0: why });
  }
  if (kind === 'free') {
    if (plan.mode === 'free') return undefined;
    return modelText('workflow.620', { 0: planSummary(plan), 1: replan });
  }
  if (kind === 'analysis') return undefined;
  if (plan.mode === 'free') {
    return modelText('workflow.621', { 0: FREE_TOOL, 1: exec.name, 2: replan });
  }
  if (plan.mode === 'delegate') {
    return modelText('workflow.622', { 0: planSummary(plan), 1: exec.name, 2: replan });
  }
  // Only the user's answer on the confirmation card sets this; plan fields supplied by the model never waive the budget.
  if (state.directConfirmed) return undefined;
  if (state.directUsed < workflow.directBudget) { state.directUsed += 1; return undefined; }
  return modelText('workflow.623', { 0: workflow.directBudget, 1: replan, 2: replan });
}

export function planSummary(plan) {
  if (!plan) return modelText('workflow.624');
  if (plan.mode === 'direct') return modelText('workflow.625', { 0: plan.reason });
  if (plan.mode === 'free') return modelText('workflow.626', { 0: plan.reason });
  return plan.assignments.map(a => `${a.displayName ?? a.role}(${a.role})`).join('、');
}

/** Validate a dispatch plan against the effective team configuration. */
export function validatePlan(args, effective) {
  const text = (v, max, label) => {
    if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(modelText('workflow.627', { 0: label, 1: max }));
    return v.trim();
  };
  const analysis = text(args.analysis, 4000, modelText('workflow.628'));
  if (!['direct', 'delegate', 'free'].includes(args.mode)) throw new Error(modelText('workflow.629'));
  const assignments = arrayArg(args.assignments) ?? [];
  if (!Array.isArray(assignments) || assignments.length > 20) throw new Error(modelText('workflow.630'));
  if (args.mode !== 'delegate') {
    if (assignments.length) throw new Error(modelText('workflow.631', { 0: args.mode }));
    const plan = { mode: args.mode, analysis, reason: text(args.reason, 500, modelText('workflow.632', { 0: args.mode })), assignments: [] };
    // userRequested stays out of the plan: only the user's answer, held in workflow state, can lift the budget.
    return plan;
  }
  if (!assignments.length) throw new Error(modelText('workflow.633'));
  const seen = new Set();
  const list = assignments.map((a, i) => {
    const role = text(a?.role, 64, modelText('workflow.634', { 0: i + 1 }));
    if (role === 'lead') throw new Error(modelText('workflow.635'));
    const entry = effective.roles[role];
    if (!entry) throw new Error(modelText('workflow.636', { 0: role, 1: Object.keys(effective.roles).filter(r => r !== 'lead').join('、') }));
    if (seen.has(role)) throw new Error(modelText('workflow.637', { 0: role }));
    seen.add(role);
    if (a.complexity !== undefined && !['simple','medium','complex'].includes(a.complexity)) throw new Error(modelText('workflow.638'));
    return { role, complexity: a.complexity ?? 'medium', displayName: entry.displayName, capability: entry.capability, task: text(a.task, 2000, modelText('workflow.639', { 0: role })) };
  });
  return { mode: 'delegate', analysis, ...(args.reason ? { reason: text(args.reason, 500, modelText('workflow.640')) } : {}), assignments: list };
}

import { ownsCapabilityTeam } from './preset-guard.js';
export function createWorkflow(ctx, team, { onDelegate, onAssignments, dispatchConfirm, rotation, board } = {}) {
  const states = new WeakMap();
  const state = agent => {
    if (!states.has(agent)) states.set(agent, { plan: undefined, analysisUsed: 0, directUsed: 0 });
    return states.get(agent);
  };
  const isLead = agent => ownsCapabilityTeam(ctx, agent, team.native) && team.native.identity(agent)?.role === 'lead';
  const effectiveOf = agent => {
    const project = team.pinned(agent);
    return project ? team.loadSync(project, agent).effective : team.base;
  };
  return {
    state,
    /** A new user request starts a new dispatch cycle; teammate reports keep the current plan. */
    onClaimed(agent, message) {
      if (message?.source?.kind !== 'user' || !isLead(agent)) return;
      states.set(agent, { plan: undefined, analysisUsed: 0, directUsed: 0 });
      const invalidation=onAssignments?.(agent, []);
      void invalidation?.catch?.(() => {}); // a newer dispatch may supersede this invalidation
    },
    guard(exec) {
      if (!isLead(exec.agent)) return undefined;
      let effective;
      try { effective = effectiveOf(exec.agent); }
      catch (error) { return modelText('workflow.641', { 0: error.message }); }
      const workflow = effective.workflow;
      if (workflow.mode !== 'enforce') return undefined;
      // A successor planned by capability_rotate_member stands in for its assigned role.
      const name = exec.arguments?.name;
      if (['spawn_teammate', 'subagent', 'subagent_fork'].includes(canonicalTool(exec.name, workflow)) && rotation?.plannedSuccessor(exec.agent.id, name)) {
        const plan = state(exec.agent).plan;
        if (plan?.mode === 'delegate' && plan.assignments.some(a => a.role === baseName(name))) return undefined;
      }
      return decide(state(exec.agent), exec, workflow);
    },
    /** Model-facing status line for the Lead's team context. */
    status(agent, workflow) {
      if (workflow.mode === 'off') return undefined;
      const s = state(agent);
      const head = workflow.mode === 'enforce' ? modelText('workflow.642') : modelText('workflow.643');
      // Budgets only, no running counters: a counter changes every step and would resend the whole runtime
      // context snapshot each time. The guard still enforces the limits and says how many were used.
      const direct = s.plan?.mode !== 'direct' ? '' : s.directConfirmed ? modelText('workflow.644') : modelText('workflow.645', { 0: workflow.directBudget });
      const plan = s.plan ? modelText('workflow.646', { 0: planSummary(s.plan), 1: direct })
        : modelText('workflow.647', { 0: workflow.analysisBudget });
      return modelText('workflow.648', { 0: head, 1: plan, 2: workflow.freeTools });
    },
    register() {
      ctx.effect(() => ctx.tools.guard(exec => this.guard(exec)));
      ctx.on('agent/inbox/claimed', ({ agent, message }) => this.onClaimed(agent, message));
      ctx.effect(() => ctx.tools.register({ name: 'capability_dispatch_plan', output,
        description: modelText('workflow.649'),
        parameters: params({
          analysis: { type: 'string', description: modelText('workflow.650') },
          mode: { type: 'string', enum: ['delegate', 'free', 'direct'], description: modelText('workflow.651') },
          reason: { type: 'string', description: modelText('workflow.652') },
          userRequested: { type: 'boolean', description: modelText('workflow.653') },
          assignments: { type: 'array', description: modelText('workflow.654'), items: params({
            role: { type: 'string', description: modelText('workflow.655') },
            complexity: { type: 'string', enum: ['simple','medium','complex'], description: modelText('workflow.656') },
            task: { type: 'string', description: modelText('workflow.657') },
            tasks: { type: 'array', description: modelText('workflow.658'), items: params({
              key: { type: 'string', description: modelText('workflow.659') },
              subject: { type: 'string', description: modelText('workflow.660') },
              description: { type: 'string', description: modelText('workflow.661') },
              write_scopes: { type: 'array', items: { type: 'string' }, description: modelText('workflow.662') },
              blocked_by: { type: 'array', items: { type: 'string' }, description: modelText('workflow.663') },
            }, ['subject']) },
          }, ['role', 'task']) },
        }, ['analysis', 'mode']),
        async execute(args, exec) {
          if (!isLead(exec.agent)) throw new Error(modelText('workflow.664'));
          const { effective, policy } = await team.load(exec.agent);
          const plan = validatePlan(args, effective);
          // Board subtasks are validated before the user is asked, so a malformed split never reaches the card.
          const rawTasks = plan.mode === 'delegate' ? Object.fromEntries((arrayArg(args.assignments) ?? []).filter(a => a?.tasks !== undefined).map(a => [String(a.role).trim(), a.tasks])) : {};
          if (plan.mode === 'delegate') planTasks(plan.assignments, rawTasks);
          // The user confirms roles and models first; a cancel throws, so no plan exists and nobody is dispatched.
          const confirmation = plan.mode === 'delegate' && dispatchConfirm
            ? await dispatchConfirm.confirm(exec, plan, effective, policy, effective.workflow.confirmDispatch) : null;
          // Lifting the Lead's step limit is the user's call and lasts until their next message.
          const cycle = state(exec.agent);
          const directConfirmed = plan.mode === 'direct' && args.userRequested === true && effective.workflow.mode === 'enforce' && dispatchConfirm
            ? await dispatchConfirm.confirmDirect(exec, plan) : false;
          if (directConfirmed && state(exec.agent) !== cycle) throw new Error(modelText('workflow.665'));
          const s = state(exec.agent);
          s.plan = plan;
          s.directConfirmed = directConfirmed;
          if (plan.mode === 'delegate') onDelegate?.(team.native.identity(exec.agent), plan.assignments.map(a => a.role));
          await onAssignments?.(exec.agent, plan.mode === 'delegate' ? plan.assignments : []);
          // Structured result: the model reads the fields, the Web card renders them without parsing prose.
          const result = { mode: plan.mode, decision: DECISION[plan.mode], analysis: plan.analysis, ...(plan.reason ? { reason: plan.reason } : {}) };
          if (plan.mode === 'direct') {
            Object.assign(result, effective.workflow.mode !== 'enforce'
              ? { directBudget: null, directUsed: s.directUsed, next: modelText('workflow.native') }
              : directConfirmed
              ? { directBudget: null, directUsed: s.directUsed, confirmed: { by: 'user', scope: 'turn' }, next: modelText('workflow.666') }
              : { directBudget: effective.workflow.directBudget, directUsed: s.directUsed, next: modelText('workflow.667', { 0: effective.workflow.directBudget }) });
          } else if (plan.mode === 'free') {
            Object.assign(result, { freeTools: effective.workflow.freeTools,
              next: modelText('workflow.668', { 0: FREE_TOOL_TEXT[effective.workflow.freeTools] }) });
          } else {
            result.assignments = plan.assignments.map(a => {
              const c = effective.capabilities[a.capability];
              const limits = accessSummary(c.access);
              const route = confirmation?.routes.find(r => r.role === a.role);
              const model = route?.primary ? `${route.primary.provider}/${route.primary.model}` : c.provider ? `${c.provider}/${c.model}` : modelText('workflow.669');
              const fallbacks = (route?.fallbacks ?? c.fallbacks ?? []).slice(0, 3).map(f => `${f.provider}/${f.model}`);
              return { role: a.role, complexity: a.complexity, estimatedSteps: {simple:15,medium:40,complex:80}[a.complexity], displayName: a.displayName, capability: a.capability, model, fallbacks, ...(limits ? { access: limits } : {}),
                ...(c.planFirst ? { planFirst: modelText('workflow.670') } : {}), task: a.task };
            });
            result.next = modelText('workflow.671');
          }
          if (plan.mode !== 'free' && (effective.workflow.fileLimits || effective.workflow.tokens)) result.fileRules = [fileLimitRules(effective.workflow.fileLimits), tokenRuleText(effective.workflow.tokens)].filter(Boolean).join('\n');
          if (plan.mode === 'delegate' && board) {
            try {
              const byRole = await board.create(exec.agent, plan, rawTasks);
              if (byRole) {
                for (const a of result.assignments) a.boardTasks = byRole[a.role] ?? [];
                result.next = modelText('workflow.672');
              }
            } catch (error) { result.boardError = modelText('workflow.673', { 0: error.message }); }
          }
          if (confirmation?.asked) result.confirmed = { by: 'user', scope: confirmation.scope, changed: confirmation.routes.filter(r => r.changed).map(r => r.role) };
          return JSON.stringify(result);
        },
      }));
    },
  };
}
