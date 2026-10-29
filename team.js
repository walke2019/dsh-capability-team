// Shared runtime: pins each Team member to one project and resolves its effective role.
import { resolveRole, baseConfig } from './config.js';
import { projectRoot, loadProject, loadProjectSync, defaultRoot } from './theme.js';
export function createTeam(ctx, config = {}, { root = defaultRoot() } = {}) {
  const base = baseConfig(config);
  const pins = new WeakMap();
  // Pinned once per Agent: a later cd into a subdirectory or elsewhere keeps the same project.
  const pin = async agent => {
    if (!pins.has(agent)) pins.set(agent, projectRoot(await ctx.workingDirectory.ensure(agent), root));
    return pins.get(agent);
  };
  return {
    base, root,
    owns: agent => ctx.agentTeams.tryMembership(agent) !== undefined,
    pin,
    pinned: agent => pins.get(agent),
    async load(agent) { return loadProject(await pin(agent), base, root); },
    loadSync(project) { return loadProjectSync(project, base, root); },
    async resolve(agent) {
      const { effective } = await this.load(agent);
      return resolveRole(ctx.agentTeams.membership(agent), effective);
    },
    // After a save, the saving Lead moves to the configured root if it was a different directory.
    repin(agent, project) { pins.set(agent, project); },
  };
}
