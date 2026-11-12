import { m as modelText } from './i18n.js';
import { resolveRole } from './config.js';
const fingerprint = loaded => JSON.stringify([loaded.revision, loaded.effective, loaded.policy]);
const routeKey = role => JSON.stringify([role.provider, role.model, role.fallbacks ?? []]);
/** Runs after native approvals and guards, immediately before native spawn dispatch. */
export function applySpawnConfirm(ctx, team, failover, confirmation) {
  ctx.on('tools/execute', async (exec, next) => {
    const identity = team.native.identity(exec.agent);
    if (!identity) return next();
    const creation = team.native.creation(exec);
    if (!creation) return next();
    if (!creation.roleName) throw new Error(modelText('spawn-confirm.named-role'));
    const root = identity.rootId;
    const owner = identity.root;
    const name = creation.address ?? creation.name;
    const check = () => {
      exec.signal?.throwIfAborted();
      const current = team.native.identity(exec.agent);
      if (!current || current.rootId !== root || current.agentId !== identity.agentId || current.address !== identity.address) throw new Error(modelText('spawn-confirm.changed'));
    };
    let before;
    const result = await confirmation.confirm(exec, undefined, undefined, undefined, undefined, {
      async prepare() {
        check();
        before = await team.load(owner);
        check();
        const role = resolveRole({ role: 'teammate', name: creation.roleName }, before.effective);
        return { effective: before.effective, policy: before.policy, mode: before.effective.workflow.confirmDispatch,
          plan: { mode: 'delegate', assignments: [{ role: name, displayName: role.displayName, capability: role.capability, task: exec.arguments.prompt }] } };
      },
      async validate() {
        check();
        if (fingerprint(await team.load(owner)) !== fingerprint(before)) throw new Error(modelText('spawn-confirm.changed'));
      },
    });
    check();
    const after = await team.load(owner);
    if (result.savedRevision == null ? fingerprint(after) !== fingerprint(before) : after.revision !== result.savedRevision || JSON.stringify(after.policy) !== JSON.stringify(before.policy)) throw new Error(modelText('spawn-confirm.changed'));
    const role = await team.resolveMember(owner, name);
    check();
    if (fingerprint(await team.load(owner)) !== fingerprint(after)) throw new Error(modelText('spawn-confirm.changed'));
    check();
    const selected = result.routes[0];
    if (before.effective.workflow.confirmDispatch !== 'never' && selected && routeKey(role) !== routeKey({ ...selected.primary, fallbacks: selected.fallbacks })) throw new Error(modelText('spawn-confirm.changed'));
    if (role.unassigned || !role.provider || !role.model || !failover.eligibility(role).eligible) throw new Error(modelText('spawn-confirm.unavailable'));
    return next();
  });
}
