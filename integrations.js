import { executeFreeTask } from './task-bridge.js';
import { params } from './tool-schema.js';
const output = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] };
export function apply(ctx, team) {
  // CPA tools are supplied by the independent profile bundle; this plugin owns only the free-task bridge.
  ctx.effect(() => ctx.tools.register({
    name: 'capability_free_task',
    description: '主控把工作交给本机 OpenCode 的免费模型（内置 build 代理），自动创建原生看板任务并回填结果。工具级别由项目 workflow.freeTools 决定：none 只处理 prompt 中的文字；read 可读取搜索项目文件；write 还可新建和编辑项目文件。任何级别都不能执行命令、联网、访问项目外路径或读写密钥文件。内容会发送到免费模型云端，不得含凭据或敏感数据。按顺序尝试免费模型，全部不可用即报错，不付费回退。',
    parameters: params({ prompt: { type: 'string', description: '完整材料与要求；不得含凭据' }, subject: { type: 'string', description: '原生看板任务标题，1–120字符' } }, ['prompt']), output,
    async execute(args, exec) {
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
      const { effective } = await team.load(exec.agent);
      return JSON.stringify(await executeFreeTask({ teams: ctx.agentTeams, agent: exec.agent, prompt: args.prompt, subject: args.subject, cwd, signal: exec.signal, tools: effective.workflow.freeTools, models: effective.workflow.freeModels }));
    },
  }));
}
