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
import { createRotation } from './session-rotation.js';
import { createMemoryHub } from './memory-hub.js';
import { setPluginIntegrations } from './integrations-config.js';
export const inject = ['agents', 'agentTeams', 'systemPrompt', 'tools', 'workingDirectory', 'skills', 'llm', 'userQuestions'];
export function apply(ctx, config = {}) {
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
  const workflow = createWorkflow(ctx, team, { onDelegate: (lead, roles) => planGate.reset(lead, roles), onAssignments: (lead, assignments) => taskControl.dispatch(lead, assignments), dispatchConfirm: createDispatchConfirm(ctx, team), rotation });
  taskControl.setWorkflow(workflow);
  taskControl.register();
  workflow.register();
  planGate.register();
  rotation.register();
  memory.register();
  applyAccess(ctx, team);
  applyRoles(ctx, team, failover, observability, taskControl);
  applyIntegrations(ctx, team);
  applyTheme(ctx, team, failover, workflow, planGate, taskControl);
}
