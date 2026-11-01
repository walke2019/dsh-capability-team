    function TeamBoard({ roles, activity, allocations, since, t, open, live, usage, runtimeState, currentMemberId, leadSessionId }) {
      const cards = boardCards(roles, activity, allocations);
      const lead = cards.filter(c => c.lead);
      const mates = cards.filter(c => !c.lead);
      const running = cards.filter(c => c.status === 'running').length;
      const canvas = React.useRef(null);
      const links = useBoardLinks(canvas, cards);
      const openable = c => Boolean(open && !c.lead && c.member?.id && (!currentMemberId || c.member.id !== currentMemberId) && c.status !== 'provisioning' && c.status !== 'failed');
      const tasks = activity?.tasks ?? [];
      const taskRevSig = tasks.map(tk => {
        const b = Array.isArray(tk.blockedBy) ? tk.blockedBy.join(',') : (tk.blockedBy ?? '');
        return `${tk.id}:${tk.revision ?? ''}:${tk.status ?? ''}:${tk.subject ?? ''}:${tk.ownerName ?? ''}:${b}`;
      }).join('|');
      const depsView = React.useMemo ? React.useMemo(() => taskDependencyView(tasks, t), [taskRevSig, t]) : taskDependencyView(tasks, t);

      // 本地 1Hz 倒计时时钟（仅当有冷却项时启动，页面隐藏时停止并清除定时器，可见时重新计算启动）
      const [now, setNow] = React.useState(Date.now());
      const hasCooling = Boolean(runtimeState?.data?.members?.some(m => Array.isArray(m.cooling) && m.cooling.some(c => (c.until ?? 0) > now)));
      React.useEffect(() => {
        let timer = null;
        const stop = () => {
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
        };
        const start = () => {
          if (timer) return;
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
          if (!hasCooling) return;
          timer = setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
              stop();
              return;
            }
            setNow(Date.now());
          }, 1000);
        };

        const onVis = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
            setNow(Date.now());
            start();
          } else {
            stop();
          }
        };

        start();
        if (typeof document !== 'undefined' && document.addEventListener) {
          document.addEventListener('visibilitychange', onVis);
        }
        return () => {
          stop();
          if (typeof document !== 'undefined' && document.removeEventListener) {
            document.removeEventListener('visibilitychange', onVis);
          }
        };
      }, [hasCooling]);

      const coolingBadges = memberSessionId => {
        if (!memberSessionId || !runtimeState?.data?.members) return null;
        const m = runtimeState.data.members.find(rm => rm.sessionId === memberSessionId);
        if (!m || !Array.isArray(m.cooling) || !m.cooling.length) return null;
        const seenRoutes = new Set();
        const badges = [];
        for (const c of m.cooling) {
          const rKey = typeof c.route === 'object' && c.route ? `${c.route.provider ?? ''}/${c.route.model ?? ''}` : String(c.route ?? '');
          if (seenRoutes.has(rKey)) continue;
          seenRoutes.add(rKey);
          const remainingSec = Math.max(0, Math.ceil(((c.until ?? 0) - now) / 1000));
          if (remainingSec > 0) {
            badges.push(h('span', { key: rKey, className: 'ctm-badge', 'data-tone': 'cooling', title: `${rKey}: ${c.until}` },
              fmt(t('runtime.cooling'), { s: remainingSec })));
          }
        }
        return badges.length ? h('div', { className: 'ctm-chips' }, ...badges) : null;
      };

      const switchNotices = memberSessionId => {
        if (!memberSessionId || !runtimeState?.data?.members) return null;
        const m = runtimeState.data.members.find(rm => rm.sessionId === memberSessionId);
        if (!m || !Array.isArray(m.switches) || !m.switches.length) return null;
        const seenIds = new Set();
        const uniqueSwitches = [];
        for (const s of m.switches) {
          const sid = s.id ?? `${s.turn}:${s.step}:${s.attempt}`;
          if (seenIds.has(sid)) continue;
          seenIds.add(sid);
          uniqueSwitches.push(s);
        }
        const latest = uniqueSwitches[0];
        if (!latest) return null;
        const rFrom = typeof latest.from === 'object' && latest.from ? `${latest.from.provider ? latest.from.provider + '/' : ''}${latest.from.model ?? ''}` : String(latest.from ?? '');
        const rTo = typeof latest.to === 'object' && latest.to ? `${latest.to.provider ? latest.to.provider + '/' : ''}${latest.to.model ?? ''}` : String(latest.to ?? '');
        const reasonText = label(t, `runtime.reason.${latest.reason}`, latest.reason);
        const detailParts = [latest.code, latest.status].filter(Boolean);
        const detailText = detailParts.length ? ` · ${detailParts.join('/')}` : '';
        const noticeText = t('runtime.switched', { from: rFrom, to: rTo, reason: reasonText, detail: detailText });
        const finalText = noticeText.startsWith('runtime.switched') ? `路由切换 ${rFrom} → ${rTo}（原因：${reasonText}${detailText}）` : noticeText;
        return h('div', { className: 'ctm-bd-switch', title: finalText }, finalText);
      };
      const card = c => {
        // Item 9: when there is a configured model AND the last actually-requested model differs from it, show
        // both badges instead of collapsing to one route. When there is no configured model to contrast against
        // (e.g. no role/allocation data loaded yet), fall back to a single badge for whichever model is known —
        // this keeps the pre-existing single-badge rendering intact for that case.
        const showDual = !!c.configuredModel && c.modelDiffers;
        const singleModel = showDual ? null : (c.configuredModel ?? c.lastRequestModel);
        const singleBadge = singleModel ? modelBadgeInfo(singleModel, t) : null;
        const singleIsLive = singleModel === c.lastRequestModel && c.liveModel;
        const configuredBadge = showDual ? modelBadgeInfo(c.configuredModel, t) : null;
        const lastRequestBadge = showDual ? modelBadgeInfo(c.lastRequestModel, t) : null;
        const lastRequestTag = c.lastRequestIsFallback ? t('live.fallback') : t('live.notInConfig');

        return h('div', { key: c.id, className: 'ctm-bd-card', 'data-status': c.status, 'data-card': c.id, ...(c.delegated ? { 'data-delegated': '' } : {}),
          ...(currentMemberId && c.member?.id === currentMemberId ? { 'data-current': '' } : {}),
          ...(openable(c) ? { role: 'button', tabIndex: 0, title: t('live.open'), 'data-open': '', onClick: () => open(c.member.id),
            onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(c.member.id); } } } : {}) },
          openable(c) ? h('button', {
            type: 'button', className: 'ctm-bd-open-btn', title: t('live.open'), 'aria-label': `${t('live.open')}: ${c.name}`,
            onClick: event => { event.stopPropagation(); open(c.member.id); },
            onKeyDown: event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                open(c.member.id);
              }
            },
          }, t('live.openBtn')) : null,
          h('div', { className: 'ctm-bd-top' },
            h('span', { className: 'ctm-bd-avatar', 'aria-hidden': true }, Array.from(c.name)[0] ?? '?'),
            h('div', { className: 'ctm-who' }, h('span', { className: 'ctm-name' }, c.name), h('span', { className: 'ctm-sub' }, c.role?.capability ?? c.id)),
            h('span', { className: 'ctm-bd-state', 'data-tone': LIVE[c.status] },
              h('i', { className: 'ctm-bd-dot', 'aria-hidden': true }), label(t, `live.${c.status}`, c.status),
              c.status === 'running' && since.get(c.member?.id) ? h('span', { className: 'ctm-bd-time' }, elapsed(Date.now() - since.get(c.member.id))) : null)),
          statusBubble(c, t, live),
          singleBadge ? h('div', { className: 'ctm-bd-model', title: `${singleModel} (${t(singleIsLive ? 'live.liveModel' : 'live.configModel')})` },
            h('span', { className: 'ctm-ov-hop ctm-model-badge', 'data-grade': singleBadge.grade, ...(singleIsLive ? { 'data-primary': '' } : {}) },
              singleBadge.gradeLabel ? h('span', { className: 'ctm-badge-rank' }, singleBadge.gradeLabel) : null,
              h('span', { className: 'ctm-badge-alias' }, singleBadge.alias))) : null,
          configuredBadge ? h('div', { className: 'ctm-bd-model', title: `${c.configuredModel} (${t('live.configModel')})` },
            h('span', { className: 'ctm-ov-hop ctm-model-badge', 'data-grade': configuredBadge.grade },
              configuredBadge.gradeLabel ? h('span', { className: 'ctm-badge-rank' }, configuredBadge.gradeLabel) : null,
              h('span', { className: 'ctm-badge-alias' }, configuredBadge.alias))) : null,
          lastRequestBadge ? h('div', { className: 'ctm-bd-model', 'data-last-request': '', title: `${c.lastRequestModel} (${t('live.liveModel')})` },
            h('span', { className: 'ctm-ov-hop ctm-model-badge', 'data-grade': lastRequestBadge.grade, 'data-primary': '' },
              h('span', { className: 'ctm-badge-rank' }, t('live.lastRequest')),
              h('span', { className: 'ctm-badge-alias' }, lastRequestBadge.alias),
              h('span', { className: 'ctm-sub' }, lastRequestTag))) : null,
          cardMeters(c, live, usage, t),
          coolingBadges(c.member?.id),
          switchNotices(c.member?.id),
          leadSessionId && c.member && !c.lead && runtimeState?.data?.taskControl
            ? h(TaskControl, { leadSessionId, roleId: c.id, name: c.name, configured: c.configuredModel, control: runtimeState.data.taskControl, t }) : null,
          c.member?.diagnostics?.length ? h('div', { className: 'ctm-sub ctm-warn' }, c.member.diagnostics.join(t('common.listSep'))) : null,
          h('div', { className: 'ctm-bd-bar', 'aria-hidden': true }));
      };
      return h('div', { className: 'ctm-bd' },
        h('div', { className: 'ctm-bd-head' },
          h('span', { className: 'ctm-label' }, t('live.title')),
          running ? badge(fmt(t('live.runningCount'), { n: running }), 'brand', 'run') : null,
          activity?.at ? h('span', { className: 'ctm-sub ctm-bd-at' }, h('i', { className: 'ctm-bd-pulse', 'aria-hidden': true }), t('live.polling')) : null),
        activity?.unavailable ? h('p', { className: 'ctm-ov-note ctm-warn' }, activity.unavailable) : null,
        h('div', { className: 'ctm-bd-canvas', ref: canvas },
          h(BoardLinks, { links }),
          lead.length ? h('div', { className: 'ctm-bd-lead' }, ...lead.map(card)) : null,
          mates.length ? h('div', { className: 'ctm-bd-mates' }, ...mates.map(card)) : null),
        depsView);
    }
