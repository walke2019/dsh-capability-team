    const plugin = {
      inject: ['slots', 'locale', 'remote', 'remote.credentials', 'configForms'],
      apply(ctx) {
        ctx.effect?.(() => ctx.locale.register(NS, { zh, en }), 'autocomplete: dictionaries');
        const t = ctx.locale.bind(NS);
        // `configForms` is a static inject; the null check keeps a missing form from breaking the overlay (defaults apply).
        const form = ctx.configForms?.get?.(FORM) ?? null;
        ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
          name: 'conversation.input.overlay', id: 'capability-autocomplete', order: 10, locale: NS,
        }, props => h(ComposerOverlay, { ...props, form, t: props?.t ?? t })));
        // Touch: the strip lives in the dock (laid out in flow above the composer, so it never covers native controls)
        // and the ✦ button lives in the composer's own tool row (no extra height).
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock', id: 'capability-autocomplete-touch', order: 90, locale: NS,
        }, props => h(TouchDock, { ...props, form, t: props?.t ?? t })));
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right', id: 'capability-autocomplete-ask', order: 90, locale: NS,
        }, props => h(TouchAskButton, { ...props, form, t: props?.t ?? t })));
        const settings = props => h(AutocompleteSettings, { ...props, form, t: props?.t ?? t });
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item', id: 'capability-autocomplete', order: 55, label: () => t('title'), locale: NS,
        }, settings));
        // The bundle's Plugins page gets the shared data-driven panel (managed-lock aware); the card above stays in Settings.
        const panel = aiwukConfig.PANELS.autocomplete;
        aiwukConfig.createPanelKit(React).registerConfigPanel(ctx, { panel, ns: 'aiwuk-autocomplete', dictionaries: aiwukConfig.panelDictionaries(panel) });
      },
    };
    // Test-only seam: harnesses may define window.__acTestHook; browsers never do.
    if (typeof window.__acTestHook === 'function') window.__acTestHook({ ComposerOverlay, GhostOverlay, TouchSuggestionBar, TouchDock, TouchAskButton, touchStore, measureCardInset, AutocompleteSettings, parseSse, isTriggerToken, configOf, candidateOf, ENDPOINT, zh, en });
