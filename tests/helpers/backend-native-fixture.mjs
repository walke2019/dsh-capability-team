// Test-only legacy fixture adapter; production always receives the single native-compat instance.
export function fixtureNative(ctx = {}) {
  return {
    kind: () => 'rc1',
    identity(agent) {
      if (!agent) return undefined;
      const m = ctx.agentTeams?.tryMembership?.(agent) ?? ctx.agentTeams?.membership?.(agent);
      if (!m) return undefined;
      const root = m.root ?? agent;
      const preset = ctx.agentPresets?.composedPreset?.(root.ctx) ?? ctx.get?.('agentPresets')?.composedPreset?.(root.ctx);
      if (preset && preset !== 'capability-team') return undefined;
      return { ...m, kind: 'rc1', root, rootId: root.id ?? m.id, agentId: agent.id, address: m.role === 'lead' ? 'lead' : m.name, roleName: m.role === 'lead' ? 'lead' : m.name };
    },
    creation(exec) {
      if (this.identity(exec.agent)?.role !== 'lead' || !String(exec.name).endsWith('spawn_teammate')) return null;
      const a = exec.arguments ?? {};
      if (typeof a.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.name) || a.name === 'lead' || a.name.length > 64 || typeof a.description !== 'string' || !a.description.trim() || typeof a.prompt !== 'string' || !a.prompt.trim() || (a.context !== undefined && !['fresh', 'fork'].includes(a.context))) return null;
      return { kind: a.context === 'fork' ? 'fork' : 'fresh', name: a.name, address: a.name, roleName: a.name, parent: exec.agent };
    },
    onLocalStart(callback) {
      return ctx.on?.('agent/created', ({ agent }) => {
        const identity = this.identity(agent);
        if (identity) callback({ agent, identity });
      }) ?? (() => {});
    },
    list: async root => ctx.agentTeams.listMembers(root),
    async resolveTarget(caller, address) {
      const member = (await this.list(this.identity(caller).root)).find(m => m.id === address || m.name === address);
      if (!member) throw new Error('Native member target is unavailable');
      return member.id;
    },
    send: (caller, address, content, signal) => ctx.agentTeams.sendMessage(caller, { target: address, content, signal }),
  };
}
export const memberFixtureNative = { kind: () => 'rc1', identity: agent => agent && ({ root: agent, rootId: agent.id, agentId: agent.id, role: 'teammate', address: 'dev', roleName: 'dev' }), onLocalStart: () => () => {} };
export const rootFixtureNative = { kind: () => 'rc1', identity: agent => agent && ({ root: agent, rootId: agent.id, agentId: agent.id, role: 'lead', address: 'lead', roleName: 'lead' }), onLocalStart: () => () => {} };
