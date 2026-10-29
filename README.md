# 能力协作团队（DSH 预设）

DeepSeek Harness（DSH）的多智能体预设：一个主控加若干专业能力队友。它复用 DSH 原生的团队与任务看板，每次模型请求都按队友的**能力**强制路由到对应模型，而不是让所有成员共用会话模型。

- 包名 `@local/dsh-capability-team`，预设 id `capability-team`，显示名“能力协作团队”。
- 模型只按能力映射，与显示名无关。默认角色名（孙权、诸葛亮等）只是示例数据，可以改成任何主题。
- 安装后自动读取你在 DSH 中注册的渠道和模型，生成档位、主模型和同档备选，不写死任何渠道或模型。
- 团队配置可以通过对话调整，用户在 DSH 原生确认框中批准后才保存。

## 目录

- [安装](#安装)
- [环境变量](#环境变量)
- [默认能力与角色](#默认能力与角色)
- [自动匹配模型](#自动匹配模型)
- [对话式配置](#对话式配置)
- [重试与同档容灾](#重试与同档容灾)
- [搜索与免费通道](#搜索与免费通道)
- [运行时细节](#运行时细节)
- [开发与测试](#开发与测试)
- [验证状态与已知限制](#验证状态与已知限制)

## 安装

需要 DSH Desktop（或 `dsh web`）以及 Node.js 22 或更高版本（代码用到了 `AbortSignal.any`）。

1. 克隆仓库到任意目录：
   ```sh
   git clone https://github.com/walke2019/dsh-capability-team.git
   ```
2. 在 DSH profile 目录（默认 `~/.dsh/profiles/<profile>`）的 `package.json` 中加入本地链接依赖，然后在该目录执行 `pnpm install`：
   ```json
   {
     "dependencies": {
       "@local/dsh-capability-team": "link:<克隆目录的绝对路径>"
     }
   }
   ```
   也可以用 DSH 的插件管理安装本地包，效果相同。
3. 本包的 [cordis.patch.yml](cordis.patch.yml) 会注册 `capability-team` 预设。如果想把它设为新会话的默认预设，在 profile 的 `cordis.patch.yml` 里把 `agent-preset-registry` 的 `selectedDefault` 设为 `capability-team`。
4. 完全退出并重启 DSH，然后新建会话，选择“能力协作团队”。已打开的会话不会加载新代码。

验收方法：在新会话里说“读取团队配置”。主控能调用 `capability_team_read`，并返回 `autoMatch` 匹配报告，就说明安装成功。

## 环境变量

所有变量都在 Host（DSH 进程）环境中设置，改完后要重启 DSH。仓库里不含任何密钥或私有地址。

| 变量 | 必需 | 作用 |
|---|---|---|
| `CPA_SEARCH_BASE_URL` | 使用搜索工具时 | 聚合搜索网关地址，只接受不含账号和查询参数的 `https` 地址，例如 `https://gateway.example.com` |
| `CPA_SEARCH_API_KEY` | 使用搜索工具时 | 聚合搜索网关密钥，只从环境读取，不写入配置或日志 |
| `CAPABILITY_TEAM_HOME` | 否 | 项目团队配置的存放目录，默认 `~/.dsh/capability-team-themes` |
| `CAPABILITY_TEAM_OPENCODE_EXECUTABLE` | 否 | 免费通道使用的 OpenCode 原生可执行文件；默认在 npm 全局目录中查找 |

不用搜索工具时，这两个变量可以不设，只有调用 `cpa_search` / `cpa_web_fetch` 时才会报“未配置”。

## 默认能力与角色

[config.js](config.js) 中的 `seed` 是初始默认值，包含三部分：

- **tiers**：档位 → 模型 ID 列表。默认为空，安装后自动填充。
- **capabilities**：能力 → 职责、所需档位、厂商偏好 `prefer`、是否允许检索 `search`。渠道、模型和备选由自动匹配或项目配置提供。
- **roles**：队友内部 id → 显示名、能力、可选职责描述。

| 能力 | 职责 | 所需档位 | 检索 | 厂商偏好 |
|---|---|---|---|---|
| orchestrator（主控） | 意图分析、任务分派、决策与最终交付 | high | 是 | claude, gpt, gemini |
| technical-director | 技术方案、任务拆解、接口契约与技术验收 | upper | 否 | gpt, claude, gemini |
| backend | 服务端、数据库、接口与后端测试 | upper | 否 | gpt, claude, deepseek, qwen, kimi, glm |
| frontend | 页面、组件、交互与前端测试 | medium | 否 | gemini, claude, gpt |
| research | 调用检索工具、核实来源与交叉验证 | medium | 是 | gemini, gpt, grok |
| writer | 文档与交付说明 | low | 否 | gpt, claude, gemini, deepseek, qwen |
| qa | 测试计划、回归、验收、失败复现与证据 | upper | 否 | gpt, claude, gemini |

默认角色表在 `cordis.patch.yml` 的 `bindings` 中，可以直接修改，也可以按项目通过对话改名。合并后的配置会整体校验：

- lead 必须绑定 orchestrator，其他角色不得绑定；
- 显示名不能重复；
- 模型必须属于其档位；
- 不允许未知字段。

静态系统提示词中不含任何角色名、模型或档位。

## 自动匹配模型

[defaults.js](defaults.js) 读取 DSH 中已注册的全部渠道与模型，自动生成默认档位、主模型和同档备选。官方 API、OpenAI 兼容中转和自建网关都可以，不依赖任何特定的渠道名。

1. **归一化**：去掉网关前缀（`anthropic/`、`bai/`、`pro/deepseek-ai/` 等）、`:free` 等后缀和日期快照；`claude-opus-5-5` 与 `claude-opus-5.5` 视为同一模型。
2. **排除**：
   - 非对话模型：图像、视频（含 `gemini-omni-*`）、语音、实时语音（`*-live`）、翻译、向量、审核；
   - 不能当团队成员的模型：不支持工具调用的（`grok-4.20-multi-agent`）、托管智能体（`deep-research`）、角色扮演（`-her`）、需审批的专用模型（`daybreak`、`rosalind`、`gpt-5.6-cyber`）；
   - 带 `free` 的免费或试用变体；
   - 低于各厂商最低版本的旧模型，例如 GPT-4、Claude 3、Gemini 2、Gemma 3。
3. **分档**：规则按厂商命名规律写，不逐个列型号。厂商换代时常改命名，所以当前和上一代的写法都保留。下表为 2026-10-29 的快照，已对照各厂商官方模型页和 OpenRouter 公开目录核对：

   | 档位 | 当前官方 ID（输入/输出，美元每百万 token） | 上一代命名 |
   |---|---|---|
   | high 旗舰 | `gpt-6-astra`（10/50）、`claude-fable-5-1`（10/50）、`claude-opus-5-5`（4/20）、`gemini-4-argon`（2/10，Gemini 4 用代号） | `gpt-5.0~5.5-pro`、`gemini-3.x-pro` |
   | upper 强力 | `gpt-6.1-sol`（2/10）、`claude-sonnet-5-5`（2/10）、`grok-4.7`（2/6）、`kimi-k3.1-pro`、`qwen3.8-max(-prime)`、`glm-5.3(-prime)`、`deepseek-v4-pro`、`mimo-v2.6-pro`、`minimax-m3` | `gpt-5.6-sol`、`gpt-5.x` |
   | medium 均衡 | `gpt-6.1-terra`（1/5）、`gemini-3.8-flash`、`deepseek-flash`（官方无版本名，现为 V4.1-Flash-1017）、`grok-build-0.1`、`glm-5.3-flashx` | `gpt-5.6-terra`、`gpt-5.x-mini`、`gemini-3.6-flash` |
   | low 轻量 | `gpt-6-luna`（0.1/0.5）、`claude-haiku-5-5`、`minimax-m3.1-flash`、`mimo-v2.6-flash`、`qwen3.8-flash`、`glm-5.3-flash`、`gemini-3.5-flash-lite` | `gpt-5.6-luna`、`gpt-5.x-nano` |

   各厂商的特殊规则：
   - **OpenAI**：从 GPT-5.6 起改用 astra/sol/terra/luna 四条线命名，各线独立升级。截至 2026-10-29，官方是 `gpt-6.1-sol`、`gpt-6.1-terra` 和 `gpt-6-luna` 并存，还没有 `gpt-6.1-luna`。规则只比较同一条线内的版本号：将来出现 `gpt-6.1-luna` 时，它会自动成为主模型，`gpt-6-luna` 改作末位备选。
   - **OpenAI `-pro`**：GPT-6 各线都带 `-pro`，与同线价格相同，视为同一模型的推理模式，不算更高一档；GPT-5 时代的 `-pro` 才是旗舰。
   - **DeepSeek**：Flash 是完整的通用模型，只是定价低，归均衡档；其他国产厂商的 `-flash` 是轻量版，归轻量档。官方 API 现在只有 `deepseek-flash` 和 `deepseek-v4-pro` 两个模型名；旧名 `deepseek-v4-flash` 仍能调用，但实际也由 V4.1 Flash 处理。中转站一般带版本号（如 `deepseek-v4.1-flash`），两种写法都能识别。
   - **xAI**：Grok 的版本号只看 `grok-` 后面的数字。`grok-build-0.1` 是编程智能体产品线，版本号自成体系，不当作旧代。
   - **Gemini**：Flash 约 0.8/4，属均衡档。

   通用规则：
   - **代际按用户自己的目录判断**：同一厂商同一档线在目录里有更新的大版本时，旧版降一档并排到最后。例如有 `gemini-4-argon` 时，`gemini-3.1-pro` 降为强力档；但还没有 Gemini 4 Flash，所以 `gemini-3.8-flash` 不降档。只接了上一代渠道的用户，上一代模型仍按原档位使用。
   - **小版本新版优先**：目录里同时有 `deepseek-v4.1-flash` 和 `deepseek-v4-flash` 时，前者作主模型，后者只作最后一个备选。
   - **开源模型**按名称中的参数量（如 `-27b`、`-2.4t`）分档。
   - **`-latest` 别名**会随新版本（含预览版）切换，排在固定版本之后；厂商自己的无版本正式名（如 `deepseek-flash`）是稳定名称，照常排序。
   - **无法识别的模型不猜**，列入报告，由主控询问用户。
4. **分配**：每个能力取所需档位中最合适的模型，依次比较：新一代优先 → 能力的厂商偏好 → 版本号 → 渠道注册顺序。
5. **同档备选**（最多 3 个）：先放同一模型在其他渠道的副本，行为完全一致；再按每家一个放其他厂商的同档模型，分散单一厂商故障。同一模型的模式变体（`-pro`、`-high`、`-thinking`、`-fast` 等）视为同一个，不重复占位。
6. **不降档**：所需档位没有模型时，改用更高档；更高档也没有时，暂用最强的低档，在报告中标为 `below-tier` 并建议补充渠道；完全没有可识别的模型时，该能力不分配，沿用会话模型。

渠道增减后，下一次请求会自动重新匹配，无需重启。项目中显式保存的配置优先于自动匹配。`capability_team_read` 返回的 `autoMatch` 字段给出匹配报告（`matched` / `upgraded` / `below-tier` / `unassigned`）和未识别的模型。

> 分档依据是厂商的官方定位、命名和价格，不是基准测试成绩。新厂商或新命名出现时，需要更新 `defaults.js` 中的 `VENDOR_RULES`。

## 对话式配置

[project-role-theme 技能](skills/project-role-theme/SKILL.md) 指导主控用以下工具调整当前项目的团队：

| 工具 | 谁可用 | 作用 |
|---|---|---|
| `capability_team_read` | 所有成员 | 读取版本、默认值、项目覆盖项、生效结果和自动匹配报告 |
| `capability_model_catalog` | 所有成员 | 读取 DSH 已注册渠道的精确模型 ID，并标注所属档位 |
| `capability_team_save` | 仅主控 | 保存变更，必须携带 `expected_revision` |

可以调整的内容包括：角色改名或整体换主题、职责描述、能力、档位与模型分配、同档备选、容灾策略、新增或移除角色。

`capability_team_save` 的补丁中，对象表示合并，`null` 表示恢复默认，`false` 表示删除。保存流程：

1. 校验合并后的完整配置；
2. 核对新的或改动的模型是否在 DSH 目录中；
3. 通过 DSH 原生提问框把完整差异交给用户；
4. 用户点“保存”后才写入。确认结果取自提问框，不依赖模型自报的参数。

## 重试与同档容灾

[failover.js](failover.js) 在 DSH 请求出错时按以下顺序处理，所有参数都可以通过对话修改项目的 `failover` 策略：

1. **DSH 渠道自带重试**：限流、5xx、超时、网络错误和空响应，默认 5 次，退避上限 10 秒。由渠道配置决定，本插件不干预。
2. **追加重试**：DSH 放弃后，同一模型再重试 `retries` 次（默认 2）。指数退避从 1 秒开始，上限 15 秒，并遵守服务端的 `Retry-After`。额度或凭据错误不在同一渠道重复重试。
3. **同档备选**：按能力 `fallbacks` 的顺序切换，跳过 DSH 未注册的渠道和冷却中的模型。备选必须同档，可以是付费模型；不跨档、不降档。全部失败时报告每个模型的错误。
4. **冷却**：切走的模型冷却 `cooldownMs`（默认 60 秒，可设 5 秒到 10 分钟），到期后新请求自动回到主模型。

上下文超长、内容拒绝等不属于可用性的错误不切换。根据 DSH 源码，只有已开始的流以错误结束时才会触发恢复钩子；请求发出前适配器直接抛错（例如渠道未注册）时，钩子不会执行，所以路由前会先跳过未注册的渠道。切换会记入会话请求头，下一步由本插件显式改回应走的模型。

## 搜索与免费通道

- **`cpa_search` / `cpa_web_fetch`**：调用 `CPA_SEARCH_BASE_URL` 指向的聚合搜索网关，网关需提供 `POST /v1/search` 和 `POST /v1/web/fetch`。
  - 只有能力的 `search` 为 `true` 的成员可用，默认是主控和检索。
  - 抓取只允许公开 HTTP(S) 网页，拒绝本机、私网、云元数据地址和带账号密码的地址。
  - 不跟随重定向；错误时不回显上游正文；响应中出现密钥时拒绝回传。
  - 搜索结果是不可信的外部资料，需要核实引用。
- **`capability_free_task`**：主控把简单的文本分析交给本机 OpenCode 的固定免费模型，并回填原生看板：先创建任务、认领，再写入结果、完成；失败时记录原因并释放任务。
  - 子进程以参数数组启动，不经过 shell，并通过 `OPENCODE_PERMISSION` 禁用全部工具。
  - 免费模型不可用时直接报错，不改用付费模型。
  - 文本仍会发送到 OpenCode 的云端模型，不要用于含密钥或敏感数据的内容。

## 运行时细节

- **动态上下文**：每个团队成员创建时，在自己的作用域注册 `capability-team:roster` 上下文。每一步都会重新生成其中的角色、职责、模型和名册，所以保存后从下一步起生效。
- **请求路由**：每次请求只做一次文件状态检查，内容按修改时间缓存，不查询模型目录。
- **未登记的队友**：请求会失败，并提示主控通过对话登记该角色；系统不猜测模型。
- **非团队会话**：不改写路由。
- **项目归属**：成员首次请求时固定项目，之后切换目录也不会换配置。上级目录已有配置时，子目录视为同一项目。
- **存储位置**：配置存放在 `$CAPABILITY_TEAM_HOME/<项目路径的 sha256>.json`，不写入用户仓库。
- **并发保护**：保存时使用版本号 CAS 和锁文件；锁的所属进程已退出，或锁超过 30 秒，会自动回收。
- **旧格式迁移**：旧版 names/descriptions/routes 格式的文件读取时自动迁移，下次保存时写成新格式。
- **工具参数**：所有工具参数都是标准 JSON Schema（根对象 `type: "object"`，必填项写在 `required` 数组中），并且只使用 DSH 支持的关键字子集。辅助函数见 [tool-schema.js](tool-schema.js)。Claude 等接口会严格校验工具定义，不合法的定义会让整轮请求返回 400。

## 开发与测试

```sh
node --test tests/*.test.mjs
```

测试使用模拟的 ctx、模型目录和提问框，不调用模型、搜索或 Git 写操作。自动匹配用中立的示例目录测试（官方 OpenAI、官方 Anthropic 和带厂商前缀的中转渠道，见 [tests/fixture.mjs](tests/fixture.mjs)），不依赖任何真实用户配置。

| 文件 | 内容 |
|---|---|
| [index.js](index.js) | 插件入口，组装各模块 |
| [roles.js](roles.js) / [team.js](team.js) | 角色绑定、团队上下文与请求路由 |
| [config.js](config.js) | 默认配置、合并与校验 |
| [defaults.js](defaults.js) | 模型归一化、分档与自动匹配 |
| [allocation.js](allocation.js) | 模型目录读取与路由校验 |
| [theme.js](theme.js) / [theme-plugin.js](theme-plugin.js) | 项目配置存储与对话式配置工具 |
| [failover.js](failover.js) | 追加重试、同档容灾与冷却 |
| [search.js](search.js) / [integrations.js](integrations.js) | 聚合搜索工具 |
| [task-bridge.js](task-bridge.js) / [free-worker.mjs](free-worker.mjs) | 免费通道与看板回填 |
| [tool-schema.js](tool-schema.js) | 工具参数 JSON Schema 辅助与校验 |

修改工具参数后，[tests/tool-schema.test.mjs](tests/tool-schema.test.mjs) 会逐个检查已注册工具的 Schema。

## 验证状态与已知限制

已验证：

- 全部单元测试通过；
- 所有工具的参数 Schema 通过了 DSH 自带的校验代码；
- 用 OpenRouter 公开目录（450 多个模型）试跑过自动匹配，结果符合上面的分档规则。

尚未在真实 DSH 会话中验收：

- 按成员注册的上下文是否出现在提示词中；
- 原生提问框的确认保存流程；
- 每次请求的能力路由；
- 真实故障下的容灾切换（需要实际制造失败请求，会产生付费调用）；
- 聚合搜索网关的真实调用。

已知限制：

- 分档基于命名规律和价格，新厂商（如 nvidia、stepfun、cohere）目前会被列为“未识别”，需要手动指定档位。
- 免费变体（`:free`、`-free`）一律不参与自动匹配，也不作备选。
- 原生界面仍显示队友的内部 id，显示名只在模型上下文中生效。

## 许可

[MIT](LICENSE)
