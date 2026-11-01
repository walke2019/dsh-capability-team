    // ---------- 03b-collapsible-list.js: 共享可折叠列表组件 ----------
    /**
     * CollapsibleList:
     * 默认展示前 limit (默认 5) 条；超过时底部提供“更多（剩余 N 条）”/“收起”切换按钮。
     * 当 items <= limit 时不显示切换按钮。
     */
    function CollapsibleList({ items = [], limit = 5, renderItem, as = 'div', className, t, expandText, collapseText }) {
      const [expanded, setExpanded] = React.useState(false);
      const total = items.length;
      if (!total) return null;

      const visibleItems = (expanded || total <= limit) ? items : items.slice(0, limit);
      const remaining = total - limit;

      const moreLabel = expandText
        ? (typeof expandText === 'function' ? expandText(remaining) : expandText)
        : (typeof t === 'function' && t('list.more') ? fmt(t('list.more'), { n: remaining }) : `更多（剩余 ${remaining} 条）`);

      const collapseLabel = collapseText
        ? collapseText
        : (typeof t === 'function' && t('list.collapse') ? t('list.collapse') : '收起');

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
