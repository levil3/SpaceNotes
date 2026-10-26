import AppKit

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
let backgroundE2E = ProcessInfo.processInfo.environment[
    "SPACENOTES_BACKGROUND_E2E"
] == "1"
application.setActivationPolicy(backgroundE2E ? .accessory : .regular)
application.run()
