# 配置参考

本文说明项目配置、模型分配、权限、协作策略与可选集成。可用 `capability_team_read` 查看生效配置，并通过 `capability_team_save` 或团队工作台修改。

## 环境变量

在 DSH Host 进程环境设置变量，修改后重启 DSH。

| 变量 | 用途 |
|---|---|
| `TAVILY_API_KEY` | `tavily` 搜索引擎密钥（`tavily` 抓取引擎同用）。 |
| `BRAVE_API_KEY` | `brave` 搜索引擎密钥。 |
| `SEARXNG_URL` | `searxng` 引擎的 SearXNG 实例地址；须 https，仅 127.0.0.1 / localhost / [::1] 可用 http。可选密钥 `SEARXNG_API_KEY`。 |
| `JINA_API_KEY` | 默认 `jina` 抓取引擎的可选密钥（不设也能抓取）。 |
| `OMNI_SEARCH_BASE_URL` / `OMNI_SEARCH_API_KEY` | `custom` 搜索/抓取网关地址与密钥，示例：`https://gateway.example.com`。 |
| `OMNI_AUDIO_BASE_URL` / `OMNI_AUDIO_API_KEY` | 语音转写接口地址与密钥。 |
| `EMBEDDING_BASE_URL` | 可选 OpenAI 兼容嵌入接口地址（旧名回退 `CPA_EMBED_BASE_URL`）。 |
| `EMBEDDING_MODEL` | 可选嵌入模型（旧名回退 `CPA_EMBED_MODEL`）。 |
| `EMBEDDING_DIMENSIONS` | 可选向量维度（旧名回退 `CPA_EMBED_DIMENSIONS`）。 |
| `EMBEDDING_API_KEY` | 嵌入凭据的默认名称（旧名回退 `CPA_EMBED_API_KEY`）。 |
| `OPENVIKING_URL` / `OPENVIKING_API_KEY` | `openviking` 记忆后端地址与可选密钥。 |
| `MEMORY_SHARED_RECALL` | `current`（默认）全局记忆只检索本机；`none` 同时跨项目、跨实例检索共享后端。覆盖 `integrations.memory.sharedRecall`。 |
| `CAPABILITY_TEAM_HOME` | 团队配置存储目录，默认 `~/.dsh/capability-team-themes`。 |
| `CAPABILITY_TEAM_OPENCODE_EXECUTABLE` | 可选 OpenCode 可执行文件路径；未设置时从 `PATH` 查找。 |
| `CAPABILITY_TEAM_OPENCODE_MODELS` | 可选 OpenCode 模型目录路径。 |

集成配置可来自 DSH“插件”页的设置表单、DSH 凭据库、Host 环境变量或集成配置文件，优先级见[独立工具与集成配置](#独立工具与集成配置)。密钥值不得写入配置文件。

## 默认能力与角色

`config.js` 中的初始 `seed` 包含档位、能力和角色绑定：

- **档位**：档位与候选模型 ID 的映射，由运行时目录生成匹配默认值。
- **能力**：职责、所需档位、厂商偏好、搜索权限，以及可选的模型、备选、预算和权限策略。
- **角色**：稳定内部 ID 到显示名、能力的绑定；显示名只用于展示。

默认能力包括主控、技术负责人、后端、前端、检索、写作和 QA。主控必须绑定 orchestrator；显示名必须唯一；未知字段会被拒绝。指定模型只要在 DSH 目录中且未被禁用即可选择：自动匹配未能分级的模型会按所指定能力的档位登记。有两类限制：已归入其他档位的模型不能跨档指定；非聊天模型和免费变体不能作为角色路由，确需使用时要先把它明确写进 `tiers`。已保存的路由不会因目录变化失效：模型被重新分档后路由继续可用，并在 `capability_team_read` 的 `effective.tierDrift` 中列出，新增或改动的路由仍按上述规则校验。`whenToUse` 描述何时应分配该角色。

## 自动模型匹配

匹配器读取 DSH 已注册的渠道与模型 ID，不依赖特定渠道名称。系统会归一化别名和网关前缀，并排除非对话模型、不支持团队工具调用的模型、免费/试用变体及低于厂商版本下限的模型。

档位规则基于模型命名与厂商代际模式。匹配顺序考虑代际、能力偏好、版本及渠道注册顺序。全局禁用策略在匹配与实际路由时生效。最多选择三个同档备选，优先同模型的其他渠道，再考虑其他厂商的模型。不会静默降档：没有合格模型时能力保持未分配并阻止请求。未识别的模型会报告而不会猜测。

渠道目录变化后后续请求会重新匹配。

### 单模型模式

模型目录无法满足某能力的档位时（例如只配置了一个模型），该能力的角色请求会被阻止，报错中会提示单模型模式。主控调用 `capability_team_save` 并传 `single_model: "use-default"` 开启：插件读取 DSH 当前默认模型（设置 → 模型），只有在用户于原生配置确认框中批准后，才把 `singleModel: { provider, model, acceptedAt }` 写入项目配置。开启期间，所有未分配路由的能力对应的角色统一使用该模型；已分配路由的角色保持原路由。此模式没有备选（容灾仍只允许同档），模型失败会直接报告。角色卡片、角色视图与战报显示“单模型模式”标记。传 `single_model: "off"` 关闭（同样需确认），之后未分配角色恢复为阻止请求。显式保存的项目配置优先于自动匹配。`capability_team_read` 返回 `autoMatch` 报告，包括 matched、upgraded、below-tier、unassigned 和未识别模型。

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

主控通过 `capability_dispatch_plan` 将请求分类为 `delegate`、`free` 或 `direct`。委派任务需包含角色、具体任务和验收条件；免费文本任务只使用允许的免费模型与工具；直办次数由 `directBudget` 限制。用户明确要求主控亲自完成时，主控传 `userRequested: true`，用户会看到允许或拒绝的确认卡片，无卡片时回退到 DSH 问答框。允许后到用户下一条消息前不限次数，文件规则与权限仍然生效。该字段本身只触发询问，不能解除限制。

| 工作流字段 | 含义 |
|---|---|
| `mode` | `enforce`、`remind` 或 `off`。 |
| `analysisBudget` | 制定计划前的只读分析额度。 |
| `directBudget` | direct 模式下主控自行执行的上限；用户在确认卡片上允许后，本轮不受此限。 |
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

## 独立工具与集成配置

可通过插件设置表单、`integrations.json`、Host 环境变量或 DSH 凭据库提供配置。两个独立插件导出 schemastery `Config`（可选 peer `@deepseek-ai/schemastery >= 3.18.4`，由 DSH 提供），其实时字段在 DSH“插件”页对应插件的详情中显示为表单（由本包 Web 客户端按包名渲染）。表单中填写的字段优先于凭据、环境变量和文件；留空则沿用下层配置，已有部署不受影响。`*KeyEnv` 字段填写 DSH 凭据或环境变量的名称，而不是密钥本身。

| 插件 | 表单字段 | 对应集成字段 |
|---|---|---|
| `@aiwuk/search` | `engines`、`fetchEngines`、`searxngUrl`、`baseUrl`、`tavilyKeyEnv`、`braveKeyEnv`、`searxngKeyEnv`、`jinaKeyEnv`、`apiKeyEnv` | `search.*`（同名） |
| `@aiwuk/search` | `audioBaseUrl`、`audioKeyEnv` | `audio.baseUrl`、`audio.apiKeyEnv` |
| `@aiwuk/memory` | `embeddingBaseUrl`、`embeddingModel`、`embeddingKeyEnv` | `embeddings.baseUrl`、`.model`、`.apiKeyEnv` |
| `@aiwuk/memory` | `memoryBackend`、`memoryUrl`、`memoryKeyEnv` | `memory.backend`、`.url`、`.apiKeyEnv` |

若残留的旧版 schemastery（无 `.volatile()`）遮蔽了 DSH 自带版本，插件会拒绝加载，并在错误中指明需删除的目录。在 DSH 插件管理器安装并启用 `packages/omni-search` 与 `packages/global-memory` 目录（或对应 `.tgz` 包），然后重启 DSH。团队插件的记忆枢纽也读取 `global-memory` 使用的同一份配置。

`omni-search`（`@aiwuk/search`）无界面，向所有会话提供 `omni_search`、`omni_fetch`、`omni_search_providers`、`omni_transcribe`、`omni_transcribe_status`，名称刻意区别于 DSH 内置的 `web_search` / `web_fetch`；团队插件中 `search: false` 的角色不能调用这五个工具。插件/工具未安装或未启用时，应如实报告。`global-memory` 读取嵌入和记忆后端配置。

### 搜索与抓取引擎

`search.engines` 为有序列表，取值 `tavily`、`brave`、`searxng`、`custom`；省略时（auto）按此顺序使用所有已配置引擎。可用性故障（超时、网络错误、HTTP 401/403/404、429、5xx 或 200 无结果）切换到下一引擎；输入无效（HTTP 400/413/422）不切换。`search.fetchEngines` 为有序列表，取值 `jina`、`tavily`、`custom`，默认 `["jina"]`（免密钥）。直连引擎使用 `engineTimeoutMs`（默认 30 秒）；自定义网关沿用 `timeoutMs` / `fetchTimeoutMs`（默认 120 秒）。密钥名可用 `tavilyKeyEnv`、`braveKeyEnv`、`searxngKeyEnv`、`jinaKeyEnv` 与 `apiKeyEnv`（custom）改名。`custom` 引擎保留通用网关协议（`baseUrl`、`searchPath`、`fetchPath`、`providersPath`、`headers`、`providers`、`fetchProviders`）；仅在启用 `custom` 时工具才有 `provider` 参数。零配置：抓取无需密钥；搜索需要一个引擎密钥或 SearXNG 地址。各引擎详表见 [packages/omni-search/README.md](../packages/omni-search/README.md)。

配置文件为 `%USERPROFILE%/.dsh/capability-team-themes/integrations.json`，可用 `CAPABILITY_TEAM_HOME` 覆盖目录。示例：

```json
{
  "integrations": {
    "search": { "engines": ["tavily", "searxng", "custom"], "fetchEngines": ["jina", "custom"], "searxngUrl": "http://127.0.0.1:8888", "baseUrl": "https://gateway.example.com", "apiKeyEnv": "OMNI_SEARCH_API_KEY" },
    "audio": { "baseUrl": "https://gateway.example.com", "apiKeyEnv": "OMNI_AUDIO_API_KEY" },
    "embeddings": { "baseUrl": "https://gateway.example.com", "apiKeyEnv": "EMBEDDING_API_KEY", "model": "<model>" },
    "memory": { "backend": "openviking", "url": "https://memory.example.com", "apiKeyEnv": "OPENVIKING_API_KEY" }
  }
}
```

也可在 DSH Host 环境设置上表中的变量（`OMNI_SEARCH_BASE_URL`、`SEARXNG_URL`、`OMNI_AUDIO_BASE_URL`、`EMBEDDING_BASE_URL`、`OPENVIKING_URL` 等），环境变量优先于文件。优先级：设置表单 › DSH 凭据 › 环境变量 › `integrations.json` › 默认值。密钥仅保存在 DSH 凭据库或对应环境变量中，不要写入配置文件；每个密钥名先查 DSH 凭据库，再查环境变量。字段详情见两个独立插件的 README。

### 从 DSH 凭据库读取设置

每个单字段覆盖变量也可以作为同名 DSH 凭据保存（适合由集群管理端统一下发设置，客户端无需本地配置）。凭据优先于同名环境变量；非法值被忽略且不会记录日志；来源显示为 `credential:<名称>`。名称：`OMNI_SEARCH_BASE_URL`、`OMNI_SEARCH_ENGINES`、`OMNI_FETCH_ENGINES`（逗号分隔列表）、`OMNI_SEARCH_PROVIDERS_PATH`、`SEARXNG_URL`、`OMNI_AUDIO_BASE_URL`、`EMBEDDING_BASE_URL`、`EMBEDDING_MODEL`、`EMBEDDING_DIMENSIONS`（旧名 `CPA_EMBED_*`）、`MEMORY_BACKEND`、`OPENVIKING_URL`、`MEMORY_SHARED_RECALL`。这些设置改变工具结构时，`omni-search` 会重新注册搜索工具。

### 从 cpa-tools 迁移

破坏性变更：旧名称不再识别。

| 旧 | 新 |
|---|---|
| `packages/cpa-tools` | `packages/omni-search`（`@aiwuk/search`，patch id `omni-search`） |
| `cpa_search`、`cpa_fetch`、`cpa_search_providers`、`cpa_transcribe`、`cpa_transcribe_status` | `omni_search`、`omni_fetch`、`omni_search_providers`、`omni_transcribe`、`omni_transcribe_status` |
| `CPA_SEARCH_BASE_URL` / `CPA_SEARCH_API_KEY` | `OMNI_SEARCH_BASE_URL` / `OMNI_SEARCH_API_KEY`（`custom` 引擎） |
| `CPA_AUDIO_BASE_URL` / `CPA_AUDIO_API_KEY` | `OMNI_AUDIO_BASE_URL` / `OMNI_AUDIO_API_KEY` |
| `CPA_EMBED_*` | `EMBEDDING_*`（新名未设置时仍读取旧名） |

## 会话轮换与交接

软提醒条件为压缩 2 次、上下文 75% 或同文件读取 15 次。硬轮换条件为压缩 3 次、上下文 90% 或 8 轮，仅对有进展的会话生效。轮换前队友提交交接，接替者继承角色模型、权限、预算和已确认路由，未完成任务会改派。阈值由 `workflow.rotation` 配置，`false` 关闭。

## 模型偏好与任务控制

每次确认派活后按能力保存选择。重复选择可预选但仍需确认；近期故障会阻止预选或降低顺序。主控可用 `capability_model_prefs` 查看或清除偏好。

工作台任务控制显示已用/估算步数、临时模型租约和最近操作。临时模型来自后端目录并需确认；租约可恢复或结束。冲突更新不会自动重试。用量还显示每步平均输入与缓存读取占比，并可提示过长上下文轮换。

## 记忆枢纽与共享后端

本地记忆枢纽按项目保存笔记、决定、踩坑和交接。新任务会自动召回，`capability_memory_search` 可按需检索。排序结合 BM25 与可选向量相似度，并按时间和使用情况加权；无嵌入时退回全文检索。保存前会清除凭据，过期或被替代的记录会在整理时移除。

本地存储始终是唯一事实来源。`integrations.memory.backend` 选择可插拔共享后端（`memory-backends.js`）：`local`（默认）仅保存在本机；`openviking` 将非会话记忆同步到 OpenViking 服务（`memory.url` / `OPENVIKING_URL`，可选 `account`、`user`）。远程端点必须使用 HTTPS；仅同机地址允许 HTTP。服务不可用时持久排队待写，仍可使用本地搜索。`OPENVIKING_API_KEY` 只作为凭据变量名，不要把实际密钥写入配置。新增后端只需一个 `memory-<id>.js` 文件、`MEMORY_BACKEND_REGISTRY` 中一行，以及在 `MEMORY_BACKENDS` 中加入 id，详见 [packages/global-memory/README.md](../packages/global-memory/README.md)。

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
