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
- 管理可选搜索和记忆服务设置。

### 记忆与集成
- 可选混合记忆，支持嵌入后端与 OpenViking。
- 搜索和抓取端点可配置，不在插件中写死。
- 密钥保存在 Host 环境变量中，配置只记录变量名。

## 快速开始

### 前置条件

- 启用原生智能体团队服务的 DSH Desktop 或 `dsh web`。
- Node.js 22 或更高版本。

### 安装与启用

1. 克隆本仓库。
2. 在 DSH 插件管理器中通过 `install_bundle` 安装仓库目录。
3. 若安装器提示需要重启，请重启 DSH。
4. 新建会话并选择“能力协作团队”（`capability-team`）。如需设为默认，在 Host 配置中将预设注册表的 `selectedDefault` 设为 `capability-team`。

### 最小配置

先在 DSH 注册渠道与模型，预设会据此匹配。可选集成变量在 DSH Host 环境设置，修改后重启 DSH：

| 变量 | 用途 |
|---|---|
| `CPA_SEARCH_BASE_URL` | 可选搜索端点；示例地址使用 `https://gateway.example.com`。 |
| `CPA_SEARCH_API_KEY` | 启用搜索时使用的凭据变量名。 |
| `CPA_EMBED_BASE_URL`、`CPA_EMBED_MODEL`、`CPA_EMBED_DIMENSIONS` | 可选嵌入端点与模型设置。 |
| `CPA_EMBED_API_KEY` | 启用向量记忆时使用的凭据变量名。 |
| `CAPABILITY_TEAM_HOME` | 可选的项目团队配置存放位置。 |
| `CAPABILITY_TEAM_OPENCODE_EXECUTABLE`、`CAPABILITY_TEAM_OPENCODE_MODELS` | 可选文本任务通道配置。 |

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
- **可选集成：** 可配置的搜索/嵌入 HTTP 服务与 OpenViking 记忆。

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


