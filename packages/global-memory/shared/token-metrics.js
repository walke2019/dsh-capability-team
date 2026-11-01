// Numeric telemetry only; never injected into prompts. Provider billing rates are optional.
export function usageSample(projections, session) {
  try {
    const state = projections?.stateOf(session, 'tokenUsage');
    const value = state?.totals ?? state;
    return value ? { ...value, inputTokens: value.inputTokens ?? value.uncachedInputTokens } : null;
  } catch { return null; }
}
const n = x => Number.isFinite(x) && x >= 0 ? x : 0;
export function estimateCost(usage, rates) {
  if (!rates) return null;
  return (n(usage.inputTokens) * n(rates.input) + n(usage.cacheReadTokens) * n(rates.cacheRead)
    + n(usage.cacheWriteTokens) * n(rates.cacheWrite) + n(usage.outputTokens) * n(rates.output)) / 1e6;
}
export function createTokenMetrics({ now = Date.now, ratesOf = () => null } = {}) {
  const sessions = new WeakMap();
  const state = agent => { if (!sessions.has(agent)) sessions.set(agent, { steps: [], trimmedChars: 0, estimatedSavedTokens: 0, compactions: 0, compactionMs: 0 }); return sessions.get(agent); };
  return {
    sample(agent, turn, step, usage, route) {
      if (!usage) return;
      const row = { turn, step, at: now(), prompt: n(usage.inputTokens) + n(usage.cacheReadTokens) + n(usage.cacheWriteTokens),
        cacheRead: n(usage.cacheReadTokens), cacheWrite: n(usage.cacheWriteTokens), output: n(usage.outputTokens),
        estimatedCost: estimateCost(usage, ratesOf(route)), source: 'sessionProjections.tokenUsage' };
      const s = state(agent), old = s.steps.findIndex(x => x.turn === turn && x.step === step);
      const totals = { prompt: row.prompt, cacheRead: row.cacheRead, cacheWrite: row.cacheWrite, output: row.output };
      const baseline = old >= 0 ? s.steps[old].baseline : (s.lastTotals ?? { prompt: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
      for (const key of Object.keys(totals)) row[key] = Math.max(0, totals[key] - baseline[key]);
      row.baseline = baseline; s.lastTotals = totals;
      row.estimatedCost = estimateCost({ inputTokens: Math.max(0, row.prompt - row.cacheRead - row.cacheWrite), cacheReadTokens: row.cacheRead, cacheWriteTokens: row.cacheWrite, outputTokens: row.output }, ratesOf(route));
      if (old >= 0) s.steps[old] = row; else s.steps.push(row);
      s.steps = s.steps.slice(-1000);
    },
    trim(agent, before, after) { const s = state(agent), saved = Math.max(0, before - after); s.trimmedChars += saved; s.estimatedSavedTokens += Math.ceil(saved / 4); },
    compact(agent, duration) { const s = state(agent); s.compactions++; s.compactionMs += n(duration); },
    snapshot(agent) { return structuredClone(state(agent)); },
  };
}
