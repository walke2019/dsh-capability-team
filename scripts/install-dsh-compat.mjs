// CI-only installer: keep the resolved matrix version, refresh metadata, retry transient npm failures.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
const RETRYABLE = new Set(['ETARGET', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'E408', 'E429', 'E500', 'E502', 'E503', 'E504']);
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
export function retryableFailure(result) {
  if (result.signal || result.error || result.status === 0) return false;
  const codes = [...String(result.stderr ?? '').matchAll(/^npm (?:error|ERR!) code (\S+)[\t ]*\r?$/gm)].map(match => match[1]);
  return codes.length > 0 && codes.every(code => RETRYABLE.has(code));
}
export function installArgs(version) {
  if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('Expected one exact resolved DSH version, not a dist-tag or range');
  return ['install', '--global', '--no-audit', '--no-fund', '--prefer-online', `@deepseek-ai/dsh@${version}`];
}
function runNpm(args, { platform = process.platform } = {}) {
  return new Promise(resolve => {
    // npm.cmd requires cmd.exe on Windows; args contain only fixed flags and a validated version.
    const child = spawn(platform === 'win32' ? 'npm.cmd' : 'npm', args, { shell: platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '', error;
    child.stdout.on('data', chunk => process.stdout.write(chunk));
    child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
    child.on('error', value => { error = value; });
    child.on('close', (status, signal) => resolve({ status, signal, error, stderr }));
  });
}
export async function installDsh(version, { run = runNpm, wait = delay, log = console.error } = {}) {
  const args = installArgs(version);
  let result;
  for (let attempt = 1; attempt <= 3; attempt++) {
    result = await run([...args]);
    if (result.status === 0 || attempt === 3 || !retryableFailure(result)) return result;
    const milliseconds = attempt * 5000;
    log(`Transient npm install failure for @deepseek-ai/dsh@${version}; retry ${attempt + 1}/3 in ${milliseconds / 1000}s`);
    await wait(milliseconds);
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await installDsh(process.argv[2]);
    if (result.signal) process.kill(process.pid, result.signal);
    else process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
