import { apply as applyRoles } from './roles.js';
import { apply as applyIntegrations } from './integrations.js';
import { apply as applyTheme } from './theme-plugin.js';
import { createTeam } from './team.js';
import { createFailover } from './failover.js';
import { createWorkflow } from './workflow.js';
import { applyAccess } from './access.js';
import { createPlanGate } from './plan-gate.js';
import { createRuntimeObservability } from './runtime-observability.js';
import { createTaskControl } from './member-task-control.js';
import { createTaskAudit } from './task-control-audit.js';
import { createDispatchConfirm } from './dispatch-confirm.js';
import { applyModelPrefsTool, createModelPrefs } from './model-prefs.js';
import { createBoardDispatch } from './board-dispatch.js';
import { baseName } from './session-rotation.js';
import { applySkillCatalog, scopeTools } from './teammate-context.js';
import { createTokenDiscipline } from './token-discipline.js';
import { createRotation } from './session-rotation.js';
import { createMemoryHub } from './memory-hub.js';
import { setPluginIntegrations } from './integrations-config.js';
export const inject = ['agents', 'agentTeams', 'systemPrompt', 'tools', 'workingDirectory', 'skills', 'llm', 'userQuestions'];
export function apply(host, config = {}) {
  // Lead-only and teammate-only plugin tools are installed per agent, so teammates do not carry the lead's tool schemas.
  const { ctx } = scopeTools(host);
  const team = createTeam(ctx, config); // Validates preset bindings up front.
  // Endpoints/models for search and embeddings may come from the plugin config; the Overview file and env override it.
  setPluginIntegrations(config.integrations);
  void team.refresh(); // First catalog match in the background; requests await it if still pending.
  const observability = createRuntimeObservability();
  const failover = createFailover({
    telemetry: event => observability.telemetry(event),
    // A provider missing from DSH throws before the stream starts, which no hook can recover.
    registered: provider => ctx.llm.listProviders().some(p => p.id === provider),
    log: message => ctx.logger?.info?.(`capability-team: ${message}`),
  });
  const taskControl = createTaskControl(ctx, team, { audit: createTaskAudit(team.root), onChanged: () => observability.notifyTaskControl() });
  const planGate = createPlanGate(ctx, team);
  const memory = createMemoryHub(ctx, team);
  const rotation = createRotation(ctx, team, { onHandoff: handoff => memory.ingestHandoff(handoff) });
  const board = createBoardDispatch(ctx, team);
  const prefs = createModelPrefs(team.root);
  const workflow = createWorkflow(ctx, team, { onDelegate: (lead, roles) => planGate.reset(lead, roles), onAssignments: (lead, assignments) => taskControl.dispatch(lead, assignments), dispatchConfirm: createDispatchConfirm(ctx, team, { prefs, health: () => failover.health() }), rotation, board });
  taskControl.setWorkflow(workflow);
  taskControl.register();
  workflow.register();
  planGate.register();
  rotation.register();
  memory.register();
  applyBoard(ctx, team, board, rotation);
  applyModelPrefsTool(ctx, team, prefs);
  createTokenDiscipline(host, team).register();
  applySkillCatalog(host, agent => {
    const project = team.pinned(agent);
    const m = host.agentTeams.tryMembership(agent);
    if (!project || !m?.name) return undefined;
    const { effective } = team.loadSync(project, agent);
    return effective.capabilities[effective.roles[baseName(m.name)]?.capability]?.skills;
  });
  applyAccess(ctx, team);
  applyRoles(ctx, team, failover, observability, taskControl);
  applyIntegrations(ctx, team);
  applyTheme(ctx, team, failover, workflow, planGate, taskControl);
}
/**
 * Board integration hooks. A teammate becomes an active member once it claims its first message; then its ready
 * tasks are handed to it (and a rotation successor takes over its predecessor's open tasks). Its runtime context
 * lists its board tasks, and edits outside the scopes of the tasks it holds are refused when configured.
 */
function applyBoard(ctx, team, board, rotation) {
  ctx.on('agent/inbox/claimed', ({ agent }) => {
    const m = ctx.agentTeams.tryMembership(agent);
    if (m?.role !== 'teammate' || !m.root) return;
    const from = rotation.predecessorOf(m.root.id, m.name);
    void (async () => { if (from) await board.transfer(m.root, from, m.name); await board.handOut(m.root, baseName(m.name), m.name); })().catch(() => {});
  });
  ctx.on('agent/created', ({ agent }) => {
    if (ctx.agentTeams.tryMembership(agent)?.role !== 'teammate') return;
    agent.ctx.systemPrompt.context({ name: 'capability-team:board', order: 96, text: () => board.context(agent) });
  });
  ctx.effect(() => ctx.tools.guard(exec => {
    const project = team.pinned(exec.agent);
    if (!project) return undefined;
    let enforce;
    try { enforce = team.loadSync(project, exec.agent).effective.workflow.enforceWriteScopes !== false; } catch { return undefined; }
    return board.guard(exec, { enforce });
  }));
}
