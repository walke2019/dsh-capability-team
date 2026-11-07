    // Registers the personal config panel for @aiwuk/search in the Plugins page (slot plugins.bundle.config).
    // All text comes from the en/zh dictionaries registered through ctx.locale.
    const plugin = {
      inject: ['slots', 'locale', 'remote', 'remote.credentials', 'configForms'],
      apply(ctx) {
        const panel = aiwukConfig.PANELS.search;
        const kit = aiwukConfig.createPanelKit(require('react'));
        kit.registerConfigPanel(ctx, { panel, ns: 'aiwuk-search', dictionaries: aiwukConfig.panelDictionaries(panel) });
      },
    };
