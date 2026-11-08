import { m as modelText } from './i18n.js';
// Memory hub: what the team learned (handoffs, accepted results, pitfalls, decisions) is kept per project,
// recalled into each member's runtime context when it receives work, and searchable on demand. Ingestion is
// automatic for handoffs and teammates' final reports; members can also write a memory explicitly.
// Recall is capped (MEMORY_LIMITS.injectChars) and only changes when the task changes, so it costs little
// context and does not resend the runtime snapshot every step.
import { createEmbedder } from './memory-embed.js';
import { createMemoryBackend } from './memory-backends.js';
import { MEMORY_KINDS, MEMORY_LIMITS, MEMORY_SCOPES, createMemoryCore, createMemoryStore } from './memory-store.js';
import { baseName } from './session-rotation.js';
import { params } from './tool-schema.js';
import { ownsCapabilityTeam } from './preset-guard.js';
const output = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] };
const SCOPES = MEMORY_SCOPES;
const messageText = message => (Array.isArray(message?.content) ? message.content.map(c => c?.text ?? '').join('\n') : String(message?.text ?? message?.content ?? '')).trim();
export function createMemoryHub(ctx, team, { store = createMemoryStore(team.root), embedder = createEmbedder(), backend = createMemoryBackend({ label: modelText('memory-hub.280') }), secrets = () => [] } = {}) {
  const recall = new Map(); // agent id → { query, block }
  const reports = new Map(); // `${session}:${callId}` → text of a pending teammate report
  const identity = agent => {
    const m = ctx.agentTeams.tryMembership(agent);
    if (!m || !ownsCapabilityTeam(ctx, agent)) return undefined;
    return { project: team.pinned(agent) ?? team.pinned(m.root ?? agent), role: m.role === 'lead' ? 'lead' : baseName(m.name), session: agent.id, lead: m.role === 'lead', leadId: (m.root ?? agent).id, name: m.name ?? 'lead' };
  };
  // Redaction, embedding, scope mapping, write + shared-backend sync and use counting are shared with @aiwuk/memory.
  const core = createMemoryCore({ store, embedder, backend, secrets });
  const embedOne = (text, purpose) => core.embed(text, purpose);
  async function backfill(project) {
    if (!embedder.available) return;
    const missing = await store.unembedded(project, 16, embedder.vectorKey);
    if (!missing.length) return;
    const out = await embedder.embed(missing.map(m => m.text), 'passage');
    if (out) for (let i = 0; i < missing.length; i++) await store.setVector(missing[i], out.vectors[i], out.model);
  }
  const hub = {
    async write(who, { kind, text, scope = 'role', tags, key }) {
      if (!who?.project) throw new Error(modelText('memory-hub.281'));
      if (!SCOPES.includes(scope)) throw new Error(modelText('memory-hub.282', { 0: SCOPES.join(' / ') }));
      if (scope === 'global' && !who.lead) throw new Error(modelText('memory-hub.283'));
      // Secrets never enter memory: it is recalled into other members' prompts and may leave this machine.
      // Session-scoped notes stay local; everything else also becomes shared long-term memory.
      const saved = await core.write(who, { kind, text, scope, project: who.project, key: key ? String(key).slice(0, 120) : null,
        tags: Array.isArray(tags) ? tags.map(String).slice(0, 10) : [], source: { member: who.name, session: who.session, lead: who.leadId, at: Date.now() } });
      return saved;
    },
    async search(who, { query, k = 6, kinds }) {
      // The query goes to the embedding service and the shared backend, so it is filtered like a stored memory.
      const q = (await core.clean(String(query ?? '').slice(0, 4000))).slice(0, 2000);
      const limit = Math.min(Math.max(1, k), 20);
      const [embedded, shared] = await Promise.all([q ? embedOne(q, 'query') : null, kinds ? [] : backend.recall(q)]);
      void backfill(who.project).catch(() => {});
      const local = await store.search({ project: who.project, role: who.lead ? undefined : who.role, session: who.session, query: q, vector: embedded?.vector, vectorModel: embedded?.model, k: limit, kinds });
      // Team memories first (scoped to this project/role), then shared long-term ones not already covered.
      const seen = new Set(local.map(r => r.memory.text));
      const results = []; let chars = 0;
      for (const row of [...local, ...shared.filter(r => !seen.has(r.memory.text))]) {
        const size = JSON.stringify(row.memory.text).length;
        if (results.length >= limit || chars + size > 12000) continue;
        results.push(row); chars += size;
      }
      return { results, mode: embedded ? 'hybrid' : 'text', embedError: embedded ? null : embedder.lastError, ...(backend.enabled ? { shared: { backend: backend.name, count: shared.length, error: backend.lastError } } : {}) };
    },
    backend,
    /** Called by rotation after a member writes its handoff. */
    async ingestHandoff(h) {
      const who = { project: team.pinned(ctx.agents.get(h.session)) ?? undefined, role: h.role, session: h.session, lead: false, leadId: h.lead, name: h.member };
      if (!who.project) return;
      const w = h.written ?? {};
      if (w.done || w.remaining) await hub.write(who, { kind: 'handoff', scope: 'role', key: `handoff:${h.role}`, text: modelText('memory-hub.284', { 0: h.member, 1: w.done || '—', 2: w.remaining || '—', 3: w.verify ? modelText('memory-hub.285', { 0: w.verify }) : '' }) });
      if (w.pitfalls) await hub.write(who, { kind: 'pitfall', scope: 'project', text: modelText('memory-hub.286', { 0: h.role, 1: w.pitfalls }) });
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
      await core.markUsed(results.map(r => r.memory)); // backend hits are not in the store
    },
    recallText(agent) {
      const r = recall.get(agent.id);
      return r?.block ? modelText('memory-hub.287', { 0: r.block }) : '';
    },
    register() {
      ctx.on('agent/created', ({ agent }) => {
        if (!ownsCapabilityTeam(ctx, agent) || !ctx.agentTeams.tryMembership(agent)) return;
        agent.ctx.systemPrompt.context({ name: 'capability-team:memory', order: 97, text: () => hub.recallText(agent) });
      });
      ctx.on('agent/inbox/claimed', ({ agent, message }) => {
        const text = messageText(message);
        if (text.length >= 8 && ownsCapabilityTeam(ctx, agent) && ctx.agentTeams.tryMembership(agent)) void hub.refreshRecall(agent, text.slice(0, 2000)).catch(() => {});
      });
      // A teammate's successful final report to the Lead becomes a 'result' memory of its role.
      try {
        ctx.on('session/event', (session, event) => {
          const agent = session?.id && ctx.agents.get(session.id);
          if (!ownsCapabilityTeam(ctx, agent) || ctx.agentTeams.tryMembership(agent)?.role !== 'teammate') return;
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
        description: modelText('memory-hub.288'),
        parameters: params({ query: { type: 'string', description: modelText('memory-hub.289') }, k: { type: 'integer', description: modelText('memory-hub.290') },
          kinds: { type: 'array', items: { type: 'string', enum: MEMORY_KINDS }, description: modelText('memory-hub.291') } }, ['query']),
        async execute(args, exec) {
          const who = identity(exec.agent);
          if (!who) throw new Error(modelText('memory-hub.292'));
          const { results, mode, embedError, shared } = await hub.search(who, args);
          return JSON.stringify({ mode, ...(embedError ? { note: modelText('memory-hub.293', { 0: embedError }) } : {}),
            ...(shared ? { shared: shared.error ? modelText('memory-hub.294', { 0: shared.backend, 1: shared.error }) : modelText('memory-hub.295', { 0: shared.count, 1: shared.backend }) } : {}),
            results: results.map(r => ({ id: r.memory.id, kind: r.memory.kind, scope: r.memory.scope.kind, text: r.memory.text, via: r.via, updatedAt: r.memory.updatedAt })) });
        },
      }));
      ctx.effect(() => ctx.tools.register({ name: 'capability_memory_write', output,
        description: modelText('memory-hub.296'),
        parameters: params({ kind: { type: 'string', enum: ['pitfall', 'decision', 'note'] }, text: { type: 'string' }, scope: { type: 'string', enum: SCOPES },
          key: { type: 'string', description: modelText('memory-hub.297') }, tags: { type: 'array', items: { type: 'string' } } }, ['kind', 'text']),
        async execute(args, exec) {
          const { memory, merged, syncError } = await hub.write(identity(exec.agent), args);
          return JSON.stringify({ saved: true, merged, ...(syncError ? { syncWarning: syncError } : {}), id: memory.id, kind: memory.kind, scope: memory.scope.kind, embedded: !!memory.vector });
        },
      }));
      // Plugin reload or shutdown: send what is still queued for the shared long-term memory.
      ctx.effect(() => () => { void backend.flush().catch(() => {}); });
    },
  };
  return hub;
}
