    // ---------- dispatch confirmation card ----------
    // Shown under a running capability_dispatch_plan call: the user checks each role's model and up to three
    // fallbacks, edits them, and confirms or cancels. Answers go to api/capability-team.dispatch-confirm;
    // the tool keeps waiting until then, so nobody is dispatched before the user decides.
    const CONFIRM_PATH = 'api/capability-team.dispatch-confirm';
    const CONFIRM_HEARTBEAT_MS = 5000; // keep polling while pending so the tool knows the card is still on screen
    const rkey = r => (r ? `${r.provider}/${r.model}` : '');
    function usePendingConfirm(sessionId, callId, reload) {
      const [view, setView] = React.useState(null); // null loading · {status:'stale'|'gone'} · pending view
      React.useEffect(() => {
        if (!sessionId || !callId) return undefined;
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        let tries = 0, timer = null, live = true, wasPending = false;
        const again = ms => { timer = setTimeout(load, ms); };
        const load = async () => {
          timer = null;
          try {
            const res = await fetch(apiUrl(CONFIRM_PATH, { sessionId, callId }), { signal: ctrl?.signal });
            const body = res.ok ? await res.json() : null;
            if (!live) return;
            // Pending: show it once (refresh only when the native question box takes over), keep polling as a heartbeat.
            if (body?.status === 'pending') { setView(v => (wasPending && v?.status === 'pending' && v.native === body.native ? v : body)); wasPending = true; again(CONFIRM_HEARTBEAT_MS); return; }
            // It was pending and is gone now: answered here or in the question box, or ended on the server.
            if (wasPending) { setView(v => (v?.status === 'pending' ? { status: 'gone' } : v)); return; }
            // The tool registers its request right after it starts; retry briefly before giving up.
            if (++tries < 6) { again(500); return; }
            // The call is still running but has no request: the plugin reloaded or the request expired.
            setView({ status: 'stale' });
          } catch (e) {
            if (!live || e?.name === 'AbortError') return;
            if (wasPending) again(CONFIRM_HEARTBEAT_MS); else setView({ status: 'stale' });
          }
        };
        load();
        return () => { live = false; ctrl?.abort(); if (timer) clearTimeout(timer); };
      }, [sessionId, callId, reload]);
      return [view, setView];
    }
    // Shown when the Lead asks to finish the user's request itself: allowing lifts its step limit until the next message.
    function DirectConfirmCard({ sessionId, callId, t }) {
      const [view] = usePendingConfirm(sessionId, callId, 0);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [sent, setSent] = React.useState(null);
      if (sent) return h('div', { className: 'ctm-dc', 'data-state': 'sent' }, h('span', { className: 'ctm-sub' }, t(sent === 'cancel' ? 'direct.cancelled' : 'direct.sent')));
      if (!view) return h('div', { className: 'ctm-dc' }, h('span', { className: 'ctm-sub' }, t('direct.loading')));
      if (view.status === 'stale') return h('div', { className: 'ctm-dc', 'data-state': 'stale' }, h('p', { className: 'ctm-sub ctm-warn', role: 'alert' }, t('direct.stale')));
      if (view.status !== 'pending') return null;
      if (view.native) return h('div', { className: 'ctm-dc', 'data-state': 'native' }, h('span', { className: 'ctm-sub' }, t('direct.native')));
      const submit = async decision => {
        setBusy(true); setError(null);
        try {
          const res = await fetch(apiUrl(CONFIRM_PATH), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, callId, decision }) });
          if (res.ok) setSent(decision); else setError(t('confirm.error.other'));
        } catch { setError(t('confirm.error.other')); }
        finally { setBusy(false); }
      };
      return h('div', { className: 'ctm-dc', role: 'group', 'aria-label': t('direct.title') },
        h('div', { className: 'ctm-dc-head' },
          h('strong', { className: 'ctm-dc-title' }, t('direct.title')),
          h('span', { className: 'ctm-sub' }, t('direct.hint'))),
        view.reason ? h('p', { className: 'ctm-text' }, view.reason) : null,
        h('div', { className: 'ctm-dc-foot' },
          error ? h('p', { className: 'ctm-sub ctm-warn', role: 'alert' }, error) : null,
          h('div', { className: 'ctm-dc-buttons' },
            h('button', { type: 'button', className: 'ctm-btn', disabled: busy, onClick: () => submit('cancel') }, t('direct.deny')),
            h('button', { type: 'button', className: 'ctm-btn', 'data-primary': '', disabled: busy, onClick: () => submit('confirm') }, t('direct.allow')))));
    }
    function DispatchConfirmCard({ sessionId, callId, t }) {
      const [reload, setReload] = React.useState(0);
      const [view, setView] = usePendingConfirm(sessionId, callId, reload);
      const [edits, setEdits] = React.useState({}); // role → { primary, fallbacks }
      const [scope, setScope] = React.useState('task');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [sent, setSent] = React.useState(null);
      const [expanded, setExpanded] = React.useState({}); // role → task text shown in full
      if (sent) return h('div', { className: 'ctm-dc', 'data-state': 'sent' }, h('span', { className: 'ctm-sub' }, t(sent === 'cancel' ? 'confirm.cancelled' : 'confirm.sent')));
      if (!view) return h('div', { className: 'ctm-dc' }, h('span', { className: 'ctm-sub' }, t('confirm.loading')));
      if (view.status === 'stale') return h('div', { className: 'ctm-dc', 'data-state': 'stale' }, h('p', { className: 'ctm-sub ctm-warn', role: 'alert' }, t('confirm.stale')));
      if (view.status !== 'pending') return null; // Answered in the question box or ended on the server.
      if (view.native) return h('div', { className: 'ctm-dc', 'data-state': 'native' }, h('span', { className: 'ctm-sub' }, t('confirm.native')));
      const max = view.maxFallbacks ?? 3;
      const current = r => edits[r.role] ?? { primary: rkey(r.primary), fallbacks: r.fallbacks.map(rkey) };
      const isCrossTier = (r, route) => r.candidates.some(candidate => rkey(candidate) === route && candidate.sameTier === false);
      const hasCrossTier = view.routes.some(r => [current(r).primary, ...current(r).fallbacks].some(route => isCrossTier(r, route)));
      const effectiveScope = hasCrossTier ? 'task' : scope;
      const update = (r, change) => { setEdits(prev => ({ ...prev, [r.role]: { ...current(r), ...change } })); setScope('task'); };
      const move = (list, i, d) => { const next = [...list]; const j = i + d; if (j < 0 || j >= next.length) return list; [next[i], next[j]] = [next[j], next[i]]; return next; };
      const submit = async decision => {
        setBusy(true); setError(null);
        try {
          const routes = view.routes.map(r => ({ role: r.role, ...current(r) }));
          const res = await fetch(apiUrl(CONFIRM_PATH), { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId, callId, decision, scope: effectiveScope, catalogVersion: view.catalogVersion, routes }) });
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
        const recommended = r.candidates.filter(candidate => candidate.sameTier).map(rkey);
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
            h('span', { className: 'ctm-label ctm-dc-key' }, t('confirm.primary'), isCrossTier(r, c.primary) ? badge(t('confirm.crossTier'), 'warn', 'cross-tier') : null),
            h(ModelPicker, { value: c.primary, options, recommended, disabled: busy, t, label: `${who} ${t('confirm.primary')}`, placeholder: t('picker.search'),
              onChange: k => update(r, { primary: k, fallbacks: c.fallbacks.filter(f => f !== k) }) }),
            h('span', { className: 'ctm-label ctm-dc-key' }, t('confirm.fallbacks'), h('span', { className: 'ctm-dc-count' }, `${c.fallbacks.length}/${max}`)),
            h('div', { className: 'ctm-dc-fallbacks' },
              c.fallbacks.length ? h('ol', { className: 'ctm-dc-list' }, ...c.fallbacks.map((f, i) => h('li', { key: f, className: 'ctm-dc-item' },
                h('span', { className: 'ctm-dc-index', 'aria-hidden': true }, String(i + 1)),
                h('span', { className: 'ctm-dc-route', title: f }, f, isCrossTier(r, f) ? badge(t('confirm.crossTierFallback'), 'warn', 'cross-tier') : null, r.learned?.unhealthy?.[f] ? badge(fmt(t('confirm.failing'), { n: r.learned.unhealthy[f] }), 'warn', 'bad') : null),
                h('span', { className: 'ctm-dc-actions' },
                  iconButton('↑', 'confirm.up', f, i === 0, () => update(r, { fallbacks: move(c.fallbacks, i, -1) })),
                  iconButton('↓', 'confirm.down', f, i === c.fallbacks.length - 1, () => update(r, { fallbacks: move(c.fallbacks, i, 1) })),
                  iconButton('×', 'confirm.remove', f, false, () => update(r, { fallbacks: c.fallbacks.filter(x => x !== f) }))))))
                : h('span', { className: 'ctm-sub' }, t('confirm.noFallbacks')),
              c.fallbacks.length < max && spare.length
                ? h(ModelPicker, { value: '', options: spare, recommended, disabled: busy, t, label: t('confirm.addFallback'), placeholder: t('confirm.addFallback'),
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
            h('div', { className: 'ctm-dc-seg' }, ...['task', 'project'].map(s => h('button', { key: s, type: 'button', role: 'radio', 'aria-checked': effectiveScope === s,
              className: 'ctm-dc-segbtn', disabled: busy || (s === 'project' && hasCrossTier), onClick: () => setScope(s) }, t(`confirm.scope.${s}`)))),
            hasCrossTier ? h('span', { className: 'ctm-sub ctm-warn' }, t('confirm.crossTierTaskOnly')) : null,
            effectiveScope === 'project' && changedCaps.length ? h('span', { className: 'ctm-sub ctm-warn' }, fmt(t('confirm.scope.projectHint'), { list: [...new Set(changedCaps)].join(t('common.listSep')) })) : null),
          error ? h('p', { className: 'ctm-sub ctm-warn', role: 'alert' }, error) : null,
          h('div', { className: 'ctm-dc-buttons' },
            h('button', { type: 'button', className: 'ctm-btn', disabled: busy, onClick: () => submit('cancel') }, t('confirm.cancel')),
            h('button', { type: 'button', className: 'ctm-btn', 'data-primary': '', disabled: busy, onClick: () => submit('confirm') }, t('confirm.ok')))));
    }
