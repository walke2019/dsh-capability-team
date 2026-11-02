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
  none: '本项目免费模型没有工具，只能看到 prompt 中的文字',
  read: '本项目免费模型可读取和搜索项目文件，不能修改文件或执行命令',
  write: '本项目免费模型可读取、新建和编辑项目文件，不能执行命令、联网或访问项目外路径',
};
const DECISION = { delegate: '指派队友', free: '交给免费模型', direct: '主控自行处理' };
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
  const replan = '重新调用 capability_dispatch_plan';
  if (kind === 'coordination') {
    if (canonicalTool(exec.name, workflow) !== 'spawn_teammate') return undefined;
    const name = exec.arguments?.name;
    if (!plan) return `创建队友前先调用 capability_dispatch_plan：分析本次需求，指派合适的已登记角色（角色与适用场景见团队上下文的名册）。`;
    if (plan.mode !== 'delegate' || !plan.assignments.some(a => a.role === name)) {
      return `队友 ${name} 不在本轮指派计划中（当前：${planSummary(plan)}）。需要该角色时先${replan}把它加入指派。`;
    }
    return undefined;
  }
  if (!plan) {
    if (kind === 'analysis' && state.analysisUsed < workflow.analysisBudget) { state.analysisUsed += 1; return undefined; }
    const why = kind === 'analysis' ? `指派前的只读分析已用满 ${workflow.analysisBudget} 次` : `${exec.name} 属于执行类操作`;
    return `${why}。主控必须先调用 capability_dispatch_plan：分析用户这次的需求涉及哪些能力，指派最合适的已登记角色（角色与适用场景见团队上下文的名册）；长篇纯文本（总结、翻译、起草、整理给定材料）选 free 交给免费模型；只有简单问答或一两步即可完成的小事才选择 direct 并说明理由。用户明确要求主控亲自完成时，选择 direct 并传 userRequested=true，由用户在确认卡片上放行。`;
  }
  if (kind === 'free') {
    if (plan.mode === 'free') return undefined;
    return `本轮计划为 ${planSummary(plan)}，不是 free。需要把长篇纯文本交给免费模型时，先${replan}选择 free。`;
  }
  if (kind === 'analysis') return undefined;
  if (plan.mode === 'free') {
    return `本轮已选择 free：主控只调用 ${FREE_TOOL} 转交并验收结果，不直接执行 ${exec.name}。需要动手操作时，${replan}改为 direct 或 delegate。`;
  }
  if (plan.mode === 'delegate') {
    return `本轮已指派给 ${planSummary(plan)}，主控只负责分派、协调与验收，不直接执行 ${exec.name}。把这项操作作为任务交给对应队友（send_message 或看板任务）；需要验证时交给测试角色。确需亲自处理时，${replan}改为 direct 并说明理由。`;
  }
  // Only the user's answer on the confirmation card sets this; plan fields supplied by the model never waive the budget.
  if (state.directConfirmed) return undefined;
  if (state.directUsed < workflow.directBudget) { state.directUsed += 1; return undefined; }
  return `主控自行处理的执行操作已达本轮上限 ${workflow.directBudget} 次，说明这不是一两步的小事。请${replan}，把剩余工作指派给合适的队友。用户明确要求主控亲自完成时，${replan}并传 userRequested=true，经用户确认后才放开。`;
}

export function planSummary(plan) {
  if (!plan) return '未规划';
  if (plan.mode === 'direct') return `主控自行处理（${plan.reason}）`;
  if (plan.mode === 'free') return `免费模型处理（${plan.reason}）`;
  return plan.assignments.map(a => `${a.displayName ?? a.role}(${a.role})`).join('、');
}

/** Validate a dispatch plan against the effective team configuration. */
export function validatePlan(args, effective) {
  const text = (v, max, label) => {
    if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`${label}须为1–${max}字符`);
    return v.trim();
  };
  const analysis = text(args.analysis, 4000, '需求分析');
  if (!['direct', 'delegate', 'free'].includes(args.mode)) throw new Error('mode 须为 delegate（指派队友）、free（长篇纯文本交给免费模型）或 direct（主控自行处理）');
  const assignments = arrayArg(args.assignments) ?? [];
  if (!Array.isArray(assignments) || assignments.length > 20) throw new Error('assignments 须为不超过20项的数组');
  if (args.mode !== 'delegate') {
    if (assignments.length) throw new Error(`${args.mode} 模式不能同时指派队友；需要队友时使用 delegate`);
    const plan = { mode: args.mode, analysis, reason: text(args.reason, 500, `${args.mode} 模式的理由`), assignments: [] };
    // userRequested stays out of the plan: only the user's answer, held in workflow state, can lift the budget.
    return plan;
  }
  if (!assignments.length) throw new Error('delegate 模式至少指派一个角色');
  const seen = new Set();
  const list = assignments.map((a, i) => {
    const role = text(a?.role, 64, `第${i + 1}项指派的角色`);
    if (role === 'lead') throw new Error('不能把任务指派给主控自己');
    const entry = effective.roles[role];
    if (!entry) throw new Error(`角色 ${role} 未在当前项目团队配置中登记；可用：${Object.keys(effective.roles).filter(r => r !== 'lead').join('、')}。需要新角色时先加载 project-role-theme 技能经用户确认登记`);
    if (seen.has(role)) throw new Error(`角色 ${role} 重复指派；把同一角色的工作合并为一项`);
    seen.add(role);
    if (a.complexity !== undefined && !['simple','medium','complex'].includes(a.complexity)) throw new Error('无效 complexity');
    return { role, complexity: a.complexity ?? 'medium', displayName: entry.displayName, capability: entry.capability, task: text(a.task, 2000, `角色 ${role} 的任务`) };
  });
  return { mode: 'delegate', analysis, ...(args.reason ? { reason: text(args.reason, 500, '理由') } : {}), assignments: list };
}

import { ownsCapabilityTeam } from './preset-guard.js';
export function createWorkflow(ctx, team, { onDelegate, onAssignments, dispatchConfirm, rotation, board } = {}) {
  const states = new WeakMap();
  const state = agent => {
    if (!states.has(agent)) states.set(agent, { plan: undefined, analysisUsed: 0, directUsed: 0 });
    return states.get(agent);
  };
  const isLead = agent => ownsCapabilityTeam(ctx, agent) && ctx.agentTeams.tryMembership(agent)?.role === 'lead';
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
      catch (error) { return `团队配置读取失败，已停止执行：${error.message}`; }
      const workflow = effective.workflow;
      if (workflow.mode !== 'enforce') return undefined;
      // A successor planned by capability_rotate_member stands in for its assigned role.
      const name = exec.arguments?.name;
      if (canonicalTool(exec.name, workflow) === 'spawn_teammate' && rotation?.plannedSuccessor(exec.agent.id, name)) {
        const plan = state(exec.agent).plan;
        if (plan?.mode === 'delegate' && plan.assignments.some(a => a.role === baseName(name))) return undefined;
      }
      return decide(state(exec.agent), exec, workflow);
    },
    /** Model-facing status line for the Lead's team context. */
    status(agent, workflow) {
      if (workflow.mode === 'off') return undefined;
      const s = state(agent);
      const head = workflow.mode === 'enforce' ? '工作流约束（强制）' : '工作流约束（提醒）';
      // Budgets only, no running counters: a counter changes every step and would resend the whole runtime
      // context snapshot each time. The guard still enforces the limits and says how many were used.
      const direct = s.plan?.mode !== 'direct' ? '' : s.directConfirmed ? '，用户已确认主控亲自完成，本轮不限执行次数' : `，自行执行上限 ${workflow.directBudget} 次`;
      const plan = s.plan ? `本次需求的指派：${planSummary(s.plan)}${direct}`
        : `本次需求尚未指派：先调用 capability_dispatch_plan（指派前最多只读分析 ${workflow.analysisBudget} 次）`;
      return `${head}：${plan}。免费模型工具级别：${workflow.freeTools}`;
    },
    register() {
      ctx.effect(() => ctx.tools.guard(exec => this.guard(exec)));
      ctx.on('agent/inbox/claimed', ({ agent, message }) => this.onClaimed(agent, message));
      ctx.effect(() => ctx.tools.register({ name: 'capability_dispatch_plan', output,
        description: '主控处理每个新的用户需求时首先调用：分析对话中的需求涉及哪些能力，按性质分流——多步骤或专业任务指派已登记角色（delegate）；长篇纯文本（总结、翻译、起草、整理给定材料）以及项目允许范围内的读写文件小任务交给免费模型（free，不含密钥或敏感内容，不能执行命令）；需要动手的一两步小事或两三句能答的问答由主控自己处理（direct）。用户明确要求主控亲自完成时，选 direct 并传 userRequested=true，用户确认后本轮不限执行次数。计划对用户可见，并约束本轮后续操作：delegate 时主控只创建计划内的队友并协调验收；free 时只能调用 capability_free_task；direct 时自行执行次数有上限，只有用户在确认卡片上放行才能解除。需求变化时可再次调用替换计划。',
        parameters: params({
          analysis: { type: 'string', description: '需求分析：用户要的结果、涉及的领域与能力、复杂度、可并行的部分' },
          mode: { type: 'string', enum: ['delegate', 'free', 'direct'], description: 'delegate=指派队友；free=长篇纯文本交给免费模型；direct=主控自行处理（简单问答、一两步的小事，或用户明确要求主控亲自完成）' },
          reason: { type: 'string', description: 'free 与 direct 时必填：为什么这样分流' },
          userRequested: { type: 'boolean', description: 'direct 时可选：用户明确要求主控亲自完成时传 true。会向用户弹出确认，用户允许后本轮不限执行次数；用户拒绝则计划不生效' },
          assignments: { type: 'array', description: 'delegate 时必填：每个角色一项，role 用团队名册中的内部id', items: params({
            role: { type: 'string', description: '团队名册中的内部id，不用显示名' },
            complexity: { type: 'string', enum: ['simple','medium','complex'], description: '任务复杂度，默认medium：15/40/80步' },
            task: { type: 'string', description: '交给该角色的具体任务、交付物与验收标准' },
            tasks: { type: 'array', description: '可选：把这个角色的工作拆成看板子任务（会直接建在 DSH 团队看板上）。不填则整项作为一个看板任务', items: params({
              key: { type: 'string', description: '本计划内唯一的短标识，供 blocked_by 引用' },
              subject: { type: 'string', description: '子任务标题' },
              description: { type: 'string', description: '子任务说明与验收标准' },
              write_scopes: { type: 'array', items: { type: 'string' }, description: '会修改的项目内相对路径（文件或目录）；并行任务的写入范围不要重叠' },
              blocked_by: { type: 'array', items: { type: 'string' }, description: '必须先完成的子任务 key（只能引用计划中排在前面的子任务）' },
            }, ['subject']) },
          }, ['role', 'task']) },
        }, ['analysis', 'mode']),
        async execute(args, exec) {
          if (!isLead(exec.agent)) throw new Error('只有主控制定指派计划；子角色完成自己的任务并向 lead 汇报');
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
          if (directConfirmed && state(exec.agent) !== cycle) throw new Error('确认期间用户发来了新消息，这次放行已失效。请按新消息重新制定计划。');
          const s = state(exec.agent);
          s.plan = plan;
          s.directConfirmed = directConfirmed;
          if (plan.mode === 'delegate') onDelegate?.(ctx.agentTeams.membership(exec.agent), plan.assignments.map(a => a.role));
          await onAssignments?.(exec.agent, plan.mode === 'delegate' ? plan.assignments : []);
          // Structured result: the model reads the fields, the Web card renders them without parsing prose.
          const result = { mode: plan.mode, decision: DECISION[plan.mode], analysis: plan.analysis, ...(plan.reason ? { reason: plan.reason } : {}) };
          if (plan.mode === 'direct') {
            Object.assign(result, directConfirmed
              ? { directBudget: null, directUsed: s.directUsed, confirmed: { by: 'user', scope: 'turn' }, next: '用户已确认由主控亲自完成：本轮不限执行次数，用户发下一条消息时恢复限制。文件规则和权限不变。' }
              : { directBudget: effective.workflow.directBudget, directUsed: s.directUsed, next: `主控自行处理，本轮执行上限 ${effective.workflow.directBudget} 次；超出后须改为指派。` });
          } else if (plan.mode === 'free') {
            Object.assign(result, { freeTools: effective.workflow.freeTools,
              next: `调用 capability_free_task，把完整材料与要求放进 prompt；${FREE_TOOL_TEXT[effective.workflow.freeTools]}。主控只验收结果（有文件改动时只读核对改动）；免费模型全部不可用时如实报告，不改用付费模型。` });
          } else {
            result.assignments = plan.assignments.map(a => {
              const c = effective.capabilities[a.capability];
              const limits = accessSummary(c.access);
              const route = confirmation?.routes.find(r => r.role === a.role);
              const model = route?.primary ? `${route.primary.provider}/${route.primary.model}` : c.provider ? `${c.provider}/${c.model}` : '会话模型';
              const fallbacks = (route?.fallbacks ?? c.fallbacks ?? []).slice(0, 3).map(f => `${f.provider}/${f.model}`);
              return { role: a.role, complexity: a.complexity, estimatedSteps: {simple:15,medium:40,complex:80}[a.complexity], displayName: a.displayName, capability: a.capability, model, fallbacks, ...(limits ? { access: limits } : {}),
                ...(c.planFirst ? { planFirst: '执行前会提交计划，需主控用 capability_review_plan 批准' } : {}), task: a.task };
            });
            result.next = '已存在的队友用 send_message 派发，不存在的用 spawn_teammate（name 用内部id）创建；可并行的同时派发，每项任务在看板建一条即可；有前置依赖的任务等前置完成后再派发，不提前发“等我通知”。派发时要求队友完成后只汇报一次最终结果、不发进度通报。之后用 wait_agent（timeoutMs=600000）等待，醒来只处理最终结果、阻塞或决策请求；主控只协调与验收，不亲自执行。';
          }
          if (plan.mode !== 'free' && (effective.workflow.fileLimits || effective.workflow.tokens)) result.fileRules = [fileLimitRules(effective.workflow.fileLimits), tokenRuleText(effective.workflow.tokens)].filter(Boolean).join('\n');
          if (plan.mode === 'delegate' && board) {
            try {
              const byRole = await board.create(exec.agent, plan, rawTasks);
              if (byRole) {
                for (const a of result.assignments) a.boardTasks = byRole[a.role] ?? [];
                result.next = '已按计划在 DSH 团队看板上建好任务（见各角色的 boardTasks）。已存在的队友已自动分到可开始的任务，用 send_message 通知它；不存在的用 spawn_teammate（name 用内部id）创建，开工时插件会把它的任务自动分给它。消息里写明任务编号，并要求按看板流程：认领 → 执行 → complete，只改写入范围内的文件，完成后只汇报一次最终结果。被依赖挡住的任务只留在看板上，先不要发给对应队友，也不要发“等我通知再开始”；等前置任务完成后再用 send_message 派发（队友空闲时消息会自动唤醒它）。之后用 wait_agent（timeoutMs=600000）等待；收尾前用 team_task_list 确认没有进行中的任务。';
              }
            } catch (error) { result.boardError = `看板任务创建失败：${error.message}；请改用 team_task_create 手动建任务`; }
          }
          if (confirmation?.asked) result.confirmed = { by: 'user', scope: confirmation.scope, changed: confirmation.routes.filter(r => r.changed).map(r => r.role) };
          return JSON.stringify(result);
        },
      }));
    },
  };
}
