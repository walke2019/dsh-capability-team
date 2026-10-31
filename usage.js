// Own-session usage. Durable assistant/attempt settles a failed request, so the next
// settlement is a distinct attempt even when plugin retry emits no llm/retry-started.
// Token usage per team member:
// each Assistant settlement contributes its last usage sample; a failed assistant/attempt
// and llm/retry-started close the slot. Same-slot message corrections replace it. Samples are attributed to the
// route of the latest request header, which is the route the attempt was sent to.
const BUCKETS = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];
export const zeroUsage = () => ({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
const numeric = value => Number.isFinite(value) && value >= 0 ? Math.min(value, Number.MAX_SAFE_INTEGER) : 0;
const bucketsFrom = usage => ({ uncachedInputTokens: numeric(usage.inputTokens), outputTokens: numeric(usage.outputTokens),
  cacheReadTokens: numeric(usage.cacheReadTokens), cacheWriteTokens: numeric(usage.cacheWriteTokens) });
const shift = (into, buckets, sign) => { for (const key of BUCKETS) into[key] = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, into[key] + sign * buckets[key])); };
/** 预算计数 token = uncached input + cache write + output；不含缓存读取，不等于账单金额。 */
export const billable = usage => (usage?.uncachedInputTokens ?? 0) + (usage?.cacheWriteTokens ?? 0) + (usage?.outputTokens ?? 0);
export function sampleOf(event) {
  if (event.type === 'assistant/message' && event.data?.usage && typeof event.data.usage === 'object' && !Array.isArray(event.data.usage)) return event.data.usage;
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined;
  const stream = Array.isArray(event.data?.stream) ? event.data.stream : [];
  for (let i = stream.length - 1; i >= 0; i--) if (stream[i]?.type === 'chunk' && stream[i].chunk?.type === 'usage') return stream[i].chunk.usage;
  return undefined;
}
export const OWN_USAGE_KEY = 'capabilityTeamUsage';
export function initOwnUsage(inherited = 0) {
  return { inherited, cursor: -1, totals: zeroUsage(), routes: [], route: null, last: null, settledAttempt: false, reportedSamples: 0, attemptsWithoutUsage: 0, coverage: 'unknown', truncated: false };
}
/** Pure incremental fold. A durable attempt is a settlement, not an intermediate usage chunk. */
export function applyOwnUsage(state, event) {
  if (Number.isSafeInteger(event.seq) && (event.seq < state.inherited || event.seq <= state.cursor)) return state;
  if (!['request/header', 'llm/retry-started', 'assistant/attempt', 'assistant/message'].includes(event.type)) return state;
  const next = { ...state, cursor: Number.isSafeInteger(event.seq) ? event.seq : state.cursor };
  if (event.type === 'request/header') {
    const config = event.data?.header?.config;
    if (typeof config?.provider === 'string' && config.provider.length <= 128 && typeof config?.model === 'string' && config.model.length <= 512) next.route = `${config.provider}/${config.model}`;
    // Headers can be deduplicated by the host. Never rely on a header alone as an attempt boundary.
    return next;
  }
  if (event.type === 'llm/retry-started') {
    if (state.last?.turn === event.data?.turn && state.last?.step === event.data?.step) next.last = null;
    next.settledAttempt = false;
    return next;
  }
  const sample = sampleOf(event);
  if (!sample || typeof sample !== 'object' || Array.isArray(sample) || !['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].some(key => typeof sample[key] === 'number')) {
    next.attemptsWithoutUsage += 1;
    next.last = null;
    next.settledAttempt = event.type === 'assistant/attempt';
    next.coverage = 'partial';
    return next;
  }
  const totals = { ...state.totals }, routes = new Map(state.routes.map(row => [row.route, { ...row }]));
  const buckets = bucketsFrom(sample), key = state.route ?? 'unknown';
  if (Object.values(sample).some(value => typeof value === 'number' && (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER))) next.attemptsWithoutUsage += 1;
  const { turn, step } = event.data;
  if (!state.settledAttempt && state.last?.turn === turn && state.last?.step === step) {
    shift(totals, state.last.buckets, -1);
    if (routes.has(state.last.route)) shift(routes.get(state.last.route), state.last.buckets, -1);
  }
  if (!routes.has(key)) routes.set(key, { route: key, ...zeroUsage() });
  shift(totals, buckets, 1); shift(routes.get(key), buckets, 1);
  if (routes.size > 24 || BUCKETS.some(k => totals[k] === Number.MAX_SAFE_INTEGER)) next.truncated = true;
  next.totals = totals; next.routes = [...routes.values()].slice(-24); next.last = { turn, step, route: key, buckets };
  next.settledAttempt = event.type === 'assistant/attempt';
  next.reportedSamples += 1;
  next.coverage = next.attemptsWithoutUsage ? 'partial' : 'complete';
  return next;
}
export function ownUsageView(state) {
  return { schemaVersion: 1, scope: 'own-session-events', totals: state.totals, routes: state.routes,
    reportedSamples: state.reportedSamples, attemptsWithoutUsage: state.attemptsWithoutUsage, coverage: state.coverage, truncated: state.truncated };
}
/** Usage of one session log, excluding events inherited from a parent session. */
export function foldUsage(snapshot) {
  const own = snapshot.events.slice(snapshot.inheritedEventCount ?? 0).reduce(applyOwnUsage, initOwnUsage());
  return { totals: own.totals, routes: own.routes.filter(u => billable(u) || u.cacheReadTokens),
    reportedSamples: own.reportedSamples, attemptsWithoutUsage: own.attemptsWithoutUsage, coverage: own.coverage };
}
/** Own-session budget totals only. Missing/unknown usage does not block; no inherited host fallback. */
export function sessionUsage(projections, session) {
  try {
    const state = projections?.stateOf(session, OWN_USAGE_KEY);
    return state ? state.totals ?? state : undefined;
  } catch { return undefined; }
}
/** Denial for a role that has used up its per-session token budget, or undefined. */
export function budgetDenial(role, usage) {
  if (!role.maxTokens || !usage) return undefined;
  const used = billable(usage);
  if (used < role.maxTokens) return undefined;
  return `角色 ${role.displayName ?? role.id}（${role.capability}）本会话已用 ${used} 预算计数 token（不含缓存读取，不等于账单金额），达到预算上限 ${role.maxTokens}，已阻止请求。请向用户说明进度，由用户决定是否提高该能力的 maxTokens；不会改用其他模型继续。`;
}
