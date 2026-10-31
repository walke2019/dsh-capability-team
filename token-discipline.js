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
export const TOKEN_RULES = { idleCompactRatio: 0.35, trimToolOutputChars: 6000, keepHeadChars: 3000, keepTailChars: 1500 };
const KEYS = Object.keys(TOKEN_RULES);
/** Tools whose output is a log or listing rather than content the model must read whole. */
export const TRIMMED_TOOLS = new Set(['bash', 'pwsh', 'grep', 'glob', 'job_output', 'cpa_web_fetch', 'cpa_search', 'session_search', 'session_event_search']);
export function validateTokenRules(value) {
  if (value === undefined || value === null) return { ...TOKEN_RULES };
  if (value === false) return false;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('tokens 须为对象或 false');
  const extra = Object.keys(value).filter(k => !KEYS.includes(k));
  if (extra.length) throw new Error(`tokens 不支持字段 ${extra.join(', ')}`);
  const out = { ...TOKEN_RULES, ...value };
  if (typeof out.idleCompactRatio !== 'number' || out.idleCompactRatio < 0.1 || out.idleCompactRatio > 0.9) throw new Error('tokens.idleCompactRatio 须为 0.1–0.9');
  for (const k of ['trimToolOutputChars', 'keepHeadChars', 'keepTailChars']) if (!Number.isSafeInteger(out[k]) || out[k] < 200 || out[k] > 200000) throw new Error(`tokens.${k} 须为 200–200000 的整数`);
  if (out.keepHeadChars + out.keepTailChars >= out.trimToolOutputChars) throw new Error('tokens 的保留头尾之和须小于 trimToolOutputChars');
  return out;
}
/** Model-facing token rules, appended to the file rules in the team policy. */
export function tokenRuleText(rules) {
  if (!rules) return '';
  return `Token 铁律：每一步都会重发整段上下文（缓存读取也计费），所以要让上下文小而稳定——只读需要的行段，同一内容不重复读取；命令、搜索输出超过 ${rules.trimToolOutputChars} 字会只保留开头和结尾，完整内容存到文件，需要时用 grep 按行查；不做任务范围外的调研；一次汇报说清，不发进度；空闲时上下文超过窗口 ${Math.round(rules.idleCompactRatio * 100)}% 会自动压缩，接手时以交接、看板和代码为准。`;
}
/** Head + tail of a long text with a pointer to the full copy. Pure. */
export function trimText(text, rules, spillPath) {
  const head = text.slice(0, rules.keepHeadChars);
  const tail = text.slice(-rules.keepTailChars);
  return `${head}\n\n[…已省略中间 ${text.length - head.length - tail.length} 字（共 ${text.length} 字）。完整输出：${spillPath}，需要时用 grep 或 read 的 offset/limit 查看…]\n\n${tail}`;
}
export function createTokenDiscipline(ctx, team, { spillDir = join(tmpdir(), 'capability-team-spill'), rulesOf } = {}) {
  const compacting = new WeakSet();
  const rules = agent => {
    if (rulesOf) return rulesOf(agent);
    const project = team.pinned(agent);
    if (!project) return TOKEN_RULES;
    try { return team.loadSync(project, agent).effective.workflow.tokens; } catch { return TOKEN_RULES; }
  };
  const isMember = agent => { try { return !!ctx.agentTeams.tryMembership(agent); } catch { return false; } };
  const ratioOf = agent => {
    try {
      const projections = ctx.get?.('sessionProjections');
      const tokens = promptTokens(projections, agent.session);
      const window = projections?.stateOf(agent.session, 'contextPressure')?.contextWindow;
      return tokens !== undefined && window ? tokens / window : undefined;
    } catch { return undefined; }
  };
  const api = {
    /** Compact an idle member whose context is above the idle threshold. Returns true when it ran. */
    async compactIdle(agent) {
      const r = rules(agent);
      if (!r || compacting.has(agent) || !isMember(agent) || typeof ctx.compaction?.compactNow !== 'function') return false;
      const ratio = ratioOf(agent);
      if (ratio === undefined || ratio < r.idleCompactRatio) return false;
      compacting.add(agent);
      try { return (await ctx.compaction.compactNow(agent, AbortSignal.timeout(180000))) !== null; }
      catch { return false; } // busy (new work arrived) or nothing compactable: try again on the next idle
      finally { compacting.delete(agent); }
    },
    /** Post-execute decision: trim an oversized log/listing result for a team member. */
    async trim(exec, result) {
      const r = rules(exec.agent);
      if (!r || !TRIMMED_TOOLS.has(exec.name) || !isMember(exec.agent) || !Array.isArray(result?.content)) return undefined;
      const text = result.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      if (text.length <= r.trimToolOutputChars || result.content.some(b => b.type !== 'text')) return undefined;
      await mkdir(spillDir, { recursive: true });
      const path = join(spillDir, `${String(exec.callId ?? Date.now()).replace(/[^\w.-]/g, '_')}.txt`);
      await writeFile(path, text);
      return [{ type: 'text', text: trimText(text, r, path) }];
    },
    register() {
      ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') void api.compactIdle(agent); });
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
