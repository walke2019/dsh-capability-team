    // ---------- office stage: boardCards + live projections → sprite data, and the React host component ----------
    /**
     * Pure mapping, one entry per board card. Status/task/model come from boardCards (the same source as the member
     * detail panel); the fine-grained activity, bubble and context pressure come from the member's own live projections.
     */
    function stageSprites(cards, { live, t = k => k, currentMemberId = null, canOpen = false, since } = {}) {
      return (cards ?? []).map(card => {
        const memberId = card.member?.id ?? null;
        const proj = memberId && live?.projections ? live.projections(memberId) : undefined;
        const act = proj?.capabilityTeamActivity, cur = act?.schemaVersion === 1 ? act.current : null;
        const activity = stageActivityOf(card.status, act);
        const toolAct = !['thinking', 'idle', 'offline', 'failed', 'arriving'].includes(activity);
        const cp = proj?.contextPressure, projected = cp?.projectedTokens ?? cp?.pressureTokens;
        const ctxRatio = typeof projected === 'number' && typeof cp?.contextWindow === 'number' && cp.contextWindow > 0 ? Math.min(1, Math.max(0, projected / cp.contextWindow)) : null;
        const badge = card.model ? modelBadgeInfo(card.model, t) : null;
        const task = card.task ? { id: card.task.id, subject: card.task.subject, status: card.task.status } : null;
        const runSince = card.status === 'running' && memberId ? since?.get?.(memberId) ?? null : null;
        const bubble = stageBubbleBase(activity, { cur, task, since: runSince, t });
        return {
          id: card.id, memberId, name: card.name, capability: card.role?.capability ?? (card.lead ? 'orchestrator' : ''), lead: !!card.lead,
          status: card.status, statusLabel: label(t, `live.${card.status}`, card.status),
          activity, activityLabel: label(t, `stage.act.${activity}`, activity), actKey: toolAct ? (cur?.id ?? cur?.startedAt ?? cur?.tool ?? '') : '',
          task, route: card.model ?? null, routeAlias: badge?.alias ?? card.model ?? '', grade: badge?.grade ?? 'default',
          icon: STAGE_ACT_GLYPH[activity] ?? '',
          bubble: bubble.text, bubbleSince: bubble.since ?? null,
          parallel: card.status === 'running' && typeof act?.activeCount === 'number' ? act.activeCount : 0,
          ctxRatio,
          openable: !!(canOpen && !card.lead && memberId && memberId !== currentMemberId && card.status !== 'provisioning' && card.status !== 'failed'),
        };
      });
    }
    const STAGE_COLLAPSED_KEY = 'dsh-capability-team-stage-collapsed';
    /**
     * React host for the pixel office. It renders the header and an empty host div; OfficeScene owns everything inside
     * the host (canvas + DOM plates) so React never reconciles those nodes. Without a DOM (unit tests, SSR) it renders
     * the header only.
     */
    function OfficeStage({ cards, live, t, open, currentMemberId, since, selected = null, onSelect }) {
      const readCollapsed = () => { try { return window.localStorage?.getItem(STAGE_COLLAPSED_KEY) === '1'; } catch { return false; } };
      const [collapsed, setCollapsed] = React.useState(readCollapsed());
      const host = React.useRef(null), sceneRef = React.useRef(null), selectRef = React.useRef(onSelect);
      selectRef.current = onSelect; // the scene outlives renders, so it always calls the latest callback
      const sprites = stageSprites(cards, { live, t, currentMemberId, canOpen: !!open, since });
      const seated = sprites.filter(s => s.status !== 'inactive').length;
      const toggle = () => setCollapsed(prev => { const next = !prev; try { window.localStorage?.setItem(STAGE_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* storage unavailable */ } return next; });
      React.useEffect(() => {
        const el = host.current;
        if (!el || typeof document === 'undefined' || typeof requestAnimationFrame !== 'function') { sceneRef.current?.destroy(); sceneRef.current = null; return; }
        if (!sceneRef.current) { sceneRef.current = new OfficeScene(el, el.querySelector('canvas'), el.querySelector('.ctm-stage-overlay'), { t, onOpen: open ? id => open(id) : null, onSelect: id => selectRef.current?.(id) }); }
        sceneRef.current.t = t; sceneRef.current.sync(sprites); sceneRef.current.select(selected, false);
      });
      React.useEffect(() => () => { sceneRef.current?.destroy(); sceneRef.current = null; }, []);
      return h('section', { className: 'ctm-stage', 'aria-label': t('stage.title'), ...(collapsed ? { 'data-collapsed': '' } : {}) },
        h('div', { className: 'ctm-stage-head' },
          h('span', { className: 'ctm-label' }, t('stage.title')),
          h('span', { className: 'ctm-sub' }, fmt(t('stage.summary'), { n: seated, m: sprites.length })),
          h('button', { type: 'button', className: 'ctm-btn ctm-stage-toggle', 'aria-expanded': !collapsed, onClick: toggle }, t(collapsed ? 'stage.expand' : 'stage.collapse'))),
        collapsed ? null : h('div', { className: 'ctm-stage-office', ref: host },
          h('canvas', { className: 'ctm-stage-canvas', 'aria-hidden': true }),
          h('div', { className: 'ctm-stage-overlay' }),
          sprites.length ? null : h('p', { className: 'ctm-stage-empty ctm-sub' }, t('stage.empty'))));
    }
    // test hooks for the pure helpers
    Object.assign(OfficeStage, { sprites: stageSprites, palette: stagePalette, activityOf: stageActivityOf, bubbleText: stageBubbleText,
      events: stageEvents, idleGesture: stageIdleGesture, toolGlyph: stageToolGlyph });
