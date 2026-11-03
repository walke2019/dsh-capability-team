    function ArtifactsRack({ sessionId, liveTeam, live, t }) {
      const [filterRole, setFilterRole] = React.useState('all');
      const [diffState, setDiffState] = React.useState({});
      const [openError, setOpenError] = React.useState(null);

      const AC = typeof AbortController === 'function' ? AbortController : class { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; } };
      const abortRef = React.useRef(null);
      if (!abortRef.current) abortRef.current = new AC();

      React.useEffect(() => {
        return () => {
          if (abortRef.current) {
            abortRef.current.abort();
          }
        };
      }, []);

      const members = liveTeam?.members ?? [];
      const roleMap = new Map();
      for (const m of members) {
        if (m.id) roleMap.set(m.id, m.role ?? m.name ?? m.id);
      }

      // 聚合所有成员的 capabilityTeamArtifacts 投影
      let versionUnsupported = false;
      const allArtifacts = [];
      const changesMap = new Map();

      for (const m of members) {
        if (!m.id) continue;
        const artView = live?.projections?.(m.id)?.capabilityTeamArtifacts;
        if (!artView || typeof artView !== 'object') continue;
        if (artView.schemaVersion !== 1) {
          versionUnsupported = true;
          continue;
        }
        const roleId = roleMap.get(m.id) ?? m.name ?? m.id;
        if (Array.isArray(artView.items)) {
          for (const item of artView.items) {
            allArtifacts.push({ ...item, memberSessionId: m.id, memberName: m.name, roleId });
          }
        }
        if (Array.isArray(artView.changes)) {
          for (const chg of artView.changes) {
            const cKey = `${m.id}:${chg.seq}`;
            if (!changesMap.has(cKey)) {
              changesMap.set(cKey, { ...chg, memberSessionId: m.id, memberName: m.name, roleId });
            }
          }
        }
      }

      if (versionUnsupported && !allArtifacts.length && !changesMap.size) {
        return h('p', { className: 'ctm-sub ctm-warn' }, t('version.unsupported'));
      }

      // 按 (at, sessionId, presentSeq, fileIndex) 降序排序，至多 100 项
      allArtifacts.sort((a, b) => {
        const atDiff = (b.at ?? 0) - (a.at ?? 0);
        if (atDiff !== 0) return atDiff;
        const sDiff = String(b.sessionId ?? '').localeCompare(String(a.sessionId ?? ''));
        if (sDiff !== 0) return sDiff;
        const pDiff = (b.presentSeq ?? 0) - (a.presentSeq ?? 0);
        if (pDiff !== 0) return pDiff;
        return (b.fileIndex ?? 0) - (a.fileIndex ?? 0);
      });
      const shelfItems = allArtifacts.slice(0, 100);

      const roles = Array.from(new Set(shelfItems.map(item => item.roleId))).filter(Boolean);
      const filteredItems = filterRole === 'all' ? shelfItems : shelfItems.filter(item => item.roleId === filterRole);

      // 本会话变更
      const changesList = Array.from(changesMap.values()).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

      const handleOpenPresent = async item => {
        setOpenError(null);
        try {
          const res = await fetch(apiUrl('api/present.open', { sessionId: item.sessionId, seq: item.presentSeq, index: item.fileIndex }), {
            method: 'POST',
            signal: abortRef.current?.signal,
          });
          if (abortRef.current?.signal?.aborted) return;
          if (!res.ok) {
            setOpenError(`${t('artifacts.openFail')} (${res.status})`);
          }
        } catch (e) {
          if (abortRef.current?.signal?.aborted || e?.name === 'AbortError') return;
          setOpenError(String(e.message ?? e));
        }
      };

      const handleToggleChange = async chg => {
        const cKey = `${chg.memberSessionId}:${chg.seq}`;
        if (diffState[cKey]) {
          setDiffState(prev => { const n = { ...prev }; delete n[cKey]; return n; });
          return;
        }
        setDiffState(prev => ({ ...prev, [cKey]: { loading: true } }));
        try {
          const sumRes = await fetch(apiUrl('api/changes.summary', { sessionId: chg.memberSessionId, seq: chg.seq }), {
            signal: abortRef.current?.signal,
          });
          if (abortRef.current?.signal?.aborted) return;
          if (!sumRes.ok) {
            const errText = sumRes.status === 404 ? t('artifacts.baselineInvalid') : `${sumRes.status}`;
            setDiffState(prev => ({ ...prev, [cKey]: { error: errText } }));
            return;
          }
          const sumData = await sumRes.json();
          if (abortRef.current?.signal?.aborted) return;
          const files = sumData.files ?? [];
          const diffResults = [];
          for (let i = 0; i < files.length; i++) {
            if (abortRef.current?.signal?.aborted) return;
            const diffRes = await fetch(apiUrl('api/changes.diff', { sessionId: chg.memberSessionId, seq: chg.seq, index: i }), {
              signal: abortRef.current?.signal,
            });
            if (abortRef.current?.signal?.aborted) return;
            if (!diffRes.ok) {
              diffResults.push({ path: files[i].path, error: diffRes.status === 404 ? t('artifacts.baselineInvalid') : `Error ${diffRes.status}` });
              continue;
            }
            const diffJson = await diffRes.json();
            if (abortRef.current?.signal?.aborted) return;
            const textContent = JSON.stringify(diffJson);
            if (textContent.length > 1024 * 1024) {
              diffResults.push({ path: files[i].path, error: t('artifacts.diffOversized') });
            } else {
              diffResults.push({ path: files[i].path, diff: diffJson });
            }
          }
          if (abortRef.current?.signal?.aborted) return;
          setDiffState(prev => ({ ...prev, [cKey]: { files: diffResults } }));
        } catch (e) {
          if (abortRef.current?.signal?.aborted || e?.name === 'AbortError') return;
          setDiffState(prev => ({ ...prev, [cKey]: { error: String(e.message ?? e) } }));
        }
      };

      return h('div', { className: 'ctm-art-shelf' },
        h('div', { className: 'ctm-art-filter' },
          h('span', { className: 'ctm-label' }, t('artifacts.title')),
          roles.length > 1 ? h('select', {
            className: 'ctm-btn',
            value: filterRole,
            onChange: e => setFilterRole(e.target.value),
          },
            h('option', { value: 'all' }, t('artifacts.allRoles')),
            ...roles.map(r => h('option', { key: r, value: r }, r))) : null),
        openError ? h('p', { className: 'ctm-warn' }, openError) : null,
        !filteredItems.length ? h('p', { className: 'ctm-sub' }, t('artifacts.empty'))
          : h('div', { className: 'ctm-art-list' }, ...filteredItems.map(item =>
              h('div', { key: `${item.sessionId}:${item.presentSeq}:${item.fileIndex}`, className: 'ctm-art-card' },
                h('div', { className: 'ctm-art-head' },
                  h('span', { className: 'ctm-badge', 'data-tone': 'brand' }, item.roleId),
                  h('button', {
                    type: 'button', className: 'ctm-btn',
                    onClick: () => handleOpenPresent(item),
                  }, t('artifacts.openDesktop'))),
                h('span', { className: 'ctm-art-path', title: item.path }, item.displayPath ?? item.path),
                item.at ? h('span', { className: 'ctm-sub' }, when(item.at)) : null))),
        h('div', { className: 'ctm-art-changes' },
          h('span', { className: 'ctm-label' }, t('artifacts.changes')),
          !changesList.length ? h('p', { className: 'ctm-sub' }, t('artifacts.noChanges'))
            : (changesList.length <= 5
                ? changesList.map(chg => {
                    const cKey = `${chg.memberSessionId}:${chg.seq}`;
                    const diffEntry = diffState[cKey];
                    return h('details', { key: cKey, className: 'ctm-chg-item', onToggle: e => { if (e.target.open && !diffEntry) handleToggleChange(chg); } },
                      h('summary', null, `${chg.roleId} · Turn ${chg.turn ?? '?'} · Seq ${chg.seq}`),
                      diffEntry?.loading ? h('p', { className: 'ctm-sub' }, t('overview.loading'))
                        : diffEntry?.error ? h('p', { className: 'ctm-warn' }, diffEntry.error)
                        : diffEntry?.files ? h('div', { className: 'ctm-chg-diff' },
                            ...diffEntry.files.map((f, fi) => h('div', { key: fi },
                              h('strong', null, f.path),
                              f.error ? h('p', { className: 'ctm-warn' }, f.error)
                                : h('pre', { className: 'ctm-pre' }, JSON.stringify(f.diff?.hunks ?? f.diff ?? t('artifacts.diffEmpty'), null, 2)))))
                        : null);
                  })
                : h(CollapsibleList, {
                    items: changesList,
                    limit: 5,
                    t,
                    renderItem: chg => {
                      const cKey = `${chg.memberSessionId}:${chg.seq}`;
                      const diffEntry = diffState[cKey];
                      return h('details', { key: cKey, className: 'ctm-chg-item', onToggle: e => { if (e.target.open && !diffEntry) handleToggleChange(chg); } },
                        h('summary', null, `${chg.roleId} · Turn ${chg.turn ?? '?'} · Seq ${chg.seq}`),
                        diffEntry?.loading ? h('p', { className: 'ctm-sub' }, t('overview.loading'))
                          : diffEntry?.error ? h('p', { className: 'ctm-warn' }, diffEntry.error)
                          : diffEntry?.files ? h('div', { className: 'ctm-chg-diff' },
                              ...diffEntry.files.map((f, fi) => h('div', { key: fi },
                                h('strong', null, f.path),
                                f.error ? h('p', { className: 'ctm-warn' }, f.error)
                                  : h('pre', { className: 'ctm-pre' }, JSON.stringify(f.diff?.hunks ?? f.diff ?? t('artifacts.diffEmpty'), null, 2)))))
                          : null);
                    },
                  }))));
    }

    /** Battle report view (MVP-B). */
    function BattleReportView({ sessionId, liveTeam, live, t, runtimeState, singleModel }) {
      const members = liveTeam?.members ?? [];
      let totalTurns = 0;
      let totalSteps = 0;
      let totalCompletedMs = 0;
      let earliestFirstTurn = null;
      let latestEndTurn = null;

      let uncachedInput = 0;
      let cacheRead = 0;
      let cacheWrite = 0;
      let outputTokens = 0;

      let boardMutationsVal = null;
      let hostRetries = 0;
      let failedTurns = 0;
      let msgAccepted = 0;

      let versionUnsupported = false;
      let hasReport = false;
      // Team-level usage coverage (item 2): any member reporting 'partial' downgrades the whole team to
      // 'partial'; members reporting 'unknown' never contribute tokens to the totals below and are listed
      // separately so the aggregate never silently absorbs an unknown member's usage as zero.
      let teamCoverage = 'complete';
      const unknownMembers = [];

      for (const m of members) {
        if (!m.id) continue;
        const rpt = live?.projections?.(m.id)?.capabilityTeamReport;
        if (!rpt || typeof rpt !== 'object') continue;
        if (rpt.schemaVersion !== 1) {
          versionUnsupported = true;
          continue;
        }
        hasReport = true;
        totalTurns += rpt.turns ?? 0;
        totalSteps += rpt.steps ?? 0;
        totalCompletedMs += rpt.completedTurnMs ?? 0;

        if (typeof rpt.firstTurnAt === 'number') {
          earliestFirstTurn = earliestFirstTurn === null ? rpt.firstTurnAt : Math.min(earliestFirstTurn, rpt.firstTurnAt);
        }
        if (typeof rpt.lastTurnEndAt === 'number') {
          latestEndTurn = latestEndTurn === null ? rpt.lastTurnEndAt : Math.max(latestEndTurn, rpt.lastTurnEndAt);
        }
        if (typeof rpt.openTurnAt === 'number') {
          latestEndTurn = latestEndTurn === null ? rpt.openTurnAt : Math.max(latestEndTurn, rpt.openTurnAt);
        }

        const memberCoverage = rpt.usageCoverage?.coverage;
        if (memberCoverage === 'unknown') {
          unknownMembers.push(m.name ?? m.id);
        } else {
          if (memberCoverage === 'partial') teamCoverage = teamCoverage === 'complete' ? 'partial' : teamCoverage;
          const u = rpt.usage;
          if (u) {
            uncachedInput += u.uncachedInputTokens ?? 0;
            cacheRead += u.cacheReadTokens ?? 0;
            cacheWrite += u.cacheWriteTokens ?? 0;
            outputTokens += u.outputTokens ?? 0;
          }
        }

        const cnt = rpt.counters;
        if (cnt) {
          hostRetries += cnt.hostRetriesStarted ?? 0;
          failedTurns += cnt.failedTurns ?? 0;
          msgAccepted += cnt.sendMessageAccepted ?? 0;
          if (m.role === 'lead' || m.name === 'lead') {
            boardMutationsVal = cnt.boardMutations ?? null;
          }
        }
      }

      if (versionUnsupported && !hasReport) {
        return h('p', { className: 'ctm-sub ctm-warn' }, t('version.unsupported'));
      }

      const billableTokens = uncachedInput + cacheWrite + outputTokens;
      const windowEnd = latestEndTurn ?? Date.now();
      const windowStart = earliestFirstTurn ?? windowEnd;
      const windowSpan = elapsed(Math.max(0, windowEnd - windowStart));

      // 运行时容灾指标汇总
      const runtimeAvailable = runtimeState && !runtimeState.unavailable && runtimeState.data;
      const runtimeMembers = runtimeAvailable && Array.isArray(runtimeState.data.members) ? runtimeState.data.members : [];
      let rRequestFailures = 0;
      let rPluginRetries = 0;
      let rFailoverSwitches = 0;
      let rLongContextSwitches = 0;
      if (runtimeAvailable) {
        for (const rm of runtimeMembers) {
          const rc = rm.counters;
          if (rc) {
            rRequestFailures += rc.requestFailures ?? 0;
            rPluginRetries += rc.pluginRetries ?? 0;
            rFailoverSwitches += rc.failoverSwitches ?? 0;
            rLongContextSwitches += rc.longContextSwitches ?? 0;
          }
        }
      }

      // 汇总展示
      return h('div', { className: 'ctm-rpt-shelf' },
        h('span', { className: 'ctm-label' }, t('report.title'),
          singleModel ? h('span', { className: 'ctm-badge', 'data-tone': 'warn', 'data-single-model': '', title: `${singleModel.provider}/${singleModel.model}` }, t('roles.singleModel')) : null),
        h('p', { className: 'ctm-sub' },
          fmt(t('report.window'), {
            start: earliestFirstTurn ? when(earliestFirstTurn) : t('common.unknown'),
            end: latestEndTurn ? when(latestEndTurn) : when(windowEnd),
            span: windowSpan,
          })),
        h('div', { className: 'ctm-rpt-grid' },
          h('div', { className: 'ctm-rpt-box' },
            h('span', { className: 'ctm-sub' }, t('report.wallTime')),
            h('strong', null, elapsed(totalCompletedMs))),
          h('div', { className: 'ctm-rpt-box' },
            h('span', { className: 'ctm-sub' }, t('report.tokensTotal')),
            h('strong', null, compact(billableTokens)),
            teamCoverage === 'partial' ? badge(t('usage.partialLow'), 'warn', 'team-partial') : null,
            h('span', { className: 'ctm-sub' }, fmt(t('report.tokensIo'), { in: compact(uncachedInput), out: compact(outputTokens), cw: compact(cacheWrite) })),
            unknownMembers.length ? h('p', { className: 'ctm-sub ctm-warn' }, fmt(t('report.unknownMembers'), { list: unknownMembers.join(t('common.listSep')) })) : null),
          h('div', { className: 'ctm-rpt-box' },
            h('span', { className: 'ctm-sub' }, t('report.cacheRead')),
            h('strong', null, compact(cacheRead))),
          h('div', { className: 'ctm-rpt-box' },
            h('span', { className: 'ctm-sub' }, t('report.turnsSteps')),
            h('strong', null, `${totalTurns} / ${totalSteps}`)),
          h('div', { className: 'ctm-rpt-box' },
            h('span', { className: 'ctm-sub' }, t('report.mutations')),
            h('strong', null, boardMutationsVal !== null ? String(boardMutationsVal) : '—'))),
        h('div', { className: 'ctm-rpt-section' },
          h('span', { className: 'ctm-label' }, t('report.sectionOwn')),
          h('div', { className: 'ctm-rpt-grid' },
            h('div', { className: 'ctm-rpt-box' },
              h('span', { className: 'ctm-sub' }, t('report.hostRetries', { n: '' })),
              h('strong', null, String(hostRetries))),
            h('div', { className: 'ctm-rpt-box' },
              h('span', { className: 'ctm-sub' }, t('report.failedTurns', { n: '' })),
              h('strong', null, String(failedTurns))),
            h('div', { className: 'ctm-rpt-box' },
              h('span', { className: 'ctm-sub' }, t('report.msgAccepted', { n: '' })),
              h('strong', null, String(msgAccepted))))),
        h('div', { className: 'ctm-rpt-section' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { className: 'ctm-label' }, t('report.sectionRuntime')),
            runtimeState?.restarted ? h('span', { className: 'ctm-badge', 'data-tone': 'brand' }, t('runtime.restarted')) : null),
          h('div', { className: 'ctm-rpt-grid' },
            h('div', { className: 'ctm-rpt-box' },
              h('span', { className: 'ctm-sub' }, t('report.requestFailures', { n: '' })),
              h('strong', null, runtimeAvailable ? String(rRequestFailures) : t('common.unknown'))),
            h('div', { className: 'ctm-rpt-box' },
              h('span', { className: 'ctm-sub' }, t('report.pluginRetries', { n: '' })),
              h('strong', null, runtimeAvailable ? String(rPluginRetries) : t('common.unknown'))),
            h('div', { className: 'ctm-rpt-box' },
              h('span', { className: 'ctm-sub' }, t('report.failoverSwitches', { n: '' })),
              h('strong', null, runtimeAvailable ? String(rFailoverSwitches) : t('common.unknown'))),
            h('div', { className: 'ctm-rpt-box' },
              h('span', { className: 'ctm-sub' }, t('report.longContextSwitches', { n: '' })),
              h('strong', null, runtimeAvailable ? String(rLongContextSwitches) : t('common.unknown'))))),
        h('details', { className: 'ctm-rpt-defs' },
          h('summary', null, t('report.def.title')),
          h('div', { className: 'ctm-rpt-defs-list' },
            h('p', null, t('report.def.wallTime')),
            h('p', null, t('report.def.cacheRead')),
            h('p', null, t('report.def.mutations')),
            h('p', null, t('report.def.hostRetries')),
            h('p', null, t('report.def.failedTurns')),
            h('p', null, t('report.def.msgAccepted')),
            h('p', null, t('report.def.requestFailures')),
            h('p', null, t('report.def.pluginRetries')),
            h('p', null, t('report.def.failoverSwitches')),
            h('p', null, t('report.def.longContextSwitches')))));
    }
