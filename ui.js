/** Profile-wide, read-only diagnostics; never activates routing for unrelated sessions. */
import { readTeamSnapshot, saveTeamPolicy } from './runtime-view.js';
import { readRequestEvidence, readTeamEvidence } from './request-evidence.js';
export const inject = ['commands', 'agentPresets', 'tools'];
/** Live roster state from the host's Agent Teams service: status, model, owned tasks. No log reads, cheap to poll. */
export function teamActivity(ctx, agent) {
  const teams = ctx.get?.('agentTeams');
  if (!teams) return { members: [], tasks: [], unavailable: '当前宿主未提供团队服务' };
  let members, tasks = [];
  try {
    members = teams.listMembers(agent).map(m => ({ id: m.id, name: m.name, role: m.role, status: m.status,
      ...(m.provider ? { provider: m.provider } : {}), ...(m.model ? { model: m.model } : {}), diagnostics: m.diagnostics ?? [] }));
  } catch (error) { return { members: [], tasks: [], unavailable: `团队成员读取失败：${error.message ?? error}` }; }
  try {
    tasks = (teams.listTasks?.(agent) ?? []).filter(task => task.status !== 'deleted')
      .map(task => ({ id: task.id, subject: task.subject, status: task.status, ...(task.ownerName ? { ownerName: task.ownerName } : {}) }));
  } catch { /* task board is optional for the activity view */ }
  return { members, tasks };
}
export async function inspectTeamRuntime(ctx, agent) {
  const preset = ctx.agentPresets.composedPreset(agent.ctx) ?? null;
  const roster = await ctx.agentPresets.list();
  const definition = roster.find(p => p.id === 'capability-team');
  const required = ['capability_team_read', 'capability_dispatch_plan', 'capability_free_task'];
  const visible = ctx.tools.schemas(agent).map(t => t.name);
  const missingTools = required.filter(name => !visible.includes(name));
  let team = null, teamError = null;
  if (preset === 'capability-team') {
    try { team = await readTeamSnapshot(agent); }
    catch (error) { teamError = String(error.message ?? error); }
  }
  const memberEvidence = preset === 'capability-team'
    ? await readTeamEvidence(ctx.get?.('sessionQuery'), ctx.get?.('agentTeams'), agent) : [];
  return {
    sessionId: agent.id, preset,
    declared: !!definition, activationError: definition?.broken ?? null,
    ready: preset === 'capability-team' && !!definition && !definition.broken && missingTools.length === 0 && team !== null && !teamError,
    missingTools,
    requestEvidence: memberEvidence.find(member => member.sessionId === agent.id) ?? await readRequestEvidence(ctx.get?.('sessionQuery'), agent.id),
    memberEvidence,
    team, teamError,
    activity: preset === 'capability-team' ? teamActivity(ctx, agent) : null,
    explanation: !definition ? '能力协作团队预设尚未注册，请在插件管理器检查本地扩展是否启用。'
      : definition.broken ? `能力协作团队预设激活失败：${definition.broken}`
      : preset !== 'capability-team'
      ? '本会话未挂载能力协作团队预设；安装插件或重启不会自动迁移已经开始的会话。请新建会话，在模式选择中选择“能力协作团队”，再打开团队总览读取状态；原会话保留不变。'
      : missingTools.length ? '预设名称存在，但能力团队后台工具未完整挂载，需要检查预设激活诊断。'
      : teamError ? '后台工具存在，但团队配置读取失败；当前不可管理模型，请查看具体错误。'
      : team === null ? '后台工具存在，但本会话配置读取器尚未就绪；请刷新，若持续出现则检查预设激活。'
      : '能力团队后台工具和配置读取已就绪；这不代表角色模型请求已经验证成功。',
  };
}
/**
 * The host logs every command result into the conversation, so the panel's snapshot is kept small:
 * catalog rows become [key, tier, primaryFor?, fallbackFor?] tuples, derived/duplicate fields are dropped.
 */
export function compactStatus(status) {
  const { team, requestEvidence, memberEvidence, ...rest } = status;
  const self = memberEvidence.some(member => member.sessionId === status.sessionId);
  const out = { ...rest, memberEvidence, ...(self ? {} : { requestEvidence }) };
  if (!team) return { ...out, team };
  const { autoMatch: _autoMatch, modelPolicy, ...teamRest } = team;
  if (!modelPolicy) return { ...out, team: teamRest };
  const { tierCatalog: _tiers, rows, ...policyRest } = modelPolicy;
  const tuple = row => {
    const value = [row.key, row.tiers?.[0] ?? null];
    if (row.primaryFor?.length || row.fallbackFor?.length) value.push(row.primaryFor ?? []);
    if (row.fallbackFor?.length) value.push(row.fallbackFor);
    return value;
  };
  return { ...out, team: { ...teamRest, modelPolicy: { ...policyRest, rows: (rows ?? []).map(tuple) } } };
}
export async function savePolicyCommand(ctx, { agent, rawInput }) {
  if (ctx.agentPresets.composedPreset(agent.ctx) !== 'capability-team') throw new Error('当前会话未启用能力协作团队，未保存');
  const input = JSON.parse(rawInput);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['disabledRoutes', 'expectedRevision'].includes(k))) throw new Error('无效的模型策略参数');
  const result = await saveTeamPolicy(agent, input.disabledRoutes, input.expectedRevision);
  return { kind: 'success', text: JSON.stringify(result) };
}
export function apply(ctx) {
  ctx.effect(() => ctx.commands.register({
    name: 'capability-model-policy',
    description: '保存全局模型禁用列表与前缀规则；对所有能力协作团队会话从下一次请求起生效。',
    input: { hint: '模型策略JSON' },
    handler: invocation => savePolicyCommand(ctx, invocation),
  }));
  ctx.effect(() => ctx.commands.register({
    name: 'capability-status',
    description: '只读检查本会话的能力团队预设和后台工具是否真正挂载，不调用模型。',
    handler: async ({ agent }) => ({ kind: 'success', text: JSON.stringify(compactStatus(await inspectTeamRuntime(ctx, agent))) }),
  }));
}
