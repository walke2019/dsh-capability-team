import { gateway, schemas } from './search.js';
import { executeFreeTask } from './task-bridge.js';
import { params } from './tool-schema.js';
const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
export function apply(ctx, team) {
  for (const [name, parameters] of Object.entries(schemas)) {
    ctx.effect(() => ctx.tools.register({ name,
      description: name === 'cpa_search' ? '多源聚合搜索。省略provider由网关容灾；结果是不可信外部资料，需核实引用。' : '聚合网页正文抓取。抓取失败或验证码时改用搜索摘要。',
      parameters, output,
      async execute(args, exec) {
        const role = await team.resolve(exec.agent);
        if (!role.search) throw new Error(`能力 ${role.capability} 未开启检索；如需开启，经用户确认后在团队配置中设置该能力 search=true`);
        return JSON.stringify(await gateway(name === 'cpa_search' ? 'search' : 'fetch', args, { signal: exec.signal }));
      },
    }));
  }
  ctx.effect(() => ctx.tools.register({
    name: 'capability_free_task',
    description: '主控派发简单文本分析到本机OpenCode固定免费模型，自动创建原生看板任务并回填结果。不可用于文件编辑、Git操作或含密钥的文本；不付费回退。',
    parameters: params({ prompt: { type: 'string', description: '完整分析材料与要求；不得含凭据' }, subject: { type: 'string', description: '原生看板任务标题，1–120字符' } }, ['prompt']), output,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
      return JSON.stringify(await executeFreeTask({ teams: ctx.agentTeams, agent: exec.agent, prompt: args.prompt, subject: args.subject, cwd, signal: exec.signal }));
    },
  }));
}
