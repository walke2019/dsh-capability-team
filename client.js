// Web cards for the capability-team tools. Rendered in the keyed `tool.call.toolview` slot, so the
// conversation keeps owning call pairing, lifecycle and placement; this module only formats the
// structured results. Plain JS without a build step: React comes from the host module table, and no
// other Harness Client package is required (host tokens are the only shared styling dependency).
window.__ModuleLoader__.load({
  id: '@local/dsh-capability-team',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'capability-team';

    const zh = {
      'nav.models': '模型管理', 'nav.roles': '角色与配置', 'nav.logs': '请求日志',
      'models.preview': '已保存策略下的请求候选（非实际调用）', 'models.blocked': '已阻止：无允许模型', 'models.unassigned': '尚未分配', 'models.refreshPreview': '策略已保存，请刷新状态获取新的候选预览。',
      'evidence.title': '本会话模型日志', 'evidence.hint': '只展示本会话非继承日志。请求配置不等于调用成功，响应记录也不等于任务完成。',
      'evidence.request-header': '已记录请求配置', 'evidence.assistant-message': '已记录助手响应', 'evidence.empty': '暂无可核实记录',
      'models.help': '关闭开关即禁用该模型，也可以按前缀批量排除。设置是全局的：保存后对所有能力协作团队会话（含新建会话）从下一次请求起生效，已发出的请求不受影响；目录存在不代表调用成功。',
      'models.enabled': '启用', 'models.disabledBadge': '已禁用', 'models.tierCount': '{n} 个 · 已禁用 {d}', 'models.dirty': '{n} 项更改未保存', 'models.reset': '撤销更改',
      'models.filter': '筛选模型或角色…', 'models.noMatch': '没有匹配的模型', 'models.orphans': '目录外的已禁用模型', 'models.unused': '暂未被角色使用',
      'evidence.short.request-header': '请求', 'evidence.short.assistant-message': '响应', 'logs.thisSession': '本会话', 'logs.count': '{n} 条', 'logs.interrupted': '已中断',
      'roles.fallbackList': '备选：{list}',
      'workflow.mode': '执行模式', 'workflow.mode.enforce': '强制', 'workflow.mode.remind': '仅提醒', 'workflow.mode.off': '关闭', 'workflow.analysisBudget': '指派前只读分析', 'workflow.directBudget': '主控自行处理上限',
      'workflow.freeTools': '免费模型工具', 'workflow.freeModels': '免费模型顺序', 'workflow.analysisTools': '分析类工具', 'workflow.coordinationTools': '协调类工具', 'workflow.allFree': '目录中全部免费模型', 'workflow.times': '{n} 次',
      'models.primary': '主用', 'models.fallback': '备用', 'models.save': '全局保存', 'models.saving': '正在保存…', 'models.saved': '已全局保存；所有会话的下一次请求按新规则检查。',
      'tier.high': '旗舰档', 'tier.upper': '高阶档', 'tier.medium': '中阶档', 'tier.low': '轻量档', 'tier.unknown': '未分类',
      'state.running': '正在执行',
      'state.failed': '执行失败',
      'state.stopped': '已中止',
      'action.inspect': '查看调用',
      'plan.title': '派活计划',
      'plan.analysis': '需求分析',
      'plan.reason': '理由',
      'plan.assignments': '指派',
      'plan.next': '下一步',
      'plan.budget': '本轮自行执行上限 {n} 次',
      'mode.delegate': '指派队友',
      'mode.free': '免费模型',
      'mode.direct': '主控处理',
      'free.title': '免费模型任务',
      'free.prompt': '交付内容',
      'free.result': '结果',
      'free.model': '模型',
      'free.tools': '工具',
      'free.task': '看板任务',
      'free.calls': '工具调用 {n} 次',
      'free.changed': '改动文件',
      'free.changedCount': '改动 {n} 个文件',
      'free.skipped': '不可用而跳过的模型',
      'tools.none': '仅文字',
      'tools.read': '只读文件',
      'tools.write': '读写文件',
      'team.readTitle': '团队配置',
      'team.saveTitle': '保存团队配置',
      'team.summary': '{name} · 版本 {rev} · {n} 个角色',
      'team.saved': '已保存 · 版本 {rev}',
      'team.roles': '角色',
      'team.unassigned': '未分配（请求将被阻止）',
      'overview.title': '团队总览', 'overview.hint': '读取本会话真实状态，不启动模型、不修改配置。', 'overview.empty': '尚未读取团队配置。',
      'overview.ready': '已就绪', 'overview.notMounted': '未挂载', 'overview.abnormal': '需处理', 'overview.preset': '预设', 'overview.missingTools': '缺少工具', 'overview.details': '挂载诊断',
      'overview.revision': '版本 {rev}', 'overview.updated': '更新于 {time}', 'overview.statRoles': '角色', 'overview.firstLoad': '读取团队配置', 'overview.logNote': '实时状态由宿主推送，不写入对话；点“刷新”读取配置时，对话里会留下一条命令记录。', 'overview.statWorking': '工作中',
      'live.title': '团队工作台', 'live.runningCount': '{n} 个正在工作', 'live.polling': '实时推送', 'live.running': '工作中', 'live.idle': '空闲', 'live.inactive': '未启动', 'live.provisioning': '启动中', 'live.failed': '异常',
      'live.noTask': '暂无任务', 'live.busyNoTask': '正在处理消息…', 'live.liveModel': '运行时模型（宿主上报）', 'live.configModel': '配置的主用模型（尚未启动）',
      'models.prefixTitle': '按前缀排除', 'models.prefixPlaceholder': '输入前缀，如 @cf/、cpa/or/、grok-imagine', 'models.prefixAdd': '排除',
      'models.prefixPreview': '{rule} 将排除 {n} 个模型：{list}', 'models.prefixInvalid': '前缀至少 2 个字符，不能含空格或中间的 *', 'models.prefixExists': '这条规则已存在',
      'models.prefixHelp': '前缀同时匹配“渠道/模型”和单独的模型 ID；规则会持续生效，以后新增的同前缀模型也会被排除。保存后生效。',
      'models.ruleCount': '{n} 个', 'models.ruleRemove': '移除规则 {rule}', 'models.byRule': '规则 {rule}',
      'models.tiers': '模型档位', 'models.allTiers': '全部', 'models.more': '显示更多（还有 {n} 个）', 'overview.statModels': '模型', 'overview.statDisabled': '已禁用', 'overview.statBlocked': '受阻角色',
      'overview.refresh': '刷新', 'overview.loading': '正在读取…',
      'overview.policy': '工作流配置', 'overview.noData': '当前会话未提供团队配置。请检查挂载状态；旧会话不会自动切换预设。',
      'team.fallbacks': '同档备选 {n} 个',
      'team.cooling': '冷却中的模型',
      'team.project': '项目',
      'output': '原始输出',
    };
    const en = {
      'nav.models': 'Models', 'nav.roles': 'Roles & settings', 'nav.logs': 'Request records',
      'models.preview': 'Candidates under saved policy (not actual calls)', 'models.blocked': 'Blocked: no allowed model', 'models.unassigned': 'Unassigned', 'models.refreshPreview': 'Policy saved. Refresh to load updated candidates.',
      'evidence.title': 'Session model records', 'evidence.hint': 'Only non-inherited session records. A request header does not prove success; an assistant response does not prove task completion.',
      'evidence.request-header': 'Recorded request configuration', 'evidence.assistant-message': 'Recorded assistant response', 'evidence.empty': 'No verifiable records',
      'models.help': 'Switch a model off to disable it, or exclude by prefix. Settings are global: saving applies to every capability-team session (including new ones) from its next request; in-flight requests are unaffected. Catalog presence does not verify a call.',
      'models.enabled': 'Enable', 'models.disabledBadge': 'Disabled', 'models.tierCount': '{n} · {d} disabled', 'models.dirty': '{n} unsaved changes', 'models.reset': 'Discard',
      'models.filter': 'Filter models or roles…', 'models.noMatch': 'No matching models', 'models.orphans': 'Disabled models outside the catalog', 'models.unused': 'Not used by any role',
      'evidence.short.request-header': 'Request', 'evidence.short.assistant-message': 'Response', 'logs.thisSession': 'This session', 'logs.count': '{n} records', 'logs.interrupted': 'Interrupted',
      'roles.fallbackList': 'Fallbacks: {list}',
      'workflow.mode': 'Mode', 'workflow.mode.enforce': 'Enforce', 'workflow.mode.remind': 'Remind only', 'workflow.mode.off': 'Off', 'workflow.analysisBudget': 'Read-only steps before dispatch', 'workflow.directBudget': 'Lead direct-action limit',
      'workflow.freeTools': 'Free-model tools', 'workflow.freeModels': 'Free-model order', 'workflow.analysisTools': 'Analysis tools', 'workflow.coordinationTools': 'Coordination tools', 'workflow.allFree': 'All free models in catalog', 'workflow.times': '{n}',
      'models.primary': 'Primary', 'models.fallback': 'Fallback', 'models.save': 'Save globally', 'models.saving': 'Saving…', 'models.saved': 'Saved globally; every session uses it from its next request.',
      'tier.high': 'Flagship', 'tier.upper': 'Advanced', 'tier.medium': 'Balanced', 'tier.low': 'Lightweight', 'tier.unknown': 'Unclassified',
      'state.running': 'Running',
      'state.failed': 'Failed',
      'state.stopped': 'Stopped',
      'action.inspect': 'Inspect',
      'plan.title': 'Dispatch plan',
      'plan.analysis': 'Analysis',
      'plan.reason': 'Reason',
      'plan.assignments': 'Assignments',
      'plan.next': 'Next step',
      'plan.budget': 'Up to {n} direct actions this turn',
      'mode.delegate': 'Delegate',
      'mode.free': 'Free model',
      'mode.direct': 'Lead handles',
      'free.title': 'Free-model task',
      'free.prompt': 'Handed over',
      'free.result': 'Result',
      'free.model': 'Model',
      'free.tools': 'Tools',
      'free.task': 'Board task',
      'free.calls': '{n} tool calls',
      'free.changed': 'Changed files',
      'free.changedCount': '{n} files changed',
      'free.skipped': 'Skipped (unavailable)',
      'tools.none': 'Text only',
      'tools.read': 'Read files',
      'tools.write': 'Read & write files',
      'team.readTitle': 'Team configuration',
      'team.saveTitle': 'Save team configuration',
      'team.summary': '{name} · revision {rev} · {n} roles',
      'team.saved': 'Saved · revision {rev}',
      'team.roles': 'Roles',
      'team.unassigned': 'Unassigned (request blocked)',
      'overview.title': 'Team overview', 'overview.hint': 'Read this session’s state without model calls or configuration changes.', 'overview.empty': 'Team configuration not loaded yet.',
      'overview.ready': 'Ready', 'overview.notMounted': 'Not mounted', 'overview.abnormal': 'Needs attention', 'overview.preset': 'Preset', 'overview.missingTools': 'Missing tools', 'overview.details': 'Activation details',
      'overview.revision': 'revision {rev}', 'overview.updated': 'updated {time}', 'overview.statRoles': 'Roles', 'overview.firstLoad': 'Load team configuration', 'overview.logNote': 'Live status is pushed by the host and is not logged; Refresh runs a command that leaves one entry in the conversation.', 'overview.statWorking': 'Working',
      'live.title': 'Team board', 'live.runningCount': '{n} working', 'live.polling': 'Live push', 'live.running': 'Working', 'live.idle': 'Idle', 'live.inactive': 'Not started', 'live.provisioning': 'Starting', 'live.failed': 'Failed',
      'live.noTask': 'No task', 'live.busyNoTask': 'Handling a message…', 'live.liveModel': 'Runtime model (reported by host)', 'live.configModel': 'Configured primary (not started)',
      'models.prefixTitle': 'Exclude by prefix', 'models.prefixPlaceholder': 'Prefix, e.g. @cf/, cpa/or/, grok-imagine', 'models.prefixAdd': 'Exclude',
      'models.prefixPreview': '{rule} excludes {n} models: {list}', 'models.prefixInvalid': 'At least 2 characters, no spaces or inner *', 'models.prefixExists': 'Rule already exists',
      'models.prefixHelp': 'A prefix matches both "provider/model" and the bare model id; rules persist and also exclude models added later. Takes effect after saving.',
      'models.ruleCount': '{n}', 'models.ruleRemove': 'Remove rule {rule}', 'models.byRule': 'Rule {rule}',
      'models.tiers': 'Model tiers', 'models.allTiers': 'All', 'models.more': 'Show more ({n} left)', 'overview.statModels': 'Models', 'overview.statDisabled': 'Disabled', 'overview.statBlocked': 'Blocked roles',
      'overview.refresh': 'Refresh', 'overview.loading': 'Loading…',
      'overview.policy': 'Workflow configuration', 'overview.noData': 'No team snapshot for this session. Check activation; existing sessions do not switch presets automatically.',
      'team.fallbacks': '{n} same-tier fallbacks',
      'team.cooling': 'Cooling down',
      'team.project': 'Project',
      'output': 'Raw output',
    };

    const CSS = `
.ctm-card{display:flex;flex-direction:column}
.ctm-row{position:relative;display:flex;align-items:center;min-width:0;height:calc(24px + var(--dsh-content-font-delta,0px));overflow:hidden;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));transition:color .1s}
.ctm-row:hover,.ctm-row[data-open]{color:var(--dsw-alias-label-secondary)}
.ctm-row[data-expandable]{cursor:pointer}
.ctm-row:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:-1px;border-radius:4px}
.ctm-lead{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:calc(16px + var(--dsh-content-font-delta,0px));height:calc(16px + var(--dsh-content-font-delta,0px));margin-right:6px}
.ctm-lead svg{width:calc(14px + var(--dsh-content-font-delta,0px));height:calc(14px + var(--dsh-content-font-delta,0px))}
.ctm-ico{display:inline-flex;transition:opacity .1s}
.ctm-chev{position:absolute;inset:0;display:inline-flex;align-items:center;justify-content:center;opacity:0;transition:opacity .1s}
.ctm-row[data-expandable]:hover .ctm-ico,.ctm-row[data-open] .ctm-ico{opacity:0}
.ctm-row[data-expandable]:hover .ctm-chev,.ctm-row[data-open] .ctm-chev{opacity:1}
.ctm-title{flex:none;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px))}
.ctm-sep{flex:none;width:2px;height:2px;margin:0 8px;border-radius:1px;background:var(--dsw-alias-label-caption,currentColor)}
.ctm-summary{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px))}
.ctm-badge{flex:none;margin-left:8px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ctm-badge[data-tone=brand]{color:var(--dsw-alias-brand-primary);border-color:currentColor}
.ctm-badge[data-tone=success]{color:var(--dsw-alias-state-success-primary);border-color:currentColor}
.ctm-badge[data-tone=warn]{color:var(--dsw-alias-state-warn-primary);border-color:currentColor}
.ctm-error{color:var(--dsw-alias-state-error-primary)}
.ctm-warn{color:var(--dsw-alias-state-warn-primary)}
.ctm-card[data-state=running] .ctm-summary,.ctm-card[data-state=preparing] .ctm-title{animation:ctm-pulse 1.4s ease-in-out infinite}
@keyframes ctm-pulse{50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.ctm-card .ctm-summary,.ctm-card .ctm-title{animation:none!important}}
.ctm-wrap{display:flex;flex-direction:column}
.ctm-body{display:flex;flex-direction:column;margin:4px 0 4px 4px;overflow:hidden;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px)}
.ctm-section{display:flex;flex-direction:column;gap:6px;padding:8px 12px;min-width:0}
.ctm-section+.ctm-section{border-top:.5px solid var(--dsw-alias-border-l2)}
.ctm-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.ctm-text{white-space:pre-wrap;word-break:break-word;line-height:1.6}
.ctm-pre{margin:0;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:inherit;line-height:1.6}
.ctm-pre[data-short]{max-height:120px}
.ctm-grid{display:grid;grid-template-columns:max-content minmax(0,1fr);column-gap:16px;row-gap:8px;align-items:baseline}
.ctm-grid3{display:grid;grid-template-columns:max-content max-content minmax(0,1fr);column-gap:16px;row-gap:6px;align-items:baseline}
.ctm-who{display:flex;flex-direction:column;min-width:0}
.ctm-name{font-weight:500}
.ctm-sub{font-size:12px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.ctm-chips{display:flex;flex-wrap:wrap;gap:6px}
.ctm-chip{display:inline-flex;gap:4px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:20px}
.ctm-chip>span:first-child{color:var(--dsw-alias-label-secondary)}
.ctm-list{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.ctm-link{padding:0;border:none;background:none;color:var(--dsw-alias-brand-primary);font:inherit;text-align:left;word-break:break-all;cursor:pointer}
.ctm-link:hover{text-decoration:underline}
.ctm-inspect{align-self:flex-start;margin:0 0 4px 4px;padding:2px 4px;border:none;border-radius:4px;background:none;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}
.ctm-inspect:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.ctm-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ctm-badge[data-tone=error]{color:var(--dsw-alias-state-error-primary);border-color:currentColor}
.ctm-success{color:var(--dsw-alias-state-success-primary)}
.ctm-btn{flex:none;padding:3px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:background .12s,color .12s,border-color .12s}
.ctm-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.ctm-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.ctm-btn:disabled{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);cursor:default}
.ctm-btn[data-primary]{border-color:var(--dsw-alias-button-primary-fill);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);font-weight:500}
.ctm-btn[data-primary]:hover:not(:disabled){border-color:var(--dsw-alias-button-primary-hover);background:var(--dsw-alias-button-primary-hover)}
.ctm-btn[data-primary]:active:not(:disabled){opacity:.85}
.ctm-btn[data-primary]:disabled{border-color:transparent;background:var(--dsw-alias-button-primary-dimmed);color:var(--dsw-alias-label-tertiary)}
.ctm-btn:focus-visible,.ctm-ov-tab:focus-visible,.ctm-switch:focus-visible,.ctm-ov-group>summary:focus-visible{outline:1px solid var(--ctm-accent);outline-offset:1px}
.ctm-card,.ctm-ov{--ctm-accent:var(--dsw-alias-state-business-primary,var(--dsw-alias-link,#4d6bfe))}
.ctm-ov .ctm-badge[data-tone=brand]{color:var(--ctm-accent)}
.ctm-ov{background:var(--dsw-alias-bg-base);display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size-secondary,13px)}
.ctm-ov-head{flex:none;display:flex;flex-direction:column;gap:2px;padding:12px 16px 10px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.ctm-ov-titlerow{display:flex;align-items:center;gap:8px;min-width:0}
.ctm-ov-title{margin:0;font-size:15px;font-weight:600;line-height:24px}
.ctm-ov-titlerow .ctm-badge{margin-left:0}
.ctm-ov-refresh{margin-left:auto}
.ctm-ov-scroll{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:12px;padding:12px 16px 24px}
.ctm-ov-scroll>*,.ctm-ov-panel>*,.ctm-ov-editor>*{flex-shrink:0}
.ctm-ov-empty{padding:24px 0;text-align:center}
.ctm-ov-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(54px,1fr));gap:6px}
.ctm-ov-stat{display:flex;flex-direction:column;gap:2px;min-width:0;padding:7px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.ctm-ov-stat strong{font-size:18px;font-weight:600;line-height:22px}
.ctm-ov-stat span{font-size:12px;color:var(--dsw-alias-label-secondary)}
.ctm-ov-stat[data-tone=warn] strong{color:var(--dsw-alias-state-warn-primary)}
.ctm-ov-stat[data-tone=error] strong{color:var(--dsw-alias-state-error-primary)}
.ctm-ov-callout{display:flex;flex-direction:column;gap:8px;margin:0;padding:10px 12px;border-radius:8px;border:.5px solid currentColor;line-height:1.6;word-break:break-word}
.ctm-ov-callout[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}
.ctm-ov-callout[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.ctm-ov-callout .ctm-text{color:var(--dsw-alias-label-primary)}
.ctm-ov-tabs{position:sticky;top:-12px;z-index:2;display:flex;gap:2px;padding:3px;margin:0 -2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.ctm-ov-tab{flex:1 1 0;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:0;padding:4px 8px;border:none;border-radius:6px;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
.ctm-ov-tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.ctm-ov-tab[aria-pressed=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:500;box-shadow:0 0 0 .5px var(--dsw-alias-border-l1)}
.ctm-ov-count{padding:0 5px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.ctm-ov-panel{display:flex;flex-direction:column;gap:12px;min-width:0}
.ctm-ov-panel[hidden]{display:none}
.ctm-ov-block{display:flex;flex-direction:column;gap:6px;min-width:0}
.ctm-ov-help{margin:0;line-height:1.5}
.ctm-ov-note{font-size:12px}
.ctm-ov-editor{display:flex;flex-direction:column;gap:12px;min-width:0}
.ctm-ov-toolbar{position:sticky;top:26px;z-index:1;display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:6px 0;background:var(--dsw-alias-bg-base)}
.ctm-ov-search{box-sizing:border-box;width:100%;padding:5px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.ctm-ov-search:focus{outline:1px solid var(--ctm-accent);outline-offset:-1px}
.ctm-ov-allocs{display:flex;flex-direction:column;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.ctm-ov-alloc{display:grid;grid-template-columns:minmax(56px,max-content) minmax(0,1fr);column-gap:10px;padding:6px 10px;align-items:baseline}
.ctm-ov-alloc+.ctm-ov-alloc{border-top:.5px solid var(--dsw-alias-border-l2)}
.ctm-ov-chain{display:flex;align-items:center;flex-wrap:wrap;gap:4px;min-width:0}
.ctm-ov-hop{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 7px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px;line-height:17px;color:var(--dsw-alias-label-secondary)}
.ctm-ov-hop[data-primary]{border-color:var(--ctm-accent);background:none;color:var(--ctm-accent)}
.ctm-ov-arrow{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:13px;line-height:1}
.ctm-ov-tiers{display:flex;flex-wrap:wrap;gap:6px}
.ctm-ov-tier{position:relative;flex:none;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
.ctm-ov-tier:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.ctm-ov-more{align-self:center}
.ctm-ov-tier[aria-selected=true]{border-color:var(--ctm-accent);color:var(--ctm-accent);font-weight:500}
.ctm-ov-tier[aria-selected=true] .ctm-ov-count{background:var(--ctm-accent);color:#fff}
.ctm-ov-tier:focus-visible{outline:1px solid var(--ctm-accent);outline-offset:1px}
.ctm-ov-offdot{position:absolute;top:1px;right:1px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary)}
.ctm-ov-list-flat{border-top:none}
.ctm-ov-rule-input{display:flex;gap:6px}
.ctm-ov-rule-input .ctm-ov-search{flex:1 1 auto;min-width:0;font-family:var(--dsw-font-mono,ui-monospace,monospace)}
.ctm-ov-rule{align-items:center;font-family:var(--dsw-font-mono,ui-monospace,monospace);border:.5px solid var(--dsw-alias-state-warn-primary)}
.ctm-ov-rule-x{margin-left:2px;padding:0 4px;border:none;border-radius:4px;background:none;color:var(--dsw-alias-label-secondary);font:inherit;line-height:18px;cursor:pointer}
.ctm-ov-rule-x:hover:not(:disabled){color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover)}
.ctm-ov-panel{container-type:inline-size}
.ctm-ov-split{display:flex;flex-direction:column;gap:16px;min-width:0}
.ctm-ov-split>*{flex-shrink:0;min-width:0}
@container (min-width:640px){.ctm-ov-split{display:grid;grid-template-columns:minmax(240px,2fr) minmax(0,3fr);align-items:start}.ctm-bd{position:sticky;top:30px}}
.ctm-bd{display:flex;flex-direction:column;gap:8px;min-width:0}
.ctm-bd-head{display:flex;align-items:center;gap:8px}
.ctm-bd-head .ctm-badge{margin-left:0}
.ctm-bd-at{margin-left:auto;display:inline-flex;align-items:center;gap:5px}
.ctm-bd-pulse{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);animation:ctm-beat 2.5s ease-out infinite}
@keyframes ctm-beat{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,transparent)}70%,100%{box-shadow:0 0 0 6px transparent}}
.ctm-bd-canvas{position:relative;display:flex;flex-direction:column;gap:18px;padding:14px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background-color:var(--dsw-alias-bg-layer-2);background-image:radial-gradient(color-mix(in srgb,var(--dsw-alias-label-secondary) 28%,transparent) 1px,transparent 1.2px);background-size:14px 14px}
.ctm-bd-lead{position:relative;display:flex;justify-content:center}
.ctm-bd-lead>.ctm-bd-card{width:min(100%,280px)}
.ctm-bd-mates{position:relative;display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:18px 8px;padding-top:2px}
.ctm-bd-lead+.ctm-bd-mates::before{content:'';position:absolute;left:50%;top:-18px;width:1.5px;height:10px;background:var(--dsw-alias-border-l1)}
.ctm-bd-mates>.ctm-bd-card::before{content:'';position:absolute;left:50%;top:-10px;width:1.5px;height:10px;background:var(--dsw-alias-border-l1)}
.ctm-bd-lead+.ctm-bd-mates::after{content:'';position:absolute;left:12%;right:12%;top:-8px;height:1.5px;background:var(--dsw-alias-border-l1)}
.ctm-bd-lead+.ctm-bd-mates[data-flow]::after,.ctm-bd-mates>.ctm-bd-card[data-status=running]::before{background:repeating-linear-gradient(90deg,var(--ctm-accent) 0 5px,transparent 5px 9px);background-size:18px 100%;animation:ctm-flow .9s linear infinite}
.ctm-bd-mates>.ctm-bd-card[data-status=running]::before{background:repeating-linear-gradient(180deg,var(--ctm-accent) 0 4px,transparent 4px 7px);background-size:100% 14px;animation:ctm-flow-v .7s linear infinite}
@keyframes ctm-flow{to{background-position:18px 0}}
@keyframes ctm-flow-v{to{background-position:0 14px}}
.ctm-bd-card{position:relative;display:flex;flex-direction:column;gap:6px;min-width:0;padding:9px 10px 11px;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.05);transition:border-color .2s,box-shadow .2s,opacity .2s}
.ctm-bd-card[data-status=inactive]{opacity:.62;border-style:dashed}
.ctm-bd-card[data-status=failed]{border-color:var(--dsw-alias-state-error-primary)}
.ctm-bd-card[data-status=running]{border-color:var(--ctm-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--ctm-accent) 14%,transparent),0 4px 14px color-mix(in srgb,var(--ctm-accent) 18%,transparent);animation:ctm-glow 2.4s ease-in-out infinite}
@keyframes ctm-glow{50%{box-shadow:0 0 0 5px color-mix(in srgb,var(--ctm-accent) 8%,transparent),0 4px 18px color-mix(in srgb,var(--ctm-accent) 26%,transparent)}}
.ctm-bd-top{display:flex;align-items:center;gap:8px;min-width:0}
.ctm-bd-top .ctm-who{flex:1 1 0;min-width:0}
.ctm-bd-top .ctm-name,.ctm-bd-top .ctm-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ctm-bd-avatar{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600;font-size:13px}
.ctm-bd-card[data-status=running] .ctm-bd-avatar{background:var(--ctm-accent);color:#fff}
.ctm-bd-card[data-status=running] .ctm-bd-avatar::after{content:'';position:absolute;inset:-4px;border-radius:50%;border:1.5px solid transparent;border-top-color:var(--ctm-accent);border-right-color:var(--ctm-accent);animation:ctm-spin 1.1s linear infinite}
@keyframes ctm-spin{to{transform:rotate(360deg)}}
.ctm-bd-state{flex:none;display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ctm-bd-state[data-tone=brand]{color:var(--ctm-accent)}
.ctm-bd-state[data-tone=success]{color:var(--dsw-alias-state-success-primary)}
.ctm-bd-state[data-tone=error]{color:var(--dsw-alias-state-error-primary)}
.ctm-bd-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.ctm-bd-card[data-status=running] .ctm-bd-dot,.ctm-bd-card[data-status=provisioning] .ctm-bd-dot{animation:ctm-pulse 1s ease-in-out infinite}
.ctm-bd-time{font-variant-numeric:tabular-nums;opacity:.8}
.ctm-bd-task{display:flex;align-items:baseline;gap:5px;min-width:0;font-size:12px;line-height:1.45}
.ctm-bd-subject{min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.ctm-bd-model{display:flex;min-width:0}
.ctm-bd-task>.ctm-sub{flex:none}
.ctm-bd-mates .ctm-bd-top{flex-wrap:wrap;row-gap:4px}
.ctm-bd-mates .ctm-bd-state{order:3;flex-basis:100%;padding-left:36px;box-sizing:border-box}
.ctm-bd-bar{position:absolute;left:10px;right:10px;bottom:4px;height:2px;border-radius:2px;overflow:hidden;opacity:0}
.ctm-bd-card[data-status=running] .ctm-bd-bar,.ctm-bd-card[data-status=provisioning] .ctm-bd-bar{opacity:1;background:linear-gradient(90deg,transparent,var(--ctm-accent),transparent) 0 0/40% 100% no-repeat,color-mix(in srgb,var(--ctm-accent) 12%,transparent);animation:ctm-scan 1.4s ease-in-out infinite}
@keyframes ctm-scan{0%{background-position:-40% 0,0 0}100%{background-position:140% 0,0 0}}
@media (prefers-reduced-motion:reduce){.ctm-bd *,.ctm-bd *::before,.ctm-bd *::after,.ctm-bd-mates::after,.ctm-bd-card{animation:none!important}}
.ctm-ov-route{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:12px}
.ctm-ov-group{border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.ctm-ov-group>summary{display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;list-style:none;user-select:none}
.ctm-ov-group>summary::-webkit-details-marker{display:none}
.ctm-ov-group>summary::before{content:'';flex:none;width:5px;height:5px;margin-right:2px;border-right:1.3px solid currentColor;border-bottom:1.3px solid currentColor;transform:rotate(-45deg);transition:transform .1s;color:var(--dsw-alias-label-secondary)}
.ctm-ov-group[open]>summary::before{transform:rotate(45deg)}
.ctm-ov-group>summary>.ctm-sub:last-child{margin-left:auto}
.ctm-ov-group>summary .ctm-badge{margin-left:0}
.ctm-ov-group>.ctm-ov-block,.ctm-ov-group>p{margin:0;padding:0 10px 10px}
.ctm-ov-list{display:flex;flex-direction:column;border-top:.5px solid var(--dsw-alias-border-l2)}
.ctm-ov-model{display:flex;align-items:flex-start;gap:10px;padding:8px 10px;cursor:pointer}
.ctm-ov-model+.ctm-ov-model{border-top:.5px solid var(--dsw-alias-border-l2)}
.ctm-ov-model:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ctm-ov-model{content-visibility:auto;contain-intrinsic-size:auto 56px}
.ctm-ov-model[data-off] .ctm-ov-model-name .ctm-name{color:var(--dsw-alias-label-secondary);text-decoration:line-through}
.ctm-ov-model-main{display:flex;flex-direction:column;gap:4px;min-width:0}
.ctm-ov-model-name{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px;min-width:0;overflow-wrap:anywhere}
.ctm-ov-model-name .ctm-badge{margin-left:0}
.ctm-switch{appearance:none;flex:none;position:relative;width:28px;height:16px;margin:2px 0 0;border-radius:999px;background:var(--dsw-alias-border-l1);cursor:pointer;transition:background .15s}
.ctm-switch::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
.ctm-switch:checked{background:var(--dsw-alias-state-success-primary)}
.ctm-switch:checked::after{transform:translateX(12px)}
.ctm-switch:disabled{opacity:.5;cursor:default}
.ctm-ov-roles{display:flex;flex-direction:column;gap:8px}
.ctm-ov-role{display:flex;flex-direction:column;gap:3px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.ctm-ov-role-head{display:flex;align-items:center;gap:6px}
.ctm-ov-role-head .ctm-badge{margin-left:auto}
.ctm-ov-desc{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ctm-ov-kv{padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.ctm-ov-logs{display:flex;flex-direction:column;border-top:.5px solid var(--dsw-alias-border-l2)}
.ctm-ov-log{display:flex;align-items:center;gap:6px;min-width:0;padding:5px 10px}
.ctm-ov-log+.ctm-ov-log{border-top:.5px solid var(--dsw-alias-border-l2)}
.ctm-ov-log .ctm-badge{margin-left:0}
.ctm-ov-log .ctm-ov-route{flex:1 1 auto}
.ctm-ov-seq{flex:none;min-width:32px;font-variant-numeric:tabular-nums}
.ctm-ov-time{flex:none;font-variant-numeric:tabular-nums;white-space:nowrap}
@media (prefers-reduced-motion:reduce){.ctm-switch,.ctm-switch::after,.ctm-ov-group>summary::before{transition:none}}
`;

    // ---------- pure helpers ----------
    const fmt = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, k) => (values[k] ?? ''));
    const firstLine = text => { const s = String(text ?? '').trim(); const i = s.indexOf('\n'); return i === -1 ? s : s.slice(0, i); };
    const parse = raw => { if (typeof raw !== 'string' || !raw) return undefined; try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : undefined; } catch { return undefined; } };
    const cleanError = text => String(text ?? '').replace(/^(?:Error|错误)[:：]\s*/, '');
    /** Durable result blocks flatten like the host's generic row: text parts joined, others as JSON. */
    function resultText(block) {
      const parts = (block.content ?? []).map(item => item.type === 'text' ? item.text : JSON.stringify(item, null, 2));
      if (!parts.length && block.error) parts.push(`${block.error.name}: ${block.error.code}`);
      return parts.join('\n') || null;
    }
    /** Stage facts shared by every card; settled blocks carry `kind`. */
    function stage(props) {
      if (props.phase === 'preparing') return { state: 'preparing', args: {}, output: null, data: undefined };
      const block = props.block;
      const settled = 'kind' in block;
      const args = parse(settled ? block.call?.argsRaw : block.argsRaw) ?? {};
      const output = settled ? resultText(block) : null;
      const state = !settled ? 'running' : block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok';
      return { state, args, output, data: state === 'ok' ? parse(output) : undefined };
    }

    // ---------- icons (original, stroke = currentColor) ----------
    const svg = (...children) => h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, ...children);
    const ICONS = {
      plan: () => svg(h('path', { d: 'M3 3.5h10M3 8h6M3 12.5h4' }), h('path', { d: 'M10.5 10.5l1.5 1.5 2.5-3' })),
      free: () => svg(h('path', { d: 'M8.5 1.8L3.5 9h4l-.5 5.2L12.5 7h-4z' })),
      team: () => svg(h('circle', { cx: 6, cy: 5.5, r: 2.2 }), h('path', { d: 'M2 13c.5-2.3 2-3.5 4-3.5s3.5 1.2 4 3.5' }), h('circle', { cx: 11.5, cy: 6, r: 1.7 }), h('path', { d: 'M11 9.6c1.6 0 2.7.9 3 2.6' })),
    };
    const chevron = open => svg(h('path', { d: open ? 'M4 6l4 4 4-4' : 'M6 4l4 4-4 4' }));

    // ---------- shared row ----------
    function Card({ tool, icon, title, summary, summaryTone, badges, state, body, inspect, t }) {
      const [open, setOpen] = React.useState(false);
      const expandable = body != null && body !== false;
      const isOpen = open && expandable;
      const toggle = () => setOpen(v => !v);
      const rowProps = expandable ? {
        role: 'button', tabIndex: 0, 'aria-expanded': isOpen, 'data-expandable': '', onClick: toggle,
        onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } },
      } : {};
      const status = state === 'running' ? t('state.running') : state === 'error' ? t('state.failed') : state === 'stopped' ? t('state.stopped') : null;
      const tone = state === 'error' ? 'ctm-error' : state === 'stopped' ? 'ctm-warn' : summaryTone ?? '';
      return h('div', { className: 'ctm-card', 'data-tool': tool, 'data-state': state },
        h('div', { className: 'ctm-row', ...(isOpen ? { 'data-open': '' } : {}), ...rowProps },
          h('span', { className: 'ctm-lead' }, h('span', { className: 'ctm-ico' }, icon()), expandable ? h('span', { className: 'ctm-chev' }, chevron(isOpen)) : null),
          status ? h('span', { className: 'ctm-hidden' }, status) : null,
          h('span', { className: 'ctm-title' }, title),
          summary ? h('span', { className: 'ctm-sep', 'aria-hidden': true }) : null,
          summary ? h('span', { className: `ctm-summary ${tone}`, title: summary }, summary) : null,
          ...(badges ?? []).filter(Boolean)),
        isOpen ? h('div', { className: 'ctm-wrap' },
          h('div', { className: 'ctm-body' }, ...(Array.isArray(body) ? body : [body])),
          inspect ? h('button', { type: 'button', className: 'ctm-inspect', onClick: inspect }, t('action.inspect')) : null) : null);
    }
    const section = (label, ...children) => h('div', { className: 'ctm-section' }, label ? h('div', { className: 'ctm-label' }, label) : null, ...children);
    const badge = (text, tone, key) => h('span', { className: 'ctm-badge', 'data-tone': tone, key }, text);
    const chip = (label, value, key) => h('span', { className: 'ctm-chip', key }, label ? h('span', null, label) : null, h('span', null, value));
    const errorBody = (s, t) => s.state === 'error' && s.output ? section(null, h('pre', { className: 'ctm-pre ctm-error' }, cleanError(s.output))) : null;
    /** Results that are not the expected JSON (older sessions, other versions) stay readable as text. */
    const rawBody = (s, t) => s.state === 'ok' && s.output && !s.data ? section(t('output'), h('pre', { className: 'ctm-pre' }, s.output)) : null;

    // ---------- capability_dispatch_plan ----------
    function DispatchPlanView(props) {
      const t = props.t;
      const s = stage(props);
      const plan = s.data ?? s.args;
      const mode = plan.mode;
      const assignments = Array.isArray(plan.assignments) ? plan.assignments : [];
      const summary = s.state === 'error' ? firstLine(cleanError(s.output))
        : mode === 'delegate' ? assignments.map(a => a.displayName ?? a.role).filter(Boolean).join('、')
        : plan.reason ?? '';
      const sections = [];
      if (s.state === 'error') sections.push(errorBody(s, t));
      else if (s.state === 'ok' && !s.data) sections.push(rawBody(s, t));
      else {
        if (plan.analysis) sections.push(section(t('plan.analysis'), h('div', { className: 'ctm-text' }, plan.analysis)));
        if (plan.reason) sections.push(section(t('plan.reason'), h('div', { className: 'ctm-text' }, plan.reason)));
        if (assignments.length) sections.push(section(t('plan.assignments'), h('div', { className: 'ctm-grid' }, ...assignments.flatMap((a, i) => [
          h('div', { className: 'ctm-who', key: `w${i}` }, h('span', { className: 'ctm-name' }, a.displayName ?? a.role),
            h('span', { className: 'ctm-sub' }, [a.displayName ? a.role : null, a.capability, a.model].filter(Boolean).join(' · '))),
          h('div', { className: 'ctm-text', key: `t${i}` }, a.task),
        ]))));
        const facts = [];
        if (plan.freeTools) facts.push(chip(t('free.tools'), t(`tools.${plan.freeTools}`), 'tools'));
        if (plan.directBudget !== undefined) facts.push(h('span', { className: 'ctm-sub', key: 'budget' }, fmt(t('plan.budget'), { n: plan.directBudget })));
        if (plan.next) sections.push(section(t('plan.next'), facts.length ? h('div', { className: 'ctm-chips' }, ...facts) : null, h('div', { className: 'ctm-text ctm-sub' }, plan.next)));
      }
      const body = sections.filter(Boolean);
      return h(Card, { tool: 'capability_dispatch_plan', icon: ICONS.plan, title: t('plan.title'), summary, state: s.state, t, inspect: props.inspect,
        badges: [mode && t(`mode.${mode}`) !== `mode.${mode}` ? badge(t(`mode.${mode}`), mode === 'delegate' ? 'brand' : undefined, 'mode') : null],
        body: body.length ? body : null });
    }

    // ---------- capability_free_task ----------
    function FreeTaskView(props) {
      const t = props.t;
      const s = stage(props);
      const r = s.data;
      const subject = s.args.subject || firstLine(s.args.prompt);
      const changed = Array.isArray(r?.changedFiles) ? r.changedFiles : [];
      const summary = s.state === 'error' ? firstLine(cleanError(s.output)) : subject;
      const badges = [];
      if (r?.model) badges.push(badge(String(r.model).replace(/^opencode\//, ''), 'success', 'model'));
      if (changed.length) badges.push(badge(fmt(t('free.changedCount'), { n: changed.length }), 'brand', 'changed'));
      if (r?.skipped?.length) badges.push(badge(`${t('free.skipped')} ${r.skipped.length}`, 'warn', 'skipped'));
      const sections = [];
      if (r) {
        const calls = Array.isArray(r.toolCalls) ? r.toolCalls.length : 0;
        sections.push(section(null, h('div', { className: 'ctm-chips' },
          chip(t('free.model'), r.model, 'm'),
          r.tools ? chip(t('free.tools'), t(`tools.${r.tools}`), 'tl') : null,
          r.taskId ? chip(t('free.task'), `#${r.taskId}`, 'tk') : null,
          calls ? chip('', fmt(t('free.calls'), { n: calls }), 'c') : null)));
        if (r.skipped?.length) sections.push(section(t('free.skipped'), h('ul', { className: 'ctm-list ctm-warn' }, ...r.skipped.map((x, i) => h('li', { key: i, className: 'ctm-sub ctm-warn' }, x)))));
        if (changed.length) sections.push(section(t('free.changed'), h('ul', { className: 'ctm-list' }, ...changed.map(file => h('li', { key: file },
          h('button', { type: 'button', className: 'ctm-link', onClick: () => props.openFile?.(file) }, file))))));
        if (r.text) sections.push(section(t('free.result'), h('pre', { className: 'ctm-pre' }, r.text)));
      } else if (s.state === 'error') sections.push(errorBody(s, t));
      else if (s.state === 'ok') sections.push(rawBody(s, t));
      if (s.args.prompt) sections.push(section(t('free.prompt'), h('pre', { className: 'ctm-pre ctm-sub', 'data-short': '' }, s.args.prompt)));
      const body = sections.filter(Boolean);
      return h(Card, { tool: 'capability_free_task', icon: ICONS.free, title: t('free.title'), summary, state: s.state, t, inspect: props.inspect, badges, body: body.length ? body : null });
    }

    // ---------- capability_team_read / capability_team_save ----------
    function rolesGrid(roles, t) {
      return h('div', { className: 'ctm-grid3' }, ...roles.flatMap((r, i) => [
        h('div', { className: 'ctm-who', key: `n${i}` }, h('span', { className: 'ctm-name' }, r.displayName ?? r.id), h('span', { className: 'ctm-sub' }, r.id)),
        h('span', { className: 'ctm-sub', key: `c${i}` }, [r.capability, r.tier].filter(Boolean).join(' · ')),
        h('div', { className: 'ctm-who', key: `m${i}` },
          h('span', null, r.provider ? `${r.provider}/${r.model}` : t('team.unassigned')),
          Array.isArray(r.fallbacks) && r.fallbacks.length ? h('span', { className: 'ctm-sub' }, fmt(t('team.fallbacks'), { n: r.fallbacks.length })) : null),
      ]));
    }
    function teamView(kind) {
      return function TeamView(props) {
        const t = props.t;
        const s = stage(props);
        const d = s.data;
        const roles = Array.isArray(d?.roles) ? d.roles : [];
        const summary = s.state === 'error' ? firstLine(cleanError(s.output))
          : !d ? ''
          : kind === 'save' ? fmt(t('team.saved'), { rev: d.revision })
          : fmt(t('team.summary'), { name: d.effective?.name ?? '', rev: d.revision, n: roles.length });
        const sections = [];
        if (d) {
          if (roles.length) sections.push(section(t('team.roles'), rolesGrid(roles, t)));
          if (d.coolingRoutes?.length) sections.push(section(t('team.cooling'), h('div', { className: 'ctm-text ctm-warn' }, d.coolingRoutes.map(c => typeof c === 'string' ? c : JSON.stringify(c)).join('\n'))));
          if (d.project) sections.push(section(t('team.project'), h('span', { className: 'ctm-sub' }, d.project)));
        } else sections.push(errorBody(s, t) ?? rawBody(s, t));
        const body = sections.filter(Boolean);
        return h(Card, { tool: `capability_team_${kind}`, icon: ICONS.team, title: t(kind === 'save' ? 'team.saveTitle' : 'team.readTitle'), summary,
          summaryTone: kind === 'save' && d ? '' : undefined, state: s.state, t, inspect: props.inspect, body: body.length ? body : null,
          badges: kind === 'save' && d?.saved ? [badge('✓', 'success', 'ok')] : [] });
      };
    }

    // ---------- right sidebar: team overview ----------
    const TIER_ORDER = ['high', 'upper', 'medium', 'low'];
    const PAGE = 40;
    const isRule = entry => entry.endsWith('*');
    /** Same semantics as the host: exact provider/model keys, or "prefix*" on the full key or the bare model id. */
    const ruleMatcher = list => {
      const exact = new Set(), prefixes = [];
      for (const entry of list) (isRule(entry) ? prefixes.push(entry.slice(0, -1)) : exact.add(entry));
      return key => exact.has(key) || prefixes.some(p => key.startsWith(p) || key.slice(key.indexOf('/') + 1).startsWith(p));
    };
    const ruleCovers = (rule, key) => ruleMatcher([rule])(key);
    /** User input → normalized prefix rule, or null when it is not a usable prefix. */
    const toRule = text => {
      const base = String(text ?? '').trim().replace(/\*+$/, '');
      return base.length >= 2 && !/[*\s]/.test(base) ? base + '*' : null;
    };
    const tierRank = tier => { const i = TIER_ORDER.indexOf(tier); return i === -1 ? (tier === 'unknown' ? 99 : 50) : i; };
    const routeText = route => typeof route === 'string' ? route : route?.provider ? `${route.provider}/${route.model}` : '';
    const when = value => {
      if (value == null) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    /** Labelled translation that falls back to the raw value when no dictionary entry exists. */
    const label = (t, key, fallback) => { const text = t(key); return text === key ? fallback : text; };
    const stat = (value, text, tone, key) => h('div', { className: 'ctm-ov-stat', 'data-tone': tone, key }, h('strong', null, value), h('span', null, text));

    function ModelPolicyEditor({ sessionId, policy, save, t }) {
      const [draft, setDraft] = React.useState(policy.disabledRoutes ?? []);
      const [status, setStatus] = React.useState({});
      const [revision, setRevision] = React.useState(policy.revision);
      const [saved, setSaved] = React.useState(policy.disabledRoutes ?? []);
      const [query, setQuery] = React.useState('');
      const [tierTab, setTierTab] = React.useState(null);
      const [limit, setLimit] = React.useState(PAGE);
      const [prefix, setPrefix] = React.useState('');
      const isOff = ruleMatcher(draft);
      const rules = draft.filter(isRule);
      const ruleFor = key => draft.includes(key) ? null : rules.find(rule => ruleCovers(rule, key));
      const pending = draft.filter(key => !saved.includes(key)).length + saved.filter(key => !draft.includes(key)).length;
      const rows = policy.rows ?? [];
      const names = new Map((policy.allocations ?? []).map(a => [a.id, a.displayName]));
      const who = ids => ids.map(id => names.get(id) ?? id).join('、');
      const needle = query.trim().toLowerCase();
      const matches = row => !needle || [row.key, who(row.primaryFor ?? []), who(row.fallbackFor ?? [])].join(' ').toLowerCase().includes(needle);
      const groups = new Map();
      for (const row of rows) {
        const tier = row.tiers?.[0] ?? 'unknown';
        if (!groups.has(tier)) groups.set(tier, []);
        groups.get(tier).push(row);
      }
      const toggle = (key, enabled) => {
        setDraft(old => enabled ? old.filter(k => k !== key) : [...new Set([...old, key])]);
        setStatus({});
      };
      const submit = async () => {
        setStatus({ busy: true });
        try {
          const result = await save(sessionId, draft, revision);
          setRevision(result.revision); setSaved(result.disabledRoutes); setDraft(result.disabledRoutes);
          setStatus({ success: true });
        } catch (error) { setStatus({ error: String(error.message ?? error) }); }
      };
      const modelRow = (row, showTier) => {
        const enabled = !isOff(row.key);
        const rule = enabled ? null : ruleFor(row.key);
        const usage = [
          row.primaryFor?.length ? chip(t('models.primary'), who(row.primaryFor), 'p') : null,
          row.fallbackFor?.length ? chip(t('models.fallback'), who(row.fallbackFor), 'f') : null,
        ].filter(Boolean);
        return h('label', { key: row.key, className: 'ctm-ov-model', ...(enabled ? {} : { 'data-off': '' }) },
          h('input', { type: 'checkbox', className: 'ctm-switch', role: 'switch', checked: enabled, disabled: status.busy || !!rule, title: rule ? fmt(t('models.byRule'), { rule }) : undefined, 'aria-label': `${t('models.enabled')} ${row.key}`,
            onChange: e => toggle(row.key, e.target.checked) }),
          h('div', { className: 'ctm-ov-model-main' },
            h('div', { className: 'ctm-ov-model-name' },
              h('span', { className: 'ctm-name' }, row.model ?? row.key),
              row.provider ? h('span', { className: 'ctm-sub' }, row.provider) : null,
              showTier && row.tiers?.[0] ? badge(label(t, `tier.${row.tiers[0]}`, row.tiers[0]), undefined, 'tier') : null,
              enabled ? null : badge(rule ? fmt(t('models.byRule'), { rule }) : t('models.disabledBadge'), 'warn', 'off')),
            usage.length ? h('div', { className: 'ctm-chips' }, ...usage) : h('span', { className: 'ctm-sub' }, t('models.unused'))));
      };
      const orphans = draft.filter(key => !isRule(key) && !rows.some(row => row.key === key));
      const candidate = toRule(prefix);
      const preview = candidate ? rows.filter(row => ruleCovers(candidate, row.key)) : [];
      const addRule = () => {
        if (!candidate || draft.includes(candidate)) return;
        setDraft(old => [...new Set([...old, candidate])]); setPrefix(''); setStatus({});
      };
      const removeRule = rule => { setDraft(old => old.filter(k => k !== rule)); setStatus({}); };
      const tiers = [...groups.keys()].sort((a, b) => tierRank(a) - tierRank(b));
      // Large catalogs (hundreds of routes): open on one tier, list routes in use first, render in pages.
      const activeTier = tierTab === 'all' || groups.has(tierTab) ? tierTab : tiers[0] ?? 'all';
      const scoped = activeTier === 'all' ? tiers.flatMap(tier => groups.get(tier)) : groups.get(activeTier);
      const wasOff = ruleMatcher(saved);
      const weight = row => row.primaryFor?.length ? 0 : row.fallbackFor?.length ? 1 : wasOff(row.key) ? 2 : 3;
      const shown = scoped.filter(matches).map((row, index) => ({ row, index })).sort((a, b) => weight(a.row) - weight(b.row) || a.index - b.index).map(x => x.row);
      const visible = shown.slice(0, limit);
      const tierTabButton = (id, text, list) => {
        const count = list.filter(row => isOff(row.key)).length;
        return h('button', { key: id, type: 'button', role: 'tab', className: 'ctm-ov-tier', 'aria-selected': activeTier === id, onClick: () => { setTierTab(id); setLimit(PAGE); } },
          text, h('span', { className: 'ctm-ov-count' }, String(list.length)), count ? h('span', { className: 'ctm-ov-offdot', title: fmt(t('models.tierCount'), { n: list.length, d: count }) }) : null);
      };
      return h('div', { className: 'ctm-ov-editor' },
        h('div', { className: 'ctm-ov-toolbar' },
          h('button', { type: 'button', className: 'ctm-btn', 'data-primary': '', disabled: !pending || status.busy, onClick: submit }, t(status.busy ? 'models.saving' : 'models.save')),
          pending && !status.busy ? h('button', { type: 'button', className: 'ctm-btn', onClick: () => { setDraft(saved); setStatus({}); } }, t('models.reset')) : null,
          status.error ? h('span', { role: 'alert', className: 'ctm-ov-note ctm-error' }, status.error)
            : status.success ? h('span', { role: 'status', className: 'ctm-ov-note ctm-success' }, t('models.saved'))
            : pending ? h('span', { className: 'ctm-ov-note ctm-warn' }, fmt(t('models.dirty'), { n: pending })) : null),
        h('p', { className: 'ctm-sub ctm-ov-help' }, t('models.help')),
        h('div', { className: 'ctm-ov-block' },
          h('div', { className: 'ctm-label' }, t('models.preview')),
          revision === policy.revision
            ? h('div', { className: 'ctm-ov-allocs' }, ...(policy.allocations ?? []).map(role => h('div', { key: role.id, className: 'ctm-ov-alloc', 'data-status': role.status, title: role.reason ?? '' },
                h('span', { className: 'ctm-name' }, role.displayName),
                role.primary ? h('div', { className: 'ctm-ov-chain' },
                  h('span', { className: 'ctm-ov-hop', 'data-primary': '', title: role.primary }, role.primary),
                  ...(role.fallbacks ?? []).flatMap((route, i) => [h('span', { key: 'a' + i, className: 'ctm-ov-arrow', 'aria-hidden': true }, '›'), h('span', { key: 'r' + i, className: 'ctm-ov-hop', title: route }, route)]))
                  : h('span', { className: 'ctm-ov-route ctm-warn' }, t('models.' + role.status)))))
            : h('p', { className: 'ctm-sub' }, t('models.refreshPreview'))),
        rows.length > 6 ? h('input', { type: 'search', className: 'ctm-ov-search', placeholder: t('models.filter'), value: query, onChange: e => { setQuery(e.target.value); setLimit(PAGE); } }) : null,
        h('div', { className: 'ctm-ov-block ctm-ov-rules' },
          h('div', { className: 'ctm-label' }, t('models.prefixTitle')),
          h('div', { className: 'ctm-ov-rule-input' },
            h('input', { type: 'text', className: 'ctm-ov-search', placeholder: t('models.prefixPlaceholder'), value: prefix, disabled: status.busy, 'aria-label': t('models.prefixTitle'),
              onChange: e => setPrefix(e.target.value), onKeyDown: e => { if (e.key === 'Enter') { e.preventDefault(); addRule(); } } }),
            h('button', { type: 'button', className: 'ctm-btn', disabled: !candidate || draft.includes(candidate) || status.busy, onClick: addRule }, t('models.prefixAdd'))),
          prefix.trim() ? h('p', { className: candidate && preview.length ? 'ctm-sub' : 'ctm-sub ctm-warn' },
            !candidate ? t('models.prefixInvalid')
              : draft.includes(candidate) ? t('models.prefixExists')
              : fmt(t('models.prefixPreview'), { rule: candidate, n: preview.length, list: preview.slice(0, 3).map(row => row.key).join('、') + (preview.length > 3 ? '…' : '') })) : null,
          rules.length ? h('div', { className: 'ctm-chips' }, ...rules.map(rule => h('span', { key: rule, className: 'ctm-chip ctm-ov-rule' },
            h('span', null, rule), h('span', null, fmt(t('models.ruleCount'), { n: rows.filter(row => ruleCovers(rule, row.key)).length })),
            h('button', { type: 'button', className: 'ctm-ov-rule-x', disabled: status.busy, 'aria-label': fmt(t('models.ruleRemove'), { rule }), onClick: () => removeRule(rule) }, '×'))))
            : h('p', { className: 'ctm-sub' }, t('models.prefixHelp'))),
        tiers.length ? h('div', { className: 'ctm-ov-tiers', role: 'tablist', 'aria-label': t('models.tiers') },
          tierTabButton('all', t('models.allTiers'), rows), ...tiers.map(tier => tierTabButton(tier, label(t, `tier.${tier}`, tier), groups.get(tier)))) : null,
        shown.length ? h('div', { className: 'ctm-ov-group' }, h('div', { className: 'ctm-ov-list ctm-ov-list-flat' }, ...visible.map(row => modelRow(row, activeTier === 'all'))))
          : rows.length ? h('p', { className: 'ctm-sub' }, t('models.noMatch')) : null,
        shown.length > visible.length ? h('button', { type: 'button', className: 'ctm-btn ctm-ov-more', onClick: () => setLimit(n => n + PAGE * 2) },
          fmt(t('models.more'), { n: shown.length - visible.length })) : null,
        orphans.length ? h('details', { className: 'ctm-ov-group', open: true },
          h('summary', null, h('span', { className: 'ctm-name' }, t('models.orphans')), h('span', { className: 'ctm-sub' }, String(orphans.length))),
          h('div', { className: 'ctm-ov-list' }, ...orphans.map(key => modelRow({ key })))) : null);
    }

    // Live polling re-renders the overview every few seconds; the editor only changes with its own data.
    const PolicyEditor = React.memo ? React.memo(ModelPolicyEditor, (a, b) => a.sessionId === b.sessionId && a.policy === b.policy
      && a.save === b.save && (a.t === b.t || a.t('models.save') === b.t('models.save'))) : ModelPolicyEditor;

    function RoleCards({ roles, t }) {
      return h('div', { className: 'ctm-ov-roles' }, ...roles.map(r => {
        const fallbacks = (Array.isArray(r.fallbacks) ? r.fallbacks : []).map(routeText).filter(Boolean);
        return h('div', { key: r.id, className: 'ctm-ov-role' },
          h('div', { className: 'ctm-ov-role-head' },
            h('span', { className: 'ctm-name' }, r.displayName ?? r.id),
            r.tier ? badge(label(t, `tier.${r.tier}`, r.tier), r.tier === 'high' ? 'brand' : undefined, 'tier') : null),
          h('span', { className: 'ctm-sub' }, [r.id, r.capability].filter(Boolean).join(' · ')),
          r.description ? h('span', { className: 'ctm-ov-desc' }, r.description) : null,
          h('span', { className: r.provider ? 'ctm-ov-route' : 'ctm-ov-route ctm-warn' }, r.provider ? `${r.provider}/${r.model}` : t('team.unassigned')),
          fallbacks.length ? h('span', { className: 'ctm-sub', title: fallbacks.join('\n') }, fmt(t('roles.fallbackList'), { list: fallbacks.join('、') })) : null);
      }));
    }

    function WorkflowList({ workflow, t }) {
      if (!workflow || typeof workflow !== 'object') return h('span', { className: 'ctm-sub' }, '—');
      const value = (key, v) => {
        if (key === 'mode') return label(t, `workflow.mode.${v}`, String(v));
        if (key === 'freeTools') return label(t, `tools.${v}`, String(v));
        if (key === 'analysisBudget' || key === 'directBudget') return fmt(t('workflow.times'), { n: v });
        if (key === 'freeModels' && Array.isArray(v) && !v.length) return t('workflow.allFree');
        if (Array.isArray(v)) return h('div', { className: 'ctm-chips' }, ...v.map(item => h('span', { key: String(item), className: 'ctm-chip' }, String(item))));
        return typeof v === 'object' ? h('pre', { className: 'ctm-pre', 'data-short': '' }, JSON.stringify(v, null, 2)) : String(v);
      };
      return h('div', { className: 'ctm-grid ctm-ov-kv' }, ...Object.entries(workflow).flatMap(([key, v]) => [
        h('span', { key: `k${key}`, className: 'ctm-sub' }, label(t, `workflow.${key}`, key)),
        h('div', { key: `v${key}`, className: 'ctm-text' }, value(key, v)),
      ]));
    }

    function EvidenceGroups({ d, sessionId, t }) {
      const groups = d.memberEvidence?.length ? d.memberEvidence : [{ sessionId, name: '', ...(d.requestEvidence ?? {}) }];
      return h('div', { className: 'ctm-ov-block' },
        h('p', { className: 'ctm-sub ctm-ov-help' }, t('evidence.hint')),
        ...groups.map((member, index) => {
          const records = member.records ?? [];
          const self = member.sessionId === sessionId;
          return h('details', { key: member.sessionId ?? index, className: 'ctm-ov-group', open: index === 0 },
            h('summary', null,
              h('span', { className: 'ctm-name' }, member.name || t('logs.thisSession')),
              self && member.name ? badge(t('logs.thisSession'), 'brand', 'self') : null,
              h('span', { className: 'ctm-sub' }, fmt(t('logs.count'), { n: records.length }))),
            member.unavailable ? h('p', { className: 'ctm-ov-note ctm-warn' }, member.unavailable) : null,
            records.length ? h('div', { className: 'ctm-ov-logs' }, ...records.map(record => h('div', { key: record.seq, className: 'ctm-ov-log' },
              h('span', { className: 'ctm-sub ctm-ov-seq' }, `#${record.seq}`),
              h('span', { className: 'ctm-ov-route', title: `${record.provider}/${record.model}` }, `${record.provider}/${record.model}`),
              badge(t('evidence.short.' + record.evidence), record.evidence === 'assistant-message' ? 'success' : undefined, 'kind'),
              record.interrupted ? badge(t('logs.interrupted'), 'warn', 'int') : null,
              h('span', { className: 'ctm-sub ctm-ov-time', title: t('evidence.' + record.evidence) }, when(record.time)))))
              : h('p', { className: 'ctm-sub' }, t('evidence.empty')));
        }));
    }

    /**
     * Live roster without any logged command: Lead + direct children from the read-only subagent catalog,
     * running/idle from host-pushed agent status, names/models/tasks from the last manual snapshot.
     */
    /** Pushed status wins; otherwise the catalog/snapshot, never trusting a possibly stale "running". */
    function memberStatus(member, push, fresh) {
      if (push) {
        if (push.error && !push.running) return 'failed';
        return push.running ? 'running' : 'idle';
      }
      if (member.resident === false) return 'inactive';
      if (member.status === 'running' && !fresh) return 'idle';
      return member.status ?? (member.resident ? 'idle' : 'inactive');
    }
    function liveRoster(leadId, snapshot, children, live, snapshotAt) {
      // A snapshot status is trusted only if no push could have been missed since it was taken.
      const fresh = !live || (snapshotAt ?? 0) >= live.startedAt;
      if (!snapshot && !children) return null;
      const known = new Map((snapshot?.members ?? []).map(m => [m.id, m]));
      const rows = children
        ? [known.get(leadId) ?? { id: leadId, name: 'lead', role: 'lead', diagnostics: [] },
          ...children.filter(c => c.kind === 'child').map(c => ({ ...(known.get(c.id) ?? { name: c.label ?? c.id, role: 'teammate', diagnostics: [] }), id: c.id, resident: c.activity === 'running' }))]
        : snapshot.members ?? [];
      const members = rows.map(m => {
        const push = live?.status(m.id);
        const status = memberStatus(m, push, fresh);
        return { ...m, status, since: push?.running ? push.since : undefined,
          diagnostics: push?.error && !push.running ? [push.error, ...(m.diagnostics ?? [])] : m.diagnostics ?? [] };
      });
      return { members, tasks: snapshot?.tasks ?? [], unavailable: snapshot?.unavailable, at: live ? Date.now() : undefined };
    }
    const LIVE = { running: 'brand', provisioning: 'brand', idle: 'success', failed: 'error', inactive: undefined };
    const elapsed = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    /** Join configured roles with live roster rows: Lead by role, teammates by their spawn name (= role id). */
    function boardCards(roles, activity, allocations) {
      const members = activity?.members ?? [];
      const tasks = activity?.tasks ?? [];
      const primary = new Map((allocations ?? []).map(a => [a.id, a.primary]));
      const used = new Set();
      const cards = roles.map(role => {
        const lead = role.id === 'lead' || role.capability === 'orchestrator';
        const member = members.find(m => !used.has(m) && (lead ? m.role === 'lead' : m.name === role.id));
        if (member) used.add(member);
        return { id: role.id, name: role.displayName ?? role.id, lead, member, role };
      });
      for (const member of members) if (!used.has(member)) cards.push({ id: member.name, name: member.name, lead: member.role === 'lead', member, role: null });
      return cards.map(card => {
        const owner = card.member?.name ?? card.id;
        const mine = tasks.filter(task => task.ownerName === owner && task.status !== 'completed');
        return { ...card, status: card.member?.status ?? 'inactive',
          model: card.member?.model ? [card.member.provider, card.member.model].filter(Boolean).join('/')
            : primary.get(card.id) ?? (card.role?.provider ? `${card.role.provider}/${card.role.model}` : null),
          liveModel: !!card.member?.model,
          task: mine.find(task => task.status === 'in_progress') ?? mine[0], queued: mine.length };
      });
    }
    function TeamBoard({ roles, activity, allocations, since, t }) {
      const cards = boardCards(roles, activity, allocations);
      const lead = cards.filter(c => c.lead);
      const mates = cards.filter(c => !c.lead);
      const running = cards.filter(c => c.status === 'running').length;
      const card = c => h('div', { key: c.id, className: 'ctm-bd-card', 'data-status': c.status },
        h('div', { className: 'ctm-bd-top' },
          h('span', { className: 'ctm-bd-avatar', 'aria-hidden': true }, Array.from(c.name)[0] ?? '?'),
          h('div', { className: 'ctm-who' }, h('span', { className: 'ctm-name' }, c.name), h('span', { className: 'ctm-sub' }, c.role?.capability ?? c.id)),
          h('span', { className: 'ctm-bd-state', 'data-tone': LIVE[c.status] },
            h('i', { className: 'ctm-bd-dot', 'aria-hidden': true }), label(t, `live.${c.status}`, c.status),
            c.status === 'running' && since.get(c.member?.id) ? h('span', { className: 'ctm-bd-time' }, elapsed(Date.now() - since.get(c.member.id))) : null)),
        h('div', { className: 'ctm-bd-task', title: c.task?.subject ?? '' },
          c.task ? [h('span', { key: 'i', className: 'ctm-sub' }, `#${c.task.id}`), h('span', { key: 's', className: 'ctm-bd-subject' }, c.task.subject), c.queued > 1 ? h('span', { key: 'q', className: 'ctm-sub' }, `+${c.queued - 1}`) : null]
            : h('span', { className: 'ctm-sub' }, t(c.status === 'running' ? 'live.busyNoTask' : 'live.noTask'))),
        c.model ? h('div', { className: 'ctm-bd-model', title: t(c.liveModel ? 'live.liveModel' : 'live.configModel') },
          h('span', { className: 'ctm-ov-hop', ...(c.liveModel ? { 'data-primary': '' } : {}) }, c.model)) : null,
        c.member?.diagnostics?.length ? h('div', { className: 'ctm-sub ctm-warn' }, c.member.diagnostics.join('；')) : null,
        h('div', { className: 'ctm-bd-bar', 'aria-hidden': true }));
      return h('div', { className: 'ctm-bd' },
        h('div', { className: 'ctm-bd-head' },
          h('span', { className: 'ctm-label' }, t('live.title')),
          running ? badge(fmt(t('live.runningCount'), { n: running }), 'brand', 'run') : null,
          activity?.at ? h('span', { className: 'ctm-sub ctm-bd-at' }, h('i', { className: 'ctm-bd-pulse', 'aria-hidden': true }), t('live.polling')) : null),
        activity?.unavailable ? h('p', { className: 'ctm-ov-note ctm-warn' }, activity.unavailable) : null,
        h('div', { className: 'ctm-bd-canvas' },
          lead.length ? h('div', { className: 'ctm-bd-lead' }, ...lead.map(card)) : null,
          mates.length ? h('div', { className: 'ctm-bd-mates', ...(mates.some(c => c.status === 'running') ? { 'data-flow': '' } : {}) }, ...mates.map(card)) : null));
    }

    function Overview({ sessionId, t, load, save, live, cache }) {
      const [state, setState] = React.useState({ pending: false });
      const [tab, setTab] = React.useState('models');
      const ticket = React.useRef(0);
      const [, redraw] = React.useState(0);
      const [children, setChildren] = React.useState(null);
      // The status command is logged into the conversation by the host, so it only runs on an explicit click.
      const refresh = async () => {
        const id = ++ticket.current;
        setState(previous => ({ ...(previous.sessionId === sessionId ? previous : {}), pending: true, error: undefined, sessionId }));
        try {
          const data = await load(sessionId);
          const at = Date.now();
          cache?.put(sessionId, { data, at });
          if (ticket.current === id) setState({ data, sessionId, at });
        } catch (error) {
          if (ticket.current === id) setState(previous => ({ ...(previous.sessionId === sessionId ? previous : {}), pending: false, error: String(error.message ?? error), sessionId }));
        }
      };
      React.useEffect(() => () => { ticket.current++; }, [sessionId]);
      // Host-pushed status changes and the read-only subagent catalog never touch the session log.
      React.useEffect(() => live?.subscribe(() => redraw(n => n + 1)), [live]);
      const rosterVersion = live?.rosterVersion() ?? 0;
      React.useEffect(() => {
        if (!live) return undefined;
        let stopped = false;
        live.children(sessionId).then(entries => { if (!stopped) setChildren({ sessionId, entries }); }, () => {});
        return () => { stopped = true; };
      }, [sessionId, live, rosterVersion]);
      const stored = state.sessionId === sessionId ? state : null;
      const cached = stored?.data ? null : cache?.get(sessionId);
      // Before the first manual read in this panel, show the last cached snapshot for this session.
      const current = cached ? { ...stored, data: cached.data, at: cached.at, cached: true } : stored ?? {};
      const d = current.data;
      const roster = liveRoster(sessionId, d?.activity, children?.sessionId === sessionId ? children.entries : null, live, current.at);
      const since = new Map((roster?.members ?? []).filter(m => m.since).map(m => [m.id, m.since]));
      const working = (roster?.members ?? []).filter(m => m.status === 'running').length;
      const team = d?.team;
      const policy = team?.modelPolicy;
      const blocked = (policy?.allocations ?? []).filter(a => a.status !== 'eligible').length;
      const savedOff = ruleMatcher(policy?.disabledRoutes ?? []);
      const disabledCount = (policy?.rows ?? []).filter(row => savedOff(row.key)).length;
      const health = !d ? null
        : d.ready ? { tone: 'success', text: t('overview.ready') }
        : d.preset !== 'capability-team' ? { tone: 'warn', text: t('overview.notMounted') }
        : { tone: 'error', text: t('overview.abnormal') };
      const diagnostics = d ? [
        h('p', { key: 'e', className: 'ctm-text' }, d.explanation),
        h('div', { key: 'f', className: 'ctm-chips' },
          chip(t('overview.preset'), d.preset ?? '—', 'preset'),
          team?.project ? chip(t('team.project'), team.project, 'project') : null,
          d.missingTools?.length ? chip(t('overview.missingTools'), d.missingTools.join('、'), 'missing') : null),
        d.activationError ? h('pre', { key: 'a', className: 'ctm-pre ctm-error' }, d.activationError) : null,
        d.teamError ? h('p', { key: 't', role: 'alert', className: 'ctm-error' }, d.teamError) : null,
      ] : [];
      const tabs = [
        ['models', policy?.rows?.length],
        ['roles', team?.roles?.length],
        ['logs', (d?.memberEvidence?.length ? d.memberEvidence : [d?.requestEvidence ?? {}]).reduce((n, m) => n + (m.records?.length ?? 0), 0)],
      ];
      return h('section', { className: 'ctm-ov' },
        h('header', { className: 'ctm-ov-head' },
          h('div', { className: 'ctm-ov-titlerow' },
            h('h2', { className: 'ctm-ov-title' }, t('overview.title')),
            health ? badge(health.text, health.tone, 'health') : null,
            h('button', { type: 'button', className: 'ctm-btn ctm-ov-refresh', disabled: current.pending, onClick: refresh, 'aria-busy': !!current.pending },
              t(current.pending ? 'overview.loading' : 'overview.refresh'))),
          h('p', { className: 'ctm-sub' }, team ? [team.name, fmt(t('overview.revision'), { rev: team.revision })].filter(Boolean).join(' · ') : t('overview.hint'),
            current.at ? ` · ${fmt(t('overview.updated'), { time: when(current.at) })}` : ''),
          h('p', { className: 'ctm-sub ctm-ov-lognote' }, t('overview.logNote'))),
        h('div', { className: 'ctm-ov-scroll' },
          current.error ? h('p', { role: 'alert', className: 'ctm-ov-callout', 'data-tone': 'error' }, current.error) : null,
          !d ? h('div', { className: 'ctm-ov-empty' }, h('p', { className: 'ctm-sub' }, t(current.pending ? 'overview.loading' : 'overview.empty')),
            current.pending ? null : h('button', { type: 'button', className: 'ctm-btn', 'data-primary': '', onClick: refresh }, t('overview.firstLoad'))) : null,
          d && team ? h('div', { className: 'ctm-ov-stats' },
            stat(team.roles?.length ?? 0, t('overview.statRoles'), undefined, 'r'),
            stat(working, t('overview.statWorking'), working ? 'brand' : undefined, 'w'),
            stat(policy?.rows?.length ?? 0, t('overview.statModels'), undefined, 'm'),
            stat(disabledCount, t('overview.statDisabled'), disabledCount ? 'warn' : undefined, 'd'),
            stat(blocked, t('overview.statBlocked'), blocked ? 'error' : undefined, 'b')) : null,
          d ? (d.ready
            ? h('details', { className: 'ctm-ov-group ctm-ov-diag' }, h('summary', null, h('span', { className: 'ctm-name' }, t('overview.details'))), h('div', { className: 'ctm-ov-block' }, ...diagnostics))
            : h('div', { className: 'ctm-ov-callout', 'data-tone': health.tone }, ...diagnostics)) : null,
          ...(team?.catalogErrors ?? []).map(error => h('p', { key: error.provider, role: 'alert', className: 'ctm-ov-callout', 'data-tone': 'error' }, `${error.provider}: ${error.error}`)),
          d ? h('nav', { className: 'ctm-ov-tabs', 'aria-label': t('overview.title') },
            ...tabs.map(([id, count]) => h('button', { key: id, type: 'button', className: 'ctm-ov-tab', 'aria-pressed': tab === id, onClick: () => setTab(id) },
              t('nav.' + id), count ? h('span', { className: 'ctm-ov-count' }, String(count)) : null))) : null,
          d ? h('div', { className: 'ctm-ov-panel', 'data-panel': 'logs', hidden: tab !== 'logs' }, h(EvidenceGroups, { d, sessionId, t })) : null,
          d ? h('div', { className: 'ctm-ov-panel', 'data-panel': 'models', hidden: tab !== 'models' },
            h('div', { className: 'ctm-ov-split' },
              team ? h(TeamBoard, { roles: team.roles ?? [], activity: roster, allocations: policy?.allocations, since, t }) : null,
              policy ? h(PolicyEditor, { key: `${sessionId}:${policy.revision}`, sessionId, policy, save, t }) : h('p', { className: 'ctm-sub' }, t('overview.noData')))) : null,
          d ? h('div', { className: 'ctm-ov-panel', 'data-panel': 'roles', hidden: tab !== 'roles' },
            team ? h(React.Fragment, null,
              h(RoleCards, { roles: team.roles ?? [], t }),
              team.modelNotice ? h('p', { className: 'ctm-sub ctm-ov-help' }, team.modelNotice) : null,
              h('div', { className: 'ctm-ov-block' }, h('div', { className: 'ctm-label' }, t('overview.policy')), h(WorkflowList, { workflow: team.workflow, t })))
              : h('p', { className: 'ctm-sub' }, t('overview.noData'))) : null));
    }

    /** The status command ships catalog rows as tuples to keep its (visible) log entry small. */
    function expandStatus(data) {
      const policy = data?.team?.modelPolicy;
      if (policy && Array.isArray(policy.rows)) {
        policy.rows = policy.rows.map(row => {
          if (!Array.isArray(row)) return row;
          const [key, tier, primaryFor = [], fallbackFor = []] = row;
          const slash = key.indexOf('/');
          return { key, provider: key.slice(0, slash), model: key.slice(slash + 1), tiers: tier ? [tier] : [], primaryFor, fallbackFor };
        });
      }
      return data;
    }
    /** Last manual snapshot per session: memory first, browser storage across panel reloads; never required. */
    const snapshotCache = (() => {
      const memory = new Map();
      const keyOf = id => `capability-team:snapshot:${id}`;
      return {
        get(id) {
          if (memory.has(id)) return memory.get(id);
          try { const raw = window.localStorage?.getItem(keyOf(id)); const value = raw ? JSON.parse(raw) : null; if (value) memory.set(id, value); return value; } catch { return null; }
        },
        put(id, value) {
          memory.set(id, value);
          try { window.localStorage?.setItem(keyOf(id), JSON.stringify(value)); } catch { /* storage full or blocked */ }
        },
      };
    })();
    /** Host-pushed agent status (no polling, nothing logged) plus the read-only direct-child catalog. */
    function liveStore(ctx) {
      const remote = ctx.remote;
      const states = new Map();
      const listeners = new Set();
      let roster = 0;
      const notify = () => { for (const listener of listeners) listener(); };
      const on = (event, listener) => { if (typeof remote?.$on === 'function') remote.$on(event, listener); };
      on('api-session/status', (id, running) => {
        const previous = states.get(id) ?? {};
        if (!previous.known) roster++;
        states.set(id, { known: true, running: !!running, since: running ? previous.since ?? Date.now() : undefined, error: running ? undefined : previous.error });
        notify();
      });
      on('api-session/error', (id, message) => { states.set(id, { ...(states.get(id) ?? {}), known: true, error: String(message) }); notify(); });
      on('api-session/added', () => { roster++; notify(); });
      on('api-session/removed', id => { states.delete(id); roster++; notify(); });
      return {
        startedAt: Date.now(),
        status: id => states.get(id),
        rosterVersion: () => roster,
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        async children(parentId) {
          const reply = await remote?.subagents?.list?.(parentId);
          if (!reply?.ok) throw new Error(reply?.error?.message ?? 'subagent catalog unavailable');
          return reply.value?.entries ?? [];
        },
      };
    }

    const VIEWS = {
      capability_dispatch_plan: DispatchPlanView,
      capability_free_task: FreeTaskView,
      capability_team_read: teamView('read'),
      capability_team_save: teamView('save'),
    };

    return {
      inject: ['slots', 'locale', 'remote', 'remote.commands', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'capability-team: dictionaries');
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.plugin = '@local/dsh-capability-team';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => tag.remove();
        }, 'capability-team: styles');
        const bound = ctx.locale.bind(NS);
        const execute = async (sessionId, line) => {
          const reply = await ctx.remote.commands.execute(sessionId, line, []);
          if (!reply.ok) throw new Error(reply.error?.message ?? 'Remote command failed');
          const result = reply.value?.result;
          if (!result || result.kind === 'error') throw new Error(result?.text ?? 'capability-status is unavailable');
          const data = parse(result.text);
          if (!data) throw new Error('Invalid capability-status response');
          return data;
        };
        const load = async sessionId => expandStatus(await execute(sessionId, '/capability-status'));
        const live = liveStore(ctx);
        const save = (sessionId, disabledRoutes, expectedRevision) => execute(sessionId,
          '/capability-model-policy ' + JSON.stringify({ disabledRoutes, expectedRevision }));
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: 'capability-team-overview', kind: 'capability-team-overview',
          title: () => bound('overview.title'),
          guide: [{ order: 35, title: () => bound('overview.title'), description: () => bound('overview.hint') }],
        }), 'capability-team: right sidebar tab');
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab', key: 'capability-team-overview', id: 'capability-team-overview', locale: NS,
        }, props => h(Overview, { ...props, t: props.t ?? bound, load, save, live, cache: snapshotCache })));
        // Each view receives `t`; fall back to the bound translator when the slot does not inject one.
        const withT = View => function CapabilityToolView(props) { return h(View, { ...props, t: props.t ?? bound }); };
        for (const [key, View] of Object.entries(VIEWS)) {
          ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key, locale: NS }, withT(View)));
        }
      },
    };
  },
});
