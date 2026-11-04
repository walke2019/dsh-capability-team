    /**
     * Touch suggestion bar (phones, tablets): a phone has no Tab key and no hover, so suggestions are tappable chips
     * above the composer, like a keyboard's suggestion strip. Tapping a chip fills the draft; it never sends.
     * The ✦ button asks on demand, which also saves mobile data compared with requesting on every pause.
     */
    function TouchSuggestionBar({ sessionId, useInput, useSession, inputActions, config, t }) {
      const draft = useInput ? useInput(s => (s?.draft ? String(s.draft) : '')) ?? '' : '';
      const running = useSession ? useSession(s => s?.running) === true : false;
      const { ghost, setGhost, request, abortRef, composingRef, dismissedRef } = usePredictions(sessionId, draft);
      const label = typeof t === 'function' ? t : key => en[key] ?? key;
      const blocked = !sessionId || running || isTriggerToken(draft);
      const ask = () => {
        if (blocked || composingRef.current) return;
        dismissedRef.current = null;
        void (draft.trim() ? request('continue', draft.slice(-4000)) : request('next', ''));
      };
      // Next-message suggestions arrive by themselves after a reply; continuations wait for an explicit tap.
      React.useEffect(() => {
        if (blocked || draft !== '' || dismissedRef.current?.draft === draft) return undefined;
        const timer = setTimeout(() => { if (!composingRef.current) void request('next', ''); }, 600);
        return () => clearTimeout(timer);
      }, [sessionId, running, draft, request]);
      if (blocked) return null;
      const items = ghost.items.length ? ghost.items : [candidateOf(ghost, draft)].filter(Boolean);
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
      return h('div', { role: 'toolbar', 'aria-label': label('barLabel'), 'data-autocomplete-bar': ghost.mode,
        style: { position: 'absolute', left: 0, right: 0, bottom: '100%', marginBottom: '6px', display: 'flex', gap: '8px', alignItems: 'center',
          overflowX: 'auto', WebkitOverflowScrolling: 'touch', padding: '2px', zIndex: 10 } },
        h('button', { type: 'button', key: 'ask', 'data-action': 'suggest', 'aria-label': label('suggest'), onMouseDown: keep, onClick: ask, disabled: ghost.active,
          style: { ...chip, minWidth: '36px', padding: '6px 10px' } }, ghost.active ? '…' : '✦'),
        ghost.active && !items.length ? h('span', { key: 'busy', style: { fontSize: '13px', opacity: 0.7 } }, label('thinking')) : null,
        ...items.map((item, index) => h('button', { type: 'button', key: `s${index}`, 'data-action': 'accept', disabled: ghost.active,
          'aria-label': fill(label('accept'), { text: item }), onMouseDown: keep, onClick: () => accept(item), style: chip }, item)),
        items.length ? h('button', { type: 'button', key: 'close', 'data-action': 'dismiss', 'aria-label': label('dismiss'), onMouseDown: keep, onClick: close,
          style: { ...chip, minWidth: '36px', padding: '6px 10px' } }, '×') : null);
    }
