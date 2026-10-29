// Explicitly launched through DSH shell: node free-worker.mjs <task>.
// No shell interpolation; external OpenCode tools disabled for analysis-only work.
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { freeArgs } from './roles.js';
export async function runFreeWorker(prompt, { executable = process.env.CAPABILITY_TEAM_OPENCODE_EXECUTABLE, cwd = process.cwd(), signal, launch = spawn } = {}) {
  const exe = executable || (process.platform === 'win32'
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe') : 'opencode');
  if (/\.(?:cmd|bat|ps1)$/i.test(exe)) throw new Error('必须配置原生 OpenCode 可执行文件，禁止 shell 包装脚本');
  const args = freeArgs(prompt);
  if (exe.includes('/') || exe.includes('\\')) await access(exe);
  return new Promise((resolve, reject) => {
    const child = launch(exe, [...args.slice(0, -2), '--pure', ...args.slice(-2)], {
      cwd, shell: false, windowsHide: true,
      env: { ...process.env, OPENCODE_PERMISSION: JSON.stringify({ '*': 'deny' }) },
      stdio: ['ignore', 'pipe', 'pipe'], signal,
    });
    let output = ''; let errors = ''; let oversized = false; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 120000);
    const collect = (data, error = false) => {
      if (output.length + errors.length + data.length > 1024 * 1024) { oversized = true; child.kill(); return; }
      if (error) errors += data; else output += data;
    };
    child.stdout.on('data', data => collect(data));
    child.stderr.on('data', data => collect(data, true));
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, killedSignal) => {
      clearTimeout(timer);
      if (timedOut || oversized || code !== 0 || killedSignal) return reject(new Error(`OpenCode 失败，退出码 ${code}，信号 ${killedSignal || '无'}；${errors.slice(-2000)}`));
      try {
        const events = output.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
        const failure = events.find(event => event.type === 'error');
        if (failure) throw new Error(JSON.stringify(failure));
        const texts = events.filter(event => event.type === 'text').map(event => event.part?.text || '').filter(Boolean);
        if (!texts.length) throw new Error('未收到文本结果');
        resolve({ model: 'opencode/deepseek-v4.1-flash-free', text: texts.join('\n'), requestedToolPolicy: 'deny-all' });
      } catch (error) { reject(error); }
    });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFreeWorker(process.argv.slice(2).join(' ')).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
