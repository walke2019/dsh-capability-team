// Server text uses the host's explicit locale preference, with an environment override.
import en from './i18n/server.en.json' with { type: 'json' };
import zh from './i18n/server.zh.json' with { type: 'json' };
import rolesEn from './i18n/roles.en.json' with { type: 'json' };
import rolesZh from './i18n/roles.zh.json' with { type: 'json' };
const dictionaries = { en, zh };
const roles = { en: rolesEn, zh: rolesZh };
let hostSettings;
export const normalizeLocale = value => /^zh(?:[-_]|$)/i.test(String(value ?? '')) ? 'zh' : 'en';
/** Bind only the public, optional DSH settings service; read preferences live. */
export function configureI18n(ctx) {
  ctx.inject?.(['settings'], scoped => {
    hostSettings = scoped.settings;
    scoped.effect?.(() => () => { if (hostSettings === scoped.settings) hostSettings = undefined; });
  });
}
export function locale({ env = process.env, settings = hostSettings } = {}) {
  if (env.AIWUK_LOCALE) return normalizeLocale(env.AIWUK_LOCALE);
  try {
    const rows = settings?.describe?.({ redactSecrets: true }) ?? [];
    return normalizeLocale(rows.find(row => row.ns === 'locale')?.value?.preference);
  } catch { return 'en'; }
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
