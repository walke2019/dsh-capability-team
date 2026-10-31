// Ephemeral routing telemetry: no prompt/error text and no persisted session events.
import { randomUUID } from 'node:crypto';
import { safeId, safeTime } from './activity-summary.js';
import { taskControlSnapshot } from './member-task-control.js';
const routeOf = r => r && typeof r.provider === 'string' && r.provider.length <= 128 && typeof r.model === 'string' && r.model.length <= 512 ? { provider: r.provider, model: r.model } : null;
const same = (a, b) => a && b && a.provider === b.provider && a.model === b.model;
const codeOf = c => safeId(c, 80);
const statusOf = s => Number.isInteger(s) && s >= 100 && s <= 599 ? s : null;
export function createRuntimeObservability({ now = Date.now, epoch = randomUUID() } = {}) {
  const since = safeTime(now()) ?? 0;
  const members = new Map(), listeners = new Set(), sharedCooling = new Map(); let revision = 0;
  const changed = () => { revision += 1; for (const listener of listeners) { try { listener(); } catch { /* observation must not affect routing */ } } };
  const get = agent => {
    const id = safeId(agent?.id); if (!id) return null;
    if (!members.has(id)) {
      if (members.size >= 256) members.delete(members.keys().next().value);
      members.set(id, { sessionId: id, candidates: [], cooling: [], switches: [], counters: { requestFailures: 0, pluginRetries: 0, failoverSwitches: 0, longContextSwitches: 0 }, attempt: 0, turn: null, step: null, active: null, lc: false, truncated: false });
    }
    return members.get(id);
  };
  const record = (m, from, to, reason, detail = {}) => {
    if (!from || !to || same(from, to)) return;
    const at = safeTime(now()) ?? 0;
    m.switches.unshift({ id: `${epoch}:${revision + 1}:${m.sessionId}`, at, turn: m.turn, step: m.step, attempt: m.attempt, from, to, reason, code: codeOf(detail.code), status: statusOf(detail.status) });
    if (m.switches.length > 16) { m.switches.length = 16; m.truncated = true; }
    if (reason === 'failover' || reason === 'long-context') m.counters[reason === 'failover' ? 'failoverSwitches' : 'longContextSwitches'] += 1;
  };
  return {
    epoch,
    notifyTaskControl() { changed(); },
    onChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    request(agent, { turn, step, role, routed, selected }) {
      const m = get(agent); if (!m) return;
      const newStep = m.turn !== turn || m.step !== step;
      m.attempt = !newStep ? m.attempt + 1 : 1;
      m.turn = Number.isSafeInteger(turn) ? turn : null; m.step = Number.isSafeInteger(step) ? step : null;
      m.candidates = [role, ...(role?.fallbacks ?? []), ...(role?.longContext ? [role.longContext] : [])].map(routeOf).filter(Boolean).slice(0, 32);
      const active = routeOf(selected), lc = !!routed.longContextActive;
      if (m.active && m.override !== (routed.taskLeaseSignature ?? null)) record(m, m.active, active, routed.taskLeaseSignature ? 'override' : 'override-expired');
      m.override = routed.taskLeaseSignature ?? null;
      if (m.active && !routed.taskLeaseSignature && lc !== m.lc) record(m, m.active, routeOf(routed), 'long-context');
      const primary = routeOf(routed);
      if (primary && active && !same(primary, active)) {
        // recover already recorded a switch in this attempt; a new step skipping a cooled route has not.
        if (m.active && newStep && (!m.pendingSwitch || !same(m.pendingSwitch, active))) record(m, primary, active, 'failover', [...sharedCooling.values()].find(c => same(c.route, primary)));
      }
      m.pendingSwitch = null; m.active = active; m.lc = lc; changed();
    },
    failure(agent, failure) { const m = get(agent); if (!m) return; m.counters.requestFailures += 1; changed(); },
    telemetry(event) {
      const m = get(event.agent); if (!m) return;
      if (event.kind === 'retry') m.counters.pluginRetries += 1;
      if (event.kind === 'cooldown') {
        const route = routeOf(event.route); if (!route) return;
        const cooldown = { route, code: codeOf(event.code), status: statusOf(event.status), until: safeTime(event.until), attempt: m.attempt };
        // Shared cooldown is filtered by each member's confirmed candidates at snapshot time.
        sharedCooling.set(JSON.stringify(route), cooldown);
        if (sharedCooling.size > 256) sharedCooling.delete(sharedCooling.keys().next().value);
      }
      if (event.kind === 'switch') { const to = routeOf(event.to); record(m, routeOf(event.from), to, 'failover', event); m.pendingSwitch = to; }
      changed();
    },
    snapshot(leadSessionId, roster) {
      const result = [];
      for (const member of roster.slice(0, 64)) {
        const m = members.get(member.id);
        const candidates = m?.candidates ?? [];
        const cooling = [...sharedCooling.values()].filter(c => c.until > now() && candidates.some(r => same(c.route, r)));
        result.push({ sessionId: member.id, cooling: cooling.slice(0, 16).map(c => ({ ...c, route: { ...c.route } })), switches: (m?.switches ?? []).map(s => ({ ...s, from: { ...s.from }, to: { ...s.to } })), counters: { ...(m?.counters ?? { requestFailures: 0, pluginRetries: 0, failoverSwitches: 0, longContextSwitches: 0 }) }, truncated: !!m?.truncated || cooling.length > 16 });
      }
      return { schemaVersion: 1, leadSessionId, epoch, revision, generatedAt: safeTime(now()) ?? 0, coverage: { mode: 'runtime', since }, members: result, taskControl: taskControlSnapshot(leadSessionId) };
    },
  };
}
// Kept outside session checkpoints. Bound to the exact live Agent identity.
const runtimeBindings = new WeakMap();
export function bindRuntime(agent, runtime, teams) { runtimeBindings.set(agent, { runtime, teams }); }
export function runtimeBinding(agent) { return runtimeBindings.get(agent); }
