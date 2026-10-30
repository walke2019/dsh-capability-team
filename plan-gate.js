// Plan-first teammates: a capability with `planFirst` submits a plan to the Lead and waits for approval before it may
// run execution tools. A new dispatch plan that assigns the role asks for a fresh plan, so one approval covers one task.
import { params } from './tool-schema.js';
import { resolveRole } from './config.js';
import { toolClass } from './workflow.js';
export const SUBMIT_TOOL = 'capability_submit_plan';
export const REVIEW_TOOL = 'capability_review_plan';
const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
const STATUS = { pending: '已提交，等待主控批准', approved: '已批准，可以执行', rejected: '被退回，按意见修改后重新提交' };
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}须为1–${max}字符`);
  return value.trim();
}
/** Pure decision for one teammate call under plan-first; returns a denial reason or undefined. */
export function planDenial(exec, role, plan, workflow) {
  if (!role.planFirst || exec.name === SUBMIT_TOOL || plan?.status === 'approved') return undefined;
  const kind = toolClass(exec.name, workflow);
  if (kind === 'analysis' || kind === 'coordination') return undefined;
  const state = plan ? `当前计划${STATUS[plan.status]}${plan.feedback ? `；主控意见：${plan.feedback}` : ''}` : '尚未提交计划';
  return `角色 ${role.displayName}（${role.capability}）须先调用 ${SUBMIT_TOOL} 提交计划并经主控批准，才能执行 ${exec.name}（${state}）。批准前只能做只读分析。`;
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
      return plan ? `${STATUS[plan.status]}${plan.feedback ? `（主控意见：${plan.feedback}）` : ''}` : `需先调用 ${SUBMIT_TOOL} 提交计划，经主控批准后才能执行`;
    },
    /** The Lead assigned these roles in a new dispatch plan: earlier approvals do not cover the new task. */
    reset(leadMembership, roles) {
      for (const role of roles) plans.delete(keyOf(leadMembership, role));
    },
    guard(exec) {
      const membership = ctx.agentTeams.tryMembership(exec.agent);
      if (membership?.role !== 'teammate') return undefined;
      let resolved;
      try { resolved = roleOf(exec.agent, membership); } catch { return undefined; } // Routing and the access guard report config errors.
      return planDenial(exec, resolved.role, plans.get(keyOf(membership)), resolved.effective.workflow);
    },
    register() {
      ctx.effect(() => ctx.tools.guard(exec => this.guard(exec)));
      ctx.effect(() => ctx.tools.register({ name: SUBMIT_TOOL, output,
        description: '需先提交计划的角色（团队上下文中标明）在执行修改前调用：写出要改哪些文件、怎么改、如何验证。计划发给主控，批准消息到达前只能做只读分析；被退回时按意见修改后重新提交。',
        parameters: params({ plan: { type: 'string', description: '完整计划：目标、要修改的文件与改法、验证方式、风险' } }, ['plan']),
        async execute(args, exec) {
          const membership = ctx.agentTeams.membership(exec.agent);
          if (membership.role !== 'teammate') throw new Error('只有队友提交计划；主控用 capability_dispatch_plan 制定派活计划');
          const { role } = roleOf(exec.agent, membership);
          if (!role.planFirst) throw new Error(`角色 ${role.displayName} 不需要提交计划，直接执行即可`);
          const plan = text(args.plan, 8000, '计划');
          plans.set(keyOf(membership), { status: 'pending', plan, at: Date.now() });
          await ctx.agentTeams.sendMessage(exec.agent, { target: 'lead', signal: exec.signal, content: [{ type: 'text',
            text: `【计划待批】${role.displayName}（${membership.name}）提交了执行计划，请审阅后调用 ${REVIEW_TOOL}（role=${membership.name}）批准或退回：\n\n${plan}` }] });
          return `计划已提交给主控，状态：${STATUS.pending}。在批准消息到达前不要修改文件或执行命令；可以结束本轮等待。`;
        },
      }));
      ctx.effect(() => ctx.tools.register({ name: REVIEW_TOOL, output,
        description: '主控审阅队友提交的执行计划：approve=true 批准后该队友才能执行修改；false 时退回并在 feedback 写明要改什么。结果会发给该队友。',
        parameters: params({
          role: { type: 'string', description: '提交计划的队友内部id' },
          approve: { type: 'boolean', description: 'true 批准；false 退回' },
          feedback: { type: 'string', description: '退回时必填：需要修改的地方；批准时可补充注意事项' },
        }, ['role', 'approve']),
        async execute(args, exec) {
          const membership = ctx.agentTeams.membership(exec.agent);
          if (membership.role !== 'lead') throw new Error('只有主控审批队友计划');
          const role = text(args.role, 64, '角色');
          const plan = plans.get(keyOf(membership, role));
          if (!plan || plan.status !== 'pending') throw new Error(`角色 ${role} 没有待审批的计划`);
          if (args.approve !== true && args.approve !== false) throw new Error('approve 必须为布尔值');
          const feedback = args.feedback === undefined || args.feedback === '' ? undefined : text(args.feedback, 2000, '意见');
          if (!args.approve && !feedback) throw new Error('退回计划时必须写明修改意见');
          plans.set(keyOf(membership, role), { ...plan, status: args.approve ? 'approved' : 'rejected', feedback, at: Date.now() });
          await ctx.agentTeams.sendMessage(exec.agent, { target: role, signal: exec.signal, content: [{ type: 'text',
            text: args.approve ? `【计划已批准】按计划执行${feedback ? `。注意：${feedback}` : ''}。` : `【计划被退回】请按以下意见修改后重新调用 ${SUBMIT_TOOL}：${feedback}` }] });
          return `已${args.approve ? '批准' : '退回'} ${role} 的计划，并通知该队友。`;
        },
      }));
    },
  };
}
