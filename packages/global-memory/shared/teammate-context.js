// Keep a teammate's fixed prompt small. Measured: before any work a teammate carried ~110k characters
// (a 326-entry skill catalog of 56k, 57 tool schemas of 40k, system and runtime context), about 55k tokens.
// 1. Lead-only plugin tools are registered on the lead's agent only, teammate-only tools on teammates only.
// 2. The skill catalog DSH injects is shortened for teammates (name + one short line), or limited / dropped
//    per capability (`capabilities.<id>.skills`: 'compact' | 'full' | 'none' | [names or prefixes ending in *]).
import { ownsCapabilityTeam } from './preset-guard.js';
export const LEAD_ONLY_TOOLS = new Set(['capability_dispatch_plan', 'capability_free_task', 'capability_team_save', 'capability_team_import',
  'capability_rotate_member', 'capability_review_plan', 'capability_model_prefs', 'capability_task_budget', 'capability_member_override']);
export const TEAMMATE_ONLY_TOOLS = new Set(['capability_handoff', 'capability_submit_plan']);
export const CATALOG_DESCRIPTION_CHARS = 72;
export const CATALOG_MAX_CHARS = 26000;
const isTeammateAgent = agent => agent?.session?.header?.parentSession !== undefined;
/**
 * A ctx whose tools.register keeps lead-only and teammate-only tools back and installs them per agent when that
 * agent is created. Everything else passes through to the host unchanged.
 * Agents that already existed when the plugin loaded (or reloaded) never fire agent/created, so the scoped tools
 * are also installed for every agent in ctx.agents.list() once registration finished, and lazily on the first
 * agent/pre-step of an agent. Installation is idempotent per agent and tool name.
 */
export function scopeTools(ctx) {
  const lead = [], teammate = [];
  const installed = new WeakMap();
  // Registrations live on the agent's own ctx, which outlives a preset switch (a blank session reused for another
  // preset is recomposed without agent/created or agent/disposed), so each one keeps its disposer and every call
  // re-checks the preset: these tools must never act outside the capability-team preset.
  const gated = (def, agent) => ({ ...def, async execute(args, exec) {
    if (!ownsCapabilityTeam(ctx, exec?.agent ?? agent)) throw new Error('该工具仅限能力协作团队预设使用');
    return def.execute(args, exec);
  } });
  const uninstall = agent => {
    const done = installed.get(agent);
    if (!done) return;
    installed.delete(agent);
    for (const dispose of done.values()) { try { dispose?.(); } catch { /* already removed */ } }
  };
  const install = agent => {
    if (!agent?.ctx?.tools || !ownsCapabilityTeam(ctx, agent)) return;
    const done = installed.get(agent) ?? new Map();
    installed.set(agent, done);
    for (const def of isTeammateAgent(agent) ? teammate : lead) {
      if (done.has(def.name)) continue;
      try { done.set(def.name, agent.ctx.tools.register(gated(def, agent))); } catch { done.set(def.name, undefined); /* already present for this agent */ }
    }
  };
  const tools = new Proxy(ctx.tools, {
    get(target, prop) {
      if (prop === 'register') return def => {
        if (LEAD_ONLY_TOOLS.has(def.name)) { lead.push(def); return () => {}; }
        if (TEAMMATE_ONLY_TOOLS.has(def.name)) { teammate.push(def); return () => {}; }
        return target.register(def);
      };
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const scoped = new Proxy(ctx, { get: (target, prop) => (prop === 'tools' ? tools : target[prop]) });
  ctx.on('agent/created', ({ agent }) => install(agent));
  ctx.on('agent/pre-step', (payload, next) => { install(payload?.agent); return next(); });
  ctx.on('agent/disposed', ({ agent }) => uninstall(agent));
  ctx.on('agent-preset/selected', sessionId => {
    let agent; try { agent = ctx.agents?.get?.(sessionId); } catch { return; }
    if (!agent) return;
    if (ownsCapabilityTeam(ctx, agent)) install(agent); else uninstall(agent);
  });
  // Plugin tools register synchronously during apply; existing agents are backfilled right after it returns.
  const installExisting = () => { let agents = []; try { agents = ctx.agents?.list?.() ?? []; } catch { /* host without agents service */ } for (const agent of agents) install(agent); };
  queueMicrotask(installExisting);
  return { ctx: scoped, deferred: () => ({ lead: [...lead], teammate: [...teammate] }), installExisting };
}
/** First clause of a description, at most `max` characters. */
export function shortDescription(text, max = CATALOG_DESCRIPTION_CHARS) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  const cut = s.split(/(?<=[。.!?！？；;])\s*/)[0] ?? s;
  return cut.length <= max ? cut : `${cut.slice(0, max - 1)}…`;
}
const matches = (name, rules) => rules.some(r => (r.endsWith('*') ? name.startsWith(r.slice(0, -1)) : name === r));
/** Rewrite one skill-catalog message for a policy; undefined means drop it. Entries (used for digests) are kept. */
export function rewriteCatalog(message, policy, maxChars = CATALOG_MAX_CHARS) {
  if (policy === 'full' && message.content?.reduce((n, c) => n + (c.text?.length ?? 0), 0) <= maxChars) return message;
  const entries = message.source?.entries ?? [];
  const kept = Array.isArray(policy) ? entries.filter(e => matches(e.name, policy)) : entries;
  if (policy === 'none' || (Array.isArray(policy) && !kept.length)) return undefined;
  const lines = []; let used = 500;
  for (const e of kept) {
    const line = `- \`${e.name}\`${e.description ? `: ${shortDescription(e.description)}` : ''}`;
    if (used + line.length + 1 > maxChars) continue;
    lines.push(line); used += line.length + 1;
  }
  const text = ['<system-reminder>', 'Skills you can load with the `skill` tool (short list; load one before using it):', '', '<available_skills>', ...lines, '</available_skills>',
    'If the task clearly matches a skill, call the `skill` tool with its exact name before acting, then follow its full instructions.', '</system-reminder>'].join('\n');
  return { ...message, content: [{ type: 'text', text }] };
}
/** Validate `capabilities.<id>.skills`. */
export function validateSkillsPolicy(value, label) {
  if (value === undefined) return undefined;
  if (['compact', 'full', 'none'].includes(value)) return value;
  if (Array.isArray(value) && value.length <= 200 && value.every(v => typeof v === 'string' && /^[\w.:@/-]+\*?$/.test(v))) return [...new Set(value)];
  throw new Error(`${label} 的 skills 须为 compact / full / none 或技能名列表（可用 * 结尾表示前缀）`);
}
/**
 * Shorten the skill catalog for teammates. Registered with `prepend` so it is the outermost agent/pre-step
 * listener and sees the catalog message the skill tool adds downstream.
 */
export function applySkillCatalog(ctx, policyOf) {
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision?.kind === 'reject' || !ownsCapabilityTeam(ctx, payload.agent) || !isTeammateAgent(payload.agent) || !Array.isArray(decision?.messages)) return decision;
    let policy;
    try { policy = policyOf(payload.agent) ?? 'compact'; } catch { policy = 'compact'; }
    const messages = []; let remaining = CATALOG_MAX_CHARS;
    for (const m of decision.messages) {
      if (m?.source?.kind !== 'skill-catalog') { messages.push(m); continue; }
      if (remaining < 500) continue;
      const next = rewriteCatalog(m, policy, remaining);
      if (next) { messages.push(next); remaining -= next.content.reduce((n, c) => n + (c.text?.length ?? 0), 0); }
    }
    return { ...decision, messages };
  }, { prepend: true });
}
