    // ---------- which model a member is shown with ----------
    // The host's listMembers model is not kept in sync with real requests, so it is never displayed. Priority:
    // 1) the route of the latest request header, from this plugin's own capabilityTeamUsage.lastRoute
    //    (live projection, else the last refresh) — the model a request was actually sent to, failover included;
    // 2) older checkpoints without lastRoute: the recorded usage routes, with modelSelection.next accepted only
    //    when it is one of them;
    // 3) otherwise nothing here, and the board falls back to the configured primary, labelled "config".
    // The Lead follows the user's pick (lead-route.js); before its first request it shows that pick, labelled as such.
    const isRouteKey = route => typeof route === 'string' && route !== 'unknown' && route.indexOf('/') > 0;
    /** Routes this member actually sent requests to, in the order the plugin first recorded them. */
    function recordedRoutes(values, snapshotUsage) {
      const own = values?.capabilityTeamUsage?.routes;
      const rows = (own?.length ? own : snapshotUsage?.routes) ?? [];
      return rows.map(row => row?.route).filter(isRouteKey);
    }
    /** Route of the latest request header, or null when none is recorded. */
    function latestRequestRoute(values, snapshotUsage) {
      const last = values?.capabilityTeamUsage?.lastRoute ?? snapshotUsage?.lastRoute;
      return isRouteKey(last) ? last : null;
    }
    /** Latest trusted route for one member, or null when the plugin has not recorded a request yet. */
    function trustedRoute(values, snapshotUsage) {
      const latest = latestRequestRoute(values, snapshotUsage);
      if (latest) return latest;
      const routes = recordedRoutes(values, snapshotUsage);
      if (!routes.length) return null;
      const next = values?.modelSelection?.next;
      const pick = next?.provider && next.model ? `${next.provider}/${next.model}` : null;
      return pick && routes.includes(pick) ? pick : routes[routes.length - 1];
    }
    /** The Lead's actual route; before any recorded request, the model the user picked in the conversation. */
    function leadRoute(values, snapshotUsage) {
      const actual = trustedRoute(values, snapshotUsage);
      if (actual) return { route: actual, from: 'request' };
      const next = values?.modelSelection?.next;
      return next?.provider && next.model ? { route: `${next.provider}/${next.model}`, from: 'pick' } : null;
    }
    /** Replace every roster member's model with its trusted route; members without one carry no model. */
    function withTrustedRoutes(roster, live, d) {
      if (!roster) return roster;
      const evidence = new Map((d?.memberEvidence ?? []).map(m => [m.sessionId, m.usage]));
      if (d?.sessionId && !evidence.has(d.sessionId) && d.requestEvidence?.usage) evidence.set(d.sessionId, d.requestEvidence.usage);
      return { ...roster, members: (roster.members ?? []).map(m => {
        const { provider: _hostProvider, model: _hostModel, ...rest } = m;
        const values = live?.projections?.(m.id), usage = evidence.get(m.id);
        const shown = m.role === 'lead' ? leadRoute(values, usage) : (r => r ? { route: r, from: 'request' } : null)(trustedRoute(values, usage));
        return shown ? { ...rest, ...splitRoute(shown.route), modelFrom: shown.from } : rest;
      }) };
    }
    /** Routes a role may legitimately use: its primary, declared fallbacks and long-context route. */
    function allowedRoutes(role, allocation) {
      const list = [allocation?.primary ?? (role?.provider ? `${role.provider}/${role.model}` : null),
        ...(allocation?.fallbacks ?? []), ...(Array.isArray(role?.fallbacks) ? role.fallbacks : []).map(routeText),
        role?.longContext?.provider ? `${role.longContext.provider}/${role.longContext.model}` : null];
      return [...new Set(list.filter(isRouteKey))];
    }
    const isLeadRole = role => role?.id === 'lead' || role?.capability === 'orchestrator';
    /** True when a trusted route lies outside what the role is configured for; unknown config and the Lead never warn. */
    function routeOutsideConfig(route, role, allocation) {
      if (isLeadRole(role)) return false;
      const allowed = allowedRoutes(role, allocation);
      return !!(isRouteKey(route) && allowed.length && !allowed.includes(route));
    }
    /** Small warning marker for a model outside the role's primary and fallbacks. */
    function routeWarnBadge(t) {
      return h('span', { key: 'route-warn', className: 'ctm-badge', 'data-tone': 'warn', 'data-route-warn': '', title: t('live.routeWarnHint') }, t('live.routeWarn'));
    }
