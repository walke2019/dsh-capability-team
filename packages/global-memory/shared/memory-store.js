// Memory store: one JSONL file per project plus a global file, a BM25 full-text index built in memory
// (Latin words + CJK character bigrams), optional vectors, and hybrid ranking by reciprocal rank fusion.
// Writes merge near-duplicates instead of piling them up; ranking decays with age and rises with use.
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cosine } from './memory-embed.js';
import { acquireLock } from './theme.js';
/** Several DSH processes (Desktop, `dsh web`, profiles) share the files: writes and compaction take a file lock. */
async function withFileLock(path, fn) {
  let handle = null;
  for (let attempt = 0; !handle; attempt++) {
    try { handle = await acquireLock(`${path}.lock`); }
    catch (error) { if (attempt >= 100 || ['EACCES', 'EPERM', 'ENOENT'].includes(error.code) && attempt >= 3) throw error; await new Promise(r => setTimeout(r, 30)); }
  }
  try { return await fn(); } finally { await handle.close().catch(() => {}); await unlink(`${path}.lock`).catch(() => {}); }
}
export const MEMORY_KINDS = ['handoff', 'result', 'pitfall', 'decision', 'note'];
export const MEMORY_LIMITS = { maxText: 2000, maxPerFile: 2000, halfLifeDays: 30, pruneDays: 180, duplicateCosine: 0.92, injectChars: 2400 };
const DAY = 86400000;
/** Tokens for BM25: lowercase Latin/digit words and CJK unigrams + bigrams. */
/** Superseded JSONL lines tolerated beyond twice the live count before a file is rewritten. */
const COMPACT_SLACK = 200;
export function tokenize(text) {
  const out = [];
  const s = String(text ?? '').toLowerCase();
  for (const w of s.match(/[a-z0-9_][a-z0-9_.-]*/g) ?? []) out.push(w);
  const cjk = s.match(/[㐀-鿿豈-﫿]+/g) ?? [];
  for (const run of cjk) { for (let i = 0; i < run.length; i++) { out.push(run[i]); if (i + 1 < run.length) out.push(run.slice(i, i + 2)); } }
  return out;
}
const normText = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const fileKey = project => (project ? createHash('sha256').update(project).digest('hex').slice(0, 32) : 'global');
/** Whether a memory is visible to a reader: its project, and role/session scopes when narrower. */
export function visible(m, { project, role, session }) {
  if (m.supersededBy) return false;
  if (m.scope.kind === 'global') return true;
  if (m.scope.project !== project) return false;
  if (m.scope.kind === 'role') return !role || m.scope.role === role;
  if (m.scope.kind === 'session') return m.scope.session === session;
  return true;
}
function bm25(docs, query) {
  const q = [...new Set(tokenize(query))];
  if (!q.length || !docs.length) return new Map();
  const tf = docs.map(d => { const m = new Map(); for (const t of tokenize(d.text)) m.set(t, (m.get(t) ?? 0) + 1); return m; });
  const lengths = tf.map(m => [...m.values()].reduce((a, b) => a + b, 0));
  const avg = lengths.reduce((a, b) => a + b, 0) / docs.length || 1;
  const scores = new Map();
  for (const term of q) {
    const df = tf.filter(m => m.has(term)).length;
    if (!df) continue;
    const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
    tf.forEach((m, i) => {
      const f = m.get(term); if (!f) return;
      scores.set(docs[i].id, (scores.get(docs[i].id) ?? 0) + idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * lengths[i] / avg)));
    });
  }
  return scores;
}
/** Hybrid rank: RRF over BM25 and cosine, times recency decay and a small boost for memories that helped before. */
export function rank(docs, query, queryVector, { now = Date.now(), halfLifeDays = MEMORY_LIMITS.halfLifeDays, vectorModel } = {}) {
  const text = bm25(docs, query);
  const byText = [...text.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  // Vectors from another model or dimension count are not comparable, even when the lengths match.
  const byVec = queryVector ? docs.filter(d => !vectorModel || d.model === vectorModel).map(d => [d.id, cosine(d.vector, queryVector)]).filter(([, s]) => s !== undefined && s > 0.2).sort((a, b) => b[1] - a[1]).map(([id]) => id) : [];
  const fused = new Map();
  byText.forEach((id, i) => fused.set(id, (fused.get(id) ?? 0) + 1 / (60 + i)));
  byVec.forEach((id, i) => fused.set(id, (fused.get(id) ?? 0) + 1 / (60 + i)));
  return docs.filter(d => fused.has(d.id)).map(d => {
    const age = Math.max(0, now - (d.updatedAt ?? d.createdAt)) / DAY;
    const decay = Math.pow(0.5, age / halfLifeDays);
    return { memory: d, score: fused.get(d.id) * (0.3 + 0.7 * decay) * (1 + Math.min(d.hits ?? 0, 10) * 0.05), via: [text.has(d.id) ? 'text' : null, byVec.includes(d.id) ? 'vector' : null].filter(Boolean) };
  }).sort((a, b) => b.score - a.score);
}
export function createMemoryStore(root, { now = Date.now, limits = MEMORY_LIMITS } = {}) {
  const dir = join(root, 'memory');
  const cache = new Map(); // file key → memories
  const seen = new Map(); // file key → size:mtime of the file as last read or written by this process
  const lines = new Map(); // file key → JSONL lines in the file (live records plus superseded appends)
  const pathOf = key => join(dir, `${key}.jsonl`);
  const stamp = async key => { try { const s = await stat(pathOf(key)); return `${s.size}:${s.mtimeMs}`; } catch { return 'none'; } };
  async function load(key) {
    // Another process may have appended or compacted since: re-read when the file changed under us.
    // Stamped before reading, so an append that lands during the read makes the next load read again.
    const current = await stamp(key);
    if (cache.has(key) && seen.get(key) === current) return cache.get(key);
    let list = [];
    try {
      const latest = new Map();
      let count = 0;
      for (const line of (await readFile(pathOf(key), 'utf8')).split('\n')) {
        if (!line.trim()) continue;
        count++;
        try { const m = JSON.parse(line); latest.set(m.id, m); } catch { /* a torn last line is skipped */ }
      }
      list = [...latest.values()].filter(m => !m.deleted);
      lines.set(key, count);
    } catch (error) { if (error.code !== 'ENOENT') throw error; lines.set(key, 0); }
    const previous = cache.get(key);
    if (previous) { previous.length = 0; previous.push(...list); list = previous; } // keep callers' array identity
    cache.set(key, list);
    seen.set(key, current);
    return list;
  }
  async function persist(key, record) {
    await mkdir(dir, { recursive: true });
    await withFileLock(pathOf(key), async () => {
      const before = await stamp(key);
      await appendFile(pathOf(key), JSON.stringify(record) + '\n');
      lines.set(key, (lines.get(key) ?? 0) + 1);
      // Only our own append happened since the last read: the cache is still current.
      if (seen.get(key) === before) seen.set(key, await stamp(key));
    });
    // Every update (hits on recall, merges, vectors) appends the whole record again; without this the file grows
    // without bound even though the live set is capped. Rewrite once superseded lines outnumber live ones.
    if ((lines.get(key) ?? 0) > 2 * (cache.get(key)?.length ?? 0) + COMPACT_SLACK) await compact(key);
  }
  /** Rewrite the file from its current content (re-read under the lock, so other processes' appends survive). */
  async function compact(key, select = list => list) {
    await mkdir(dir, { recursive: true });
    return withFileLock(pathOf(key), async () => {
      seen.delete(key);
      const list = await load(key);
      const keep = [...select(list)]; // a copy: `list` is cleared and refilled below
      const temp = `${pathOf(key)}.${randomUUID()}.tmp`;
      await writeFile(temp, keep.map(m => JSON.stringify(m)).join('\n') + (keep.length ? '\n' : ''));
      await rename(temp, pathOf(key));
      lines.set(key, keep.length);
      list.length = 0; list.push(...keep);
      seen.set(key, await stamp(key));
      return keep;
    });
  }
  const keyOf = scope => (scope.kind === 'global' ? 'global' : fileKey(scope.project));
  // One operation at a time per store: a write adds its record to the cached list before appending it, so a reload
  // in between would drop the record from the cache while the append then marks that cache as current. The record
  // would stay on disk but be invisible to every search until the file next changed.
  let tail = Promise.resolve();
  const serial = fn => { const run = tail.then(fn); tail = run.catch(() => {}); return run; };
  const raw = {
    /** Insert, or merge into a near-duplicate in the same scope (same normalized text, or cosine ≥ threshold). */
    async write({ scope, kind, text, tags = [], source = {}, vector = null, model = null, key: topic = null }) {
      if (!MEMORY_KINDS.includes(kind)) throw new Error(`记忆类型须为 ${MEMORY_KINDS.join(' / ')}`);
      const body = normText(text).slice(0, limits.maxText);
      if (body.length < 4) throw new Error('记忆内容太短');
      if (scope.kind !== 'global' && !scope.project) throw new Error('缺少项目');
      const fk = keyOf(scope);
      const list = await load(fk);
      const same = m => m.kind === kind && JSON.stringify(m.scope) === JSON.stringify(scope) && !m.supersededBy;
      const at = now();
      const superseded = [];
      // A memory with the same topic key replaces the older ones (conflict update: newest wins).
      const supersede = async keeper => {
        if (!topic) return;
        for (const old of list.filter(m => same(m) && m.key === topic && m.id !== keeper.id)) { superseded.push({ ...old }); old.supersededBy = keeper.id; old.updatedAt = at; await persist(fk, old); }
      };
      const dup = list.find(m => same(m) && (normText(m.text) === body || (vector && m.model === model && cosine(m.vector, vector) >= limits.duplicateCosine)));
      if (dup) {
        Object.assign(dup, { text: body.length >= dup.text.length ? body : dup.text, tags: [...new Set([...dup.tags, ...tags])], updatedAt: at, merged: (dup.merged ?? 0) + 1, ...(topic ? { key: topic } : {}), ...(vector ? { vector, model } : {}) });
        await persist(fk, dup);
        await supersede(dup);
        return { memory: dup, merged: true, superseded };
      }
      const memory = { id: randomUUID(), scope, kind, text: body, tags: [...new Set(tags)], source, key: topic, vector, model, createdAt: at, updatedAt: at, hits: 0 };
      list.push(memory);
      await persist(fk, memory);
      await supersede(memory);
      if (list.length > limits.maxPerFile) await this.prune(scope);
      return { memory, merged: false, superseded };
    },
    /** Visible memories for a reader, ranked for `query`. */
    async search({ project, role, session, query, vector, vectorModel, k = 6, kinds }) {
      const pool = [...await load('global'), ...(project ? await load(fileKey(project)) : [])]
        .filter(m => visible(m, { project, role, session }) && (!kinds || kinds.includes(m.kind)));
      return rank(pool, query, vector, { now: now(), halfLifeDays: limits.halfLifeDays, vectorModel }).slice(0, k);
    },
    async markUsed(memories) {
      const at = now();
      for (const m of memories) { m.hits = (m.hits ?? 0) + 1; m.lastUsedAt = at; await persist(keyOf(m.scope), m); }
    },
    /** Memories without a vector of the current model (for backfill once embeddings work or after a model change). */
    async unembedded(project, limit = 64, vectorModel = null) {
      return [...await load('global'), ...(project ? await load(fileKey(project)) : [])].filter(m => !m.supersededBy && (!m.vector || (vectorModel && m.model !== vectorModel))).slice(0, limit);
    },
    async setVector(m, vector, model) { m.vector = vector; m.model = model; await persist(keyOf(m.scope), m); },
    /** Forget: drop superseded entries and unused old ones, keep the newest maxPerFile. */
    async prune(scope) {
      const cutoff = now() - limits.pruneDays * DAY;
      let removed = 0;
      await compact(keyOf(scope), list => {
        const keep = list.filter(m => !m.supersededBy && !((m.hits ?? 0) === 0 && (m.updatedAt ?? m.createdAt) < cutoff))
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(0, limits.maxPerFile);
        removed = list.length - keep.length;
        return keep;
      });
      return removed;
    },
    async remove(scope, id) {
      const fk = keyOf(scope); const list = await load(fk);
      const i = list.findIndex(m => m.id === id); if (i < 0) return false;
      const [m] = list.splice(i, 1); await persist(fk, { ...m, deleted: true }); return true;
    },
    /** Text block for automatic injection: newest-first ranked memories within a character budget. */
    format(results, maxChars = limits.injectChars) {
      const lines = []; let used = 0;
      for (const { memory: m } of results) {
        const line = `- [${m.kind}${m.scope.kind === 'role' ? `·${m.scope.role}` : ''}] ${m.text}`;
        if (used + line.length + (lines.length ? 1 : 0) > maxChars) continue;
        used += line.length + (lines.length ? 1 : 0); lines.push(line);
      }
      return lines.join('\n');
    },
  };
  const store = { ...raw };
  for (const name of ['write', 'search', 'markUsed', 'unembedded', 'setVector', 'prune', 'remove']) store[name] = (...args) => serial(() => raw[name](...args));
  return store;
}
