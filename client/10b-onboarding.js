    // ---------- onboarding: official Agent Teams bundle, model coverage, first team session; bundle settings forms ----------
    const AGENT_TEAM_BUNDLE = '@deepseek-ai/dsh-experimental-agent-team-profile';
    const WELCOME_VERSION = '4.0.0';
    const UI_NAMESPACE = 'capability-team-ui'; // this package's row id in cordis.patch.yml; its volatile Config keeps the welcome acknowledgement
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
      'cfg.hint': '留空 = 沿用 integrations.json / 环境变量 / DSH 凭据。*KeyEnv 字段填写 DSH 凭据或环境变量的名称，不填写密钥本身。',
      'cfg.save': '保存', 'cfg.saved': '已保存，下一次请求起生效。', 'cfg.saveFailed': '保存失败，请刷新后重试。', 'cfg.unavailable': '该插件未运行或当前连接不可编辑设置。', 'cfg.loading': '读取中…',
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
      'cfg.hint': 'Empty = keep integrations.json / environment / DSH credentials. *KeyEnv fields take the NAME of a DSH credential or environment variable, never the key itself.',
      'cfg.save': 'Save', 'cfg.saved': 'Saved; applies from the next request.', 'cfg.saveFailed': 'Save failed; reload and retry.', 'cfg.unavailable': 'The plugin is not running or settings are read-only here.', 'cfg.loading': 'Loading…',
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
      return h('div', { role: 'dialog', 'aria-modal': 'true', className: 'ctm-onb-modal', style: { position: 'fixed', inset: 0, zIndex: 'var(--aw-z-modal)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--dsw-alias-bg-mask-2)' } },
        h('div', { style: { maxWidth: '520px', width: 'calc(100% - 48px)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', borderRadius: 'var(--dsw-radius-lg)', boxShadow: 'var(--dsw-shadow-lv3)', padding: '16px' } },
          h(OnboardingCard, { status, enable, t, onDismiss: dismiss })));
    }
    // Settings forms for the standalone bundles, rendered from this client (they ship no client half of their own).
    const OMNI_FIELDS = [['engines', 'list'], ['fetchEngines', 'list'], ['searxngUrl'], ['baseUrl'], ['tavilyKeyEnv'], ['braveKeyEnv'], ['searxngKeyEnv'], ['jinaKeyEnv'], ['apiKeyEnv'], ['audioBaseUrl'], ['audioKeyEnv']];
    const MEMORY_FIELDS = [['memoryBackend'], ['memoryUrl'], ['memoryKeyEnv'], ['embeddingBaseUrl'], ['embeddingModel'], ['embeddingKeyEnv']];
    const fieldText = (value, kind) => (value === undefined || value === null ? '' : kind === 'list' && Array.isArray(value) ? value.join(', ') : String(value));
    /** Edit ops for the changed fields: empty clears the field (the layers below apply again). */
    function settingsOps(fields, value, draft) {
      const ops = [];
      for (const [key, kind] of fields) {
        if (!Object.hasOwn(draft, key) || draft[key] === fieldText(value?.[key], kind)) continue;
        const raw = draft[key].trim();
        if (!raw) ops.push({ op: 'unset', path: [key] });
        else ops.push({ op: 'set', path: [key], value: kind === 'list' ? raw.split(',').map(v => v.trim()).filter(Boolean) : raw });
      }
      return ops;
    }
    function BundleSettingsCard({ view, form, fields, t }) {
      const snapshot = useStoreSnapshot(form);
      const [draft, setDraft] = React.useState({});
      const [result, setResult] = React.useState(null);
      if (view === 'summary') return t('cfg.hint');
      if (snapshot.status === 'loading') return h('p', { className: 'ctm-sub' }, t('cfg.loading'));
      if (snapshot.status !== 'ready') return h('p', { className: 'ctm-sub', 'data-unavailable': '' }, t('cfg.unavailable'));
      const ops = settingsOps(fields, snapshot.value, draft);
      const save = async () => { const ok = await form.mutate(ops, snapshot.revision); setResult(ok ? 'saved' : 'failed'); if (ok) setDraft({}); };
      return h('div', { className: 'ctm-ov-block', 'data-bundle-settings': '' },
        h('p', { className: 'ctm-sub' }, t('cfg.hint')),
        ...fields.map(([key, kind]) => h('label', { key, className: 'ctm-sub', style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, key,
          h('input', { type: 'text', name: key, disabled: snapshot.writable === false, value: Object.hasOwn(draft, key) ? draft[key] : fieldText(snapshot.value?.[key], kind),
            onChange: event => setDraft(prev => ({ ...prev, [key]: event.target.value })) }))),
        h('button', { type: 'button', className: 'ctm-btn', 'data-primary': '', disabled: !ops.length || snapshot.writable === false, onClick: save }, t('cfg.save')),
        result ? h('p', { className: result === 'saved' ? 'ctm-sub' : 'ctm-sub ctm-error', role: 'status' }, t(result === 'saved' ? 'cfg.saved' : 'cfg.saveFailed')) : null);
    }
    /** Optional host services are reached through ctx.inject, so a host without them still mounts the plugin. */
    function registerOnboarding(ctx, t) {
      let pluginManager = null;
      ctx.inject?.(['remote.pluginManager'], scoped => { pluginManager = scoped.remote.pluginManager; scoped.effect?.(() => () => { pluginManager = null; }); });
      const enable = () => enableAgentTeams(pluginManager);
      const gate = props => h(OnboardingGate, { t: props?.t ?? t, enable, fetchStatus: fetchOnboarding });
      ctx.slots.inject('plugins.bundle.activation', () => ctx.slots.register({ name: 'plugins.bundle.activation', key: 'dsh-capability-team', locale: NS },
        props => h(OnboardingCard, { status: null, enable, t, onDismiss: props.onDismiss, dismissLabel: t('onb.later') })));
      ctx.inject?.(['configForms', 'slots'], scoped => {
        const forms = scoped.configForms;
        scoped.slots.inject('settings.onboarding', () => scoped.slots.register({ name: 'settings.onboarding', id: 'capability-team-welcome', order: 50, label: () => t('onb.title'), locale: NS },
          props => h(WelcomeStep, { ...props, t, enable, fetchStatus: fetchOnboarding, form: forms.get(UI_NAMESPACE) })));
        for (const [key, ns, fields] of [['dsh-omni-search', 'omni-search', OMNI_FIELDS], ['dsh-capability-memory', 'global-memory', MEMORY_FIELDS]]) {
          scoped.slots.inject('plugins.bundle.config', () => scoped.slots.register({ name: 'plugins.bundle.config', key, locale: NS },
            props => h(BundleSettingsCard, { view: props?.view, form: forms.get(ns), fields, t })));
        }
      });
      return gate;
    }
