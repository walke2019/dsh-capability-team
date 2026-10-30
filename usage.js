// Token usage per team member, folded with the same rules as DSH token-meter's `tokenUsage` projection:
// each Assistant settlement contributes its last usage sample, a later sample of the same turn/step replaces
// it, and `llm/retry-started` closes that slot so a retried attempt adds on top. Samples are attributed to the
// route of the latest request header, which is the route the attempt was sent to.
const BUCKETS = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];
export const zeroUsage = () => ({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
const bucketsFrom = usage => ({ uncachedInputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0,
  cacheReadTokens: usage.cacheReadTokens ?? 0, cacheWriteTokens: usage.cacheWriteTokens ?? 0 });
const shift = (into, buckets, sign) => { for (const key of BUCKETS) into[key] += sign * buckets[key]; };
/** Tokens a budget counts: everything billed at full input or output price; cache reads are reported apart. */
export const billable = usage => (usage?.uncachedInputTokens ?? 0) + (usage?.cacheWriteTokens ?? 0) + (usage?.outputTokens ?? 0);
function sampleOf(event) {
  if (event.type === 'assistant/message' && event.data?.usage) return event.data.usage;
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined;
  const stream = event.data?.stream ?? [];
  for (let i = stream.length - 1; i >= 0; i--) if (stream[i]?.type === 'chunk' && stream[i].chunk?.type === 'usage') return stream[i].chunk.usage;
  return undefined;
}
/** Usage of one session log, excluding events inherited from a parent session. */
export function foldUsage(snapshot) {
  const totals = zeroUsage(); const routes = new Map();
  let route = null; let last = null;
  for (const event of snapshot.events.slice(snapshot.inheritedEventCount ?? 0)) {
    if (event.type === 'request/header') {
      const config = event.data?.header?.config;
      if (typeof config?.provider === 'string' && typeof config?.model === 'string') route = `${config.provider}/${config.model}`;
      continue;
    }
    if (event.type === 'llm/retry-started') {
      if (last?.turn === event.data?.turn && last?.step === event.data?.step) last = null;
      continue;
    }
    const sample = sampleOf(event);
    if (!sample) continue;
    const { turn, step } = event.data;
    const buckets = bucketsFrom(sample);
    const key = route ?? 'unknown';
    if (last && last.turn === turn && last.step === step) {
      shift(totals, last.buckets, -1);
      shift(routes.get(last.route), last.buckets, -1);
    }
    if (!routes.has(key)) routes.set(key, zeroUsage());
    shift(totals, buckets, 1);
    shift(routes.get(key), buckets, 1);
    last = { turn, step, route: key, buckets };
  }
  return { totals, routes: [...routes].filter(([, u]) => billable(u) || u.cacheReadTokens).map(([key, u]) => ({ route: key, ...u })) };
}
/** Live totals of the requesting session from token-meter's projection; undefined when it is not mounted. */
export function sessionUsage(projections, session) {
  try {
    const state = projections?.stateOf(session, 'tokenUsage');
    return state ? state.totals ?? state : undefined;
  } catch { return undefined; }
}
/** Denial for a role that has used up its per-session token budget, or undefined. */
export function budgetDenial(role, usage) {
  if (!role.maxTokens || !usage) return undefined;
  const used = billable(usage);
  if (used < role.maxTokens) return undefined;
  return `角色 ${role.displayName ?? role.id}（${role.capability}）本会话已用 ${used} 计费 token，达到预算上限 ${role.maxTokens}，已阻止请求。请向用户说明进度，由用户决定是否提高该能力的 maxTokens；不会改用其他模型继续。`;
}
