# macOS 桌面实例的中枢重启

## 目的与前置条件

连接器的原生 `instance-restart` 指令通过外部监督器重启 CLI。桌面版还有 Electron 外壳，仅退出后端不足以完成桌面重启。本部署适配器复用原连接器的身份认证、权限、回执、模型和插件下发，不修改 DSH 安装包或连接器底座。

仅适用于 macOS、已安装的 DeepSeek Harness 桌面版和 `@aiwuk/connector-bundle` 1.0.0。Linux 与 Windows 无需安装。要求 Python 3、Node 24.9+、Xcode Command Line Tools，且用户已登录图形会话。连接器实际使用 App 自带的 Node 运行时。

## 安装

先配置并验证原连接器，再从仓库根目录执行：

```bash
# scripts/dsh-autostart/install-managed-desktop.py
python3 scripts/dsh-autostart/install-managed-desktop.py
```

安装器把监督器和适配器复制到当前用户 `.dsh-autostart/managed/`，编译只发送标准退出请求的 AppKit 辅助程序，并备份桌面 profile 与登录项。原连接器条目保留并停用，新条目显式插入，在 Cordis 隔离作用域中提供退出接口。覆盖条目的名称用于匹配，不能直接改名来替换实现。

安装器会沿用唯一的现有桌面登录项，也可用 `DSH_DESKTOP_AGENT_LABEL` 指定标识；以下示例为全新安装的默认标识，已有安装以安装器输出为准。正常退出 DSH 后，在终端载入单个登录项：

```bash
# ~/Library/LaunchAgents/io.aiwuk.dsh.mac-desktop.plist
launchctl bootout "gui/$(id -u)/io.aiwuk.dsh.mac-desktop"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.aiwuk.dsh.mac-desktop.plist"
```

首次安装若旧登录项不存在，第一条命令会提示未找到服务，可继续第二条。不要卸载整个用户图形域。

## 行为与验收

中枢发送原生指令，连接器检查权限并刷新回执后，通过当前实例专用的本机套接字请求监督器。监督器校验令牌和桌面父进程 PID，再请求整个 App 优雅退出。旧进程退出后只拉起一次，新进程使用新令牌。

- 手动退出保持退出，意外崩溃也不自动循环重启。
- 退出超过 45 秒或系统拒绝退出时，不强杀、不启动第二个实例，中枢应显示重启未确认。
- 套接字只允许当前用户读写，不开放 TCP 端口；令牌不写入状态文件。
- 监督器握手完成且退出服务发布后，Cordis 才启动连接器子插件。

```bash
# ~/.dsh-autostart/desktop-supervisor.json
cat "$HOME/.dsh-autostart/desktop-supervisor.json"

# tests/desktop-supervisor.test.mjs
node --test tests/desktop-supervisor.test.mjs
```

从中枢重启后，必须同时看到旧 PID 退出、新 PID 出现、中枢确认新认证连接，以及远程工作区恢复。仅收到“已接受”不代表完成。

手动退出后，通过监督器重新打开。直接点击原 App 会绕过托管启动，不能获得中枢重启能力：

```bash
# ~/.dsh-autostart/managed/desktop-supervisor.mjs
node "$HOME/.dsh-autostart/managed/desktop-supervisor.mjs" --start
```

如果监督器未运行，使用 `launchctl kickstart` 启动上述单个登录项。监督器拒绝接管已独立启动的 App，应先正常退出原 App。

## 回滚与排错

备份位于当前用户 `.dsh-autostart/backup/managed-<时间>/`。正常退出桌面端、卸载上述单个登录项后，将备份中的 profile 和 plist 恢复原位，再重新载入。保留备份，不删除会话或凭据。

进入实例后持续重连时，另行核对 DSH 的 `trustedHosts`：中枢主域名和实例子域名必须分别声明，主域名不会自动包含子域名。保留身份鉴权和对其它 Host 的拒绝，不使用通配放行。
