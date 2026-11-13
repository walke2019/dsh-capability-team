// Server text uses the host's explicit locale preference, with an environment override.
import en from './i18n/server.en.json' with { type: 'json' };
import zh from './i18n/server.zh.json' with { type: 'json' };
import rolesEn from './i18n/roles.en.json' with { type: 'json' };
import rolesZh from './i18n/roles.zh.json' with { type: 'json' };
const dictionaries = { en, zh };
const roles = { en: rolesEn, zh: rolesZh };
const snapshots = new WeakMap();
const bindings = new Set();
let hostSettings;
export const normalizeLocale = value => /^zh(?:[-_]|$)/i.test(String(value ?? '')) ? 'zh' : 'en';
// Cordis exports this original-identity symbol; unwrap only cache keys, never service calls.
const serviceKey = settings => settings?.[Symbol.for('cordis.original')] ?? settings;
const snapshot = settings => {
  const key = serviceKey(settings);
  if (!key || !['object', 'function'].includes(typeof key)) return;
  let state = snapshots.get(key);
  if (!state) {
    state = { language: 'en', initialized: false, reading: false, queued: false, bindings: new Set() };
    snapshots.set(key, state);
  }
  return state;
};
function refresh(settings, state) {
  if (state.reading) return;
  state.reading = true;
  state.initialized = true;
  try {
    const rows = settings.describe?.({ redactSecrets: true }) ?? [];
    state.language = normalizeLocale(rows.find(row => row.ns === 'locale')?.value?.preference);
  } catch { state.language = 'en'; }
  finally { state.reading = false; }
}
/** Bind only the public, optional settings service; share one snapshot across scopes. */
export function configureI18n(ctx) {
  ctx.inject?.(['settings'], scoped => {
    const settings = scoped.settings, state = snapshot(settings);
    if (!state) return;
    const binding = { settings };
    let live = true;
    bindings.add(binding);
    hostSettings = settings;
    state.bindings.add(binding);
    const stop = scoped.on?.('settings/document-updated', ns => {
      if (!live || ns !== 'locale' || state.reading || state.queued) return;
      state.queued = true;
      queueMicrotask(() => {
        state.queued = false;
        const active = [...state.bindings].at(-1);
        if (active && snapshots.get(serviceKey(active.settings)) === state) refresh(active.settings, state);
      });
    });
    if (!state.initialized) refresh(settings, state);
    scoped.effect?.(() => () => {
      if (!live) return;
      live = false;
      stop?.();
      bindings.delete(binding);
      state.bindings.delete(binding);
      if (state.bindings.size === 0) snapshots.delete(serviceKey(settings));
      hostSettings = [...bindings].at(-1)?.settings;
    });
  });
}
/** Explicit unbound settings handles are cached snapshots, without live subscriptions. */
export function locale({ env = process.env, settings = hostSettings } = {}) {
  if (env.AIWUK_LOCALE) return normalizeLocale(env.AIWUK_LOCALE);
  const state = snapshot(settings);
  if (!state) return 'en';
  if (!state.initialized) refresh(settings, state);
  return state.language;
}
const interpolate = (text, vars) => text.replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(vars, key) ? String(vars[key]) : match);
/** Translate user-visible text. Unknown keys remain visible for diagnostics. */
export function t(key, vars = {}, language = locale()) {
  return interpolate(dictionaries[normalizeLocale(language)][key] ?? dictionaries.en[key] ?? key, vars);
}
/** Tool descriptions, errors and model instructions are always English. */
export const m = (key, vars = {}) => t(key, vars, 'en');
/** Role/persona data is distinct from user-interface text. */
export function roleText(key, vars = {}, language = locale()) {
  return interpolate(roles[normalizeLocale(language)][key] ?? roles.en[key] ?? key, vars);
}
