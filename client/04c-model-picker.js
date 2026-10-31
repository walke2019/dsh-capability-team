    // ---------- searchable model picker ----------
    // A combobox over "provider/model" routes: type to filter (every space-separated word must match),
    // arrow keys to move, Enter to pick, Escape to close. Options are grouped by provider.
    const splitKey = key => { const i = key.indexOf('/'); return i > 0 ? [key.slice(0, i), key.slice(i + 1)] : ['', key]; };
    /** Routes whose "provider/model" contains every word of the query (case-insensitive). */
    function filterRoutes(options, query) {
      const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      return words.length ? options.filter(k => words.every(w => k.toLowerCase().includes(w))) : options;
    }
    let pickerSeq = 0;
    function ModelPicker({ value, options, onChange, placeholder, label: aria, disabled, t }) {
      const [open, setOpen] = React.useState(false);
      const [query, setQuery] = React.useState('');
      const [active, setActive] = React.useState(0);
      const idRef = React.useRef(null);
      if (!idRef.current) idRef.current = `ctm-mp-${++pickerSeq}`;
      const id = idRef.current;
      const shown = filterRoutes(options, query);
      const close = () => { setOpen(false); setQuery(''); setActive(0); };
      const pick = key => { if (key) onChange(key); close(); };
      const onKeyDown = event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, shown.length - 1)); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
        else if (event.key === 'Enter') { event.preventDefault(); if (open) pick(shown[active]); else setOpen(true); }
        else if (event.key === 'Escape') { if (open) { event.preventDefault(); close(); } }
        else if (event.key === 'Tab') close();
      };
      const groups = [];
      shown.forEach((key, index) => {
        const [provider] = splitKey(key);
        if (!groups.length || groups[groups.length - 1].provider !== provider) groups.push({ provider, items: [] });
        groups[groups.length - 1].items.push({ key, index });
      });
      return h('div', { className: 'ctm-mp', 'data-open': open ? '' : undefined },
        h('input', { type: 'text', className: 'ctm-mp-input', role: 'combobox', 'aria-label': aria, 'aria-expanded': open, 'aria-controls': `${id}-list`,
          'aria-autocomplete': 'list', 'aria-activedescendant': open && shown[active] ? `${id}-${active}` : undefined, disabled, spellCheck: false,
          value: open ? query : value ?? '', placeholder: open ? (value || placeholder) : placeholder,
          onFocus: () => setOpen(true), onClick: () => setOpen(true), onBlur: close,
          onChange: e => { setQuery(e.target.value); setActive(0); setOpen(true); }, onKeyDown }),
        h('span', { className: 'ctm-mp-caret', 'aria-hidden': true }, '▾'),
        open ? h('div', { className: 'ctm-mp-pop' },
          h('div', { className: 'ctm-mp-count ctm-sub' }, fmt(t('picker.count'), { n: shown.length, total: options.length })),
          shown.length
            ? h('ul', { id: `${id}-list`, role: 'listbox', className: 'ctm-mp-list' }, ...groups.flatMap(g => [
              h('li', { key: `g:${g.provider}`, role: 'presentation', className: 'ctm-mp-group' }, g.provider || t('picker.noProvider')),
              ...g.items.map(({ key, index }) => h('li', { key, id: `${id}-${index}`, role: 'option', 'aria-selected': key === value,
                className: 'ctm-mp-option', 'data-active': index === active ? '' : undefined,
                // mousedown keeps focus in the input, so blur does not close the list before the click lands
                onMouseDown: e => { e.preventDefault(); pick(key); }, onMouseEnter: () => setActive(index) },
                h('span', { className: 'ctm-mp-model' }, splitKey(key)[1]), key === value ? h('span', { className: 'ctm-mp-check', 'aria-hidden': true }, '✓') : null)),
            ]))
            : h('div', { className: 'ctm-mp-empty ctm-sub' }, t('picker.empty'))) : null);
    }
