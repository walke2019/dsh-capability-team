import { m as modelText } from './i18n.js';
// Shared runtime: pins each Team member to one project and resolves its effective role.
import { confirmedRoute, withConfirmedRoute } from './dispatch-confirm.js';
import { baseName } from './session-rotation.js';
import { resolveRole, baseConfig, withAutoRoutes } from './config.js';
import { projectRoot, loadProject, loadProjectSync, defaultRoot } from './theme.js';
import { ownsCapabilityTeam } from './preset-guard.js';
import { autoMatch } from './defaults.js';
import { applyModelPolicy } from './model-policy.js';
import { readGlobalPolicy, readGlobalPolicySync, saveGlobalPolicy } from './session-policy.js';
/**
 * Detect routes from the live DSH catalog. Re-runs only when the registered provider set changes,
 * so adding or removing a channel is picked up without a restart and a request costs one sync call.
 * A degraded result (catalog errors or an unassigned capability) is retried at most once per
 * `retryMs`, so a channel that was not ready at startup heals without a manual refresh. A retry that
 * still finds nothing stays unassigned: requests remain blocked (fail-closed, no downgrade).
 */
export const DETECT_RETRY_MS = 30_000;
const degraded = r => r.errors.length > 0 || r.report.some(x => x.status === 'unassigned');
export function createDetector(llm, preset, { now = Date.now, retryMs = DETECT_RETRY_MS } = {}) {
  let signature; let pending; let lastAt = 0; let current = { base: preset, report: [], unknown: [], errors: [] };
  const providers = () => (llm?.listProviders?.() ?? []).map(p => p.id);
  const detect = async () => {
    const ids = providers();
    const entries = []; const errors = [];
    for (const provider of ids) {
      try { for (const m of await llm.listModels(provider)) entries.push({ provider, model: m.id }); }
      catch (error) { errors.push({ provider, error: String(error?.message ?? error).slice(0, 200) }); }
    }
    const match = autoMatch(entries, preset.capabilities);
    let base = preset;
    try { base = withAutoRoutes(preset, match); }
    catch (error) { errors.push({ provider: '*', error: modelText('team.494', { 0: error.message }) }); }
    current = { base, entries, report: match.report, pools: match.pools, unknown: match.unknown, errors, detectedAt: new Date().toISOString() };
    return current;
  };
  return {
    get: () => current,
    async ensure(force = false) {
      // Serialize reads; an explicit refresh always re-reads models even when provider IDs are unchanged.
      if (pending) await pending;
      const sig = providers().join('|');
      if (!force && sig === signature && !(degraded(current) && now() - lastAt >= retryMs)) return current;
      signature = sig; lastAt = now();
      pending = detect().finally(() => { pending = undefined; });
      return pending;
    },
  };
}
export function createTeam(ctx, config = {}, { root = defaultRoot(), detect } = {}) {
  const preset = baseConfig(config);
  const detector = createDetector(ctx.llm, preset, detect);
  const pins = new WeakMap();
  const policyBase = policy => policy.disabledRoutes.length
    ? withAutoRoutes(preset, autoMatch(detector.get().entries ?? [], preset.capabilities, { disabledRoutes: policy.disabledRoutes }))
    : detector.get().base;
  // Pinned once per Agent: a later cd into a subdirectory or elsewhere keeps the same project.
  const pin = async agent => {
    if (!pins.has(agent)) pins.set(agent, projectRoot(await ctx.workingDirectory.ensure(agent), root));
    return pins.get(agent);
  };
  const resolveMember = (membership, effective, policy) => {
    const role = resolveRole(membership, effective);
    const confirmed = membership?.role === 'teammate' && membership.root ? confirmedRoute(membership.root.id, baseName(membership.name)) : undefined;
    return applyModelPolicy(withConfirmedRoute(role, confirmed), policy.disabledRoutes);
  };
  return {
    get base() { return detector.get().base; },
    preset, root,
    detection: () => detector.get(),
    refresh: () => detector.ensure(true),
    owns: agent => ownsCapabilityTeam(ctx, agent) && !!ctx.agentTeams.tryMembership(agent),
    pin,
    pinned: agent => pins.get(agent),
    async load(agent) {
      await detector.ensure();
      const policy = await this.policy(agent);
      return { ...await loadProject(await pin(agent), policyBase(policy), root), policy };
    },
    // The model policy is profile-wide: every save applies to all capability-team sessions from their next request.
    loadSync(project, _agent) {
      const policy = readGlobalPolicySync(root);
      return { ...loadProjectSync(project, policyBase(policy), root), policy };
    },
    async policy(_agent) {
      return readGlobalPolicy(root);
    },
    async savePolicy(agent, disabledRoutes, expectedRevision) {
      if (ctx.agentTeams.membership(agent).role !== 'lead') throw new Error(modelText('team.495'));
      return saveGlobalPolicy(disabledRoutes, expectedRevision, root);
    },
    async resolve(agent) {
      const { effective, policy } = await this.load(agent);
      const membership = ctx.agentTeams.membership(agent);
      const resolved = resolveMember(membership, effective, policy);
      // The Lead follows the user's pick (lead-route.js), which needs its tier's models and the policy to stay same-tier.
      return membership?.role === 'teammate' ? resolved
        : { ...resolved, leadContext: { tierModels: [...(effective.tiers?.[resolved.tier] ?? [])], disabledRoutes: [...policy.disabledRoutes] } };
    },
    /** Creation-time preview uses exactly the request resolver, without creating a native member. */
    async resolveMember(lead, name) {
      const { effective, policy } = await this.load(lead);
      return resolveMember({ role: 'teammate', name, root: lead }, effective, policy);
    },
    // After a save, the saving Lead moves to the configured root if it was a different directory.
    repin(agent, project) { pins.set(agent, project); },
  };
}
