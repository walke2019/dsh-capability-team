// Runs one task on an OpenCode free model through OpenCode's built-in `build` agent.
// The agent is overridden inline (OPENCODE_CONFIG_CONTENT) for this process only: free model, title
// generation off (it would use the user's possibly paid small_model), and an explicit permission set.
// Agent-level permission beats OPENCODE_PERMISSION, so it is written in both places.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { freeArgs } from './roles.js';
import { findOpenCode, resolveFreeModels } from './opencode.js';

export const AGENT = 'build';
export const FREE_TOOLS = ['none', 'read', 'write'];
// OpenCode evaluates rules in order and the last match wins, so each catch-all comes first.
const SECRET_FILES = ['*.env', '*.env.*', '*.pem', '*.key', '*.p12', '*.pfx', '*id_rsa*', '*id_ed25519*', '*credentials*', '*secret*'];
const secrets = action => Object.fromEntries(SECRET_FILES.map(p => [p, action]));
const NO_MATCH = '<capability-team:no-file>';
/**
 * Permission sets per tool level. Everything not listed (shell, web, subagents, todo, skills, MCP) stays
 * denied. `none` keeps one never-matching read rule because OpenCode's free endpoint rejects requests
 * that carry no tool at all ("Free usage limit reached"), observed 2026-10 with opencode 1.18.
 */
export const PERMISSIONS = Object.freeze({
  none: { '*': 'deny', read: { '*': 'deny', [NO_MATCH]: 'allow' } },
  read: { '*': 'deny', read: { '*': 'allow', ...secrets('deny') }, glob: 'allow', grep: 'allow', external_directory: 'deny' },
  write: { '*': 'deny', read: { '*': 'allow', ...secrets('deny') }, glob: 'allow', grep: 'allow', edit: { '*': 'allow', ...secrets('deny') }, external_directory: 'deny' },
});
const PROMPT = {
  none: '只依据下方提供的材料完成任务，不使用任何工具。',
  read: '你可以读取和搜索当前项目内的文件，但不能修改文件、执行命令或联网。',
  write: '你可以读取、新建和编辑当前项目内的文件，但不能执行命令、联网或访问项目外路径；密钥类文件不可读写。完成后逐项列出改动过的文件。',
};
export function inlineConfig(model, tools) {
  return { small_model: model, agent: { title: { disable: true }, [AGENT]: { model, permission: PERMISSIONS[tools] } } };
}
// Provider failures OpenCode retries forever; seeing one means this model cannot succeed now.
const UNAVAILABLE = /Free usage limit reached|Unauthorized|Model not found|Insufficient|quota|rate limit/i;

function runOnce(exe, prompt, model, allowed, { cwd, signal, launch, tools }) {
  // Validate the user's input limit before adding our internal instructions.
  const args = freeArgs(prompt, model, allowed);
  args[args.length - 1] = `${PROMPT[tools]}\n\n${prompt}`;
  return new Promise((resolve, reject) => {
    const child = launch(exe, [...args.slice(0, -2), '--agent', AGENT, '--pure', '--print-logs', '--log-level', 'ERROR', ...args.slice(-2)], {
      cwd, shell: false, windowsHide: true,
      env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(inlineConfig(model, tools)), OPENCODE_PERMISSION: JSON.stringify(PERMISSIONS[tools]) },
      stdio: ['ignore', 'pipe', 'pipe'], signal,
    });
    let output = ''; let errors = ''; let oversized = false; let timedOut = false; let unavailable;
    let receivedBytes = 0; let errorLine = '';
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    const inspectError = line => {
      const hit = !unavailable && line.match(/error\.error="?([^"\r\n]*)/);
      if (hit && UNAVAILABLE.test(hit[1])) { unavailable = hit[1].slice(0, 300); child.kill(); }
    };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 300000);
    const collect = (data, error = false) => {
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
      receivedBytes += bytes.length;
      if (receivedBytes > 4 * 1024 * 1024) { oversized = true; child.kill(); return; }
      if (!error) { output += stdoutDecoder.write(bytes); return; }
      const decoded = stderrDecoder.write(bytes);
      errors += decoded;
      const lines = (errorLine + decoded).split(/\r?\n/);
      errorLine = lines.pop();
      for (const line of lines) inspectError(line);
    };
    child.stdout.on('data', data => collect(data));
    child.stderr.on('data', data => collect(data, true));
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, killedSignal) => {
      clearTimeout(timer);
      output += stdoutDecoder.end();
      const tail = stderrDecoder.end();
      errors += tail;
      inspectError(errorLine + tail);
      if (unavailable) return reject(Object.assign(new Error(`${model} 不可用：${unavailable}`), { unavailable: true }));
      if (timedOut || oversized || code !== 0 || killedSignal) return reject(new Error(`OpenCode 失败，退出码 ${code}，信号 ${killedSignal || '无'}；${errors.slice(-2000)}`));
      try {
        const events = output.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
        const failure = events.find(event => event.type === 'error');
        if (failure) throw new Error(JSON.stringify(failure));
        const texts = events.filter(event => event.type === 'text').map(event => event.part?.text || '').filter(Boolean);
        if (!texts.length) throw new Error('未收到文本结果');
        const toolCalls = events.filter(event => event.type === 'tool_use')
          .map(event => ({ tool: event.part?.tool, status: event.part?.state?.status, ...(event.part?.state?.input?.filePath ? { file: event.part.state.input.filePath } : {}) }));
        resolve({ model, text: texts.join('\n'), tools, toolCalls });
      } catch (error) { reject(error); }
    });
  });
}

/**
 * Tries each allowed free model in order; only "model unavailable" moves to the next one. Other
 * failures are reported as they are. Never falls back to a paid model.
 */
export async function runFreeWorker(prompt, { executable, models, cwd = process.cwd(), signal, launch = spawn, tools = 'none', resolveModels = resolveFreeModels, locate = findOpenCode } = {}) {
  if (!FREE_TOOLS.includes(tools)) throw new Error(`免费模型工具级别须为 ${FREE_TOOLS.join(' / ')}`);
  const exe = executable ?? await locate();
  if (/\.(?:cmd|bat|ps1)$/i.test(exe)) throw new Error('必须使用原生 OpenCode 可执行文件，禁止 shell 包装脚本');
  const allowed = await resolveModels(models ?? []);
  const skipped = [];
  for (const model of allowed) {
    try {
      const result = await runOnce(exe, prompt, model, allowed, { cwd, signal, launch, tools });
      return { ...result, ...(skipped.length ? { skipped } : {}) };
    } catch (error) {
      if (!error.unavailable) throw error;
      skipped.push(error.message);
    }
  }
  throw new Error(`所有免费模型都不可用，不改用付费模型：\n${skipped.join('\n')}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFreeWorker(process.argv.slice(2).join(' ')).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
