    function boardCards(roles, activity, allocations) {
      const members = activity?.members ?? [];
      const tasks = activity?.tasks ?? [];
      const primary = new Map((allocations ?? []).map(a => [a.id, a.primary]));
      const allocById = new Map((allocations ?? []).map(a => [a.id, a]));
      const allocNames = new Map((allocations ?? []).map(a => [a.id, a.displayName]).filter(([_, name]) => Boolean(name)));
      const used = new Set();
      const cards = roles.map(role => {
        const lead = role.id === 'lead' || role.capability === 'orchestrator';
        const member = members.find(m => !used.has(m) && (lead ? (m.role === 'lead' || baseName(m.name) === 'lead') : (m.name === role.id || baseName(m.name) === role.id)));
        if (member) used.add(member);
        const resolvedName = (role.displayName && role.displayName !== role.id)
          ? role.displayName
          : (allocNames.get(role.id) ?? role.displayName ?? role.id);
        return { id: role.id, name: resolvedName, lead, member, role };
      });
      for (const member of members) {
        if (!used.has(member)) {
          const lead = member.role === 'lead';
          const bName = lead ? 'lead' : baseName(member.name);
          const matchedRole = roles.find(r => r.id === bName || (lead && (r.id === 'lead' || r.capability === 'orchestrator')));
          const resolvedName = (matchedRole?.displayName && matchedRole.displayName !== matchedRole.id)
            ? matchedRole.displayName
            : (allocNames.get(bName) ?? matchedRole?.displayName ?? member.name);
          cards.push({ id: matchedRole?.id ?? member.name, name: resolvedName, lead, member, role: matchedRole ?? null });
        }
      }
      return cards.map(card => {
        const owner = card.member?.name ?? card.id;
        const bId = card.id ? baseName(card.id) : '';
        const mine = tasks.filter(task => (task.ownerName === owner || task.ownerName === card.id || (task.ownerName && baseName(task.ownerName) === bId)) && task.status !== 'completed');
        const status = card.member?.status ?? 'inactive';
        const task = mine.find(task => task.status === 'in_progress') ?? mine[0];
        // Item 9: "configured" (role.provider/role.model, or this role's primary allocation) is distinct from
        // "last request" (this plugin's own capabilityTeamUsage route, put on card.member.model by withTrustedRoutes;
        // the host roster's model is never used). They are the
        // same route most of the time, but failover/long-context switches or a stale config can make them differ —
        // that difference must stay visible rather than being collapsed into one badge.
        const configuredModel = primary.get(card.id) ?? (card.role?.provider ? `${card.role.provider}/${card.role.model}` : null);
        const lastRequestModel = card.member?.model ? [card.member.provider, card.member.model].filter(Boolean).join('/') : null;
        const fallbackRoutes = (Array.isArray(card.role?.fallbacks) ? card.role.fallbacks : []).map(routeText).filter(Boolean);
        return { ...card, status,
          model: lastRequestModel ?? configuredModel,
          configuredModel, lastRequestModel,
          // The Lead runs on the user's pick, so its configured route is only a default and is not contrasted.
          modelDiffers: !card.lead && !!(lastRequestModel && configuredModel && lastRequestModel !== configuredModel),
          lastRequestIsFallback: !!(lastRequestModel && fallbackRoutes.includes(lastRequestModel)),
          // Shown model's source: 'request' (trusted route) or 'config' (configured primary, labelled as such).
          modelSource: lastRequestModel ? 'request' : configuredModel ? 'config' : null,
          routeWarn: routeOutsideConfig(lastRequestModel, card.role, allocById.get(card.id)),
          liveModel: !!card.member?.model, task, queued: mine.length,
          // A teammate is "delegated to" while it works or holds an in-progress task from the Lead.
          delegated: !card.lead && (status === 'running' || status === 'provisioning' || task?.status === 'in_progress') };
      });
    }
    /** Static model badge mapping: provider/model -> alias & rarity rank (legendary/epic/rare/cloth/default). */
    function modelBadgeInfo(route, t) {
      if (!route) return null;
      const slash = route.indexOf('/');
      const provider = slash > 0 ? route.slice(0, slash) : '';
      const rawModel = slash > 0 ? route.slice(slash + 1) : route;
      const p = provider.toLowerCase();
      const m = rawModel.toLowerCase();

      // Free / OpenCode channels -> "布衣"
      if (p === 'opencode' || m.includes('free') || p.includes('free') || m.startsWith('free-')) {
        return { alias: rawModel, grade: 'cloth', gradeLabel: t ? t('model.grade.cloth') : '布衣' };
      }
      // claude-opus-* -> 传说金
      if (m.includes('claude-opus') || m.includes('claude-3-opus') || m.includes('opus')) {
        return { alias: rawModel, grade: 'legendary', gradeLabel: t ? t('model.grade.legendary') : '传说金' };
      }
      // gpt-6.1-sol -> 史诗紫
      if (m.includes('gpt-6.1-sol') || m.includes('-sol')) {
        return { alias: rawModel, grade: 'epic', gradeLabel: t ? t('model.grade.epic') : '史诗紫' };
      }
      // gemini-*-flash -> 稀有蓝
      if (m.includes('gemini') && m.includes('flash')) {
        return { alias: rawModel, grade: 'rare', gradeLabel: t ? t('model.grade.rare') : '稀有蓝' };
      }
      // 未知模型回退显示原名，色阶普通
      return { alias: route, grade: 'default', gradeLabel: null };
    }

    /** Status bubble for cards: task subject + status text, or idle static lines. */
    function statusBubble(card, t, live) {
      const isRunning = card.status === 'running';
      const task = card.task;
      const memberId = card.member?.id;
      const act = memberId ? live?.projections?.(memberId)?.capabilityTeamActivity : undefined;

      // 检查 capabilityTeamActivity 投影
      if (act && typeof act === 'object') {
        if (act.schemaVersion !== 1) {
          return h('div', { className: 'ctm-bd-bubble' },
            h('span', { className: 'ctm-sub ctm-warn' }, t('version.unsupported')));
        }
        const phase = act.phase;
        const cur = act.current;
        const activeCount = typeof act.activeCount === 'number' ? act.activeCount : 0;
        const isHistoryUnsettled = !isRunning && cur && cur.status === 'running';
        const recentList = Array.isArray(act.recent) ? act.recent : [];

        let headBadge = null;
        let bodyContent = null;

        if (isHistoryUnsettled) {
          headBadge = h('span', { className: 'ctm-badge', 'data-tone': 'warn' }, t('activity.unsettled'));
          bodyContent = cur ? [cur.summary, cur.target ? ` (${cur.target})` : null].filter(Boolean).join('') : t('activity.unsettled');
        } else if (phase === 'tool') {
          headBadge = h('span', { className: 'ctm-badge', 'data-tone': 'brand' },
            activeCount > 1 ? fmt(t('activity.parallel'), { n: activeCount }) : (cur?.tool ? fmt(t('activity.tool'), { tool: cur.tool }) : t('live.bubbleRunning')));
          const summaryText = cur?.summary ?? '';
          const targetText = cur?.target ? ` ${cur.target}` : '';
          bodyContent = summaryText || targetText ? `${summaryText}${targetText}` : (task?.subject ?? t('live.busyNoTask'));
        } else if (phase === 'model' && activeCount === 0) {
          headBadge = h('span', { className: 'ctm-badge', 'data-tone': 'brand' }, t('activity.processing'));
          bodyContent = task?.subject ?? t('live.busyNoTask');
        } else if (phase === 'idle') {
          const idleText = label(t, `live.${card.status}`, card.status);
          headBadge = h('span', { className: 'ctm-sub' }, idleText);
          const qKey = card.role?.quoteKey ?? characterQuoteKey(card.role?.id ?? card.id);
          const quote = t(qKey);
          bodyContent = cur?.summary ? `${cur.summary} · “${quote}”` : `“${quote}”`;
        }

        if (headBadge && bodyContent) {
          return h('div', { className: 'ctm-bd-bubble' },
            h('div', { className: 'ctm-bd-bubble-head' },
              headBadge,
              task ? h('span', { className: 'ctm-sub' }, `#${task.id}`) : null),
            h('div', { className: 'ctm-bd-bubble-body ctm-bd-subject' }, bodyContent),
            recentList.length ? h('details', { className: 'ctm-act-recent' },
              h('summary', null, fmt(t('activity.recent'), { n: recentList.length })),
              h('div', { className: 'ctm-act-list' },
                h(CollapsibleList, {
                  items: recentList,
                  limit: 5,
                  t,
                  renderItem: (item, idx) => h('div', { key: item.id ?? item.callId ?? idx, className: 'ctm-act-row' },
                    h('span', { title: item.target ?? '' }, `${item.tool ? item.tool + ': ' : ''}${item.summary ?? ''}${item.target ? ' ' + item.target : ''}`),
                    h('span', { className: 'ctm-badge', 'data-tone': item.status === 'succeeded' ? 'success' : item.status === 'failed' ? 'error' : undefined }, item.status)),
                }))) : null);
        }
      }

      if (task) {
        const statusText = isRunning ? t('live.bubbleRunning') : t('live.bubbleWaiting');
        return h('div', { className: 'ctm-bd-bubble', title: task.subject },
          h('div', { className: 'ctm-bd-bubble-head' },
            h('span', { className: 'ctm-badge', 'data-tone': isRunning ? 'brand' : 'warn' }, statusText),
            h('span', { className: 'ctm-sub' }, `#${task.id}`),
            card.queued > 1 ? h('span', { className: 'ctm-sub' }, `+${card.queued - 1}`) : null),
          h('div', { className: 'ctm-bd-bubble-body ctm-bd-subject' }, task.subject));
      }

      if (isRunning) {
        return h('div', { className: 'ctm-bd-bubble' },
          h('div', { className: 'ctm-bd-bubble-head' },
            h('span', { className: 'ctm-badge', 'data-tone': 'brand' }, t('live.bubbleRunning'))),
          h('div', { className: 'ctm-bd-bubble-body ctm-sub' }, t('live.busyNoTask')));
      }

      const qKey = card.role?.quoteKey ?? characterQuoteKey(card.role?.id ?? card.id);
      const quote = t(qKey);
      const idleText = label(t, `live.${card.status}`, card.status);
      return h('div', { className: 'ctm-bd-bubble' },
        h('div', { className: 'ctm-bd-bubble-head' },
          h('span', { className: 'ctm-sub' }, idleText)),
        h('div', { className: 'ctm-bd-bubble-body ctm-bd-quote' }, `“${quote}”`));
    }

    /** Context pressure & token budget meters for one board card. */
    function cardMeters(card, live, usage, t) {
      const memberId = card.member?.id;
      const proj = memberId ? live?.projections?.(memberId) : undefined;

      // 1) Context pressure: projectedTokens / contextWindow (or pressureTokens)
      const cp = proj?.contextPressure;
      const projected = cp?.projectedTokens ?? cp?.pressureTokens;
      const contextWindow = cp?.contextWindow;
      const hasPressure = typeof projected === 'number' && typeof contextWindow === 'number' && contextWindow > 0;

      // 2) Budget meter: reused from usageRows / maxTokens, rendered only when maxTokens exists
      const max = card.role?.maxTokens;
      let budgetNode = null;
      if (max && max > 0) {
        const uRow = usage?.find(u => (memberId && u.id === memberId) || u.name === card.id || (card.lead && u.name === 'lead'));
        const ownUsage = proj?.capabilityTeamUsage;
        // Strict Unknown contract: a budget bar may only render from a row that is itself not Unknown
        // (coverage !== 'unknown' and reportedSamples > 0); a truthy `totals` object alone is not enough.
        const totals = !isUnknownUsage(uRow) ? uRow.totals : (ownUsage && !isUnknownUsage(ownUsage) ? ownUsage.totals : null);
        if (totals) {
          const used = billable(totals);
          const bRatio = Math.min(1, used / max);
          const bTone = used >= max ? 'error' : bRatio >= 0.8 ? 'warn' : undefined;
          budgetNode = h('div', { className: 'ctm-bd-meter-row', key: 'budget' },
            h('div', { className: 'ctm-bd-meter-labels' },
              h('span', null, t('live.budgetTitle')),
              h('span', { className: 'ctm-us-num' }, fmt(t('usage.budget'), { used: compact(used), max: compact(max) }))),
            h('div', { className: 'ctm-us-meter', 'data-tone': bTone, role: 'presentation' },
              h('i', { style: { width: `${(bRatio * 100).toFixed(1)}%` } })));
        }
      }

      let cpNode = null;
      if (hasPressure) {
        const cpRatio = Math.min(1, Math.max(0, projected / contextWindow));
        const cpTone = cpRatio >= 0.9 ? 'error' : cpRatio >= 0.8 ? 'warn' : undefined;
        cpNode = h('div', { className: 'ctm-bd-meter-row', key: 'pressure' },
          h('div', { className: 'ctm-bd-meter-labels' },
            h('span', null, t('live.contextPressure')),
            h('span', { className: 'ctm-us-num' }, `${(cpRatio * 100).toFixed(0)}%`)),
          h('div', { className: 'ctm-us-meter', 'data-tone': cpTone, role: 'presentation' },
            h('i', { style: { width: `${(cpRatio * 100).toFixed(1)}%` } })));
      } else {
        // Missing data shows "未知" without false meters
        cpNode = h('div', { className: 'ctm-bd-meter-row', key: 'pressure-unknown' },
          h('div', { className: 'ctm-bd-meter-labels' },
            h('span', null, t('live.contextPressure')),
            h('span', { className: 'ctm-sub' }, t('live.contextUnknown'))));
      }

      return h('div', { className: 'ctm-bd-meters' }, cpNode, budgetNode);
    }

    /** Compute longest dependency chain in DAG with cycle detection; robust on empty graphs. */
    function computeLongestChain(tasks) {
      if (!Array.isArray(tasks) || !tasks.length) return [];
      const taskMap = new Map();
      for (const tk of tasks) if (tk?.id != null) taskMap.set(String(tk.id), tk);
      if (!taskMap.size) return [];

      const adj = new Map();
      for (const id of taskMap.keys()) adj.set(id, []);
      for (const tk of taskMap.values()) {
        const v = String(tk.id);
        const blockers = Array.isArray(tk.blockedBy)
          ? tk.blockedBy
          : (typeof tk.blockedBy === 'string' || typeof tk.blockedBy === 'number') && tk.blockedBy
            ? [tk.blockedBy]
            : [];
        for (const b of blockers) {
          const u = String(b);
          if (taskMap.has(u)) {
            adj.get(u).push(v);
          }
        }
      }

      function dfs(u, visiting) {
        visiting.add(u);
        let bestChild = [];
        const neighbors = adj.get(u) || [];
        for (const v of neighbors) {
          if (visiting.has(v)) continue; // Skip back-edge to avoid duplicate nodes and cycles
          const path = dfs(v, visiting);
          if (path.length > bestChild.length) {
            bestChild = path;
          }
        }
        visiting.delete(u);
        return [u, ...bestChild];
      }

      let longest = [];
      for (const id of taskMap.keys()) {
        const path = dfs(id, new Set());
        if (path.length > longest.length) {
          longest = path;
        }
      }
      return longest;
    }

    /** Task dependency graph/list with highlighted longest dependency chain. */
    function taskDependencyView(tasks, t) {
      if (!tasks || !tasks.length) return null;

      const longestChain = computeLongestChain(tasks);
      const longestSet = new Set(longestChain);
      const hasDeps = tasks.some(tk => {
        if (Array.isArray(tk?.blockedBy)) return tk.blockedBy.length > 0;
        return (typeof tk?.blockedBy === 'string' || typeof tk?.blockedBy === 'number') && String(tk.blockedBy).trim().length > 0;
      });

      return h('div', { className: 'ctm-bd-deps' },
        h('div', { className: 'ctm-bd-deps-head' },
          h('span', { className: 'ctm-label' }, t('live.taskDeps')),
          longestChain.length >= 2 ? h('div', { className: 'ctm-bd-deps-chain', title: t('live.longestChain') },
            h('strong', null, `${t('live.longestChain')}: `),
            longestChain.map((id, idx) => h(React.Fragment, { key: id },
              idx > 0 ? h('span', { className: 'ctm-sub' }, ' → ') : null,
              h('span', { className: 'ctm-us-num' }, `#${id}`)))) : null),
        !hasDeps ? h('p', { className: 'ctm-sub' }, t('live.noDeps'))
          : h('div', { className: 'ctm-bd-deps-list' }, ...tasks.map(tk => {
              const isLongest = longestSet.has(String(tk.id));
              const blockers = Array.isArray(tk.blockedBy)
                ? tk.blockedBy
                : (typeof tk.blockedBy === 'string' || typeof tk.blockedBy === 'number') && tk.blockedBy
                  ? [tk.blockedBy]
                  : [];
              return h('div', { key: tk.id, className: 'ctm-bd-dep-node', ...(isLongest ? { 'data-longest': '' } : {}) },
                h('div', { className: 'ctm-bd-dep-top' },
                  h('span', { className: 'ctm-us-num' }, `#${tk.id}`),
                  h('span', { className: 'ctm-badge', 'data-tone': tk.status === 'completed' ? 'success' : tk.status === 'in_progress' ? 'brand' : undefined }, tk.status)),
                h('span', { className: 'ctm-bd-dep-subj', title: tk.subject }, tk.subject),
                blockers.length ? h('span', { className: 'ctm-bd-dep-blocked' }, `blockedBy: ${blockers.map(b => '#' + b).join(', ')}`) : null);
            })));
    }

    /** Artifacts rack & Changes view (MVP-B). */
