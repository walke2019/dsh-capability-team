// Data-driven React config panel for the AIWUK extensions (contract section E). React comes from the host module
// table and is passed in; nothing here imports a DSH client package. The browser bundle is produced by
// shared-ui/build.mjs, which strips the `export`/`import` keywords so this file shares one factory scope with
// config-logic.js. Secrets are shown as a STATE only: values are never fetched, rendered or logged, and the
// write-only input is cleared after every save attempt. Styling uses --dsw-* tokens only.
import { buildOps, clearSecret, describeSecrets, fieldText, isShown, lockMode, managedConfigUrl, manifestFromWire, secretRefs, secretState, summaryCounts, unwrapReply, validateValue, writeSecret } from './config-logic.js';

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

  /** Secret states from `credentials.describe`, refreshed on `credentials/reference-updated`. */
  function useSecretStates(services, refs) {
    const [described, setDescribed] = React.useState({});
    const key = refs.join(',');
    const refresh = React.useRef(null);
    refresh.current = async () => { if (services.credentials && refs.length) setDescribed(await describeSecrets(services.credentials, refs)); };
    React.useEffect(() => {
      void refresh.current();
      const off = services.on?.('credentials/reference-updated', ref => { if (refs.includes(ref)) void refresh.current(); });
      return typeof off === 'function' ? off : undefined;
    }, [key, services.credentials]);
    return [described, () => refresh.current()];
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
  function SecretField({ field, label, info, mode, t, onSet, onClear }) {
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
    const statusText = info === undefined && mode !== 'locked' ? t('secret.unknown') : t(`secret.${state.kind}`);
    return h(FieldRow, { id: field.id, label, mode, t, hint: note ? t(`secret.note.${note}`) : undefined },
      h('span', { 'data-secret-state': info === undefined && mode !== 'locked' ? 'unknown' : state.kind, style: ui.muted }, statusText),
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
    const props = { ...common, style: ui.input, value: value ?? '', placeholder: mode === 'locked' ? t('value.managed') : mode === 'default' ? t('value.default') : undefined, onChange: event => onChange(event.target.value) };
    return field.kind === 'number' ? h('input', { ...props, type: 'number', min: field.min, max: field.max, step: field.step }) : h('input', { ...props, type: field.kind === 'url' ? 'url' : 'text' });
  }

  function ConfigPanel(props) {
    const { panel, view, services, t } = props;
    const store = props.form ? null : (services.forms?.get?.(panel.namespace) ?? null);
    const live = useStoreSnapshot(store);
    const snapshot = props.form ? props.form.state : live;
    const mutate = props.form ? props.form.mutate : store?.mutate?.bind(store);
    const [manifest, reloadManifest] = useManifest(panel.extension, services);
    const [described, refresh] = useSecretStates(services, secretRefs(panel.fields));
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
    return h('div', { 'data-config-panel': panel.extension, style: ui.col },
      !ready ? h('p', { style: ui.muted, 'data-unavailable': snapshot?.status === 'unavailable' ? '' : undefined }, t(snapshot?.status === 'loading' ? 'state.loading' : 'state.unavailable')) : null,
      panel.fields.filter(field => isShown(field, current)).map(field => {
        const mode = lockMode(manifest, field.ref);
        if (field.kind === 'secret') {
          return h(SecretField, { key: field.id, field, label: labelOf(field), info: described[field.ref], mode, t,
            onSet: async (ref, value) => { await writeSecret(services.credentials, ref, value, await freshMode(ref)); await refresh(); },
            onClear: async ref => { await clearSecret(services.credentials, ref, await freshMode(ref)); await refresh(); } });
        }
        const shown = Object.hasOwn(drafts, field.id) ? drafts[field.id] : field.kind === 'switch' ? values[field.path] : mode === 'locked' ? '' : field.multiple ? values[field.path] : fieldText(field, values[field.path]);
        return h(FieldRow, { key: field.id, id: field.id, label: labelOf(field), mode, t, error: invalid[field.id] ? t(`err.${invalid[field.id]}`) : undefined },
          control({ field, value: shown, readOnly: readOnly || mode === 'locked', mode, t, onChange: next => { setResult(null); setDrafts(prev => ({ ...prev, [field.id]: next })); } }));
      }),
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
