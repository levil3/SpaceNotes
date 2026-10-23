import AppKit
import SpaceNotesCore
import WebKit

final class HostMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var window: NSWindow?
    private let clientProvider: () -> SidecarClient?

    init(
        window: NSWindow,
        clientProvider: @escaping () -> SidecarClient?
    ) {
        self.window = window
        self.clientProvider = clientProvider
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let request = BridgeRequest(body: message.body) else {
            return
        }
        if request.isNotification {
            handleNotification(request)
        } else {
            handleRequest(request)
        }
    }

    private func handleNotification(_ request: BridgeRequest) {
        if request.name == "bridgeDiagnostic" {
            let detail = request.arguments.first as? String ?? "unknown"
            appendDiagnostic("page-js=\(detail)")
            return
        }
        guard request.name == "beginWindowDrag",
              let window,
              let event = NSApplication.shared.currentEvent
        else {
            return
        }
        window.performDrag(with: event)
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
            let handle = try FileHandle(forWritingTo: file)
            try handle.seekToEnd()
            try handle.write(contentsOf: Data(line.utf8))
            try handle.close()
        } catch {
            NSLog(
                "Levil Notes JavaScript diagnostic failed: %@",
                error.localizedDescription
            )
        }
    }

    private func handleRequest(_ request: BridgeRequest) {
        switch request.name {
        case "chooseVault":
            chooseVault(request)
        case "trashNote":
            guard let path = request.arguments.first as? String else {
                reject(request, message: "文件路径无效。")
                return
            }
            trash(path, request: request)
        case "showInFolder":
            guard let path = request.arguments.first as? String else {
                reject(request, message: "文件路径无效。")
                return
            }
            showInFolder(path, request: request)
        case "minimizeWindow":
            window?.performMiniaturize(nil)
            resolve(request, value: NSNull())
        case "toggleMaximizeWindow":
            window?.performZoom(nil)
            resolve(request, value: NSNull())
        case "closeWindow":
            window?.performClose(nil)
            resolve(request, value: NSNull())
        default:
            reject(request, message: "当前宿主不支持该操作。")
        }
    }

    private func chooseVault(_ request: BridgeRequest) {
        guard let window, let client = clientProvider() else {
            reject(request, message: "主窗口不可用。")
            return
        }
        let panel = NSOpenPanel()
        panel.title = "打开或新建笔记库文件夹"
        panel.prompt = "打开"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { [weak self] result in
            guard let self, result == .OK, let url = panel.url else {
                self?.resolve(request, value: NSNull())
                return
            }
            Task {
                do {
                    let snapshot = try await client.call(
                        method: "openVault",
                        arguments: [url.path]
                    )
                    self.resolve(request, value: snapshot ?? NSNull())
                } catch {
                    self.reject(request, message: error.localizedDescription)
                }
            }
        }
    }

    private func trash(_ relativePath: String, request: BridgeRequest) {
        guard let client = clientProvider() else {
            reject(request, message: "后台服务不可用。")
            return
        }
        Task {
            do {
                let snapshot = try await client.snapshot()
                guard let rootPath = snapshot["path"] as? String else {
                    throw SidecarClientError.server("请先打开一个笔记库。")
                }
                let target = try VaultPathGuard.resolve(
                    relativePath: relativePath,
                    in: URL(fileURLWithPath: rootPath, isDirectory: true)
                )
                try FileManager.default.trashItem(
                    at: target,
                    resultingItemURL: nil
                )
                let refreshed = try await client.internalCall(method: "refresh")
                resolve(request, value: refreshed ?? NSNull())
            } catch {
                reject(request, message: error.localizedDescription)
            }
        }
    }

    private func showInFolder(_ relativePath: String, request: BridgeRequest) {
        guard let client = clientProvider() else {
            reject(request, message: "后台服务不可用。")
            return
        }
        Task {
            do {
                let snapshot = try await client.snapshot()
                guard let rootPath = snapshot["path"] as? String else {
                    throw SidecarClientError.server("请先打开一个笔记库。")
                }
                let target = try VaultPathGuard.resolve(
                    relativePath: relativePath,
                    in: URL(fileURLWithPath: rootPath, isDirectory: true)
                )
                guard FileManager.default.fileExists(atPath: target.path) else {
                    throw SidecarClientError.server("文件不存在。")
                }
                NSWorkspace.shared.activateFileViewerSelecting([target])
                resolve(request, value: NSNull())
            } catch {
                reject(request, message: error.localizedDescription)
            }
        }
    }

    private func resolve(_ request: BridgeRequest, value: Any) {
        let object: Any
        if JSONSerialization.isValidJSONObject(value) {
            object = value
        } else {
            object = NSNull()
        }
        guard
            let data = try? JSONSerialization.data(withJSONObject: object),
            let json = String(data: data, encoding: .utf8)
        else {
            reject(request, message: "宿主返回了无效结果。")
            return
        }
        evaluate(
            "window.__levilNotesHostResolve(\(request.id), \(json));"
        )
    }

    private func reject(_ request: BridgeRequest, message: String) {
        guard
            let data = try? JSONSerialization.data(withJSONObject: message),
            let json = String(data: data, encoding: .utf8)
        else {
            return
        }
        evaluate(
            "window.__levilNotesHostReject(\(request.id), \(json));"
        )
    }

    private func evaluate(_ script: String) {
        DispatchQueue.main.async { [weak window] in
            window?.contentView?.subviews
                .compactMap { $0 as? WKWebView }
                .first?
                .evaluateJavaScript(script)
        }
    }
}
