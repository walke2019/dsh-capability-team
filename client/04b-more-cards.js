    // ---------- cards for the remaining JSON tools ----------
    // Every capability-team tool that answers with JSON gets a card, so the conversation never shows raw JSON.
    // `valueView` renders any leftover structure as labelled rows and chips instead of a JSON dump.
    function valueView(v, depth = 0) {
      if (v === null || v === undefined || v === '') return h('span', { className: 'ctm-sub' }, '—');
      if (typeof v !== 'object') return h('span', { className: 'ctm-text' }, String(v));
      if (Array.isArray(v)) {
        if (!v.length) return h('span', { className: 'ctm-sub' }, '—');
        if (v.every(x => x === null || typeof x !== 'object')) return h('div', { className: 'ctm-chips' }, ...v.slice(0, 40).map((x, i) => h('span', { key: i, className: 'ctm-chip' }, String(x))));
        if (depth >= 2) return h('span', { className: 'ctm-sub' }, `${v.length} ×`);
        return h('div', { className: 'ctm-mc-list' }, ...v.slice(0, 20).map((x, i) => h('div', { key: i, className: 'ctm-mc-item' }, valueView(x, depth + 1))));
      }
      const entries = Object.entries(v).filter(([, x]) => x !== undefined);
      if (depth >= 2) return h('span', { className: 'ctm-sub' }, entries.map(([k, x]) => `${k}: ${typeof x === 'object' && x ? '…' : String(x)}`).join(' · '));
      return h('div', { className: 'ctm-grid ctm-ov-kv' }, ...entries.flatMap(([k, x]) => [
        h('span', { key: `k${k}`, className: 'ctm-sub' }, k), h('div', { key: `v${k}`, className: 'ctm-text' }, valueView(x, depth + 1))]));
    }
    const routeLabel = r => (r ? `${r.provider ? r.provider + '/' : ''}${r.model ?? ''}` : '');
    /** One card shape: title, a one-line summary from the data, and a body built from it. */
    function dataCard(tool, icon, titleKey, summarize, bodyOf) {
      return function DataCard(props) {
        const t = props.t;
        const s = stage(props);
        const d = s.data;
        const summary = s.state === 'error' ? firstLine(cleanError(s.output)) : d ? summarize(d, t, s.args) : s.state === 'ok' ? firstLine(s.output) : '';
        const body = s.state === 'error' ? errorBody(s, t) : d ? bodyOf(d, t) : rawBody(s, t);
        return h(Card, { tool, icon, title: t(titleKey), summary, state: s.state, t, inspect: props.inspect, body: body ?? null });
      };
    }
    const CatalogView = dataCard('capability_model_catalog', ICONS.team, 'cards.catalog',
      (d, t) => fmt(t('cards.catalog.summary'), { n: d.entries?.length ?? 0, p: new Set((d.entries ?? []).map(e => e.provider)).size }),
      (d, t) => {
        const byProvider = new Map();
        for (const e of d.entries ?? []) { if (!byProvider.has(e.provider)) byProvider.set(e.provider, []); byProvider.get(e.provider).push(e); }
        return [...[...byProvider].map(([p, list]) => section(`${p} · ${list.length}`, h('div', { className: 'ctm-chips' },
          ...list.slice(0, 60).map(e => h('span', { key: e.model, className: 'ctm-chip', title: e.tiers?.join(', ') ?? '' }, e.tiers?.length ? `${e.model} · ${e.tiers.map(x => label(t, `tier.${x}`, x)).join('/')}` : e.model))))),
          ...(d.errors?.length ? [section(t('cards.catalog.errors'), h('div', { className: 'ctm-text ctm-warn' }, d.errors.map(e => `${e.provider}: ${e.error}`).join('\n')))] : [])];
      });
    const leaseSummary = (d, t) => [d.roleId, d.status && label(t, `control.lease.status.${d.status}`, d.status),
      d.estimatedSteps ? fmt(t('control.steps.label'), { used: d.startsUsed ?? 0, est: d.estimatedSteps }) : null,
      d.override ? fmt(t('control.override.badge'), { from: routeLabel(d.override.from), to: routeLabel(d.override) }) : null].filter(Boolean).join(' · ');
    const leaseBody = (d, t) => section(null, valueView({ [t('cards.lease.role')]: d.roleId, [t('cards.lease.status')]: d.status, [t('cards.lease.judgment')]: d.judgment,
      [t('cards.lease.steps')]: d.estimatedSteps ? `${d.startsUsed ?? 0} / ${d.estimatedSteps}` : undefined,
      [t('control.override.title')]: d.override ? `${routeLabel(d.override.from)} → ${routeLabel(d.override)}` : t('control.override.none'),
      [t('cards.lease.ends')]: d.expiresAt ? timeOfDay(d.expiresAt) : undefined, [t('cards.lease.endReason')]: d.endReason ?? undefined }));
    const BudgetView = dataCard('capability_task_budget', ICONS.plan, 'cards.budget', leaseSummary, leaseBody);
    const OverrideView = dataCard('capability_member_override', ICONS.plan, 'cards.override', leaseSummary, leaseBody);
    const ExportView = dataCard('capability_team_export', ICONS.team, 'cards.export',
      (d, t) => fmt(t('cards.export.summary'), { n: Object.keys(d.roles ?? {}).length, c: Object.keys(d.capabilities ?? {}).length }),
      d => [section(null, valueView({ format: d.format, version: d.version, name: d.name })),
        d.roles ? section('roles', valueView(Object.fromEntries(Object.entries(d.roles).map(([id, r]) => [id, `${r.displayName ?? id} · ${r.capability ?? ''}`])))) : null].filter(Boolean));
    const SearchView = dataCard('cpa_search', ICONS.free, 'cards.search',
      (d, t, args) => fmt(t('cards.search.summary'), { q: d.query ?? args.query ?? '', n: d.results?.length ?? 0 }),
      d => section(d.provider ?? null, h('ol', { className: 'ctm-mc-results' }, ...(d.results ?? []).slice(0, 20).map((r, i) => h('li', { key: i },
        h('span', { className: 'ctm-name' }, r.title ?? r.url), r.url ? h('span', { className: 'ctm-sub' }, r.url) : null,
        r.snippet || r.content ? h('span', { className: 'ctm-sub' }, firstLine(r.snippet ?? r.content)) : null)))));
    const FetchView = dataCard('cpa_web_fetch', ICONS.free, 'cards.fetch',
      (d, t, args) => d.title ?? d.url ?? args.url ?? '',
      d => section(d.url ?? null, h('div', { className: 'ctm-text' }, String(d.content ?? d.text ?? d.markdown ?? '').slice(0, 1200))));
    const HandoffView = dataCard('capability_handoff', ICONS.plan, 'cards.handoff',
      (d, t) => fmt(t('cards.handoff.summary'), { name: d.member ?? '', n: d.facts?.openTasks ?? 0 }),
      (d, t) => section(null, valueView({ [t('cards.handoff.diff')]: d.facts?.diffStat ? '✓' : '—', [t('cards.handoff.test')]: d.facts?.lastTest ?? '—' })));
    const RotateView = dataCard('capability_rotate_member', ICONS.team, 'cards.rotate',
      (d, t) => (d.rotated ? fmt(t('cards.rotate.summary'), { from: d.from, to: d.to }) : d.reason ?? ''),
      d => [d.next ? section(null, h('pre', { className: 'ctm-pre', 'data-short': '' }, d.next)) : null,
        d.prompt ? section('prompt', h('div', { className: 'ctm-text ctm-sub' }, d.prompt)) : null].filter(Boolean));
    const MemorySearchView = dataCard('capability_memory_search', ICONS.plan, 'cards.memorySearch',
      (d, t, args) => fmt(t('cards.memorySearch.summary'), { q: args.query ?? '', n: d.results?.length ?? 0, mode: t(`cards.memory.mode.${d.mode}`) }),
      (d, t) => [d.note ? h('p', { className: 'ctm-sub ctm-warn' }, d.note) : null,
        section(null, h('ol', { className: 'ctm-mc-results' }, ...(d.results ?? []).map(r => h('li', { key: r.id },
          h('span', { className: 'ctm-sub' }, `${label(t, `cards.memory.kind.${r.kind}`, r.kind)} · ${r.scope}${r.via?.length ? ` · ${r.via.join('+')}` : ''}`),
          h('span', { className: 'ctm-text' }, r.text)))))].filter(Boolean));
    const MemoryWriteView = dataCard('capability_memory_write', ICONS.plan, 'cards.memoryWrite',
      (d, t, args) => `${label(t, `cards.memory.kind.${d.kind}`, d.kind)} · ${d.merged ? t('cards.memoryWrite.merged') : t('cards.memoryWrite.saved')}${firstLine(args.text) ? ` · ${firstLine(args.text)}` : ''}`,
      () => null);
    const PrefsView = dataCard('capability_model_prefs', ICONS.plan, 'cards.prefs',
      (d, t) => (d.cleared ? t('cards.prefs.cleared') : fmt(t('cards.prefs.summary'), { n: Object.keys(d.habits ?? {}).length })),
      (d, t) => (d.habits ? section(null, valueView(Object.fromEntries(Object.entries(d.habits).map(([cap, hb]) => [cap, `${hb.primary}${hb.fallbacks?.length ? ` → ${hb.fallbacks.join(' → ')}` : ''} · ${hb.count}/${hb.of}`])))) : null));
