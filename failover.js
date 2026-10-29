// Same-route retries, then ordered same-tier failover, with a short per-route cooldown.
// DSH's own provider retry policy (dsh-llm-retry) runs first; this layer only acts once it declines.
const key = r => `${r.provider}/${r.model}`;
function wait(ms, signal) {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(true); }, ms);
    function stop() { clearTimeout(timer); resolve(false); }
    signal?.addEventListener('abort', stop, { once: true });
  });
}
export function createFailover({ now = Date.now, sleep = wait, registered = () => true, log = () => {} } = {}) {
  const cooling = new Map(); // route key → { until, failure }
  const steps = new WeakMap(); // agent → per-step state
  const healthy = route => (cooling.get(key(route))?.until ?? 0) <= now();
  const candidates = role => [{ provider: role.provider, model: role.model }, ...(role.fallbacks ?? [])];
  return {
    /** Route for this attempt: the step's current candidate, else the first healthy registered one. */
    route(agent, turn, step, role) {
      const list = candidates(role);
      let state = steps.get(agent);
      if (!state || state.turn !== turn || state.step !== step || state.signature !== list.map(key).join('|')) {
        const usable = list.map((r, i) => i).filter(i => registered(list[i].provider));
        const start = usable.find(i => healthy(list[i])) ?? usable[0] ?? 0;
        state = { turn, step, signature: list.map(key).join('|'), index: start, retries: 0, tried: [], role };
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
        return sleep(hinted, signal);
      }
      const eligible = policy.failoverCodes.includes(failure.code) || policy.failoverStatuses.includes(failure.status);
      state.tried.push({ route: key(current), code: failure.code, status: failure.status, message: String(failure.message).slice(0, 300) });
      if (!eligible) return false;
      cooling.set(key(current), { until: now() + policy.cooldownMs, failure: failure.code });
      const next = list.findIndex((r, i) => i > state.index && registered(r.provider) && healthy(r));
      if (next < 0) { log(`同档备选已用尽：${JSON.stringify(state.tried)}`); return false; }
      log(`${key(current)} 不可用（${failure.code}${failure.status ? '/' + failure.status : ''}），切换到同档备选 ${key(list[next])}`);
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
    cooling: () => [...cooling].filter(([, v]) => v.until > now()).map(([route, v]) => ({ route, failure: v.failure, until: new Date(v.until).toISOString() })),
  };
}
