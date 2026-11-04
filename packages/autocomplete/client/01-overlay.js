    /** Insert into the shell-owned draft; never submits. Falls back to the editor's own insert on older hosts. */
    function insertSuggestion(inputActions, value) {
      if (inputActions?.insertText && inputActions.captureInsertion && inputActions.insertText(value, inputActions.captureInsertion())) return;
      document.execCommand('insertText', false, value);
    }
    /** Keyboard devices: ghost text inside the composer. Touch devices use the dock strip instead (TouchDock). */
    function ComposerOverlay(props) {
      const config = configOf(useStoreSnapshot(props.form));
      const touch = useTouch();
      if (!config.enabled || (touch && config.mobileBar)) return null;
      return h(GhostOverlay, { ...props, config });
    }
    /** Touch devices: the suggestion strip, rendered in the dock above the composer. */
    function TouchDock(props) {
      const config = configOf(useStoreSnapshot(props.form));
      const touch = useTouch();
      if (!config.enabled || !touch || !config.mobileBar) return null;
      return h(TouchSuggestionBar, { ...props, config });
    }
    function GhostOverlay({ sessionId, useInput, useSession, inputActions, config }) {
      const draft = useInput ? useInput(s => (s?.draft ? String(s.draft) : '')) ?? '' : '';
      // "running" here means any busy state (running turn, docked confirmation, read-only teammate view).
      const { busy: running } = useComposerBusy(useSession);
      const { ghost, setGhost, request, abortRef, composingRef, dismissedRef } = usePredictions(sessionId, draft);
      React.useEffect(() => { if (running) { abortRef.current?.abort(); setGhost(NO_GHOST); } }, [running]);
      const [box, setBox] = React.useState(null);
      const anchorRef = React.useRef(null);
      const currentRef = React.useRef('');
      React.useEffect(() => {
        if (!config.enabled || running || draft !== '' || !sessionId || dismissedRef.current?.draft === draft) return undefined;
        const timer = setTimeout(() => { if (!composingRef.current) void request('next', ''); }, 600);
        return () => clearTimeout(timer);
      }, [sessionId, running, draft, request, config.enabled]);
      React.useEffect(() => {
        if (!config.enabled || !sessionId || draft.trim().length < 3 || isTriggerToken(draft) || dismissedRef.current?.draft === draft) return undefined;
        const timer = setTimeout(() => {
          const found = composerNear(anchorRef.current);
          if (composingRef.current || !found || !caretAtEnd(found.editor, draft)) return;
          void request('continue', draft.slice(-4000));
        }, Math.max(200, config.typePauseMs));
        return () => clearTimeout(timer);
      }, [sessionId, draft, request, config.enabled, config.typePauseMs]);
      const current = candidateOf(ghost, draft);
      currentRef.current = current;
      const visible = Boolean(config.enabled && current && box && (ghost.mode === 'next' ? !draft && !running : draft.trim() && !isTriggerToken(draft)));
      React.useLayoutEffect(() => {
        if (!current) { setBox(null); return undefined; }
        const measure = () => {
          const found = composerNear(anchorRef.current);
          if (!found) { setBox(null); return; }
          const card = found.card.getBoundingClientRect(), editor = found.editor.getBoundingClientRect();
          if (editor.width <= 0) { setBox(null); return; }
          if (ghost.mode === 'next') {
            const style = window.getComputedStyle(found.editor);
            setBox({ top: Math.round(Math.max(0, editor.top - card.top + (parseFloat(style.paddingTop) || 8))),
              left: Math.round(Math.max(0, editor.left - card.left + (parseFloat(style.paddingLeft) || 12))), height: Math.round(parseFloat(style.lineHeight) || 22) });
            return;
          }
          const caret = caretAtEnd(found.editor, draft);
          if (!caret) { setBox(null); return; }
          const left = Math.max(0, caret.left - card.left);
          setBox({ top: Math.round(caret.top - card.top), left: Math.round(left), maxWidth: Math.round(Math.max(48, card.right - card.left - left - 16)), height: Math.round(caret.height || 22) });
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
      }, [ghost.mode, draft, sessionId, current]);
      React.useEffect(() => {
        if (!visible) return undefined;
        const onKeyDown = event => {
          if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
          const found = composerNear(anchorRef.current);
          if (!found || !found.card.contains(document.activeElement)) return;
          if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation();
            dismissedRef.current = { draft }; abortRef.current?.abort(); setGhost(NO_GHOST);
          } else if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && ghost.items.length > 1) {
            event.preventDefault(); event.stopPropagation();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setGhost(prev => ({ ...prev, index: (prev.index + step + prev.items.length) % prev.items.length }));
          } else if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !ghost.active && currentRef.current) {
            event.preventDefault(); event.stopPropagation();
            const value = currentRef.current;
            dismissedRef.current = { draft: ghost.mode === 'continue' ? draft + value : value };
            setGhost(NO_GHOST);
            insertSuggestion(inputActions, value);
          }
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, [visible, draft, ghost.items.length, ghost.active, ghost.mode, inputActions]);
      const anchor = h('span', { key: 'anchor', ref: anchorRef, style: { display: 'none' }, 'aria-hidden': 'true' });
      if (!visible || !box) return anchor;
      const tag = { fontSize: '10px', borderRadius: '3px', padding: '0 4px', border: '1px solid var(--dsw-alias-border-l2, #555)', opacity: 0.75 };
      return h(React.Fragment, null, anchor,
        h('div', { key: 'ghost', 'data-composer-prediction': ghost.mode, style: { position: 'absolute', top: `${box.top}px`, left: `${box.left}px`,
          maxWidth: box.maxWidth ? `${box.maxWidth}px` : undefined, height: `${box.height}px`, display: 'flex', alignItems: 'center', gap: '6px',
          color: 'var(--dsw-alias-label-caption, #888)', pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap', overflow: 'hidden', zIndex: 10 } },
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.85 } }, current),
          ghost.items.length > 1 ? h('span', { style: tag }, `${ghost.index + 1}/${ghost.items.length}`) : null,
          ghost.active ? null : h('kbd', { style: tag }, 'Tab')));
    }
