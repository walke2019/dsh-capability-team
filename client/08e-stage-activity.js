    // ---------- office stage: pure live-activity derivation (no DOM; unit-tested through OfficeStage.* hooks) ----------
    /** Tool name → activity. First match wins, so `web_search` is browsing and `read_image` is reading. */
    const STAGE_TOOL_ACTS = [
      ['send_message', 'messaging'], ['spawn', 'messaging'], ['team_task', 'board'], ['wait_agent', 'waiting'],
      ['web', 'browsing'], ['fetch', 'browsing'], ['browse', 'browsing'], ['omni', 'browsing'],
      ['read', 'reading'], ['write', 'writing'], ['edit', 'writing'],
      ['bash', 'terminal'], ['pwsh', 'terminal'], ['shell', 'terminal'], ['exec', 'terminal'],
      ['grep', 'searching'], ['glob', 'searching'], ['search', 'searching'],
    ];
    const STAGE_ACT_GLYPH = { thinking: '💭', reading: '📖', writing: '✍️', terminal: '⌨️', searching: '🔍', browsing: '🌐',
      messaging: '📨', board: '📋', waiting: '⏳', failed: '❗', working: '⚙️', arriving: '🚪', idle: '', offline: '' };
    /** Activities that keep the render loop at full rate (anything animated beyond the idle gestures). */
    const STAGE_BUSY_ACTS = new Set(['thinking', 'reading', 'writing', 'terminal', 'searching', 'browsing', 'messaging', 'board', 'waiting', 'working', 'arriving']);
    function stageToolAct(tool) {
      const name = String(tool ?? '').toLowerCase(); if (!name) return 'working';
      return STAGE_TOOL_ACTS.find(([key]) => name.includes(key))?.[1] ?? 'working';
    }
    function stageToolGlyph(tool) { return tool ? STAGE_ACT_GLYPH[stageToolAct(tool)] : ''; }
    /**
     * One fine-grained activity per member from the pushed status + capabilityTeamActivity projection:
     * offline (no session) / arriving (provisioning) / failed / tool category while a call runs / thinking while the
     * model generates (phase model, settled-but-still-running, or no projection yet) / idle.
     */
    function stageActivityOf(status, act) {
      if (status === 'inactive') return 'offline';
      if (status === 'failed') return 'failed';
      if (status === 'provisioning') return 'arriving';
      if (status !== 'running') return 'idle';
      const cur = act?.schemaVersion === 1 ? act.current : null;
      if (act?.schemaVersion === 1 && act.phase === 'tool' && cur?.status === 'running') return stageToolAct(cur.tool);
      return 'thinking';
    }
    const stageClock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    /** Bubble = base text + elapsed (recomputed by the scene once a second) + parallel count. */
    function stageBubbleText(d, now, t = k => k) {
      if (!d?.bubble) return '';
      const parts = [d.bubble];
      if (typeof d.bubbleSince === 'number' && now >= d.bubbleSince) parts.push(`· ${stageClock(now - d.bubbleSince)}`);
      if (d.parallel > 1) parts.push(fmt(t('stage.parallel'), { n: d.parallel }));
      return parts.join(' ');
    }
    /** Base bubble text and the start time it counts from, per activity. Idle/offline members stay quiet. */
    function stageBubbleBase(activity, { cur, task, since, t }) {
      const taskText = task ? `#${task.id} ${task.subject ?? ''}`.trim() : '';
      if (activity === 'thinking') return { text: [t('stage.act.thinkingBubble'), taskText].filter(Boolean).join(' '), since };
      if (activity === 'failed') return { text: t('stage.act.failedBubble'), since: null };
      if (activity === 'arriving') return { text: t('stage.act.arriving'), since: null };
      if (activity === 'idle' || activity === 'offline') return { text: '', since: null };
      const tool = [cur?.summary || label(t, `stage.act.${activity}`, cur?.tool ?? ''), cur?.target ? `(${cur.target})` : ''].filter(Boolean).join(' ');
      return { text: tool || t(`stage.act.${activity}`), since: typeof cur?.startedAt === 'number' ? cur.startedAt : since };
    }
    /**
     * Deterministic idle gesture: every 4 s window each member has a hash-picked chance to stretch or sip coffee,
     * so idle desks are alive without randomness (and tests can pin the result).
     */
    function stageIdleGesture(id, nowMs) {
      const slot = Math.floor(nowMs / 4000), n = stageHash(`${id}:${slot}`) % 7;
      return n === 0 ? 'stretch' : n === 1 ? 'coffee' : null;
    }
    /**
     * Diff two sprite lists into one-shot effects. Mail flies Lead → teammate when a task turns in_progress for that
     * teammate or the teammate wakes up while the Lead is messaging; teammate → Lead when the teammate starts a
     * send_message call. Losing an in-progress task (done/removed) celebrates; a changed route flashes the badge.
     */
    function stageEvents(prev, next) {
      const before = new Map((prev ?? []).map(d => [d.id, d])), out = [];
      const lead = (next ?? []).find(d => d.lead), leadWas = lead ? before.get(lead.id) : null;
      const leadMessaging = lead && (lead.activity === 'messaging' || leadWas?.activity === 'messaging');
      for (const d of next ?? []) {
        const was = before.get(d.id); if (!was) continue;
        if (was.route !== d.route && d.route) out.push({ type: 'flash', id: d.id });
        if (d.ctxRatio >= .9 && !(was.ctxRatio >= .9)) out.push({ type: 'sweat', id: d.id });
        if (d.lead || !lead) continue;
        const newTask = d.task?.status === 'in_progress' && (was.task?.id !== d.task.id || was.task?.status !== 'in_progress');
        const woke = leadMessaging && d.status === 'running' && was.status !== 'running';
        if (newTask || woke) out.push({ type: 'mail', from: lead.id, to: d.id });
        if (d.activity === 'messaging' && (was.activity !== 'messaging' || was.actKey !== d.actKey)) out.push({ type: 'mail', from: d.id, to: lead.id });
        if (was.task?.status === 'in_progress' && d.task?.id !== was.task.id) out.push({ type: 'celebrate', id: d.id });
      }
      if (lead && leadWas && lead.activity === 'messaging' && (leadWas.activity !== 'messaging' || leadWas.actKey !== lead.actKey)
        && !out.some(e => e.type === 'mail' && e.from === lead.id)) out.push({ type: 'mail', from: lead.id, to: null });
      return out;
    }
