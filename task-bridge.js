import { runFreeWorker } from './free-worker.mjs';
// A dedicated task avoids overwriting a user's existing task or declaring unrelated work done.
export async function executeFreeTask({ teams, agent, prompt, subject = '免费模型任务', cwd, signal, tools = 'none', models, worker = runFreeWorker }) {
  const membership = teams.membership(agent);
  if (membership.role !== 'lead') throw new Error('仅主控可派发免费模型任务');
  // Validate before creating persistent task state.
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) throw new Error('任务必须为 1–16000 字符');
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 120) throw new Error('任务标题须为1–120字符');
  let task = await teams.createTask(agent, { subject, description: `OpenCode 免费模型（工具：${tools}）；等待执行`, blockedBy: [], writeScopes: [] });
  const update = async (action, fields = {}) => {
    const current = teams.getTask(agent, task.id);
    if (current.revision !== task.revision) throw new Error(`任务 ${task.id} 已被其他成员修改，停止自动回填以保护其修改`);
    task = await teams.updateTask(agent, { taskId: task.id, expectedRevision: task.revision, action, ...fields });
    return task;
  };
  await update('claim');
  let result;
  try {
    result = await worker(prompt, { cwd, signal, tools, models });
  } catch (error) {
    // Native tasks have no failed state. Retain the concrete failure and release to pending.
    await update('edit', { description: `执行失败（未完成）：${String(error.message || error).slice(0, 4000)}` });
    await update('release');
    throw error;
  }
  const changed = [...new Set((result.toolCalls ?? []).filter(c => ['write', 'edit'].includes(c.tool) && c.status === 'completed').map(c => c.file).filter(Boolean))];
  // Record result first; persistence/CAS failure must never be reported as completion.
  await update('edit', { description: `执行模型：${result.model}\n${changed.length ? `改动文件：${changed.join('、')}\n` : ''}结果：\n${result.text.slice(0, 24000)}` });
  await update('complete');
  return { taskId: task.id, status: task.status, ...result, changedFiles: changed };
}
