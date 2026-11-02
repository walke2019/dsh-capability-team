// Deliberately lossy labels: never copy tool text, descriptions, commands or results.
import path from 'node:path';
export const safeId = (value, max = 256) => typeof value === 'string' && value.length <= max && /^[\w.:-]+$/.test(value) ? value : null;
export const safeTime = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
/** Path rules follow the session's own working directory, which is a Windows path on a Windows host (drive or UNC). */
const isWindowsPath = value => typeof value === 'string' && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(value);
export function safeTarget(value, cwd, max = 240, root = cwd) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f?#]/.test(value) || /:\/\//.test(value)) return null;
  const windows = isWindowsPath(cwd);
  const flavor = windows ? path.win32 : path.posix;
  // A backslash separates segments only on Windows; on POSIX it is a literal character that could disguise a traversal.
  if (!windows && value.includes('\\')) return null;
  if (typeof cwd !== 'string' || !flavor.isAbsolute(cwd)) return null;
  if (typeof root !== 'string' || !flavor.isAbsolute(root) || isWindowsPath(root) !== windows) return null;
  const resolved = flavor.resolve(cwd, value);
  const relative = flavor.relative(root, resolved).split(flavor.sep).join('/');
  if (!relative || relative === '..' || relative.startsWith('../') || flavor.isAbsolute(relative)) return null;
  if (relative.split('/').some(part => /^(\.env.*|\.ssh|\.aws|\.gnupg|\.?credentials.*|\.?secrets?.*|.*(?:api[-_]?key|token|password|credential).*|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519).*)$/i.test(part))) return '[敏感路径]';
  return relative.length <= max ? relative : null;
}
export function summarizeActivity(tool, argumentsText, cwd, root = cwd) {
  const name = safeId(tool, 80) ?? 'unknown';
  const labels = { read: '读取文件', read_image: '读取文件', edit: '修改文件', write: '修改文件', grep: '搜索项目', glob: '搜索项目', bash: '执行命令' };
  let target = null;
  if (typeof argumentsText === 'string' && Buffer.byteLength(argumentsText) <= 16384) {
    try {
      const args = JSON.parse(argumentsText);
      if (args && typeof args === 'object' && !Array.isArray(args)) {
        const field = ['read', 'read_image', 'edit', 'write'].includes(name) ? 'file_path' : ['grep', 'glob'].includes(name) ? 'path' : null;
        if (field) target = safeTarget(args[field], cwd, 240, root);
      }
    } catch { /* invalid input deliberately omitted */ }
  }
  return { tool: name, summary: labels[name] ?? '执行工具', target };
}
