import { t } from './i18n.js';

const same = (a, b) => a?.provider === b?.provider && a?.model === b?.model;
const queued = agent => (agent.inbox?.nextStep?.length ?? 0) + (agent.inbox?.nextTurn?.length ?? 0) > 0;
/** Resume only after the failed driver exits; retry cannot change a prepared step's selection. */
export function createContinuation(ctx, team, failover, { createMessage } = {}) {
  const pending = new Map();
  let disposed = false;
  const clear = agent => pending.delete(agent);
  ctx.effect?.(() => () => { disposed = true; pending.clear(); });
  ctx.on('agent/disposed', ({ agent }) => { clear(agent); failover.reset?.(agent); });
  const watched = new WeakSet();
  const currentSignal = new WeakMap();
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next();
    if (!team.owns(agent)) return decision;
    // Only the native user producer denotes a new owner task; peer and recovery notices do not.
    if (decision?.kind === 'enter' && decision.messages.some(message => message.source?.kind === 'user')) {
      clear(agent);
      failover.reset?.(agent);
    }
    if (signal) currentSignal.set(agent, signal);
    if (signal && !watched.has(signal)) {
      watched.add(signal);
      const abort = () => { if (currentSignal.get(agent) === signal) { clear(agent); failover.reset?.(agent); } };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    return decision;
  });
  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return;
    const item = pending.get(agent);
    if (!item) return;
    clear(agent);
    if (disposed || item.signal?.aborted || !team.owns(agent) || agent.status !== 'idle' || queued(agent)
      || !same(agent.model.current(), item.route)) return;
    try {
      // Synchronous wake preserves the task lease across this transient idle boundary.
      failover.continue?.(agent);
      agent.steer(item.message);
    } catch (error) {
      ctx.logger?.warn?.(`capability-team: failover continuation failed: ${String(error?.message ?? error)}`);
    }
  });
  return {
    async arm(agent, route, signal) {
      if (disposed || signal?.aborted || typeof agent.steer !== 'function' || queued(agent)) return false;
      try {
        const factory = createMessage ?? (await import('@deepseek-ai/dsh-llm')).createUserMessage;
        if (disposed || signal?.aborted || queued(agent)) return false;
        const text = t('failover.continue');
        const message = factory({ content: [{ type: 'text', text }], source: { kind: 'capability-team-failover', form: 'notice', summary: text } });
        pending.set(agent, { route, signal, message });
        return true;
      } catch (error) {
        ctx.logger?.warn?.(`capability-team: failover continuation unavailable: ${String(error?.message ?? error)}`);
        return false;
      }
    },
  };
}
