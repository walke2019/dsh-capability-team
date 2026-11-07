import { m as modelText } from './i18n.js';
// Per-capability access policy for every team member: denied tools, shell, and the project paths that may be edited.
// The check is lexical (no filesystem I/O) and runs as a monotonic tools.guard, so no later listener can allow a denied call.
import { isAbsolute, relative, resolve } from 'node:path';
import { resolveRole } from './config.js';
import { checkFileLimits } from './file-limits.js';
import { restrictiveToolName } from './tool-names.js';
/** Tools that run arbitrary commands; a path restriction is meaningless while these stay available. */
export const SHELL_TOOLS = ['bash', 'pwsh', 'terminal_*'];
/** DSH file tools that modify files, with the argument holding the target path (dsh-tool-fs, dsh-tool-str-replace-editor). */
const EDIT_TOOLS = { write: 'file_path', edit: 'file_path', str_replace_editor: 'path' };
export const matchesTool = (name, rules) => rules.some(rule => rule.endsWith('*') ? name.startsWith(rule.slice(0, -1)) : name === rule);
const matchesRestrictedTool = (name, rules) => matchesTool(name, rules) || matchesTool(restrictiveToolName(name, n => matchesTool(n, rules)), rules);
/** Project-relative glob: `**` crosses directories, `*` and `?` stay inside one segment. */
export function globRegex(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}
/** Target path of a file-modifying call, or undefined when the call does not modify a file. */
export function editTarget(exec) {
  const name = restrictiveToolName(exec.name, EDIT_TOOLS);
  const key = EDIT_TOOLS[name];
  if (!key || (name === 'str_replace_editor' && exec.arguments?.command === 'view')) return undefined;
  return typeof exec.arguments?.[key] === 'string' ? exec.arguments[key] : '';
}
/** Whether the session currently runs under the capability's DSH permission preset (sandbox and approval both match). */
export function presetActive(presets, session, access) {
  if (!access?.preset || typeof presets?.current !== 'function') return false;
  try { return presets.current(session) === access.preset; } catch { return false; }
}
/** Switch the session to the capability's DSH permission preset when it is not already in effect. */
export function ensurePreset(presets, session, access, log = () => {}) {
  if (!access?.preset || typeof presets?.set !== 'function' || presetActive(presets, session, access)) return;
  try { presets.set(session, access.preset); }
  catch (error) { log(modelText('access.000', { 0: access.preset, 1: error.message ?? error })); }
}
/**
 * Pure decision for one call under a capability's access policy; returns a denial reason or undefined.
 * `sandboxed` means DSH's own permission preset is in effect, so its sandbox, not this guard, bounds commands.
 */
export function checkAccess(exec, access, { project, cwd, label, sandboxed = false }) {
  if (!access) return undefined;
  if (access.deny.length && matchesRestrictedTool(exec.name, access.deny)) return modelText('access.001', { 0: label, 1: exec.name });
  if (!access.shell && !sandboxed && matchesRestrictedTool(exec.name, SHELL_TOOLS)) return modelText('access.002', { 0: label, 1: access.preset ? modelText('access.003', { 0: access.preset }) : '' });
  if (!access.editPaths) return undefined;
  const target = editTarget(exec);
  if (target === undefined) return undefined;
  const scope = access.editPaths.length ? modelText('access.004', { 0: access.editPaths.join('、') }) : modelText('access.005');
  if (!target || target.startsWith('~')) return modelText('access.006', { 0: label, 1: scope, 2: exec.name });
  const rel = relative(project, resolve(cwd, target)).split('\\').join('/');
  if (!rel || rel.startsWith('../') || rel === '..' || isAbsolute(rel)) return modelText('access.007', { 0: label, 1: scope, 2: target });
  if (!access.editPaths.some(pattern => globRegex(pattern).test(rel))) return modelText('access.008', { 0: label, 1: scope, 2: rel });
  return undefined;
}
/** Model-facing one-line summary of an access policy. */
export function accessSummary(access) {
  if (!access) return undefined;
  const parts = [];
  if (access.editPaths) parts.push(access.editPaths.length ? modelText('access.009', { 0: access.editPaths.join('、') }) : modelText('access.010'));
  if (access.preset) parts.push(modelText('access.011', { 0: access.preset, 1: access.shell ? '' : modelText('access.012') }));
  else if (!access.shell) parts.push(modelText('access.013'));
  if (access.deny.length) parts.push(modelText('access.014', { 0: access.deny.join('、') }));
  return parts.length ? parts.join('；') : undefined;
}
import { ownsCapabilityTeam } from './preset-guard.js';
export function applyAccess(ctx, team) {
  ctx.effect(() => ctx.tools.guard(exec => {
    const membership = ctx.agentTeams.tryMembership(exec.agent);
    if (!ownsCapabilityTeam(ctx, exec.agent) || membership === undefined) return undefined;
    const project = team.pinned(exec.agent);
    if (!project) return undefined; // Pinned before the first request; nothing can run earlier.
    let role, effective;
    try { effective = team.loadSync(project, exec.agent).effective; role = resolveRole(membership, effective); }
    catch (error) {
      // An unregistered teammate is already blocked at request routing; a broken config fails closed.
      return /is not registered in this project's team configuration/.test(error.message) ? undefined : modelText('access.015', { 0: error.message });
    }
    const searchTools = new Set(['omni_search','omni_fetch','omni_search_providers','omni_transcribe','omni_transcribe_status']);
    if (!role.search && searchTools.has(restrictiveToolName(exec.name, searchTools))) return modelText('access.016', { 0: role.capability });
    const cwd = ctx.workingDirectory.get?.(exec.agent.session) ?? project;
    const sandboxed = presetActive(ctx.get?.('permissionPresets'), exec.agent.session, role.access);
    return checkAccess(exec, role.access, { project, cwd, sandboxed, label: modelText('access.017', { 0: role.displayName, 1: role.capability }) })
      ?? checkFileLimits(exec, effective.workflow.fileLimits, { project, cwd, role: membership.role });
  }));
}
