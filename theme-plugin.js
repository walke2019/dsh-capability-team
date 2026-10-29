import { readFileSync } from 'node:fs';
import { roleView, describeChanges, resolveRole, seed } from './config.js';
import { modelCatalog, changedRoutes, verifyRoutes } from './allocation.js';
import { saveProject } from './theme.js';
import { params } from './tool-schema.js';
const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
const ENTRY_RULE = '每项：对象=新增或按字段合并；null=恢复预设默认；false=删除该项。';
/** Model-facing team context for one Agent, rebuilt from the pinned project on every step. */
export function teamContext(team, agent, membership, failover) {
  const project = team.pinned(agent);
  if (!project) return '项目团队配置尚未加载；需要角色信息时调用 capability_team_read。';
  let loaded;
  try { loaded = team.loadSync(project); }
  catch (error) { return `项目团队配置不可用：${error.message}。不要猜测角色或模型，请主控调用 capability_team_read 排查。`; }
  let self;
  try {
    const { failover: _policy, ...role } = resolveRole(membership, loaded.effective);
    self = role;
    const live = failover?.status(agent);
    if (live && !live.primary) self.currentRoute = `${live.active}（主模型不可用，已切换到同档备选）`;
  } catch (error) { self = { error: error.message }; }
  const roster = roleView(loaded.effective).map(({ id, displayName, capability, provider, model }) => ({ id, displayName, capability, model: provider ? `${provider}/${model}` : '未分配（沿用会话模型）' }));
  return `项目团队配置（${loaded.effective.name}，版本 ${loaded.revision}，项目 ${project}）
你的角色：${JSON.stringify(self)}
团队名册：${JSON.stringify(roster)}
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
export function apply(ctx, team, failover) {
  const content = readFileSync(new URL('./skills/project-role-theme/SKILL.md', import.meta.url), 'utf8');
  ctx.effect(() => ctx.skills.register({ name: 'project-role-theme', source: 'runtime', content,
    description: '通过对话调整当前项目团队：角色改名或整体换主题、职责、能力、模型档位与分配、新增或移除角色；读取DSH渠道模型目录给出方案，由用户在确认框中批准后保存。' }));
  ctx.effect(() => ctx.tools.register({ name: 'capability_team_read', parameters: params(), output,
    description: '读取当前项目的团队配置：版本、默认值（按用户DSH渠道自动匹配的档位、主模型与同档备选）、项目覆盖项、生效结果，以及自动匹配报告（升档/低于要求档位/未分配/未识别的模型）。',
    async execute(_args, exec) {
      const { project, revision, overrides, effective } = await team.load(exec.agent);
      const { report, unknown, errors, detectedAt } = team.detection();
      return JSON.stringify({ project, revision, defaults: team.base, overrides, effective, roles: roleView(effective), coolingRoutes: failover?.cooling() ?? [],
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
      capabilities: { type: 'object', additionalProperties: true, description: `能力id → {job, provider, model, tier, search, fallbacks, prefer}；fallbacks 为有序的同档备选 [{provider, model}]，整体替换；prefer 为自动匹配时的厂商偏好顺序。${ENTRY_RULE}` },
      failover: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }], description: '容灾策略，按字段合并，null 恢复默认：{retries 同一模型追加重试次数, initialDelayMs, maxDelayMs, cooldownMs 故障模型冷却, retryCodes, failoverCodes, failoverStatuses}' },
      roles: { type: 'object', additionalProperties: true, description: `队友内部id（lower-kebab-case）→ {displayName, capability, description}。${ENTRY_RULE}` },
    }, ['expected_revision']),
    async execute(args, exec) {
      if (ctx.agentTeams.membership(exec.agent).role !== 'lead') throw new Error('仅主控可保存团队配置；请把需求转给 lead');
      const project = await team.pin(exec.agent);
      const patch = { name: args.name, failover: args.failover, tiers: args.tiers, capabilities: args.capabilities, roles: args.roles };
      const result = await saveProject(project, patch, args.expected_revision, { base: team.base, root: team.root,
        async check(before, after) {
          const lines = describeChanges(before, after);
          if (!lines.length) throw new Error('没有任何变更，未保存');
          const routes = changedRoutes(before, after);
          if (routes.length) verifyRoutes(routes, await modelCatalog(ctx.llm, after.tiers));
          await confirm(ctx, exec, lines, args.expected_revision);
        } });
      return JSON.stringify({ saved: true, project: result.project, revision: result.revision, roles: roleView(result.effective) });
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
    installed.set(agent, agent.ctx.systemPrompt.context({ name: 'capability-team:roster', order: 98, required: true,
      text: () => teamContext(team, agent, ctx.agentTeams.tryMembership(agent), failover) }));
  };
  for (const agent of ctx.agents.list()) void install(agent);
  ctx.on('agent/created', ({ agent }) => install(agent));
  ctx.on('agent/disposed', ({ agent }) => { installed.get(agent)?.(); installed.delete(agent); });
  ctx.effect(() => () => { for (const dispose of installed.values()) dispose(); installed.clear(); });
}
export { seed };
