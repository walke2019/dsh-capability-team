import { m as modelText, t } from './i18n.js';
import { readFileSync } from 'node:fs';
import { roleView, describeChanges, resolveRole, seed } from './config.js';
import { modelCatalog, changedRoutes, verifyRoutes } from './allocation.js';
import { saveProject } from './theme.js';
import { params } from './tool-schema.js';
import { registerTeamReader, registerPolicyWriter } from './runtime-view.js';
import { modelPolicyRows, applyModelPolicy, policyRoleView } from './model-policy.js';
import { accessSummary } from './access.js';
import { toTemplate, templatePatch, TEMPLATE_FORMAT } from './template.js';
import { ROLE_THEMES, themePatch } from './roster-defaults.js';
import { singleModelFrom } from './single-model.js';
const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
const ENTRY_RULE = modelText('theme-plugin.506');
/** Model-facing team context for one Agent, rebuilt from the pinned project on every step. */
export function teamContext(team, agent, membership, failover, workflow, planGate) {
  const project = team.pinned(agent);
  if (!project) return modelText('theme-plugin.507');
  let loaded;
  try { loaded = team.loadSync(project, agent); }
  catch (error) { return modelText('theme-plugin.508', { 0: error.message }); }
  let self;
  try {
    const { failover: _policy, access, ...role } = applyModelPolicy(resolveRole(membership, loaded.effective), loaded.policy?.disabledRoutes);
    self = role;
    const limits = accessSummary(access);
    if (limits) self.access = modelText('theme-plugin.509', { 0: limits });
    const planState = planGate?.status(agent, membership, role);
    if (planState) self.plan = planState;
    const live = failover?.status(agent);
    const allowed = [role, ...(role.fallbacks ?? [])].map(r => `${r.provider}/${r.model}`);
    const wide = role.longContext ? `${role.longContext.provider}/${role.longContext.model}` : undefined;
    if (live?.active && live.active === wide) self.currentRoute = modelText('theme-plugin.510', { 0: wide });
    else if (live && !live.primary && allowed.includes(live.active)) self.currentRoute = modelText('theme-plugin.511', { 0: live.active });
  } catch (error) { self = { error: error.message }; }
  const roster = roleView(loaded.effective).map(entry => {
    try {
      const { id, displayName, capability, whenToUse, provider, model, access, singleModel } = applyModelPolicy(entry, loaded.policy?.disabledRoutes);
      const limits = accessSummary(access);
      return { id, displayName, capability, ...(whenToUse ? { whenToUse } : {}), model: provider ? `${provider}/${model}${singleModel ? modelText('theme-plugin.512') : ''}` : modelText('theme-plugin.513'), ...(limits ? { access: limits } : {}) };
    } catch (error) { return { id: entry.id, displayName: entry.displayName, model: modelText('theme-plugin.514'), error: error.message }; }
  });
  const status = membership?.role === 'lead' ? workflow?.status(agent, loaded.effective.workflow) : undefined;
  return modelText('theme-plugin.515', { 0: loaded.effective.name, 1: loaded.revision, 2: project, 3: JSON.stringify(self), 4: JSON.stringify(roster), 5: status ? `\n${status}` : '' });
}
async function confirm(ctx, exec, lines, revision) {
  const answer = await ctx.userQuestions.ask({ agent: exec.agent, signal: exec.signal, questions: [{
    id: 'confirm', header: t('theme-plugin.516'),
    question: t('theme-plugin.517', { 0: lines.length }),
    detail: t('theme-plugin.518', { 0: lines.join('\n'), 1: revision }),
    options: [{ label: t('theme-plugin.519'), description: t('theme-plugin.520') }, { label: t('theme-plugin.521'), description: t('theme-plugin.522') }],
  }] });
  const item = answer.answers.find(a => a.id === 'confirm');
  if (!item?.selected.includes(t('theme-plugin.523'))) throw new Error(modelText('theme-plugin.524', { 0: item?.custom ? modelText('theme-plugin.525', { 0: item.custom }) : '' }));
}
export function apply(ctx, team, failover, workflow, planGate, taskControl) {
  const content = readFileSync(new URL('./skills/project-role-theme/SKILL.md', import.meta.url), 'utf8');
  ctx.effect(() => ctx.skills.register({ name: 'project-role-theme', source: 'runtime', content,
    description: modelText('theme-plugin.526') }));
  ctx.effect(() => ctx.tools.register({ name: 'capability_team_read', parameters: params(), output,
    description: modelText('theme-plugin.527'),
    async execute(_args, exec) {
      await team.refresh();
      const { project, revision, overrides, effective, policy } = await team.load(exec.agent);
      const { report, unknown, errors, detectedAt } = team.detection();
      return JSON.stringify({ project, revision, defaults: team.base, overrides, effective, roles: policyRoleView(roleView(effective), policy.disabledRoutes), coolingRoutes: failover?.cooling() ?? [],
        autoMatch: { detectedAt, report, unrecognized: unknown.slice(0, 50), unrecognizedCount: unknown.length, errors } });
    },
  }));
  ctx.effect(() => ctx.tools.register({ name: 'capability_model_catalog', parameters: params(), output,
    description: modelText('theme-plugin.528'),
    async execute(_args, exec) {
      const { effective } = await team.load(exec.agent);
      return JSON.stringify(await modelCatalog(ctx.llm, effective.tiers));
    },
  }));
  ctx.effect(() => ctx.tools.register({ name: 'capability_team_save', output,
    description: modelText('theme-plugin.529'),
    parameters: params({
      expected_revision: { type: 'integer', description: modelText('theme-plugin.530') },
      name: { type: 'string', description: modelText('theme-plugin.531') },
      tiers: { type: 'object', additionalProperties: true, description: modelText('theme-plugin.532', { 0: ENTRY_RULE }) },
      capabilities: { type: 'object', additionalProperties: true, description: modelText('theme-plugin.533', { 0: ENTRY_RULE }) },
      failover: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }], description: modelText('theme-plugin.534') },
      workflow: { oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }], description: modelText('theme-plugin.535') },
      roles: { type: 'object', additionalProperties: true, description: modelText('theme-plugin.536', { 0: ENTRY_RULE }) },
      single_model: { type: 'string', enum: ['use-default', 'off'], description: modelText('theme-plugin.537') },
    }, ['expected_revision']),
    async execute(args, exec) {
      const singleModel = args.single_model === 'off' ? null : args.single_model === 'use-default' ? singleModelFrom(ctx.get?.('agentDefaultModel')?.currentSelection?.()) : undefined;
      const patch = { name: args.name, failover: args.failover, workflow: args.workflow, tiers: args.tiers, capabilities: args.capabilities, roles: args.roles, singleModel };
      return JSON.stringify(await saveConfirmed(exec, patch, args.expected_revision));
    },
  }));
  /** Validate, check new routes against the catalog, and save only after the user approves the full diff. */
  async function saveConfirmed(exec, patch, expectedRevision) {
    if (ctx.agentTeams.membership(exec.agent).role !== 'lead') throw new Error(modelText('theme-plugin.538'));
    const project = await team.pin(exec.agent);
    const result = await saveProject(project, patch, expectedRevision, { base: team.base, root: team.root,
      async check(before, after) {
        const lines = describeChanges(before, after);
        if (!lines.length) throw new Error(modelText('theme-plugin.539'));
        const routes = changedRoutes(before, after);
        const single = after.singleModel && `${after.singleModel.provider}/${after.singleModel.model}` !== `${before.singleModel?.provider}/${before.singleModel?.model}`
          ? [{ capability: modelText('theme-plugin.540'), ...after.singleModel }] : [];
        if (routes.length || single.length) verifyRoutes([...routes, ...single], await modelCatalog(ctx.llm, after.tiers));
        await confirm(ctx, exec, lines, expectedRevision);
      } });
    return { saved: true, project: result.project, revision: result.revision, roles: roleView(result.effective) };
  }
  ctx.effect(() => ctx.tools.register({ name: 'capability_team_export', parameters: params(), output,
    description: modelText('theme-plugin.541', { 0: TEMPLATE_FORMAT }),
    async execute(_args, exec) {
      const { effective } = await team.load(exec.agent);
      return JSON.stringify(toTemplate(effective), null, 2);
    },
  }));
  ctx.effect(() => ctx.tools.register({ name: 'capability_team_import', output,
    description: modelText('theme-plugin.542', { 0: Object.keys(ROLE_THEMES).join(' / ') }),
    parameters: params({
      expected_revision: { type: 'integer', description: modelText('theme-plugin.543') },
      template: { type: 'object', additionalProperties: true, description: modelText('theme-plugin.544', { 0: TEMPLATE_FORMAT }) },
      theme: { type: 'string', enum: Object.keys(ROLE_THEMES), description: modelText('theme-plugin.545') },
    }, ['expected_revision']),
    async execute(args, exec) {
      const { effective } = await team.load(exec.agent);
      if ((args.template === undefined) === (args.theme === undefined)) throw new Error(modelText('theme-plugin.546'));
      const patch = args.theme === undefined ? templatePatch(args.template, effective) : themePatch(args.theme, effective);
      const result = await saveConfirmed(exec, patch, args.expected_revision);
      const unassigned = result.roles.filter(r => r.provider === undefined).map(r => r.id);
      return JSON.stringify({ ...result, ...(unassigned.length ? { unassigned, next: modelText('theme-plugin.547') } : {}) });
    },
  }));
  // Install the team context in each Team member's own scope, like the native Team identity.
  const installed = new Map();
  const install = async agent => {
    if (installed.has(agent) || !ownsCapabilityTeam(ctx, agent) || ctx.agentTeams.tryMembership(agent) === undefined) return;
    installed.set(agent, undefined);
    // Pin before the first step; a failure must not block creation and resurfaces on the next request.
    await team.pin(agent).catch(() => {});
    if (!installed.has(agent)) return; // disposed meanwhile
    const removeReader = registerTeamReader(agent, async () => {
      await team.refresh();
      const { project, revision, effective, policy } = await team.load(agent);
      return { project, revision, name: effective.name, ...(effective.singleModel ? { singleModel: effective.singleModel } : {}), roles: policyRoleView(roleView(effective), policy.disabledRoutes), workflow: effective.workflow,
        modelPolicy: { ...modelPolicyRows(effective.tiers, roleView(effective), policy.disabledRoutes, [...(team.detection().pools ?? []), ...(team.detection().unknown ?? [])]), revision: policy.revision },
        autoMatch: team.detection().report, catalogErrors: team.detection().errors ?? [], actualRequest: null,
        ...(effective.tierDrift ? { tierDrift: effective.tierDrift } : {}),
        modelNotice: t('theme-plugin.548') };
    });
    const removeContext = agent.ctx.systemPrompt.context({ name: 'capability-team:roster', order: 98, required: true,
      text: () => (ownsCapabilityTeam(ctx, agent) ? teamContext(team, agent, ctx.agentTeams.tryMembership(agent), failover, workflow, planGate) : '') });
    const removeBudgetContext = taskControl && ctx.agentTeams.tryMembership(agent)?.role === 'lead'
      ? agent.ctx.systemPrompt.context({ name: 'capability-team:task-budget', order: 99, required: true,
        text: () => (ownsCapabilityTeam(ctx, agent) ? taskControl.summary(agent) : '') }) : () => {};
    const removeWriter = registerPolicyWriter(agent, (routes, revision) => team.savePolicy(agent, routes, revision));
    installed.set(agent, () => { removeReader(); removeWriter(); removeContext(); removeBudgetContext(); });
  };
  for (const agent of ctx.agents.list()) void install(agent);
  ctx.on('agent/created', ({ agent }) => install(agent));
  ctx.on('agent/disposed', ({ agent }) => { installed.get(agent)?.(); installed.delete(agent); });
  // A blank session reused for another preset is recomposed without agent/created or agent/disposed.
  ctx.on('agent-preset/selected', sessionId => {
    let agent; try { agent = ctx.agents?.get?.(sessionId); } catch { return; }
    if (!agent) return;
    if (ownsCapabilityTeam(ctx, agent)) { void install(agent); return; }
    installed.get(agent)?.(); installed.delete(agent);
  });
  ctx.effect(() => () => { for (const dispose of installed.values()) dispose?.(); installed.clear(); });
}
export { seed };
import { ownsCapabilityTeam } from './preset-guard.js';
