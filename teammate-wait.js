import { m as modelText } from './i18n.js';
// Teammates never block in wait_agent. DSH's wait_agent only observes changes after the call starts, so a Lead
// message that lands while the teammate's model request is in flight is missed and the teammate idles until the
// timeout. Ending the turn instead is lossless: send_message starts or resumes an inactive teammate.
import { restrictiveToolName } from './tool-names.js';
export const TEAMMATE_WAIT_DENIAL = modelText('teammate-wait.498');
/** Pure decision: a denial for a teammate's wait_agent call, otherwise undefined. */
export function teammateWaitDenial(exec, membership) {
  if (membership?.role !== 'teammate') return undefined;
  return restrictiveToolName(exec?.name, new Set(['wait_agent'])) === 'wait_agent' ? TEAMMATE_WAIT_DENIAL : undefined;
}
export function applyTeammateWait(ctx, native) {
  ctx.effect(() => ctx.tools.guard(exec => {
    if (native.kind() !== 'rc1') return undefined; // rc2 wait consumes native input and permits descendant callers.
    return teammateWaitDenial(exec, native.identity(exec.agent));
  }));
}
