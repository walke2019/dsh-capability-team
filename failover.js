// Same-route retries, then ordered same-tier failover, with a per-route cooldown that doubles while a route keeps
// failing (a dead provider is not retried every minute) and resets once it has stayed quiet for a while.
// DSH's own provider retry policy (dsh-llm-retry) runs first; this layer only acts once it declines.
import { isCredential } from './route-health.js';
const key = r => `${r.provider}/${r.model}`;
export const MAX_COOLDOWN_MS = 30 * 60_000;
/** Cooldown for the n-th consecutive failure: base, 2×, 4×… capped at 30 minutes. */
export const escalatedCooldown = (baseMs, strikes) => Math.min(baseMs * 2 ** Math.max(0, strikes - 1), Math.max(baseMs, MAX_COOLDOWN_MS));
function wait(ms, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(true); }, ms);
    function stop() { clearTimeout(timer); resolve(false); }
    signal?.addEventListener('abort', stop, { once: true });
  });
}
export function createFailover({ now = Date.now, sleep = wait, registered = () => true, log = () => {}, telemetry = () => {} } = {}) {
  const observe = event => { try { telemetry(event); } catch { /* observability never changes recovery */ } };
  const cooling = new Map(); // route key → { until, failure, strikes, lastFailureAt }
  const steps = new WeakMap(); // agent → per-step state
  const healthy = route => (cooling.get(key(route))?.until ?? 0) <= now();
  const candidates = role => [{ provider: role.provider, model: role.model }, ...(role.fallbacks ?? [])];
  return {
    /** Route for this attempt: the step's current candidate, else the first healthy registered one. */
    route(agent, turn, step, role) {
      const list = candidates(role);
      const signature = `${list.map(key).join('|')}|${role.taskLeaseSignature ?? ''}`;
      let state = steps.get(agent);
      if (!state || state.turn !== turn || state.step !== step || state.signature !== signature) {
        const usable = list.map((r, i) => i).filter(i => registered(list[i].provider));
        const start = usable.find(i => healthy(list[i])) ?? usable[0] ?? 0;
        state = { turn, step, signature, index: start, retries: 0, tried: [], role };
        steps.set(agent, state);
      }
      state.role = role;
      return { ...list[state.index], primary: state.index === 0, index: state.index };
    },
    /** Decide recovery after DSH's own retries declined. Returns true to retry the step. */
    async recover(agent, failure, signal) {
      const state = steps.get(agent);
      if (!state || signal?.aborted) return false;
      const { failover: policy } = state.role;
      const list = candidates(state.role);
      const current = list[state.index];
      if (policy.retryCodes.includes(failure.code) && state.retries < policy.retries) {
        state.retries += 1;
        const backoff = Math.min(policy.initialDelayMs * 2 ** (state.retries - 1), policy.maxDelayMs);
        const hinted = failure.providerRetryAfterMs > 0 && failure.providerRetryAfterMs <= policy.maxDelayMs ? failure.providerRetryAfterMs : backoff;
        log(`同一模型 ${key(current)} 第${state.retries}/${policy.retries}次追加重试（${failure.code}），等待 ${hinted}ms`);
        const retry = await sleep(hinted, signal);
        if (retry) observe({ kind: 'retry', agent });
        return retry;
      }
      // Some adapters report the HTTP status only inside the message ("401 {...}"); read it from there too.
      const status = failure.status ?? Number(/^(\d{3})\b/.exec(String(failure.message ?? ''))?.[1] ?? NaN);
      const eligible = policy.failoverCodes.includes(failure.code) || policy.failoverStatuses.includes(status);
      state.tried.push({ route: key(current), code: failure.code, status: failure.status, message: String(failure.message).slice(0, 300) });
      if (!eligible) return false;
      // A failure soon after the last cooldown ended counts as the same outage; a long quiet spell starts over.
      const prior = cooling.get(key(current));
      const strikes = prior && now() - prior.until < 10 * policy.cooldownMs ? prior.strikes + 1 : 1;
      const until = now() + escalatedCooldown(policy.cooldownMs, strikes);
      cooling.set(key(current), { until, failure: failure.code, strikes, lastFailureAt: now(), credential: isCredential(failure.code, status) });
      observe({ kind: 'cooldown', agent, route: current, until, code: failure.code, status, strikes });
      const tried = new Set(state.tried.map(item => item.route));
      const next = list.findIndex(r => !tried.has(key(r)) && registered(r.provider) && healthy(r));
      if (next < 0) { log(`同档备选已用尽：${JSON.stringify(state.tried)}`); return false; }
      log(`${key(current)} 不可用（${failure.code}${failure.status ? '/' + failure.status : ''}），切换到同档备选 ${key(list[next])}`);
      observe({ kind: 'switch', agent, from: current, to: list[next], code: failure.code, status: failure.status });
      state.index = next; state.retries = 0;
      return true;
    },
    /** Model-facing status for the team context. */
    status(agent) {
      const state = steps.get(agent);
      if (!state) return undefined;
      const list = candidates(state.role);
      return { active: key(list[state.index]), primary: state.index === 0, failed: state.tried };
    },
    cooling: () => [...cooling].filter(([, v]) => v.until > now()).map(([route, v]) => ({ route, failure: v.failure, until: new Date(v.until).toISOString(), strikes: v.strikes })),
    /** Recent failure record per route (for ranking choices), including routes whose cooldown has ended. */
    health: () => Object.fromEntries([...cooling].map(([route, v]) => [route, { strikes: v.strikes, lastFailureAt: v.lastFailureAt, cooling: v.until > now(), credential: v.credential }])),
  };
}
