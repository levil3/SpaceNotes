import AppKit
import SpaceNotesCore
import WebKit

private final class BackgroundE2EWindow: NSWindow {
    override func constrainFrameRect(
        _ frameRect: NSRect,
        to screen: NSScreen?
    ) -> NSRect {
        frameRect
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let smokeTest = CommandLine.arguments.contains("--smoke-test")
    private let backgroundE2E = ProcessInfo.processInfo.environment[
        "SPACENOTES_BACKGROUND_E2E"
    ] == "1"
    private var window: NSWindow?
    private var sidecar: SidecarManager?
    private var client: SidecarClient?
    private var navigationDelegate: NavigationDelegate?
    private weak var webView: WKWebView?
    private var messageHandler: HostMessageHandler?
    private var assetHandler: NotesAssetSchemeHandler?
    private var retryPolicy = SidecarRetryPolicy()
    private var e2eStarted = false
    private var isTerminating = false
    private var developmentOrigin: URL? {
        guard
            let value = ProcessInfo.processInfo.environment[
                "SPACENOTES_DEV_ORIGIN"
            ],
            let url = URL(string: value),
            ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
            url.host != nil
        else {
            return nil
        }
        return url
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if backgroundE2E {
            appendDiagnostic("background-e2e=true")
        }
        configureMainMenu()
        startSidecar()
    }

    func applicationShouldTerminateAfterLastWindowClosed(
        _ sender: NSApplication
    ) -> Bool {
        false
    }

    func applicationShouldSaveSecureApplicationState(
        _ app: NSApplication
    ) -> Bool {
        false
    }

    func applicationShouldRestoreSecureApplicationState(
        _ app: NSApplication
    ) -> Bool {
        false
    }

    func applicationShouldHandleReopen(
        _ sender: NSApplication,
        hasVisibleWindows flag: Bool
    ) -> Bool {
        appendDiagnostic("window-reopened-from-dock-request")
        if let window {
            appendDiagnostic("window-reopened-existing-instance")
            window.makeKeyAndOrderFront(nil)
        } else if let client {
            showWindow(client: client)
        }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        isTerminating = true
        sidecar?.stop()
        sidecar = nil
    }

    private func startSidecar() {
        guard let resourceURL = Bundle.main.resourceURL else {
            presentFatal("应用资源目录缺失。")
            return
        }
        let settingsURL = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Levil Notes", isDirectory: true)
            .appendingPathComponent("settings.json")
        let token = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        appendDiagnostic(
            "sidecar-token-fingerprint=\(LaunchTokenPayload.fingerprint(of: token))"
        )
        let configuration = SidecarManager.Configuration(
            executableURL: resourceURL.appendingPathComponent("node"),
            scriptURL: resourceURL
                .appendingPathComponent("sidecar", isDirectory: true)
                .appendingPathComponent("electron", isDirectory: true)
                .appendingPathComponent("sidecar-entry.cjs"),
            webRootURL: resourceURL.appendingPathComponent("web", isDirectory: true),
            settingsURL: settingsURL,
            token: token,
            parentPID: ProcessInfo.processInfo.processIdentifier,
            allowedOrigins: developmentOrigin.map { [$0.absoluteString] } ?? []
        )
        let manager = SidecarManager(configuration: configuration)
        sidecar = manager
        manager.start(
            onReady: { [weak self] baseURL in
                guard let self else { return }
                self.appendDiagnostic(
                    "sidecar-ready-port=\(baseURL.port ?? -1)"
                )
                if self.smokeTest {
                    print(
                        "SMOKE_READY arch=\(Self.architecture) "
                            + "port=\(baseURL.port ?? -1)"
                    )
                    fflush(stdout)
                    NSApplication.shared.terminate(nil)
                    return
                }
                let client = SidecarClient(baseURL: baseURL, token: token)
                self.client = client
                if self.webView != nil {
                    self.reload(client: client)
                } else {
                    self.showWindow(client: client)
                }
            },
            onExit: { [weak self] status in
                guard let self, !self.isTerminating else { return }
                self.appendDiagnostic("sidecar-exit-status=\(status)")
                let diagnostics = self.sidecar?.diagnosticSummary ?? ""
                if !diagnostics.isEmpty {
                    self.appendDiagnostic("sidecar-exit-stderr=\(diagnostics)")
                }
                self.sidecar = nil
                if self.retryPolicy.consumeRestart() {
                    self.appendDiagnostic("sidecar-restart-attempt=1")
                    self.startSidecar()
                    return
                }
                self.appendDiagnostic("sidecar-restart-exhausted")
                self.presentFatal(
                    "后台 sidecar 连续退出（状态 \(status)）。请查看日志后重新启动应用。"
                )
            }
        )
    }

    private static var architecture: String {
        #if arch(arm64)
        "arm64"
        #elseif arch(x86_64)
        "x86_64"
        #else
        "unknown"
        #endif
    }

    private func showWindow(client: SidecarClient) {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        let controller = WKUserContentController()
        configuration.userContentController = controller

        let contentRect = NSRect(x: 0, y: 0, width: 1420, height: 900)
        let styleMask: NSWindow.StyleMask = [
            .titled,
            .closable,
            .miniaturizable,
            .resizable,
            .fullSizeContentView
        ]
        let window: NSWindow = backgroundE2E
            ? BackgroundE2EWindow(
                contentRect: contentRect,
                styleMask: styleMask,
                backing: .buffered,
                defer: false
            )
            : NSWindow(
                contentRect: contentRect,
                styleMask: styleMask,
                backing: .buffered,
                defer: false
            )
        window.minSize = NSSize(width: 1040, height: 680)
        window.setContentSize(NSSize(width: 1420, height: 900))
        window.isRestorable = false
        window.isReleasedWhenClosed = false
        window.title = "Levil Notes"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = false
        window.backgroundColor = NSColor(
            calibratedWhite: 1,
            alpha: 1
        )
        window.collectionBehavior.insert(.fullScreenPrimary)
        let nativeControls = [
            ("close", NSWindow.ButtonType.closeButton),
            ("minimize", .miniaturizeButton),
            ("full-screen", .zoomButton)
        ].map { name, type in
            let button = window.standardWindowButton(type)
            return "\(name)=\(button != nil && button?.isHidden == false)"
        }
        appendDiagnostic(
            "native-window-controls=\(nativeControls.joined(separator: ","))"
        )
        if backgroundE2E {
            window.alphaValue = 0
            window.hasShadow = false
            window.ignoresMouseEvents = true
            window.animationBehavior = .none
        } else {
            window.center()
        }

        let documentPolicy = makeDocumentPolicy(for: client)
        let messageHandler = HostMessageHandler(
            window: window,
            clientProvider: { [weak self] in self?.client },
            documentPolicy: documentPolicy
        )
        controller.add(messageHandler, name: "levilNotesHost")
        self.messageHandler = messageHandler
        let assetHandler = NotesAssetSchemeHandler(
            clientProvider: { [weak self] in self?.client }
        )
        self.assetHandler = assetHandler
        configuration.setURLSchemeHandler(assetHandler, forURLScheme: "notes-asset")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        self.webView = webView
        configureNavigation(
            documentPolicy: documentPolicy,
            webView: webView
        )
        installBridge(client: client, in: controller)
        webView.setValue(false, forKey: "drawsBackground")
        webView.translatesAutoresizingMaskIntoConstraints = false
        window.contentView?.addSubview(webView)
        if let contentView = window.contentView {
            NSLayoutConstraint.activate([
                webView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
                webView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
                webView.topAnchor.constraint(equalTo: contentView.topAnchor),
                webView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor)
            ])
        }
        window.delegate = self
        self.window = window
        if backgroundE2E {
            let intersections = moveFullyOffscreen(window)
            appendDiagnostic(
                "background-window-screen-intersections=\(intersections)"
            )
            appendDiagnostic(
                "background-window-offscreen=\(intersections == 0)"
            )
            window.orderFront(nil)
        } else {
            window.makeKeyAndOrderFront(nil)
        }
        logWindowFrame("shown", window: window)
        if !backgroundE2E {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                [weak self, weak window] in
                guard
                    let self,
                    let window,
                    self.window === window,
                    window.isVisible
                else {
                    return
                }
                window.setContentSize(NSSize(width: 1420, height: 900))
                window.center()
                window.makeKeyAndOrderFront(nil)
                self.logWindowFrame("settled", window: window)
            }
        }
        load(client: client, webView: webView)
        if !backgroundE2E {
            NSApplication.shared.activate(ignoringOtherApps: true)
        }
    }

    private func moveFullyOffscreen(_ window: NSWindow) -> Int {
        let screens = NSScreen.screens
        guard let firstScreen = screens.first else {
            return 1
        }
        let screenUnion = screens.dropFirst().reduce(firstScreen.frame) {
            $0.union($1.frame)
        }
        window.setFrameOrigin(
            NSPoint(x: screenUnion.maxX + 64, y: screenUnion.maxY + 64)
        )
        return screens.reduce(into: 0) { count, screen in
            if screen.frame.intersects(window.frame) {
                count += 1
            }
        }
    }

    private func reload(client: SidecarClient) {
        guard let window, let webView else {
            showWindow(client: client)
            return
        }
        let controller = webView.configuration.userContentController
        controller.removeAllUserScripts()
        controller.removeScriptMessageHandler(forName: "levilNotesHost")
        let documentPolicy = makeDocumentPolicy(for: client)
        let messageHandler = HostMessageHandler(
            window: window,
            clientProvider: { [weak self] in self?.client },
            documentPolicy: documentPolicy
        )
        controller.add(messageHandler, name: "levilNotesHost")
        self.messageHandler = messageHandler
        configureNavigation(
            documentPolicy: documentPolicy,
            webView: webView
        )
        installBridge(client: client, in: controller)
        appendDiagnostic("webview-reload-after-sidecar-restart")
        window.makeKeyAndOrderFront(nil)
        load(client: client, webView: webView)
    }

    private func configureNavigation(
        documentPolicy: TrustedWebDocumentPolicy,
        webView: WKWebView
    ) {
        navigationDelegate = NavigationDelegate(
            documentPolicy: documentPolicy,
            openExternal: { [weak self] url in
                guard let self else { return }
                if self.backgroundE2E {
                    let host = url.host ?? "unknown"
                    self.appendDiagnostic(
                        "background-external-navigation-suppressed=\(host)"
                    )
                } else {
                    NSWorkspace.shared.open(url)
                }
            },
            onSameOriginNavigationCanceled: { [weak self] in
                self?.appendDiagnostic(
                    "background-same-origin-navigation-canceled=true"
                )
            },
            onFinish: { [weak self, weak webView] in
                self?.schedulePageChecks(webView: webView)
            }
        )
        webView.navigationDelegate = navigationDelegate
        webView.uiDelegate = navigationDelegate
    }

    private func makeDocumentPolicy(
        for client: SidecarClient
    ) -> TrustedWebDocumentPolicy {
        TrustedWebDocumentPolicy(
            trustedOrigins: [client.baseURL] + [
                developmentOrigin
            ].compactMap { $0 }
        )
    }

    private func installBridge(
        client: SidecarClient,
        in controller: WKUserContentController
    ) {
        let bridgeURL = Bundle.main.resourceURL?
            .appendingPathComponent("levilNotesBridge.js")
        let bridgeSource = bridgeURL.flatMap {
            try? String(contentsOf: $0, encoding: .utf8)
        } ?? ""
        let configJSON = """
        {"baseUrl":"\(client.baseURL.absoluteString)","token":"\(client.token)"}
        """
        let userScript = """
        document.documentElement?.setAttribute("data-host-platform", "macos");
        window.__SPACENOTES_BRIDGE_CONFIG__ = \(configJSON);
        \(bridgeSource)
        """
        controller.addUserScript(
            WKUserScript(
                source: userScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
    }

    private func load(client: SidecarClient, webView: WKWebView) {
        if let developmentOrigin {
            webView.load(URLRequest(url: developmentOrigin))
            return
        }
        var initialComponents = URLComponents(
            url: client.baseURL,
            resolvingAgainstBaseURL: false
        )
        initialComponents?.queryItems = [
            URLQueryItem(name: "token", value: client.token)
        ]
        let initialURL = initialComponents?.url ?? client.baseURL
        webView.load(URLRequest(url: initialURL))
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            [weak self, weak webView] in
            webView?.evaluateJavaScript(
                """
                ({
                  title: document.title,
                  readyState: document.readyState,
                  hasAppShell: Boolean(document.querySelector(".app-shell")),
                  hasBridge: Boolean(window.levilNotes)
                })
                """
            ) { result, error in
                self?.appendDiagnostic("delayed-page-check")
                self?.logPageState(result, error: error)
            }
        }
    }

    private func schedulePageChecks(webView: WKWebView?) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            [weak self, weak webView] in
            guard let webView else { return }
            webView.evaluateJavaScript(
                """
                ({
                  title: document.title,
                  readyState: document.readyState,
                  hasAppShell: Boolean(document.querySelector(".app-shell")),
                  hasBridge: Boolean(window.levilNotes)
                })
                """
            ) { result, error in
                guard let self else { return }
                self.logPageState(result, error: error)
                if let reportPath = E2ERunner.reportPath, !self.e2eStarted {
                    self.e2eStarted = true
                    self.appendDiagnostic("e2e-started")
                    E2ERunner.run(
                        webView: webView,
                        reportPath: reportPath
                    ) { report in
                        self.appendDiagnostic("e2e-report=\(reportPath)")
                        NSLog("Levil Notes E2E report: %@", report)
                    }
                }
            }
        }
    }

    private func logWindowFrame(_ stage: String, window: NSWindow) {
        let message = [
            "window=\(stage)",
            "frame=\(NSStringFromRect(window.frame))",
            "content=\(NSStringFromRect(window.contentLayoutRect))"
        ].joined(separator: " ")
        NSLog("Levil Notes %@", message)
        guard let support = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            return
        }
        let directory = support.appendingPathComponent(
            "Levil Notes",
            isDirectory: true
        )
        let file = directory.appendingPathComponent("diagnostics.log")
        do {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
            let line = "\(ISO8601DateFormatter().string(from: Date())) \(message)\n"
            if FileManager.default.fileExists(atPath: file.path) {
                let handle = try FileHandle(forWritingTo: file)
                try handle.seekToEnd()
                try handle.write(contentsOf: Data(line.utf8))
                try handle.close()
            } else {
                try line.write(to: file, atomically: true, encoding: .utf8)
            }
        } catch {
            NSLog("Levil Notes diagnostic log failed: %@", error.localizedDescription)
        }
    }

    private func logPageState(_ result: Any?, error: Error?) {
        if let error {
            appendDiagnostic("page-error=\(error.localizedDescription)")
            return
        }
        guard
            let state = result as? [String: Any],
            let data = try? JSONSerialization.data(withJSONObject: state),
            let json = String(data: data, encoding: .utf8)
        else {
            appendDiagnostic("page-state=unavailable")
            return
        }
        appendDiagnostic("page-state=\(json)")
    }

    private func appendDiagnostic(_ message: String) {
        guard let support = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            return
        }
        let directory = support.appendingPathComponent(
            "Levil Notes",
            isDirectory: true
        )
        let file = directory.appendingPathComponent("diagnostics.log")
        do {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
            let line = "\(ISO8601DateFormatter().string(from: Date())) \(message)\n"
            if FileManager.default.fileExists(atPath: file.path) {
                let handle = try FileHandle(forWritingTo: file)
                try handle.seekToEnd()
                try handle.write(contentsOf: Data(line.utf8))
                try handle.close()
            } else {
                try line.write(to: file, atomically: true, encoding: .utf8)
            }
        } catch {
            NSLog("Levil Notes diagnostic log failed: %@", error.localizedDescription)
        }
    }

    private func presentFatal(_ message: String) {
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "Levil Notes 无法启动"
        alert.informativeText = message
        alert.addButton(withTitle: "退出")
        alert.runModal()
        NSApplication.shared.terminate(nil)
    }

    private func configureMainMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(
            withTitle: "关于 Levil Notes",
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        )
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "隐藏 Levil Notes",
            action: #selector(NSApplication.hide(_:)),
            keyEquivalent: "h"
        )
        appMenu.addItem(.separator())
        appMenu.addItem(
            withTitle: "退出 Levil Notes",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )

        let editItem = NSMenuItem()
        mainMenu.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editItem.submenu = editMenu
        for (title, selector, key) in [
            ("撤销", Selector(("undo:")), "z"),
            ("重做", Selector(("redo:")), "Z"),
            ("剪切", #selector(NSText.cut(_:)), "x"),
            ("复制", #selector(NSText.copy(_:)), "c"),
            ("粘贴", #selector(NSText.paste(_:)), "v"),
            ("全选", #selector(NSText.selectAll(_:)), "a")
        ] {
            editMenu.addItem(
                withTitle: title,
                action: selector,
                keyEquivalent: key
            )
        }

        let viewItem = NSMenuItem()
        mainMenu.addItem(viewItem)
        let viewMenu = NSMenu(title: "显示")
        viewItem.submenu = viewMenu
        viewMenu.addItem(
            withTitle: "切换全屏",
            action: #selector(NSWindow.toggleFullScreen(_:)),
            keyEquivalent: "f"
        ).keyEquivalentModifierMask = [.command, .control]

        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: "窗口")
        windowItem.submenu = windowMenu
        let closeItem = NSMenuItem(
            title: "关闭窗口",
            action: #selector(closeMainWindow),
            keyEquivalent: "w"
        )
        closeItem.target = self
        windowMenu.addItem(closeItem)
        windowMenu.addItem(
            withTitle: "最小化",
            action: #selector(NSWindow.performMiniaturize(_:)),
            keyEquivalent: "m"
        )
        windowMenu.addItem(
            withTitle: "缩放",
            action: #selector(NSWindow.performZoom(_:)),
            keyEquivalent: ""
        )
        NSApplication.shared.mainMenu = mainMenu
        NSApplication.shared.windowsMenu = windowMenu
    }
}

extension AppDelegate: NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        guard
            let closedWindow = notification.object as? NSWindow,
            closedWindow === window
        else {
            return
        }
        appendDiagnostic("window-closed-app-persisted")
        appendDiagnostic(
            "window-closed-webview-retained=\(webView != nil)"
        )
    }

    @objc private func closeMainWindow() {
        window?.performClose(nil)
    }
}
