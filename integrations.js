import { m as modelText } from './i18n.js';
import { executeFreeTask } from './task-bridge.js';
import { params } from './tool-schema.js';
const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
export function apply(ctx, team) {
  // CPA tools are supplied by the independent profile bundle; this plugin owns only the free-task bridge.
  ctx.effect(() => ctx.tools.register({
    name: 'capability_free_task',
    description: modelText('integrations.262'),
    parameters: params({ prompt: { type: 'string', description: modelText('integrations.263') }, subject: { type: 'string', description: modelText('integrations.264') } }, ['prompt']), output,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
      const { effective } = await team.load(exec.agent);
      return JSON.stringify(await executeFreeTask({ teams: ctx.agentTeams, native: team.native, agent: exec.agent, prompt: args.prompt, subject: args.subject, cwd, signal: exec.signal, tools: effective.workflow.freeTools, models: effective.workflow.freeModels }));
    },
  }));
}
