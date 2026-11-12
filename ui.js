/** Profile-wide, read-only diagnostics; never activates routing for unrelated sessions. */
import { m, t } from './i18n.js';
import { readTeamSnapshot, saveTeamPolicy } from './runtime-view.js';
import { readRequestEvidence, readTeamEvidence } from './request-evidence.js';
import { applyConfigProjection } from './config-projection.js';
import { applyObservabilityProjections } from './observability-projection.js';
import { applyObservabilityApi } from './observability-api.js';
import { applyTaskControlApi } from './task-control-api.js';
import { applyDispatchConfirmApi } from './dispatch-confirm.js';
import { applyOnboardingApi } from './onboarding.js';
import { registerManagedConfigRoute } from './managed-config-route.js';
import { schemastery } from './settings-schema.js';
import { createNativeCompat } from './native-compat.js';
export const inject = ['commands', 'agentPresets', 'tools', 'agentTeams'];
// Only the welcome card's acknowledgement is a live setting (the client renders its own card, so no auto page).
const z = schemastery('@aiwuk/team');
export const Config = z ? z.object({ welcomeVersion: z.string().volatile() }) : undefined;
/**
 * Live roster state from the host's Agent Teams service: status and owned tasks. No log reads, cheap to poll.
 * The host's member provider/model is not kept in sync with real requests, so it is deliberately not forwarded.
 */
export function teamActivity(ctx, agent, native) {
  if (native) return native.list(native.identity(agent)?.root ?? agent).then(members => ({
    members: members.map(m => ({ id: m.id, name: m.name, role: m.role, status: m.status ?? 'unknown', parentSessionId: m.parentSessionId, mode: m.mode, local: m.local, diagnostics: m.diagnostics ?? [] })),
    tasks: (ctx.get?.('agentTeams')?.listTasks?.(native.identity(agent)?.root ?? agent) ?? []).filter(task => task.status !== 'deleted'),
  }), error => ({ members: [], tasks: [], unavailable: t('ui.594', { 0: error.message ?? error }) }));
  const teams = ctx.get?.('agentTeams');
  if (!teams) return { members: [], tasks: [], unavailable: t('ui.593') };
  let members, tasks = [];
  try {
    members = teams.listMembers(agent).map(m => ({ id: m.id, name: m.name, role: m.role, status: m.status, diagnostics: m.diagnostics ?? [] }));
  } catch (error) { return { members: [], tasks: [], unavailable: t('ui.594', { 0: error.message ?? error }) }; }
  try {
    tasks = (teams.listTasks?.(agent) ?? []).filter(task => task.status !== 'deleted')
      .map(task => ({ id: task.id, subject: task.subject, status: task.status, ...(task.ownerName ? { ownerName: task.ownerName } : {}) }));
  } catch { /* task board is optional for the activity view */ }
  return { members, tasks };
}
export async function inspectTeamRuntime(ctx, agent, native) {
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
    ? await readTeamEvidence(ctx.get?.('sessionQuery'), ctx.get?.('agentTeams'), agent, native) : [];
  return {
    sessionId: agent.id, rootSessionId: native?.identity(agent)?.rootId ?? agent.id, nativeGeneration: native?.kind(), preset, teamServicePresent: !!ctx.get?.('agentTeams'),
    declared: !!definition, activationError: definition?.broken ?? null,
    ready: preset === 'capability-team' && !!definition && !definition.broken && missingTools.length === 0 && team !== null && !teamError,
    missingTools,
    requestEvidence: memberEvidence.find(member => member.sessionId === agent.id) ?? await readRequestEvidence(ctx.get?.('sessionQuery'), agent.id),
    memberEvidence,
    team, teamError,
    activity: preset === 'capability-team' ? await teamActivity(ctx, agent, native) : null,
    explanation: !definition ? t('ui.595')
      : definition.broken ? t('ui.596', { 0: definition.broken })
      : preset !== 'capability-team' ? t('ui.597')
      : missingTools.length ? t('ui.598', { 0: missingTools.join(', ') })
      : teamError ? t('ui.599')
      : team === null ? t('ui.600')
      : t('ui.601'),
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
  if (ctx.agentPresets.composedPreset(agent.ctx) !== 'capability-team') throw new Error(m('ui.602'));
  const input = JSON.parse(rawInput);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['disabledRoutes', 'expectedRevision'].includes(k))) throw new Error(m('ui.603'));
  const result = await saveTeamPolicy(agent, input.disabledRoutes, input.expectedRevision);
  return { kind: 'success', text: JSON.stringify(result) };
}
export function apply(ctx) {
  const native = createNativeCompat(ctx);
  applyConfigProjection(ctx);
  applyObservabilityProjections(ctx);
  applyObservabilityApi(ctx, native);
  applyTaskControlApi(ctx, native);
  applyDispatchConfirmApi(ctx, native);
  applyOnboardingApi(ctx, native);
  registerManagedConfigRoute(ctx, 'team');
  ctx.inject?.(['settings'], scoped => { scoped.effect(() => scoped.settings.configure({ auto: false }, ctx.fiber)); });
  ctx.effect(() => ctx.commands.register({
    name: 'capability-model-policy',
    description: t('ui.604'),
    input: { hint: t('ui.605') },
    handler: invocation => savePolicyCommand(ctx, invocation),
  }));
  ctx.effect(() => ctx.commands.register({
    name: 'capability-status',
    description: t('ui.606'),
    handler: async ({ agent }) => ({ kind: 'success', text: JSON.stringify(compactStatus(await inspectTeamRuntime(ctx, agent, native))) }),
  }));
}
