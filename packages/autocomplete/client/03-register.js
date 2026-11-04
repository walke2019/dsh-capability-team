    const plugin = {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect?.(() => ctx.locale.register(NS, { zh, en }), 'autocomplete: dictionaries');
        const t = ctx.locale.bind(NS);
        let form = null;
        // The ConfigForm is optional: without it the overlay keeps defaults and the host still enforces its config.
        ctx.inject?.(['configForms'], scoped => {
          form = scoped.configForms?.get?.(FORM) ?? null;
          scoped.effect?.(() => () => { form = null; });
        });
        ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
          name: 'conversation.input.overlay', id: 'capability-autocomplete', order: 10, locale: NS,
        }, props => h(ComposerOverlay, { ...props, form, t: props?.t ?? t })));
        const settings = props => h(AutocompleteSettings, { ...props, form, t: props?.t ?? t });
        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item', id: 'capability-autocomplete', order: 55, label: () => t('title'), locale: NS,
        }, settings));
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: PACKAGE, locale: NS }, settings));
      },
    };
    // Test-only seam: harnesses may define window.__acTestHook; browsers never do.
    if (typeof window.__acTestHook === 'function') window.__acTestHook({ ComposerOverlay, GhostOverlay, TouchSuggestionBar, AutocompleteSettings, parseSse, isTriggerToken, configOf, candidateOf, ENDPOINT, zh, en });
