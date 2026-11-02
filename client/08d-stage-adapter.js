    // ---------- office stage: boardCards + live projections → sprite data, and the React host component ----------
    const STAGE_TOOL_GLYPHS = [['send_message', '📨'], ['team_task', '📋'], ['read', '📖'], ['write', '✍️'], ['edit', '✍️'], ['bash', '⌨️'], ['pwsh', '⌨️'], ['shell', '⌨️'], ['grep', '🔍'], ['glob', '🔍'], ['search', '🔍'], ['fetch', '🌐'], ['web', '🌐']];
    function stageToolGlyph(tool) {
      const name = String(tool ?? '').toLowerCase(); if (!name) return '';
      return STAGE_TOOL_GLYPHS.find(([key]) => name.includes(key))?.[1] ?? '⚙️';
    }
    /**
     * Pure mapping, one entry per board card. Status/task/model come from boardCards (the same source as the cards
     * below the stage); the current tool and context pressure come from the member's own live projections.
     */
    function stageSprites(cards, { live, t = k => k, currentMemberId = null, canOpen = false } = {}) {
      return (cards ?? []).map(card => {
        const memberId = card.member?.id ?? null;
        const proj = memberId && live?.projections ? live.projections(memberId) : undefined;
        const act = proj?.capabilityTeamActivity, cur = act?.schemaVersion === 1 ? act.current : null;
        const working = card.status === 'running' && act?.phase === 'tool' && cur && cur.status === 'running';
        const cp = proj?.contextPressure, projected = cp?.projectedTokens ?? cp?.pressureTokens;
        const ctxRatio = typeof projected === 'number' && typeof cp?.contextWindow === 'number' && cp.contextWindow > 0 ? Math.min(1, Math.max(0, projected / cp.contextWindow)) : null;
        const badge = card.model ? modelBadgeInfo(card.model, t) : null;
        return {
          id: card.id, memberId, name: card.name, capability: card.role?.capability ?? (card.lead ? 'orchestrator' : ''), lead: !!card.lead,
          status: card.status, statusLabel: label(t, `live.${card.status}`, card.status),
          task: card.task ? { id: card.task.id, subject: card.task.subject, status: card.task.status } : null,
          route: card.model ?? null, routeAlias: badge?.alias ?? card.model ?? '', grade: badge?.grade ?? 'default',
          icon: working ? stageToolGlyph(cur.tool) : '',
          bubble: working ? [cur.summary, cur.target ? `(${cur.target})` : ''].filter(Boolean).join(' ') : '',
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
    function OfficeStage({ cards, live, t, open, currentMemberId }) {
      const readCollapsed = () => { try { return window.localStorage?.getItem(STAGE_COLLAPSED_KEY) === '1'; } catch { return false; } };
      const [collapsed, setCollapsed] = React.useState(readCollapsed());
      const host = React.useRef(null), sceneRef = React.useRef(null);
      const sprites = stageSprites(cards, { live, t, currentMemberId, canOpen: !!open });
      const seated = sprites.filter(s => s.status !== 'inactive').length;
      const toggle = () => setCollapsed(prev => { const next = !prev; try { window.localStorage?.setItem(STAGE_COLLAPSED_KEY, next ? '1' : '0'); } catch { /* storage unavailable */ } return next; });
      React.useEffect(() => {
        const el = host.current;
        if (!el || typeof document === 'undefined' || typeof requestAnimationFrame !== 'function') { sceneRef.current?.destroy(); sceneRef.current = null; return; }
        if (!sceneRef.current) { sceneRef.current = new OfficeScene(el, el.querySelector('canvas'), el.querySelector('.ctm-stage-overlay'), { t, onOpen: open ? id => open(id) : null }); }
        sceneRef.current.t = t; sceneRef.current.sync(sprites);
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
    OfficeStage.sprites = stageSprites; OfficeStage.palette = stagePalette; // test hooks for the pure helpers
