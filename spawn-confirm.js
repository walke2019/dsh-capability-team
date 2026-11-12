import { m as modelText } from './i18n.js';
import { ownsCapabilityTeam } from './preset-guard.js';
import { restrictiveToolName } from './tool-names.js';
import { preflightShape } from './dispatch-preflight.js';
import { resolveRole } from './config.js';
import { baseName } from './session-rotation.js';
const SPAWN = new Set(['spawn_teammate']);
const fingerprint = loaded => JSON.stringify([loaded.revision, loaded.effective, loaded.policy]);
const routeKey = role => JSON.stringify([role.provider, role.model, role.fallbacks ?? []]);
/** Runs after native approvals and guards, immediately before native spawn dispatch. */
export function applySpawnConfirm(ctx, team, failover, confirmation) {
  ctx.on('tools/execute', async (exec, next) => {
    const identity = ctx.agentTeams.tryMembership(exec.agent);
    if (!ownsCapabilityTeam(ctx, exec.agent) || identity?.role !== 'lead'
      || restrictiveToolName(exec.name, SPAWN) !== 'spawn_teammate' || !preflightShape(exec.arguments)) return next();
    const root = identity.root?.id ?? exec.agent.id;
    const check = () => {
      exec.signal?.throwIfAborted();
      const current = ctx.agentTeams.tryMembership(exec.agent);
      if (!ownsCapabilityTeam(ctx, exec.agent) || current?.role !== 'lead' || (current.root?.id ?? exec.agent.id) !== root) throw new Error(modelText('spawn-confirm.changed'));
    };
    let before;
    const result = await confirmation.confirm(exec, undefined, undefined, undefined, undefined, {
      async prepare() {
        check();
        before = await team.load(exec.agent);
        check();
        const role = resolveRole({ role: 'teammate', name: exec.arguments.name }, before.effective);
        return { effective: before.effective, policy: before.policy, mode: before.effective.workflow.confirmDispatch,
          plan: { mode: 'delegate', assignments: [{ role: baseName(exec.arguments.name), displayName: role.displayName, capability: role.capability, task: exec.arguments.prompt }] } };
      },
      async validate() {
        check();
        if (fingerprint(await team.load(exec.agent)) !== fingerprint(before)) throw new Error(modelText('spawn-confirm.changed'));
      },
    });
    check();
    const after = await team.load(exec.agent);
    if (result.savedRevision == null ? fingerprint(after) !== fingerprint(before) : after.revision !== result.savedRevision || JSON.stringify(after.policy) !== JSON.stringify(before.policy)) throw new Error(modelText('spawn-confirm.changed'));
    const role = await team.resolveMember(exec.agent, exec.arguments.name);
    check();
    if (fingerprint(await team.load(exec.agent)) !== fingerprint(after)) throw new Error(modelText('spawn-confirm.changed'));
    check();
    const selected = result.routes[0];
    if (before.effective.workflow.confirmDispatch !== 'never' && selected && routeKey(role) !== routeKey({ ...selected.primary, fallbacks: selected.fallbacks })) throw new Error(modelText('spawn-confirm.changed'));
    if (role.unassigned || !role.provider || !role.model || !failover.eligibility(role).eligible) throw new Error(modelText('spawn-confirm.unavailable'));
    return next();
  });
}
