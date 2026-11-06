    const React = require('react');
    const h = React.createElement;
    // Relative to the page (<base href="./">), so it works on loopback, behind the hub tunnel and under any path prefix.
    const ENDPOINT = 'autocomplete/predict';
    const NS = 'capability-autocomplete';
    const PACKAGE = '@aiwuk/autocomplete';
    const FORM = 'autocomplete';
    const DEFAULTS = { enabled: true, routeMode: 'session', provider: '', model: '', maxSuggestions: 3, typePauseMs: 700, mobileBar: true };
    const NO_GHOST = { mode: 'next', items: [], index: 0, stream: '', active: false };
    const en = {
      title: 'Composer autocomplete', hint: 'Inline continuation while you pause and next-message suggestions after replies; Tab on desktop or tap the bar on mobile accepts, nothing is sent automatically.',
      enabled: 'Enable suggestions', enabledHint: 'When off, no prediction is requested or shown.', route: 'Model routing',
      routeHint: 'Follow the session model, or pin a low-latency model.', session: 'Follow session (recommended)', fixed: 'Fixed model',
      provider: 'Provider ID', model: 'Model ID', fixedHint: 'Fixed mode needs an existing provider ID and model ID (not a key).',
      count: 'Candidates', countHint: 'Maximum candidates per prediction; Alt+Up/Down cycles them.', pause: 'Typing pause (ms)',
      pauseHint: 'How long after typing stops before a continuation is requested.', mobileBar: 'Touch suggestion bar',
      mobileBarHint: 'On phones and tablets, show suggestions as tappable buttons above the composer.',
      saved: 'Saved', failed: 'Save failed', loading: 'Loading settings…',
      unavailable: 'Settings unavailable: make sure the plugin is enabled.', summary: 'Inline composer completion and next-message suggestions',
      barLabel: 'Suggestions', suggest: 'Suggest', thinking: 'Thinking…', accept: 'Accept: {text}', dismiss: 'Dismiss suggestions', none: 'No suggestion',
    };
    /** Touch-first devices get the tap bar; a phone has no Tab key. Re-evaluated when the input mode changes. */
    function useTouch() {
      const query = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
      const [touch, setTouch] = React.useState(() => query?.matches === true);
      React.useEffect(() => {
        if (!query) return undefined;
        const update = () => setTouch(query.matches === true);
        query.addEventListener?.('change', update);
        return () => query.removeEventListener?.('change', update);
      }, []);
      return touch;
    }
    const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_m, key) => values[key] ?? '');
    /** Re-render on a `{getSnapshot, subscribe}` store such as a ConfigForm. */
    function useStoreSnapshot(store) {
      const [, redraw] = React.useState(0);
      React.useEffect(() => (typeof store?.subscribe === 'function' ? store.subscribe(() => redraw(n => n + 1)) : undefined), [store]);
      return store?.getSnapshot?.() ?? { status: 'unavailable' };
    }
    const configOf = snapshot => ({ ...DEFAULTS, ...(snapshot?.status === 'ready' ? snapshot.value ?? {} : {}) });
    function parseSse(text) {
      const events = [];
      for (const block of text.split(/\r?\n\r?\n/)) {
        if (!block.trim()) continue;
        let type = 'message', data = '';
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith('event:')) type = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (data) { try { events.push({ ...JSON.parse(data), type }); } catch { /* skip malformed frame */ } }
      }
      return events;
    }
    async function consumeStream(stream, signal, onEvent) {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split(/\r?\n\r?\n/);
          buffer = parts.pop() ?? '';
          for (const part of parts) for (const event of parseSse(part)) onEvent(event);
        }
      } finally { reader.releaseLock(); }
    }
    /** Slash commands and @-references own the composer; suggestions stay out of their way. */
    const isTriggerToken = draft => /(?:^|\s)\/[^\s]*$/u.test(draft) || /(?:^|\s)@"?[^\s]*$/u.test(draft);
    const collapse = text => text.replace(/\s+/gu, ' ').trim();
    function composerNear(anchor) {
      if (!anchor?.isConnected) return null;
      const card = anchor.closest('[data-composer-card]') || anchor.closest('form') || anchor.parentElement;
      const editor = card?.querySelector('[contenteditable="true"]') || card?.querySelector('[role="textbox"]') || card?.querySelector('textarea');
      return editor ? { card, editor } : null;
    }
    function caretRect(range) {
      let rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) rect = range.getClientRects()[0] ?? rect;
      if ((!rect.width && !rect.height) || (!rect.top && !rect.left)) {
        const node = range.startContainer, offset = range.startOffset;
        if (node?.nodeType === Node.TEXT_NODE && offset > 0) {
          const probe = document.createRange();
          probe.setStart(node, offset - 1); probe.setEnd(node, offset);
          const r = probe.getBoundingClientRect();
          if (r.width || r.height) return { left: r.right, top: r.top, height: r.height };
        }
      }
      return !rect.width && !rect.height ? null : { left: rect.left, top: rect.top, height: rect.height };
    }
    /** The caret position, only when it sits at the end of the draft (continuations append, never splice). */
    function caretAtEnd(editor, draft) {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return null;
      const range = selection.getRangeAt(0);
      if (!range.collapsed || !editor.contains(range.startContainer)) return null;
      const prefixRange = document.createRange();
      prefixRange.selectNodeContents(editor);
      prefixRange.setEnd(range.startContainer, range.startOffset);
      const prefix = collapse(prefixRange.toString().trimEnd());
      const rect = caretRect(range);
      return rect && prefix && prefix === collapse(draft.trimEnd()) ? rect : null;
    }
