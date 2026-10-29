import { apply as applyRoles } from './roles.js';
import { apply as applyIntegrations } from './integrations.js';
import { apply as applyTheme } from './theme-plugin.js';
import { createTeam } from './team.js';
import { createFailover } from './failover.js';
export const inject = ['agents', 'agentTeams', 'systemPrompt', 'tools', 'workingDirectory', 'skills', 'llm', 'userQuestions'];
export function apply(ctx, config = {}) {
  const team = createTeam(ctx, config); // Validates preset bindings up front.
  void team.refresh(); // First catalog match in the background; requests await it if still pending.
  const failover = createFailover({
    // A provider missing from DSH throws before the stream starts, which no hook can recover.
    registered: provider => ctx.llm.listProviders().some(p => p.id === provider),
    log: message => ctx.logger?.info?.(`capability-team: ${message}`),
  });
  applyRoles(ctx, team, failover);
  applyIntegrations(ctx, team);
  applyTheme(ctx, team, failover);
}
