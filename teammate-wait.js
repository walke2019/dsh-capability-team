// Teammates never block in wait_agent. DSH's wait_agent only observes changes after the call starts, so a Lead
// message that lands while the teammate's model request is in flight is missed and the teammate idles until the
// timeout. Ending the turn instead is lossless: send_message starts or resumes an inactive teammate.
import { ownsCapabilityTeam } from './preset-guard.js';
import { restrictiveToolName } from './tool-names.js';
export const TEAMMATE_WAIT_DENIAL = '队友不要调用 wait_agent 等待：直接结束本轮并简短说明在等什么。主控或其他成员发来消息时，DSH 会自动唤醒你继续工作，不会漏掉消息。';
/** Pure decision: a denial for a teammate's wait_agent call, otherwise undefined. */
export function teammateWaitDenial(exec, membership) {
  if (membership?.role !== 'teammate') return undefined;
  return restrictiveToolName(exec?.name, new Set(['wait_agent'])) === 'wait_agent' ? TEAMMATE_WAIT_DENIAL : undefined;
}
export function applyTeammateWait(ctx) {
  ctx.effect(() => ctx.tools.guard(exec => {
    if (!ownsCapabilityTeam(ctx, exec.agent)) return undefined;
    return teammateWaitDenial(exec, ctx.agentTeams.tryMembership(exec.agent));
  }));
}
