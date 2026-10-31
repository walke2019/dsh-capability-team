// Dispatch on DSH's shared task board, the way the official team works: every assignment becomes board tasks
// (subject, description, write scopes, dependencies), ready tasks are reassigned to their member as soon as it
// exists, members follow list → get → claim → work → complete, and a rotation successor inherits the open
// tasks of the member it replaces. Write scopes are advisory in DSH; here they can be enforced for edits.
import { isAbsolute, relative, resolve } from 'node:path';
import { baseName } from './session-rotation.js';
const MAX_TASKS = 12;
const text = (v, max, label) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new Error(`${label}须为1–${max}字符`);
  return v.trim();
};
/** Workspace-relative scope like DSH's: no leading slash, no "." or ".." segments. */
export function normalizeScope(value) {
  const s = String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!s || s.startsWith('/') || /^[a-z]:/i.test(s) || s.split('/').some(seg => !seg || seg === '.' || seg === '..')) throw new Error(`写入范围 ${JSON.stringify(value)} 须为项目内相对路径`);
  return s;
}
/** A path is inside a scope when it is the scope or below it (same rule as DSH's overlap check). */
export const inScope = (rel, scope) => rel === scope || rel.startsWith(scope + '/');
/** Models sometimes send nested arrays as JSON text; accept that form. */
export const arrayArg = value => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
};
/**
 * Normalize the optional `tasks` of each assignment. Each task may name a `key`; `blocked_by` lists keys of tasks
 * that appear earlier in the plan, so the board graph is built in order and can never form a cycle.
 * Assignments without tasks get one task from their `task` text.
 */
export function planTasks(assignments, rawTasksByRole) {
  const keys = new Set(); const out = [];
  for (const a of assignments) {
    const raw = arrayArg(rawTasksByRole[a.role]);
    const list = raw === undefined ? [{ subject: a.task.split('\n')[0].slice(0, 120), description: a.task }] : raw;
    if (!Array.isArray(list) || !list.length || list.length > MAX_TASKS) throw new Error(`角色 ${a.role} 的 tasks 须为 1–${MAX_TASKS} 项的数组`);
    for (const [i, t] of list.entries()) {
      const label = `角色 ${a.role} 的第${i + 1}个子任务`;
      const key = t.key === undefined ? `${a.role}#${i + 1}` : text(String(t.key), 64, `${label}的 key`);
      if (keys.has(key)) throw new Error(`子任务 key ${key} 重复`);
      const blockedBy = (arrayArg(t.blocked_by ?? t.blockedBy) ?? []).map(String);
      if (!Array.isArray(blockedBy)) throw new Error(`${label}的 blocked_by 须为数组`);
      for (const b of blockedBy) if (!keys.has(b)) throw new Error(`${label}依赖的 ${b} 必须是前面已列出的子任务 key`);
      const scopes = arrayArg(t.write_scopes ?? t.writeScopes) ?? [];
      if (!Array.isArray(scopes) || scopes.length > 20) throw new Error(`${label}的 write_scopes 须为不超过20项的数组`);
      keys.add(key);
      out.push({ key, role: a.role, displayName: a.displayName, subject: text(t.subject, 200, `${label}的标题`),
        description: text(t.description ?? a.task, 16000, `${label}的说明`), writeScopes: [...new Set(scopes.map(normalizeScope))], blockedBy });
    }
  }
  return out;
}
export function createBoardDispatch(ctx, team) {
  const leads = new Map(); // lead id → Map(task id → { role, key })
  const teams = () => ctx.agentTeams;
  const boardOf = lead => { if (!leads.has(lead.id)) leads.set(lead.id, new Map()); return leads.get(lead.id); };
  const listTasks = lead => { try { return teams().listTasks?.(lead) ?? []; } catch { return []; } };
  /** Reassign ready, unowned tasks planned for `role` to member `name` (Lead authority). Returns how many failed. */
  async function handOutOnce(lead, role, name) {
    const planned = boardOf(lead); let failed = 0;
    for (const task of listTasks(lead)) {
      const entry = planned.get(task.id);
      if (!entry || entry.role !== role || task.status !== 'pending' || task.ownerName || !task.ready) continue;
      try { await teams().updateTask(lead, { taskId: task.id, expectedRevision: task.revision, action: 'reassign', owner: name }); } catch { failed++; }
    }
    return failed;
  }
  /**
   * Hand out with a few retries: a member that just claimed its first message may still be provisioning, and
   * DSH only reassigns to active members. If it never succeeds, the member can still claim the task itself.
   */
  async function handOut(lead, role, name, { attempts = 4, delayMs = 1500, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    for (let i = 0; i < attempts; i++) {
      if (!(await handOutOnce(lead, role, name))) return true;
      if (i < attempts - 1) await sleep(delayMs);
    }
    return false;
  }
  const api = {
    /** Create the plan's tasks on the board and hand ready ones to members that already exist. */
    async create(lead, plan, rawTasksByRole = {}) {
      if (typeof teams()?.createTask !== 'function') return null;
      const tasks = planTasks(plan.assignments, rawTasksByRole);
      const ids = new Map(); const byRole = {};
      for (const t of tasks) {
        const view = await teams().createTask(lead, { subject: t.subject, description: `${t.description}\n\n指派给：${t.displayName ?? t.role}（${t.role}）`,
          blockedBy: t.blockedBy.map(k => ids.get(k)), writeScopes: t.writeScopes });
        ids.set(t.key, view.id);
        boardOf(lead).set(view.id, { role: t.role, key: t.key });
        (byRole[t.role] ??= []).push({ id: view.id, subject: t.subject, writeScopes: t.writeScopes, blockedBy: t.blockedBy.map(k => ids.get(k)) });
      }
      const members = (() => { try { return teams().listMembers(lead); } catch { return []; } })();
      for (const role of Object.keys(byRole)) {
        const live = members.filter(m => m.role !== 'lead' && baseName(m.name) === role).sort((a, b) => b.name.length - a.name.length || b.name.localeCompare(a.name))[0];
        // Existing members are already active, so one attempt is enough and dispatch is not delayed.
        if (live) await handOut(lead, role, live.name, { attempts: 1 });
      }
      return byRole;
    },
    handOut,
    /** Open tasks currently owned by a member, newest board state. */
    owned(lead, name) { return listTasks(lead).filter(t => t.ownerName === name && t.status === 'in_progress'); },
    /** Tasks planned for a role that are still open (pending or in progress). */
    plannedFor(lead, role) { const planned = boardOf(lead); return listTasks(lead).filter(t => planned.get(t.id)?.role === role && t.status !== 'completed'); },
    /** Move every open task of `from` to `to` (rotation). */
    async transfer(lead, from, to) {
      for (const task of listTasks(lead)) {
        if (task.ownerName !== from || (task.status !== 'in_progress' && task.status !== 'pending')) continue;
        try { await teams().updateTask(lead, { taskId: task.id, expectedRevision: task.revision, action: 'reassign', owner: to }); } catch { /* the lead can still reassign by hand */ }
      }
    },
    /** Deny an edit outside the write scopes of the tasks a teammate holds (when any of them declares scopes). */
    guard(exec, limits = { enforce: true }) {
      if (!limits.enforce || !['write', 'edit', 'str_replace_editor'].includes(exec.name) || (exec.name === 'str_replace_editor' && exec.arguments?.command === 'view')) return undefined;
      const m = teams()?.tryMembership?.(exec.agent);
      if (m?.role !== 'teammate' || !m.root) return undefined;
      const held = api.owned(m.root, m.name);
      const scopes = held.flatMap(t => t.writeScopes ?? []);
      if (!held.length || !scopes.length) return undefined;
      const project = team.pinned(exec.agent);
      const raw = exec.arguments?.[exec.name === 'str_replace_editor' ? 'path' : 'file_path'];
      if (!project || typeof raw !== 'string') return undefined;
      const rel = relative(project, resolve(ctx.workingDirectory?.get?.(exec.agent.session) ?? project, raw)).split('\\').join('/');
      if (!rel || rel.startsWith('../') || isAbsolute(rel)) return undefined;
      if (scopes.some(s => inScope(rel, s))) return undefined;
      return `${rel} 不在你认领的看板任务（${held.map(t => t.id).join('、')}）的写入范围内：${[...new Set(scopes)].join('、')}。需要改这个文件时，先 send_message 请 lead 调整任务范围或另建任务。`;
    },
    /** Runtime context for a teammate: its board tasks and the DSH board workflow. Empty when it has none. */
    context(agent) {
      const m = teams()?.tryMembership?.(agent);
      if (m?.role !== 'teammate' || !m.root) return '';
      const mine = listTasks(m.root).filter(t => t.status !== 'completed' && (t.ownerName === m.name || (!t.ownerName && boardOf(m.root).get(t.id)?.role === baseName(m.name))));
      if (!mine.length) return '';
      const line = t => `${t.id}「${t.subject}」${t.ownerName === m.name ? '（已分给你，进行中）' : t.ready ? '（待认领）' : `（等待 ${t.blockedBy.join('、')}）`}${t.writeScopes?.length ? ` 写入范围：${t.writeScopes.join('、')}` : ''}`;
      return `【看板任务】${mine.map(line).join('；')}。按 DSH 看板流程：team_task_get 读最新版本 → 待认领的用 team_task_update claim → 执行 → complete；只改写入范围内的文件，做完一项再认领下一项。`;
    },
  };
  return api;
}
