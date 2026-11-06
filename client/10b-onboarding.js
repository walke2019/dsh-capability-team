    // ---------- onboarding: official Agent Teams bundle, model coverage, first team session; ----------
    const AGENT_TEAM_BUNDLE = '@deepseek-ai/dsh-experimental-agent-team-profile';
    const WELCOME_VERSION = '4.0.0';
    const UI_NAMESPACE = 'capability-team-ui'; // this package's row id in cordis.patch.yml; its volatile Config keeps the welcome acknowledgement
    // Texts of the integrations summary (shared panel dictionaries) join this namespace; nothing else is needed.
    for (const [lang, target] of [['zh', zh], ['en', en]]) {
      for (const [key, text] of Object.entries(aiwukConfig.panelDictionaries(aiwukConfig.PANELS.team)[lang])) if (/^(team\.(integrations|hint|unmanaged|managedCount)|lock\.|value\.)/.test(key)) target[key] = text;
    }
    Object.assign(zh, {
      'onb.title': '能力协作团队：三步开始', 'onb.step1': '1. 启用官方 Agent Teams', 'onb.step2': '2. 模型档位匹配', 'onb.step3': '3. 开始第一个团队任务',
      'onb.teamReady': '官方 Agent Teams 服务已运行。',
      'onb.teamMissing': '能力协作团队建立在官方实验包 {name} 之上；它当前未启用，团队功能不会启动。',
      'onb.teamWarning': '注意：启用后对本配置档（profile）中的所有会话生效，并停用原生的通用子代理工具（subagent / fork 等），改由团队工具委派。只有你点击下方按钮才会启用。',
      'onb.enable': '启用 Agent Teams', 'onb.enabling': '正在启用…', 'onb.applied': '已启用并生效。请刷新页面后新建会话。',
      'onb.restart': '已启用，需要重启 DSH 后生效（原因：{reason}）。', 'onb.failed': '启用失败，错误码：{code}。也可在“插件”页手动启用。',
      'onb.noManager': '当前连接不能管理插件；请在侧栏“插件”页手动启用 {name}。',
      'onb.coverage': '{covered}/{total} 项能力已在你的模型目录中匹配到合格档位（共 {models} 个模型）。', 'onb.coverageUnknown': '模型目录暂不可读；稍后在团队总览中查看。',
      'onb.unassigned': '未匹配：{list}。这些角色的请求会被阻止；可补充渠道，或让主控开启单模型模式（需你确认）。',
      'onb.newSession': '新建会话 → 在模式选择中选择“能力协作团队”，然后直接描述任务。', 'onb.dismiss': '知道了', 'onb.later': '稍后',
      'roles.singleModel': '单模型模式', 'roles.singleModelHint': '未分配模型的角色统一使用你确认的单个模型；无备选，失败直接报告。',
    });
    Object.assign(en, {
      'onb.title': 'Capability Team: three steps', 'onb.step1': '1. Enable official Agent Teams', 'onb.step2': '2. Model tier coverage', 'onb.step3': '3. Run the first team task',
      'onb.teamReady': 'The official Agent Teams service is running.',
      'onb.teamMissing': 'Capability Team builds on the official experimental bundle {name}; it is not enabled, so the team cannot start.',
      'onb.teamWarning': 'Note: enabling it affects every session in this profile and disables the native generic subagent tools (subagent / fork); delegation then uses the team tools. Nothing changes until you click the button.',
      'onb.enable': 'Enable Agent Teams', 'onb.enabling': 'Enabling…', 'onb.applied': 'Enabled and applied. Reload the page, then start a new session.',
      'onb.restart': 'Enabled; restart DSH for it to take effect (reason: {reason}).', 'onb.failed': 'Enabling failed, error code: {code}. You can also enable it on the Plugins page.',
      'onb.noManager': 'This connection cannot manage plugins; enable {name} on the Plugins page.',
      'onb.coverage': '{covered}/{total} capabilities matched a qualified tier in your model catalog ({models} models).', 'onb.coverageUnknown': 'The model catalog is not readable yet; check the team overview later.',
      'onb.unassigned': 'Unmatched: {list}. Requests of these roles are blocked; add a channel, or ask the Lead to enable single-model mode (you confirm it).',
      'onb.newSession': 'New session → choose "Capability Team" in the mode picker, then describe your task.', 'onb.dismiss': 'Got it', 'onb.later': 'Later',
      'roles.singleModel': 'Single-model mode', 'roles.singleModelHint': 'Roles without an assigned model use the one model you confirmed; no backups, failures surface.',
    });
    async function fetchOnboarding(signal) {
      const res = await fetch(apiUrl('api/capability-team.onboarding'), { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }
    /** Map a pluginManager ChangeResult (Remote reply `{ok, value}` or a bare value) to what the card shows. */
    function enableOutcome(reply) {
      if (reply && reply.ok === false) return { kind: 'failed', code: String(reply.error?.code ?? reply.error?.message ?? 'remote-error') };
      const value = reply && reply.ok === true ? reply.value : reply;
      if (value?.application === 'applied') return { kind: 'applied' };
      if (value?.application === 'restart-required') return { kind: 'restart', reason: String(value.restartReason ?? '') };
      return { kind: 'failed', code: String(value?.error?.code ?? (value?.application === 'cancelled' ? 'cancelled' : 'unknown-result')) };
    }
    /** Enable the official bundle only after a user click: confirm it is listed, then select it. */
    async function enableAgentTeams(pluginManager) {
      if (!pluginManager) return { kind: 'failed', code: 'no-plugin-manager' };
      try {
        const listed = await pluginManager.listBundles();
        const rows = listed?.ok === true ? listed.value : Array.isArray(listed) ? listed : null;
        if (!rows) return enableOutcome(listed);
        const row = rows.find(b => b?.name === AGENT_TEAM_BUNDLE);
        if (!row || row.availability === 'missing') return { kind: 'failed', code: 'not-installed' };
        return enableOutcome(await pluginManager.setBundleEnabled(AGENT_TEAM_BUNDLE, true));
      } catch (error) { return { kind: 'failed', code: String(error?.code ?? error?.message ?? error) }; }
    }
    function OnboardingCard({ status, enable, t, onDismiss, dismissLabel }) {
      const [outcome, setOutcome] = React.useState(null);
      const pending = outcome?.kind === 'pending';
      const click = async () => { setOutcome({ kind: 'pending' }); setOutcome(await enable()); };
      const cov = status?.coverage;
      const outcomeText = !outcome || pending ? null : outcome.kind === 'applied' ? t('onb.applied')
        : outcome.kind === 'restart' ? fmt(t('onb.restart'), { reason: outcome.reason || '-' }) : fmt(t('onb.failed'), { code: outcome.code });
      return h('div', { className: 'ctm-ov-callout', 'data-tone': status?.teamServicePresent ? undefined : 'warn', 'data-onboarding': '' },
        h('span', { className: 'ctm-name' }, t('onb.title')),
        h('span', { className: 'ctm-label' }, t('onb.step1')),
        status?.teamServicePresent ? h('span', { className: 'ctm-sub', 'data-step': 'team-ready' }, `✓ ${t('onb.teamReady')}`) : h('div', { 'data-step': 'team-missing' },
          h('p', { className: 'ctm-sub' }, fmt(t('onb.teamMissing'), { name: AGENT_TEAM_BUNDLE })),
          h('p', { className: 'ctm-sub ctm-warn', 'data-warning': '' }, t('onb.teamWarning')),
          enable ? h('button', { type: 'button', className: 'ctm-btn', 'data-primary': '', 'data-action': 'enable-agent-teams', disabled: pending || outcome?.kind === 'applied' || outcome?.kind === 'restart', onClick: click },
            t(pending ? 'onb.enabling' : 'onb.enable')) : h('p', { className: 'ctm-sub' }, fmt(t('onb.noManager'), { name: AGENT_TEAM_BUNDLE })),
          outcomeText ? h('p', { className: outcome.kind === 'failed' ? 'ctm-sub ctm-error' : 'ctm-sub', role: 'status', 'data-outcome': outcome.kind }, outcomeText) : null),
        h('span', { className: 'ctm-label' }, t('onb.step2')),
        cov?.known ? h('span', { className: 'ctm-sub', 'data-step': 'coverage' }, fmt(t('onb.coverage'), { covered: cov.covered, total: cov.capabilities, models: cov.models })) : h('span', { className: 'ctm-sub' }, t('onb.coverageUnknown')),
        cov?.unassigned?.length ? h('span', { className: 'ctm-sub ctm-warn' }, fmt(t('onb.unassigned'), { list: cov.unassigned.join(t('common.listSep')) })) : null,
        h('span', { className: 'ctm-label' }, t('onb.step3')),
        h('span', { className: 'ctm-sub' }, t('onb.newSession')),
        onDismiss ? h('button', { type: 'button', className: 'ctm-btn', 'data-action': 'dismiss', onClick: onDismiss }, dismissLabel ?? t('onb.dismiss')) : null);
    }
    /** Re-render on a store's changes (ConfigForm and similar `{getSnapshot, subscribe}` stores). */
    function useStoreSnapshot(store) {
      const [, redraw] = React.useState(0);
      React.useEffect(() => (typeof store?.subscribe === 'function' ? store.subscribe(() => redraw(n => n + 1)) : undefined), [store]);
      return store?.getSnapshot?.() ?? { status: 'unavailable' };
    }
    /** Read the onboarding status once per mount. */
    function useOnboardingStatus(fetchStatus) {
      const [status, setStatus] = React.useState(null);
      const started = React.useRef(false);
      React.useEffect(() => {
        if (started.current || !fetchStatus) return;
        started.current = true;
        fetchStatus().then(setStatus, () => setStatus({ unavailable: true }));
      }, [fetchStatus]);
      return status;
    }
    /** Overview banner: shown only while the official team service is missing. */
    function OnboardingGate({ t, enable, fetchStatus }) {
      const status = useOnboardingStatus(fetchStatus);
      if (!status || status.unavailable || status.teamServicePresent !== false) return null;
      return h('div', { style: { margin: '12px 16px 0' } }, h(OnboardingCard, { status, enable, t }));
    }
    /** settings.onboarding step: once per WELCOME_VERSION, acknowledged through this package's volatile Config. */
    function WelcomeStep({ complete, explicit, form, t, enable, fetchStatus }) {
      const snapshot = useStoreSnapshot(form);
      const status = useOnboardingStatus(fetchStatus);
      const acknowledged = snapshot.status === 'ready' && snapshot.value?.welcomeVersion === WELCOME_VERSION;
      React.useEffect(() => { if (acknowledged && !explicit) complete?.(); }, [acknowledged, explicit]);
      if (snapshot.status === 'loading' || !status || (acknowledged && !explicit)) return null;
      const dismiss = async () => { if (snapshot.status === 'ready' && snapshot.writable !== false) { try { await form.set('welcomeVersion', WELCOME_VERSION); } catch { /* in-memory completion still applies */ } } complete?.(); };
      return h('div', { role: 'dialog', 'aria-modal': 'true', className: 'ctm-onb-modal', style: { position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.35)' } },
        h('div', { style: { maxWidth: '520px', width: 'calc(100% - 48px)', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: '12px', padding: '16px' } },
          h(OnboardingCard, { status, enable, t, onDismiss: dismiss })));
    }
    /** Optional host services are reached through ctx.inject, so a host without them still mounts the plugin. */
    function registerOnboarding(ctx, t) {
      let pluginManager = null;
      ctx.inject?.(['remote.pluginManager'], scoped => { pluginManager = scoped.remote.pluginManager; scoped.effect?.(() => () => { pluginManager = null; }); });
      const enable = () => enableAgentTeams(pluginManager);
      const gate = props => h(OnboardingGate, { t: props?.t ?? t, enable, fetchStatus: fetchOnboarding });
      ctx.slots.inject('plugins.bundle.activation', () => ctx.slots.register({ name: 'plugins.bundle.activation', key: '@aiwuk/team', locale: NS },
        props => h(OnboardingCard, { status: null, enable, t, onDismiss: props.onDismiss, dismissLabel: t('onb.later') })));
      ctx.inject?.(['configForms', 'slots'], scoped => {
        const forms = scoped.configForms;
        scoped.slots.inject('settings.onboarding', () => scoped.slots.register({ name: 'settings.onboarding', id: 'capability-team-welcome', order: 50, label: () => t('onb.title'), locale: NS },
          props => h(WelcomeStep, { ...props, t, enable, fetchStatus: fetchOnboarding, form: forms.get(UI_NAMESPACE) })));
      });
      // Integrations summary for this bundle's Plugins page; the Memory and Search panels ship in their own bundles.
      aiwukConfig.createPanelKit(React).registerConfigPanel(ctx, { panel: aiwukConfig.PANELS.team, ns: NS, summaryOnly: true });
      return gate;
    }
