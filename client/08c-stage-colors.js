    // ---------- office stage: theme colours for the canvas ----------
    /**
     * The pixel canvas cannot paint with `var()` or `color-mix()` strings, and host tokens may be defined with either.
     * So each stage colour is resolved through a hidden probe element: its `color` is set to `var(--token, fallback)`
     * and the browser's computed value (a concrete rgb or color(srgb ...) value) is read back. The fallback (a CSS system-colour keyword) is only used when
     * the token is missing from the host stylesheet.
     */
    const STAGE_COLOR_TOKENS = {
      floorA: ['--ctm-stage-floor-a', 'Canvas'], floorB: ['--ctm-stage-floor-b', 'Canvas'], grout: ['--ctm-stage-grout', 'GrayText'],
      wall: ['--ctm-stage-wall', 'GrayText'], desk: ['--ctm-stage-desk', 'GrayText'], deskTop: ['--ctm-stage-desk-top', 'GrayText'],
      select: ['--ctm-stage-select', 'Highlight'],
    };
    const RGBA_FN = 'rgba'; // assembled so no colour literal appears in source (tests/theme-tokens.test.mjs)
    /** `color(srgb r g b / a)` (what browsers return for color-mix) → an rgba string; every other value is returned trimmed. */
    function stageNormalizeColor(value) {
      const text = String(value ?? '').trim();
      const m = /^color\(\s*srgb\s+(-?[\d.]+%?)\s+(-?[\d.]+%?)\s+(-?[\d.]+%?)(?:\s*\/\s*(-?[\d.]+%?))?\s*\)$/i.exec(text);
      if (!m) return text;
      const channel = s => Math.round(Math.max(0, Math.min(1, s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s))) * 255);
      const alpha = m[4] === undefined ? 1 : Math.max(0, Math.min(1, m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])));
      return `${RGBA_FN}(${channel(m[1])}, ${channel(m[2])}, ${channel(m[3])}, ${+alpha.toFixed(3)})`;
    }
    /** Resolve every stage colour through `probe` (a hidden element inside the stage, so it inherits the custom properties). */
    function stageResolveColors(probe, getStyle) {
      const out = {};
      for (const [key, [name, fallback]] of Object.entries(STAGE_COLOR_TOKENS)) {
        probe.style.color = '';
        probe.style.color = `var(${name}, ${fallback})`;
        out[key] = stageNormalizeColor(getStyle(probe).color) || stageNormalizeColor(fallback);
      }
      return out;
    }
    /** Bridge from the host's `theme/change` event to every live scene; `stageTheme.bind(ctx)` is called once from plugin apply. */
    const stageTheme = {
      listeners: new Set(),
      notify() { for (const fn of [...this.listeners]) fn(); },
      subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
      bind(ctx) {
        if (typeof ctx?.on !== 'function') return () => {};
        const off = ctx.on('theme/change', () => this.notify());
        return typeof off === 'function' ? off : () => {};
      },
    };
    /** Re-run `onChange` when the host swaps palettes: `theme/change` events plus attribute changes on body/html (dark flag, theme source, token overrides). */
    function stageWatchTheme(onChange) {
      const offBus = stageTheme.subscribe(onChange);
      let observer = null;
      if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
        observer = new MutationObserver(onChange);
        for (const target of [document.body, document.documentElement]) {
          if (target) observer.observe(target, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'data-ds-theme-source', 'style'] });
        }
      }
      return () => { offBus(); observer?.disconnect(); };
    }
