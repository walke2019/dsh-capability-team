// Shared runtime: pins each Team member to one project and resolves its effective role.
import { resolveRole, baseConfig, withAutoRoutes } from './config.js';
import { projectRoot, loadProject, loadProjectSync, defaultRoot } from './theme.js';
import { autoMatch } from './defaults.js';
import { applyModelPolicy } from './model-policy.js';
import { readGlobalPolicy, readGlobalPolicySync, saveGlobalPolicy } from './session-policy.js';
/**
 * Detect routes from the live DSH catalog. Re-runs only when the registered provider set changes,
 * so adding or removing a channel is picked up without a restart and a request costs one sync call.
 */
function createDetector(llm, preset) {
  let signature; let pending; let current = { base: preset, report: [], unknown: [], errors: [] };
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
    catch (error) { errors.push({ provider: '*', error: `自动匹配结果未通过校验：${error.message}` }); }
    current = { base, entries, report: match.report, pools: match.pools, unknown: match.unknown, errors, detectedAt: new Date().toISOString() };
    return current;
  };
  return {
    get: () => current,
    async ensure(force = false) {
      // Serialize reads; an explicit refresh always re-reads models even when provider IDs are unchanged.
      if (pending) await pending;
      const sig = providers().join('|');
      if (!force && sig === signature) return current;
      signature = sig;
      pending = detect().finally(() => { pending = undefined; });
      return pending;
    },
  };
}
export function createTeam(ctx, config = {}, { root = defaultRoot() } = {}) {
  const preset = baseConfig(config);
  const detector = createDetector(ctx.llm, preset);
  const pins = new WeakMap();
  const policyBase = policy => policy.disabledRoutes.length
    ? withAutoRoutes(preset, autoMatch(detector.get().entries ?? [], preset.capabilities, { disabledRoutes: policy.disabledRoutes }))
    : detector.get().base;
  // Pinned once per Agent: a later cd into a subdirectory or elsewhere keeps the same project.
  const pin = async agent => {
    if (!pins.has(agent)) pins.set(agent, projectRoot(await ctx.workingDirectory.ensure(agent), root));
    return pins.get(agent);
  };
  return {
    get base() { return detector.get().base; },
    preset, root,
    detection: () => detector.get(),
    refresh: () => detector.ensure(true),
    owns: agent => ctx.agentTeams.tryMembership(agent) !== undefined,
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
      if (ctx.agentTeams.membership(agent).role !== 'lead') throw new Error('仅主会话可修改模型分配策略');
      return saveGlobalPolicy(disabledRoutes, expectedRevision, root);
    },
    async resolve(agent) {
      const { effective, policy } = await this.load(agent);
      return applyModelPolicy(resolveRole(ctx.agentTeams.membership(agent), effective), policy.disabledRoutes);
    },
    // After a save, the saving Lead moves to the configured root if it was a different directory.
    repin(agent, project) { pins.set(agent, project); },
  };
}
