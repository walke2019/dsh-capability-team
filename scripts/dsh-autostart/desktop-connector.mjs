import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sendControl } from './desktop-supervisor.mjs';

const require = createRequire(join(homedir(), '.dsh/profiles/package.json'));
const connector = await import(pathToFileURL(require.resolve('@aiwuk/connector-bundle')).href);
export const { name, inject, Config } = connector;

// Use Cordis service isolation to replace only the exit hook inside the connector scope.
// The connector's auth, permission checks, receipts, plugin and model delivery stay unchanged.
export async function apply(ctx, config) {
  const socket = process.env.DSH_DESKTOP_SUPERVISOR_SOCKET;
  const token = process.env.DSH_DESKTOP_SUPERVISOR_TOKEN;
  if (process.env.DSH_MOTHERSHIP_MANAGED !== '1' || !socket || !token) {
    ctx.logger(name).warn('desktop was not started by the supervisor; Mothership restart is unavailable');
    return connector.apply(ctx, config);
  }
  const request = { token, appPid: process.ppid };
  await sendControl(socket, { ...request, action: 'hello' });
  const scope = ctx.isolate('appExit');
  scope.provide('appExit', (code) => {
    if (code !== 75) throw new Error(`desktop restart adapter refused unknown exit code: ${code}`);
    sendControl(socket, { ...request, action: 'restart' }).catch((error) => {
      ctx.logger(name).error(`Mothership desktop restart failed: ${error.message}`);
    });
  });
  // The service is published when the parent plugin activates; dependants must start through Cordis scheduling.
  scope.plugin({
    name: 'mothership-desktop-link',
    inject: [...inject, 'appExit'],
    apply(child) {
      connector.apply(child, config);
      child.logger(name).info('desktop restart supervisor handshake ok; Mothership restart enabled');
    }
  });
}
