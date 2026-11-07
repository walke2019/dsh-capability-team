import { m as modelText } from './i18n.js';
// Portable team templates: roles, capability duties and policies, workflow and failover. Channels, models, backups
// and long-context routes belong to one user's DSH catalog, so they are never exported; after an import, automatic
// matching (or a later save) assigns them.
export const TEMPLATE_FORMAT = 'capability-team-template';
export const TEMPLATE_VERSION = 1;
const PORTABLE = ['job', 'whenToUse', 'tier', 'search', 'prefer', 'access', 'maxTokens', 'planFirst'];
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
/** Template of one effective configuration. */
export function toTemplate(effective) {
  return {
    format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION, name: effective.name,
    workflow: effective.workflow, failover: effective.failover,
    capabilities: Object.fromEntries(Object.entries(effective.capabilities).map(([id, c]) => [id, pick(c, PORTABLE)])),
    roles: effective.roles,
  };
}
/**
 * Save patch that makes a project's team match a template: capability fields merge (keeping routes), roles are
 * replaced, and a template capability field that is absent clears the project's value back to the default.
 */
export function templatePatch(template, current) {
  if (!isMap(template) || template.format !== TEMPLATE_FORMAT) throw new Error(modelText('template.499', { 0: TEMPLATE_FORMAT }));
  if (template.version !== TEMPLATE_VERSION) throw new Error(modelText('template.500', { 0: template.version, 1: TEMPLATE_VERSION }));
  const extra = Object.keys(template).filter(k => !['format', 'version', 'name', 'workflow', 'failover', 'capabilities', 'roles'].includes(k));
  if (extra.length) throw new Error(modelText('template.501', { 0: extra.join(', ') }));
  if (!isMap(template.capabilities) || !isMap(template.roles)) throw new Error(modelText('template.502'));
  if (!isMap(template.roles.lead)) throw new Error(modelText('template.503'));
  const capabilities = {};
  for (const [id, c] of Object.entries(template.capabilities)) {
    if (!isMap(c)) throw new Error(modelText('template.504', { 0: id }));
    const unknown = Object.keys(c).filter(k => !PORTABLE.includes(k));
    if (unknown.length) throw new Error(modelText('template.505', { 0: id, 1: unknown.join(', ') }));
    // Fields the template leaves out are cleared so the project ends up matching the template.
    const cleared = { search: false, prefer: [] };
    capabilities[id] = Object.fromEntries(PORTABLE.map(k => [k, c[k] ?? (k in cleared ? cleared[k] : null)]));
  }
  const roles = { ...template.roles };
  for (const id of Object.keys(current.roles)) if (!(id in roles)) roles[id] = false;
  return {
    ...(template.name === undefined ? {} : { name: template.name }),
    workflow: template.workflow ?? null, failover: template.failover ?? null,
    capabilities, roles,
  };
}
