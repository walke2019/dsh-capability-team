import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const base = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const out = resolve(base, 'packages/global-memory/shared');
const roots = ['memory-store.js','memory-embed.js','memory-openviking.js','memory-backends.js','memory-sync-queue.js','memory-redact.js','integrations-config.js','preset-guard.js','settings-schema.js'];
export async function buildShared(check = false) {
  const manifest = {};
  async function visit(name) {
    if (manifest[name]) return;
    const path = resolve(base, name);
    if (!path.startsWith(base + '/')) {
      if (relative(base, path).startsWith('..')) throw new Error('Source escapes repository');
    }
    const text = await readFile(path, 'utf8');
    manifest[name] = createHash('sha256').update(text).digest('hex');
    for (const m of text.matchAll(/\b(?:import|export)\s+(?:[^;'"()]*?\s+from\s*)?['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      await visit(relative(base, resolve(dirname(path), m[1] ?? m[2])).replaceAll('\\', '/'));
    }
    if (check) { if (await readFile(resolve(out, name), 'utf8') !== text) throw new Error(`Stale shared module: ${name}`); }
    else { await mkdir(dirname(resolve(out, name)), { recursive: true }); await writeFile(resolve(out, name), text); }
  }
  for (const name of roots) await visit(name);
  const json = JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2) + '\n';
  if (check) { if (await readFile(resolve(out, 'manifest.json'), 'utf8') !== json) throw new Error('Stale shared manifest'); }
  else await writeFile(resolve(out, 'manifest.json'), json);
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildShared(process.argv.includes('--check'));
