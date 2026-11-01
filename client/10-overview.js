    function Overview({ sessionId, t: injectedT, hostT, load, save, live, cache, openMember }) {
      const [state, setState] = React.useState({ pending: false });
      const [tab, setTab] = React.useState('models');
      const [showOverview, setShowOverview] = React.useState(false);
      const ticket = React.useRef(0);
      const [, redraw] = React.useState(0);
      const [children, setChildren] = React.useState(null);
      const readStoredLocale = () => {
        try {
          const val = window.localStorage?.getItem('dsh-capability-team-locale');
          if (val === 'zh' || val === 'en') return val;
        } catch {}
        return null;
      };
      const [locale, setLocale] = React.useState(readStoredLocale());
      const hostProbe = (typeof injectedT === 'function' ? injectedT('overview.hint') : '') || (typeof hostT === 'function' ? hostT('overview.hint') : '');
      const hostIsZh = /[\u4e00-\u9fa5]/.test(hostProbe);
      const isZh = (locale ?? (hostIsZh ? 'zh' : 'en')) === 'zh';
      const toggleLocale = () => {
        setLocale(prev => {
          const current = prev ?? (hostIsZh ? 'zh' : 'en');
          const next = current === 'zh' ? 'en' : 'zh';
          try { window.localStorage?.setItem('dsh-capability-team-locale', next); } catch { /* storage unavailable */ }
          return next;
        });
      };
      const dict = isZh ? zh : en;
      const ownTranslator = (key, vals) => {
        const template = dict[key] ?? en[key];
        if (template !== undefined) return vals ? fmt(template, vals) : template;
        if (typeof hostT === 'function') return hostT(key, vals);
        return key;
      };
      const t = locale ? ownTranslator : (injectedT ?? ownTranslator);
      // Root cause of the subagent canvas/roster mismatch (see item 5): a teammate session's own id is not the
      // team's root. Every roster/projection/runtime/open-session call below must use the resolved Lead session
      // id (parentSessionId when this is a subagent, else its own id), never the raw `sessionId` alone.
      const parentSessionId = live?.parentSessionId?.(sessionId);
      const isTeammateSession = !!(parentSessionId && parentSessionId !== sessionId);
      const isOrphanSubagent = !isTeammateSession && !!live?.isOrphanSubagent?.(sessionId);
      const effectiveSessionId = parentSessionId || sessionId;
      const stored = state.sessionId === effectiveSessionId ? state : null;
      const cached = stored?.data ? null : cache?.get(effectiveSessionId);
      // Before the first manual read in this panel, show the last cached snapshot for this session.
      const current = cached ? { ...stored, data: cached.data, at: cached.at, configVersion: cached.configVersion, cached: true } : stored ?? {};
      const d = current.data;
      const isPresetMounted = (() => {
        if (d?.preset !== undefined) return d.preset === 'capability-team';
        if (typeof live?.isCapabilityTeam === 'function') {
          const res = live.isCapabilityTeam(effectiveSessionId);
          if (res !== undefined) return res;
        }
        const proj = live?.projections?.(effectiveSessionId);
        if (proj?.agentPreset !== undefined) return proj.agentPreset === 'capability-team';
        if (proj?.capabilityTeamConfig !== undefined || proj?.capabilityTeamActivity !== undefined || proj?.capabilityTeamUsage !== undefined) return true;
        if (parentSessionId && parentSessionId !== sessionId) {
          const parentProj = live?.projections?.(parentSessionId);
          if (parentProj?.agentPreset !== undefined) return parentProj.agentPreset === 'capability-team';
          if (parentProj?.capabilityTeamConfig !== undefined || parentProj?.capabilityTeamActivity !== undefined || parentProj?.capabilityTeamUsage !== undefined) return true;
        }
        const p = live?.preset?.(effectiveSessionId);
        if (p !== undefined) return p === 'capability-team';
        return undefined;
      })();
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
      const rosterVersion = live?.rosterVersion?.() ?? 0;
      React.useEffect(() => {
        if (!live || isPresetMounted === false) return undefined;
        let stopped = false;
        live.children(effectiveSessionId).then(entries => { if (!stopped) setChildren({ sessionId: effectiveSessionId, entries }); }, () => {});
        return () => { stopped = true; };
      }, [effectiveSessionId, live, rosterVersion, isPresetMounted]);
      // The Lead's agentTeam projection is pushed live; without it the board falls back to the last refresh.
      const liveTeam = live?.projections?.(effectiveSessionId)?.agentTeam;
      const liveActivity = liveTeam ? teamActivityFrom(liveTeam, live) : null;
      const roster = liveRoster(effectiveSessionId, liveActivity ?? d?.activity, children?.sessionId === effectiveSessionId ? children.entries : null, live, liveActivity ? Date.now() : current.at);
      const usage = usageRows(d, liveTeam, live);
      const shown = isPresetMounted !== false && !isOrphanSubagent && !!(d || liveTeam);
      const boardRoles = d?.team?.roles ?? (liveTeam?.members ?? []).map(m => ({ id: m.name, displayName: m.name, ...(m.role === 'lead' ? { capability: 'orchestrator' } : {}) }));
      const configVersion = configVersionNow();
      // At most one automatic read per session and config counter; a failed one waits for a click or the next save.
      const autoKey = React.useRef('');
      React.useEffect(() => {
        if (isPresetMounted === false || current.pending || !liveTeam) return;
        const formed = (liveTeam.members?.length ?? 0) > 1;
        const stale = d ? configVersion !== undefined && current.configVersion !== configVersion : formed;
        const key = `${effectiveSessionId}:${d ? configVersion : 'initial'}`;
        if (!stale || autoKey.current === key) return;
        autoKey.current = key;
        refresh();
      }, [effectiveSessionId, configVersion, !!d, !!liveTeam, liveTeam?.members?.length, current.pending, isPresetMounted]);
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
      const myRole = currentMember ? boardRoles.find(r => r.id === currentMember.name || r.id === baseName(currentMember.name) || (currentMember.role === 'lead' && (r.id === 'lead' || r.capability === 'orchestrator'))) : null;
      const currentMemberDisplayName = myRole?.displayName ?? currentMember?.name;
      const currentMemberModel = myRole?.provider ? `${myRole.provider}/${myRole.model}` : null;
      const currentMemberLive = liveByRole.get(myRole?.id ?? sessionId);
      const currentMemberStatus = currentMemberLive?.status ?? (currentMember ? (live?.running?.(sessionId) ? 'running' : 'idle') : null);

      const subagentNoticeNode = isTeammateSession ? h('div', { className: 'ctm-teammate-bar' },
        h('div', { className: 'ctm-tm-info' },
          h('span', { className: 'ctm-tm-avatar', 'aria-hidden': true }, Array.from(currentMemberDisplayName ?? '?')[0] ?? '?'),
          h('div', { className: 'ctm-tm-meta' },
            h('div', { className: 'ctm-tm-names' },
              h('strong', { style: { fontSize: '13px' } }, currentMemberDisplayName),
              h('span', { className: 'ctm-sub' }, [myRole?.id, myRole?.capability].filter(Boolean).join(' · ')),
              currentMemberStatus ? badge(label(t, `live.${currentMemberStatus}`, currentMemberStatus), LIVE[currentMemberStatus], 'st') : null),
            h('div', { className: 'ctm-tm-sub' },
              currentMemberModel ? h('span', { className: 'ctm-ov-route', title: currentMemberModel }, currentMemberModel) : null,
              h('span', { className: 'ctm-sub', style: { display: 'none' } }, t('subagent.notice')),
              currentMember ? h('span', { className: 'ctm-sub', style: { display: 'none' } }, fmt(t('subagent.currentMember'), { name: currentMemberDisplayName, role: currentMember.role ?? currentMember.id })) : null))),
        h('div', { className: 'ctm-tm-actions' },
          openMember ? h('button', { type: 'button', className: 'ctm-btn', onClick: () => openMember(effectiveSessionId) }, t('subagent.openLead')) : null,
          h('button', { type: 'button', className: 'ctm-btn ctm-ov-roleview-toggle', onClick: () => setShowOverview(v => !v) },
            t(showOverview ? 'roleview.backToRole' : 'roleview.viewOverview'))))
        : isOrphanSubagent ? h('div', { className: 'ctm-ov-callout', 'data-tone': 'warn', style: { marginBottom: '12px' } },
          h('p', { style: { fontWeight: 600 } }, t('subagent.unresolved'))) : null;
      const subRowText = [
        team ? [team.name, fmt(t('overview.revision'), { rev: team.revision })].filter(Boolean).join(' · ') : t('overview.hint'),
        current.at ? fmt(t('overview.updated'), { time: when(current.at) }) : '',
      ].filter(Boolean).join(' · ');
      return h('section', { className: 'ctm-ov' },
        h('header', { className: 'ctm-ov-head' },
          h('div', { className: 'ctm-ov-titlerow' },
            h('h2', { className: 'ctm-ov-title' }, t('overview.title')),
            health && (!isTeammateSession || showOverview) ? badge(health.text, health.tone, 'health') : null,
            liveTeam && (!isTeammateSession || showOverview) ? badge(t('overview.live'), 'success', 'live') : null,
            h('button', {
              type: 'button',
              className: 'ctm-btn ctm-ov-refresh',
              disabled: current.pending,
              onClick: refresh,
              'aria-busy': !!current.pending,
              title: t('overview.logNote'),
            }, t(current.pending ? 'overview.loading' : 'overview.refresh')),
            isTeammateSession ? h('button', { type: 'button', className: 'ctm-btn ctm-ov-roleview-toggle', onClick: () => setShowOverview(v => !v) },
              t(showOverview ? 'roleview.backToRole' : 'roleview.viewOverview')) : null,
            h('button', {
              type: 'button',
              className: 'ctm-btn ctm-lang-toggle',
              title: t('lang.title'),
              onClick: toggleLocale,
            }, t('lang.toggle'))),
          h('p', { className: 'ctm-sub ctm-ov-subrow', title: subRowText }, subRowText)),
        h('div', { className: 'ctm-ov-scroll' },
          subagentNoticeNode,
          current.error ? h('p', { role: 'alert', className: 'ctm-ov-callout', 'data-tone': 'error' }, current.error) : null,
          !shown ? h('div', { className: 'ctm-ov-empty' }, h('p', { className: 'ctm-sub' }, t(isPresetMounted === false ? 'overview.notMounted' : current.pending ? 'overview.loading' : 'overview.empty')),
            (isPresetMounted === false || current.pending) ? null : h('button', { type: 'button', className: 'ctm-btn', 'data-primary': '', onClick: refresh }, t('overview.firstLoad'))) : null,
          (!isTeammateSession || showOverview) && d && team ? h('div', { className: 'ctm-ov-stats' },
            stat(team.roles?.length ?? 0, t('overview.statRoles'), undefined, 'r'),
            stat(working, t('overview.statWorking'), working ? 'brand' : undefined, 'w'),
            stat(policy?.rows?.length ?? 0, t('overview.statModels'), undefined, 'm'),
            stat(disabledCount, t('overview.statDisabled'), disabledCount ? 'warn' : undefined, 'd'),
            stat(blocked, t('overview.statBlocked'), blocked ? 'error' : undefined, 'b')) : null,
          (!isTeammateSession || showOverview) && d ? (d.ready
            ? h('details', { className: 'ctm-ov-group ctm-ov-diag' }, h('summary', null, h('span', { className: 'ctm-name' }, t('overview.details'))), h('div', { className: 'ctm-ov-block' }, ...diagnostics))
            : h('div', { className: 'ctm-ov-callout', 'data-tone': health.tone }, ...diagnostics)) : null,
          ...((!isTeammateSession || showOverview) ? (team?.catalogErrors ?? []).map(error => h('p', { key: error.provider, role: 'alert', className: 'ctm-ov-callout', 'data-tone': 'error' }, `${error.provider}: ${error.error}`)) : []),
          (isTeammateSession && !showOverview) ? h(ErrorBoundary, { key: `${effectiveSessionId}:roleview`, t },
            h(RoleView, { sessionId, role: myRole, liveByRole, usage, d, liveTeam, live, runtimeState, t })) : h(React.Fragment, null,
          shown ? h('nav', { className: 'ctm-ov-tabs', 'aria-label': t('overview.title') },
            ...tabs.map(([id, count]) => h('button', { key: id, type: 'button', className: 'ctm-ov-tab', 'aria-pressed': tab === id, title: t('navfull.' + id) + (count ? ` · ${count}` : ''), onClick: () => setTab(id) },
              t('nav.' + id), count ? h('span', { className: 'ctm-ov-count' }, typeof count === 'number' && count > 99 ? '99+' : String(count)) : null))) : null,
          shown ? h('div', { className: 'ctm-ov-panel', 'data-panel': 'usage', hidden: tab !== 'usage' },
            h(ErrorBoundary, { key: `${effectiveSessionId}:usage`, t }, h(UsageGroups, { rows: usage, roles: team?.roles ?? [], t }))) : null,
          shown ? h('div', { className: 'ctm-ov-panel', 'data-panel': 'logs', hidden: tab !== 'logs' },
            h(ErrorBoundary, { key: `${effectiveSessionId}:logs`, t },
              liveTeam ? h(LiveRequests, { rows: usage, t }) : null,
              d ? h(EvidenceGroups, { d, sessionId: effectiveSessionId, t }) : h('p', { className: 'ctm-sub' }, t('overview.noData')))) : null,
          shown ? h('div', { className: 'ctm-ov-panel', 'data-panel': 'models', hidden: tab !== 'models' },
            h(ErrorBoundary, { key: `${effectiveSessionId}:models`, t },
              h(ModelSubTabs, { t },
                // Root cause fix: this used to pass the raw (possibly teammate) sessionId as the "parent" argument to
                // openMember, so opening a member from inside a subagent session targeted the wrong parent.
                team || liveTeam ? h(TeamBoard, { roles: boardRoles, activity: roster, allocations: policy?.allocations, since, t, open: openMember && (id => openMember(effectiveSessionId, id)), live, usage, runtimeState, currentMemberId: isTeammateSession ? sessionId : null, leadSessionId: effectiveSessionId }) : null,
                policy ? h(PolicyEditor, { key: `${effectiveSessionId}:${policy.revision}`, sessionId: effectiveSessionId, policy, save, t }) : h('p', { className: 'ctm-sub' }, t('overview.noData')),
                h('div', { className: 'ctm-ov-block' },
                  runtimeState.restarted ? h('p', { className: 'ctm-ov-callout', 'data-tone': 'warn' }, t('runtime.restarted')) : null,
                  runtimeState.lag ? h('p', { className: 'ctm-sub ctm-warn' }, t('runtime.snapshotLag')) : null,
                  runtimeState.unavailable ? h('p', { className: 'ctm-sub ctm-warn' }, t('runtime.unavailable')) : null,
                  !runtimeState.restarted && !runtimeState.lag && !runtimeState.unavailable ? h('p', { className: 'ctm-sub' }, t('runtime.noNotices')) : null)))) : null,
          shown ? h('div', { className: 'ctm-ov-panel', 'data-panel': 'artifacts', hidden: tab !== 'artifacts' },
            h(ErrorBoundary, { key: `${effectiveSessionId}:artifacts`, t },
              h(ArtifactsRack, { sessionId: effectiveSessionId, liveTeam, live, t }))) : null,
          shown ? h('div', { className: 'ctm-ov-panel', 'data-panel': 'integrations', hidden: tab !== 'integrations' },
            h(ErrorBoundary, { key: `${effectiveSessionId}:integrations`, t }, tab === 'integrations' ? h(IntegrationsPanel, { t, sessionId: effectiveSessionId || null }) : null)) : null,
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
              : h('p', { className: 'ctm-sub' }, t('overview.noData')))) : null)));
    }
