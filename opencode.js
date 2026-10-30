// Locating OpenCode and its free models on any platform. Nothing here names a user, a machine or a
// fixed model list: the executable comes from an env override or PATH, the models from OpenCode's own
// catalog cache, filtered to zero-cost, non-deprecated entries.
import { access, readFile, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

const ENV_EXE = 'CAPABILITY_TEAM_OPENCODE_EXECUTABLE';
const ENV_CATALOG = 'CAPABILITY_TEAM_OPENCODE_MODELS';
const pathApi = platform => (platform === 'win32' ? win32 : posix);

/** Candidate native executables, most specific first. Shell shims (.cmd/.ps1) are never returned. */
export function openCodeCandidates({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  const p = pathApi(platform);
  const dirs = (env.PATH ?? env.Path ?? '').split(p.delimiter).filter(Boolean);
  const list = [];
  for (const dir of dirs) {
    if (platform === 'win32') {
      list.push(p.join(dir, 'opencode.exe'));
      // npm on Windows puts a .cmd shim on PATH; the native binary sits in the package next to it.
      list.push(p.join(dir, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
    } else list.push(p.join(dir, 'opencode'));
  }
  // Location used by the official install script on every platform.
  list.push(p.join(home, '.opencode', 'bin', platform === 'win32' ? 'opencode.exe' : 'opencode'));
  return [...new Set(list)];
}

export async function findOpenCode({ env = process.env, platform = process.platform, home = homedir(), exists = defaultExists(platform) } = {}) {
  if (env[ENV_EXE]) return env[ENV_EXE];
  for (const file of openCodeCandidates({ env, platform, home })) if (await exists(file)) return file;
  throw new Error(`未找到 OpenCode 可执行文件：请安装 OpenCode 并确保 opencode 在 PATH 中，或设置环境变量 ${ENV_EXE} 指向原生可执行文件`);
}
function defaultExists(platform) {
  return file => access(file, platform === 'win32' ? constants.F_OK : constants.X_OK).then(() => true, () => false);
}

/** OpenCode keeps its model catalog under the XDG cache directory on all platforms. */
export function catalogFile({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  if (env[ENV_CATALOG]) return env[ENV_CATALOG];
  const p = pathApi(platform);
  return p.join(env.XDG_CACHE_HOME || p.join(home, '.cache'), 'opencode', 'models.json');
}

const isZero = v => v === undefined || v === 0;
/** Zero-cost, non-deprecated, tool-capable models of OpenCode's own provider, newest first. */
export function freeModelsFromCatalog(catalog) {
  const models = catalog?.opencode?.models ?? {};
  return Object.entries(models)
    .filter(([, m]) => m && m.cost && m.cost.input === 0 && m.cost.output === 0 && isZero(m.cost.cache_read) && isZero(m.cost.cache_write)
      && m.status !== 'deprecated' && m.tool_call !== false)
    .sort(([a, x], [b, y]) => String(y.release_date ?? '').localeCompare(String(x.release_date ?? '')) || a.localeCompare(b))
    .map(([id]) => `opencode/${id}`);
}

/**
 * Models the free channel may use. A configured list only orders and narrows; every entry must still be
 * free in the catalog, so a paid model can never be configured in by mistake.
 */
export async function resolveFreeModels(configured = [], { file = catalogFile(), read = readFile } = {}) {
  let catalog;
  try { catalog = JSON.parse(await read(file, 'utf8')); } catch (error) {
    throw new Error(`无法读取 OpenCode 模型目录 ${file}（${error.code ?? error.message}）：先运行一次 opencode models 生成目录，或设置 ${ENV_CATALOG}`);
  }
  const free = freeModelsFromCatalog(catalog);
  if (!configured.length) {
    if (!free.length) throw new Error('OpenCode 模型目录中没有可用的免费模型');
    return free;
  }
  const rejected = configured.filter(m => !free.includes(m));
  if (rejected.length) throw new Error(`${rejected.join('、')} 不是 OpenCode 目录中的免费模型（不存在、已弃用或成本不为 0），不允许使用；当前免费模型：${free.join('、') || '无'}`);
  return configured;
}
