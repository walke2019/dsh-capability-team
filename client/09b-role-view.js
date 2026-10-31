    // ---------- role view (teammate session): own role card + own usage/logs/artifacts, no team canvas ----------
    /** Teammate sessions see only themselves: no PolicyEditor, no other members' usage/logs/artifacts. */
    function RoleView({ sessionId, role, liveByRole, usage, d, liveTeam, live, runtimeState, t }) {
      const ownUsage = usage.filter(row => row.id === sessionId || row.name === role?.displayName || row.name === role?.id);
      const ownEvidence = { ...d, memberEvidence: (d?.memberEvidence ?? []).filter(m => m.sessionId === sessionId) };
      const ownLiveTeam = liveTeam ? { ...liveTeam, members: (liveTeam.members ?? []).filter(m => m.id === sessionId) } : liveTeam;
      const control = runtimeState?.data?.taskControl;
      return h('div', { className: 'ctm-ov-block ctm-rv' },
        role ? h(RoleCards, { roles: [role], live: liveByRole, t }) : null,
        control && role ? h(TaskControl, { leadSessionId: live?.parentSessionId?.(sessionId) ?? sessionId, roleId: role.id, name: role.displayName ?? role.id, configured: role.provider ? `${role.provider}/${role.model}` : null, control, t }) : null,
        h('div', { className: 'ctm-ov-block' },
          h('div', { className: 'ctm-label' }, t('roleview.usage')),
          h(UsageGroups, { rows: ownUsage, roles: role ? [role] : [], t })),
        h('div', { className: 'ctm-ov-block' },
          h('div', { className: 'ctm-label' }, t('roleview.artifacts')),
          h(ArtifactsRack, { sessionId, liveTeam: ownLiveTeam, live, t })),
        h('div', { className: 'ctm-ov-block' },
          h('div', { className: 'ctm-label' }, t('roleview.logs')),
          d ? h(EvidenceGroups, { d: ownEvidence, sessionId, t }) : h('p', { className: 'ctm-sub' }, t('overview.noData'))));
    }
