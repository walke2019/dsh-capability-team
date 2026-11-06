#!/usr/bin/env node
// Bridge from the team memory hub to outside coding agents (e.g. a Claude Code UserPromptSubmit hook).
// Recall sees only project and global pitfalls/decisions: teammates' role-private reports and session memories
// never leave the hub, nothing is embedded or sent over the network, and recall never updates hit counters.
// Writes are explicit, local, redacted, and limited to project/global scope so every team role can recall them.
import { resolve } from 'node:path';
import { m } from '../i18n.js';
import { pathToFileURL } from 'node:url';
import { createMemoryStore, tokenize } from '../memory-store.js';
import { redactSecrets } from '../memory-redact.js';
import { defaultRoot, projectRoot } from '../theme.js';

export const RECALL_KINDS = ['pitfall', 'decision'];
export const RECALL_ROLE = 'external-agent'; // never a team role id, so role-scoped memories stay hidden
export const RECALL_HEADER = m('memory.recallHeader');
export const RECALL_DEFAULTS = { k: 6, maxChars: 2400, maxQuery: 2000, minShared: 2 };

export const WRITE_KINDS = ['pitfall', 'decision', 'note'];
export const WRITE_SCOPES = ['project', 'global'];
export const WRITE_LIMITS = { minText: 4, maxText: 2000, maxKey: 120, maxTags: 10, maxTag: 64 };

const meaningful = text => new Set(tokenize(text).filter(t => t.length >= 2));

/** Store one memory written on purpose by an outside agent; returns what was saved, never the raw input. */
export async function writeMemory({ kind, text, scope = 'project', key, tags = [], cwd, root = defaultRoot(), now = Date.now }) {
  if (!WRITE_KINDS.includes(kind)) throw new Error(`kind must be one of ${WRITE_KINDS.join(', ')}`);
  if (!WRITE_SCOPES.includes(scope)) throw new Error(`scope must be one of ${WRITE_SCOPES.join(', ')}`);
  const body = redactSecrets(String(text ?? '').replace(/\s+/g, ' ').trim());
  if (body.length < WRITE_LIMITS.minText) throw new Error('text is too short');
  if (body.length > WRITE_LIMITS.maxText) throw new Error(`text exceeds ${WRITE_LIMITS.maxText} characters`);
  const topic = key == null || key === '' ? null : redactSecrets(String(key).trim());
  if (topic !== null && (!topic || topic.length > WRITE_LIMITS.maxKey)) throw new Error(`key must be 1-${WRITE_LIMITS.maxKey} characters`);
  const labels = [...new Set(tags.map(t => redactSecrets(String(t).trim())).filter(Boolean))];
  if (labels.length > WRITE_LIMITS.maxTags || labels.some(t => t.length > WRITE_LIMITS.maxTag)) throw new Error(`at most ${WRITE_LIMITS.maxTags} tags of ${WRITE_LIMITS.maxTag} characters`);
  let target = { kind: 'global' };
  if (scope === 'project') {
    if (!cwd) throw new Error('project scope needs a working directory');
    target = { kind: 'project', project: projectRoot(cwd, root) };
  }
  const store = createMemoryStore(root, { now });
  const saved = await store.write({ scope: target, kind, text: body, tags: labels, key: topic, source: { member: RECALL_ROLE, at: now() } });
  return { saved: true, id: saved.memory.id, kind, scope, merged: saved.merged, superseded: saved.superseded.length, sync: 'local-only' };
}

/** Ranked memories for `query`, keeping only those sharing at least `minShared` multi-char tokens with it. */
export async function recall({ query, cwd, root = defaultRoot(), k = RECALL_DEFAULTS.k, minShared = RECALL_DEFAULTS.minShared }) {
  const text = redactSecrets(String(query ?? '').replace(/\s+/g, ' ').trim().slice(0, RECALL_DEFAULTS.maxQuery));
  if (!text) return [];
  const project = cwd ? projectRoot(cwd, root) : null;
  const store = createMemoryStore(root);
  const ranked = await store.search({ project, role: RECALL_ROLE, query: text, k: k * 3, kinds: RECALL_KINDS });
  const wanted = meaningful(text);
  return ranked.filter(({ memory }) => {
    if (memory.scope.kind !== 'project' && memory.scope.kind !== 'global') return false;
    if (minShared <= 0) return true;
    let shared = 0;
    for (const t of meaningful(memory.text)) if (wanted.has(t) && ++shared >= minShared) return true;
    return false;
  }).slice(0, k);
}

/** Injection block within `maxChars`, header included; empty when nothing fits. */
export function formatRecall(results, maxChars = RECALL_DEFAULTS.maxChars) {
  const lines = []; let used = RECALL_HEADER.length;
  for (const { memory: m } of results) {
    const line = `- [${m.kind}${m.scope.kind === 'global' ? '·global' : ''}] ${redactSecrets(m.text)}`;
    if (used + 1 + line.length > maxChars) continue;
    used += 1 + line.length; lines.push(line);
  }
  return lines.length ? [RECALL_HEADER, ...lines].join('\n') : '';
}

/** Hook payload (Claude Code UserPromptSubmit JSON on stdin) → hook output JSON string, or '' to add nothing. */
export async function hookOutput(payload, options = {}) {
  const prompt = payload?.prompt;
  if (typeof prompt !== 'string' || !prompt.trim()) return '';
  const block = formatRecall(await recall({ query: prompt, cwd: payload.cwd || process.cwd(), ...options }), options.maxChars);
  if (!block) return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: block } });
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (['--cwd', '--k', '--kind', '--scope', '--key', '--tags'].includes(a)) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'hook') {
    // A recall failure must never block the user's prompt: swallow everything and add no context.
    try { const out = await hookOutput(JSON.parse(await readStdin() || '{}')); if (out) process.stdout.write(out); }
    catch { /* degrade silently */ }
    return 0;
  }
  if (command === 'search') {
    const args = parseArgs(rest);
    const k = Math.min(20, Math.max(1, Number.parseInt(args.k ?? RECALL_DEFAULTS.k, 10) || RECALL_DEFAULTS.k));
    const results = await recall({ query: args._.join(' '), cwd: args.cwd ?? process.cwd(), k });
    process.stdout.write(JSON.stringify(results.map(({ memory: m, score }) => ({
      id: m.id, kind: m.kind, scope: m.scope.kind, tags: m.tags, score: Number(score.toFixed(5)), text: redactSecrets(m.text),
    })), null, 2) + '\n');
    return 0;
  }
  if (command === 'write') {
    // Text comes from the arguments, or from stdin when none are given (safer for long or quoted text).
    const args = parseArgs(rest);
    const text = args._.length ? args._.join(' ') : await readStdin();
    try {
      const result = await writeMemory({ kind: args.kind, scope: args.scope ?? 'project', key: args.key, tags: args.tags ? args.tags.split(',') : [], text, cwd: args.cwd ?? process.cwd() });
      process.stdout.write(JSON.stringify(result) + '\n');
      return 0;
    } catch (error) {
      process.stderr.write(JSON.stringify({ saved: false, error: error.message }) + '\n');
      return 1;
    }
  }
  process.stderr.write([
    'usage: memory-cli.mjs hook < payload.json',
    '       memory-cli.mjs search <query> [--cwd dir] [--k n]',
    '       memory-cli.mjs write --kind pitfall|decision|note [--scope project|global] [--key topic] [--tags a,b] [--cwd dir] [text | < text]',
  ].join('\n') + '\n');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
