    /** Read-only view over native projections. Names remain full native paths, never a plugin identity registry. */
    function resolveTeamView({ rootSessionId, nativeProjections, statusSnapshot, childrenSnapshot }) {
      const project = id => typeof nativeProjections === 'function' ? nativeProjections(id) : nativeProjections?.[id]?.values ?? nativeProjections?.[id];
      const root = project(rootSessionId), team = root?.agentTeam;
      const known = new Map((statusSnapshot?.members ?? []).map(m => [m.id, m]));
      if (!team && !Array.isArray(root?.subagentCatalog) && Array.isArray(statusSnapshot?.members))
        return { rootSessionId, members: statusSnapshot.members, tasks: statusSnapshot.tasks ?? [] };
      if (Array.isArray(team?.members)) return { rootSessionId, members: team.members, tasks: team.tasks ?? [] };
      const members = [{ id: rootSessionId, name: 'lead', role: 'lead', phase: 'active' }], seen = new Set([rootSessionId]);
      const visit = (id, path) => {
        const catalog = project(id)?.subagentCatalog;
        for (const child of Array.isArray(catalog) ? catalog : []) {
          if (!child?.id || seen.has(child.id) || child.mode === 'external') continue;
          seen.add(child.id);
          const name = child.name ? [path, child.name].filter(Boolean).join('/') : known.get(child.id)?.name ?? child.id;
          members.push({ id: child.id, name, role: 'teammate', parentSessionId: id,
            phase: 'active', mode: child.mode });
          visit(child.id, child.name ? name : '');
        }
      };
      visit(rootSessionId, '');
      // Normalized native status snapshots fill unreadable tree branches without becoming a mutable roster.
      for (const row of childrenSnapshot ?? []) {
        if (Array.isArray(root?.subagentCatalog) || row.kind !== 'child' || !row.id || seen.has(row.id) || row.mode === 'external') continue;
        seen.add(row.id);
        members.push({ id: row.id, name: row.name ?? row.id, role: 'teammate', parentSessionId: row.parentId,
          phase: 'active', mode: row.mode });
      }
      if (!team && members.length === 1 && !root?.subagentCatalog && !statusSnapshot) return null;
      return { rootSessionId, members, tasks: team?.tasks ?? statusSnapshot?.tasks ?? [] };
    }
    const nativeRoleName = name => baseName(String(name ?? '').split('/').at(-1));
