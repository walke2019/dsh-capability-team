    const BaseComponent = React.Component || class DummyComponent { constructor(props) { this.props = props; } };
    class ErrorBoundary extends BaseComponent {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      componentDidCatch(error, errorInfo) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('CapabilityTeam tab render error caught by ErrorBoundary:', error, errorInfo);
        }
      }
      render() {
        if (this.state.hasError) {
          const t = this.props.t ?? (k => k);
          return h('div', { className: 'ctm-ov-callout', 'data-tone': 'error', style: { margin: '16px' } },
            h('p', { className: 'ctm-error' }, t('error.tabCrashed')),
            this.state.error ? h('pre', { className: 'ctm-pre ctm-error' }, String(this.state.error?.message ?? this.state.error)) : null,
            h('button', { type: 'button', className: 'ctm-btn', style: { marginTop: '8px' }, onClick: () => this.setState({ hasError: false, error: null }) },
              t('models.reset')));
        }
        return this.props.children;
      }
    }

    /** The status command ships catalog rows as tuples to keep its (visible) log entry small. */
    function expandStatus(data) {
      const policy = data?.team?.modelPolicy;
      if (policy && Array.isArray(policy.rows)) {
        policy.rows = policy.rows.map(row => {
          if (!Array.isArray(row)) return row;
          const [key, tier, primaryFor = [], fallbackFor = []] = row;
          const slash = key.indexOf('/');
          return { key, provider: key.slice(0, slash), model: key.slice(slash + 1), tiers: tier ? [tier] : [], primaryFor, fallbackFor };
        });
      }
      return data;
    }
    /** Last manual snapshot per session: memory first, browser storage across panel reloads; never required. */
    const snapshotCache = (() => {
      const memory = new Map();
      const keyOf = id => `capability-team:snapshot:${id}`;
      return {
        get(id) {
          if (memory.has(id)) return memory.get(id);
          try { const raw = window.localStorage?.getItem(keyOf(id)); const value = raw ? JSON.parse(raw) : null; if (value) memory.set(id, value); return value; } catch { return null; }
        },
        put(id, value) {
          memory.set(id, value);
          try { window.localStorage?.setItem(keyOf(id), JSON.stringify(value)); } catch { /* storage full or blocked */ }
        },
      };
    })();
    /** Host-pushed agent status (no polling, nothing logged) plus the read-only direct-child catalog. */
    function liveStore(ctx) {
      const remote = ctx.remote;
      const sessions = ctx.sessions;
      const sessionStatus = ctx.uiSession?.sessionStatus;
      const states = new Map();
      const listeners = new Set();
      const requested = new Set();
      const baselines = new Map(), pendingStatus = new Map(), revisions = new Map(), watched = new Map();
      let generation = 0, disposed = false;
      let roster = 0;
      const notify = () => { for (const listener of listeners) listener(); };
      // DSH's own projection frames (agentTeam, modelSelection, tokenUsage, sessionStats) reach the shared Session store without any command.
      if (typeof sessions?.list?.subscribe === 'function') ctx.effect(() => sessions.list.subscribe(notify), 'capability-team: session store');
      const snapshot = () => { try { return sessions?.list?.getSnapshot?.(); } catch { return undefined; } };
      const nativeObserved = new Map();
      if (typeof sessionStatus?.subscribe === 'function') ctx.effect(() => sessionStatus.subscribe(() => {
        for (const id of watched.keys()) {
          const running = sessionStatus.getSnapshot()?.get(id)?.running;
          if (typeof running === 'boolean' && running !== nativeObserved.get(id)) {
            revisions.set(id, (revisions.get(id) ?? 0) + 1);
            states.delete(id); baselines.delete(id);
          }
          nativeObserved.set(id, running);
        }
        notify();
      }), 'capability-team: native session status');
      const statusOf = id => {
        const pushed = states.get(id);
        const running = sessionStatus?.getSnapshot?.()?.get(id)?.running;
        if (pushed) return pushed;
        if (baselines.has(id)) {
          const baseline = baselines.get(id);
          if (typeof running === 'boolean' && running !== baseline?.nativeRunning) return { known: true, running };
          return baseline;
        }
        if (typeof running === 'boolean') return { known: true, running };
        // Only listed host summaries carry a baseline; catalog-only byId rows default to false.
        const list = snapshot();
        const baseline = list?.ids?.includes(id) ? list.byId?.[id]?.running : undefined;
        return typeof baseline === 'boolean' ? { known: true, running: baseline } : undefined;
      };
      const ensureStatus = (id, force = false) => {
        if (disposed || !watched.has(id) || (!force && typeof statusOf(id)?.running === 'boolean') || pendingStatus.has(id) || typeof remote?.session?.state !== 'function') return;
        const ticket = { generation, revision: revisions.get(id) ?? 0 };
        if (force) baselines.set(id, { nativeRunning: sessionStatus?.getSnapshot?.()?.get(id)?.running }); // Ignore the previous connection's running bit.
        pendingStatus.set(id, ticket);
        Promise.resolve().then(() => {
          if (disposed || !watched.has(id) || generation !== ticket.generation || pendingStatus.get(id) !== ticket) return undefined;
          return remote.session.state({ sessionId: id });
        }).then(value => {
          if (disposed || !watched.has(id) || generation !== ticket.generation || pendingStatus.get(id) !== ticket || (revisions.get(id) ?? 0) !== ticket.revision) return;
          baselines.set(id, typeof value?.running === 'boolean' ? { known: true, running: value.running, nativeRunning: sessionStatus?.getSnapshot?.()?.get(id)?.running } : undefined);
          notify();
        }, () => {}); // Keep the ticket after failure: no render-driven retry loop.
      };
      ctx.effect(() => () => { disposed = true; generation++; pendingStatus.clear(); watched.clear(); }, 'capability-team: status baselines');
      if (typeof ctx.on === 'function') ctx.on('connection/reset', () => {
        generation++; states.clear(); baselines.clear(); pendingStatus.clear(); revisions.clear(); roster++;
        for (const id of watched.keys()) ensureStatus(id, true);
        notify();
      });
      const on = (event, listener) => { if (typeof remote?.$on === 'function') ctx.effect(() => remote.$on(event, listener), `capability-team: ${event}`); };
      on('api-session/status', (id, running) => {
        revisions.set(id, (revisions.get(id) ?? 0) + 1);
        const previous = states.get(id) ?? {};
        if (!previous.known) roster++;
        states.set(id, { known: true, running: !!running, since: running ? previous.since ?? Date.now() : undefined, error: running ? undefined : previous.error });
        notify();
      });
      on('api-session/error', (id, message) => { revisions.set(id, (revisions.get(id) ?? 0) + 1); states.set(id, { ...(statusOf(id) ?? {}), known: true, error: String(message) }); notify(); });
      on('api-session/added', () => { roster++; notify(); });
      on('api-session/removed', id => { revisions.set(id, (revisions.get(id) ?? 0) + 1); states.set(id, { known: true, running: false }); baselines.delete(id); roster++; notify(); });
      return {
        startedAt: Date.now(),
        watchMembers(ids) {
          const members = new Set(ids);
          for (const id of members) {
            if (!watched.has(id)) nativeObserved.set(id, sessionStatus?.getSnapshot?.()?.get(id)?.running);
            watched.set(id, (watched.get(id) ?? 0) + 1); ensureStatus(id);
          }
          return () => { for (const id of members) {
            const count = (watched.get(id) ?? 1) - 1;
            if (count) watched.set(id, count);
            else { watched.delete(id); nativeObserved.delete(id); baselines.delete(id); pendingStatus.delete(id); }
          } };
        },
        /** Live projection values of one session; asks the host once for a session the store has not loaded yet. */
        projections(id) {
          const entry = snapshot()?.projectionsBySession?.[id];
          if (!entry && id && !requested.has(id) && typeof sessions?.refreshProjections === 'function') {
            requested.add(id);
            sessions.refreshProjections(id).catch(() => { requested.delete(id); });
          }
          return entry?.values;
        },
        parentSessionId: id => {
          const direct = snapshot()?.projectionsBySession?.[id]?.values?.agentTeam?.parentSessionId;
          if (direct) return direct;
          try {
            return sessions?.binding?.(id)?.session?.getSnapshot?.()?.subagent?.address?.parentSessionId;
          } catch { return undefined; }
        },
        // True when the session is a subagent (has a subagent address) but its parent could not be resolved;
        // the overview must then show only the notice, never a team canvas rooted at the wrong session.
        isOrphanSubagent: id => {
          try {
            const addr = sessions?.binding?.(id)?.session?.getSnapshot?.()?.subagent?.address;
            const direct = snapshot()?.projectionsBySession?.[id]?.values?.agentTeam?.parentSessionId;
            return !!addr && !addr.parentSessionId && !direct;
          } catch { return false; }
        },
        running: id => statusOf(id)?.running,
        status: statusOf,
        rosterVersion: () => roster,
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        preset: id => {
          const direct = snapshot()?.projectionsBySession?.[id]?.values?.agentPreset;
          if (direct !== undefined) return direct;
          try {
            const b = sessions?.binding?.(id)?.session?.getSnapshot?.()?.agentPreset;
            if (b !== undefined) return b;
          } catch {}
          try {
            const s = snapshot()?.byId?.[id]?.preset;
            if (s !== undefined) return s;
          } catch {}
          const parentId = snapshot()?.projectionsBySession?.[id]?.values?.agentTeam?.parentSessionId
            || sessions?.binding?.(id)?.session?.getSnapshot?.()?.subagent?.address?.parentSessionId;
          if (parentId && parentId !== id) {
            const p = snapshot()?.projectionsBySession?.[parentId]?.values?.agentPreset;
            if (p !== undefined) return p;
            try {
              const pb = sessions?.binding?.(parentId)?.session?.getSnapshot?.()?.agentPreset;
              if (pb !== undefined) return pb;
            } catch {}
          }
          return undefined;
        },
        isCapabilityTeam: id => {
          if (!id) return false;
          const directPreset = snapshot()?.projectionsBySession?.[id]?.values?.agentPreset;
          if (directPreset === 'capability-team') return true;
          if (directPreset && directPreset !== 'capability-team') return false;
          const vals = snapshot()?.projectionsBySession?.[id]?.values;
          if (vals?.capabilityTeamConfig !== undefined || vals?.capabilityTeamActivity !== undefined || vals?.capabilityTeamUsage !== undefined) return true;
          const parentId = vals?.agentTeam?.parentSessionId
            || sessions?.binding?.(id)?.session?.getSnapshot?.()?.subagent?.address?.parentSessionId;
          if (parentId && parentId !== id) {
            const parentP = snapshot()?.projectionsBySession?.[parentId]?.values?.agentPreset;
            if (parentP === 'capability-team') return true;
            if (parentP && parentP !== 'capability-team') return false;
            const parentVals = snapshot()?.projectionsBySession?.[parentId]?.values;
            if (parentVals?.capabilityTeamConfig !== undefined || parentVals?.capabilityTeamActivity !== undefined || parentVals?.capabilityTeamUsage !== undefined) return true;
          }
          const s = snapshot()?.byId?.[id]?.preset;
          if (s === 'capability-team') return true;
          if (s && s !== 'capability-team') return false;
          return undefined;
        },
        async children(parentId) {
          const reply = await remote?.subagents?.list?.(parentId);
          if (!reply?.ok) throw new Error(reply?.error?.message ?? 'subagent catalog unavailable');
          return reply.value?.entries ?? [];
        },
      };
    }

    const VIEWS = {
      capability_dispatch_plan: DispatchPlanView,
      capability_free_task: FreeTaskView,
      capability_team_read: teamView('read'),
      capability_team_save: teamView('save'),
      capability_team_import: teamView('save'),
      capability_model_catalog: CatalogView,
      capability_task_budget: BudgetView,
      capability_member_override: OverrideView,
      capability_team_export: ExportView,
      omni_search: SearchView,
      omni_fetch: FetchView,
      capability_handoff: HandoffView,
      capability_rotate_member: RotateView,
      capability_memory_search: MemorySearchView,
      capability_memory_write: MemoryWriteView,
      capability_model_prefs: PrefsView,
    };

    // Test-only seam: harnesses may define window.__ctmTestHook to reach components; browsers never do.
    if (typeof window.__ctmTestHook === 'function') window.__ctmTestHook({ TaskControl, leaseFor, DispatchConfirmCard, DirectConfirmCard, ConfirmDock, dockedSessions, DispatchPlanView, ModelPicker, filterRoutes, CatalogView, BudgetView, SearchView, ExportView, contextMetrics, RoleView, ModelSubTabs, CollapsibleList });
    const plugin = {
      inject: ['slots', 'locale', 'remote', 'remote.commands', 'remote.credentials', 'configForms', 'sidebarRightTabs', 'sessions', 'uiSession', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'capability-team: dictionaries');
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = '@aiwuk/team';
          tag.textContent = CSS + STAGE_CSS;
          document.head.appendChild(tag);
          // Stage canvas colors re-resolve on the host theme/change event (the body-attribute observer is the fallback).
          const offTheme = stageTheme.bind(ctx);
          return () => { offTheme(); tag.remove(); };
        }, 'capability-team: styles + stage theme');
        const bound = ctx.locale.bind(NS);
        const execute = async (sessionId, line) => {
          const reply = await ctx.remote.commands.execute(sessionId, line, []);
          if (!reply.ok) throw new Error(reply.error?.message ?? 'Remote command failed');
          const result = reply.value?.result;
          if (!result || result.kind === 'error') throw new Error(result?.text ?? 'capability-status is unavailable');
          const data = parse(result.text);
          if (!data) throw new Error('Invalid capability-status response');
          return data;
        };
        const load = async sessionId => expandStatus(await execute(sessionId, '/capability-status'));
        const live = liveStore(ctx);
        const onboardingGate = registerOnboarding(ctx, bound);
        const save = (sessionId, disabledRoutes, expectedRevision) => execute(sessionId,
          '/capability-model-policy ' + JSON.stringify({ disabledRoutes, expectedRevision }));
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: 'capability-team-overview', kind: 'capability-team-overview',
          title: () => bound('overview.title'),
          guide: [{ order: 35, title: () => bound('overview.title'), description: () => bound('overview.hint') }],
        }), 'capability-team: right sidebar tab');
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab', key: 'capability-team-overview', id: 'capability-team-overview', locale: NS,
        }, props => {
          const effectiveLive = props.live ?? live;
          const targetSessionId = props.sessionId;
          const isCtm = effectiveLive?.isCapabilityTeam?.(targetSessionId);
          if (isCtm === false) {
            return h('div', { className: 'ctm-ov-empty ctm-not-mounted', 'data-tone': 'warn', style: { padding: '24px' } },
              onboardingGate(props), h('p', { className: 'ctm-sub' }, bound('overview.notMounted')));
          }
          return h(Overview, { ...props, onboarding: props.onboarding ?? onboardingGate,
          // Overview follows the host locale service (`locale`) and re-renders on a language switch. `t` is only
          // passed through when a caller (a test harness) injects one; `hostT` is the fallback for missing keys.
          locale: props.locale ?? ctx.locale, hostT: bound, load: props.load ?? load, save: props.save ?? save, live: effectiveLive, cache: props.cache ?? snapshotCache,
          // Same navigation as DSH's own Team panel: open normal session for Lead or continuable subagent address for teammate.
          openMember: typeof ctx.uiWorkspace?.openSession === 'function'
            ? (parentSessionId, childSessionId) => {
              if (!childSessionId || childSessionId === parentSessionId) {
                ctx.uiWorkspace.openSession(parentSessionId);
              } else {
                ctx.uiWorkspace.openSession({ parentSessionId, childSessionId, mode: 'continuable' });
              }
            } : undefined });
        }));
        // Each view receives `t`; fall back to the bound translator when the slot does not inject one.
        const withT = View => function CapabilityToolView(props) { return h(View, { ...props, t: props.t ?? bound }); };
        // Pending dispatch / direct confirmations open right above the input box, where the user sees them.
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'capability-team-confirm', order: 5,
          locale: NS, inject: sessionId => ({ sessionId }) }, withT(ConfirmDock)));
        for (const [key, View] of Object.entries(VIEWS)) {
          // `inject` hands each view its session id, which the dispatch confirmation card needs.
          ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key, locale: NS, inject: sessionId => ({ sessionId }) }, withT(View)));
        }
      },
    };
