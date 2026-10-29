// Shared runtime: pins each Team member to one project and resolves its effective role.
import { resolveRole, baseConfig, withAutoRoutes } from './config.js';
import { projectRoot, loadProject, loadProjectSync, defaultRoot } from './theme.js';
import { autoMatch } from './defaults.js';
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
    current = { base, report: match.report, unknown: match.unknown, errors, detectedAt: new Date().toISOString() };
    return current;
  };
  return {
    get: () => current,
    async ensure() {
      const sig = providers().join('|');
      if (sig === signature && !pending) return current;
      if (sig !== signature) { signature = sig; pending = detect().finally(() => { pending = undefined; }); }
      return pending ?? current;
    },
  };
}
export function createTeam(ctx, config = {}, { root = defaultRoot() } = {}) {
  const preset = baseConfig(config);
  const detector = createDetector(ctx.llm, preset);
  const pins = new WeakMap();
  // Pinned once per Agent: a later cd into a subdirectory or elsewhere keeps the same project.
  const pin = async agent => {
    if (!pins.has(agent)) pins.set(agent, projectRoot(await ctx.workingDirectory.ensure(agent), root));
    return pins.get(agent);
  };
  return {
    get base() { return detector.get().base; },
    preset, root,
    detection: () => detector.get(),
    refresh: () => detector.ensure(),
    owns: agent => ctx.agentTeams.tryMembership(agent) !== undefined,
    pin,
    pinned: agent => pins.get(agent),
    async load(agent) { await detector.ensure(); return loadProject(await pin(agent), this.base, root); },
    loadSync(project) { return loadProjectSync(project, this.base, root); },
    async resolve(agent) {
      const { effective } = await this.load(agent);
      return resolveRole(ctx.agentTeams.membership(agent), effective);
    },
    // After a save, the saving Lead moves to the configured root if it was a different directory.
    repin(agent, project) { pins.set(agent, project); },
  };
}
