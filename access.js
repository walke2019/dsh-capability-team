// Per-capability access policy for every team member: denied tools, shell, and the project paths that may be edited.
// The check is lexical (no filesystem I/O) and runs as a monotonic tools.guard, so no later listener can allow a denied call.
import { isAbsolute, relative, resolve } from 'node:path';
import { resolveRole } from './config.js';
/** Tools that run arbitrary commands; a path restriction is meaningless while these stay available. */
export const SHELL_TOOLS = ['bash', 'pwsh', 'terminal_*'];
/** DSH file tools that modify files, with the argument holding the target path (dsh-tool-fs, dsh-tool-str-replace-editor). */
const EDIT_TOOLS = { write: 'file_path', edit: 'file_path', str_replace_editor: 'path' };
export const matchesTool = (name, rules) => rules.some(rule => rule.endsWith('*') ? name.startsWith(rule.slice(0, -1)) : name === rule);
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
  const key = EDIT_TOOLS[exec.name];
  if (!key || (exec.name === 'str_replace_editor' && exec.arguments?.command === 'view')) return undefined;
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
  catch (error) { log(`无法应用权限预设 ${access.preset}：${error.message ?? error}；命令仍按 access.shell 拦截`); }
}
/**
 * Pure decision for one call under a capability's access policy; returns a denial reason or undefined.
 * `sandboxed` means DSH's own permission preset is in effect, so its sandbox, not this guard, bounds commands.
 */
export function checkAccess(exec, access, { project, cwd, label, sandboxed = false }) {
  if (!access) return undefined;
  if (access.deny.length && matchesTool(exec.name, access.deny)) return `${label}不允许使用工具 ${exec.name}（项目团队配置的 access.deny）。需要时请向 lead 汇报，由主控改派或经用户确认调整权限。`;
  if (!access.shell && !sandboxed && matchesTool(exec.name, SHELL_TOOLS)) return `${label}不允许执行命令（项目团队配置的 access.shell=false${access.preset ? `，权限预设 ${access.preset} 尚未生效` : ''}）。需要运行命令时请向 lead 汇报。`;
  if (!access.editPaths) return undefined;
  const target = editTarget(exec);
  if (target === undefined) return undefined;
  const scope = access.editPaths.length ? `只允许修改 ${access.editPaths.join('、')}` : '不允许修改任何文件';
  if (!target || target.startsWith('~')) return `${label}${scope}；无法确认 ${exec.name} 的目标路径，已拒绝。`;
  const rel = relative(project, resolve(cwd, target)).split('\\').join('/');
  if (!rel || rel.startsWith('../') || rel === '..' || isAbsolute(rel)) return `${label}${scope}；${target} 不在项目内，已拒绝。`;
  if (!access.editPaths.some(pattern => globRegex(pattern).test(rel))) return `${label}${scope}（相对项目根目录）；${rel} 不在允许范围内。需要修改时请向 lead 汇报。`;
  return undefined;
}
/** Model-facing one-line summary of an access policy. */
export function accessSummary(access) {
  if (!access) return undefined;
  const parts = [];
  if (access.editPaths) parts.push(access.editPaths.length ? `只能修改 ${access.editPaths.join('、')}` : '不能修改文件');
  if (access.preset) parts.push(`运行在 DSH 权限预设 ${access.preset} 中${access.shell ? '' : '，命令只在该沙箱内执行'}`);
  else if (!access.shell) parts.push('不能执行命令');
  if (access.deny.length) parts.push(`禁用工具 ${access.deny.join('、')}`);
  return parts.length ? parts.join('；') : undefined;
}
export function applyAccess(ctx, team) {
  ctx.effect(() => ctx.tools.guard(exec => {
    const membership = ctx.agentTeams.tryMembership(exec.agent);
    if (membership === undefined) return undefined;
    const project = team.pinned(exec.agent);
    if (!project) return undefined; // Pinned before the first request; nothing can run earlier.
    let role;
    try { role = resolveRole(membership, team.loadSync(project, exec.agent).effective); }
    catch (error) {
      // An unregistered teammate is already blocked at request routing; a broken config fails closed.
      return /未在当前项目的团队配置中登记/.test(error.message) ? undefined : `团队配置读取失败，已停止执行：${error.message}`;
    }
    const cwd = ctx.workingDirectory.get?.(exec.agent.session) ?? project;
    const sandboxed = presetActive(ctx.get?.('permissionPresets'), exec.agent.session, role.access);
    return checkAccess(exec, role.access, { project, cwd, sandboxed, label: `角色 ${role.displayName}（${role.capability}）` });
  }));
}
