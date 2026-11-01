# 配置参考

本文说明项目配置、模型分配、权限、协作策略与可选集成。可用 `capability_team_read` 查看生效配置，并通过 `capability_team_save` 或团队工作台修改。

## 环境变量

在 DSH Host 进程环境设置变量，修改后重启 DSH。

| 变量 | 用途 |
|---|---|
| `CPA_SEARCH_BASE_URL` | 可选搜索端点，示例：`https://gateway.example.com`。 |
| `CPA_SEARCH_API_KEY` | 搜索凭据的默认环境变量名。 |
| `CPA_EMBED_BASE_URL` | 可选嵌入接口地址。 |
| `CPA_EMBED_MODEL` | 可选嵌入模型。 |
| `CPA_EMBED_DIMENSIONS` | 可选向量维度。 |
| `CPA_EMBED_API_KEY` | 嵌入凭据的默认环境变量名。 |
| `CAPABILITY_TEAM_HOME` | 团队配置存储目录，默认 `~/.dsh/capability-team-themes`。 |
| `CAPABILITY_TEAM_OPENCODE_EXECUTABLE` | 可选 OpenCode 可执行文件路径；未设置时从 `PATH` 查找。 |
| `CAPABILITY_TEAM_OPENCODE_MODELS` | 可选 OpenCode 模型目录路径。 |

集成地址、路径、模型和维度也可在工作台设置。密钥只引用环境变量名，不能把密钥值写进项目配置。

## 默认能力与角色

`config.js` 中的初始 `seed` 包含档位、能力和角色绑定：

- **档位**：档位与候选模型 ID 的映射，由运行时目录生成匹配默认值。
- **能力**：职责、所需档位、厂商偏好、搜索权限，以及可选的模型、备选、预算和权限策略。
- **角色**：稳定内部 ID 到显示名、能力的绑定；显示名只用于展示。

默认能力包括主控、技术负责人、后端、前端、检索、写作和 QA。主控必须绑定 orchestrator；显示名必须唯一；指定模型必须属于配置档位；未知字段会被拒绝。`whenToUse` 描述何时应分配该角色。

## 自动模型匹配

匹配器读取 DSH 已注册的渠道与模型 ID，不依赖特定渠道名称。系统会归一化别名和网关前缀，并排除非对话模型、不支持团队工具调用的模型、免费/试用变体及低于厂商版本下限的模型。

档位规则基于模型命名与厂商代际模式。匹配顺序考虑代际、能力偏好、版本及渠道注册顺序。全局禁用策略在匹配与实际路由时生效。最多选择三个同档备选，优先同模型的其他渠道，再考虑其他厂商的模型。不会静默降档：没有合格模型时能力保持未分配并阻止请求。未识别的模型会报告而不会猜测。

渠道目录变化后后续请求会重新匹配。显式保存的项目配置优先于自动匹配。`capability_team_read` 返回 `autoMatch` 报告，包括 matched、upgraded、below-tier、unassigned 和未识别模型。

## 对话式配置与团队模板

角色/主题工作流支持读取配置、查询 DSH 精确模型 ID、保存、导入和导出可移植模板。保存前会校验合并配置并核对模型目录；DSH 原生确认框展示差异，只有用户确认后才写入。

补丁中的对象按字段合并，`null` 恢复默认，`false` 删除设置。模板格式为 `capability-team-template`，版本 1。模板包含角色、职责、能力、档位、偏好、权限、预算、先交计划、工作流和容灾策略；渠道相关模型、备选与长上下文路由不属于模板。导入会整体替换角色定义、校验并通过同样的确认流程。

## 按角色设置权限

能力可设置 `access`：

| 字段 | 含义 |
|---|---|
| `deny` | 禁用的工具名；末尾 `*` 表示前缀匹配。 |
| `editPaths` | 允许写入的项目相对路径 glob；空数组表示禁止所有编辑。 |
| `shell` | `false` 禁用 shell 和终端工具；需要时应与路径限制配合。 |
| `preset` | DSH 官方权限预设，例如 `read-only`，应用于该成员。 |

默认检索角色使用官方只读沙箱，writer 仅能修改文档路径且不能运行命令；其他角色默认不受限。项目外或无法确定的路径会被拒绝。通过 `capabilities.<id>.access` 配置，整体替换；`null` 可移除限制。

## 用量与预算

用量页基于 DSH 投影汇总成员 Token、缓存读取、步数与耗时。预算 Token 是未缓存输入、缓存写入和输出之和；缓存读取单独显示。`capabilities.<id>.maxTokens` 设置每个成员会话的预算上限，达到后阻止路由且不尝试其他模型。需要宿主提供 token-meter 支持。DSH 不提供单价，因此统计的是 Token 而非费用。

## 队友先交计划

能力设置 `planFirst` 后，队友执行前必须提交计划。队友用 `capability_submit_plan` 提交，主控用 `capability_review_plan` 批准或附意见退回。批准前执行工具会被阻止；新任务需重新审批，DSH 重启后计划也需重交。默认关闭。

## 派活工作流

主控通过 `capability_dispatch_plan` 将请求分类为 `delegate`、`free` 或 `direct`。委派任务需包含角色、具体任务和验收条件；免费文本任务只使用允许的免费模型与工具；直办次数由 `directBudget` 限制。

| 工作流字段 | 含义 |
|---|---|
| `mode` | `enforce`、`remind` 或 `off`。 |
| `analysisBudget` | 制定计划前的只读分析额度。 |
| `directBudget` | direct 模式下主控自行执行的上限。 |
| `freeTools` / `freeModels` | 免费任务工具级别与模型顺序。 |
| `confirmDispatch` | 派活确认策略：`on-change`、`always` 或 `never`。 |
| `enforceWriteScopes` | 拒绝超出当前任务写入范围的修改。 |
| `rotation` / `tokens` | 会话轮换与上下文管理策略。 |

分析工具和协调工具由工作流策略分别定义。用户需求变化时需重新制定派活计划。

## 派活确认与看板工作流

启用派活确认后，确认卡显示各角色任务、主模型和最多三个备选。路由可只用于本次任务，也可保存为项目默认。用户确认前主控不能创建或通知队友。无法显示卡片的客户端会回退到 DSH 原生提问框。

子任务可声明 `write_scopes` 和 `blocked_by`。依赖与认领由原生看板管理；就绪任务分配给现有队友，被阻塞任务等待前置完成。启用 `enforceWriteScopes` 时，范围外修改会被拒绝。

## 重试、同档容灾与长上下文

可用性错误可依次触发渠道重试、额外重试和能力配置的同档备选。凭据或额度错误不会在同一渠道反复重试。失败路由进入冷却，恢复后回到主模型。上下文溢出和内容拒绝不会触发容灾。

`longContext: { thresholdTokens, provider, model }` 在投影上下文达到阈值时切换到同档路由，低于阈值 80% 时切回。主模型和备选仍可用于故障恢复。压缩摘要模型需在 DSH 自身配置。

## 搜索与免费文本通道

仅 `search: true` 的能力可使用搜索与网页抓取工具（默认主控和检索角色开启）。抓取仅允许公开 HTTP(S) 地址，拒绝私网、凭据、重定向和包含密钥的响应。搜索结果是不可信资料，应核查。

`capability_free_task` 使用本机 OpenCode 可执行文件与模型目录。`CAPABILITY_TEAM_OPENCODE_EXECUTABLE` 和 `CAPABILITY_TEAM_OPENCODE_MODELS` 可覆盖自动查找。模型必须在目录中标为免费、未弃用且支持工具。额度、鉴权或模型不可用时按序尝试下一个免费模型，不会使用付费模型。工具级别为 `none`、`read`、`write`；始终禁止 shell、联网、子代理、项目外路径和敏感凭据文件。`read`/`write` 会将项目内容发送到免费模型云端，切勿包含密钥。

## 集成

集成设置优先级依次为 Host 环境覆盖、工作台保存的 `$CAPABILITY_TEAM_HOME/integrations.json`、插件配置、关闭状态的默认值。支持 `search`、`embeddings` 与 `audio`：

| 配置段 | 常用字段 |
|---|---|
| `search` | `baseUrl`、`apiKeyEnv`、`searchPath`、`fetchPath`、`providers`、`fetchProviders`、`providersPath`、`headers`、`timeoutMs`、`fetchTimeoutMs`。 |
| `embeddings` | `baseUrl`、`apiKeyEnv`、`path`、`model`、`provider`、`dimensions`、`queryTask`、`passageTask`、`headers`、`timeoutMs`、`batch`。 |
| `audio` | `baseUrl`、`apiKeyEnv`、`path`、`statusPath`、`model`、`headers`、`timeoutMs`、`maxBytes`。 |

示例统一使用保留的示例域名：

```json
{
  "search": { "baseUrl": "https://gateway.example.com", "apiKeyEnv": "CPA_API_KEY" },
  "embeddings": { "baseUrl": "https://gateway.example.com", "apiKeyEnv": "CPA_API_KEY", "model": "<model>" }
}
```

密钥在请求时从 DSH 凭据库或同名 Host 环境变量读取，不写入配置和日志。只有配置音频端点后才注册语音转写；读取和上传单个文件前需用户确认。HTTP 成功响应仍须包含有效结果，错误响应正文不会回显。

## 会话轮换与交接

软提醒条件为压缩 2 次、上下文 75% 或同文件读取 15 次。硬轮换条件为压缩 3 次、上下文 90% 或 8 轮，仅对有进展的会话生效。轮换前队友提交交接，接替者继承角色模型、权限、预算和已确认路由，未完成任务会改派。阈值由 `workflow.rotation` 配置，`false` 关闭。

## 模型偏好与任务控制

每次确认派活后按能力保存选择。重复选择可预选但仍需确认；近期故障会阻止预选或降低顺序。主控可用 `capability_model_prefs` 查看或清除偏好。

工作台任务控制显示已用/估算步数、临时模型租约和最近操作。临时模型来自后端目录并需确认；租约可恢复或结束。冲突更新不会自动重试。用量还显示每步平均输入与缓存读取占比，并可提示过长上下文轮换。

## 记忆枢纽与 OpenViking

本地记忆枢纽按项目保存笔记、决定、踩坑和交接。新任务会自动召回，`capability_memory_search` 可按需检索。排序结合 BM25 与可选向量相似度，并按时间和使用情况加权；无嵌入时退回全文检索。保存前会清除凭据，过期或被替代的记录会在整理时移除。

可选 OpenViking 集成共享非会话记忆。远程端点必须使用 HTTPS；仅同机地址允许 HTTP。服务不可用时排队待写，仍可使用本地搜索。`OPENVIKING_API_KEY` 只作为凭据变量名，不要把实际密钥写入配置。

### 嵌入接口格式

记忆枢纽以 OpenAI 兼容格式访问接口，默认路径 `/v1/embeddings`：

```http
POST https://gateway.example.com/v1/embeddings
Authorization: Bearer <apiKeyEnv 指定变量中的值>
Content-Type: application/json

{"model":"<model>","input":["文本1","文本2"]}
```

只有配置后才会附带 `provider`、`dimensions` 与查询/入库任务字段。响应须为每个输入提供非空向量。向量关联模型和维度；任一变更后旧向量会排除并在后台重算。

## 团队总览与模型管理

新会话选择预设后，在右侧面板打开团队总览。成员状态、任务板、当前模型、Token 和耗时来自 DSH 会话投影。角色设置和请求详情在初次显示、配置成功变更后或手动刷新时读取，不会持续轮询。
