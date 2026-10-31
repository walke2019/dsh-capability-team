// Keep a teammate's fixed prompt small. Measured: before any work a teammate carried ~110k characters
// (a 326-entry skill catalog of 56k, 57 tool schemas of 40k, system and runtime context), about 55k tokens.
// 1. Lead-only plugin tools are registered on the lead's agent only, teammate-only tools on teammates only.
// 2. The skill catalog DSH injects is shortened for teammates (name + one short line), or limited / dropped
//    per capability (`capabilities.<id>.skills`: 'compact' | 'full' | 'none' | [names or prefixes ending in *]).
export const LEAD_ONLY_TOOLS = new Set(['capability_dispatch_plan', 'capability_free_task', 'capability_team_save', 'capability_team_import',
  'capability_rotate_member', 'capability_review_plan', 'capability_model_prefs', 'capability_task_budget', 'capability_member_override']);
export const TEAMMATE_ONLY_TOOLS = new Set(['capability_handoff', 'capability_submit_plan']);
export const CATALOG_DESCRIPTION_CHARS = 72;
const isTeammateAgent = agent => agent?.session?.header?.parentSession !== undefined;
/**
 * A ctx whose tools.register keeps lead-only and teammate-only tools back and installs them per agent when that
 * agent is created. Everything else passes through to the host unchanged.
 */
export function scopeTools(ctx) {
  const lead = [], teammate = [];
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
  ctx.on('agent/created', ({ agent }) => {
    const defs = isTeammateAgent(agent) ? teammate : lead;
    for (const def of defs) { try { agent.ctx.tools.register(def); } catch { /* already present for this agent */ } }
  });
  return { ctx: scoped, deferred: () => ({ lead: [...lead], teammate: [...teammate] }) };
}
/** First clause of a description, at most `max` characters. */
export function shortDescription(text, max = CATALOG_DESCRIPTION_CHARS) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  const cut = s.split(/(?<=[。.!?！？；;])\s*/)[0] ?? s;
  return cut.length <= max ? cut : `${cut.slice(0, max - 1)}…`;
}
const matches = (name, rules) => rules.some(r => (r.endsWith('*') ? name.startsWith(r.slice(0, -1)) : name === r));
/** Rewrite one skill-catalog message for a policy; undefined means drop it. Entries (used for digests) are kept. */
export function rewriteCatalog(message, policy) {
  if (policy === 'full') return message;
  const entries = message.source?.entries ?? [];
  const kept = Array.isArray(policy) ? entries.filter(e => matches(e.name, policy)) : entries;
  if (policy === 'none' || (Array.isArray(policy) && !kept.length)) return undefined;
  const lines = kept.map(e => `- \`${e.name}\`${e.description ? `: ${shortDescription(e.description)}` : ''}`);
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
    if (decision?.kind === 'reject' || !isTeammateAgent(payload.agent) || !Array.isArray(decision?.messages)) return decision;
    let policy;
    try { policy = policyOf(payload.agent) ?? 'compact'; } catch { policy = 'compact'; }
    if (policy === 'full') return decision;
    const messages = [];
    for (const m of decision.messages) {
      if (m?.source?.kind !== 'skill-catalog') { messages.push(m); continue; }
      const next = rewriteCatalog(m, policy);
      if (next) messages.push(next);
    }
    return { ...decision, messages };
  }, { prepend: true });
}
