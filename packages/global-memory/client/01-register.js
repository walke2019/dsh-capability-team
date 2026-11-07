    // Registers the personal config panel for @aiwuk/memory in the Plugins page (slot plugins.bundle.config).
    // All text comes from the en/zh dictionaries registered through ctx.locale.
    const plugin = {
      inject: ['slots', 'locale', 'remote', 'remote.credentials', 'configForms'],
      apply(ctx) {
        const panel = aiwukConfig.PANELS.memory;
        const kit = aiwukConfig.createPanelKit(require('react'));
        kit.registerConfigPanel(ctx, { panel, ns: 'aiwuk-memory', dictionaries: aiwukConfig.panelDictionaries(panel) });
      },
    };
