// Read-only identity and control adaptation over the host's native collaboration services.
const PRESET = 'capability-team';
const leaf = address => address?.split('/').at(-1);
export function createNativeCompat(host) {
  let subagents;
  host.inject?.(['subagents'], scoped => {
    const service = scoped.subagents;
    subagents = service;
    scoped.effect?.(() => () => { if (subagents === service) subagents = undefined; });
  });
  const teams = host.agentTeams;
  const presetOf = agent => {
    try { return (host.get?.('agentPresets') ?? agent?.ctx?.get?.('agentPresets') ?? host.agentPresets)?.composedPreset(agent.ctx) ?? agent?.session?.header?.agentPreset; }
    catch { return undefined; }
  };
  const api = {
    kind() {
      if (typeof teams?.tryMembership === 'function' && typeof teams.listMembers === 'function') return 'rc1';
      if (subagents && ['rootOf', 'namesOf', 'resolveName', 'listDescendants'].every(key => typeof subagents[key] === 'function') && ['isEnabled', 'createTask', 'getTask', 'listTasks', 'updateTask'].every(key => typeof teams?.[key] === 'function')) return 'rc2';
      return 'unavailable';
    },
    identity(agent) {
      if (!agent) return undefined;
      try {
        if (api.kind() === 'rc1') {
          const m = teams.tryMembership(agent);
          if (!m) return undefined;
          const root = m.root ?? (m.role === 'lead' ? agent : undefined);
          if (!root || presetOf(root) !== PRESET) return undefined;
          return { ...m, kind: 'rc1', root, rootId: root.id, agentId: agent.id, role: m.role, address: m.role === 'lead' ? 'lead' : m.name, roleName: m.role === 'lead' ? 'lead' : m.name, parentAddress: m.role === 'lead' ? undefined : 'lead', id: m.id ?? root.id, name: m.name };
        }
        if (api.kind() !== 'rc2' || presetOf(agent) !== PRESET) return undefined;
        const root = subagents.rootOf(agent);
        if (!root || presetOf(root) !== PRESET) return undefined;
        const names = subagents.namesOf(agent), isRoot = root === agent;
        const named = names.self !== agent.id;
        return { kind: 'rc2', root, rootId: root.id, agentId: agent.id, role: isRoot ? 'lead' : 'teammate', address: names.self, parentAddress: names.parent, roleName: isRoot ? 'lead' : named ? leaf(names.self) : undefined, id: root.id, name: isRoot ? 'lead' : names.self };
      } catch { return undefined; }
    },
    async list(root, signal) {
      const identity = api.identity(root);
      if (!identity || identity.root !== root) throw new Error('Native team root is unavailable');
      if (api.kind() === 'rc1') return teams.listMembers(root);
      const entries = await subagents.listDescendants(root.id, signal);
      const members = [{ id: root.id, name: 'lead', role: 'lead', local: true }];
      for (const row of entries) {
        if (!row.id) continue;
        members.push({ ...row, id: row.id, name: row.path ?? row.id, role: 'teammate', description: row.label, parentSessionId: row.parentId, local: row.kind === 'child' ? row.mode !== 'external' : undefined, diagnostics: row.kind === 'diagnostic' ? [row.reason] : [] });
      }
      return members;
    },
    async resolveTarget(caller, address, signal) {
      if (!api.identity(caller)) throw new Error('Native team identity is unavailable');
      if (api.kind() === 'rc2') return subagents.resolveName(caller, address, signal);
      const root = api.identity(caller).root;
      const member = teams.listMembers(root).find(m => m.name === address || m.id === address);
      if (!member) throw new Error('Native member target is unavailable');
      return member.id;
    },
    async send(caller, address, content, signal) {
      if (api.kind() === 'rc1') return teams.sendMessage(caller, { target: address, content, signal });
      const target = await api.resolveTarget(caller, address, signal);
      return subagents.sendMessage(caller, target, content, { signal });
    },
    async interrupt(caller, address, signal) {
      const target = await api.resolveTarget(caller, address, signal);
      if (api.kind() === 'rc2') return subagents.interrupt(target, { kind: 'ancestor', agent: caller });
      if (typeof teams.interrupt === 'function') return teams.interrupt(caller, { target: address, signal });
      throw new Error('Native interrupt API is unavailable');
    },
    onLocalStart(callback) {
      const emit = (agent, runId) => {
        const identity = api.identity(agent);
        if (identity) callback({ agent, identity, runId });
      };
      const a = host.on('agent/created', ({ agent }) => { if (api.kind() === 'rc1') emit(agent); });
      const b = host.on('subagent/start', info => { if (api.kind() === 'rc2' && info.local) emit(host.agents.get(info.id), info.runId); });
      return () => { a?.(); b?.(); };
    },
    creation(exec) {
      const identity = api.identity(exec.agent);
      if (!identity) return null;
      const args = exec.arguments ?? {};
      const name = String(exec.name ?? '').replace(/^mcp__.+?__/, '');
      if (api.kind() === 'rc1' && name === 'spawn_teammate') return { kind: args.context === 'fork' ? 'fork' : 'fresh', name: args.name, roleName: args.name, address: args.name, parent: exec.agent, rootId: identity.rootId };
      if (api.kind() === 'rc2' && ['subagent', 'subagent_fork'].includes(name)) {
        const parentPath = identity.role === 'lead' ? '' : identity.address;
        return { kind: name === 'subagent_fork' ? 'fork' : 'fresh', name: args.name, roleName: args.name, address: typeof args.name === 'string' ? [parentPath, args.name].filter(Boolean).join('/') : undefined, parent: exec.agent, rootId: identity.rootId };
      }
      return null;
    },
  };
  return api;
}
