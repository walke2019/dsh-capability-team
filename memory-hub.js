// Memory hub: what the team learned (handoffs, accepted results, pitfalls, decisions) is kept per project,
// recalled into each member's runtime context when it receives work, and searchable on demand. Ingestion is
// automatic for handoffs and teammates' final reports; members can also write a memory explicitly.
// Recall is capped (MEMORY_LIMITS.injectChars) and only changes when the task changes, so it costs little
// context and does not resend the runtime snapshot every step.
import { createEmbedder } from './memory-embed.js';
import { MEMORY_KINDS, MEMORY_LIMITS, createMemoryStore } from './memory-store.js';
import { baseName } from './session-rotation.js';
import { params } from './tool-schema.js';
const output = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] };
const SCOPES = ['project', 'role', 'session', 'global'];
const messageText = message => (Array.isArray(message?.content) ? message.content.map(c => c?.text ?? '').join('\n') : String(message?.text ?? message?.content ?? '')).trim();
export function createMemoryHub(ctx, team, { store = createMemoryStore(team.root), embedder = createEmbedder() } = {}) {
  const recall = new Map(); // agent id → { query, block }
  const reports = new Map(); // `${session}:${callId}` → text of a pending teammate report
  const identity = agent => {
    const m = ctx.agentTeams.tryMembership(agent);
    if (!m) return undefined;
    return { project: team.pinned(agent) ?? team.pinned(m.root ?? agent), role: m.role === 'lead' ? 'lead' : baseName(m.name), session: agent.id, lead: m.role === 'lead', leadId: (m.root ?? agent).id, name: m.name ?? 'lead' };
  };
  const embedOne = async (text, purpose) => { const out = await embedder.embed([text], purpose); return out ? { vector: out.vectors[0], model: out.model } : null; };
  async function backfill(project) {
    if (!embedder.available) return;
    const missing = await store.unembedded(project, 16, embedder.vectorKey);
    if (!missing.length) return;
    const out = await embedder.embed(missing.map(m => m.text), 'passage');
    if (out) for (let i = 0; i < missing.length; i++) await store.setVector(missing[i], out.vectors[i], out.model);
  }
  const hub = {
    async write(who, { kind, text, scope = 'role', tags, key }) {
      if (!who?.project) throw new Error('当前会话不属于能力团队项目，不能写记忆');
      if (!SCOPES.includes(scope)) throw new Error(`scope 须为 ${SCOPES.join(' / ')}`);
      if (scope === 'global' && !who.lead) throw new Error('只有主控可以写全局记忆');
      const embedded = await embedOne(String(text ?? ''), 'passage');
      const s = scope === 'global' ? { kind: 'global' } : scope === 'project' ? { kind: 'project', project: who.project }
        : scope === 'session' ? { kind: 'session', project: who.project, session: who.session } : { kind: 'role', project: who.project, role: who.role };
      return store.write({ scope: s, kind, text, tags: Array.isArray(tags) ? tags.map(String).slice(0, 10) : [], key: key ? String(key).slice(0, 120) : null,
        vector: embedded?.vector ?? null, model: embedded?.model ?? null, source: { member: who.name, session: who.session, lead: who.leadId, at: Date.now() } });
    },
    async search(who, { query, k = 6, kinds }) {
      const q = String(query ?? '').slice(0, 2000);
      const embedded = q ? await embedOne(q, 'query') : null;
      void backfill(who.project).catch(() => {});
      const results = await store.search({ project: who.project, role: who.lead ? undefined : who.role, session: who.session, query: q, vector: embedded?.vector, vectorModel: embedded?.model, k: Math.min(Math.max(1, k), 20), kinds });
      return { results, mode: embedded ? 'hybrid' : 'text', embedError: embedded ? null : embedder.lastError };
    },
    /** Called by rotation after a member writes its handoff. */
    async ingestHandoff(h) {
      const who = { project: team.pinned(ctx.agents.get(h.session)) ?? undefined, role: h.role, session: h.session, lead: false, leadId: h.lead, name: h.member };
      if (!who.project) return;
      const w = h.written ?? {};
      if (w.done || w.remaining) await hub.write(who, { kind: 'handoff', scope: 'role', key: `handoff:${h.role}`, text: `交接（${h.member}）：已完成：${w.done || '—'}；剩余：${w.remaining || '—'}${w.verify ? `；验证：${w.verify}` : ''}` });
      if (w.pitfalls) await hub.write(who, { kind: 'pitfall', scope: 'project', text: `${h.role} 踩过的坑：${w.pitfalls}` });
    },
    /** Memory block for a member's runtime context; refreshed when its task text changes. */
    async refreshRecall(agent, query) {
      const who = identity(agent);
      if (!who?.project || !query) return;
      const prior = recall.get(agent.id);
      if (prior?.query === query) return;
      const { results } = await hub.search(who, { query, k: 8 });
      const block = store.format(results, MEMORY_LIMITS.injectChars);
      recall.set(agent.id, { query, block, ids: results.map(r => r.memory.id) });
      if (results.length) await store.markUsed(results.map(r => r.memory));
    },
    recallText(agent) {
      const r = recall.get(agent.id);
      return r?.block ? `【记忆枢纽】与当前任务相关的已有结论（来自交接、验收结果与踩坑记录，仅供参考，以实际代码为准；需要更多时调用 capability_memory_search）：\n${r.block}` : '';
    },
    register() {
      ctx.on('agent/created', ({ agent }) => {
        if (!ctx.agentTeams.tryMembership(agent)) return;
        agent.ctx.systemPrompt.context({ name: 'capability-team:memory', order: 97, text: () => hub.recallText(agent) });
      });
      ctx.on('agent/inbox/claimed', ({ agent, message }) => {
        const text = messageText(message);
        if (text.length >= 8 && ctx.agentTeams.tryMembership(agent)) void hub.refreshRecall(agent, text.slice(0, 2000)).catch(() => {});
      });
      // A teammate's successful final report to the Lead becomes a 'result' memory of its role.
      try {
        ctx.on('session/event', (session, event) => {
          const agent = session?.id && ctx.agents.get(session.id);
          if (!agent || ctx.agentTeams.tryMembership(agent)?.role !== 'teammate') return;
          const d = event?.data ?? {};
          if (event.type === 'tool/call' && d.name === 'send_message') {
            let args = {}; try { args = typeof d.arguments === 'string' ? JSON.parse(d.arguments) : d.arguments ?? {}; } catch { return; }
            if (args.target === 'lead' && String(args.message ?? '').length >= 200) reports.set(`${session.id}:${d.callId}`, String(args.message));
          } else if (event.type === 'tool/result') {
            const key = `${session.id}:${d.message?.toolCallId}`;
            const text = reports.get(key);
            if (text === undefined) return;
            reports.delete(key);
            if (!d.message?.isError) void hub.write(identity(agent), { kind: 'result', scope: 'role', text }).catch(() => {});
          }
        });
      } catch { /* host without session observers: explicit writes still work */ }
      ctx.effect(() => ctx.tools.register({ name: 'capability_memory_search', output,
        description: '在记忆枢纽中检索本项目已有的结论：交接、验收结果、踩坑、决定与笔记。全文与向量混合检索（嵌入不可用时只用全文）。动手前先查，避免重复读文件或重踩已知的坑。',
        parameters: params({ query: { type: 'string', description: '要找什么，用自然语言或关键词' }, k: { type: 'integer', description: '返回条数，1–20，默认 6' },
          kinds: { type: 'array', items: { type: 'string', enum: MEMORY_KINDS }, description: '只看这些类型（可选）' } }, ['query']),
        async execute(args, exec) {
          const who = identity(exec.agent);
          if (!who) throw new Error('只有能力团队成员可以检索记忆');
          const { results, mode, embedError } = await hub.search(who, args);
          return JSON.stringify({ mode, ...(embedError ? { note: `向量检索暂不可用：${embedError}` } : {}),
            results: results.map(r => ({ id: r.memory.id, kind: r.memory.kind, scope: r.memory.scope.kind, text: r.memory.text, via: r.via, updatedAt: r.memory.updatedAt })) });
        },
      }));
      ctx.effect(() => ctx.tools.register({ name: 'capability_memory_write', output,
        description: '把一条值得以后复用的结论写进记忆枢纽：pitfall（踩过的坑）、decision（定下的决定，带 key 时新的会替换旧的）、note（笔记）。内容要具体、可验证、一两句话；不要写进度，不要写密钥。scope：role（默认，本角色）/ project（全队）/ session / global（仅主控）。相同内容会自动合并。',
        parameters: params({ kind: { type: 'string', enum: ['pitfall', 'decision', 'note'] }, text: { type: 'string' }, scope: { type: 'string', enum: SCOPES },
          key: { type: 'string', description: '决定的主题键（可选），同一主题的新决定会替换旧的' }, tags: { type: 'array', items: { type: 'string' } } }, ['kind', 'text']),
        async execute(args, exec) {
          const { memory, merged } = await hub.write(identity(exec.agent), args);
          return JSON.stringify({ saved: true, merged, id: memory.id, kind: memory.kind, scope: memory.scope.kind, embedded: !!memory.vector });
        },
      }));
    },
  };
  return hub;
}
