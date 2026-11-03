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
  lead: { displayName: '孙权', capability: 'orchestrator' },
  'zhuge-liang': { displayName: '诸葛亮', capability: 'technical-director' },
  'lv-bu': { displayName: '吕布', capability: 'backend' },
  'diao-chan': { displayName: '貂蝉', capability: 'frontend' },
  'zhao-yun': { displayName: '赵云', capability: 'research' },
  'chen-lin': { displayName: '陈琳', capability: 'writer' },
  'zhou-yu': { displayName: '周瑜', capability: 'qa' },
});
export const ROLE_THEMES = Object.freeze({ default: DEFAULT_ROLES, 'three-kingdoms': THREE_KINGDOMS_ROLES });
/** Hero id → neutral id with the same capability; lets members spawned under the old roster keep routing. */
export const LEGACY_ROLE_ALIASES = Object.freeze({ 'zhuge-liang': 'architect', 'lv-bu': 'backend', 'diao-chan': 'frontend', 'zhao-yun': 'researcher', 'chen-lin': 'writer', 'zhou-yu': 'qa' });
const sameRole = (a, b) => isMap(a) && isMap(b) && a.displayName === b.displayName && a.capability === b.capability && a.description === b.description;
/** Stored-override marker written by 4.0+: such files are never read against the old hero default. */
export const ROSTER_MARK = 2;
/**
 * True for overrides saved before 4.0 against the hero default: no marker, and a hero id the base lacks is stored as a
 * partial rename or a deletion (null), which only means something on top of the hero roster. Complete hero roles (as a
 * template or the three-kingdoms theme writes them) stand on their own.
 */
export function isLegacyRoster(baseRoles = {}, overrides = {}) {
  if (overrides.roster === ROSTER_MARK) return false;
  return Object.entries(overrides.roles ?? {}).some(([id, r]) => Object.hasOwn(LEGACY_ROLE_ALIASES, id) && !Object.hasOwn(baseRoles, id)
    && (r === null || (isMap(r) && (r.capability === undefined || r.displayName === undefined))));
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
  if (!roles) throw new Error(`未知的内置角色主题 ${theme}；可用：${Object.keys(ROLE_THEMES).join(' / ')}`);
  const patch = Object.fromEntries(Object.entries(roles).map(([id, r]) => [id, { ...r }]));
  for (const id of Object.keys(current.roles ?? {})) if (!Object.hasOwn(patch, id)) patch[id] = false;
  return { roles: patch };
}
