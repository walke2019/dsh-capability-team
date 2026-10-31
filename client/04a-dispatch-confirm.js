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
      const [expanded, setExpanded] = React.useState({}); // role → task text shown in full
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
        const options = [...new Set([c.primary, ...r.candidates.map(rkey)])].filter(Boolean);
        const spare = options.filter(k => k !== c.primary && !c.fallbacks.includes(k));
        const who = r.displayName ?? r.role;
        const long = r.task && (r.task.length > 120 || r.task.includes('\n'));
        const iconButton = (glyph, labelKey, f, disabledWhen, onClick) => h('button', { type: 'button', className: 'ctm-dc-icon', disabled: busy || disabledWhen,
          'aria-label': `${t(labelKey)} ${f}`, title: t(labelKey), onClick }, glyph);
        return h('section', { key: r.role, className: 'ctm-dc-role', 'aria-label': who },
          h('header', { className: 'ctm-dc-role-head' },
            h('span', { className: 'ctm-dc-avatar', 'aria-hidden': true }, Array.from(who)[0] ?? '?'),
            h('div', { className: 'ctm-dc-who' },
              h('span', { className: 'ctm-name' }, who),
              h('span', { className: 'ctm-dc-meta' },
                h('code', null, r.role), h('span', null, r.capability), badge(label(t, `tier.${r.tier}`, r.tier), 'brand', 'tier'),
                r.learned?.habit ? badge(fmt(t('confirm.habit'), { n: r.learned.habit.count, of: r.learned.habit.of }), 'success', 'habit') : null))),
          r.task ? h('div', { className: 'ctm-dc-task' },
            h('p', { className: 'ctm-text', 'data-clamped': expanded[r.role] ? undefined : '' }, r.task),
            long ? h('button', { type: 'button', className: 'ctm-dc-link', onClick: () => setExpanded(prev => ({ ...prev, [r.role]: !prev[r.role] })) },
              t(expanded[r.role] ? 'confirm.collapse' : 'confirm.expand')) : null) : null,
          h('div', { className: 'ctm-dc-grid' },
            h('span', { className: 'ctm-label ctm-dc-key' }, t('confirm.primary')),
            h(ModelPicker, { value: c.primary, options, disabled: busy, t, label: `${who} ${t('confirm.primary')}`, placeholder: t('picker.search'),
              onChange: k => update(r, { primary: k, fallbacks: c.fallbacks.filter(f => f !== k) }) }),
            h('span', { className: 'ctm-label ctm-dc-key' }, t('confirm.fallbacks'), h('span', { className: 'ctm-dc-count' }, `${c.fallbacks.length}/${max}`)),
            h('div', { className: 'ctm-dc-fallbacks' },
              c.fallbacks.length ? h('ol', { className: 'ctm-dc-list' }, ...c.fallbacks.map((f, i) => h('li', { key: f, className: 'ctm-dc-item' },
                h('span', { className: 'ctm-dc-index', 'aria-hidden': true }, String(i + 1)),
                h('span', { className: 'ctm-dc-route', title: f }, f, r.learned?.unhealthy?.[f] ? badge(fmt(t('confirm.failing'), { n: r.learned.unhealthy[f] }), 'warn', 'bad') : null),
                h('span', { className: 'ctm-dc-actions' },
                  iconButton('↑', 'confirm.up', f, i === 0, () => update(r, { fallbacks: move(c.fallbacks, i, -1) })),
                  iconButton('↓', 'confirm.down', f, i === c.fallbacks.length - 1, () => update(r, { fallbacks: move(c.fallbacks, i, 1) })),
                  iconButton('×', 'confirm.remove', f, false, () => update(r, { fallbacks: c.fallbacks.filter(x => x !== f) }))))))
                : h('span', { className: 'ctm-sub' }, t('confirm.noFallbacks')),
              c.fallbacks.length < max && spare.length
                ? h(ModelPicker, { value: '', options: spare, disabled: busy, t, label: t('confirm.addFallback'), placeholder: t('confirm.addFallback'),
                  onChange: k => update(r, { fallbacks: [...c.fallbacks, k] }) })
                : c.fallbacks.length >= max ? h('span', { className: 'ctm-sub' }, fmt(t('confirm.max'), { n: max })) : null)),
          r.learned?.unhealthy?.[c.primary] ? h('p', { className: 'ctm-sub ctm-warn' }, fmt(t('confirm.primaryFailing'), { route: c.primary, n: r.learned.unhealthy[c.primary] })) : null,
          r.learned?.habit?.settled && scope === 'task' ? h('p', { className: 'ctm-sub' }, t('confirm.habitSettled')) : null);
      };
      return h('div', { className: 'ctm-dc', role: 'group', 'aria-label': t('confirm.title') },
        h('div', { className: 'ctm-dc-head' },
          h('strong', { className: 'ctm-dc-title' }, t('confirm.title')),
          h('span', { className: 'ctm-sub' }, t('confirm.hint'))),
        h('div', { className: 'ctm-dc-roles' }, ...view.routes.map(row)),
        h('div', { className: 'ctm-dc-foot' },
          h('div', { className: 'ctm-dc-scope', role: 'radiogroup', 'aria-label': t('confirm.scope') },
            h('span', { className: 'ctm-label' }, t('confirm.scope')),
            h('div', { className: 'ctm-dc-seg' }, ...['task', 'project'].map(s => h('button', { key: s, type: 'button', role: 'radio', 'aria-checked': scope === s,
              className: 'ctm-dc-segbtn', disabled: busy, onClick: () => setScope(s) }, t(`confirm.scope.${s}`)))),
            scope === 'project' && changedCaps.length ? h('span', { className: 'ctm-sub ctm-warn' }, fmt(t('confirm.scope.projectHint'), { list: [...new Set(changedCaps)].join(t('common.listSep')) })) : null),
          error ? h('p', { className: 'ctm-sub ctm-warn', role: 'alert' }, error) : null,
          h('div', { className: 'ctm-dc-buttons' },
            h('button', { type: 'button', className: 'ctm-btn', disabled: busy, onClick: () => submit('cancel') }, t('confirm.cancel')),
            h('button', { type: 'button', className: 'ctm-btn', 'data-primary': '', disabled: busy, onClick: () => submit('confirm') }, t('confirm.ok')))));
    }
