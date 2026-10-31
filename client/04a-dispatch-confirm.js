    // ---------- dispatch confirmation card ----------
    // Shown under a running capability_dispatch_plan call: the user checks each role's model and up to three
    // fallbacks, edits them, and confirms or cancels. Answers go to api/capability-team.dispatch-confirm;
    // the tool keeps waiting until then, so nobody is dispatched before the user decides.
    const CONFIRM_PATH = 'api/capability-team.dispatch-confirm';
    const rkey = r => (r ? `${r.provider}/${r.model}` : '');
    function DispatchConfirmCard({ sessionId, callId, t }) {
      const [view, setView] = React.useState(null); // null loading · {status:'none'} · pending view
      const [edits, setEdits] = React.useState({}); // role → { primary, fallbacks }
      const [scope, setScope] = React.useState('task');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [sent, setSent] = React.useState(null);
      const [reload, setReload] = React.useState(0);
      React.useEffect(() => {
        if (!sessionId || !callId) return undefined;
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        let tries = 0, timer = null, live = true;
        const load = async () => {
          try {
            const res = await fetch(apiUrl(CONFIRM_PATH, { sessionId, callId }), { signal: ctrl?.signal });
            const body = res.ok ? await res.json() : null;
            if (!live) return;
            // The tool registers its request right after it starts; retry briefly before giving up.
            if (body?.status === 'pending') { setView(body); return; }
            if (++tries < 6) { timer = setTimeout(load, 500); return; }
            setView({ status: 'none' });
          } catch (e) { if (live && e?.name !== 'AbortError') setView({ status: 'none' }); }
        };
        load();
        return () => { live = false; ctrl?.abort(); if (timer) clearTimeout(timer); };
      }, [sessionId, callId, reload]);
      if (sent) return h('div', { className: 'ctm-dc', 'data-state': 'sent' }, h('span', { className: 'ctm-sub' }, t(sent === 'cancel' ? 'confirm.cancelled' : 'confirm.sent')));
      if (!view) return h('div', { className: 'ctm-dc' }, h('span', { className: 'ctm-sub' }, t('confirm.loading')));
      if (view.status !== 'pending') return null; // Not asked (on-change / never) or answered in the question box.
      const max = view.maxFallbacks ?? 3;
      const current = r => edits[r.role] ?? { primary: rkey(r.primary), fallbacks: r.fallbacks.map(rkey) };
      const update = (r, change) => setEdits(prev => ({ ...prev, [r.role]: { ...current(r), ...change } }));
      const move = (list, i, d) => { const next = [...list]; const j = i + d; if (j < 0 || j >= next.length) return list; [next[i], next[j]] = [next[j], next[i]]; return next; };
      const submit = async decision => {
        setBusy(true); setError(null);
        try {
          const routes = view.routes.map(r => ({ role: r.role, ...current(r) }));
          const res = await fetch(apiUrl(CONFIRM_PATH), { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, callId, decision, scope, catalogVersion: view.catalogVersion, routes }) });
          if (res.ok) { setSent(decision); return; }
          const body = await res.json().catch(() => ({}));
          if (res.status === 409) { setError(t('confirm.error.conflict')); setEdits({}); setView(null); setReload(n => n + 1); return; }
          setError(res.status === 422 ? `${t('confirm.error.invalid')} ${String(body.message ?? '')}` : t('confirm.error.other'));
        } catch { setError(t('confirm.error.other')); }
        finally { setBusy(false); }
      };
      const changedCaps = view.routes.filter(r => { const c = current(r); return c.primary !== rkey(r.primary) || c.fallbacks.join() !== r.fallbacks.map(rkey).join(); }).map(r => r.capability);
      const row = r => {
        const c = current(r);
        const options = r.candidates.map(rkey);
        const spare = options.filter(k => k !== c.primary && !c.fallbacks.includes(k));
        return h('div', { key: r.role, className: 'ctm-dc-role' },
          h('div', { className: 'ctm-who' }, h('span', { className: 'ctm-name' }, r.displayName ?? r.role),
            h('span', { className: 'ctm-sub' }, [r.role, r.capability, label(t, `tier.${r.tier}`, r.tier)].join(' · '))),
          r.task ? h('div', { className: 'ctm-sub ctm-dc-task', title: r.task }, firstLine(r.task)) : null,
          h('label', { className: 'ctm-dc-field' }, h('span', { className: 'ctm-label' }, t('confirm.primary')),
            h('select', { value: c.primary, disabled: busy, 'aria-label': `${r.displayName ?? r.role} ${t('confirm.primary')}`,
              onChange: e => update(r, { primary: e.target.value, fallbacks: c.fallbacks.filter(f => f !== e.target.value) }) },
              ...[...new Set([c.primary, ...options])].filter(Boolean).map(k => h('option', { key: k, value: k }, k)))),
          h('div', { className: 'ctm-dc-field' }, h('span', { className: 'ctm-label' }, `${t('confirm.fallbacks')} (${c.fallbacks.length}/${max})`),
            c.fallbacks.length ? h('ol', { className: 'ctm-dc-fallbacks' }, ...c.fallbacks.map((f, i) => h('li', { key: f },
              h('span', { className: 'ctm-chip' }, f),
              h('button', { type: 'button', className: 'ctm-dc-mini', disabled: busy || i === 0, 'aria-label': `${t('confirm.up')} ${f}`, onClick: () => update(r, { fallbacks: move(c.fallbacks, i, -1) }) }, '↑'),
              h('button', { type: 'button', className: 'ctm-dc-mini', disabled: busy || i === c.fallbacks.length - 1, 'aria-label': `${t('confirm.down')} ${f}`, onClick: () => update(r, { fallbacks: move(c.fallbacks, i, 1) }) }, '↓'),
              h('button', { type: 'button', className: 'ctm-dc-mini', disabled: busy, 'aria-label': `${t('confirm.remove')} ${f}`, onClick: () => update(r, { fallbacks: c.fallbacks.filter(x => x !== f) }) }, '×'))))
              : h('span', { className: 'ctm-sub' }, t('confirm.noFallbacks')),
            c.fallbacks.length < max && spare.length ? h('select', { value: '', disabled: busy, 'aria-label': t('confirm.addFallback'),
              onChange: e => e.target.value && update(r, { fallbacks: [...c.fallbacks, e.target.value] }) },
              h('option', { value: '' }, t('confirm.addFallback')), ...spare.map(k => h('option', { key: k, value: k }, k)))
              : c.fallbacks.length >= max ? h('span', { className: 'ctm-sub' }, fmt(t('confirm.max'), { n: max })) : null));
      };
      return h('div', { className: 'ctm-dc', role: 'group', 'aria-label': t('confirm.title') },
        h('div', { className: 'ctm-dc-head' }, h('strong', null, t('confirm.title')), h('span', { className: 'ctm-sub' }, t('confirm.hint'))),
        ...view.routes.map(row),
        h('fieldset', { className: 'ctm-dc-scope' },
          h('legend', { className: 'ctm-label' }, t('confirm.scope')),
          ...['task', 'project'].map(s => h('label', { key: s }, h('input', { type: 'radio', name: `ctm-dc-scope-${callId}`, value: s, checked: scope === s, disabled: busy, onChange: () => setScope(s) }), t(`confirm.scope.${s}`))),
          scope === 'project' && changedCaps.length ? h('span', { className: 'ctm-sub ctm-warn' }, fmt(t('confirm.scope.projectHint'), { list: [...new Set(changedCaps)].join(t('common.listSep')) })) : null),
        error ? h('p', { className: 'ctm-sub ctm-warn', role: 'alert' }, error) : null,
        h('div', { className: 'ctm-tc-row' },
          h('button', { type: 'button', className: 'ctm-btn', 'data-primary': '', disabled: busy, onClick: () => submit('confirm') }, t('confirm.ok')),
          h('button', { type: 'button', className: 'ctm-btn', disabled: busy, onClick: () => submit('cancel') }, t('confirm.cancel'))));
    }
