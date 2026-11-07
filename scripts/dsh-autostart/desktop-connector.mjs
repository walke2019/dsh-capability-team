import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sendControl } from './desktop-supervisor.mjs';

const require = createRequire(join(homedir(), '.dsh/profiles/package.json'));
const connector = await import(pathToFileURL(require.resolve('@aiwuk/connector-bundle')).href);
export const { name, inject, Config } = connector;

// 使用 Cordis 的正式服务隔离机制，仅替换连接器作用域中的退出接口。
// 保留原连接器的认证、权限检查、回执、插件与模型下发协议。
export async function apply(ctx, config) {
  const socket = process.env.DSH_DESKTOP_SUPERVISOR_SOCKET;
  const token = process.env.DSH_DESKTOP_SUPERVISOR_TOKEN;
  if (process.env.DSH_MOTHERSHIP_MANAGED !== '1' || !socket || !token) {
    ctx.logger(name).warn('当前桌面端未由监督器启动，中枢重启不可用');
    return connector.apply(ctx, config);
  }
  const request = { token, appPid: process.ppid };
  await sendControl(socket, { ...request, action: 'hello' });
  const scope = ctx.isolate('appExit');
  scope.provide('appExit', (code) => {
    if (code !== 75) throw new Error(`桌面重启适配器拒绝未知退出码：${code}`);
    sendControl(socket, { ...request, action: 'restart' }).catch((error) => {
      ctx.logger(name).error(`中枢桌面重启失败：${error.message}`);
    });
  });
  // 服务在父插件激活时发布，依赖它的子插件必须由 Cordis 调度后再启动。
  scope.plugin({
    name: 'mothership-desktop-link',
    inject: [...inject, 'appExit'],
    apply(child) {
      connector.apply(child, config);
      child.logger(name).info('桌面重启监督器握手成功，已启用中枢重启');
    }
  });
}
