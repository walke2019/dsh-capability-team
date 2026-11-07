import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, chmod, writeFile, unlink } from 'node:fs/promises';
import { createServer, createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const appPath = '/Applications/DeepSeek Harness.app';
const appBinary = `${appPath}/Contents/MacOS/DeepSeek Harness`;
const stateDir = join(homedir(), '.dsh-autostart');
const socketPath = join(stateDir, 'desktop-supervisor.sock');
const statusPath = join(stateDir, 'desktop-supervisor.json');

function hasDesktopProcess() {
  const processes = execFileSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8' });
  return processes.split('\n').some((line) => line === appBinary || line.startsWith(`${appBinary} `));
}

// A new token per launch: only the currently managed desktop process may request a restart.
export class DesktopLifecycle {
  constructor({ launch, terminate, save, log, schedule = setTimeout, cancel = clearTimeout, timeout = 45000 }) {
    Object.assign(this, { launch, terminate, save, log, schedule, cancel, timeout });
    this.child = null;
    this.token = '';
    this.phase = 'idle';
    this.restarts = 0;
    this.deadline = null;
  }

  publish(extra = {}) {
    this.save({ supervisorPid: process.pid, appPid: this.child?.pid ?? null,
      phase: this.phase, restarts: this.restarts, time: new Date().toISOString(), ...extra });
  }

  start() {
    if (this.child) throw new Error('desktop is still running; refusing a second launch');
    this.token = randomBytes(32).toString('base64url');
    this.child = this.launch(this.token);
    const child = this.child;
    this.phase = 'running';
    this.publish();
    child.once('exit', (code, signal) => this.exited(child, code, signal));
    child.once('error', (error) => {
      this.log(`desktop process failed to start: ${error.message}`);
      this.exited(child, null, 'spawn-error');
    });
  }

  authenticate(request) {
    const supplied = Buffer.from(typeof request.token === 'string' ? request.token : '');
    const expected = Buffer.from(this.token);
    if (!this.child || !Number.isSafeInteger(request.appPid) || request.appPid !== this.child.pid ||
        expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new Error('refused: request is not from the currently managed desktop process');
    }
  }

  async request(request) {
    this.authenticate(request);
    if (request.action === 'hello') return { ok: true, appPid: this.child.pid };
    if (request.action !== 'restart') throw new Error('unsupported control action');
    if (this.phase !== 'running') throw new Error('a restart is already in progress; refusing a duplicate');
    this.phase = 'stopping';
    this.publish();
    this.log(`Mothership restart received; gracefully quitting desktop process ${this.child.pid}`);
    try {
      await this.terminate(this.child.pid);
    } catch (error) {
      // If the process already exited during termination, never mistake the new instance for the old one.
      if (this.phase === 'stopping') {
        this.phase = 'running';
        this.publish({ error: error.message });
      }
      throw error;
    }
    if (this.phase === 'stopping') {
      this.deadline = this.schedule(() => {
        this.deadline = null;
        this.phase = 'running';
        this.publish({ error: 'graceful quit timed out; not killed, no second instance started' });
        this.log('graceful quit timed out; restart cancelled, original instance kept');
      }, this.timeout);
    }
    return { ok: true, accepted: true };
  }

  exited(child, code, signal) {
    if (this.child !== child) return;
    const restart = this.phase === 'stopping';
    if (this.deadline) this.cancel(this.deadline);
    this.deadline = null;
    this.child = null;
    this.token = '';
    this.phase = restart ? 'restarting' : 'stopped';
    this.publish({ exitCode: code, signal });
    this.log(`desktop process exited, code=${code}, restart=${restart}`);
    if (restart) {
      this.restarts++;
      this.schedule(() => this.start(), 750);
    }
  }
}

export function sendControl(path, request) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let data = '';
    socket.setTimeout(5000, () => socket.destroy(new Error('desktop supervisor response timed out')));
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      data += chunk;
      if (data.length > 4096) return socket.destroy(new Error('control response too long'));
      if (!data.includes('\n')) return;
      try {
        const result = JSON.parse(data.slice(0, data.indexOf('\n')));
        socket.end();
        if (result.ok !== true) reject(new Error(result.error ?? 'restart request failed'));
        else resolve(result);
      } catch (error) { socket.destroy(); reject(error); }
    });
    socket.once('error', reject);
    socket.once('end', () => { if (!data.includes('\n')) reject(new Error('control connection closed early')); });
  });
}

async function main() {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700);
  // Remove a stale local socket only after confirming nothing is listening on it.
  const inUse = await new Promise((resolve) => {
    const probe = createConnection(socketPath);
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', (error) => resolve(error.code !== 'ENOENT' && error.code !== 'ECONNREFUSED'));
  });
  if (inUse) throw new Error('a desktop supervisor is already running; refusing a second one');
  if (hasDesktopProcess()) {
    throw new Error('a desktop instance not started by this supervisor is running; quit it normally before starting managed mode');
  }
  await unlink(socketPath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);
  let pendingSave = Promise.resolve();
  const save = (state) => {
    pendingSave = pendingSave.then(() => writeFile(statusPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 }));
    pendingSave.catch((error) => console.error(`failed to persist state: ${error.message}`));
  };
  const helper = join(dirname(fileURLToPath(import.meta.url)), 'desktop-terminate');
  const manager = new DesktopLifecycle({
    log, save,
    launch: (token) => {
      if (hasDesktopProcess()) throw new Error('a standalone desktop instance is running; refusing a second launch');
      const env = { ...process.env, DSH_MOTHERSHIP_MANAGED: '1',
        DSH_DESKTOP_SUPERVISOR_SOCKET: socketPath, DSH_DESKTOP_SUPERVISOR_TOKEN: token };
      delete env.ELECTRON_RUN_AS_NODE;
      return spawn(appBinary, [], { env, stdio: ['ignore', 'inherit', 'inherit'] });
    },
    terminate: (pid) => new Promise((resolve, reject) => {
      const helperProcess = spawn(helper, [String(pid)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let errorText = '';
      helperProcess.stderr.on('data', (chunk) => { errorText = `${errorText}${chunk}`.slice(-2048); });
      helperProcess.once('error', reject);
      helperProcess.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`quit request failed: ${errorText}`)));
    })
  });
  const server = createServer((socket) => {
    let data = '';
    let handled = false;
    socket.setTimeout(5000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      if (handled) return;
      data += chunk;
      if (data.length > 4096) return socket.destroy();
      if (!data.includes('\n')) return;
      handled = true;
      Promise.resolve().then(() => {
        const request = JSON.parse(data.slice(0, data.indexOf('\n')));
        // The local socket is readable and writable by the current user only; launching never quits a running instance.
        if (request.action === 'start') {
          if (!manager.child && manager.phase === 'stopped') manager.start();
          return { ok: true, appPid: manager.child?.pid ?? null, phase: manager.phase };
        }
        return manager.request(request);
      })
        .then((result) => socket.end(`${JSON.stringify(result)}\n`))
        .catch((error) => socket.end(`${JSON.stringify({ ok: false, error: error.message })}\n`));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  manager.start();
  log('desktop supervisor started; answering Mothership restart requests for the current instance only');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const operation = process.argv[2] === '--start'
    ? sendControl(socketPath, { action: 'start' }).then((result) => console.log(JSON.stringify(result)))
    : main();
  operation.catch((error) => { console.error(error.message); process.exitCode = 1; });
}
