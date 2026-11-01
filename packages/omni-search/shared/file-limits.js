// File-size rules for every team member: small source files, no whole-file reads of large files, no
// overwriting existing files, and short final reports. Enforced as a tools.guard (and by `npm run lint`),
// so a model cannot talk its way past them. Measuring a target reads that one file synchronously.
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
export const FILE_LIMITS = { sourceWarn: 300, sourceMax: 500, testMax: 800, readMax: 400, reportMax: 1500 };
const LIMIT_KEYS = Object.keys(FILE_LIMITS);
const CODE = /\.(?:[cm]?[jt]sx?|css|scss|vue|svelte|py|go|rs|java|kt|swift|rb|php)$/;
const EXEMPT = [/(^|\/)node_modules\//, /(^|\/)(dist|build|vendor)\//, /\.min\.[a-z]+$/, /(^|\/)[^/]*lock[^/]*$/];
const GENERATED = /^\/\/ @generated\b/;
export const lineCount = text => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));
/** Validated limits from `workflow.fileLimits`; missing keys keep their defaults, `false` turns the rules off. */
export function validateFileLimits(value) {
  if (value === undefined || value === null) return { ...FILE_LIMITS };
  if (value === false) return false;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('fileLimits 须为对象或 false');
  const extra = Object.keys(value).filter(k => !LIMIT_KEYS.includes(k));
  if (extra.length) throw new Error(`fileLimits 不支持字段 ${extra.join(', ')}`);
  const out = { ...FILE_LIMITS, ...value };
  for (const k of LIMIT_KEYS) if (!Number.isSafeInteger(out[k]) || out[k] < 50 || out[k] > 20000) throw new Error(`fileLimits.${k} 须为 50–20000 的整数`);
  if (out.sourceWarn > out.sourceMax) throw new Error('fileLimits.sourceWarn 不能大于 sourceMax');
  return out;
}
/** 'test' | 'source' | undefined (not limited) for a project-relative path. */
export function fileKind(rel) {
  if (!CODE.test(rel) || EXEMPT.some(re => re.test(rel))) return undefined;
  return /(^|\/)(tests?|__tests__)\//.test(rel) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) ? 'test' : 'source';
}
const maxFor = (kind, limits) => (kind === 'test' ? limits.testMax : limits.sourceMax);
function readText(path) {
  try { return readFileSync(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
const occurrences = (text, part) => (part ? text.split(part).length - 1 : 0);
/** Text of the file after the call, or undefined when it cannot be predicted (the tool reports its own errors). */
export function predictText(exec, current) {
  const a = exec.arguments ?? {};
  if (exec.name === 'write') return typeof a.content === 'string' ? a.content : undefined;
  if (exec.name === 'edit') {
    if (current === undefined || typeof a.old_string !== 'string' || typeof a.new_string !== 'string' || !a.old_string) return undefined;
    return a.replace_all ? current.split(a.old_string).join(a.new_string) : current.replace(a.old_string, () => a.new_string);
  }
  if (exec.name === 'str_replace_editor') {
    if (a.command === 'create') return typeof a.file_text === 'string' ? a.file_text : undefined;
    if (current === undefined) return undefined;
    if (a.command === 'str_replace' && typeof a.old_str === 'string' && occurrences(current, a.old_str) === 1) return current.replace(a.old_str, () => a.new_str ?? '');
    if (a.command === 'insert' && typeof a.new_str === 'string') return current + '\n' + a.new_str;
  }
  return undefined;
}
const TARGET = { write: 'file_path', edit: 'file_path', str_replace_editor: 'path', read: 'file_path' };
function locate(exec, project, cwd) {
  const raw = exec.arguments?.[TARGET[exec.name]];
  if (typeof raw !== 'string' || !raw || raw.startsWith('~')) return undefined;
  const abs = resolve(cwd, raw);
  const rel = relative(project, abs).split('\\').join('/');
  if (!rel || rel.startsWith('../') || rel === '..' || isAbsolute(rel)) return undefined;
  return { abs, rel };
}
/**
 * Decision for one call; returns a denial reason or undefined. Paths outside the project are left to the
 * access policy. `role` says whether the caller is the Lead (whose task briefs are not capped).
 */
export function checkFileLimits(exec, limits, { project, cwd, role = 'teammate', read = readText }) {
  if (!limits) return undefined;
  if (exec.name === 'send_message' && role !== 'lead') {
    const text = exec.arguments?.message;
    if (typeof text === 'string' && text.length > limits.reportMax) return `汇报正文 ${text.length} 字，超过上限 ${limits.reportMax}。请分条发送，先发结论，每条不超过 ${limits.reportMax} 字。`;
    return undefined;
  }
  if (!TARGET[exec.name] || (exec.name === 'str_replace_editor' && exec.arguments?.command === 'view')) return undefined;
  const target = locate(exec, project, cwd);
  if (!target) return undefined;
  const current = read(target.abs);
  const kind = fileKind(target.rel);
  if (exec.name === 'read') {
    if (current === undefined || !kind || GENERATED.test(current)) return undefined;
    const lines = lineCount(current);
    const limit = Number(exec.arguments?.limit);
    if (lines > limits.readMax && !(limit > 0 && limit <= limits.readMax)) return `${target.rel} 有 ${lines} 行，超过整读上限 ${limits.readMax}。先用 grep 定位，再用 read 的 offset/limit 每次读不超过 ${limits.readMax} 行。`;
    return undefined;
  }
  if (current !== undefined && (exec.name === 'write' || (exec.name === 'str_replace_editor' && exec.arguments?.command === 'create'))) {
    return `${target.rel} 已存在：已有文件只能用 edit 局部修改，不能整体覆盖。需要大改时按职责拆成新文件。`;
  }
  if (!kind) return undefined;
  if (current !== undefined && GENERATED.test(current)) return `${target.rel} 是生成文件，不能直接修改；改它的源文件后重新生成。`;
  const next = predictText(exec, current);
  if (next === undefined) return undefined;
  const before = current === undefined ? 0 : lineCount(current);
  const after = lineCount(next);
  const max = maxFor(kind, limits);
  if (after <= max || after <= before) return undefined;
  if (before > max) return `${target.rel} 已有 ${before} 行，超过上限 ${max}：超标文件只能减不能增（本次改后 ${after} 行）。把新增内容放进新文件，或先把它拆小。`;
  return `${target.rel} 改后 ${after} 行，超过${kind === 'test' ? '测试文件' : '源文件'}上限 ${max}。按职责拆成新文件，每个文件不超过 ${max} 行。`;
}
/** Model-facing rules text, kept in one place for the team policy and the dispatch result. */
export function fileLimitRules(limits) {
  if (!limits) return '';
  return `文件铁律：源文件 ${limits.sourceWarn} 行起应考虑拆分，硬上限 ${limits.sourceMax} 行，测试文件硬上限 ${limits.testMax} 行；已超标的文件只能减不能增；超过 ${limits.readMax} 行的文件不整读，先 grep 再按 offset/limit 小段读；已有文件只用 edit 局部改，不整体覆盖；汇报每条不超过 ${limits.reportMax} 字，先发结论。`;
}
/** Every limited file in `files` (project-relative) that breaks the size rules: for lint. */
export function sizeViolations(files, limits, read = path => readFileSync(path, 'utf8'), root = '.') {
  const out = [];
  for (const rel of files) {
    const kind = fileKind(rel);
    if (!kind) continue;
    let text;
    try { text = read(resolve(root, rel)); } catch { continue; }
    if (typeof text !== 'string') continue;
    if (GENERATED.test(text)) continue;
    const lines = lineCount(text);
    if (lines > maxFor(kind, limits)) out.push({ file: rel, lines, max: maxFor(kind, limits) });
  }
  return out;
}
