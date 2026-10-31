// Deliberately lossy labels: never copy tool text, descriptions, commands or results.
import path from 'node:path';
export const safeId = (value, max = 256) => typeof value === 'string' && value.length <= max && /^[\w.:-]+$/.test(value) ? value : null;
export const safeTime = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function safeTarget(value, cwd, max = 240, root = cwd) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f?#]/.test(value) || /:\/\//.test(value) || value.includes('\\')) return null;
  if (typeof cwd !== 'string' || !path.posix.isAbsolute(cwd)) return null;
  const resolved = path.posix.resolve(cwd, value);
  if (typeof root !== 'string' || !path.posix.isAbsolute(root)) return null;
  const relative = path.posix.relative(root, resolved);
  if (!relative || relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative)) return null;
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
