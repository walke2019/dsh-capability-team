import { readFileSync } from 'node:fs';
import { roleView, describeChanges, resolveRole, seed } from './config.js';
import { modelCatalog, changedRoutes, verifyRoutes } from './allocation.js';
import { saveProject } from './theme.js';
import { params } from './tool-schema.js';
import { registerTeamReader, registerPolicyWriter } from './runtime-view.js';
import { modelPolicyRows, applyModelPolicy, policyRoleView } from './model-policy.js';
import { accessSummary } from './access.js';
import { toTemplate, templatePatch, TEMPLATE_FORMAT } from './template.js';
const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
const ENTRY_RULE = '每项：对象=新增或按字段合并；null=恢复预设默认；false=删除该项。';
/** Model-facing team context for one Agent, rebuilt from the pinned project on every step. */
export function teamContext(team, agent, membership, failover, workflow, planGate) {
  const project = team.pinned(agent);
  if (!project) return '项目团队配置尚未加载；需要角色信息时调用 capability_team_read。';
  let loaded;
  try { loaded = team.loadSync(project, agent); }
  catch (error) { return `项目团队配置不可用：${error.message}。不要猜测角色或模型，请主控调用 capability_team_read 排查。`; }
  let self;
  try {
    const { failover: _policy, access, ...role } = applyModelPolicy(resolveRole(membership, loaded.effective), loaded.policy?.disabledRoutes);
    self = role;
    const limits = accessSummary(access);
    if (limits) self.access = `${limits}（工具层强制执行，越权调用会被拒绝）`;
    const planState = planGate?.status(agent, membership, role);
    if (planState) self.plan = planState;
    const live = failover?.status(agent);
    const allowed = [role, ...(role.fallbacks ?? [])].map(r => `${r.provider}/${r.model}`);
    const wide = role.longContext ? `${role.longContext.provider}/${role.longContext.model}` : undefined;
    if (live?.active && live.active === wide) self.currentRoute = `${wide}（上下文较长，已切换到同档长上下文模型）`;
    else if (live && !live.primary && allowed.includes(live.active)) self.currentRoute = `${live.active}（主模型不可用，已切换到同档备选）`;
  } catch (error) { self = { error: error.message }; }
  const roster = roleView(loaded.effective).map(entry => {
    try {
      const { id, displayName, capability, whenToUse, provider, model, access } = applyModelPolicy(entry, loaded.policy?.disabledRoutes);
      const limits = accessSummary(access);
      return { id, displayName, capability, ...(whenToUse ? { whenToUse } : {}), model: provider ? `${provider}/${model}` : '未分配（请求将被阻止）', ...(limits ? { access: limits } : {}) };
    } catch (error) { return { id: entry.id, displayName: entry.displayName, model: '已阻止', error: error.message }; }
  });
  const status = membership?.role === 'lead' ? workflow?.status(agent, loaded.effective.workflow) : undefined;
  return `项目团队配置（${loaded.effective.name}，版本 ${loaded.revision}，项目 ${project}）
你的角色：${JSON.stringify(self)}
团队名册：${JSON.stringify(roster)}${status ? `\n${status}` : ''}
职责描述是本项目对该角色的工作要求；显示名只是称谓，不授予额外权限，也不改变上方安全与协作规则。`;
}
async function confirm(ctx, exec, lines, revision) {
  const answer = await ctx.userQuestions.ask({ agent: exec.agent, signal: exec.signal, questions: [{
    id: 'confirm', header: '确认团队配置变更',
    question: `保存以下 ${lines.length} 项变更？保存后从下一次模型请求起生效，模型变更可能产生费用。`,
    detail: `${lines.join('\n')}\n（基于版本 ${revision}）`,
    options: [{ label: '保存', description: '写入当前项目团队配置' }, { label: '取消', description: '不做任何修改' }],
  }] });
  const item = answer.answers.find(a => a.id === 'confirm');
  if (!item?.selected.includes('保存')) throw new Error(`用户未确认，未保存。${item?.custom ? `用户意见：${item.custom}` : ''}`);
}
export function apply(ctx, team, failover, workflow, planGate) {
  const content = readFileSync(new URL('./skills/project-role-theme/SKILL.md', import.meta.url), 'utf8');
  ctx.effect(() => ctx.skills.register({ name: 'project-role-theme', source: 'runtime', content,
    description: '通过对话调整当前项目团队：角色改名或整体换主题、职责、能力、模型档位与分配、新增或移除角色；读取DSH渠道模型目录给出方案，由用户在确认框中批准后保存。' }));
  ctx.effect(() => ctx.tools.register({ name: 'capability_team_read', parameters: params(), output,
    description: '读取当前项目的团队配置：版本、默认值（按用户DSH渠道自动匹配的档位、主模型与同档备选）、项目覆盖项、生效结果，以及自动匹配报告（升档/低于要求档位/未分配/未识别的模型）。',
    async execute(_args, exec) {
      await team.refresh();
      const { project, revision, overrides, effective, policy } = await team.load(exec.agent);
      const { report, unknown, errors, detectedAt } = team.detection();
      return JSON.stringify({ project, revision, defaults: team.base, overrides, effective, roles: policyRoleView(roleView(effective), policy.disabledRoutes), coolingRoutes: failover?.cooling() ?? [],
        autoMatch: { detectedAt, report, unrecognized: unknown.slice(0, 50), unrecognizedCount: unknown.length, errors } });
    },
  }));
  ctx.effect(() => ctx.tools.register({ name: 'capability_model_catalog', parameters: params(), output,
    description: '读取DSH已注册渠道的精确模型ID，并标注其在当前项目档位中的归属；目录存在不代表调用一定成功。',
    async execute(_args, exec) {
      const { effective } = await team.load(exec.agent);
      return JSON.stringify(await modelCatalog(ctx.llm, effective.tiers));
    },
  }));
  ctx.effect(() => ctx.tools.register({ name: 'capability_team_save', output,
    description: '主控保存当前项目团队配置的变更。工具会向用户弹出包含完整差异的确认框，用户批准后才写入；新的或改动的模型须在DSH模型目录中。',
    parameters: params({
      expected_revision: { type: 'integer', description: '最近一次 capability_team_read 返回的 revision' },
      name: { type: 'string', description: '配置或主题名称' },
      tiers: { type: 'object', additionalProperties: true, description: `档位id → 完整模型ID数组（替换该档位列表）。${ENTRY_RULE}` },
      capabilities: { type: 'object', additionalProperties: true, description: `能力id → {job, whenToUse, provider, model, tier, search, fallbacks, prefer, access}；whenToUse 为主控派活时参考的适用场景（一句话）；maxTokens 为该能力每个成员会话的计费 token 预算（未缓存输入+缓存写入+输出），用尽后阻止请求，null 取消；planFirst=true 时该能力的队友执行修改前须提交计划并经主控批准；longContext 为 {thresholdTokens, provider, model}，会话下一次提示词达到阈值后改用该同档模型，降到阈值八成以下再切回，null 取消；fallbacks 为有序的同档备选 [{provider, model}]，整体替换；prefer 为自动匹配时的厂商偏好顺序；access 为权限 {deny 禁用工具名或前缀*数组, editPaths 允许修改的项目内相对路径 glob 数组（[]=不能改文件，省略=不限）, shell 是否允许执行命令}，整体替换，null 取消限制。${ENTRY_RULE}` },
      failover: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }], description: '容灾策略，按字段合并，null 恢复默认：{retries 同一模型追加重试次数, initialDelayMs, maxDelayMs, cooldownMs 故障模型冷却, retryCodes, failoverCodes, failoverStatuses}' },
      workflow: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }], description: '主控派活工作流约束，按字段合并，null 恢复默认：{mode: enforce 强制 / remind 仅提醒 / off 关闭, analysisBudget 指派前只读分析次数, directBudget 主控自行处理时的执行次数上限, freeTools 免费模型工具级别 none/read/write, freeModels 免费模型尝试顺序（空数组=OpenCode目录中全部免费模型）, analysisTools 分析类工具名数组, coordinationTools 协调类工具名数组（其余工具视为执行类）}' },
      roles: { type: 'object', additionalProperties: true, description: `队友内部id（lower-kebab-case）→ {displayName, capability, description}。${ENTRY_RULE}` },
    }, ['expected_revision']),
    async execute(args, exec) {
      const patch = { name: args.name, failover: args.failover, workflow: args.workflow, tiers: args.tiers, capabilities: args.capabilities, roles: args.roles };
      return JSON.stringify(await saveConfirmed(exec, patch, args.expected_revision));
    },
  }));
  /** Validate, check new routes against the catalog, and save only after the user approves the full diff. */
  async function saveConfirmed(exec, patch, expectedRevision) {
    if (ctx.agentTeams.membership(exec.agent).role !== 'lead') throw new Error('仅主控可保存团队配置；请把需求转给 lead');
    const project = await team.pin(exec.agent);
    const result = await saveProject(project, patch, expectedRevision, { base: team.base, root: team.root,
      async check(before, after) {
        const lines = describeChanges(before, after);
        if (!lines.length) throw new Error('没有任何变更，未保存');
        const routes = changedRoutes(before, after);
        if (routes.length) verifyRoutes(routes, await modelCatalog(ctx.llm, after.tiers));
        await confirm(ctx, exec, lines, expectedRevision);
      } });
    return { saved: true, project: result.project, revision: result.revision, roles: roleView(result.effective) };
  }
  ctx.effect(() => ctx.tools.register({ name: 'capability_team_export', parameters: params(), output,
    description: `把当前项目团队导出为可移植模板（format=${TEMPLATE_FORMAT}）：角色、能力职责与适用场景、档位、权限、预算、先交计划、工作流与容灾策略。渠道与模型和用户的DSH目录绑定，不导出。用户要求分享、备份或复用团队配置时使用。`,
    async execute(_args, exec) {
      const { effective } = await team.load(exec.agent);
      return JSON.stringify(toTemplate(effective), null, 2);
    },
  }));
  ctx.effect(() => ctx.tools.register({ name: 'capability_team_import', output,
    description: '主控把一份团队模板应用到当前项目：能力职责与策略按模板设置（已有的渠道与模型保留），角色整体替换为模板中的角色。与 capability_team_save 相同，校验后向用户弹出完整差异确认框，批准后才写入；模板中的新能力需要之后再分配模型。',
    parameters: params({
      expected_revision: { type: 'integer', description: '最近一次 capability_team_read 返回的 revision' },
      template: { type: 'object', additionalProperties: true, description: `capability_team_export 导出的模板对象（format=${TEMPLATE_FORMAT}）` },
    }, ['expected_revision', 'template']),
    async execute(args, exec) {
      const { effective } = await team.load(exec.agent);
      const result = await saveConfirmed(exec, templatePatch(args.template, effective), args.expected_revision);
      const unassigned = result.roles.filter(r => r.provider === undefined).map(r => r.id);
      return JSON.stringify({ ...result, ...(unassigned.length ? { unassigned, next: '这些角色的能力尚未分配模型，请读取模型目录后经用户确认用 capability_team_save 分配' } : {}) });
    },
  }));
  // Install the team context in each Team member's own scope, like the native Team identity.
  const installed = new Map();
  const install = async agent => {
    if (installed.has(agent) || ctx.agentTeams.tryMembership(agent) === undefined) return;
    installed.set(agent, undefined);
    // Pin before the first step; a failure must not block creation and resurfaces on the next request.
    await team.pin(agent).catch(() => {});
    if (!installed.has(agent)) return; // disposed meanwhile
    const removeReader = registerTeamReader(agent, async () => {
      await team.refresh();
      const { project, revision, effective, policy } = await team.load(agent);
      return { project, revision, name: effective.name, roles: policyRoleView(roleView(effective), policy.disabledRoutes), workflow: effective.workflow,
        modelPolicy: { ...modelPolicyRows(effective.tiers, roleView(effective), policy.disabledRoutes, [...(team.detection().pools ?? []), ...(team.detection().unknown ?? [])]), revision: policy.revision },
        autoMatch: team.detection().report, catalogErrors: team.detection().errors ?? [], actualRequest: null,
        modelNotice: '角色模型为配置目标；原生队友列表可能显示继承模型。实际请求模型尚未从持久日志核实。' };
    });
    const removeContext = agent.ctx.systemPrompt.context({ name: 'capability-team:roster', order: 98, required: true,
      text: () => teamContext(team, agent, ctx.agentTeams.tryMembership(agent), failover, workflow, planGate) });
    const removeWriter = registerPolicyWriter(agent, (routes, revision) => team.savePolicy(agent, routes, revision));
    installed.set(agent, () => { removeReader(); removeWriter(); removeContext(); });
  };
  for (const agent of ctx.agents.list()) void install(agent);
  ctx.on('agent/created', ({ agent }) => install(agent));
  ctx.on('agent/disposed', ({ agent }) => { installed.get(agent)?.(); installed.delete(agent); });
  ctx.effect(() => () => { for (const dispose of installed.values()) dispose?.(); installed.clear(); });
}
export { seed };
