// Data-driven React config panel for the AIWUK extensions (contract section E). React comes from the host module
// table and is passed in; nothing here imports a DSH client package. The browser bundle is produced by
// shared-ui/build.mjs, which strips the `export`/`import` keywords so this file shares one factory scope with
// config-logic.js. Secrets are shown as a STATE only: values are never fetched, rendered or logged, and the
// write-only input is cleared after every save attempt. Styling uses --dsw-* tokens only.
import { DESCRIBE_RETRY_DELAY_MS, buildOps, clearSecret, describeSecretsResult, fieldText, isShown, lockMode, managedConfigUrl, managedStatus, managedValueOf, manifestFromWire, secretRefs, secretState, summaryCounts, unwrapReply, validateValue, writeSecret } from './config-logic.js';

export function createPanelKit(React) {
  const h = React.createElement;
  const fmt = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, key) => values?.[key] ?? '');
  const ui = {
    col: { display: 'flex', flexDirection: 'column', gap: '8px' },
    row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '6px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' },
    text: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
    label: { color: 'var(--dsw-alias-label-primary)', fontSize: '1em' },
    muted: { color: 'var(--dsw-alias-label-secondary)', fontSize: '0.85em' },
    err: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '0.85em' },
    input: { width: '220px', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 'var(--dsw-radius-lg)', padding: '4px 8px', fontSize: '0.9em' },
    button: { color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 'var(--dsw-radius-lg)', padding: '4px 10px', fontSize: '0.9em', cursor: 'pointer' },
    primary: { color: 'var(--dsw-alias-label-primary-inverted)', background: 'var(--dsw-alias-brand-primary)', border: '1px solid var(--dsw-alias-brand-primary)' },
    badge: { borderRadius: '999px', padding: '0 8px', fontSize: '0.85em', whiteSpace: 'nowrap' },
    controls: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' },
    banner: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px 12px', borderRadius: 'var(--dsw-radius-md)', border: '1px solid var(--dsw-alias-state-success-primary)', background: 'var(--dsw-alias-state-success-tertiary, var(--dsw-alias-bg-layer-2))' },
    details: { marginTop: '4px' },
    summary: { cursor: 'pointer', color: 'var(--dsw-alias-label-secondary)', fontSize: '0.9em', padding: '6px 0' },
  };
  const badgeStyle = mode => {
    const tone = mode === 'locked' ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)';
    return { ...ui.badge, color: tone, border: `1px solid ${tone}`, background: 'var(--dsw-alias-bg-layer-2)' };
  };

  /** Re-render on a `{getSnapshot, subscribe}` store (a ConfigForm). */
  function useStoreSnapshot(store) {
    const [, redraw] = React.useState(0);
    React.useEffect(() => (typeof store?.subscribe === 'function' ? store.subscribe(() => redraw(n => n + 1)) : undefined), [store]);
    return store?.getSnapshot?.() ?? { status: 'unavailable', value: undefined, revision: undefined, writable: false };
  }

  /**
   * Fetch the values-free managed manifest. Resolves to `{manifest}` (null = the route is missing, an unmanaged
   * install) or to `undefined` when the answer is unknown (network error, 5xx): the caller then keeps what it knew,
   * so a transient failure never drops a lock.
   */
  async function fetchManifest(extension, services) {
    try {
      const fetcher = services.fetch ?? (typeof fetch === 'function' ? fetch : null);
      const res = fetcher ? await fetcher(managedConfigUrl(extension), { headers: { accept: 'application/json' } }) : null;
      if (res?.ok) return { manifest: manifestFromWire(await res.json()) };
      return res?.status === 404 ? { manifest: null } : undefined;
    } catch { return undefined; }
  }

  /**
   * The managed manifest, refreshed when a credential changes (the Connector writes managed values there) and when the
   * window regains focus. `reload()` returns the freshest known manifest so every write can re-check the lock first.
   * `services` is created once per registration (a stable object), so the callback identity does not change.
   */
  function useManifest(extension, services) {
    const [manifest, setManifest] = React.useState(null);
    const known = React.useRef(null), latest = React.useRef(0);
    const reload = React.useCallback(async () => {
      const ticket = ++latest.current;
      const answer = await fetchManifest(extension, services);
      if (answer && ticket === latest.current) { known.current = answer.manifest; setManifest(answer.manifest); }
      return answer ? answer.manifest : known.current;
    }, [extension, services]);
    React.useEffect(() => {
      void reload();
      const off = services.on?.('credentials/reference-updated', () => { void reload(); });
      const onFocus = () => { void reload(); };
      if (typeof window !== 'undefined') window.addEventListener?.('focus', onFocus);
      return () => {
        if (typeof off === 'function') off();
        if (typeof window !== 'undefined') window.removeEventListener?.('focus', onFocus);
      };
    }, [reload, services.on]);
    return [manifest, reload];
  }

  /**
   * Secret states from `credentials.describe`, refreshed on `credentials/reference-updated`. Returns
   * `[described, refresh, failed]`. Every row leaves "checking" in bounded time: a result from a superseded or
   * unmounted run is dropped (ticket), the credentials service is read at call time (never captured stale), a failed
   * run is retried once automatically, and after that `failed` is true so rows offer Retry instead of waiting forever.
   */
  function useSecretStates(services, refs) {
    const [described, setDescribed] = React.useState({});
    const [failed, setFailed] = React.useState(false);
    const key = refs.join(',');
    const ticket = React.useRef(0), alive = React.useRef(true), timer = React.useRef(null), retried = React.useRef(false), refsRef = React.useRef(refs);
    refsRef.current = refs;
    const run = React.useCallback(async () => {
      const mine = ++ticket.current;
      clearTimeout(timer.current);
      const list = refsRef.current;
      if (!list.length) return;
      const result = await describeSecretsResult(services.credentials, list);
      if (!alive.current || mine !== ticket.current) return; // stale: a newer run or an unmount took over
      if (!result.failed) { retried.current = false; setDescribed(result.described); setFailed(false); return; }
      setDescribed(prev => ({ ...prev, ...result.described }));
      if (retried.current) { setFailed(true); return; }
      retried.current = true;
      timer.current = setTimeout(() => { if (alive.current && mine === ticket.current) void run(); }, DESCRIBE_RETRY_DELAY_MS);
    }, [services]);
    const reload = React.useCallback(() => { retried.current = false; setFailed(false); return run(); }, [run]);
    React.useEffect(() => {
      alive.current = true;
      retried.current = false;
      setFailed(false);
      void run();
      const off = services.on?.('credentials/reference-updated', ref => { if (refsRef.current.includes(ref)) void run(); });
      return () => { alive.current = false; ticket.current++; clearTimeout(timer.current); if (typeof off === 'function') off(); };
    }, [key, services.credentials, run]);
    return [described, run, failed, reload];
  }

  /**
   * Switch that makes this extension the host's provider for a capability (DSH web search): it writes
   * `spec.path` on the host entry `spec.entry` through `ctx.configForms.get(entry)`, and unsets it to restore the
   * host default. The current selection is always shown.
   */
  function HostSelectionRow({ spec, services, t }) {
    const store = services.forms?.get?.(spec.entry) ?? null;
    const snapshot = useStoreSnapshot(store);
    const [note, setNote] = React.useState(null);
    const [pending, setPending] = React.useState(false);
    const ready = snapshot.status === 'ready' && snapshot.writable !== false && typeof store?.mutate === 'function';
    const current = snapshot.value?.[spec.path];
    const on = current === spec.value;
    const toggle = async next => {
      setNote(null); setPending(true);
      let ok = false;
      try { ok = await store.mutate([next ? { op: 'set', path: [spec.path], value: spec.value } : { op: 'unset', path: [spec.path] }], snapshot.revision); } catch { ok = false; }
      setPending(false); setNote(ok ? 'saved' : 'failed');
    };
    const shown = typeof current === 'string' && current ? current : t(`host.${spec.id}.auto`);
    return h(FieldRow, { id: `host.${spec.id}`, label: t(`host.${spec.id}.label`), t,
      hint: snapshot.status === 'unavailable' ? t(`host.${spec.id}.unavailable`) : `${fmt(t(`host.${spec.id}.current`), { provider: shown })} ${t(`host.${spec.id}.hint`)}`,
      error: note === 'failed' ? t(`host.${spec.id}.failed`) : undefined },
      note === 'saved' ? h('span', { role: 'status', style: ui.muted }, t('state.saved')) : null,
      h('input', { type: 'checkbox', role: 'switch', name: `host.${spec.id}`, 'data-host-selection': on ? 'on' : 'off', checked: on, disabled: !ready || pending, onChange: event => { void toggle(event.target.checked); } }));
  }

  function LockBadge({ mode, t }) {
    if (!mode || mode === 'none') return null;
    return h('span', { 'data-lock': mode, title: mode === 'locked' ? t('lock.hint') : undefined, style: badgeStyle(mode) }, t(mode === 'locked' ? 'lock.locked' : 'lock.default'));
  }

  function FieldRow({ id, label, hint, mode, error, children, t }) {
    return h('div', { 'data-field': id, style: ui.row },
      h('span', { style: ui.text }, h('span', { style: ui.label }, label), hint ? h('span', { style: ui.muted }, hint) : null, error ? h('span', { role: 'alert', style: ui.err }, error) : null),
      h('span', { style: ui.controls }, h(LockBadge, { mode, t }), children));
  }

  /** State line plus Set / Replace / Clear. The typed value lives only in this component and is dropped after save. */
  function SecretField({ field, label, info, mode, failed, t, onSet, onClear, onRetry }) {
    const [typed, setTyped] = React.useState(null); // null = input hidden
    const [confirming, setConfirming] = React.useState(false);
    const [note, setNote] = React.useState(null);
    const state = secretState(info, mode);
    const save = async () => {
      const value = typed;
      setTyped(null); // cleared first: the value is never kept after the attempt
      try { await onSet(field.ref, value); setNote('saved'); } catch { setNote('failed'); }
    };
    const clear = async () => { setConfirming(false); try { await onClear(field.ref); setNote('cleared'); } catch { setNote('failed'); } };
    const unresolved = info === undefined && mode !== 'locked';
    const phase = unresolved ? (failed ? 'failed' : 'unknown') : state.kind;
    const statusText = unresolved ? t(failed ? 'secret.failed' : 'secret.unknown')
      : state.kind === 'managed' ? t(info === undefined || state.configured ? 'secret.managedSet' : 'secret.managedEmpty') : t(`secret.${state.kind}`);
    return h(FieldRow, { id: field.id, label, mode, t, hint: note ? t(`secret.note.${note}`) : undefined },
      h('span', { 'data-secret-state': phase, style: unresolved && failed ? ui.err : ui.muted }, statusText),
      unresolved && failed ? h('button', { type: 'button', 'data-action': 'retry-secret', style: ui.button, onClick: onRetry }, t('action.retry')) : null,
      typed !== null ? h('input', { type: 'password', name: field.id, autoComplete: 'new-password', value: typed, style: ui.input, 'aria-label': label, onChange: event => setTyped(event.target.value) }) : null,
      typed !== null ? h('button', { type: 'button', 'data-action': 'save-secret', style: { ...ui.button, ...ui.primary }, disabled: !typed.trim(), onClick: save }, t('action.save')) : null,
      typed !== null ? h('button', { type: 'button', 'data-action': 'cancel-secret', style: ui.button, onClick: () => setTyped(null) }, t('action.cancel')) : null,
      typed === null && !confirming && mode !== 'locked' && state.editable ? h('button', { type: 'button', 'data-action': 'set-secret', style: ui.button, onClick: () => { setNote(null); setTyped(''); } }, t(state.configured ? 'action.replace' : 'action.set')) : null,
      typed === null && !confirming && state.clearable ? h('button', { type: 'button', 'data-action': 'clear-secret', style: ui.button, onClick: () => setConfirming(true) }, t('action.clear')) : null,
      confirming ? h('button', { type: 'button', 'data-action': 'confirm-clear', style: { ...ui.button, ...ui.primary }, onClick: clear }, t('action.confirmClear')) : null,
      confirming ? h('button', { type: 'button', 'data-action': 'cancel-clear', style: ui.button, onClick: () => setConfirming(false) }, t('action.cancel')) : null);
  }

  function control({ field, value, readOnly, mode, onChange, t }) {
    const common = { name: field.id, disabled: readOnly, readOnly };
    if (field.kind === 'switch') return h('input', { ...common, type: 'checkbox', role: 'switch', checked: value === true, onChange: event => onChange(event.target.checked) });
    if (field.kind === 'enum' && field.multiple) {
      const chosen = Array.isArray(value) ? value : String(value ?? '').split(',').filter(Boolean);
      return h('span', { style: ui.controls }, field.options.map(option => h('label', { key: option, style: ui.muted },
        h('input', { type: 'checkbox', name: `${field.id}.${option}`, disabled: readOnly, checked: chosen.includes(option),
          onChange: event => onChange(event.target.checked ? [...chosen, option] : chosen.filter(v => v !== option)) }), ` ${t(`opt.${option}`)}`)));
    }
    if (field.kind === 'enum') return h('select', { ...common, value: value ?? '', style: ui.input, onChange: event => onChange(event.target.value) },
      h('option', { value: '' }, t('opt.default')), field.options.map(option => h('option', { key: option, value: option }, t(`opt.${option}`))));
    const props = { ...common, style: ui.input, value: value ?? '', title: readOnly && value ? String(value) : undefined, placeholder: mode === 'locked' ? t('value.managed') : mode === 'default' ? t('value.default') : undefined, onChange: event => onChange(event.target.value) };
    return field.kind === 'number' ? h('input', { ...props, type: 'number', min: field.min, max: field.max, step: field.step }) : h('input', { ...props, type: field.kind === 'url' ? 'url' : 'text' });
  }

  /** "Configured by the Mothership" notice: shown when the Mothership manages any integration field of this panel. */
  function ManagedBanner({ status, t }) {
    if (status.mode === 'none') return null;
    return h('div', { 'data-managed-banner': status.mode, role: 'note', style: ui.banner },
      h('span', { style: { ...ui.label, fontWeight: 600 } }, t(status.mode === 'full' ? 'banner.full' : 'banner.partial')),
      h('span', { style: ui.muted }, fmt(t('banner.detail'), status)));
  }

  function ConfigPanel(props) {
    const { panel, view, services, t } = props;
    const store = props.form ? null : (services.forms?.get?.(panel.namespace) ?? null);
    const live = useStoreSnapshot(store);
    const snapshot = props.form ? props.form.state : live;
    const mutate = props.form ? props.form.mutate : store?.mutate?.bind(store);
    const [manifest, reloadManifest] = useManifest(panel.extension, services);
    const [described, refresh, describeFailed, retryDescribe] = useSecretStates(services, secretRefs(panel.fields));
    // Every write re-reads the lock first: a Mothership lock applied while this page is open must win.
    const freshMode = async ref => lockMode(await reloadManifest(), ref);
    const [drafts, setDrafts] = React.useState({});
    const [result, setResult] = React.useState(null);
    const values = snapshot?.value ?? {};
    const states = Object.fromEntries(Object.entries(described).map(([ref, info]) => [ref, secretState(info, lockMode(manifest, ref))]));
    if (view === 'summary') {
      const c = summaryCounts(panel.fields, values, states, manifest);
      return `${fmt(t('summary.configured'), c)}${c.managed ? ` · ${fmt(t('summary.managed'), c)}` : ''}`;
    }
    const ready = snapshot?.status === 'ready';
    const readOnly = !ready || snapshot.writable === false || typeof mutate !== 'function';
    const current = { ...values, ...drafts };
    const { ops, invalid } = buildOps(panel.fields, values, drafts, manifest);
    const save = async () => {
      let ok = false;
      try {
        // Rebuild the ops against the fresh manifest so a newly locked field is dropped, not written.
        const fresh = buildOps(panel.fields, values, drafts, await reloadManifest());
        ok = fresh.ops.length > 0 && Object.keys(fresh.invalid).length === 0 && await mutate(fresh.ops, snapshot.revision);
      } catch { ok = false; }
      setResult(ok ? 'saved' : 'failed');
      if (ok) setDrafts({});
    };
    const labelOf = field => t(field.ref ? `ref.${field.ref}` : `field.${field.id}`);
    const status = managedStatus(panel.fields, manifest);
    // A locked Mothership value also decides which dependent rows show (e.g. provider/model under a fixed route).
    const effective = { ...current };
    for (const field of panel.fields) {
      const fromHub = managedValueOf(manifest, field.ref);
      if (field.path && fromHub !== undefined && lockMode(manifest, field.ref) === 'locked' && !Object.hasOwn(drafts, field.id)) effective[field.path] = fromHub;
    }
    const visible = panel.fields.filter(field => isShown(field, effective));
    // Once the Mothership configures this extension, integration fields it does not send are optional extras.
    const isOptional = field => status.mode !== 'none' && field.ref && lockMode(manifest, field.ref) === 'none';
    const main = visible.filter(field => !isOptional(field)), optional = visible.filter(isOptional);
    const renderField = field => {
      const mode = lockMode(manifest, field.ref);
      if (field.kind === 'secret') {
        return h(SecretField, { key: field.id, field, label: labelOf(field), info: described[field.ref], mode, failed: describeFailed, t, onRetry: retryDescribe,
          onSet: async (ref, value) => { await writeSecret(services.credentials, ref, value, await freshMode(ref)); await refresh(); },
          onClear: async ref => { await clearSecret(services.credentials, ref, await freshMode(ref)); await refresh(); } });
      }
      const fromHub = managedValueOf(manifest, field.ref);
      const shown = Object.hasOwn(drafts, field.id) ? drafts[field.id] : field.kind === 'switch' ? values[field.path]
        : mode === 'locked' ? (fromHub === undefined ? '' : field.multiple ? fromHub.split(',').map(v => v.trim()).filter(Boolean) : fromHub)
          : field.multiple ? values[field.path] : fieldText(field, values[field.path]);
      return h(FieldRow, { key: field.id, id: field.id, label: labelOf(field), mode, t, error: invalid[field.id] ? t(`err.${invalid[field.id]}`) : undefined },
        control({ field, value: shown, readOnly: readOnly || mode === 'locked', mode, t, onChange: next => { setResult(null); setDrafts(prev => ({ ...prev, [field.id]: next })); } }));
    };
    return h('div', { 'data-config-panel': panel.extension, style: ui.col },
      panel.hostSelection && view !== 'summary' ? h(HostSelectionRow, { spec: panel.hostSelection, services, t }) : null,
      !ready ? h('p', { style: ui.muted, 'data-unavailable': snapshot?.status === 'unavailable' ? '' : undefined }, t(snapshot?.status === 'loading' ? 'state.loading' : 'state.unavailable')) : null,
      h(ManagedBanner, { status, t }),
      main.map(renderField),
      optional.length ? h('details', { 'data-optional-fields': '', style: ui.details },
        h('summary', { style: ui.summary }, fmt(t('optional.title'), { count: optional.length })),
        h('p', { style: ui.muted }, t('optional.hint')),
        optional.map(renderField)) : null,
      panel.fields.some(field => field.kind !== 'secret') ? h('div', { style: ui.controls },
        result ? h('span', { role: 'status', style: result === 'saved' ? ui.muted : ui.err }, t(`state.${result}`)) : null,
        h('button', { type: 'button', 'data-action': 'save', style: { ...ui.button, ...ui.primary }, disabled: readOnly || !ops.length || Object.keys(invalid).length > 0, onClick: save }, t('action.save'))) : null);
  }

  /** Team bundle entry: how many settings the Mothership manages, with a pointer to the Memory and Search pages. */
  function IntegrationsSummary({ view, services, t }) {
    const [manifest] = useManifest('team', services);
    const count = manifest ? manifest.entries.size : 0;
    const line = count ? fmt(t('team.managedCount'), { count }) : t('team.unmanaged');
    if (view === 'summary') return `${t('team.integrations')}: ${line}`;
    return h('div', { 'data-integrations-summary': '', style: ui.col },
      h('span', { style: ui.label }, t('team.integrations')), h('span', { style: ui.muted }, line), h('span', { style: ui.muted }, t('team.hint')));
  }

  /** Contract entry point: the element for one bundle's `plugins.bundle.config` slot. */
  function renderConfigPanel({ services, panel, view, form, t }) {
    return h(ConfigPanel, { services, panel, view, form, t });
  }

  /**
   * Register dictionaries and the `plugins.bundle.config` slot entry of one panel. The host services
   * (`remote.credentials`, `configForms`) come from the plugin's static `inject` list; null checks keep a
   * test or odd host mounting (non-secret fields then read-only).
   */
  function registerConfigPanel(ctx, { panel, ns, dictionaries, summaryOnly = false }) {
    const services = { credentials: null, on: null, forms: null };
    // A summary-only entry reuses the host plugin's own namespace (its dictionaries are merged by the caller).
    if (!summaryOnly) ctx.effect?.(() => ctx.locale.register(ns, dictionaries), `${ns}: dictionaries`);
    // The plugin declares `remote.credentials` and `configForms` statically in its `inject` list (a dynamic
    // ctx.inject callback never fired in the real host), so both are read directly from the context here.
    const remote = ctx.remote;
    if (remote?.credentials) {
      services.credentials = remote.credentials;
      services.on = typeof remote.$on === 'function' ? (event, listener) => remote.$on(event, listener) : null;
    }
    if (ctx.configForms) services.forms = ctx.configForms;
    if (!summaryOnly) ctx.effect?.(() => () => { services.credentials = null; services.on = null; services.forms = null; }, `${ns}: services`);
    const t = ctx.locale.bind(ns);
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: panel.bundle, locale: ns },
      props => (summaryOnly ? h(IntegrationsSummary, { view: props?.view, services, t: props?.t ?? t })
        : renderConfigPanel({ services, panel, view: props?.view, form: props?.form, t: props?.t ?? t }))));
    return services;
  }

  return { IntegrationsSummary, ConfigPanel, FieldRow, SecretField, LockBadge, renderConfigPanel, registerConfigPanel, useManifest, unwrapReply, validateValue };
}
