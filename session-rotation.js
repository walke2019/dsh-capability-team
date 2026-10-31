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
import { promptTokens } from './long-context.js';
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
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('rotation 须为对象或 false');
  const extra = Object.keys(value).filter(k => !KEYS.includes(k));
  if (extra.length) throw new Error(`rotation 不支持字段 ${extra.join(', ')}`);
  const out = { ...ROTATION, ...value };
  for (const k of ['softRatio', 'hardRatio']) if (typeof out[k] !== 'number' || out[k] <= 0 || out[k] > 1) throw new Error(`rotation.${k} 须为 0–1 之间的小数`);
  for (const k of KEYS.filter(k => !k.endsWith('Ratio'))) if (!Number.isSafeInteger(out[k]) || out[k] < 1 || out[k] > 1000) throw new Error(`rotation.${k} 须为 1–1000 的整数`);
  if (out.softCompactions > out.hardCompactions || out.softRatio > out.hardRatio) throw new Error('rotation 的软阈值不能高于硬阈值');
  return out;
}
/** 'ok' | 'soft' | 'hard' with the reasons, from one session's counters and its context ratio. */
export function rotationLevel(m, ratio, limits) {
  if (!limits || !m) return { level: 'ok', reasons: [] };
  const hard = [], soft = [];
  if (m.compactions >= limits.hardCompactions) hard.push(`已压缩 ${m.compactions} 次`);
  else if (m.compactions >= limits.softCompactions) soft.push(`已压缩 ${m.compactions} 次`);
  if (ratio !== undefined && ratio >= limits.hardRatio) hard.push(`上下文占用 ${Math.round(ratio * 100)}%`);
  else if (ratio !== undefined && ratio >= limits.softRatio) soft.push(`上下文占用 ${Math.round(ratio * 100)}%`);
  if (m.turns >= limits.hardTurns) hard.push(`已跑 ${m.turns} 轮`);
  if (m.maxRepeat >= limits.softRepeatReads) soft.push(`同一文件读了 ${m.maxRepeat} 次`);
  // Rotating a session that has produced nothing only makes the successor read everything again, so a
  // stalled session stays at the reminder level until it edits a file or the host compacts it.
  const progressed = (m.edits ?? 0) > 0 || m.compactions > 0;
  if (hard.length && !progressed) return { level: 'soft', reasons: [...hard, ...soft], stalled: true };
  return hard.length ? { level: 'hard', reasons: [...hard, ...soft] } : soft.length ? { level: 'soft', reasons: soft } : { level: 'ok', reasons: [] };
}
const TEST_CMD = /\b(npm (run )?test|node --test|pnpm test|yarn test|pytest|go test|cargo test|vitest|jest)\b/;
/** Fold one session event into the counters. Pure, so tests can replay a log. */
export function foldEvent(m, event) {
  const d = event?.data ?? {};
  if (event?.type === 'compaction/end') m.compactions++;
  else if (event?.type === 'turn/start') m.turns++;
  else if (event?.type === 'tool/call') {
    let args = {}; try { args = typeof d.arguments === 'string' ? JSON.parse(d.arguments) : d.arguments ?? {}; } catch { /* partial */ }
    if (d.name === 'read' && typeof args.file_path === 'string') {
      const n = (m.reads.get(args.file_path) ?? 0) + 1; m.reads.set(args.file_path, n); m.maxRepeat = Math.max(m.maxRepeat, n);
    }
    if (['write', 'edit', 'str_replace_editor', 'apply_patch'].includes(d.name) && !(d.name === 'str_replace_editor' && args.command === 'view')) m.edits++;
    if (d.name === 'bash' && TEST_CMD.test(String(args.command ?? ''))) m.pendingTest = { callId: d.callId, command: String(args.command).slice(0, 300) };
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
  const api = {
    metrics: id => metrics.get(id),
    status(agent) { return rotationLevel(metrics.get(agent.id), ratioOf(agent), limitsOf(agent)); },
    retiredTo: (leadId, name) => retired.get(`${leadId}:${name}`),
    /** Lead guard: no new work for a retired member or one past the hard line; successors may be spawned. */
    guard(exec) {
      const membership = ctx.agentTeams.tryMembership(exec.agent);
      if (membership?.role !== 'lead') return undefined;
      const lead = exec.agent;
      if (exec.name === 'send_message') {
        const target = exec.arguments?.target;
        const next = retired.get(`${lead.id}:${target}`);
        if (next) return `队友 ${target} 已交接给 ${next}，请改发给 ${next}。`;
        const member = ctx.agentTeams.listMembers(lead).find(m => m.name === target && m.role !== 'lead');
        const agent = member && ctx.agents.get(member.id);
        const status = agent && api.status(agent);
        if (status?.level === 'hard') return `队友 ${target} 的会话已到轮换线（${status.reasons.join('、')}），不要再派新活。先调用 capability_rotate_member 轮换到新会话。`;
      }
      return undefined;
    },
    /** Whether `name` is a successor this Lead asked for via capability_rotate_member. */
    plannedSuccessor: (leadId, name) => planned.has(`${leadId}:${name}`),
    /** The member a planned successor replaces, if any. */
    predecessorOf: (leadId, name) => planned.get(`${leadId}:${name}`)?.from,
    async writeHandoff(agent, args) {
      const membership = ctx.agentTeams.tryMembership(agent);
      if (membership?.role !== 'teammate') throw new Error('只有队友写交接；主控用 capability_rotate_member 发起轮换');
      const lead = membership.root;
      const project = team.pinned(agent) ?? ctx.workingDirectory?.get?.(agent.session);
      const m = metrics.get(agent.id) ?? emptyMetrics();
      let tasks = [];
      try { tasks = (ctx.agentTeams.listTasks?.(lead) ?? []).filter(t => t.status !== 'deleted' && t.status !== 'completed' && (t.ownerId === agent.id || t.ownerName === membership.name)).map(t => ({ id: t.id, subject: t.subject, status: t.status })); } catch { /* optional */ }
      const text = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
      const handoff = { schemaVersion: 1, at: now(), lead: lead.id, member: membership.name, role: baseName(membership.name), session: agent.id,
        written: { goal: text(args.goal), done: text(args.done), remaining: text(args.remaining), pitfalls: text(args.pitfalls), open: text(args.open), verify: text(args.verify) },
        facts: { diffStat: project ? await diffStat(project) : null, openTasks: tasks, lastTest: m.lastTest, compactions: m.compactions, turns: m.turns } };
      if (!handoff.written.remaining && !handoff.written.done) throw new Error('交接至少要写明已完成（done）和剩余（remaining）');
      handoffs.set(`${lead.id}:${membership.name}`, handoff);
      await mkdir(dir(lead.id), { recursive: true });
      await writeFile(join(dir(lead.id), `${membership.name}.json`), JSON.stringify(handoff, null, 2) + '\n');
      try { await onHandoff?.(handoff); } catch { /* the handoff is saved even if the memory hub is unavailable */ }
      return handoff;
    },
    async readHandoff(leadId, name) {
      const key = `${leadId}:${name}`;
      if (handoffs.has(key)) return handoffs.get(key);
      try { const h = JSON.parse(await readFile(join(dir(leadId), `${name}.json`), 'utf8')); handoffs.set(key, h); return h; } catch { return undefined; }
    },
    /** Plan the successor for a member: name, fresh-context prompt, and the calls the Lead makes. */
    async rotate(lead, args) {
      const name = String(args.role ?? '');
      const members = ctx.agentTeams.listMembers(lead).filter(m => m.role !== 'lead');
      const current = members.find(m => m.name === name) ?? members.filter(m => baseName(m.name) === baseName(name)).sort((a, b) => generation(b.name) - generation(a.name))[0];
      if (!current) throw new Error(`找不到队友 ${name}`);
      const limits = limitsOf(lead) || ROTATION;
      const used = ctx.agentTeams.listMembers(lead).length;
      if (used >= limits.maxMembers) {
        return { rotated: false, reason: `团队名额已用完（${used}/${limits.maxMembers}），无法创建接替者。`,
          next: `不轮换，改用省上下文模式继续：告诉 ${current.name} 只用 grep 定位后按 offset/limit 小段读、测试最后统一跑一次、汇报分条发。需要长期解决时请用户调大 DSH 的 maxMembers。` };
      }
      const handoff = await api.readHandoff(lead.id, current.name);
      if (!handoff && !args.without_handoff) {
        return { rotated: false, reason: `${current.name} 还没有写交接。`,
          next: `先 send_message 给 ${current.name}：“做完手上这一步就停，调用 capability_handoff 写交接（已完成/剩余/坑/未决/验证方法），然后只回复‘已交接’。” 收到后再调用 capability_rotate_member。成员无响应时可传 without_handoff=true，插件只用自己采集的事实交接。` };
      }
      const successor = successorName(current.name);
      const facts = handoff?.facts ?? { diffStat: await diffStat(team.pinned(lead) ?? '.'), openTasks: [], lastTest: metrics.get(current.id)?.lastTest ?? null };
      const w = handoff?.written ?? {};
      const prompt = [`你接替 ${current.name}（角色 ${baseName(current.name)}），使用全新上下文。先运行 git diff --stat 与项目测试核对现状，确认下面的交接与实际一致后再继续；不一致以实际代码为准，并在汇报里说明。`,
        args.task ? `原始任务：\n${String(args.task).slice(0, 4000)}` : null,
        w.goal ? `目标：${w.goal}` : null, w.done ? `已完成：\n${w.done}` : null, w.remaining ? `剩余：\n${w.remaining}` : null,
        w.pitfalls ? `踩过的坑：\n${w.pitfalls}` : null, w.open ? `未决问题：\n${w.open}` : null, w.verify ? `验证方法：\n${w.verify}` : null,
        facts.diffStat ? `插件采集的 git diff --stat：\n${facts.diffStat}` : null,
        facts.openTasks?.length ? `看板上未完成的任务：${facts.openTasks.map(t => `${t.id} ${t.subject}`).join('；')}` : null,
        facts.lastTest ? `上一棒最后一次测试：${facts.lastTest.command}（${facts.lastTest.isError ? '失败' : '完成'}）\n${facts.lastTest.summary}` : null,
        '完成后只用一次 send_message 向 lead 汇报最终结果。'].filter(Boolean).join('\n\n');
      planned.set(`${lead.id}:${successor}`, { from: current.name, prompt });
      retired.set(`${lead.id}:${current.name}`, successor);
      return { rotated: true, from: current.name, to: successor, handoff: handoff ? 'member' : 'facts-only',
        next: [`1. interrupt_agent target=${current.name}`, `2. spawn_teammate name=${successor} context=fresh，description 用原角色职责，prompt 用下面的 prompt 原文`,
          facts.openTasks?.length ? `3. 看板任务 ${facts.openTasks.map(t => t.id).join('、')} 会在 ${successor} 开工时由插件自动改派给它` : null].filter(Boolean).join('\n'), prompt };
    },
    register() {
      try { ctx.on('session/event', (session, event) => { if (session?.id && ctx.agentTeams.tryMembership?.(ctx.agents.get(session.id))?.role === 'teammate') foldEvent(counters(session.id), event); }); } catch { /* host without session observers */ }
      ctx.on('agent/created', ({ agent }) => {
        const identity = ctx.agentTeams.tryMembership(agent);
        if (identity?.role !== 'teammate') return;
        counters(agent.id);
        // Runtime context only says something once a threshold is crossed, so it does not churn the cache.
        agent.ctx.systemPrompt.context({ name: 'capability-team:rotation', order: 98, text: () => {
          const s = api.status(agent);
          if (s.level === 'ok') return '';
          return s.level === 'hard'
            ? `【会话轮换】本会话${s.reasons.join('、')}，已到轮换线。立即停止开始新的工作：做完正在进行的这一步，调用 capability_handoff 写交接，然后只回复 lead“已交接”。`
            : `【上下文提醒】本会话${s.reasons.join('、')}。继续完成当前任务，不需要交接：只读需要的行段（先 grep 定位再按 offset/limit 读），读过的内容不要重读，尽快开始修改${s.stalled ? '；目前还没有任何改动，先把调研结论落到代码上' : ''}。`;
        } });
      });
      ctx.effect(() => ctx.tools.guard(exec => api.guard(exec)));
      ctx.effect(() => ctx.tools.register({ name: 'capability_handoff', output,
        description: '队友在会话需要轮换时调用：把目标、已完成、剩余、踩过的坑、未决问题和验证方法写成交接。插件会自动附上 git diff --stat、你名下未完成的看板任务和最后一次测试结果。写完后只回复 lead“已交接”。',
        parameters: params({ goal: { type: 'string' }, done: { type: 'string' }, remaining: { type: 'string' }, pitfalls: { type: 'string' }, open: { type: 'string' }, verify: { type: 'string' } }, ['done', 'remaining']),
        async execute(args, exec) { const h = await api.writeHandoff(exec.agent, args); return JSON.stringify({ saved: true, member: h.member, facts: { diffStat: !!h.facts.diffStat, openTasks: h.facts.openTasks.length, lastTest: h.facts.lastTest?.command ?? null } }); },
      }));
      ctx.effect(() => ctx.tools.register({ name: 'capability_rotate_member', output,
        description: '主控把一个上下文过长的队友轮换到全新会话：读取它的交接，生成接替者名字（<角色>-r<N>）和接替者的首条消息，并返回要依次调用的 interrupt_agent / spawn_teammate / 看板操作。',
        parameters: params({ role: { type: 'string', description: '要轮换的队友名' }, task: { type: 'string', description: '原始任务原文（可选，建议附上）' }, without_handoff: { type: 'boolean', description: '成员无响应时为 true，只用插件采集的事实交接' } }, ['role']),
        async execute(args, exec) {
          if (ctx.agentTeams.tryMembership(exec.agent)?.role !== 'lead') throw new Error('只有主控可以轮换队友');
          return JSON.stringify(await api.rotate(exec.agent, args));
        },
      }));
    },
  };
  return api;
}
