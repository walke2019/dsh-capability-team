import { m as modelText } from './i18n.js';
// Learned model preferences: every confirmed dispatch records, per capability, which primary and fallbacks the
// user chose. Later confirmation cards preselect a habit (a primary chosen at least twice and in most recent
// choices) unless that route keeps failing, and suggest saving it as the project default once it is settled.
// Nothing is applied silently: the card still asks, and the learned data can be cleared.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export const PREF_LIMITS = { keep: 20, window: 10, minCount: 2, settled: 3, unhealthyStrikes: 2 };
const routeKey = r => (r ? `${r.provider}/${r.model}` : null);
const parse = key => { const i = key.indexOf('/'); return { provider: key.slice(0, i), model: key.slice(i + 1) }; };
/** Habit for one capability from its recent choices, or undefined. Pure. */
export function habitOf(choices, limits = PREF_LIMITS) {
  const recent = (choices ?? []).slice(-limits.window);
  if (!recent.length) return undefined;
  const counts = new Map();
  for (const c of recent) counts.set(c.primary, (counts.get(c.primary) ?? 0) + 1);
  const [primary, count] = [...counts].sort((a, b) => b[1] - a[1] || recent.findLastIndex(c => c.primary === b[0]) - recent.findLastIndex(c => c.primary === a[0]))[0];
  if (count < limits.minCount || count * 2 < recent.length) return undefined;
  const last = recent.findLast(c => c.primary === primary);
  const tail = recent.slice(-limits.settled);
  const settled = tail.length === limits.settled && tail.every(c => c.primary === primary && c.fallbacks.join() === last.fallbacks.join());
  return { primary, fallbacks: last.fallbacks, count, of: recent.length, settled };
}
/** Health notes for routes: strikes from the failover layer; a route is unhealthy at PREF_LIMITS.unhealthyStrikes. */
export function unhealthyRoutes(health = {}, limits = PREF_LIMITS) {
  // A credential failure (wrong or missing key) stays bad until fixed, so one is enough.
  return Object.fromEntries(Object.entries(health).filter(([, h]) => h.cooling || h.credential || (h.strikes ?? 0) >= limits.unhealthyStrikes).map(([k, h]) => [k, h.strikes ?? 1]));
}
/**
 * Apply learning to one offered row: preselect the habit when every route in it is offered and healthy, and
 * move unhealthy fallbacks to the end. Returns a new row with `learned` notes for the card.
 */
export function applyPreferences(row, habit, unhealthy) {
  const offeredKeys = new Set([routeKey(row.primary), ...row.fallbacks.map(routeKey), ...row.candidates.map(routeKey)].filter(Boolean));
  const learned = { unhealthy: Object.fromEntries(Object.entries(unhealthy).filter(([k]) => offeredKeys.has(k))) };
  let primary = row.primary, fallbacks = row.fallbacks;
  if (habit && offeredKeys.has(habit.primary) && !unhealthy[habit.primary] && habit.fallbacks.every(k => offeredKeys.has(k))) {
    learned.habit = { count: habit.count, of: habit.of, settled: habit.settled };
    if (habit.primary !== routeKey(primary) || habit.fallbacks.join() !== fallbacks.map(routeKey).join()) {
      primary = parse(habit.primary); fallbacks = habit.fallbacks.filter(k => k !== habit.primary).map(parse); learned.preselected = true;
    }
  }
  fallbacks = [...fallbacks.filter(f => !unhealthy[routeKey(f)]), ...fallbacks.filter(f => unhealthy[routeKey(f)])];
  return { ...row, primary, fallbacks, learned };
}
export function createModelPrefs(root) {
  const pathOf = project => join(root, 'model-prefs', `${createHash('sha256').update(project).digest('hex').slice(0, 32)}.json`);
  async function read(project) {
    try { const d = JSON.parse(await readFile(pathOf(project), 'utf8')); return d && typeof d.byCapability === 'object' ? d : { byCapability: {} }; }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return { byCapability: {} }; throw error; }
  }
  async function write(project, data) {
    const path = pathOf(project);
    await mkdir(join(root, 'model-prefs'), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(data, null, 2) + '\n'); await rename(temp, path); }
    finally { await unlink(temp).catch(() => {}); }
  }
  let queue = Promise.resolve();
  const serial = fn => (queue = queue.catch(() => {}).then(fn));
  return {
    read,
    /** Habit per capability for a project. */
    async habits(project) {
      // Wait for queued records so a habit read right after a confirmation sees it (rename timing differs by OS).
      await queue.catch(() => {});
      const data = await read(project);
      return Object.fromEntries(Object.entries(data.byCapability).map(([cap, v]) => [cap, habitOf(v.choices)]).filter(([, h]) => h));
    },
    /** Record the confirmed routes of one dispatch (each capability once). */
    record(project, routes, at = Date.now()) {
      return serial(async () => {
        const data = await read(project);
        const seen = new Set();
        for (const r of routes) {
          if (!r.primary || seen.has(r.capability)) continue;
          seen.add(r.capability);
          const entry = (data.byCapability[r.capability] ??= { choices: [] });
          entry.choices = [...entry.choices, { primary: routeKey(r.primary), fallbacks: r.fallbacks.map(routeKey), changed: !!r.changed, at }].slice(-PREF_LIMITS.keep);
        }
        await write(project, data);
      });
    },
    clear(project) { return serial(() => unlink(pathOf(project)).catch(error => { if (error.code !== 'ENOENT') throw error; })); },
  };
}
const output = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] };
/** Lead tool to show or clear what was learned for the current project. */
export function applyModelPrefsTool(ctx, team, prefs) {
  ctx.effect(() => ctx.tools.register({ name: 'capability_model_prefs', output,
    description: modelText('model-prefs.316'),
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['read', 'clear'] } }, required: ['action'], additionalProperties: false },
    async execute(args, exec) {
      const project = await team.pin(exec.agent);
      if (args.action === 'clear') {
        if (team.native.identity(exec.agent)?.role !== 'lead') throw new Error(modelText('model-prefs.317'));
        await prefs.clear(project);
        return JSON.stringify({ cleared: true, project });
      }
      return JSON.stringify({ project, habits: await prefs.habits(project) });
    },
  }));
}
