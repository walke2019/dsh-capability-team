    // ---------- integrations settings (search gateway, embeddings, speech to text) ----------
    // Every endpoint detail is the user's own setting. Keys are never shown or stored: the form names the
    // environment variable that holds each key and only says whether it is set. Fields an environment
    // variable overrides are read-only here.
    const INTEGRATIONS_PATH = 'api/capability-team.integrations';
    const INTEGRATION_FIELDS = {
      search: [['baseUrl', 'url'], ['apiKeyEnv', 'text'], ['searchPath', 'text'], ['fetchPath', 'text'], ['providersPath', 'text'], ['headers', 'headers'], ['providers', 'list'], ['fetchProviders', 'list'], ['timeoutMs', 'number'], ['fetchTimeoutMs', 'number']],
      embeddings: [['baseUrl', 'url'], ['apiKeyEnv', 'text'], ['path', 'text'], ['model', 'text'], ['provider', 'text'], ['dimensions', 'number'], ['queryTask', 'text'], ['passageTask', 'text'], ['headers', 'headers'], ['timeoutMs', 'number'], ['batch', 'number']],
      audio: [['baseUrl', 'url'], ['apiKeyEnv', 'text'], ['path', 'text'], ['statusPath', 'text'], ['model', 'text'], ['headers', 'headers'], ['timeoutMs', 'number'], ['maxBytes', 'number']],
      memory: [['backend', 'text'], ['url', 'url'], ['apiKeyEnv', 'text'], ['account', 'text'], ['user', 'text'], ['timeoutMs', 'number'], ['recallLimit', 'number']],
    };
    const toInput = (kind, v) => (v === null || v === undefined ? '' : kind === 'list' ? v.join(', ') : kind === 'headers' ? Object.entries(v).map(([k, x]) => `${k}: ${x}`).join('\n') : String(v));
    /** Form text → config value; empty means "clear this layer" (null). Returns undefined for invalid input. */
    function fromInput(kind, text) {
      const s = String(text ?? '').trim();
      if (!s) return null;
      if (kind === 'number') { const n = Number(s); return Number.isFinite(n) ? n : undefined; }
      if (kind === 'list') return s.split(/[,，\s]+/).filter(Boolean);
      if (kind === 'headers') {
        const out = {};
        for (const line of s.split('\n').map(l => l.trim()).filter(Boolean)) { const i = line.indexOf(':'); if (i < 1) return undefined; out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
        return out;
      }
      return s;
    }
    const sourceLabel = (t, src) => (src?.startsWith('env:') ? fmt(t('int.source.env'), { name: src.slice(4) }) : label(t, `int.source.${src}`, src ?? ''));
    function IntegrationsPanel({ t }) {
      const [data, setData] = React.useState(null);
      const [draft, setDraft] = React.useState({});
      const [status, setStatus] = React.useState(null);
      const [reload, setReload] = React.useState(0);
      React.useEffect(() => {
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        fetch(apiUrl(INTEGRATIONS_PATH), { signal: ctrl?.signal })
          .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then(body => { setData(body); setDraft({}); })
          .catch(e => { if (e?.name !== 'AbortError') setStatus({ tone: 'error', text: t('int.loadFailed') }); });
        return () => ctrl?.abort();
      }, [reload]);
      if (!data) return h('div', { className: 'ctm-ov-block' }, h('p', { className: 'ctm-sub' }, status?.text ?? t('int.loading')));
      const valueOf = (section, key, kind) => draft[section]?.[key] ?? toInput(kind, data.file?.[section]?.[key] ?? (data.sources[section][key] === 'file' ? data.effective[section][key] : undefined));
      const set = (section, key, text) => setDraft(prev => ({ ...prev, [section]: { ...prev[section], [key]: text } }));
      const save = async () => {
        const patch = {};
        for (const [section, fields] of Object.entries(draft)) for (const [key, text] of Object.entries(fields)) {
          const kind = INTEGRATION_FIELDS[section].find(([k]) => k === key)[1];
          const value = fromInput(kind, text);
          if (value === undefined) { setStatus({ tone: 'error', text: fmt(t('int.invalid'), { field: `${section}.${key}` }) }); return; }
          (patch[section] ??= {})[key] = value;
        }
        if (!Object.keys(patch).length) return;
        setStatus({ text: t('int.saving') });
        try {
          const res = await fetch(apiUrl(INTEGRATIONS_PATH), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: data.revision, patch }) });
          const body = await res.json().catch(() => ({}));
          if (res.ok) { setStatus({ tone: 'success', text: t('int.saved') }); setReload(n => n + 1); return; }
          if (res.status === 409) { setStatus({ tone: 'error', text: t('int.conflict') }); setReload(n => n + 1); return; }
          setStatus({ tone: 'error', text: `${t('int.saveFailed')} ${String(body.message ?? '')}` });
        } catch { setStatus({ tone: 'error', text: t('int.saveFailed') }); }
      };
      // Each section is its own card with a label/input grid and its own save/reset buttons; saving still
      // submits the whole draft (every section's pending changes) so the revision/409 path above stays single.
      const sectionDirty = name => Object.keys(draft[name] ?? {}).length > 0;
      const section = name => h('fieldset', { key: name, className: 'ctm-int-section' },
        h('legend', { className: 'ctm-label' }, t(`int.${name}`)),
        h('p', { className: 'ctm-sub' }, t(`int.${name}.hint`)),
        h('p', { className: `ctm-sub ${data.keys[name].present ? '' : 'ctm-warn'}` }, fmt(t(data.keys[name].present ? 'int.keySet' : 'int.keyMissing'), { name: data.keys[name].env })),
        h('div', { className: 'ctm-int-grid' },
          ...INTEGRATION_FIELDS[name].map(([key, kind]) => {
            const src = data.sources[name][key];
            const locked = src?.startsWith('env:');
            const id = `ctm-int-${name}-${key}`;
            const props = { id, value: locked ? toInput(kind, data.effective[name][key]) : valueOf(name, key, kind), disabled: locked,
              placeholder: locked ? '' : toInput(kind, data.effective[name][key]) || t('int.unset'), onChange: e => set(name, key, e.target.value) };
            return h(React.Fragment, { key },
              h('label', { htmlFor: id, className: 'ctm-sub ctm-int-key' }, t(`int.field.${key}`)),
              h('div', { className: 'ctm-int-val' },
                kind === 'headers' ? h('textarea', { ...props, rows: 2 }) : h('input', { ...props, type: kind === 'number' ? 'number' : 'text', spellCheck: false }),
                h('span', { className: 'ctm-sub ctm-int-src' }, sourceLabel(t, src))));
          })),
        h('div', { className: 'ctm-tc-row' },
          h('button', { type: 'button', className: 'ctm-btn', 'data-primary': '', disabled: !sectionDirty(name), onClick: save }, t('int.save')),
          h('button', { type: 'button', className: 'ctm-btn', disabled: !sectionDirty(name), onClick: () => setDraft(prev => { const n = { ...prev }; delete n[name]; return n; }) }, t('int.reset'))));
      return h('div', { className: 'ctm-ov-block ctm-int' },
        h('p', { className: 'ctm-sub ctm-ov-help' }, t('int.help')),
        section('search'), section('embeddings'), section('audio'), section('memory'),
        status ? h('p', { className: `ctm-sub ${status.tone === 'error' ? 'ctm-warn' : ''}`, role: status.tone === 'error' ? 'alert' : 'status' }, status.text) : null);
    }
