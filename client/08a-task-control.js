    // ---------- task control (per-member step budget and temporary model) ----------
    // Reads the lease from the runtime snapshot the board already subscribes to (no extra polling). Writes go
    // through POST api/capability-team.task-control; a temporary model is only sent after the in-page confirm.
    const CONTROL_ERRORS = { 400: 'badRequest', 403: 'forbidden', 404: 'notFound', 409: 'conflict', 422: 'invalid', 503: 'unavailable' };
    const COMPLEXITIES = ['simple', 'medium', 'complex'];
    const requestId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const routeOf = r => (r ? `${r.provider ? r.provider + '/' : ''}${r.model ?? ''}` : '');
    /** The member's live lease, else its most recent one. */
    function leaseFor(control, roleId) {
      const all = Array.isArray(control?.leases) ? control.leases.filter(l => l.roleId === roleId) : [];
      return all.find(l => l.status !== 'ended') ?? all[all.length - 1];
    }
    const stepTone = judgment => (judgment === 'unqualified' ? 'error' : judgment === 'warning' ? 'warn' : 'ok');
    async function controlRequest(path, init) {
      let res;
      try { res = await fetch(path, init); } catch (error) { if (error?.name === 'AbortError') throw error; return { ok: false, kind: 'network' }; }
      let body = null;
      try { body = await res.json(); } catch { /* empty or non-JSON body */ }
      if (res.ok) return { ok: true, body };
      return { ok: false, kind: CONTROL_ERRORS[res.status] ?? 'unknown', status: res.status, message: body?.message };
    }
    function TaskControl({ leadSessionId, roleId, name, configured, control, t }) {
      const lease = leaseFor(control, roleId);
      const [open, setOpen] = React.useState(false);
      const [candidates, setCandidates] = React.useState(null);
      const [pick, setPick] = React.useState('');
      const [reason, setReason] = React.useState('');
      const [complexity, setComplexity] = React.useState('medium');
      const [confirming, setConfirming] = React.useState(false);
      const [pending, setPending] = React.useState(false);
      const [error, setError] = React.useState(null);
      const aborter = React.useRef(null);
      React.useEffect(() => () => aborter.current?.abort(), []);
      const freshSignal = () => { aborter.current?.abort(); aborter.current = typeof AbortController === 'function' ? new AbortController() : null; return aborter.current?.signal; };
      const stop = event => event.stopPropagation();
      React.useEffect(() => {
        if (!open || candidates || !lease || lease.status === 'ended') return;
        let live = true;
        controlRequest(apiUrl('api/capability-team.override-candidates', { sessionId: leadSessionId, role: roleId }), { signal: freshSignal() })
          .then(r => { if (live) setCandidates(r.ok ? r.body : { error: r.kind, candidates: [] }); })
          .catch(() => {});
        return () => { live = false; };
      }, [open, leadSessionId, roleId, Boolean(lease && lease.status !== 'ended')]);
      const post = async body => {
        setPending(true); setError(null);
        try {
          const r = await controlRequest(apiUrl('api/capability-team.task-control'), {
            method: 'POST', headers: { 'content-type': 'application/json' }, signal: freshSignal(),
            body: JSON.stringify({ sessionId: leadSessionId, requestId: requestId(), role: roleId, ...body }),
          });
          if (!r.ok) setError(r.kind); else { setConfirming(false); setPick(''); setReason(''); }
        } catch (e) { if (e?.name !== 'AbortError') setError('network'); }
        finally { setPending(false); }
      };
      const cas = lease ? { lease_id: lease.leaseId, expected_revision: lease.revision } : {};
      const chosen = candidates?.candidates?.find(c => routeOf(c) === pick);
      const ended = !lease || lease.status === 'ended';
      const used = lease?.startsUsed ?? 0;
      const est = lease?.estimatedSteps ?? 0;
      const ratio = est > 0 ? Math.min(1, used / est) : 0;
      const tone = stepTone(lease?.judgment);
      const audit = (Array.isArray(control?.auditTail) ? control.auditTail : []).filter(r => r.roleId === roleId).slice(0, 5);
      const errorText = error ? `${label(t, `control.error.${error}`, t('control.error.unknown'))}${error === 'conflict' ? ` ${t('control.error.reconfirm')}` : ''}` : null;
      const summary = lease
        ? (lease.status === 'ended' ? t('control.lease.ended') : fmt(t('control.steps.label'), { used, est }))
        : t('control.budget.title');
      return h('details', { className: 'ctm-tc', 'data-tone': tone, open, onClick: stop, onKeyDown: stop,
        onToggle: event => setOpen(event.currentTarget.open) },
        h('summary', null, h('span', { className: 'ctm-label' }, t('control.title')), h('span', { className: 'ctm-sub' }, summary)),
        lease ? h('div', { className: 'ctm-tc-body' },
          h('div', { className: 'ctm-tc-row' },
            badge(label(t, `control.lease.status.${lease.status}`, lease.status), ended ? undefined : 'brand', 'st'),
            !ended && lease.judgment !== 'within' ? badge(t(`control.steps.${lease.judgment}`), tone, 'j') : null),
          est > 0 ? h('div', { className: 'ctm-us-meter', 'data-tone': tone, role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': est, 'aria-valuenow': used, 'aria-label': fmt(t('control.steps.label'), { used, est }) },
            h('i', { style: { width: `${(ratio * 100).toFixed(1)}%` } })) : null,
          h('p', { className: 'ctm-sub' }, t('control.steps.disclaimer')),
          lease.override
            ? h('div', { className: 'ctm-tc-override' },
              h('span', { className: 'ctm-chip' }, fmt(t('control.override.badge'), { from: routeOf(lease.override.from), to: routeOf(lease.override) })),
              lease.expiresAt ? h('span', { className: 'ctm-sub' }, fmt(t('control.override.expiresAt'), { time: timeOfDay(lease.expiresAt) })) : null,
              h('span', { className: 'ctm-sub' }, t('control.override.autoRestore')),
              h('span', { className: 'ctm-sub' }, t('control.override.pauseLongContext')))
            : h('p', { className: 'ctm-sub' }, t('control.override.none')),
          ended ? null : h('div', { className: 'ctm-tc-actions' },
            h('label', { className: 'ctm-sub' }, t('control.override.pick'),
              h('select', { value: pick, disabled: pending || !candidates?.candidates?.length, onChange: e => { setPick(e.target.value); setConfirming(false); } },
                h('option', { value: '' }, candidates?.candidates?.length ? '—' : t('control.override.noCandidates')),
                ...(candidates?.candidates ?? []).map(c => h('option', { key: routeOf(c), value: routeOf(c) }, `${routeOf(c)} · ${label(t, `tier.${c.tier}`, c.tier)}`)))),
            h('span', { className: 'ctm-sub' }, t('control.override.pickHint')),
            h('input', { type: 'text', className: 'ctm-tc-reason', placeholder: t('control.override.reason'), value: reason, maxLength: 200, onChange: e => setReason(e.target.value) }),
            h('div', { className: 'ctm-tc-row' },
              h('button', { type: 'button', className: 'ctm-btn', disabled: pending || !chosen, onClick: () => setConfirming(true) }, t('control.override.setAction')),
              lease.override ? h('button', { type: 'button', className: 'ctm-btn', disabled: pending, onClick: () => post({ action: 'clear-override', ...cas, reason }) }, t('control.override.restoreAction')) : null,
              h('button', { type: 'button', className: 'ctm-btn', disabled: pending, onClick: () => post({ action: 'finish-lease', ...cas, reason }) }, t('control.action.end')))),
          confirming && chosen ? h('div', { className: 'ctm-tc-confirm', role: 'alertdialog', 'aria-label': t('control.override.confirm.title') },
            h('strong', null, t('control.override.confirm.title')),
            h('span', null, fmt(t('control.override.confirm.member'), { name })),
            h('span', null, fmt(t('control.override.confirm.change'), { from: lease.override ? routeOf(lease.override) : (configured || t('live.configModel')), to: routeOf(chosen), tier: label(t, `tier.${chosen.tier}`, chosen.tier) })),
            h('span', { className: 'ctm-warn' }, t('control.override.confirm.cost')),
            h('span', { className: 'ctm-sub' }, t('control.override.confirm.restore')),
            h('div', { className: 'ctm-tc-row' },
              h('button', { type: 'button', className: 'ctm-btn', 'data-primary': '', disabled: pending,
                onClick: () => post({ action: 'set-override', ...cas, provider: chosen.provider, model: chosen.model, catalog_version: candidates.catalogVersion, reason }) }, t('control.override.confirm.ok')),
              h('button', { type: 'button', className: 'ctm-btn', disabled: pending, onClick: () => setConfirming(false) }, t('control.override.confirm.cancel')))) : null)
          : null,
        ended ? h('div', { className: 'ctm-tc-row' },
          h('label', { className: 'ctm-sub' }, t('control.budget.complexity'),
            h('select', { value: complexity, disabled: pending, onChange: e => setComplexity(e.target.value) },
              ...COMPLEXITIES.map(c => h('option', { key: c, value: c }, t(`control.budget.complexity.${c}`))))),
          h('button', { type: 'button', className: 'ctm-btn', disabled: pending, onClick: () => post({ action: 'start-budget', complexity, reason }) }, t('control.budget.startAction'))) : null,
        pending ? h('p', { className: 'ctm-sub' }, t('control.pending')) : null,
        errorText ? h('p', { className: 'ctm-sub ctm-warn', role: 'alert' }, errorText) : null,
        h('div', { className: 'ctm-tc-audit' },
          h('span', { className: 'ctm-sub' }, t('control.audit.title')),
          audit.length
            ? h('ul', null, ...audit.map(r => h('li', { key: r.eventId }, `${timeOfDay(r.at)} · ${String(r.action ?? '')}${r.to ? ` → ${routeOf(r.to)}` : ''}${r.reason ? ` · ${String(r.reason)}` : ''}`)))
            : h('span', { className: 'ctm-sub' }, t('control.audit.empty'))));
    }
