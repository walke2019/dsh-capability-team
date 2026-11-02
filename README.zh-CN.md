# DSH 能力协作团队

面向 DeepSeek Harness 的可配置多智能体团队预设：按能力分配模型，在 DSH 原生协作之上提供项目角色、模型策略与实时工作台。

![MIT](https://img.shields.io/badge/license-MIT-blue.svg) ![DSH 0.2.1-rc.5](https://img.shields.io/badge/DSH-0.2.1--rc.5-6f42c1.svg) ![Node >= 22](https://img.shields.io/badge/Node-%3E%3D%2022-339933.svg)

[English](README.md) | **简体中文**

## ✨ 核心优势

- 按队友能力与档位分配模型，不让所有成员共用主控模型。
- 自动匹配已注册模型，并仅在同档模型间容灾切换。
- 通过带确认保护的对话式工作流调整角色、职责与主题。
- 在工作台集中查看团队活动、任务、用量和模型管理。
- 按角色应用工具、文件路径与沙箱权限策略。
- 将请求转为明确派活计划，并在 DSH 原生看板跟踪执行。
- 支持计划式会话轮换与共享记忆集成。
- 统计 Token 用量，并可设置角色预算。

## DSH 原生团队与本预设的分工

| DSH 原生能力 | 本预设增强 |
|---|---|
| 队友生命周期、消息、等待与中断 | 按能力分配模型与同档容灾 |
| 共享任务看板与依赖 | 项目角色、派活策略、写入范围限制与预算 |
| 团队会话与用量投影 | 团队工作台、角色配置和模型管理 |
| 权限预设与原生确认界面 | 按角色设置沙箱策略与配置变更确认 |

## 🚀 功能特性

### 模型路由与容灾
- 按能力和档位自动匹配已注册模型。
- 支持全局模型排除与可配置的同档备选。
- 支持长上下文路由与冷却期重试。

### 团队配置与角色
- 配置项目角色名称、能力、职责和适用场景。
- 对话式修改经校验并由 DSH 原生确认后保存。
- 按角色设置工具、路径、命令和权限预设。

### 工作流与协作
- 支持委派、主控直办及符合条件的文本任务计划。
- 接入原生任务板、依赖关系与范围约束。
- 可启用队友计划审批、派活确认和会话交接。

### 团队工作台
- 总览成员、任务、活动、用量和模型。
- 提供角色会话视图与任务控制。
- 不再提供集成页或设置界面；集成配置只读。

### 独立工具与记忆
- `packages/omni-search`（`@local/dsh-omni-search`）无界面，向所有会话提供厂商中立的多引擎搜索（Tavily、Brave、SearXNG 或自定义网关，自动故障切换）、网页抓取（默认经 Jina Reader 免密钥）和语音转写：`omni_search`、`omni_fetch`、`omni_search_providers`、`omni_transcribe`、`omni_transcribe_status`。
- `packages/global-memory` 零配置即可纯本地运行；可选 OpenAI 兼容嵌入与可插拔共享后端（默认 `local`，可选 `openviking`）。团队插件的记忆枢纽读取同一份配置。
- 安装步骤和配置格式见[配置参考](docs/configuration.zh-CN.md)及各插件 README。

## 快速开始

### 前置条件

- 包含原生实验性 Agent Teams 包的 DSH Desktop 或 `dsh web`（已对照 0.2.1-rc.5 验证）。
- Node.js 22 或更高版本。

请在宿主 profile 中启用官方 `@deepseek-ai/dsh-experimental-agent-team-profile` bundle，由其提供原生团队服务、按成员作用域安装的工具及团队 UI。本 bundle 不插入这些全局组件：Cordis 对重复 ID 选择最后一项，不保留早期配置，在此插入默认值可能重置宿主自定义参数。缺少官方组件时，团队能力仍未就绪；请查看已有运行时诊断并启用官方 bundle，不要假设本预设自动安装。原生工具安装器要求团队成员身份，因此 standard 智能体不会获得团队工具。

可选的已安装运行时回归：将 `DSH_NATIVE_ASAR` 指向可读的 Desktop `app.asar`，运行 `node --test tests/team-mount.test.mjs`。测试执行已安装的 YAML 解析器、patch 合成、loader group update 及原生工具安装器成员门禁，不修改或重启宿主。不设置该变量时，两项原生检查明确跳过；这不是完整宿主启动或浏览器测试。

### 安装与启用

1. 克隆本仓库。
2. 在 DSH 插件管理器中通过 `install_bundle` 安装仓库目录。
3. 若安装器提示需要重启，请重启 DSH。
4. 新建会话并选择“能力协作团队”（`capability-team`）。如需设为默认，在 Host 配置中将预设注册表的 `selectedDefault` 设为 `capability-team`。

### 最小配置

先在 DSH 注册渠道与模型，预设会据此匹配。右侧面板没有集成页，配置只读，可通过配置文件、Host 环境变量或 DSH 凭据库提供。在 DSH 插件管理器安装并启用 `packages/omni-search`、`packages/global-memory` 目录或对应 `.tgz` 包，然后重启 DSH。`omni-search` 和 `global-memory` 的细节见对应 README。

配置文件位置为 `%USERPROFILE%/.dsh/capability-team-themes/integrations.json`，可用 `CAPABILITY_TEAM_HOME` 覆盖目录。示例：

```json
{
  "integrations": {
    "search": { "engines": ["tavily", "searxng"], "fetchEngines": ["jina"], "searxngUrl": "http://127.0.0.1:8888" },
    "audio": { "baseUrl": "https://gateway.example.com", "apiKeyEnv": "OMNI_AUDIO_API_KEY" },
    "embeddings": { "baseUrl": "https://gateway.example.com", "apiKeyEnv": "EMBEDDING_API_KEY", "model": "<model>" },
    "memory": { "backend": "openviking", "url": "https://memory.example.com", "apiKeyEnv": "OPENVIKING_API_KEY" }
  }
}
```

零配置：`omni_fetch` 无需任何密钥（Jina Reader），记忆完全本地，`omni_search` 只需设置 `TAVILY_API_KEY`、`BRAVE_API_KEY` 或 `SEARXNG_URL` 之一。其他环境变量：`OMNI_SEARCH_BASE_URL` / `OMNI_SEARCH_API_KEY`（自定义网关）、`JINA_API_KEY`（可选）、`OMNI_AUDIO_BASE_URL` / `OMNI_AUDIO_API_KEY`、`EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` / `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS`、`OPENVIKING_URL`。密钥只放在 DSH 凭据库或对应环境变量中；勿写入配置。`CAPABILITY_TEAM_OPENCODE_EXECUTABLE` 和 `CAPABILITY_TEAM_OPENCODE_MODELS` 仍可配置免费文本任务通道。

### 从 cpa-tools 迁移

破坏性变更：旧名称不再识别。

| 旧 | 新 |
|---|---|
| `packages/cpa-tools` | `packages/omni-search`（`@local/dsh-omni-search`，patch id `omni-search`） |
| `cpa_search`、`cpa_fetch`、`cpa_search_providers` | `omni_search`、`omni_fetch`、`omni_search_providers` |
| `cpa_transcribe`、`cpa_transcribe_status` | `omni_transcribe`、`omni_transcribe_status` |
| `CPA_SEARCH_BASE_URL` / `CPA_SEARCH_API_KEY` | `OMNI_SEARCH_BASE_URL` / `OMNI_SEARCH_API_KEY`（`custom` 引擎） |
| `CPA_AUDIO_BASE_URL` / `CPA_AUDIO_API_KEY` | `OMNI_AUDIO_BASE_URL` / `OMNI_AUDIO_API_KEY` |
| `CPA_EMBED_*` | `EMBEDDING_*`（新名未设置时仍读取旧名） |

新建团队会话后，可以说：“读取团队配置。”主控会给出当前角色和模型匹配概览。

## 配置

大多数设置可通过团队工作台或团队配置工具管理。以下示例仅用于说明结构，实际字段和值以团队配置模式与已注册模型为准：

```json
{ "capabilities": { "writer": { "tier": "low", "search": false } } }
```

完整字段说明见[配置参考](docs/configuration.zh-CN.md)。

## 技术栈

- **运行时：** Node.js 22+、DSH 插件生命周期与 Cordis 集成。
- **团队服务：** DSH `ctx.agentTeams` API 与原生任务看板工具。
- **工作台：** `client/` 中的 JavaScript 源码构建为 `client.js`。
- **测试：** Node.js 内置 `node:test` 测试运行器。
- **可选集成：** 搜索引擎（Tavily、Brave、SearXNG、自定义网关）、Jina Reader 抓取、OpenAI 兼容嵌入，以及可插拔共享记忆后端（OpenViking）。

## 项目结构

| 路径 | 说明 |
|---|---|
| `client/` | 工作台客户端源码模块。 |
| `scripts/` | 客户端打包与项目检查脚本。 |
| `tests/` | Node.js 测试套件与夹具。 |
| `skills/` | 项目角色与主题指导技能。 |
| `locale/` | 英文和中文界面文案。 |
| `config.js`、`defaults.js`、`roles.js` | 团队默认值、模型匹配和角色定义。 |
| `cordis.patch.yml` | DSH 预设与插件注册配置。 |
| `client.js` | DSH 加载的生成版工作台文件。 |
| `index.js`、`ui.js` | 插件与 UI 入口。 |

## 文档索引

- [配置参考](docs/configuration.zh-CN.md)
- [开发指南](docs/development.zh-CN.md)
- [团队与仓库规范](AGENTS.md)

## 许可

MIT，详见 [LICENSE](LICENSE)。


