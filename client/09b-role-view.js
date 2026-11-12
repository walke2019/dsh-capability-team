    // ---------- role view (teammate session): own role card + own usage/logs/artifacts, no team canvas ----------
    /**
     * Teammate sessions see only themselves:
     * 1. My Tasks (tasks where baseName(task.ownerName) === myRoleId, sorted: in_progress -> pending -> completed)
     * 2. Current Activity & Recent Activities
     * 3. Model & Permissions (RoleCards)
     * 4. Task Control (TaskControl)
     * 5. Usage (UsageGroups)
     * 6. Artifacts (ArtifactsRack)
     * 7. Logs (EvidenceGroups)
     */
    function RoleView({ sessionId, role, liveByRole, usage, d, liveTeam, live, runtimeState, t }) {
      const myRoleId = role?.id;
      const ownName = liveTeam?.members?.find(m => m.id === sessionId)?.name;
      const ownUsage = usage.filter(row => row.id === sessionId || (!ownName && (row.name === role?.displayName || row.name === role?.id || baseName(row.name) === role?.id)));
      const ownEvidence = { ...d, memberEvidence: (d?.memberEvidence ?? []).filter(m => m.sessionId === sessionId) };
      const ownLiveTeam = liveTeam ? { ...liveTeam, members: (liveTeam.members ?? []).filter(m => m.id === sessionId) } : liveTeam;
      const control = runtimeState?.data?.taskControl;

      // 1. My Tasks
      const allTasks = Array.isArray(liveTeam?.tasks) ? liveTeam.tasks : [];
      const myTasks = allTasks.filter(task => {
        const owner = task.ownerName ?? task.owner;
        return owner && (owner === sessionId || owner === ownName || (!String(ownName ?? '').includes('/') && (owner === myRoleId || baseName(owner) === myRoleId)));
      });
      const taskWeight = { in_progress: 1, pending: 2, completed: 3 };
      const sortedTasks = [...myTasks].sort((a, b) => (taskWeight[a.status] ?? 9) - (taskWeight[b.status] ?? 9));

      // 2. Current Activity & Recent
      const act = live?.projections?.(sessionId)?.activity;
      const cur = act?.current;
      const recent = Array.isArray(act?.recent) ? act.recent : [];

      return h('div', { className: 'ctm-ov-block ctm-rv' },
        // Section 1: My Tasks
        h('div', { className: 'ctm-ov-block', 'data-section': 'my-tasks' },
          h('div', { className: 'ctm-label' }, t('roleview.myTasks')),
          sortedTasks.length
            ? h('div', { className: 'ctm-rv-tasks' },
                ...sortedTasks.map(task => h('div', { key: task.id, className: 'ctm-rv-task' },
                  h('div', { className: 'ctm-rv-task-title' },
                    h('span', { className: 'ctm-sub' }, `#${task.id}`),
                    h('span', { style: { fontWeight: 500 } }, task.subject)),
                  badge(label(t, `board.taskStatus.${task.status}`, task.status), task.status === 'in_progress' ? 'brand' : task.status === 'completed' ? 'success' : undefined, 'status'))))
            : h('p', { className: 'ctm-rv-empty' }, t('roleview.noTasks'))),

        // Section 2: Current Activity & Recent Activities
        h('div', { className: 'ctm-ov-block', 'data-section': 'activity' },
          h('div', { className: 'ctm-label' }, t('roleview.activity')),
          cur || recent.length
            ? h('div', { className: 'ctm-act-wrap' },
                cur ? h('div', { className: 'ctm-bd-bubble', style: { margin: '4px 0' } },
                  h('div', { className: 'ctm-bd-bubble-head' },
                    badge(act.phase === 'tool' ? (cur.tool ? fmt(t('activity.tool'), { tool: cur.tool }) : t('live.bubbleRunning')) : t('activity.processing'), 'brand', 'cur')),
                  h('div', { className: 'ctm-bd-bubble-body' }, [cur.summary, cur.target ? ` (${cur.target})` : null].filter(Boolean).join(''))) : null,
                recent.length
                  ? h(CollapsibleList, {
                      items: recent,
                      limit: 5,
                      t,
                      renderItem: (item, idx) => h('div', { key: item.id ?? item.callId ?? idx, className: 'ctm-act-row' },
                        h('span', { title: item.target ?? '' }, `${item.tool ? item.tool + ': ' : ''}${item.summary ?? ''}${item.target ? ' ' + item.target : ''}`),
                        h('span', { className: 'ctm-badge', 'data-tone': item.status === 'succeeded' ? 'success' : item.status === 'failed' ? 'error' : undefined }, item.status)),
                    })
                  : null)
            : h('p', { className: 'ctm-rv-empty' }, t('roleview.noActivity'))),

        // Section 3: Model & Permissions
        h('div', { className: 'ctm-ov-block', 'data-section': 'model-perms' },
          h('div', { className: 'ctm-label' }, t('roleview.modelAndPerms')),
          role ? h(RoleCards, { roles: [role], live: liveByRole, t }) : null),

        // Section 4: Task Control
        control && role
          ? h('div', { className: 'ctm-ov-block', 'data-section': 'task-control' },
              h('div', { className: 'ctm-label' }, t('roleview.taskControl')),
              h(TaskControl, { leadSessionId: live?.parentSessionId?.(sessionId) ?? sessionId, roleId: role.id, name: role.displayName ?? role.id, configured: role.provider ? `${role.provider}/${role.model}` : null, control, t }))
          : null,

        // Section 5: Usage
        h('div', { className: 'ctm-ov-block', 'data-section': 'usage' },
          h('div', { className: 'ctm-label' }, t('roleview.usage')),
          ownUsage.length
            ? h(UsageGroups, { rows: ownUsage, roles: role ? [role] : [], t })
            : h('p', { className: 'ctm-rv-empty' }, t('roleview.noUsage'))),

        // Section 6: Artifacts
        h('div', { className: 'ctm-ov-block', 'data-section': 'artifacts' },
          h('div', { className: 'ctm-label' }, t('roleview.artifacts')),
          h(ArtifactsRack, { sessionId, liveTeam: ownLiveTeam, live, t })),

        // Section 7: Logs
        h('div', { className: 'ctm-ov-block', 'data-section': 'logs' },
          h('div', { className: 'ctm-label' }, t('roleview.logs')),
          d ? h(EvidenceGroups, { d: ownEvidence, sessionId, t }) : h('p', { className: 'ctm-rv-empty' }, t('roleview.noLogs'))));
    }
