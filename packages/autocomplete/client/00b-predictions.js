    /**
     * Shared prediction state for both input modes: one in-flight request per composer, streamed deltas, abort on
     * draft change and during IME composition, and a "dismissed" marker so a closed suggestion does not reappear.
     */
    function usePredictions(sessionId, draft) {
      const [ghost, setGhost] = React.useState(NO_GHOST);
      const abortRef = React.useRef(null);
      const composingRef = React.useRef(false);
      const dismissedRef = React.useRef(null);
      const request = React.useCallback(async (mode, text) => {
        if (!sessionId || document.hidden) return;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setGhost({ mode, items: [], index: 0, stream: '', active: true });
        const settle = items => {
          if (controller.signal.aborted) return;
          setGhost(prev => (prev.mode !== mode ? prev : items.length ? { mode, items, index: 0, stream: '', active: false } : NO_GHOST));
        };
        try {
          const response = await fetch(ENDPOINT, { method: 'POST', signal: controller.signal, credentials: 'same-origin',
            headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
            body: JSON.stringify({ sessionId, mode, draft: text }) });
          if (!response.ok || controller.signal.aborted) { settle([]); return; }
          if (!(response.headers.get('content-type') || '').includes('text/event-stream') || !response.body) {
            const done = parseSse(await response.text().catch(() => '')).find(e => e.type === 'done');
            settle(Array.isArray(done?.suggestions) ? done.suggestions : []);
            return;
          }
          await consumeStream(response.body, controller.signal, event => {
            if (controller.signal.aborted) return;
            if (event.type === 'delta' && typeof event.text === 'string') {
              setGhost(prev => (prev.active && prev.mode === mode ? { ...prev, stream: prev.stream + event.text } : prev));
            } else if (event.type === 'done') settle(Array.isArray(event.suggestions) ? event.suggestions : []);
            else if (event.type === 'error') settle([]);
          });
        } catch { if (!controller.signal.aborted) settle([]); }
      }, [sessionId]);
      React.useEffect(() => {
        const start = () => { composingRef.current = true; abortRef.current?.abort(); setGhost(NO_GHOST); };
        const end = () => { composingRef.current = false; };
        document.addEventListener('compositionstart', start, true);
        document.addEventListener('compositionend', end, true);
        return () => { document.removeEventListener('compositionstart', start, true); document.removeEventListener('compositionend', end, true); abortRef.current?.abort(); };
      }, []);
      React.useEffect(() => {
        abortRef.current?.abort();
        setGhost(NO_GHOST);
        if (dismissedRef.current && dismissedRef.current.draft !== draft) dismissedRef.current = null;
      }, [draft]);
      return { ghost, setGhost, request, abortRef, composingRef, dismissedRef };
    }
    /** The candidate shown for a draft: continuation text after the draft, or a whole next message. */
    function candidateOf(ghost, draft) {
      const raw = ghost.items.length ? ghost.items[Math.min(ghost.index, ghost.items.length - 1)] ?? ''
        : ghost.stream.trim().split(/\r?\n/)[0]?.replace(/^[-*0-9.)\s]+/, '') ?? '';
      return ghost.mode === 'continue' && raw.startsWith(draft) ? raw.slice(draft.length) : raw;
    }
