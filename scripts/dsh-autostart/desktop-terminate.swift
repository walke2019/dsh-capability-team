import AppKit
import Foundation

// Send the standard system quit request only to the desktop process at the installed path; never kill it.
guard CommandLine.arguments.count == 2,
      let pid = Int32(CommandLine.arguments[1]),
      let app = NSRunningApplication(processIdentifier: pid),
      app.bundleURL?.standardizedFileURL.path == "/Applications/DeepSeek Harness.app" else {
    fputs("target is not the installed DSH desktop process\n", stderr)
    exit(2)
}
guard app.terminate() else {
    fputs("the system refused the desktop quit request\n", stderr)
    exit(3)
}
