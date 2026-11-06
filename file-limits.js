import { m as modelText } from './i18n.js';
// File-size rules for every team member: small source files, no whole-file reads of large files, no
// overwriting existing files, and short final reports. Enforced as a tools.guard (and by `npm run lint`),
// so a model cannot talk its way past them. Measuring a target reads that one file synchronously.
import { readFileSync } from 'node:fs';
import { restrictiveToolName } from './tool-names.js';
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
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(modelText('file-limits.211'));
  const extra = Object.keys(value).filter(k => !LIMIT_KEYS.includes(k));
  if (extra.length) throw new Error(modelText('file-limits.212', { 0: extra.join(', ') }));
  const out = { ...FILE_LIMITS, ...value };
  for (const k of LIMIT_KEYS) if (!Number.isSafeInteger(out[k]) || out[k] < 50 || out[k] > 20000) throw new Error(modelText('file-limits.213', { 0: k }));
  if (out.sourceWarn > out.sourceMax) throw new Error(modelText('file-limits.214'));
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
  exec = { ...exec, name: restrictiveToolName(exec.name, TARGET) };
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
  exec = { ...exec, name: restrictiveToolName(exec.name, name => Object.hasOwn(TARGET, name) || name === 'send_message') };
  if (exec.name === 'send_message' && role !== 'lead') {
    const text = exec.arguments?.message;
    if (typeof text === 'string' && text.length > limits.reportMax) return modelText('file-limits.215', { 0: text.length, 1: limits.reportMax, 2: limits.reportMax });
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
    if (lines > limits.readMax && !(limit > 0 && limit <= limits.readMax)) return modelText('file-limits.216', { 0: target.rel, 1: lines, 2: limits.readMax, 3: limits.readMax });
    return undefined;
  }
  if (current !== undefined && (exec.name === 'write' || (exec.name === 'str_replace_editor' && exec.arguments?.command === 'create'))) {
    return modelText('file-limits.217', { 0: target.rel });
  }
  if (!kind) return undefined;
  if (current !== undefined && GENERATED.test(current)) return modelText('file-limits.218', { 0: target.rel });
  const next = predictText(exec, current);
  if (next === undefined) return undefined;
  const before = current === undefined ? 0 : lineCount(current);
  const after = lineCount(next);
  const max = maxFor(kind, limits);
  if (after <= max || after <= before) return undefined;
  if (before > max) return modelText('file-limits.219', { 0: target.rel, 1: before, 2: max, 3: after });
  return modelText('file-limits.220', { 0: target.rel, 1: after, 2: kind === 'test' ? modelText('file-limits.221') : modelText('file-limits.222'), 3: max, 4: max });
}
/** Model-facing rules text, kept in one place for the team policy and the dispatch result. */
export function fileLimitRules(limits) {
  if (!limits) return '';
  return modelText('file-limits.223', { 0: limits.sourceWarn, 1: limits.sourceMax, 2: limits.testMax, 3: limits.readMax, 4: limits.reportMax });
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
