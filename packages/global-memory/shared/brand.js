// Single source of truth for the AIWUK brand and the extension package names.
// Pure data, no imports: build-shared.mjs copies this file into packages/*/shared/.
export const BRAND = Object.freeze({ id: 'aiwuk', en: 'AIWUK', zh: 'AI悟空', domain: 'aiwuk.com', scope: '@aiwuk' });
// Same value as MOTHERSHIP in the mothership protocol package (packages/protocol/src/brand.ts).
export const MOTHERSHIP = Object.freeze({ en: 'AIWUK Mothership', zh: 'AI悟空 母舰' });

const ext = (pkg, en, zh, description) => Object.freeze({ pkg, en, zh, description: Object.freeze(description) });

export const EXTENSIONS = Object.freeze({
  team: ext('@aiwuk/team', 'AIWUK Team', 'AI悟空 协作团队', {
    en: 'Capability-routed multi-agent team for DeepSeek Harness: per-role model routing, same-tier failover and conversational team configuration.',
    zh: '为 DeepSeek Harness 提供按能力路由的多智能体团队：按角色分配模型、同档容灾、对话式配置团队。',
  }),
  autocomplete: ext('@aiwuk/autocomplete', 'AIWUK Autocomplete', 'AI悟空 输入补全', {
    en: 'Composer autocomplete: inline continuation while you pause and next-message suggestions, accepted with Tab, never sent automatically.',
    zh: '输入框自动补全：打字停顿时行内续写、回复后建议下一句，按 Tab 采纳，绝不自动发送。',
  }),
  memory: ext('@aiwuk/memory', 'AIWUK Memory', 'AI悟空 全局记忆', {
    en: 'Profile-wide explicit memory tools and bounded automatic recall for all sessions.',
    zh: '面向所有会话的显式记忆工具与有界自动召回。',
  }),
  search: ext('@aiwuk/search', 'AIWUK Search', 'AI悟空 全能搜索', {
    en: 'Multi-engine web search, page fetch and user-approved audio transcription for all sessions.',
    zh: '面向所有会话的多引擎网页搜索、网页正文读取与授权音频转写。',
  }),
  connector: ext('@aiwuk/connector', 'AIWUK Connector', 'AI悟空 母舰接入器', {
    en: 'Connects this DSH instance to an AIWUK Mothership hub for fleet management and managed configuration.',
    zh: '将本 DSH 实例接入 AI悟空 母舰，用于集群管理与托管配置。',
  }),
});

// Old package name -> new package name. Rollback reinstalls the old package from its original source.
export const RENAME_MAP = Object.freeze({
  'dsh-capability-team': '@aiwuk/team',
  'dsh-capability-autocomplete': '@aiwuk/autocomplete',
  'dsh-capability-memory': '@aiwuk/memory',
  'dsh-omni-search': '@aiwuk/search',
  '@dsh-mothership/connector': '@aiwuk/connector',
  '@dsh-mothership/connector-bundle': '@aiwuk/connector-bundle',
  '@dsh-mothership/connector-updater': '@aiwuk/connector-updater',
});
