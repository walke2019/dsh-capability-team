    // ---------- models panel sub-tabs: team members / model allocation / runtime status ----------
    const MODEL_SUBTABS = ['team', 'models', 'runtime'];
    /**
     * Splits the former single "models" panel into three sub-tabs so each stays scannable on its own. The
     * caller builds the three subtrees with h(...) itself and passes them as ordinary React children (team,
     * then models, then runtime) — exactly like the old flat panel did — so a test walking the raw element
     * tree without invoking this component (as the existing board/editor tests do) still finds the TeamBoard
     * and PolicyEditor nodes exactly where they always lived. This component only toggles which one is visible.
     */
    function ModelSubTabs({ t, children }) {
      const [sub, setSub] = React.useState(MODEL_SUBTABS[0]);
      const [teamNode, modelsNode, runtimeNode] = Array.isArray(children) ? children : [children];
      return h('div', { className: 'ctm-ov-block' },
        h('nav', { className: 'ctm-ov-subtabs', 'aria-label': t('subtabs.team') },
          ...MODEL_SUBTABS.map(id => h('button', { key: id, type: 'button', className: 'ctm-ov-subtab', 'aria-pressed': sub === id, onClick: () => setSub(id) },
            t('subtabs.' + id)))),
        h('div', { hidden: sub !== 'team' }, teamNode),
        h('div', { hidden: sub !== 'models' }, modelsNode),
        h('div', { hidden: sub !== 'runtime' }, runtimeNode));
    }
