import { m as modelText } from './i18n.js';
// Session rotation: a teammate session that has been compacted several times, is close to its context window,
// or keeps re-reading the same file is handed over to a fresh successor instead of piling up. The member
// writes a structured handoff (capability_handoff); the plugin adds facts it collects itself (git diff stat,
// owned board tasks, last test command). The Lead then calls capability_rotate_member, which names the
// successor `<role>-r<N>` (team rosters never reuse a name) and returns the exact calls to make.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { params } from './tool-schema.js';
import { ownsCapabilityTeam } from './preset-guard.js';
import { promptTokens } from './long-context.js';
import { restrictiveToolName } from './tool-names.js';
const TRACKED_TOOLS = new Set(['read', 'write', 'edit', 'str_replace_editor', 'apply_patch', 'bash', 'pwsh', 'send_message']);
export const ROTATION = { softCompactions: 2, hardCompactions: 3, softRatio: 0.75, hardRatio: 0.9, softRepeatReads: 15, hardTurns: 8, maxMembers: 8 };
const KEYS = Object.keys(ROTATION);
const SUFFIX = /-r(\d+)$/;
export const baseName = name => String(name ?? '').replace(SUFFIX, '');
export const generation = name => Number(SUFFIX.exec(String(name ?? ''))?.[1] ?? 1);
export const successorName = name => `${baseName(name)}-r${generation(name) + 1}`;
const output = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] };
export function validateRotation(value) {
  if (value === undefined || value === null) return { ...ROTATION };
  if (value === false) return false;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(modelText('session-rotation.433'));
  const extra = Object.keys(value).filter(k => !KEYS.includes(k));
  if (extra.length) throw new Error(modelText('session-rotation.434', { 0: extra.join(', ') }));
  const out = { ...ROTATION, ...value };
  for (const k of ['softRatio', 'hardRatio']) if (typeof out[k] !== 'number' || out[k] <= 0 || out[k] > 1) throw new Error(modelText('session-rotation.435', { 0: k }));
  for (const k of KEYS.filter(k => !k.endsWith('Ratio'))) if (!Number.isSafeInteger(out[k]) || out[k] < 1 || out[k] > 1000) throw new Error(modelText('session-rotation.436', { 0: k }));
  if (out.softCompactions > out.hardCompactions || out.softRatio > out.hardRatio) throw new Error(modelText('session-rotation.437'));
  return out;
}
/** 'ok' | 'soft' | 'hard' with the reasons, from one session's counters and its context ratio. */
export function rotationLevel(m, ratio, limits) {
  if (!limits || !m) return { level: 'ok', reasons: [] };
  const hard = [], soft = [];
  if (m.compactions >= limits.hardCompactions) hard.push(modelText('session-rotation.438', { 0: m.compactions }));
  else if (m.compactions >= limits.softCompactions) soft.push(modelText('session-rotation.439', { 0: m.compactions }));
  if (ratio !== undefined && ratio >= limits.hardRatio) hard.push(modelText('session-rotation.440', { 0: Math.round(ratio * 100) }));
  else if (ratio !== undefined && ratio >= limits.softRatio) soft.push(modelText('session-rotation.441', { 0: Math.round(ratio * 100) }));
  if (m.turns >= limits.hardTurns) hard.push(modelText('session-rotation.442', { 0: m.turns }));
  if (m.maxRepeat >= limits.softRepeatReads) soft.push(modelText('session-rotation.443', { 0: m.maxRepeat }));
  // Rotating a session that has produced nothing only makes the successor read everything again, so a
  // stalled session stays at the reminder level until it edits a file or the host compacts it.
  const progressed = (m.edits ?? 0) > 0 || m.compactions > 0;
  if (hard.length && !progressed) return { level: 'soft', reasons: [...hard, ...soft], stalled: true };
  return hard.length ? { level: 'hard', reasons: [...hard, ...soft] } : soft.length ? { level: 'soft', reasons: soft } : { level: 'ok', reasons: [] };
}
const TEST_CMD = /\b(npm (run )?test|node --test|pnpm test|yarn test|pytest|go test|cargo test|vitest|jest)\b/;
/** Fold one session event into the counters. Pure, so tests can replay a log. */
export function foldEvent(m, event) {
  const data = event?.data ?? {};
  const d = { ...data, name: restrictiveToolName(data.name, TRACKED_TOOLS) };
  if (event?.type === 'compaction/end') m.compactions++;
  else if (event?.type === 'turn/start') m.turns++;
  else if (event?.type === 'tool/call') {
    let args = {}; try { args = typeof d.arguments === 'string' ? JSON.parse(d.arguments) : d.arguments ?? {}; } catch { /* partial */ }
    if (d.name === 'read' && typeof args.file_path === 'string') {
      const n = (m.reads.get(args.file_path) ?? 0) + 1; m.reads.set(args.file_path, n); m.maxRepeat = Math.max(m.maxRepeat, n);
    }
    if (['write', 'edit', 'str_replace_editor', 'apply_patch'].includes(d.name) && !(d.name === 'str_replace_editor' && args.command === 'view')) m.edits++;
    if (['bash', 'pwsh'].includes(d.name) && TEST_CMD.test(String(args.command ?? ''))) m.pendingTest = { callId: d.callId, command: String(args.command).slice(0, 300) };
  } else if (event?.type === 'tool/result' && m.pendingTest && d.message?.toolCallId === m.pendingTest.callId) {
    const text = (d.message.content ?? []).map(c => c.text ?? '').join('\n');
    const summary = text.split('\n').filter(l => /\b(pass|fail|tests?|ok|error)\b/i.test(l)).slice(-6).join('\n');
    m.lastTest = { command: m.pendingTest.command, isError: !!d.message.isError, summary: summary.slice(0, 600), at: event.time ?? null };
    m.pendingTest = null;
  }
  return m;
}
export const emptyMetrics = () => ({ compactions: 0, turns: 0, edits: 0, reads: new Map(), maxRepeat: 0, lastTest: null, pendingTest: null });
const gitStat = cwd => new Promise(resolve => execFile('git', ['diff', '--stat'], { cwd, timeout: 5000, maxBuffer: 1 << 20 }, (error, stdout) =>
  resolve(error ? null : stdout.trim().split('\n').slice(-40).join('\n'))));
export function createRotation(ctx, team, { root = team.root, diffStat = gitStat, now = Date.now, onHandoff } = {}) {
  const metrics = new Map(); // session id → counters
  const handoffs = new Map(); // `${leadId}:${memberName}` → latest handoff
  const retired = new Map(); // `${leadId}:${memberName}` → successor name
  const planned = new Map(); // `${leadId}:${successor}` → { from, prompt }
  const counters = id => { if (!metrics.has(id)) metrics.set(id, emptyMetrics()); return metrics.get(id); };
  const limitsOf = agent => { try { const project = team.pinned(agent); return project ? team.loadSync(project, agent).effective.workflow.rotation : false; } catch { return false; } };
  const ratioOf = agent => {
    try {
      const projections = ctx.get?.('sessionProjections');
      const tokens = promptTokens(projections, agent.session);
      const window = projections?.stateOf(agent.session, 'contextPressure')?.contextWindow;
      return tokens !== undefined && window ? tokens / window : undefined;
    } catch { return undefined; }
  };
  const dir = leadId => join(root, 'handoffs', createHash('sha256').update(leadId).digest('hex').slice(0, 32));
  const fileOf = name => `${name.includes('/') ? createHash('sha256').update(name).digest('hex') : name}.json`;
  const api = {
    metrics: id => metrics.get(id),
    status(agent) { return rotationLevel(metrics.get(agent.id), ratioOf(agent), limitsOf(agent)); },
    retiredTo: (leadId, name) => retired.get(`${leadId}:${name}`),
    /** Lead guard: no new work for a retired member or one past the hard line; successors may be spawned. */
    async guard(exec) {
      const membership = team.native.identity(exec.agent);
      if (!ownsCapabilityTeam(ctx, exec.agent, team.native) || membership?.role !== 'lead' || !limitsOf(exec.agent)) return undefined;
      const lead = exec.agent;
      if (restrictiveToolName(exec.name, TRACKED_TOOLS) === 'send_message') {
        const target = exec.arguments?.agent ?? exec.arguments?.target;
        const next = retired.get(`${lead.id}:${target}`);
        if (next) return modelText('session-rotation.444', { 0: target, 1: next, 2: next });
        const member = (await team.native.list(lead)).find(m => m.name === target && m.role !== 'lead');
        const agent = member && ctx.agents.get(member.id);
        const status = agent && api.status(agent);
        if (status?.level === 'hard') return modelText('session-rotation.445', { 0: target, 1: status.reasons.join('、') });
      }
      return undefined;
    },
    /** Whether `name` is a successor this Lead asked for via capability_rotate_member. */
    plannedSuccessor: (leadId, name) => planned.has(`${leadId}:${name}`),
    /** The member a planned successor replaces, if any. */
    predecessorOf: (leadId, name) => planned.get(`${leadId}:${name}`)?.from,
    async writeHandoff(agent, args) {
      const membership = team.native.identity(agent);
      if (membership?.role !== 'teammate') throw new Error(modelText('session-rotation.446'));
      const lead = membership.root;
      const project = team.pinned(agent) ?? ctx.workingDirectory?.get?.(agent.session);
      const m = metrics.get(agent.id) ?? emptyMetrics();
      let tasks = [];
      try { tasks = (ctx.agentTeams.listTasks?.(lead) ?? []).filter(t => t.status !== 'deleted' && t.status !== 'completed' && (t.ownerId === agent.id || t.ownerName === membership.address)).map(t => ({ id: t.id, subject: t.subject, status: t.status })); } catch { /* optional */ }
      const text = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
      const handoff = { schemaVersion: 1, at: now(), lead: lead.id, member: membership.address, role: baseName(membership.roleName), session: agent.id,
        written: { goal: text(args.goal), done: text(args.done), remaining: text(args.remaining), pitfalls: text(args.pitfalls), open: text(args.open), verify: text(args.verify) },
        facts: { diffStat: project ? await diffStat(project) : null, openTasks: tasks, lastTest: m.lastTest, compactions: m.compactions, turns: m.turns } };
      if (!handoff.written.remaining && !handoff.written.done) throw new Error(modelText('session-rotation.447'));
      handoffs.set(`${lead.id}:${membership.address}`, handoff);
      await mkdir(dir(lead.id), { recursive: true });
      await writeFile(join(dir(lead.id), fileOf(membership.address)), JSON.stringify(handoff, null, 2) + '\n');
      try { await onHandoff?.(handoff); } catch { /* the handoff is saved even if the memory hub is unavailable */ }
      return handoff;
    },
    async readHandoff(leadId, name) {
      const key = `${leadId}:${name}`;
      if (handoffs.has(key)) return handoffs.get(key);
      try { const h = JSON.parse(await readFile(join(dir(leadId), fileOf(name)), 'utf8')); handoffs.set(key, h); return h; } catch { return undefined; }
    },
    /** Plan the successor for a member: name, fresh-context prompt, and the calls the Lead makes. */
    async rotate(lead, args) {
      const name = String(args.role ?? '');
      const members = (await team.native.list(lead)).filter(m => m.role !== 'lead' && m.local !== false);
      const current = members.find(m => m.name === name) ?? members.filter(m => baseName(m.name) === baseName(name)).sort((a, b) => generation(b.name) - generation(a.name))[0];
      if (!current) throw new Error(modelText('session-rotation.448', { 0: name }));
      const limits = limitsOf(lead) || ROTATION;
      const used = (await team.native.list(lead)).length;
      if (used >= limits.maxMembers) {
        return { rotated: false, reason: modelText('session-rotation.449', { 0: used, 1: limits.maxMembers }),
          next: modelText('session-rotation.450', { 0: current.name }) };
      }
      const handoff = await api.readHandoff(lead.id, current.name);
      if (!handoff && !args.without_handoff) {
        return { rotated: false, reason: modelText('session-rotation.451', { 0: current.name }),
          next: modelText('session-rotation.452', { 0: current.name }) };
      }
      const successor = successorName(current.name);
      const facts = handoff?.facts ?? { diffStat: await diffStat(team.pinned(lead) ?? '.'), openTasks: [], lastTest: metrics.get(current.id)?.lastTest ?? null };
      const w = handoff?.written ?? {};
      const prompt = [modelText('session-rotation.453', { 0: current.name, 1: baseName(current.name) }),
        args.task ? modelText('session-rotation.454', { 0: String(args.task).slice(0, 4000) }) : null,
        w.goal ? modelText('session-rotation.455', { 0: w.goal }) : null, w.done ? modelText('session-rotation.456', { 0: w.done }) : null, w.remaining ? modelText('session-rotation.457', { 0: w.remaining }) : null,
        w.pitfalls ? modelText('session-rotation.458', { 0: w.pitfalls }) : null, w.open ? modelText('session-rotation.459', { 0: w.open }) : null, w.verify ? modelText('session-rotation.460', { 0: w.verify }) : null,
        facts.diffStat ? modelText('session-rotation.461', { 0: facts.diffStat }) : null,
        facts.openTasks?.length ? modelText('session-rotation.462', { 0: facts.openTasks.map(t => `${t.id} ${t.subject}`).join('；') }) : null,
        facts.lastTest ? modelText('session-rotation.463', { 0: facts.lastTest.command, 1: facts.lastTest.isError ? modelText('session-rotation.464') : modelText('session-rotation.465'), 2: facts.lastTest.summary }) : null,
        modelText('session-rotation.466')].filter(Boolean).join('\n\n');
      planned.set(`${lead.id}:${successor}`, { from: current.name, prompt });
      retired.set(`${lead.id}:${current.name}`, successor);
      if (team.native.kind() === 'rc2') return { rotated: true, from: current.name, to: successor, handoff: handoff ? 'member' : 'facts-only',
        next: [`interrupt_agent agent=${current.name}`, `subagent name=${successor.split('/').at(-1)}`,
          `parent=${current.name.includes('/') ? current.name.slice(0, current.name.lastIndexOf('/')) : 'lead'}`].join('\n'), prompt };
      return { rotated: true, from: current.name, to: successor, handoff: handoff ? 'member' : 'facts-only',
        next: [`1. interrupt_agent target=${current.name}`, modelText('session-rotation.467', { 0: successor }),
          facts.openTasks?.length ? modelText('session-rotation.468', { 0: facts.openTasks.map(t => t.id).join('、'), 1: successor }) : null].filter(Boolean).join('\n'), prompt };
    },
    register() {
      try { ctx.on('session/event', (session, event) => { if (session?.id && ownsCapabilityTeam(ctx, ctx.agents.get(session.id), team.native) && team.native.identity(ctx.agents.get(session.id))?.role === 'teammate') foldEvent(counters(session.id), event); }); } catch { /* host without session observers */ }
      ctx.effect(() => team.native.onLocalStart(({ agent }) => {
        const identity = team.native.identity(agent);
        if (!ownsCapabilityTeam(ctx, agent, team.native) || identity?.role !== 'teammate') return;
        counters(agent.id);
        // Runtime context only says something once a threshold is crossed, so it does not churn the cache.
        agent.ctx.systemPrompt.context({ name: 'capability-team:rotation', order: 98, text: () => {
          const s = api.status(agent);
          if (s.level === 'ok') return '';
          return s.level === 'hard'
            ? modelText('session-rotation.469', { 0: s.reasons.join('、') })
            : modelText('session-rotation.470', { 0: s.reasons.join('、'), 1: s.stalled ? modelText('session-rotation.471') : '' });
        } });
      }));
      ctx.effect(() => ctx.tools.guard(exec => api.guard(exec)));
      ctx.effect(() => ctx.tools.register({ name: 'capability_handoff', output,
        description: modelText('session-rotation.472'),
        parameters: params({ goal: { type: 'string' }, done: { type: 'string' }, remaining: { type: 'string' }, pitfalls: { type: 'string' }, open: { type: 'string' }, verify: { type: 'string' } }, ['done', 'remaining']),
        async execute(args, exec) { const h = await api.writeHandoff(exec.agent, args); return JSON.stringify({ saved: true, member: h.member, facts: { diffStat: !!h.facts.diffStat, openTasks: h.facts.openTasks.length, lastTest: h.facts.lastTest?.command ?? null } }); },
      }));
      ctx.effect(() => ctx.tools.register({ name: 'capability_rotate_member', output,
        description: modelText('session-rotation.473'),
        parameters: params({ role: { type: 'string', description: modelText('session-rotation.474') }, task: { type: 'string', description: modelText('session-rotation.475') }, without_handoff: { type: 'boolean', description: modelText('session-rotation.476') } }, ['role']),
        async execute(args, exec) {
          if (team.native.identity(exec.agent)?.role !== 'lead') throw new Error(modelText('session-rotation.477'));
          return JSON.stringify(await api.rotate(exec.agent, args));
        },
      }));
    },
  };
  return api;
}
