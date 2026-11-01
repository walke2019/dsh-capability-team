// Speech to text through the configured gateway (integrations.audio). The file is read locally only after the
// user approves that exact path in DSH's native question box, then uploaded as multipart with its real bytes;
// fetch's FormData sets the boundary. The key goes into the Authorization header only, never into prompts,
// tool arguments or logs. A 200 still has to carry text to count as a result.
import { open } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';
import { keyOf, refreshCredentials, resolveIntegrations } from './integrations-config.js';
import { gatewayBase, httpError } from './search.js';
import { params } from './tool-schema.js';
export const AUDIO_TYPES = { '.mp3': 'audio/mpeg', '.mp4': 'audio/mp4', '.m4a': 'audio/mp4', '.mpeg': 'audio/mpeg', '.mpga': 'audio/mpeg', '.wav': 'audio/wav', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.flac': 'audio/flac' };
const extOf = path => (/\.[^.\\/]+$/.exec(path)?.[0] ?? '').toLowerCase();
export function audioSettings(resolved = resolveIntegrations()) {
  return { config: resolved.effective.audio, key: keyOf('audio', resolved), keyEnv: resolved.keys.audio.env };
}
/**
 * Check type and size on an open handle, call `approve(size)`, and only then read the bytes. Nothing is read
 * before approval, and the size checked is the size of the file actually read (no stat/read race).
 */
export async function readAudio(path, maxBytes, approve = async () => {}) {
  if (!AUDIO_TYPES[extOf(path)]) throw new Error(`不支持的音频格式：${extOf(path) || '无扩展名'}（支持 ${Object.keys(AUDIO_TYPES).join(' ')}）`);
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('不是普通文件');
    if (stat.size > maxBytes) throw new Error(`文件 ${(stat.size / 1048576).toFixed(1)} MiB 超过上传上限 ${(maxBytes / 1048576).toFixed(1)} MiB`);
    if (!stat.size) throw new Error('文件为空');
    await approve(stat.size);
    const bytes = await handle.readFile();
    if (bytes.byteLength > maxBytes) throw new Error('文件在授权后变大，超过上传上限');
    return bytes;
  } finally { await handle.close(); }
}
export async function transcribe({ bytes, name, language, prompt }, { settings, fetcher = fetch, signal } = {}) {
  if (!settings) await refreshCredentials();
  const { config, key, keyEnv } = settings ?? audioSettings();
  if (!key) throw new Error(`语音转写缺少密钥：在 DSH 设置中保存凭据 ${keyEnv}，或在 Host 环境设置同名变量`);
  const origin = gatewayBase(config.baseUrl);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: AUDIO_TYPES[extOf(name)] ?? 'application/octet-stream' }), name);
  if (config.model) form.append('model', config.model);
  if (language) form.append('language', language);
  if (prompt) form.append('prompt', prompt);
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const response = await fetcher(`${origin}${config.path}`, { method: 'POST', redirect: 'error', body: form,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { ...config.headers, Authorization: `Bearer ${key}` } });
  if (!response.ok) throw httpError('语音转写', response.status);
  const text = await response.text();
  if (text.includes(key)) throw new Error('响应包含凭据，已阻止回传');
  let data; try { data = JSON.parse(text); } catch { data = { text }; }
  if (typeof data?.text !== 'string' || !data.text.trim()) throw new Error('语音转写返回 200 但没有转写文本');
  return data;
}
export async function audioStatus({ settings, fetcher = fetch, signal } = {}) {
  if (!settings) await refreshCredentials();
  const { config, key, keyEnv } = settings ?? audioSettings();
  if (!config.statusPath) throw new Error('未配置语音状态路径 audio.statusPath');
  if (!key) throw new Error(`语音状态查询缺少密钥 ${keyEnv}`);
  const timeout = AbortSignal.timeout(30000);
  const response = await fetcher(`${gatewayBase(config.baseUrl)}${config.statusPath}`, { method: 'GET', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { ...config.headers, Authorization: `Bearer ${key}` } });
  if (!response.ok) throw httpError('语音状态', response.status);
  return { note: '仅代表网关本地服务健康，不代表上游一定成功', status: await response.json() };
}
/** Ask the user, in DSH's native question box, to allow uploading this one file. */
async function approve(ctx, exec, path, size) {
  const answer = await ctx.userQuestions.ask({ agent: exec.agent, signal: exec.signal, questions: [{
    id: 'upload', header: '允许上传音频？',
    question: `把本地文件上传到语音转写网关？`,
    detail: `${path}\n${(size / 1048576).toFixed(2)} MiB，上传后由网关和上游转写服务处理。`,
    options: [{ label: '允许上传', description: '只上传这一个文件' }, { label: '拒绝', description: '不读取也不上传' }],
  }] });
  if (!answer.answers.find(a => a.id === 'upload')?.selected.includes('允许上传')) throw new Error('用户未授权上传该文件');
}
const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
export function applyTranscribe(ctx, team) {
  let config;
  try { config = resolveIntegrations().effective.audio; } catch { config = undefined; }
  if (!config?.baseUrl) return; // not configured: no tool, nothing for the model to misuse
  const gate = async exec => { const role = await team.resolve(exec.agent); if (!role.search) throw new Error(`能力 ${role.capability} 未开启外部服务（search=true）`); };
  ctx.effect(() => ctx.tools.register({ name: 'cpa_transcribe', output,
    description: '语音转文字：上传一个本地音频文件到配置的转写网关。每个文件都需用户在确认框中授权；未授权不读取。',
    parameters: params({ file_path: { type: 'string', description: '本地音频文件路径（相对路径按工作目录解析）' }, language: { type: 'string', description: '可选：语言代码，如 zh、en' }, prompt: { type: 'string', description: '可选：术语提示，不得含凭据' } }, ['file_path']),
    async execute(args, exec) {
      await gate(exec);
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
      const path = isAbsolute(String(args.file_path)) ? String(args.file_path) : resolve(cwd, String(args.file_path));
      const max = audioSettings().config.maxBytes;
      const bytes = await readAudio(path, max, size => approve(ctx, exec, path, size)); // read only after approval
      const result = await transcribe({ bytes, name: basename(path), language: args.language, prompt: args.prompt }, { signal: exec.signal });
      return JSON.stringify(result);
    },
  }));
  if (config.statusPath) ctx.effect(() => ctx.tools.register({ name: 'cpa_transcribe_status', output, parameters: params({}, []),
    description: '查询语音转写网关的本地健康状态（不代表上游一定成功）。',
    async execute(_args, exec) { await gate(exec); return JSON.stringify(await audioStatus({ signal: exec.signal })); },
  }));
}
