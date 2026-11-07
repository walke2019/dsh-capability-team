// Speech to text through the configured gateway (integrations.audio). The file is read locally only after the
// user approves that exact path in DSH's native question box, then uploaded as multipart with its real bytes;
// fetch's FormData sets the boundary. The key goes into the Authorization header only, never into prompts,
// tool arguments or logs. A 200 still has to carry text to count as a result.
import { m, t } from './i18n.js';
import { open, realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { keyOf, refreshCredentials, resolveIntegrations } from './integrations-config.js';
import { gatewayBase, httpError } from './search.js';
import { readCapped } from './search-engines.js';
import { params } from './tool-schema.js';
export const AUDIO_TYPES = { '.mp3': 'audio/mpeg', '.mp4': 'audio/mp4', '.m4a': 'audio/mp4', '.mpeg': 'audio/mpeg', '.mpga': 'audio/mpeg', '.wav': 'audio/wav', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.flac': 'audio/flac' };
const AUDIO_BASE = { what: m('transcribe.559'), field: 'audio.baseUrl', envName: 'OMNI_AUDIO_BASE_URL' };
const extOf = path => (/\.[^.\\/]+$/.exec(path)?.[0] ?? '').toLowerCase();
export function audioSettings(resolved = resolveIntegrations()) {
  return { config: resolved.effective.audio, key: keyOf('audio', resolved), keyEnv: resolved.keys.audio.env };
}
/**
 * Check type and size on an open handle, call `approve(size)`, and only then read the bytes. Nothing is read
 * before approval, and the size checked is the size of the file actually read (no stat/read race).
 */
export async function readAudio(path, maxBytes, approve = async () => {}) {
  // A symlink named meeting.mp3 could point anywhere (e.g. a private key): check and show the real target.
  const unsupported = name => new Error(m('transcribe.560', { 0: extOf(name) || m('transcribe.561'), 1: Object.keys(AUDIO_TYPES).join(' ') }));
  if (!AUDIO_TYPES[extOf(path)]) throw unsupported(path);
  const real = await realpath(path);
  if (!AUDIO_TYPES[extOf(real)]) throw unsupported(real);
  const handle = await open(real, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(m('transcribe.562'));
    if (stat.size > maxBytes) throw new Error(m('transcribe.563', { 0: (stat.size / 1048576).toFixed(1), 1: (maxBytes / 1048576).toFixed(1) }));
    if (!stat.size) throw new Error(m('transcribe.564'));
    await approve(stat.size, real);
    const bytes = await handle.readFile();
    if (bytes.byteLength > maxBytes) throw new Error(m('transcribe.565'));
    return bytes;
  } finally { await handle.close(); }
}
export async function transcribe({ bytes, name, language, prompt }, { settings, fetcher = fetch, signal } = {}) {
  if (!settings) await refreshCredentials();
  const { config, key, keyEnv } = settings ?? audioSettings();
  if (!key) throw new Error(m('transcribe.566', { 0: keyEnv }));
  const origin = gatewayBase(config.baseUrl, AUDIO_BASE);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: AUDIO_TYPES[extOf(name)] ?? 'application/octet-stream' }), name);
  if (config.model) form.append('model', config.model);
  if (language) form.append('language', language);
  if (prompt) form.append('prompt', prompt);
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const response = await fetcher(`${origin}${config.path}`, { method: 'POST', redirect: 'error', body: form,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { ...config.headers, Authorization: `Bearer ${key}` } });
  if (!response.ok) throw httpError(m('transcribe.559'), response.status);
  const text = await readCapped(response, m('transcribe.559'));
  if (text.includes(key)) throw new Error(m('transcribe.569'));
  let data; try { data = JSON.parse(text); } catch { data = { text }; }
  if (typeof data?.text !== 'string' || !data.text.trim()) throw new Error(m('transcribe.570'));
  return data;
}
export async function audioStatus({ settings, fetcher = fetch, signal } = {}) {
  if (!settings) await refreshCredentials();
  const { config, key, keyEnv } = settings ?? audioSettings();
  if (!config.statusPath) throw new Error(m('transcribe.571'));
  if (!key) throw new Error(m('transcribe.572', { 0: keyEnv }));
  const timeout = AbortSignal.timeout(30000);
  const response = await fetcher(`${gatewayBase(config.baseUrl, AUDIO_BASE)}${config.statusPath}`, { method: 'GET', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { ...config.headers, Authorization: `Bearer ${key}` } });
  if (!response.ok) throw httpError(m('transcribe.573'), response.status);
  const text = await readCapped(response, m('transcribe.573'));
  if (text.includes(key)) throw new Error(m('transcribe.569'));
  let status; try { status = JSON.parse(text); } catch { throw new Error(m('transcribe.576')); }
  return { note: t('transcribe.577'), status };
}
/** Ask the user, in DSH's native question box, to allow uploading this one file. */
async function approve(ctx, exec, path, size, cwd) {
  const allowLabel = t('transcribe.582');
  const outside = cwd && relative(cwd, path).startsWith('..') ? t('transcribe.578') : '';
  const answer = await ctx.userQuestions.ask({ agent: exec.agent, signal: exec.signal, questions: [{
    id: 'upload', header: t('transcribe.579'),
    question: t('transcribe.580'),
    detail: t('transcribe.581', { 0: path, 1: (size / 1048576).toFixed(2), 2: outside }),
    options: [{ label: allowLabel, description: t('transcribe.583') }, { label: t('transcribe.584'), description: t('transcribe.585') }],
  }] });
  if (!answer.answers.find(a => a.id === 'upload')?.selected.includes(allowLabel)) throw new Error(m('transcribe.587'));
}
const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
export function applyTranscribe(ctx) {
  ctx.effect(() => ctx.tools.register({ name: 'omni_transcribe', output,
    description: m('transcribe.588'),
    parameters: params({ file_path: { type: 'string', description: m('transcribe.589') }, language: { type: 'string', description: m('transcribe.590') }, prompt: { type: 'string', description: m('transcribe.591') } }, ['file_path']),
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
      const path = isAbsolute(String(args.file_path)) ? String(args.file_path) : resolve(cwd, String(args.file_path));
      const max = audioSettings().config.maxBytes;
      const bytes = await readAudio(path, max, (size, real) => approve(ctx, exec, real, size, cwd)); // read only after approval
      const result = await transcribe({ bytes, name: basename(path), language: args.language, prompt: args.prompt }, { signal: exec.signal });
      return JSON.stringify(result);
    },
  }));
  ctx.effect(() => ctx.tools.register({ name: 'omni_transcribe_status', output, parameters: params({}, []),
    description: m('transcribe.592'),
    async execute(_args, exec) { return JSON.stringify(await audioStatus({ signal: exec.signal })); },
  }));
}
