# AI悟空 全能搜索、全局记忆、输入补全配置说明

[English](standalone-setup.md)

这三个扩展有两种使用方式，按机器的安装方式选择。

| 安装方式 | 由谁配置 | 插件页上看到什么 |
|---|---|---|
| 通过 **AI悟空 母舰**（集群）安装 | 母舰。地址、模型、引擎列表和所有 API Key 都由母舰下发到实例，本机无需任何设置。 | 绿色提示「已通过 AI悟空 母舰配置完成」，托管的值以只读方式显示，密钥显示「已由 AI悟空 母舰配置」。母舰没有下发的设置折叠在「可选设置」里。 |
| **单独安装**（`dsh plugin add …`） | 你自己，在插件页（或环境变量、integrations 文件）里配置。 | 普通输入框和只写的密钥行。 |

受母舰管理的机器，请在母舰控制台（模型页 → 托管扩展配置）里修改，不要在实例上改。已锁定的行在本机不能编辑；锁定只是策略约束，不是安全边界。

## 单独安装

```bash
dsh plugin add @aiwuk/search        # 多引擎网页搜索、网页正文读取、音频转写
dsh plugin add @aiwuk/memory        # 显式记忆工具与有界召回
dsh plugin add @aiwuk/autocomplete  # 输入框行内补全
```

然后打开 DSH →「插件」→ 对应扩展，按下表填写并点「保存」。密钥用「设置」按钮写入，保存在 DSH 凭据库里，之后不会再显示。

下表中每个名称也可以作为 DSH 进程的环境变量，或同名 DSH 凭据提供。优先级从高到低：母舰锁定值 › 插件页 › DSH 凭据 › 环境变量 › `integrations.json` › 母舰未锁定默认值 › 内置默认值。

### AI悟空 全能搜索（`@aiwuk/search`）

不配置时只有无需密钥的功能可用，至少要配置一个搜索引擎：

| 目标 | 需要设置 | 说明 |
|---|---|---|
| 自建网关（团队推荐） | `OMNI_SEARCH_ENGINES=custom`、`OMNI_SEARCH_BASE_URL`、密钥 `OMNI_SEARCH_API_KEY`；可选 `OMNI_SEARCH_PROVIDERS_PATH` | 任何支持 `/v1/search` 与 `/v1/web/fetch` 的网关，仅限 https。 |
| 托管搜索引擎 | `TAVILY_API_KEY` 和/或 `BRAVE_API_KEY` | 没有密钥的引擎会被跳过。 |
| 自建 SearXNG | `SEARXNG_URL`（https，本机可用 http），可选 `SEARXNG_API_KEY` | |
| 网页抓取 | `OMNI_FETCH_ENGINES`（`jina`、`tavily`、`custom`），Jina 需要 `JINA_API_KEY` | 默认 `jina`。 |
| 语音转写 | `OMNI_AUDIO_BASE_URL`、密钥 `OMNI_AUDIO_API_KEY` | 每次转写仍需用户逐个文件确认授权。 |

可选打开「让 DSH 网页搜索使用 AI悟空 全能搜索」，让 DSH 内置的 `web_search` 也走它。

### AI悟空 全局记忆（`@aiwuk/memory`）

不配置时完全本地运行（全文检索，数据不出本机）。可选增强：

| 目标 | 需要设置 |
|---|---|
| 语义召回 | `EMBEDDING_BASE_URL`（https）、`EMBEDDING_MODEL`、密钥 `EMBEDDING_API_KEY`；可选 `EMBEDDING_DIMENSIONS` |
| 多台机器共享记忆 | `MEMORY_BACKEND=openviking`、`OPENVIKING_URL`、密钥 `OPENVIKING_API_KEY`；`MEMORY_SHARED_RECALL=none` 表示检索整个共享账号 |

### AI悟空 输入补全（`@aiwuk/autocomplete`）

不需要密钥。默认跟随当前会话的模型。要固定用一个便宜的模型，设置 `AUTOCOMPLETE_ROUTE_MODE=fixed`、`AUTOCOMPLETE_PROVIDER`（DSH 里已配置的提供方 **ID**，不是密钥）和 `AUTOCOMPLETE_MODEL`。

## 验证

- 搜索：新开会话说「联网搜索 <主题>」，`omni_search` 返回结果，或返回指明缺少哪项设置的错误。
- 记忆：让智能体用 `memory_write` 记住一件事，再用 `memory_search` 找回来。
- 补全：在输入框打字后停顿，出现灰色补全文字，按 `Tab` 采纳；它永远不会自动发送。

## 给 AI 智能体的配置指引

用户让智能体（DSH、Claude Code、Codex 等）在单独安装的机器上配置这些扩展时，按以下步骤执行：

1. **先判断模式。** 插件页显示「已通过 AI悟空 母舰配置完成」，或存在 `~/.dsh/aiwuk/managed-config.json`，说明这台机器由母舰管理：不要改本机设置，告诉用户去母舰控制台修改，然后停止。
2. **地址和密钥只能问，不能编。** 问清用户用哪些引擎或服务，以及每个地址。不要猜厂商地址，也不要复用其他项目里的密钥。
3. **密钥绝不写进文件、命令行、日志或对话记录。** 请用户自己把密钥粘贴到插件页的「设置」输入框，或设为 DSH 进程的环境变量。地址、模型 ID、引擎列表不是机密，可以替用户在插件页里填写。
4. **名称必须与上表完全一致。** 列表用英文逗号分隔（`OMNI_SEARCH_ENGINES=brave,custom`）。远程地址必须是 `https://`；只有本机服务（`127.0.0.1`、`localhost`）可以用 `http://`。
5. **修改引擎列表或提供方路径后**，工具定义会在下次读取凭据时重建；如果工具列表没有更新，重新加载插件或重启 DSH。
6. **按上面的「验证」逐项检查**，如实报告工具的真实输出。网关配置成功不代表其上游服务可用；出错时原样转述错误（错误信息里不会包含密钥）。
