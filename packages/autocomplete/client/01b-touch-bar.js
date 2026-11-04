    /**
     * One touch store per session, shared by the ✦ button (composer tool row) and the suggestion strip (dock): the two
     * live in different slots, so they meet through this small subscribable store instead of React state.
     */
    const touchStores = new Map();
    function touchStore(sessionId) {
      let store = touchStores.get(sessionId);
      if (!store) {
        const listeners = new Set();
        store = { askSeq: 0, ask() { this.askSeq += 1; for (const l of listeners) l(); }, subscribe(l) { listeners.add(l); return () => listeners.delete(l); } };
        touchStores.set(sessionId, store);
      }
      return store;
    }
    /**
     * Below this width the native tool row has no free space (measured at 320px: even a 28px button wrapped it onto a
     * second line), so the ✦ moves from the tool row to the start of the suggestion strip.
     */
    const NARROW = '(max-width: 359px)';
    function useNarrow() {
      const query = typeof window.matchMedia === 'function' ? window.matchMedia(NARROW) : null;
      const [narrow, setNarrow] = React.useState(() => query?.matches === true);
      React.useEffect(() => {
        if (!query) return undefined;
        const update = () => setNarrow(query.matches === true);
        query.addEventListener?.('change', update);
        return () => query.removeEventListener?.('change', update);
      }, []);
      return narrow;
    }
    /** The card of THIS composer: the nearest ancestor of the strip that contains one (a page may hold several). */
    function composerCardOf(strip) {
      for (let el = strip?.parentElement; el; el = el.parentElement) {
        const card = el.querySelector('[data-composer-card]');
        if (card) return card;
      }
      return null;
    }
    /**
     * Measure the strip's own box against the input box and correct its current margins by the difference. The dock's
     * direct parents use `display: contents` (no box of their own), so a parent rect cannot be the reference.
     */
    function measureCardInset(strip, setInset) {
      const card = composerCardOf(strip);
      if (!card) return;
      const own = strip.getBoundingClientRect(), target = card.getBoundingClientRect();
      if (!target.width || !own.width) return;
      setInset(prev => {
        const next = { left: Math.max(0, Math.round(prev.left + target.left - own.left)), right: Math.max(0, Math.round(prev.right + own.right - target.right)) };
        return prev.left === next.left && prev.right === next.right ? prev : next;
      });
    }
    /**
     * Insets that line the strip up with the input box. The dock spans the whole composer column, which is wider than the
     * input box (measured on a phone: 56px on the left, 16px on the right), so without this the chips start left of it.
     * Re-measured on resize and whenever the input box resizes; no inset when there is no input box to measure.
     */
    function useCardAlignment(stripRef) {
      const [inset, setInset] = React.useState({ left: 0, right: 0 });
      React.useLayoutEffect(() => {
        const strip = stripRef.current;
        if (!strip) return undefined;
        const measure = () => measureCardInset(strip, setInset);
        measure();
        window.addEventListener('resize', measure);
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        const card = composerCardOf(strip);
        if (observer && card) observer.observe(card);
        return () => { window.removeEventListener('resize', measure); observer?.disconnect(); };
      }, [stripRef.current]);
      return inset;
    }
    /** ✦ button in the composer's own tool row (conversation.input.right): no extra height, nothing covered. */
    function TouchAskButton({ sessionId, useSession, form, t }) {
      const config = configOf(useStoreSnapshot(form));
      const touch = useTouch();
      const narrow = useNarrow();
      const { busy } = useComposerBusy(useSession);
      if (!touch || narrow || !config.enabled || !config.mobileBar || !sessionId || busy) return null;
      const label = typeof t === 'function' ? t : key => en[key] ?? key;
      return h('button', { type: 'button', 'data-action': 'suggest', 'aria-label': label('suggest'), title: label('suggest'),
        onMouseDown: event => event.preventDefault(), onClick: () => touchStore(sessionId).ask(),
        // Sized like the native tool-row icons (measured at 320px: a wider button wrapped the row onto two lines).
        style: { width: '28px', height: '28px', padding: 0, flex: '0 0 auto', border: 'none', borderRadius: '14px', background: 'transparent',
          color: 'var(--dsw-alias-label-secondary, inherit)', fontSize: '15px', lineHeight: 1 } }, '✦');
    }
    /**
     * Touch suggestion strip (phones, tablets): a phone has no Tab key, so suggestions are tappable chips. It renders in
     * the dock above the composer, which DSH lays out in normal flow — it pushes content instead of covering the native
     * controls there. It takes no space at all until there is something to show.
     */
    function TouchSuggestionBar({ sessionId, useInput, useSession, inputActions, config, t }) {
      const draft = useInput ? useInput(s => (s?.draft ? String(s.draft) : '')) ?? '' : '';
      const { busy, running } = useComposerBusy(useSession);
      const { ghost, setGhost, request, abortRef, composingRef, dismissedRef } = usePredictions(sessionId, draft);
      const narrow = useNarrow();
      const stripRef = React.useRef(null);
      const align = useCardAlignment(stripRef);
      const label = typeof t === 'function' ? t : key => en[key] ?? key;
      const blocked = !sessionId || busy || isTriggerToken(draft);
      // A dispatch card or a running teammate turn appearing must also cancel a request already in flight.
      React.useEffect(() => { if (busy) { abortRef.current?.abort(); setGhost(NO_GHOST); } }, [busy]);
      const ask = () => {
        if (blocked || composingRef.current) return;
        dismissedRef.current = null;
        void (draft.trim() ? request('continue', draft.slice(-4000)) : request('next', ''));
      };
      const askRef = React.useRef(ask);
      askRef.current = ask;
      React.useEffect(() => (sessionId ? touchStore(sessionId).subscribe(() => askRef.current()) : undefined), [sessionId]);
      // Next-message suggestions arrive by themselves after a reply; continuations wait for an explicit tap.
      React.useEffect(() => {
        if (blocked || draft !== '' || dismissedRef.current?.draft === draft) return undefined;
        const timer = setTimeout(() => { if (!composingRef.current) void request('next', ''); }, 600);
        return () => clearTimeout(timer);
      }, [sessionId, running, draft, request]);
      const items = ghost.items.length ? ghost.items : [candidateOf(ghost, draft)].filter(Boolean);
      // Nothing to show: render nothing, so the dock keeps zero height and the layout is untouched. On narrow screens
      // the strip also carries the ✦ — but only once there is a draft to continue, so an idle composer stays compact.
      const askHere = narrow && draft.trim() !== '';
      if (blocked || (!ghost.active && !items.length && !askHere)) return null;
      const accept = item => {
        const value = ghost.mode === 'continue' && item.startsWith(draft) ? item.slice(draft.length) : item;
        dismissedRef.current = { draft: ghost.mode === 'continue' ? draft + value : value };
        setGhost(NO_GHOST);
        insertSuggestion(inputActions, value);
      };
      const close = () => { dismissedRef.current = { draft }; abortRef.current?.abort(); setGhost(NO_GHOST); };
      // 36px+ targets, horizontal scroll for long chips, and no focus steal so the soft keyboard stays open.
      const keep = event => event.preventDefault();
      const chip = { flex: '0 0 auto', maxWidth: '80vw', minHeight: '36px', padding: '6px 12px', borderRadius: '18px', overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid var(--dsw-alias-border-l2, #555)',
        background: 'var(--dsw-alias-bg-layer-2, transparent)', color: 'var(--dsw-alias-label-primary, inherit)', fontSize: '14px' };
      // In flow (no absolute positioning): one row, scrolls sideways, never wraps into a second line.
      return h('div', { ref: stripRef, role: 'toolbar', 'aria-label': label('barLabel'), 'data-autocomplete-bar': ghost.mode,
        // flexShrink 0: the composer stack is a fixed-height flex column and would otherwise squeeze the chips flat.
        // The dock is wider than the composer card, so the strip is inset to the card's own left and right edges.
        style: { display: 'flex', flexShrink: 0, gap: '8px', alignItems: 'center', overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none', padding: '2px 0 6px', boxSizing: 'border-box', marginLeft: `${align.left}px`, marginRight: `${align.right}px` } },
        askHere ? h('button', { type: 'button', key: 'ask', 'data-action': 'suggest', 'aria-label': label('suggest'), onMouseDown: keep, onClick: ask,
          disabled: ghost.active, style: { ...chip, minWidth: '36px', padding: '6px 10px' } }, ghost.active ? '…' : '✦') : null,
        ghost.active && !items.length ? h('span', { key: 'busy', style: { fontSize: '13px', opacity: 0.7 } }, label('thinking')) : null,
        ...items.map((item, index) => h('button', { type: 'button', key: `s${index}`, 'data-action': 'accept', disabled: ghost.active,
          'aria-label': fill(label('accept'), { text: item }), onMouseDown: keep, onClick: () => accept(item), style: chip }, item)),
        items.length ? h('button', { type: 'button', key: 'close', 'data-action': 'dismiss', 'aria-label': label('dismiss'), onMouseDown: keep, onClick: close,
          style: { ...chip, minWidth: '36px', padding: '6px 10px' } }, '×') : null);
    }
