    // ---------- right sidebar: team overview ----------
    const TIER_ORDER = ['high', 'upper', 'medium', 'low'];
    const PAGE = 40;
    const isRule = entry => entry.endsWith('*');
    /** Same semantics as the host: exact provider/model keys, or "prefix*" on the full key or the bare model id. */
    const ruleMatcher = list => {
      const exact = new Set(), prefixes = [];
      for (const entry of list) (isRule(entry) ? prefixes.push(entry.slice(0, -1)) : exact.add(entry));
      return key => exact.has(key) || prefixes.some(p => key.startsWith(p) || key.slice(key.indexOf('/') + 1).startsWith(p));
    };
    const ruleCovers = (rule, key) => ruleMatcher([rule])(key);
    /** User input → normalized prefix rule, or null when it is not a usable prefix. */
    const toRule = text => {
      const base = String(text ?? '').trim().replace(/\*+$/, '');
      return base.length >= 2 && !/[*\s]/.test(base) ? base + '*' : null;
    };
    const tierRank = tier => { const i = TIER_ORDER.indexOf(tier); return i === -1 ? (tier === 'unknown' ? 99 : 50) : i; };
    const routeText = route => typeof route === 'string' ? route : route?.provider ? `${route.provider}/${route.model}` : '';
    const when = value => {
      if (value == null) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    const timeOfDay = value => {
      if (value == null) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    /** Labelled translation that falls back to the raw value when no dictionary entry exists. */
    const label = (t, key, fallback) => { const text = t(key); return text === key ? fallback : text; };
    const stat = (value, text, tone, key) => h('div', { className: 'ctm-ov-stat', 'data-tone': tone, key }, h('strong', null, value), h('span', null, text));

    function ModelPolicyEditor({ sessionId, policy, save, t }) {
      const [draft, setDraft] = React.useState(policy.disabledRoutes ?? []);
      const [status, setStatus] = React.useState({});
      const [revision, setRevision] = React.useState(policy.revision);
      const [saved, setSaved] = React.useState(policy.disabledRoutes ?? []);
      const [query, setQuery] = React.useState('');
      const [tierTab, setTierTab] = React.useState(null);
      const [limit, setLimit] = React.useState(PAGE);
      const [prefix, setPrefix] = React.useState('');
      const isOff = ruleMatcher(draft);
      const rules = draft.filter(isRule);
      const ruleFor = key => draft.includes(key) ? null : rules.find(rule => ruleCovers(rule, key));
      const pending = draft.filter(key => !saved.includes(key)).length + saved.filter(key => !draft.includes(key)).length;
      const rows = policy.rows ?? [];
      const names = new Map((policy.allocations ?? []).map(a => [a.id, a.displayName]));
      const who = ids => ids.map(id => names.get(id) ?? id).join(t('common.listSep'));
      const needle = query.trim().toLowerCase();
      const matches = row => !needle || [row.key, who(row.primaryFor ?? []), who(row.fallbackFor ?? [])].join(' ').toLowerCase().includes(needle);
      const groups = new Map();
      for (const row of rows) {
        const tier = row.tiers?.[0] ?? 'unknown';
        if (!groups.has(tier)) groups.set(tier, []);
        groups.get(tier).push(row);
      }
      const toggle = (key, enabled) => {
        setDraft(old => enabled ? old.filter(k => k !== key) : [...new Set([...old, key])]);
        setStatus({});
      };
      const submit = async () => {
        setStatus({ busy: true });
        try {
          const result = await save(sessionId, draft, revision);
          setRevision(result.revision); setSaved(result.disabledRoutes); setDraft(result.disabledRoutes);
          setStatus({ success: true });
        } catch (error) { setStatus({ error: String(error.message ?? error) }); }
      };
      const modelRow = (row, showTier) => {
        const enabled = !isOff(row.key);
        const rule = enabled ? null : ruleFor(row.key);
        const usage = [
          row.primaryFor?.length ? chip(t('models.primary'), who(row.primaryFor), 'p') : null,
          row.fallbackFor?.length ? chip(t('models.fallback'), who(row.fallbackFor), 'f') : null,
        ].filter(Boolean);
        return h('label', { key: row.key, className: 'ctm-ov-model', ...(enabled ? {} : { 'data-off': '' }) },
          h('input', { type: 'checkbox', className: 'ctm-switch', role: 'switch', checked: enabled, disabled: status.busy || !!rule, title: rule ? fmt(t('models.byRule'), { rule }) : undefined, 'aria-label': `${t('models.enabled')} ${row.key}`,
            onChange: e => toggle(row.key, e.target.checked) }),
          h('div', { className: 'ctm-ov-model-main' },
            h('div', { className: 'ctm-ov-model-name' },
              h('span', { className: 'ctm-name' }, row.model ?? row.key),
              row.provider ? h('span', { className: 'ctm-sub' }, row.provider) : null,
              showTier && row.tiers?.[0] ? badge(label(t, `tier.${row.tiers[0]}`, row.tiers[0]), undefined, 'tier') : null,
              enabled ? null : badge(rule ? fmt(t('models.byRule'), { rule }) : t('models.disabledBadge'), 'warn', 'off')),
            usage.length ? h('div', { className: 'ctm-chips' }, ...usage) : h('span', { className: 'ctm-sub' }, t('models.unused'))));
      };
      const orphans = draft.filter(key => !isRule(key) && !rows.some(row => row.key === key));
      const candidate = toRule(prefix);
      const preview = candidate ? rows.filter(row => ruleCovers(candidate, row.key)) : [];
      const addRule = () => {
        if (!candidate || draft.includes(candidate)) return;
        setDraft(old => [...new Set([...old, candidate])]); setPrefix(''); setStatus({});
      };
      const removeRule = rule => { setDraft(old => old.filter(k => k !== rule)); setStatus({}); };
      const tiers = [...groups.keys()].sort((a, b) => tierRank(a) - tierRank(b));
      // Large catalogs (hundreds of routes): open on one tier, list routes in use first, render in pages.
      const activeTier = tierTab === 'all' || groups.has(tierTab) ? tierTab : tiers[0] ?? 'all';
      const scoped = activeTier === 'all' ? tiers.flatMap(tier => groups.get(tier)) : groups.get(activeTier);
      const wasOff = ruleMatcher(saved);
      const weight = row => row.primaryFor?.length ? 0 : row.fallbackFor?.length ? 1 : wasOff(row.key) ? 2 : 3;
      const shown = scoped.filter(matches).map((row, index) => ({ row, index })).sort((a, b) => weight(a.row) - weight(b.row) || a.index - b.index).map(x => x.row);
      const visible = shown.slice(0, limit);
      const tierTabButton = (id, text, list) => {
        const count = list.filter(row => isOff(row.key)).length;
        return h('button', { key: id, type: 'button', role: 'tab', className: 'ctm-ov-tier', 'aria-selected': activeTier === id, onClick: () => { setTierTab(id); setLimit(PAGE); } },
          text, h('span', { className: 'ctm-ov-count' }, String(list.length)), count ? h('span', { className: 'ctm-ov-offdot', title: fmt(t('models.tierCount'), { n: list.length, d: count }) }) : null);
      };
      return h('div', { className: 'ctm-ov-editor' },
        h('div', { className: 'ctm-ov-toolbar' },
          h('button', { type: 'button', className: 'ctm-btn', 'data-primary': '', disabled: !pending || status.busy, onClick: submit }, t(status.busy ? 'models.saving' : 'models.save')),
          pending && !status.busy ? h('button', { type: 'button', className: 'ctm-btn', onClick: () => { setDraft(saved); setStatus({}); } }, t('models.reset')) : null,
          status.error ? h('span', { role: 'alert', className: 'ctm-ov-note ctm-error' }, status.error)
            : status.success ? h('span', { role: 'status', className: 'ctm-ov-note ctm-success' }, t('models.saved'))
            : pending ? h('span', { className: 'ctm-ov-note ctm-warn' }, fmt(t('models.dirty'), { n: pending })) : null),
        h('p', { className: 'ctm-sub ctm-ov-help' }, t('models.help')),
        h('div', { className: 'ctm-ov-block' },
          h('div', { className: 'ctm-label' }, t('models.preview')),
          revision === policy.revision
            ? h('div', { className: 'ctm-ov-allocs' }, ...(policy.allocations ?? []).map(role => h('div', { key: role.id, className: 'ctm-ov-alloc', 'data-status': role.status, title: role.reason ?? '' },
                h('span', { className: 'ctm-name' }, role.displayName),
                role.primary ? h('div', { className: 'ctm-ov-chain' },
                  h('span', { className: 'ctm-ov-hop', 'data-primary': '', title: role.primary }, role.primary),
                  ...(role.fallbacks ?? []).flatMap((route, i) => [h('span', { key: 'a' + i, className: 'ctm-ov-arrow', 'aria-hidden': true }, '›'), h('span', { key: 'r' + i, className: 'ctm-ov-hop', title: route }, route)]))
                  : h('span', { className: 'ctm-ov-route ctm-warn' }, t('models.' + role.status)))))
            : h('p', { className: 'ctm-sub' }, t('models.refreshPreview'))),
        rows.length > 6 ? h('input', { type: 'search', className: 'ctm-ov-search', placeholder: t('models.filter'), value: query, onChange: e => { setQuery(e.target.value); setLimit(PAGE); } }) : null,
        h('div', { className: 'ctm-ov-block ctm-ov-rules' },
          h('div', { className: 'ctm-label' }, t('models.prefixTitle')),
          h('div', { className: 'ctm-ov-rule-input' },
            h('input', { type: 'text', className: 'ctm-ov-search', placeholder: t('models.prefixPlaceholder'), value: prefix, disabled: status.busy, 'aria-label': t('models.prefixTitle'),
              onChange: e => setPrefix(e.target.value), onKeyDown: e => { if (e.key === 'Enter') { e.preventDefault(); addRule(); } } }),
            h('button', { type: 'button', className: 'ctm-btn', disabled: !candidate || draft.includes(candidate) || status.busy, onClick: addRule }, t('models.prefixAdd'))),
          prefix.trim() ? h('p', { className: candidate && preview.length ? 'ctm-sub' : 'ctm-sub ctm-warn' },
            !candidate ? t('models.prefixInvalid')
              : draft.includes(candidate) ? t('models.prefixExists')
              : fmt(t('models.prefixPreview'), { rule: candidate, n: preview.length, list: preview.slice(0, 3).map(row => row.key).join(t('common.listSep')) + (preview.length > 3 ? '…' : '') })) : null,
          rules.length ? h('div', { className: 'ctm-chips' }, ...rules.map(rule => h('span', { key: rule, className: 'ctm-chip ctm-ov-rule' },
            h('span', null, rule), h('span', null, fmt(t('models.ruleCount'), { n: rows.filter(row => ruleCovers(rule, row.key)).length })),
            h('button', { type: 'button', className: 'ctm-ov-rule-x', disabled: status.busy, 'aria-label': fmt(t('models.ruleRemove'), { rule }), onClick: () => removeRule(rule) }, '×'))))
            : h('p', { className: 'ctm-sub' }, t('models.prefixHelp'))),
        tiers.length ? h('div', { className: 'ctm-ov-tiers', role: 'tablist', 'aria-label': t('models.tiers') },
          tierTabButton('all', t('models.allTiers'), rows), ...tiers.map(tier => tierTabButton(tier, label(t, `tier.${tier}`, tier), groups.get(tier)))) : null,
        shown.length ? h('div', { className: 'ctm-ov-group' }, h('div', { className: 'ctm-ov-list ctm-ov-list-flat' }, ...visible.map(row => modelRow(row, activeTier === 'all'))))
          : rows.length ? h('p', { className: 'ctm-sub' }, t('models.noMatch')) : null,
        shown.length > visible.length ? h('button', { type: 'button', className: 'ctm-btn ctm-ov-more', onClick: () => setLimit(n => n + PAGE * 2) },
          fmt(t('models.more'), { n: shown.length - visible.length })) : null,
        orphans.length ? h('details', { className: 'ctm-ov-group', open: true },
          h('summary', null, h('span', { className: 'ctm-name' }, t('models.orphans')), h('span', { className: 'ctm-sub' }, String(orphans.length))),
          h('div', { className: 'ctm-ov-list' }, ...orphans.map(key => modelRow({ key })))) : null);
    }

    // Live polling re-renders the overview every few seconds; the editor only changes with its own data.
    const PolicyEditor = React.memo ? React.memo(ModelPolicyEditor, (a, b) => a.sessionId === b.sessionId && a.policy === b.policy
      && a.save === b.save && (a.t === b.t || a.t('models.save') === b.t('models.save'))) : ModelPolicyEditor;

    function RoleCards({ roles, live, t }) {
      return h('div', { className: 'ctm-ov-roles' }, ...roles.map(r => {
        const fallbacks = (Array.isArray(r.fallbacks) ? r.fallbacks : []).map(routeText).filter(Boolean);
        return h('div', { key: r.id, className: 'ctm-ov-role' },
          h('div', { className: 'ctm-ov-role-head' },
            h('span', { className: 'ctm-name' }, r.displayName ?? r.id),
            r.tier ? badge(label(t, `tier.${r.tier}`, r.tier), r.tier === 'high' ? 'brand' : undefined, 'tier') : null),
          h('span', { className: 'ctm-sub' }, [r.id, r.capability].filter(Boolean).join(' · ')),
          r.description ? h('span', { className: 'ctm-ov-desc' }, r.description) : null,
          r.whenToUse ? h('span', { className: 'ctm-sub' }, fmt(t('roles.whenToUse'), { text: r.whenToUse })) : null,
          h('span', { className: r.provider ? 'ctm-ov-route' : 'ctm-ov-route ctm-warn', title: r.blocked },
            r.provider ? `${r.provider}/${r.model}` : t(r.blocked ? 'models.blocked' : 'team.unassigned')),
          liveRoleLine(live?.get(r.id), t),
          fallbacks.length ? h('span', { className: 'ctm-sub', title: fallbacks.join('\n') }, fmt(t('roles.fallbackList'), { list: fallbacks.join(t('common.listSep')) })) : null,
          r.maxTokens || r.longContext || r.planFirst ? h('div', { className: 'ctm-chips' },
            r.planFirst ? badge(t('roles.planFirst'), 'brand', 'p') : null,
            r.maxTokens ? badge(fmt(t('roles.maxTokens'), { n: compact(r.maxTokens) }), undefined, 'm') : null,
            r.longContext ? badge(fmt(t('roles.longContext'), { n: compact(r.longContext.thresholdTokens), route: `${r.longContext.provider}/${r.longContext.model}` }), undefined, 'l') : null) : null,
          accessBadges(r.access, t));
      }));
    }
    /** The member currently filling this role: live status and the model of its latest request. */
    function liveRoleLine(member, t) {
      if (!member) return null;
      return h('div', { className: 'ctm-chips' },
        badge(label(t, `live.${member.status}`, member.status), LIVE[member.status], 's'),
        member.model ? h('span', { className: 'ctm-sub', title: t('roles.liveModel') }, fmt(t('roles.current'), { route: [member.provider, member.model].filter(Boolean).join('/') })) : null);
    }
    /** Permission chips for one role; nothing when the capability has no access policy. */
    function accessBadges(access, t) {
      if (!access || typeof access !== 'object') return null;
      const items = [];
      if (Array.isArray(access.editPaths)) items.push(access.editPaths.length ? fmt(t('roles.editOnly'), { list: access.editPaths.join(t('common.listSep')) }) : t('roles.noEdit'));
      if (access.preset) items.push(fmt(t('roles.preset'), { name: access.preset }));
      else if (access.shell === false) items.push(t('roles.noShell'));
      if (access.deny?.length) items.push(fmt(t('roles.deny'), { list: access.deny.join(t('common.listSep')) }));
      return items.length ? h('div', { className: 'ctm-chips', title: t('roles.accessHint') }, ...items.map((text, i) => badge(text, 'warn', 'a' + i))) : null;
    }

    function WorkflowList({ workflow, t }) {
      if (!workflow || typeof workflow !== 'object') return h('span', { className: 'ctm-sub' }, '—');
      const value = (key, v) => {
        if (key === 'mode') return label(t, `workflow.mode.${v}`, String(v));
        if (key === 'freeTools') return label(t, `tools.${v}`, String(v));
        if (key === 'analysisBudget' || key === 'directBudget') return fmt(t('workflow.times'), { n: v });
        if (key === 'freeModels' && Array.isArray(v) && !v.length) return t('workflow.allFree');
        if (key === 'confirmDispatch') return label(t, `workflow.confirmDispatch.${v}`, String(v));
        if (key === 'rotation') return v ? fmt(t('workflow.rotation.value'), { soft: v.softCompactions, hard: v.hardCompactions, ratio: Math.round(v.hardRatio * 100), turns: v.hardTurns }) : t('workflow.fileLimits.off');
        if (key === 'fileLimits') return v ? fmt(t('workflow.fileLimits.value'), { source: v.sourceMax, test: v.testMax, read: v.readMax, report: v.reportMax }) : t('workflow.fileLimits.off');
        if (Array.isArray(v)) return h('div', { className: 'ctm-chips' }, ...v.map(item => h('span', { key: String(item), className: 'ctm-chip' }, String(item))));
        return typeof v === 'object' ? h('pre', { className: 'ctm-pre', 'data-short': '' }, JSON.stringify(v, null, 2)) : String(v);
      };
      return h('div', { className: 'ctm-grid ctm-ov-kv' }, ...Object.entries(workflow).flatMap(([key, v]) => [
        h('span', { key: `k${key}`, className: 'ctm-sub' }, label(t, `workflow.${key}`, key)),
        h('div', { key: `v${key}`, className: 'ctm-text' }, value(key, v)),
      ]));
    }
