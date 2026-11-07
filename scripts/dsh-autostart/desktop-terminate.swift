import AppKit
import Foundation

// 只允许向指定安装路径的桌面进程发送系统标准退出请求，不强杀进程。
guard CommandLine.arguments.count == 2,
      let pid = Int32(CommandLine.arguments[1]),
      let app = NSRunningApplication(processIdentifier: pid),
      app.bundleURL?.standardizedFileURL.path == "/Applications/DeepSeek Harness.app" else {
    fputs("目标不是已安装的 DSH 桌面进程\n", stderr)
    exit(2)
}
guard app.terminate() else {
    fputs("系统拒绝桌面退出请求\n", stderr)
    exit(3)
}
