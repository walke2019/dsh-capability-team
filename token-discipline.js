import { m as modelText } from './i18n.js';
// Token rules for the team (part of the iron rules). Measured on this project: prompt caching already works
// (93–98% of prompt tokens are cache reads), so cost is driven by how much context every step resends —
// sessions ran at ~150k tokens per step because DSH compacts only at 80% of the window. The levers are a small,
// stable prefix and a small working context, without breaking the cache:
// 1. Idle compaction: when a team member goes idle above `idleCompactRatio` of its window, compact it then.
//    The provider cache expires after a few idle minutes anyway, so this costs almost no cache.
// 2. Oversized command/search output is cut to head + tail at once (the full text is spilled to a file),
//    instead of riding along in every later step until DSH's own pruner runs at compaction time.
// 3. The prefix stays stable: plugin context only changes on events, and routes do not flip per step.
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promptTokens } from './long-context.js';
import { ownsCapabilityTeam } from './preset-guard.js';
import { createTokenMetrics, usageSample } from './token-metrics.js';
import { restrictiveToolName } from './tool-names.js';
export const TOKEN_RULES = { idleCompactRatio: 0.35, trimToolOutputChars: 6000, keepHeadChars: 3000, keepTailChars: 1500 };
const KEYS = Object.keys(TOKEN_RULES);
/** Tools whose output is a log or listing rather than content the model must read whole. */
export const TRIMMED_TOOLS = new Set(['bash', 'pwsh', 'grep', 'glob', 'job_output', 'web_fetch', 'web_search', 'omni_fetch', 'omni_search', 'session_search', 'session_event_search']);
export function validateTokenRules(value) {
  if (value === undefined || value === null) return { ...TOKEN_RULES };
  if (value === false) return false;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(modelText('token-discipline.552'));
  const extra = Object.keys(value).filter(k => !KEYS.includes(k));
  if (extra.length) throw new Error(modelText('token-discipline.553', { 0: extra.join(', ') }));
  const out = { ...TOKEN_RULES, ...value };
  if (typeof out.idleCompactRatio !== 'number' || out.idleCompactRatio < 0.1 || out.idleCompactRatio > 0.9) throw new Error(modelText('token-discipline.554'));
  for (const k of ['trimToolOutputChars', 'keepHeadChars', 'keepTailChars']) if (!Number.isSafeInteger(out[k]) || out[k] < 200 || out[k] > 200000) throw new Error(modelText('token-discipline.555', { 0: k }));
  if (out.keepHeadChars + out.keepTailChars >= out.trimToolOutputChars) throw new Error(modelText('token-discipline.556'));
  return out;
}
/** Model-facing token rules, appended to the file rules in the team policy. */
export function tokenRuleText(rules) {
  if (!rules) return '';
  return modelText('token-discipline.557', { 0: rules.trimToolOutputChars, 1: Math.round(rules.idleCompactRatio * 100) });
}
/** Head + tail of a long text with a pointer to the full copy. Pure. */
export function trimText(text, rules, spillPath) {
  const head = text.slice(0, rules.keepHeadChars);
  const tail = text.slice(-rules.keepTailChars);
  return modelText('token-discipline.558', { 0: head, 1: text.length - head.length - tail.length, 2: text.length, 3: spillPath, 4: tail });
}
export function createTokenDiscipline(ctx, team, { spillDir = join(tmpdir(), 'capability-team-spill'), rulesOf, trimmedTools = TRIMMED_TOOLS, ratesOf } = {}) {
  const compacting = new WeakSet();
  const metrics = createTokenMetrics({ ratesOf });
  // `compaction` is not in the plugin's inject list, and cordis throws on a direct read of an un-injected
  // service (that once stopped the DSH host). It arrives through ctx.inject when the host provides it.
  let compactionService;
  const compaction = () => compactionService;
  const rules = agent => {
    if (rulesOf) return rulesOf(agent);
    const project = team.pinned(agent);
    if (!project) return team.base?.workflow?.tokens ?? false;
    try { return team.loadSync(project, agent).effective.workflow.tokens; } catch { return false; }
  };
  const isMember = agent => !!team.native.identity(agent);
  const ratioOf = agent => {
    try {
      const projections = ctx.get?.('sessionProjections');
      const tokens = promptTokens(projections, agent.session);
      const window = projections?.stateOf(agent.session, 'contextPressure')?.contextWindow;
      return tokens !== undefined && window ? tokens / window : undefined;
    } catch { return undefined; }
  };
  async function compactIdleUnsafe(agent) {
    const r = rules(agent);
    const service = compaction();
    if (!r || compacting.has(agent) || !isMember(agent) || typeof service?.compactNow !== 'function') return false;
    const ratio = ratioOf(agent);
    if (ratio === undefined || ratio < r.idleCompactRatio) return false;
    compacting.add(agent);
    const started = Date.now();
    try { const done = (await service.compactNow(agent, AbortSignal.timeout(180000))) !== null; if (done) metrics.compact(agent, Date.now() - started); return done; }
    finally { compacting.delete(agent); }
  }
  const api = {
    metrics,
    /** Compact an idle member whose context is above the idle threshold. Never throws; returns true when it ran. */
    async compactIdle(agent) {
      // busy (new work arrived), nothing compactable or any host error: skip, and try again on the next idle
      try { return await compactIdleUnsafe(agent); } catch { return false; }
    },
    /** Post-execute decision: trim an oversized log/listing result for a team member. */
    async trim(exec, result) {
      const r = rules(exec.agent);
      if (!r || !new Set(trimmedTools).has(restrictiveToolName(exec.name, new Set(trimmedTools))) || !isMember(exec.agent) || !Array.isArray(result?.content)) return undefined;
      const text = result.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      if (text.length <= r.trimToolOutputChars || result.content.some(b => b.type !== 'text')) return undefined;
      await mkdir(spillDir, { recursive: true });
      const path = join(spillDir, `${String(exec.callId ?? Date.now()).replace(/[^\w.-]/g, '_')}.txt`);
      await writeFile(path, text);
      const trimmed = trimText(text, r, path);
      metrics.trim(exec.agent, text.length, trimmed.length);
      return [{ type: 'text', text: trimmed }];
    },
    register() {
      ctx.on('agent/request', async (payload, next) => {
        const result = await next();
        if (isMember(payload.agent)) metrics.sample(payload.agent, payload.turn, payload.step, usageSample(ctx.get?.('sessionProjections'), payload.agent.session));
        return result;
      });
      try { ctx.inject?.(['compaction'], scoped => { compactionService = scoped.compaction; scoped.effect?.(() => () => { compactionService = undefined; }); }); } catch { /* host without compaction */ }
      // Listeners must never reject: an unhandled rejection inside a host event stops the DSH host.
      ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') api.compactIdle(agent).catch(() => {}); });
      ctx.on('tools/post-execute', async (exec, result, next) => {
        const decision = await next();
        if (decision?.kind !== 'accept' || decision.content !== undefined || result?.isError) return decision;
        try { const content = await api.trim(exec, result); return content ? { ...decision, content } : decision; }
        catch { return decision; }
      });
    },
  };
  return api;
}
