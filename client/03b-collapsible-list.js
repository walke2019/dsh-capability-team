    // ---------- 03b-collapsible-list.js: Shared collapsible list component ----------
    /**
     * CollapsibleList:
     * Show the first limit items (default 5), then offer localized expand/collapse controls.
     * Hide the toggle when items <= limit.
     */
    function CollapsibleList({ items = [], limit = 5, renderItem, as = 'div', className, t, expandText, collapseText }) {
      const [expanded, setExpanded] = React.useState(false);
      const total = items.length;
      if (!total) return null;

      const visibleItems = (expanded || total <= limit) ? items : items.slice(0, limit);
      const remaining = total - limit;

      const moreLabel = expandText
        ? (typeof expandText === 'function' ? expandText(remaining) : expandText)
        : (typeof t === 'function' && t('list.more') ? fmt(t('list.more'), { n: remaining }) : fmt(en['list.more'], { n: remaining }));

      const collapseLabel = collapseText
        ? collapseText
        : (typeof t === 'function' && t('list.collapse') ? t('list.collapse') : en['list.collapse']);

      const renderedChildren = visibleItems.map((item, index) => renderItem(item, index));
      if (total > limit) {
        renderedChildren.push(h('button', {
          key: 'ctm-toggle-btn',
          type: 'button',
          className: 'ctm-btn ctm-list-toggle',
          onClick: () => setExpanded(prev => !prev),
          'aria-expanded': expanded,
        }, expanded ? collapseLabel : moreLabel));
      }
      return h(as, { className }, ...renderedChildren);
    }
