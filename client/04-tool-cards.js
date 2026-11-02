    // ---------- capability_dispatch_plan ----------
    function DispatchPlanView(props) {
      const t = props.t;
      const s = stage(props);
      const plan = s.data ?? s.args;
      const mode = plan.mode;
      const assignments = Array.isArray(plan.assignments) ? plan.assignments : [];
      const summary = s.state === 'error' ? firstLine(cleanError(s.output))
        : mode === 'delegate' ? assignments.map(a => a.displayName ?? a.role).filter(Boolean).join(t('common.listSep'))
        : plan.reason ?? '';
      const sections = [];
      if (s.state === 'error') sections.push(errorBody(s, t));
      else if (s.state === 'ok' && !s.data) sections.push(rawBody(s, t));
      else {
        if (plan.analysis) sections.push(section(t('plan.analysis'), h('div', { className: 'ctm-text' }, plan.analysis)));
        if (plan.boardError) sections.push(section(null, h('p', { className: 'ctm-sub ctm-warn' }, plan.boardError)));
        if (plan.reason) sections.push(section(t('plan.reason'), h('div', { className: 'ctm-text' }, plan.reason)));
        if (assignments.length) sections.push(section(t('plan.assignments'), h('div', { className: 'ctm-grid' }, ...assignments.flatMap((a, i) => [
          h('div', { className: 'ctm-who', key: `w${i}` }, h('span', { className: 'ctm-name' }, a.displayName ?? a.role),
            h('span', { className: 'ctm-sub' }, [a.displayName ? a.role : null, a.capability, a.model].filter(Boolean).join(' · ')),
            Array.isArray(a.fallbacks) && a.fallbacks.length ? h('span', { className: 'ctm-sub' }, fmt(t('plan.fallbacks'), { list: a.fallbacks.join(t('common.listSep')) })) : null),
          h('div', { className: 'ctm-text', key: `t${i}` }, a.task,
            Array.isArray(a.boardTasks) && a.boardTasks.length ? h('ul', { className: 'ctm-plan-board' }, ...a.boardTasks.map(bt => h('li', { key: bt.id },
              h('code', null, bt.id), ' ', bt.subject,
              bt.writeScopes?.length ? h('span', { className: 'ctm-sub' }, ' · ', fmt(t('plan.boardScope'), { list: bt.writeScopes.join(t('common.listSep')) })) : null,
              bt.blockedBy?.length ? h('span', { className: 'ctm-sub' }, ' · ', fmt(t('plan.boardAfter'), { list: bt.blockedBy.join(t('common.listSep')) })) : null))) : null),
        ]))));
        const facts = [];
        if (plan.freeTools) facts.push(chip(t('free.tools'), t(`tools.${plan.freeTools}`), 'tools'));
        if (plan.directBudget !== undefined) facts.push(h('span', { className: 'ctm-sub', key: 'budget' }, plan.directBudget === null ? t('plan.unlimited') : fmt(t('plan.budget'), { n: plan.directBudget })));
        if (plan.next) sections.push(section(t('plan.next'), facts.length ? h('div', { className: 'ctm-chips' }, ...facts) : null, h('div', { className: 'ctm-text ctm-sub' }, plan.next)));
      }
      const body = sections.filter(Boolean);
      const card = h(Card, { tool: 'capability_dispatch_plan', icon: ICONS.plan, title: t('plan.title'), summary, state: s.state, t, inspect: props.inspect,
        badges: [mode && t(`mode.${mode}`) !== `mode.${mode}` ? badge(t(`mode.${mode}`), mode === 'delegate' ? 'brand' : undefined, 'mode') : null,
          plan.confirmed?.by === 'user' ? badge(t('confirm.confirmedBy'), 'success', 'confirmed') : null],
        body: body.length ? body : null });
      // While the call waits for the user, the confirmation card sits right under it, already open.
      if (s.state !== 'running' || mode !== 'delegate') return card;
      return h('div', { className: 'ctm-dc-wrap' }, card, h(DispatchConfirmCard, { sessionId: props.sessionId, callId: props.callId, t }));
    }

    // ---------- capability_free_task ----------
    function FreeTaskView(props) {
      const t = props.t;
      const s = stage(props);
      const r = s.data;
      const subject = s.args.subject || firstLine(s.args.prompt);
      const changed = Array.isArray(r?.changedFiles) ? r.changedFiles : [];
      const summary = s.state === 'error' ? firstLine(cleanError(s.output)) : subject;
      const badges = [];
      if (r?.model) badges.push(badge(String(r.model).replace(/^opencode\//, ''), 'success', 'model'));
      if (changed.length) badges.push(badge(fmt(t('free.changedCount'), { n: changed.length }), 'brand', 'changed'));
      if (r?.skipped?.length) badges.push(badge(`${t('free.skipped')} ${r.skipped.length}`, 'warn', 'skipped'));
      const sections = [];
      if (r) {
        const calls = Array.isArray(r.toolCalls) ? r.toolCalls.length : 0;
        sections.push(section(null, h('div', { className: 'ctm-chips' },
          chip(t('free.model'), r.model, 'm'),
          r.tools ? chip(t('free.tools'), t(`tools.${r.tools}`), 'tl') : null,
          r.taskId ? chip(t('free.task'), `#${r.taskId}`, 'tk') : null,
          calls ? chip('', fmt(t('free.calls'), { n: calls }), 'c') : null)));
        if (r.skipped?.length) sections.push(section(t('free.skipped'), h('ul', { className: 'ctm-list ctm-warn' }, ...r.skipped.map((x, i) => h('li', { key: i, className: 'ctm-sub ctm-warn' }, x)))));
        if (changed.length) sections.push(section(t('free.changed'), h('ul', { className: 'ctm-list' }, ...changed.map(file => h('li', { key: file },
          h('button', { type: 'button', className: 'ctm-link', onClick: () => props.openFile?.(file) }, file))))));
        if (r.text) sections.push(section(t('free.result'), h('pre', { className: 'ctm-pre' }, r.text)));
      } else if (s.state === 'error') sections.push(errorBody(s, t));
      else if (s.state === 'ok') sections.push(rawBody(s, t));
      if (s.args.prompt) sections.push(section(t('free.prompt'), h('pre', { className: 'ctm-pre ctm-sub', 'data-short': '' }, s.args.prompt)));
      const body = sections.filter(Boolean);
      return h(Card, { tool: 'capability_free_task', icon: ICONS.free, title: t('free.title'), summary, state: s.state, t, inspect: props.inspect, badges, body: body.length ? body : null });
    }

    // ---------- capability_team_read / capability_team_save ----------
    function rolesGrid(roles, t) {
      return h('div', { className: 'ctm-grid3' }, ...roles.flatMap((r, i) => [
        h('div', { className: 'ctm-who', key: `n${i}` }, h('span', { className: 'ctm-name' }, r.displayName ?? r.id), h('span', { className: 'ctm-sub' }, r.id)),
        h('span', { className: 'ctm-sub', key: `c${i}` }, [r.capability, r.tier].filter(Boolean).join(' · ')),
        h('div', { className: 'ctm-who', key: `m${i}` },
          h('span', null, r.provider ? `${r.provider}/${r.model}` : t('team.unassigned')),
          Array.isArray(r.fallbacks) && r.fallbacks.length ? h('span', { className: 'ctm-sub' }, fmt(t('team.fallbacks'), { n: r.fallbacks.length })) : null),
      ]));
    }
    function teamView(kind) {
      return function TeamView(props) {
        const t = props.t;
        const s = stage(props);
        const d = s.data;
        const roles = Array.isArray(d?.roles) ? d.roles : [];
        const summary = s.state === 'error' ? firstLine(cleanError(s.output))
          : !d ? ''
          : kind === 'save' ? fmt(t('team.saved'), { rev: d.revision })
          : fmt(t('team.summary'), { name: d.effective?.name ?? '', rev: d.revision, n: roles.length });
        const sections = [];
        if (d) {
          if (roles.length) sections.push(section(t('team.roles'), rolesGrid(roles, t)));
          if (d.coolingRoutes?.length) sections.push(section(t('team.cooling'), h('div', { className: 'ctm-text ctm-warn' }, d.coolingRoutes.map(c => typeof c === 'string' ? c : JSON.stringify(c)).join('\n'))));
          if (d.project) sections.push(section(t('team.project'), h('span', { className: 'ctm-sub' }, d.project)));
        } else sections.push(errorBody(s, t) ?? rawBody(s, t));
        const body = sections.filter(Boolean);
        return h(Card, { tool: `capability_team_${kind}`, icon: ICONS.team, title: t(kind === 'save' ? 'team.saveTitle' : 'team.readTitle'), summary,
          summaryTone: kind === 'save' && d ? '' : undefined, state: s.state, t, inspect: props.inspect, body: body.length ? body : null,
          badges: kind === 'save' && d?.saved ? [badge('✓', 'success', 'ok')] : [] });
      };
    }
