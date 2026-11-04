    // ---------- confirmation dock above the composer ----------
    // A plan call's own row sits inside the turn's folded steps, so a card there is easy to miss. While the Lead
    // session runs, the dock asks the server for its latest pending confirmation and shows the card right above
    // the input box; the plan row then only points here. Sessions that are not Leads answer 404 and stop polling.
    const DOCK_POLL_MS = 2000; // well inside the server's 8 s grace, so the native question box stays a fallback
    const dockedSessions = new Set(); // sessions whose conversation shows the dock; plan rows render a pointer there
    function ConfirmDock({ sessionId, useSession, t }) {
      const running = typeof useSession === 'function' ? useSession(s => !!s?.running) : true;
      const [pending, setPending] = React.useState(null); // { callId, kind } of the latest pending request
      React.useEffect(() => {
        if (!sessionId) return undefined;
        dockedSessions.add(sessionId);
        return () => { dockedSessions.delete(sessionId); };
      }, [sessionId]);
      React.useEffect(() => {
        if (!sessionId || !running) { setPending(null); return undefined; }
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        let live = true, timer = null;
        const poll = async () => {
          timer = null;
          try {
            const res = await fetch(apiUrl(CONFIRM_PATH, { sessionId }), { signal: ctrl?.signal });
            if (!live) return;
            if (res.status === 404) { setPending(null); return; } // not a capability-team Lead: nothing to confirm here
            const body = res.ok ? await res.json() : null;
            if (!live) return;
            const next = body?.status === 'pending' && body.callId ? { callId: body.callId, kind: body.kind === 'direct' ? 'direct' : 'dispatch' } : null;
            setPending(prev => (prev?.callId === next?.callId && prev?.kind === next?.kind ? prev : next));
          } catch (e) { if (!live || e?.name === 'AbortError') return; }
          if (live) timer = setTimeout(poll, DOCK_POLL_MS);
        };
        poll();
        return () => { live = false; ctrl?.abort(); if (timer) clearTimeout(timer); };
      }, [sessionId, running]);
      if (!pending) return null;
      const Card = pending.kind === 'direct' ? DirectConfirmCard : DispatchConfirmCard;
      return h('div', { className: 'ctm-dock', 'data-kind': pending.kind,
        // A pinned picker popup would drift from its field while the dock scrolls: close it by dropping focus.
        onScroll: e => { const f = typeof document !== 'undefined' ? document.activeElement : null; if (f && e.currentTarget.contains(f) && f.classList?.contains('ctm-mp-input')) f.blur(); } }, h(Card, { key: pending.callId, sessionId, callId: pending.callId, t }));
    }
