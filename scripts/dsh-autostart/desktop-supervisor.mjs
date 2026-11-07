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

// 每次启动更换令牌，仅允许当前受管桌面进程申请重启。
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
    if (this.child) throw new Error('桌面端仍在运行，拒绝重复启动');
    this.token = randomBytes(32).toString('base64url');
    this.child = this.launch(this.token);
    const child = this.child;
    this.phase = 'running';
    this.publish();
    child.once('exit', (code, signal) => this.exited(child, code, signal));
    child.once('error', (error) => {
      this.log(`桌面进程启动失败：${error.message}`);
      this.exited(child, null, 'spawn-error');
    });
  }

  authenticate(request) {
    const supplied = Buffer.from(typeof request.token === 'string' ? request.token : '');
    const expected = Buffer.from(this.token);
    if (!this.child || !Number.isSafeInteger(request.appPid) || request.appPid !== this.child.pid ||
        expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new Error('拒绝非当前受管桌面进程的请求');
    }
  }

  async request(request) {
    this.authenticate(request);
    if (request.action === 'hello') return { ok: true, appPid: this.child.pid };
    if (request.action !== 'restart') throw new Error('不支持的控制操作');
    if (this.phase !== 'running') throw new Error('已有重启正在处理，拒绝重复操作');
    this.phase = 'stopping';
    this.publish();
    this.log(`收到中枢重启，正在优雅退出桌面进程 ${this.child.pid}`);
    try {
      await this.terminate(this.child.pid);
    } catch (error) {
      // 若终止过程中已经完成退出，不得把新实例误记为旧实例。
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
        this.publish({ error: '优雅退出超时；未强杀，未启动第二个实例' });
        this.log('优雅退出超时，取消本次重启；保留原实例');
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
    this.log(`桌面进程已退出，code=${code}，重启=${restart}`);
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
    socket.setTimeout(5000, () => socket.destroy(new Error('桌面监督器响应超时')));
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      data += chunk;
      if (data.length > 4096) return socket.destroy(new Error('控制响应过长'));
      if (!data.includes('\n')) return;
      try {
        const result = JSON.parse(data.slice(0, data.indexOf('\n')));
        socket.end();
        if (result.ok !== true) reject(new Error(result.error ?? '重启请求失败'));
        else resolve(result);
      } catch (error) { socket.destroy(); reject(error); }
    });
    socket.once('error', reject);
    socket.once('end', () => { if (!data.includes('\n')) reject(new Error('控制连接提前关闭')); });
  });
}

async function main() {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700);
  // 仅在确认无活跃监听者后清理残留的本机套接字。
  const inUse = await new Promise((resolve) => {
    const probe = createConnection(socketPath);
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', (error) => resolve(error.code !== 'ENOENT' && error.code !== 'ECONNREFUSED'));
  });
  if (inUse) throw new Error('已有桌面监督器运行，拒绝重复启动');
  if (hasDesktopProcess()) {
    throw new Error('已有非本监督器启动的桌面端，请先正常退出再启动托管');
  }
  await unlink(socketPath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  const log = (message) => console.log(`[${new Date().toISOString()}] ${message}`);
  let pendingSave = Promise.resolve();
  const save = (state) => {
    pendingSave = pendingSave.then(() => writeFile(statusPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 }));
    pendingSave.catch((error) => console.error(`状态落盘失败：${error.message}`));
  };
  const helper = join(dirname(fileURLToPath(import.meta.url)), 'desktop-terminate');
  const manager = new DesktopLifecycle({
    log, save,
    launch: (token) => {
      if (hasDesktopProcess()) throw new Error('已有独立启动的桌面端，拒绝重复启动');
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
      helperProcess.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`退出请求失败：${errorText}`)));
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
        // 本机套接字仅当前用户可读写；启动不涉及退出正在运行的实例。
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
  log('桌面监督器已启动，仅响应当前实例的中枢重启请求');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const operation = process.argv[2] === '--start'
    ? sendControl(socketPath, { action: 'start' }).then((result) => console.log(JSON.stringify(result)))
    : main();
  operation.catch((error) => { console.error(error.message); process.exitCode = 1; });
}
