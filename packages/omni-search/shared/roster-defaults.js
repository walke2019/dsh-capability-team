import { roleText, m as modelText } from './i18n.js';
// Built-in role rosters. The neutral roster is the default; "three-kingdoms" is an optional skin applied
// per project through capability_team_import { theme }. Projects saved before 4.0 keep their hero roster.
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const frozen = roles => Object.freeze(Object.fromEntries(Object.entries(roles).map(([id, r]) => [id, Object.freeze(r)])));
/** Neutral default roster (English display names; the Web client localizes untouched defaults). */
export const DEFAULT_ROLES = frozen({
  lead: { displayName: 'Lead', capability: 'orchestrator' },
  architect: { displayName: 'Architect', capability: 'technical-director' },
  backend: { displayName: 'Backend', capability: 'backend' },
  frontend: { displayName: 'Frontend', capability: 'frontend' },
  researcher: { displayName: 'Researcher', capability: 'research' },
  writer: { displayName: 'Writer', capability: 'writer' },
  qa: { displayName: 'QA', capability: 'qa' },
});
/** The pre-4.0 default roster, kept as the optional "three-kingdoms" theme. */
export const THREE_KINGDOMS_ROLES = frozen({
  lead: { displayName: roleText('roster-defaults.364'), capability: 'orchestrator' },
  'zhuge-liang': { displayName: roleText('roster-defaults.365'), capability: 'technical-director' },
  'lv-bu': { displayName: roleText('roster-defaults.366'), capability: 'backend' },
  'diao-chan': { displayName: roleText('roster-defaults.367'), capability: 'frontend' },
  'zhao-yun': { displayName: roleText('roster-defaults.368'), capability: 'research' },
  'chen-lin': { displayName: roleText('roster-defaults.369'), capability: 'writer' },
  'zhou-yu': { displayName: roleText('roster-defaults.370'), capability: 'qa' },
});
export const ROLE_THEMES = Object.freeze({ default: DEFAULT_ROLES, 'three-kingdoms': THREE_KINGDOMS_ROLES });
/** Hero id → neutral id with the same capability; lets members spawned under the old roster keep routing. */
export const LEGACY_ROLE_ALIASES = Object.freeze({ 'zhuge-liang': 'architect', 'lv-bu': 'backend', 'diao-chan': 'frontend', 'zhao-yun': 'researcher', 'chen-lin': 'writer', 'zhou-yu': 'qa' });
const sameRole = (a, b) => isMap(a) && isMap(b) && a.displayName === b.displayName && a.capability === b.capability && a.description === b.description;
/** Stored-override marker written by 4.0+: such files are never read against the old hero default. */
export const ROSTER_MARK = 2;
/**
 * True for overrides saved before 4.0 against the hero default: no marker (every 4.0+ save writes one), and a hero id
 * the base lacks is stored, whether as a partial rename, a deletion (null) or a complete role from a 3.x template.
 * Such a file was written on top of the hero roster, so mixing it into the neutral default would duplicate roles.
 */
export function isLegacyRoster(baseRoles = {}, overrides = {}) {
  if (overrides.roster === ROSTER_MARK) return false;
  return Object.keys(overrides.roles ?? {}).some(id => Object.hasOwn(LEGACY_ROLE_ALIASES, id) && !Object.hasOwn(baseRoles, id));
}
/** Base roles for one project's stored overrides: a pre-4.0 save keeps the hero roster (neutral defaults it never saw are dropped). */
export function rosterBase(baseRoles = {}, overrides = {}) {
  if (!isLegacyRoster(baseRoles, overrides)) return baseRoles;
  const kept = Object.entries(baseRoles).filter(([id, r]) => !(Object.hasOwn(DEFAULT_ROLES, id) && sameRole(r, DEFAULT_ROLES[id])));
  return { ...Object.fromEntries(kept), ...THREE_KINGDOMS_ROLES };
}
/**
 * Overrides to store after a save: marked as 4.0+. A legacy project's roster is written out explicitly on its first
 * save (base-only roles stored as null), so later loads no longer depend on guessing.
 */
export function pinRoster(next, previous, baseRoles = {}) {
  if (!isLegacyRoster(baseRoles, previous)) return { ...next, roster: ROSTER_MARK };
  const roles = Object.fromEntries(Object.keys(baseRoles).map(id => [id, null]));
  for (const [id, r] of Object.entries(rosterBase(baseRoles, previous))) roles[id] = { ...r };
  for (const [id, r] of Object.entries(next.roles ?? {})) roles[id] = r === null ? null : isMap(r) && isMap(roles[id]) ? { ...roles[id], ...r } : r;
  return { ...next, roles, roster: ROSTER_MARK };
}
/** Role id a member name resolves to when the roster lacks it: a legacy hero name maps to its neutral role. */
export function legacyRoleId(name, roles) {
  const alias = LEGACY_ROLE_ALIASES[name];
  return alias && !Object.hasOwn(roles, name) && Object.hasOwn(roles, alias) ? alias : undefined;
}
/** Save patch that replaces the project's roster with a built-in theme; other roles are removed, per-role descriptions kept. */
export function themePatch(theme, current) {
  const roles = Object.hasOwn(ROLE_THEMES, theme) ? ROLE_THEMES[theme] : undefined;
  if (!roles) throw new Error(modelText('roster-defaults.371', { 0: theme, 1: Object.keys(ROLE_THEMES).join(' / ') }));
  const patch = Object.fromEntries(Object.entries(roles).map(([id, r]) => [id, { ...r }]));
  for (const id of Object.keys(current.roles ?? {})) if (!Object.hasOwn(patch, id)) patch[id] = false;
  return { roles: patch };
}
