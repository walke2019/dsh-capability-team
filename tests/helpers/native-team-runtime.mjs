import { readFileSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';

// Opt in to installed, read-only runtime verification; ordinary CI needs no Desktop install.
export const archive = process.env.DSH_NATIVE_ASAR;
export const available = Boolean(archive && existsSync(archive));
export async function nativeRuntime() {
  const fd = openSync(archive, 'r');
  const prefix = Buffer.alloc(16);
  readSync(fd, prefix, 0, prefix.length, 0);
  const header = Buffer.alloc(prefix.readUInt32LE(12));
  readSync(fd, header, 0, header.length, 16);
  const index = JSON.parse(header);
  const readNative = path => {
    const entry = path.split('/').reduce((node, key) => node.files[key], index);
    const bytes = Buffer.alloc(entry.size);
    readSync(fd, bytes, 0, bytes.length, 8 + prefix.readUInt32LE(4) + Number(entry.offset));
    return bytes.toString('utf8');
  };
  const paths = {
    '@deepseek-ai/cosmokit': 'lib/index.js',
    '@deepseek-ai/cordis': 'lib/index.js',
    '@deepseek-ai/cordis-plugin-loader': 'lib/index.js',
    '@deepseek-ai/cordis-plugin-include': 'lib/index.js',
    'js-yaml': 'dist/js-yaml.mjs',
  };
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (paths[specifier]) return { url: `native-team:${specifier}`, shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (!url.startsWith('native-team:')) return next(url, context);
      const name = url.slice('native-team:'.length);
      return { format: 'module', source: readNative(`dsh/node_modules/${name}/${paths[name]}`), shortCircuit: true };
    },
  });
  const loader = await import('@deepseek-ai/cordis-plugin-loader');
  const include = await import('@deepseek-ai/cordis-plugin-include');
  const yaml = await import('js-yaml');
  const parse = text => yaml.load(text, { schema: include.entryListSchema });
  return {
    ...loader, ...include, parse,
    patch: parse(readFileSync(process.env.CAPABILITY_TEAM_PATCH || join(import.meta.dirname, '../../cordis.patch.yml'), 'utf8')),
    official: parse(readNative('dsh/node_modules/@deepseek-ai/dsh-experimental-agent-team-profile/cordis.patch.yml')),
    // Execute the exact native public apply body at the non-member boundary. The
    // install function must never be reached for standard agents (including events).
    toolApply: new Function('install', `${readNative('dsh/node_modules/@deepseek-ai/dsh-experimental-tool-agent-team/lib/index.js').match(/function apply\(ctx, config = \{\}\) \{[\s\S]*?\n\}/)[0]}; return apply;`)(() => { throw new Error('non-Team agent reached native tool installation'); }),
    close() { hooks.deregister(); closeSync(fd); },
  };
}
