    function Overview({ sessionId, t: injectedT, hostT, load, save, live, cache, openMember }) {
      const [state, setState] = React.useState({ pending: false });
      const [tab, setTab] = React.useState('models');
      const ticket = React.useRef(0);
      const [, redraw] = React.useState(0);
      const [children, setChildren] = React.useState(null);
      // Own locale state (item 3): independent of the host's locale/`t`. Reads localStorage once on mount and
      // defaults to English when nothing is stored — it must never silently follow the host's Chinese locale by
      // string-sniffing a host-translated string. setState below triggers a normal re-render; this toggle never
      // calls window.location.reload.
      const [locale, setLocale] = React.useState(() => {
        try { return window.localStorage?.getItem('dsh-capability-team-locale') === 'zh' ? 'zh' : 'en'; } catch { return 'en'; }
      });
      const toggleLocale = () => {
        // Use the functional updater so two toggles fired before a re-render (e.g. a test harness calling the
        // handler twice in a row, or a user double-click) each flip from the true latest value instead of both
        // reading the same stale render-time `locale` closure and landing on the same next value twice.
        setLocale(prev => {
          const next = prev === 'zh' ? 'en' : 'zh';
          try { window.localStorage?.setItem('dsh-capability-team-locale', next); } catch { /* storage unavailable */ }
          return next;
        });
      };
      const isZh = locale === 'zh';
      // Item 3 (true bilingual rendering): the plugin's own zh/en dictionaries are now the source of truth for
      // every t() call inside Overview, keyed off this component's own `locale` state — not the host's. A test
      // harness that injects its own `props.t` (the ~40+ existing `t: key => key` sites) keeps getting that exact
      // function verbatim, so none of those raw-key-echo assertions change. In production, where the host passes
      // its own translator as `hostT` (see the registration site) and does not inject `props.t`, this looks the
      // key up in the plugin's own dictionary for the current `locale` first, interpolates {vars} with fmt, and
      // only falls back to the host's translator (then the bare key) when the plugin has no entry for that key —
      // so the host's locale can never override the plugin's own toggle once this component owns a word for it.
      const dict = isZh ? zh : en;
      const ownTranslator = (key, vals) => {
        const template = dict[key] ?? en[key];
        if (template !== undefined) return vals ? fmt(template, vals) : template;
        if (typeof hostT === 'function') return hostT(key, vals);
        return key;
      };
      const t = injectedT ?? ownTranslator;
      // Root cause of the subagent canvas/roster mismatch (see item 5): a teammate session's own id is not the
      // team's root. Every roster/projection/runtime/open-session call below must use the resolved Lead session
      // id (parentSessionId when this is a subagent, else its own id), never the raw `sessionId` alone.
      const parentSessionId = live?.parentSessionId?.(sessionId);
      const isTeammateSession = !!(parentSessionId && parentSessionId !== sessionId);
      const isOrphanSubagent = !isTeammateSession && !!live?.isOrphanSubagent?.(sessionId);
      const effectiveSessionId = parentSessionId || sessionId;
      const configVersionNow = () => live?.projections?.(effectiveSessionId)?.capabilityTeamConfig?.version;
      // The status command leaves a card in the conversation (never model context), so it runs on a click, once when
      // a team session has no snapshot yet, and again only when a configuration save moves the config counter.
      const refresh = async () => {
        const id = ++ticket.current;
        const configVersion = configVersionNow();
        setState(previous => ({ ...(previous.sessionId === effectiveSessionId ? previous : {}), pending: true, error: undefined, sessionId: effectiveSessionId }));
        try {
          const data = await load(effectiveSessionId);
          const at = Date.now();
          cache?.put(effectiveSessionId, { data, at, configVersion });
          if (ticket.current === id) setState({ data, sessionId: effectiveSessionId, at, configVersion });
        } catch (error) {
          if (ticket.current === id) setState(previous => ({ ...(previous.sessionId === effectiveSessionId ? previous : {}), pending: false, error: String(error.message ?? error), sessionId: effectiveSessionId }));
        }
      };
      React.useEffect(() => () => { ticket.current++; }, [effectiveSessionId]);
      // Host-pushed status changes and the read-only subagent catalog never touch the session log.
      React.useEffect(() => live?.subscribe(() => redraw(n => n + 1)), [live]);
      const rosterVersion = live?.rosterVersion() ?? 0;
      React.useEffect(() => {
        if (!live) return undefined;
        let stopped = false;
        live.children(effectiveSessionId).then(entries => { if (!stopped) setChildren({ sessionId: effectiveSessionId, entries }); }, () => {});
        return () => { stopped = true; };
      }, [effectiveSessionId, live, rosterVersion]);
      const stored = state.sessionId === effectiveSessionId ? state : null;
      const cached = stored?.data ? null : cache?.get(effectiveSessionId);
      // Before the first manual read in this panel, show the last cached snapshot for this session.
      const current = cached ? { ...stored, data: cached.data, at: cached.at, configVersion: cached.configVersion, cached: true } : stored ?? {};
      const d = current.data;
      // The Lead's agentTeam projection is pushed live; without it the board falls back to the last refresh.
      const liveTeam = live?.projections?.(effectiveSessionId)?.agentTeam;
      const liveActivity = liveTeam ? teamActivityFrom(liveTeam, live) : null;
      const roster = liveRoster(effectiveSessionId, liveActivity ?? d?.activity, children?.sessionId === effectiveSessionId ? children.entries : null, live, liveActivity ? Date.now() : current.at);
      const usage = usageRows(d, liveTeam, live);
      const shown = !isOrphanSubagent && !!(d || liveTeam);
      const boardRoles = d?.team?.roles ?? (liveTeam?.members ?? []).map(m => ({ id: m.name, displayName: m.name, ...(m.role === 'lead' ? { capability: 'orchestrator' } : {}) }));
      const configVersion = configVersionNow();
      // At most one automatic read per session and config counter; a failed one waits for a click or the next save.
      const autoKey = React.useRef('');
      React.useEffect(() => {
        if (current.pending || !liveTeam) return;
        const formed = (liveTeam.members?.length ?? 0) > 1;
        const stale = d ? configVersion !== undefined && current.configVersion !== configVersion : formed;
        const key = `${effectiveSessionId}:${d ? configVersion : 'initial'}`;
        if (!stale || autoKey.current === key) return;
        autoKey.current = key;
        refresh();
      }, [effectiveSessionId, configVersion, !!d, !!liveTeam, liveTeam?.members?.length, current.pending]);
      // MVP-B: Failover runtime HTTP / SSE client
      const [runtimeState, setRuntimeState] = React.useState({ data: null, lag: false, unavailable: false });
      const lastEpoch = React.useRef(null);

      React.useEffect(() => {
        const AC = typeof AbortController === 'function' ? AbortController : class { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; } };
        let abortCtrl = new AC();
        let es = null;

        const updateData = (newData, isLag = false) => {
          if (!newData || typeof newData !== 'object' || newData.schemaVersion !== 1) {
            setRuntimeState({ data: null, lag: false, unavailable: true });
            return;
          }
          if (lastEpoch.current && lastEpoch.current !== newData.epoch) {
            // Epoch 发生变化：运行时已重启
            setRuntimeState({ data: newData, lag: isLag, unavailable: false, restarted: true });
          } else {
            setRuntimeState({ data: newData, lag: isLag, unavailable: false });
          }
          lastEpoch.current = newData.epoch;
        };

        const fetchFallback = async () => {
          if (typeof fetch !== 'function') return;
          try {
            const res = await fetch(apiUrl('api/capability-team.runtime', { sessionId: effectiveSessionId }), { signal: abortCtrl.signal });
            if (res.status === 404) {
              setRuntimeState({ data: null, lag: false, unavailable: false });
              return;
            }
            if (!res.ok) {
              setRuntimeState({ data: null, lag: false, unavailable: true });
              return;
            }
            const json = await res.json();
            updateData(json, true);
          } catch (e) {
            if (!abortCtrl.signal.aborted) {
              setRuntimeState({ data: null, lag: false, unavailable: true });
            }
          }
        };

        // 优先尝试 SSE
        if (typeof EventSource === 'function') {
          try {
            es = new EventSource(apiUrl('api/capability-team.runtime/stream', { sessionId: effectiveSessionId }));
            es.onmessage = evt => {
              try {
                const json = JSON.parse(evt.data);
                updateData(json, false);
              } catch {
                // parse error
              }
            };
            es.onerror = () => {
              if (es) es.close();
              es = null;
              fetchFallback();
            };
          } catch {
            fetchFallback();
          }
        } else {
          fetchFallback();
        }

        return () => {
          abortCtrl.abort();
          if (es) es.close();
        };
      }, [effectiveSessionId]);

      // 降级模式下：真实 running 状态 + modelSelection 实际路由变化时 GET 一次
      const memberSig = (liveTeam?.members ?? []).map(m => {
        const isRunning = live?.running ? live.running(m.id) : false;
        const next = live?.projections?.(m.id)?.modelSelection?.next;
        const route = next?.provider && next.model ? `${next.provider}/${next.model}` : '';
        return `${m.id}:${isRunning ? 'running' : 'idle'}:${route}`;
      }).join('|');
      React.useEffect(() => {
        if (!runtimeState.lag) return;
        const AC = typeof AbortController === 'function' ? AbortController : class { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; } };
        const ctrl = new AC();
        if (typeof fetch === 'function') {
          fetch(apiUrl('api/capability-team.runtime', { sessionId: effectiveSessionId }), { signal: ctrl.signal })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
              if (data && data.schemaVersion === 1) {
                setRuntimeState(prev => ({ ...prev, data, lag: true }));
              }
            })
            .catch(() => {});
        }
        return () => ctrl.abort();
      }, [effectiveSessionId, memberSig, runtimeState.lag]);
      const liveByRole = new Map((roster?.members ?? []).map(m => [m.role === 'lead' ? 'lead' : m.name, m]));
      const since = new Map((roster?.members ?? []).filter(m => m.since).map(m => [m.id, m.since]));
      const working = (roster?.members ?? []).filter(m => m.status === 'running').length;
      const team = d?.team;
      const policy = team?.modelPolicy;
      const blocked = (policy?.allocations ?? []).filter(a => a.status !== 'eligible').length;
      const savedOff = ruleMatcher(policy?.disabledRoutes ?? []);
      const disabledCount = (policy?.rows ?? []).filter(row => savedOff(row.key)).length;
      const health = !d ? null
        : d.ready ? { tone: 'success', text: t('overview.ready') }
        : d.preset !== 'capability-team' ? { tone: 'warn', text: t('overview.notMounted') }
        : { tone: 'error', text: t('overview.abnormal') };
      const diagnostics = d ? [
        h('p', { key: 'e', className: 'ctm-text' }, d.explanation),
        h('div', { key: 'f', className: 'ctm-chips' },
          chip(t('overview.preset'), d.preset ?? '—', 'preset'),
          team?.project ? chip(t('team.project'), team.project, 'project') : null,
          d.missingTools?.length ? chip(t('overview.missingTools'), d.missingTools.join(t('common.listSep')), 'missing') : null),
        d.activationError ? h('pre', { key: 'a', className: 'ctm-pre ctm-error' }, d.activationError) : null,
        d.teamError ? h('p', { key: 't', role: 'alert', className: 'ctm-error' }, d.teamError) : null,
      ] : [];
      const tabs = [
        ['models', policy?.rows?.length],
        ['roles', team?.roles?.length],
        ['usage', usageTotal(usage) ? compact(usageTotal(usage)) : null],
        ['artifacts', null],
        ['report', null],
        ['integrations', null],
        ['logs', (d?.memberEvidence?.length ? d.memberEvidence : [d?.requestEvidence ?? {}]).reduce((n, m) => n + (m.records?.length ?? 0), 0)],
      ];
      const currentMember = isTeammateSession && liveTeam?.members?.find(m => m.id === sessionId);
      const subagentNoticeNode = isTeammateSession ? h('div', { className: 'ctm-ov-callout', 'data-tone': 'brand', style: { marginBottom: '12px' } },
        h('p', { style: { fontWeight: 600 } }, t('subagent.notice')),
        currentMember ? h('p', { className: 'ctm-sub' }, fmt(t('subagent.currentMember'), { name: currentMember.name, role: currentMember.role ?? currentMember.id })) : null,
        // The "open Lead session" shortcut only appears when the host actually exposes an open-session API
        // (same capability that backs `openMember`); otherwise there is nothing useful for the button to do.
        openMember ? h('button', { type: 'button', className: 'ctm-btn', onClick: () => openMember(effectiveSessionId, effectiveSessionId) }, t('subagent.openLead')) : null)
        : isOrphanSubagent ? h('div', { className: 'ctm-ov-callout', 'data-tone': 'warn', style: { marginBottom: '12px' } },
          h('p', { style: { fontWeight: 600 } }, t('subagent.unresolved'))) : null;
      return h('section', { className: 'ctm-ov' },
        h('header', { className: 'ctm-ov-head' },
          h('div', { className: 'ctm-ov-titlerow' },
            h('h2', { className: 'ctm-ov-title' }, t('overview.title')),
            health ? badge(health.text, health.tone, 'health') : null,
            liveTeam ? badge(t('overview.live'), 'success', 'live') : null,
            h('button', { type: 'button', className: 'ctm-btn ctm-ov-refresh', disabled: current.pending, onClick: refresh, 'aria-busy': !!current.pending },
              t(current.pending ? 'overview.loading' : 'overview.refresh')),
            h('button', {
              type: 'button',
              className: 'ctm-btn ctm-lang-toggle',
              title: t('lang.title'),
              onClick: toggleLocale,
            }, t('lang.toggle'))),
          h('p', { className: 'ctm-sub' }, team ? [team.name, fmt(t('overview.revision'), { rev: team.revision })].filter(Boolean).join(' · ') : t('overview.hint'),
            current.at ? ` · ${fmt(t('overview.updated'), { time: when(current.at) })}` : ''),
          h('p', { className: 'ctm-sub ctm-ov-lognote' }, t('overview.logNote'))),
        h('div', { className: 'ctm-ov-scroll' },
          subagentNoticeNode,
          current.error ? h('p', { role: 'alert', className: 'ctm-ov-callout', 'data-tone': 'error' }, current.error) : null,
          !shown ? h('div', { className: 'ctm-ov-empty' }, h('p', { className: 'ctm-sub' }, t(current.pending ? 'overview.loading' : 'overview.empty')),
            current.pending ? null : h('button', { type: 'button', className: 'ctm-btn', 'data-primary': '', onClick: refresh }, t('overview.firstLoad'))) : null,
          d && team ? h('div', { className: 'ctm-ov-stats' },
            stat(team.roles?.length ?? 0, t('overview.statRoles'), undefined, 'r'),
            stat(working, t('overview.statWorking'), working ? 'brand' : undefined, 'w'),
            stat(policy?.rows?.length ?? 0, t('overview.statModels'), undefined, 'm'),
            stat(disabledCount, t('overview.statDisabled'), disabledCount ? 'warn' : undefined, 'd'),
            stat(blocked, t('overview.statBlocked'), blocked ? 'error' : undefined, 'b')) : null,
          d ? (d.ready
            ? h('details', { className: 'ctm-ov-group ctm-ov-diag' }, h('summary', null, h('span', { className: 'ctm-name' }, t('overview.details'))), h('div', { className: 'ctm-ov-block' }, ...diagnostics))
            : h('div', { className: 'ctm-ov-callout', 'data-tone': health.tone }, ...diagnostics)) : null,
          ...(team?.catalogErrors ?? []).map(error => h('p', { key: error.provider, role: 'alert', className: 'ctm-ov-callout', 'data-tone': 'error' }, `${error.provider}: ${error.error}`)),
          shown ? h('nav', { className: 'ctm-ov-tabs', 'aria-label': t('overview.title') },
            ...tabs.map(([id, count]) => h('button', { key: id, type: 'button', className: 'ctm-ov-tab', 'aria-pressed': tab === id, onClick: () => setTab(id) },
              t('nav.' + id), count ? h('span', { className: 'ctm-ov-count' }, String(count)) : null))) : null,
          shown ? h('div', { className: 'ctm-ov-panel', 'data-panel': 'usage', hidden: tab !== 'usage' },
            h(ErrorBoundary, { key: `${effectiveSessionId}:usage`, t }, h(UsageGroups, { rows: usage, roles: team?.roles ?? [], t }))) : null,
          shown ? h('div', { className: 'ctm-ov-panel', 'data-panel': 'logs', hidden: tab !== 'logs' },
            h(ErrorBoundary, { key: `${effectiveSessionId}:logs`, t },
              liveTeam ? h(LiveRequests, { rows: usage, t }) : null,
              d ? h(EvidenceGroups, { d, sessionId: effectiveSessionId, t }) : h('p', { className: 'ctm-sub' }, t('overview.noData')))) : null,
          shown ? h('div', { className: 'ctm-ov-panel', 'data-panel': 'models', hidden: tab !== 'models' },
            h(ErrorBoundary, { key: `${effectiveSessionId}:models`, t },
              runtimeState.restarted ? h('p', { className: 'ctm-ov-callout', 'data-tone': 'warn' }, t('runtime.restarted')) : null,
              runtimeState.lag ? h('p', { className: 'ctm-sub ctm-warn' }, t('runtime.snapshotLag')) : null,
              runtimeState.unavailable ? h('p', { className: 'ctm-sub ctm-warn' }, t('runtime.unavailable')) : null,
              h('div', { className: 'ctm-ov-split' },
                // Root cause fix: this used to pass the raw (possibly teammate) sessionId as the "parent" argument to
                // openMember, so opening a member from inside a subagent session targeted the wrong parent.
                team || liveTeam ? h(TeamBoard, { roles: boardRoles, activity: roster, allocations: policy?.allocations, since, t, open: openMember && (id => openMember(effectiveSessionId, id)), live, usage, runtimeState, currentMemberId: isTeammateSession ? sessionId : null, leadSessionId: effectiveSessionId }) : null,
                policy ? h(PolicyEditor, { key: `${effectiveSessionId}:${policy.revision}`, sessionId: effectiveSessionId, policy, save, t }) : h('p', { className: 'ctm-sub' }, t('overview.noData'))))) : null,
          shown ? h('div', { className: 'ctm-ov-panel', 'data-panel': 'artifacts', hidden: tab !== 'artifacts' },
            h(ErrorBoundary, { key: `${effectiveSessionId}:artifacts`, t },
              h(ArtifactsRack, { sessionId: effectiveSessionId, liveTeam, live, t }))) : null,
          shown ? h('div', { className: 'ctm-ov-panel', 'data-panel': 'integrations', hidden: tab !== 'integrations' },
            h(ErrorBoundary, { key: `${effectiveSessionId}:integrations`, t }, tab === 'integrations' ? h(IntegrationsPanel, { t }) : null)) : null,
          shown ? h('div', { className: 'ctm-ov-panel', 'data-panel': 'report', hidden: tab !== 'report' },
            h(ErrorBoundary, { key: `${effectiveSessionId}:report`, t },
              h(BattleReportView, { sessionId: effectiveSessionId, liveTeam, live, t, runtimeState }))) : null,
          shown ? h('div', { className: 'ctm-ov-panel', 'data-panel': 'roles', hidden: tab !== 'roles' },
            h(ErrorBoundary, { key: `${effectiveSessionId}:roles`, t },
              team ? h(React.Fragment, null,
                h(RoleCards, { roles: team.roles ?? [], live: liveByRole, t }),
                team.modelNotice ? h('p', { className: 'ctm-sub ctm-ov-help' }, team.modelNotice) : null,
                h('div', { className: 'ctm-ov-block ctm-theme-section' },
                  h('div', { className: 'ctm-label' }, t('theme.title')),
                  h('p', { className: 'ctm-name', style: { marginBottom: '4px' } }, fmt(t('theme.current'), { name: team.name || 'Default' })),
                  h('p', { className: 'ctm-sub' }, t('theme.scopeDesc')),
                  h('div', { className: 'ctm-label', style: { marginTop: '12px' } }, t('theme.howToChange')),
                  h('p', { className: 'ctm-sub' }, t('theme.chatInstruction')),
                  h('div', { className: 'ctm-theme-prompts', style: { display: 'flex', flexDirection: 'column', gap: '6px', margin: '8px 0' } },
                    ...[
                      t('theme.promptWestern'),
                      t('theme.promptOutlaws'),
                      t('theme.promptSciFi'),
                    ].map(promptText => h('div', { key: promptText, style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                      h('code', { className: 'ctm-chip', style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, promptText),
                      h('button', {
                        type: 'button', className: 'ctm-btn', style: { flex: 'none' },
                        onClick: async e => {
                          const btn = e.currentTarget;
                          const prev = btn.textContent;
                          // Only claim success after the browser actually confirms the write; any rejection
                          // (unsupported API, permission denial, insecure context, etc.) falls through to the
                          // manual-copy notice instead of silently lying about the clipboard state.
                          try {
                            if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
                              throw new Error('clipboard API unavailable');
                            }
                            await navigator.clipboard.writeText(promptText);
                            btn.textContent = t('theme.promptCopied');
                          } catch {
                            btn.textContent = t('theme.promptManual');
                          }
                          setTimeout(() => { btn.textContent = prev; }, 1500);
                        }
                      }, t('theme.promptCopy'))))),
                  h('p', { className: 'ctm-sub', style: { marginTop: '8px' } }, t('theme.templateInstruction')),
                  h('p', { className: 'ctm-sub ctm-ov-note' }, t('theme.templateDesc'))),
                h('div', { className: 'ctm-ov-block' }, h('div', { className: 'ctm-label' }, t('overview.policy')), h(WorkflowList, { workflow: team.workflow, t })))
              : h('p', { className: 'ctm-sub' }, t('overview.noData')))) : null));
    }
