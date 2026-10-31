import { safeId, safeTarget, safeTime, summarizeActivity } from './activity-summary.js';
import { OWN_USAGE_KEY, initOwnUsage, applyOwnUsage, ownUsageView } from './usage.js';
const schema = { parse(v) { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid observability state'); return v; } };
const n = x => typeof x === 'number' && x >= 0 ? Math.min(x, Number.MAX_SAFE_INTEGER) : 0;
const base = (header = {}, inherited = 0) => ({ sessionId: safeId(header.id) ?? 'unknown', cwd: header.cwd ?? null, root: header.cwd ?? null, inherited, cursor: -1 });
const ignored = (s, e) => !Number.isSafeInteger(e.seq) || e.seq < s.inherited || e.seq <= s.cursor;
const coord = x => Number.isSafeInteger(x) && x >= 0 ? x : null;
const callId = e => safeId(e.data?.message?.source?.callId ?? e.data?.message?.toolCallId);
const definition = (key, init, apply) => ({ key, stateVersion: 1,
  stateSchema: { parse(value) {
    schema.parse(value);
    if (!Number.isSafeInteger(value.inherited) || value.inherited < 0 || !Number.isSafeInteger(value.cursor) || value.cursor < -1 || !value.view || value.view.schemaVersion !== 1) throw new Error('Invalid observability checkpoint');
    if (key === 'capabilityTeamActivity' && (!Array.isArray(value.pending) || value.pending.length > 64 || !Array.isArray(value.view.recent) || value.view.recent.length > 8)) throw new Error('Invalid activity checkpoint');
    if (key === 'capabilityTeamArtifacts' && (!Array.isArray(value.view.items) || value.view.items.length > 20 || !Array.isArray(value.view.changes) || value.view.changes.length > 10)) throw new Error('Invalid artifacts checkpoint');
    if (key === 'capabilityTeamReport' && (!Array.isArray(value.pending) || value.pending.length > 64 || !value.view.usage || !value.view.timing || !value.view.counters)) throw new Error('Invalid report checkpoint');
    if (Buffer.byteLength(JSON.stringify(value.view)) > 32768) throw new Error('Oversized observability checkpoint');
    return value;
  } }, init, apply, wire: { viewSchema: schema, view: s => s.view } });
const cwdChange = (s, e) => e.type === 'working-directory/change' ? { ...s, cwd: e.data?.cwd ?? e.data?.path ?? null, cursor: e.seq } : null;
export const activityDefinition = definition('capabilityTeamActivity', (h, i) => ({ ...base(h, i), pending: [], view: { schemaVersion: 1, phase: 'idle', current: null, recent: [], activeCount: 0, truncated: false } }), (s, e) => {
  if (ignored(s, e)) return s;
  const cwd = cwdChange(s, e); if (cwd) return cwd;
  const d = e.data ?? {}; let pending = s.pending, recent = s.view.recent, phase = s.view.phase, truncated = s.view.truncated;
  if (e.type === 'tool/call') {
    const id = safeId(d.callId); if (!id) return s;
    const item = { id: `${s.sessionId}:${e.seq}`, callId: id, callSeq: e.seq, ...summarizeActivity(d.name, d.arguments, s.cwd, s.root), startedAt: safeTime(e.time), endedAt: null, status: 'running', turn: coord(d.turn), step: coord(d.step) };
    pending = [...pending.filter(p => p.callId !== id), item];
    if (pending.length > 64) { pending = pending.slice(-64); truncated = true; }
    const history = [item, ...recent.filter(p => p.callId !== id)];
    if (history.length > 8) truncated = true;
    recent = history.slice(0, 8); phase = 'tool';
  } else if (e.type === 'tool/result') {
    const id = callId(e), item = pending.find(p => p.callId === id); if (!item) return s;
    pending = pending.filter(p => p.callId !== id);
    const done = { ...item, endedAt: safeTime(e.time), status: d.message?.isError ? 'failed' : 'succeeded' };
    const history = [done, ...recent.filter(p => p.id !== item.id)];
    if (history.length > 8) truncated = true;
    recent = history.slice(0, 8); phase = pending.length ? 'tool' : 'model';
  } else if (e.type === 'step/start') phase = pending.length ? 'tool' : 'model';
  else if (e.type === 'step/end') phase = pending.length ? 'tool' : 'settled';
  else if (e.type === 'turn/end') {
    const ids = new Set(pending.map(p => p.id));
    recent = recent.map(p => ids.has(p.id) ? { ...p, endedAt: safeTime(e.time), status: d.reason?.kind === 'cancelled' || d.reason?.kind === 'interrupted' ? 'interrupted' : 'unknown' } : p);
    pending = []; phase = 'settled';
  } else return s;
  return { ...s, cursor: e.seq, pending, view: { schemaVersion: 1, phase, current: recent[0] ?? null, recent, activeCount: pending.length, truncated } };
});
export const artifactsDefinition = definition('capabilityTeamArtifacts', (h, i) => ({ ...base(h, i), view: { schemaVersion: 1, items: [], changes: [], truncated: false } }), (s, e) => {
  if (ignored(s, e)) return s;
  const cwd = cwdChange(s, e); if (cwd) return cwd;
  const d = e.data ?? {}; let { items, changes, truncated } = s.view;
  if (e.type === 'workspace/changes') {
    changes = [{ seq: e.seq, turn: coord(d.turn), at: safeTime(e.time) }, ...changes];
    if (changes.length > 10) { changes = changes.slice(0, 10); truncated = true; }
  } else if (e.type === 'deliverables/presented' && Array.isArray(d.files)) {
    const additions = [];
    for (let index = 0; index < Math.min(d.files.length, 256); index++) {
      const file = d.files[index]; const relative = safeTarget(file?.path, s.cwd, 4096, s.root);
      if (!relative || relative === '[敏感路径]') continue;
      additions.push({ id: `${s.sessionId}:${e.seq}:${index}`, sessionId: s.sessionId, presentSeq: e.seq, fileIndex: index, turn: coord(d.turn), at: safeTime(e.time), path: file.path, displayPath: relative.slice(0, 240), changeRef: null });
    }
    items = [...additions, ...items];
    if (items.length > 20 || d.files.length > 256) { items = items.slice(0, 20); truncated = true; }
    // A UTF-8 byte ceiling, not merely a character limit.
    while (Buffer.byteLength(JSON.stringify({ items, changes })) > 31000) { items.pop(); truncated = true; }
  } else return s;
  return { ...s, cursor: e.seq, view: { schemaVersion: 1, items, changes, truncated } };
});
const zeroUsage = () => ({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 });
function firstToken(stream) {
  for (const part of stream ?? []) {
    if (part.type === 'chunk') {
      const c = part.chunk;
      if ((['text-delta', 'reasoning-delta'].includes(c?.type) && c.text !== '') || (c?.type === 'tool-call-delta' && (c.argumentsDelta !== '' || c.name !== undefined))) return safeTime(part.time);
    } else {
      if (part.type === 'tool-call-chunks' && part.name !== undefined) return safeTime(part.time0);
      const fragments = part.type === 'tool-call-chunks' ? part.args : part.texts;
      let time = part.time0;
      for (let i = 0; i < (fragments?.length ?? 0); i++) { if (i) time += part.dt?.[i - 1] ?? 0; if (fragments[i] !== '') return safeTime(time); }
    }
  }
  return null;
}
export const reportDefinition = definition('capabilityTeamReport', (h, i) => ({ ...base(h, i), ownUsage: initOwnUsage(i), openStep: null, pending: [], lastTurn: null, view: { schemaVersion: 1, scope: 'own-session-events', firstTurnAt: null, lastTurnEndAt: null, openTurnAt: null, completedTurnMs: 0, turns: 0, steps: 0, stepsStarted: 0, usage: zeroUsage(), usageCoverage: { reportedSamples: 0, attemptsWithoutUsage: 0, coverage: 'unknown' }, timing: { llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }, counters: { hostRetriesStarted: 0, failedTurns: 0, sendMessageAccepted: 0, boardMutations: h?.origin === 'subagent' ? null : 0 }, truncated: false } }), (s, e) => {
  if (ignored(s, e)) return s;
  const relevant = ['request/header', 'turn/start', 'turn/end', 'step/start', 'step/end', 'assistant/attempt', 'assistant/message', 'llm/retry-started', 'tool/call', 'tool/result', 'team/task'];
  if (!relevant.includes(e.type)) return s;
  const d = e.data ?? {}, v = { ...s.view, usage: { ...s.view.usage }, timing: { ...s.view.timing }, counters: { ...s.view.counters } };
  const next = { ...s, cursor: e.seq, view: v }; const time = safeTime(e.time);
  const add = (obj, key, value) => { if (typeof value === 'number' && value > Number.MAX_SAFE_INTEGER) v.truncated = true; const sum = obj[key] + n(value); if (!Number.isFinite(sum) || sum > Number.MAX_SAFE_INTEGER) v.truncated = true; obj[key] = n(sum); };
  if (e.type === 'turn/start') { v.firstTurnAt ??= time; v.openTurnAt = time; }
  if (e.type === 'turn/end') {
    if (v.openTurnAt !== null && time !== null) add(v, 'completedTurnMs', Math.max(0, time - v.openTurnAt));
    v.openTurnAt = null; v.lastTurnEndAt = time; next.pending = []; next.openStep = null;
    if (d.reason?.kind === 'error') add(v.counters, 'failedTurns', 1);
  }
  if (e.type === 'step/start') { add(v, 'stepsStarted', 1); next.openStep = { turn: d.turn, step: d.step, at: time, first: null }; }
  if (e.type === 'step/end') { add(v, 'steps', 1); if (s.lastTurn !== d.turn) add(v, 'turns', 1); next.lastTurn = d.turn; next.openStep = null; }
  if (e.type === 'llm/retry-started') { add(v.counters, 'hostRetriesStarted', 1);  }
  if (e.type === 'tool/call' && safeId(d.callId)) {
    next.pending = [...s.pending, { id: d.callId, at: time, send: d.name === 'send_message' }].slice(-64);
    if (s.pending.length >= 64) v.truncated = true;
  }
  if (e.type === 'tool/result') {
    const id = callId(e), p = s.pending.find(p => p.id === id);
    if (p) { next.pending = s.pending.filter(p => p.id !== id); if (time !== null && p.at !== null) add(v.timing, 'toolMs', time - p.at); if (p.send && !d.message?.isError) add(v.counters, 'sendMessageAccepted', 1); }
  }
  if (e.type === 'team/task' && v.counters.boardMutations !== null) add(v.counters, 'boardMutations', 1);
  if (['assistant/message', 'assistant/attempt'].includes(e.type)) {
    const open = s.openStep;
    if (open && open.turn === d.turn && open.step === d.step) {
      const first = open.first ?? firstToken(d.stream);
      next.openStep = { ...open, first };
      if (e.type === 'assistant/message') {
        if (time !== null && open.at !== null) add(v.timing, 'llmMs', time - open.at);
        if (first !== null && open.at !== null) { add(v.timing, 'ttftMs', first - open.at); add(v.timing, 'ttftSteps', 1); if (d.usage?.outputTokens != null) { add(v.timing, 'decodeMs', time - first); add(v.timing, 'decodeTokens', d.usage.outputTokens); } }
        next.openStep = null;
      }
    }
  }
  next.ownUsage = applyOwnUsage(s.ownUsage, e);
  v.usage = next.ownUsage.totals;
  v.truncated ||= next.ownUsage.truncated;
  v.usageCoverage = { reportedSamples: next.ownUsage.reportedSamples, attemptsWithoutUsage: next.ownUsage.attemptsWithoutUsage, coverage: next.ownUsage.coverage };
  return next;
});
reportDefinition.stateVersion = 3; // Own-session attempt-aware fold; discard v1 checkpoints.
export const ownUsageDefinition = {
  key: OWN_USAGE_KEY, stateVersion: 1, stateSchema: { parse(v) { schema.parse(v); if (!Number.isSafeInteger(v.inherited) || !v.totals || !Array.isArray(v.routes)) throw new Error('Invalid own usage checkpoint'); return v; } },
  init: (_header, inherited) => { const s = initOwnUsage(inherited); return { ...s, view: ownUsageView(s) }; },
  apply: (s, e) => { const next = applyOwnUsage(s, e); return next === s ? s : { ...next, view: ownUsageView(next) }; },
  wire: { viewSchema: schema, view: s => s.view },
};
export const observabilityDefinitions = [activityDefinition, artifactsDefinition, reportDefinition, ownUsageDefinition];
export function applyObservabilityProjections(ctx) {
  ctx.inject?.(['sessionProjections'], scoped => {
    for (const def of observabilityDefinitions) scoped.effect(() => scoped.sessionProjections.register(def), `capability-team: ${def.key}`);
  });
}
