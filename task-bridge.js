import { t, m as modelText } from './i18n.js';
import { runFreeWorker } from './free-worker.mjs';
// A dedicated task avoids overwriting a user's existing task or declaring unrelated work done.
export async function executeFreeTask({ teams, agent, prompt, subject = t('task-bridge.485'), cwd, signal, tools = 'none', models, worker = runFreeWorker }) {
  const membership = teams.membership(agent);
  if (membership.role !== 'lead') throw new Error(modelText('task-bridge.486'));
  // Validate before creating persistent task state.
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) throw new Error(modelText('task-bridge.487'));
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 120) throw new Error(modelText('task-bridge.488'));
  let task = await teams.createTask(agent, { subject, description: t('task-bridge.489', { 0: tools }), blockedBy: [], writeScopes: [] });
  const update = async (action, fields = {}) => {
    const current = teams.getTask(agent, task.id);
    if (current.revision !== task.revision) throw new Error(modelText('task-bridge.490', { 0: task.id }));
    task = await teams.updateTask(agent, { taskId: task.id, expectedRevision: task.revision, action, ...fields });
    return task;
  };
  await update('claim');
  let result;
  try {
    result = await worker(prompt, { cwd, signal, tools, models });
  } catch (error) {
    // Native tasks have no failed state. Retain the concrete failure and release to pending.
    await update('edit', { description: t('task-bridge.491', { 0: String(error.message || error).slice(0, 4000) }) });
    await update('release');
    throw error;
  }
  const changed = [...new Set((result.toolCalls ?? []).filter(c => ['write', 'edit'].includes(c.tool) && c.status === 'completed').map(c => c.file).filter(Boolean))];
  // Record result first; persistence/CAS failure must never be reported as completion.
  await update('edit', { description: t('task-bridge.492', { 0: result.model, 1: changed.length ? t('task-bridge.493', { 0: changed.join('、') }) : '', 2: result.text.slice(0, 24000) }) });
  await update('complete');
  return { taskId: task.id, status: task.status, ...result, changedFiles: changed };
}
