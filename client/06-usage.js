    const billable = u => (u?.uncachedInputTokens ?? 0) + (u?.cacheWriteTokens ?? 0) + (u?.outputTokens ?? 0);
    const isUnknownUsage = row => !row || !row.totals || row.coverage === 'unknown' || row.reportedSamples === 0;
    const usageTotal = rows => {
      const known = (rows ?? []).filter(r => !isUnknownUsage(r));
      return known.length ? known.reduce((n, row) => n + billable(row.totals), 0) : null;
    };
    const compact = n => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n);
    const splitRoute = route => { const i = route.indexOf('/'); return i > 0 ? { provider: route.slice(0, i), model: route.slice(i + 1) } : {}; };
    const PHASE = { provisioning: 'provisioning', failed: 'failed' };
    /** Roster and board tasks from the Lead's live `agentTeam` projection. Models are attached later by withTrustedRoutes. */
    function teamActivityFrom(team, live) {
      return {
        members: (team.members ?? []).map(m => ({ id: m.id, name: m.name, role: m.role,
          status: PHASE[m.phase] ?? (m.phase === 'active' ? (live.running(m.id) ? 'running' : 'idle') : 'inactive'),
          diagnostics: m.error ? [String(m.error.message ?? m.error)] : [] })),
        tasks: (team.tasks ?? []).map(task => ({
          id: task.id,
          subject: task.subject,
          status: task.status,
          ...(task.ownerName ? { ownerName: task.ownerName } : {}),
          ...(Array.isArray(task.blockedBy) ? { blockedBy: task.blockedBy } : task.blockedBy ? { blockedBy: [task.blockedBy] } : {}),
          ...(task.revision != null ? { revision: task.revision } : {}),
        })),
      };
    }
    /**
     * One usage row per member from DSH's own live projections: totals from token-meter's `tokenUsage`, timing from
     * `sessionStats`, the current model from trustedRoute (own usage routes). Per-model token splits come from the last refresh.
     */
    function usageRows(d, liveTeam, live) {
      const snapshot = new Map((d?.memberEvidence?.length ? d.memberEvidence : d ? [{ sessionId: d.sessionId, name: 'lead', ...(d.requestEvidence ?? {}) }] : [])
        .filter(m => m.usage).map(m => [m.sessionId, m]));
      const members = liveTeam?.members ?? [...snapshot.values()].map(m => ({ id: m.sessionId, name: m.name }));
      const refreshedAt = d?.at;
      return members.map(m => {
        const values = liveTeam ? live.projections(m.id) : undefined;
        const before = snapshot.get(m.id)?.usage;
        const route = trustedRoute(values, before);
        const ownUsage = values?.capabilityTeamUsage;
        // Follow the backend usage contract: read capabilityTeamUsage / snapshot own usage, never host tokenUsage (fork skew)
        const totals = ownUsage?.totals ?? before?.totals;
        const routes = (ownUsage?.routes?.length ? ownUsage.routes : before?.routes) ?? [];
        const coverage = ownUsage?.coverage ?? (before?.coverage ?? (totals ? 'complete' : 'unknown'));
        const reportedSamples = ownUsage?.reportedSamples ?? before?.reportedSamples ?? (totals ? 1 : 0);
        const attemptsWithoutUsage = ownUsage?.attemptsWithoutUsage ?? before?.attemptsWithoutUsage ?? 0;
        return {
          id: m.id, name: m.name, totals, routes, coverage, reportedSamples, attemptsWithoutUsage,
          refreshedAt: before ? refreshedAt : undefined,
          ...(route ? { model: route } : {}),
          ...(values?.sessionStats ? { stats: values.sessionStats } : {})
        };
      }).filter(row => row.totals || row.routes.length || row.stats || row.model);
    }
    /** Average model seconds per step, time to first token, and decode speed from one session's `sessionStats`. */
    function statsLine(stats, t) {
      if (!stats?.steps) return null;
      const parts = [fmt(t('usage.step'), { n: stats.steps, s: (stats.llmMs / stats.steps / 1000).toFixed(1) })];
      if (stats.ttftSteps) parts.push(fmt(t('usage.ttft'), { s: (stats.ttftMs / stats.ttftSteps / 1000).toFixed(1) }));
      if (stats.decodeMs) parts.push(fmt(t('usage.decode'), { n: Math.round(stats.decodeTokens / (stats.decodeMs / 1000)) }));
      return parts.join(' · ');
    }
    const STEP_CONTEXT_WARN = 80000; // average prompt per step above this usually means the session should rotate
    /** Average prompt tokens per step and the cache-read share of the prompt, from own usage and step stats. */
    function contextMetrics(totals, stats) {
      if (!totals || !stats?.steps) return null;
      const prompt = (totals.uncachedInputTokens ?? 0) + (totals.cacheReadTokens ?? 0) + (totals.cacheWriteTokens ?? 0);
      if (!prompt) return null;
      return { avgPrompt: Math.round(prompt / stats.steps), cacheShare: (totals.cacheReadTokens ?? 0) / prompt, heavy: prompt / stats.steps >= STEP_CONTEXT_WARN };
    }
    /** Per-member token usage, each role's budget when its capability sets maxTokens, and model time per step. */
    function UsageGroups({ rows: members, roles, t }) {
      const byId = new Map(roles.map(r => [r.id, r]));
      const top = Math.max(1, ...members.map(m => isUnknownUsage(m) ? 0 : billable(m.totals)));
      return h('div', { className: 'ctm-ov-block' },
        h('p', { className: 'ctm-sub ctm-ov-help' }, t('usage.hint')),
        members.length ? h('span', { className: 'ctm-label' }, fmt(t('usage.total'), { n: usageTotal(members) == null ? t('usage.unknown') : compact(usageTotal(members)) })) : null,
        ...(members.length ? members.map((m, index) => {
          const role = byId.get(m.name) ?? byId.get(baseName(m.name));
          // Same contract as usageTotal and cardMeters: the server sends zeroed totals with coverage 'unknown'.
          const used = isUnknownUsage(m) ? null : billable(m.totals);
          const max = role?.maxTokens;
          const ratio = max && used !== null ? Math.min(1, used / max) : (used !== null ? used / top : 0);
          const tone = max && used !== null && used >= max ? 'error' : max && ratio >= 0.8 ? 'warn' : undefined;
          const timing = statsLine(m.stats, t);
          const ctxm = used === null ? null : contextMetrics(m.totals, m.stats);
          const freshness = m.refreshedAt ? fmt(t('usage.asOf'), { time: timeOfDay(m.refreshedAt) }) : null;
          return h('details', { key: m.id ?? index, className: 'ctm-ov-group', open: index === 0 },
            h('summary', null,
              h('span', { className: 'ctm-name' }, role?.displayName ?? m.name),
              used !== null
                ? h('span', { className: 'ctm-sub ctm-us-num' }, fmt(t('usage.billable'), { n: compact(used) }))
                : h('span', { className: 'ctm-sub ctm-us-num' }, t('usage.unknown')),
              m.coverage === 'partial' ? badge(t('usage.partialLow'), 'warn', 'partial') : null,
              max ? badge(fmt(t('usage.budget'), { used: used !== null ? compact(used) : t('usage.unknown'), max: compact(max) }), tone ?? 'brand', 'b') : null),
            used !== null
              ? h('div', { className: 'ctm-us-meter', 'data-tone': tone, role: 'presentation' }, h('i', { style: { width: `${(ratio * 100).toFixed(1)}%` } }))
              : null,
            tone === 'error' ? h('p', { className: 'ctm-ov-note ctm-error' }, t('usage.over')) : null,
            ctxm ? h('div', { className: 'ctm-ov-log', title: t('usage.contextHint') },
              h('span', { className: 'ctm-sub ctm-us-num' }, fmt(t('usage.avgPrompt'), { n: compact(ctxm.avgPrompt) })),
              h('span', { className: 'ctm-sub ctm-us-num' }, fmt(t('usage.cacheShare'), { p: Math.round(ctxm.cacheShare * 100) })),
              ctxm.heavy ? badge(t('usage.heavyContext'), 'warn', 'heavy') : null) : null,
            m.model || m.stats ? h('div', { className: 'ctm-ov-log' },
              m.model ? h('span', { className: 'ctm-ov-route', title: m.model }, m.model) : null,
              timing ? h('span', { className: 'ctm-sub ctm-us-num', title: t('usage.stepHint') }, timing) : null) : null,
            freshness ? h('div', { className: 'ctm-sub ctm-freshness' }, freshness) : null,
            m.routes.length ? h('div', { className: 'ctm-ov-logs' }, ...m.routes.map(r => h('div', { key: r.route, className: 'ctm-ov-log' },
              h('span', { className: 'ctm-ov-route', title: r.route }, r.route),
              h('span', { className: 'ctm-sub ctm-us-num' }, fmt(t('usage.io'), { i: compact(r.uncachedInputTokens + r.cacheWriteTokens), o: compact(r.outputTokens) })),
              r.cacheReadTokens ? h('span', { className: 'ctm-sub ctm-us-num' }, fmt(t('usage.cacheRead'), { n: compact(r.cacheReadTokens) })) : null)))
              : m.model || m.stats ? null : h('p', { className: 'ctm-sub' }, t('usage.none')));
        }) : [h('p', { key: 'none', className: 'ctm-sub' }, t('usage.none'))]));
    }

    /** Live per-member request summary: the model of the latest request and how many steps it took so far. */
    function LiveRequests({ rows, t }) {
      const list = rows.filter(row => row.model || row.stats);
      if (!list.length) return null;
      return h('div', { className: 'ctm-ov-block' },
        h('span', { className: 'ctm-label' }, t('logs.live')),
        h(CollapsibleList, {
          items: list,
          limit: 5,
          className: 'ctm-ov-logs',
          t,
          renderItem: row => h('div', { key: row.id, className: 'ctm-ov-log' },
            h('span', { className: 'ctm-name' }, row.name),
            row.model ? h('span', { className: 'ctm-ov-route', title: row.model }, row.model) : null,
            row.stats?.steps ? h('span', { className: 'ctm-sub ctm-us-num' }, fmt(t('logs.steps'), { n: row.stats.steps })) : null),
        }));
    }

    function EvidenceGroups({ d, sessionId, t }) {
      const groups = d.memberEvidence?.length ? d.memberEvidence : [{ sessionId, name: '', ...(d.requestEvidence ?? {}) }];
      return h('div', { className: 'ctm-ov-block' },
        h('p', { className: 'ctm-sub ctm-ov-help' }, t('evidence.hint')),
        ...groups.map((member, index) => {
          const records = member.records ?? [];
          const self = member.sessionId === sessionId;
          return h('details', { key: member.sessionId ?? index, className: 'ctm-ov-group', open: index === 0 },
            h('summary', null,
              h('span', { className: 'ctm-name' }, member.name || t('logs.thisSession')),
              self && member.name ? badge(t('logs.thisSession'), 'brand', 'self') : null,
              h('span', { className: 'ctm-sub' }, fmt(t('logs.count'), { n: records.length }))),
            member.unavailable ? h('p', { className: 'ctm-ov-note ctm-warn' }, member.unavailable) : null,
            records.length ? h(CollapsibleList, {
              items: records,
              limit: 5,
              className: 'ctm-ov-logs',
              t,
              renderItem: record => h('div', { key: record.seq, className: 'ctm-ov-log' },
                h('span', { className: 'ctm-sub ctm-ov-seq' }, `#${record.seq}`),
                h('span', { className: 'ctm-ov-route', title: `${record.provider}/${record.model}` }, `${record.provider}/${record.model}`),
                badge(t('evidence.short.' + record.evidence), record.evidence === 'assistant-message' ? 'success' : undefined, 'kind'),
                record.interrupted ? badge(t('logs.interrupted'), 'warn', 'int') : null,
                h('span', { className: 'ctm-sub ctm-ov-time', title: t('evidence.' + record.evidence) }, when(record.time))),
            })
              : h('p', { className: 'ctm-sub' }, t('evidence.empty')));
        }));
    }

    /**
     * Live roster without any logged command: Lead + direct children from the read-only subagent catalog,
     * running/idle from host-pushed agent status, names/models/tasks from the last manual snapshot.
     */
    /** Pushed status wins; otherwise the catalog/snapshot, never trusting a possibly stale "running". */
    function memberStatus(member, push, fresh) {
      if (push) {
        if (push.error && !push.running) return 'failed';
        return push.running ? 'running' : 'idle';
      }
      if (member.resident === false) return 'inactive';
      if (member.status === 'running' && !fresh) return 'idle';
      return member.status ?? (member.resident ? 'idle' : 'inactive');
    }
    function liveRoster(leadId, snapshot, children, live, snapshotAt) {
      // A snapshot status is trusted only if no push could have been missed since it was taken.
      const fresh = !live || (snapshotAt ?? 0) >= live.startedAt;
      if (!snapshot && !children) return null;
      const known = new Map((snapshot?.members ?? []).map(m => [m.id, m]));
      const rows = children
        ? [known.get(leadId) ?? { id: leadId, name: 'lead', role: 'lead', diagnostics: [] },
          ...children.filter(c => c.kind === 'child').map(c => ({ ...(known.get(c.id) ?? { name: c.label ?? c.id, role: 'teammate', diagnostics: [] }), id: c.id, resident: c.activity === 'running' }))]
        : snapshot.members ?? [];
      const members = rows.map(m => {
        const push = live?.status?.(m.id);
        const status = memberStatus(m, push, fresh);
        return { ...m, status, since: push?.running ? push.since : undefined,
          diagnostics: push?.error && !push.running ? [push.error, ...(m.diagnostics ?? [])] : m.diagnostics ?? [] };
      });
      return { members, tasks: snapshot?.tasks ?? [], unavailable: snapshot?.unavailable, at: live ? Date.now() : undefined };
    }
    const LIVE = { running: 'brand', provisioning: 'brand', idle: 'success', failed: 'error', inactive: undefined };
    const elapsed = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    /** Join configured roles with live roster rows: Lead by role, teammates by their spawn name (= role id). */
