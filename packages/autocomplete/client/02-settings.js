    /** Settings card bound to this plugin's ConfigForm: the host config is the single source of truth. */
    function AutocompleteSettings({ form, t, view }) {
      const snapshot = useStoreSnapshot(form);
      const [draft, setDraft] = React.useState({});
      const [result, setResult] = React.useState(null);
      if (view === 'summary') return t('summary');
      if (snapshot.status === 'loading') return h('p', null, t('loading'));
      if (snapshot.status !== 'ready') return h('p', { 'data-unavailable': '' }, t('unavailable'));
      const value = { ...configOf(snapshot), ...draft };
      const locked = snapshot.writable === false;
      const save = async (key, next) => {
        setDraft(prev => ({ ...prev, [key]: next }));
        let ok = false;
        try { ok = await form.mutate([{ op: 'set', path: [key], value: next }], snapshot.revision); } catch { ok = false; }
        setResult(ok ? 'saved' : 'failed');
        if (ok) setDraft(prev => { const rest = { ...prev }; delete rest[key]; return rest; });
      };
      const muted = { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #888)' };
      const row = (label, hint, control) => h('label', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '8px 0' } },
        h('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, h('span', null, label), h('span', { style: muted }, hint)), control);
      const number = (key, min, max, step) => h('input', { type: 'number', name: key, min, max, step, disabled: locked, value: value[key],
        style: { width: '96px' }, onChange: event => { const n = Number(event.target.value); if (Number.isInteger(n) && n >= min && n <= max) void save(key, n); } });
      const text = key => h('input', { type: 'text', name: key, disabled: locked, value: value[key] ?? '',
        onChange: event => setDraft(prev => ({ ...prev, [key]: event.target.value })), onBlur: event => void save(key, event.target.value.trim()) });
      return h('div', { 'data-autocomplete-settings': '', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
        h('strong', null, t('title')), h('span', { style: muted }, t('hint')),
        row(t('enabled'), t('enabledHint'), h('input', { type: 'checkbox', name: 'enabled', role: 'switch', disabled: locked, checked: value.enabled === true,
          onChange: event => void save('enabled', event.target.checked) })),
        row(t('route'), t('routeHint'), h('select', { name: 'routeMode', disabled: locked, value: value.routeMode, onChange: event => void save('routeMode', event.target.value) },
          h('option', { value: 'session' }, t('session')), h('option', { value: 'fixed' }, t('fixed')))),
        value.routeMode === 'fixed' ? h('div', { 'data-fixed-route': '' },
          h('span', { style: muted }, t('fixedHint')), row(t('provider'), '', text('provider')), row(t('model'), '', text('model'))) : null,
        row(t('count'), t('countHint'), number('maxSuggestions', 1, 5, 1)),
        row(t('pause'), t('pauseHint'), number('typePauseMs', 200, 5000, 50)),
        row(t('mobileBar'), t('mobileBarHint'), h('input', { type: 'checkbox', name: 'mobileBar', role: 'switch', disabled: locked, checked: value.mobileBar !== false,
          onChange: event => void save('mobileBar', event.target.checked) })),
        result ? h('span', { role: 'status', style: muted }, t(result)) : null);
    }
