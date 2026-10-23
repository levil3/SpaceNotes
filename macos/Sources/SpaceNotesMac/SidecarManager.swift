import Darwin
import Foundation
import SpaceNotesCore

final class SidecarManager {
    struct Configuration {
        let executableURL: URL
        let scriptURL: URL
        let webRootURL: URL
        let settingsURL: URL
        let token: String
        let parentPID: Int32
        let allowedOrigins: [String]
    }

    private let configuration: Configuration
    private let process = Process()
    private let inputPipe = Pipe()
    private let outputPipe = Pipe()
    private let errorPipe = Pipe()
    private var outputBuffer = ""
    private var errorBuffer = ""
    private var ready = false
    private var stopping = false
    private var exitReported = false

    init(configuration: Configuration) {
        self.configuration = configuration
    }

    var diagnosticSummary: String {
        var text = errorBuffer.replacingOccurrences(
            of: configuration.token,
            with: "[redacted]"
        )
        text = text.replacingOccurrences(
            of: #"(?i)(token=)[^\s&]+"#,
            with: "$1[redacted]",
            options: .regularExpression
        )
        return String(text.suffix(2_000))
    }

    func start(
        onReady: @escaping (URL) -> Void,
        onExit: @escaping (Int32) -> Void
    ) {
        var environment = ProcessInfo.processInfo.environment
        environment["SPACENOTES_SETTINGS_PATH"] = configuration.settingsURL.path
        environment["SPACENOTES_WEB_ROOT"] = configuration.webRootURL.path
        environment["SPACENOTES_ALLOWED_ORIGINS"] =
            configuration.allowedOrigins.joined(separator: ",")
        environment["SPACENOTES_PARENT_PID"] =
            String(configuration.parentPID)
        let existingPath = environment["PATH"] ?? ""
        environment["PATH"] = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            existingPath
        ].filter { !$0.isEmpty }.joined(separator: ":")
        process.environment = environment
        process.executableURL = configuration.executableURL
        process.arguments = [configuration.scriptURL.path]
        process.currentDirectoryURL = configuration.scriptURL
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        process.standardOutput = outputPipe
        process.standardError = errorPipe
        process.standardInput = inputPipe

        outputPipe.fileHandleForReading.readabilityHandler = {
            [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let chunk = String(data: data, encoding: .utf8)
            else {
                return
            }
            DispatchQueue.main.async {
                self?.consumeStdout(chunk, onReady: onReady)
            }
        }
        errorPipe.fileHandleForReading.readabilityHandler = {
            [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let chunk = String(data: data, encoding: .utf8)
            else {
                return
            }
            DispatchQueue.main.async {
                self?.errorBuffer += chunk
                if self?.errorBuffer.count ?? 0 > 64_000 {
                    self?.errorBuffer = String(
                        self?.errorBuffer.suffix(32_000) ?? ""
                    )
                }
            }
        }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self else { return }
                self.outputPipe.fileHandleForReading.readabilityHandler = nil
                self.errorPipe.fileHandleForReading.readabilityHandler = nil
                if !self.stopping {
                    self.reportExit(process.terminationStatus, onExit: onExit)
                }
            }
        }

        let launchData: Data
        do {
            launchData = try LaunchTokenPayload.data(for: configuration.token)
        } catch {
            reportExit(-1, onExit: onExit)
            return
        }

        do {
            try process.run()
            try inputPipe.fileHandleForWriting.write(contentsOf: launchData)
            try inputPipe.fileHandleForWriting.close()
        } catch {
            try? inputPipe.fileHandleForWriting.close()
            if process.isRunning {
                stopping = true
                process.terminate()
            }
            reportExit(-1, onExit: onExit)
        }
    }

    func stop() {
        stopping = true
        outputPipe.fileHandleForReading.readabilityHandler = nil
        errorPipe.fileHandleForReading.readabilityHandler = nil
        if process.isRunning {
            process.terminate()
            let deadline = Date().addingTimeInterval(2)
            while process.isRunning, Date() < deadline {
                Thread.sleep(forTimeInterval: 0.05)
            }
            if process.isRunning {
                Darwin.kill(process.processIdentifier, SIGKILL)
            }
            process.waitUntilExit()
        }
    }

    private func consumeStdout(
        _ chunk: String,
        onReady: @escaping (URL) -> Void
    ) {
        outputBuffer += chunk
        while let newline = outputBuffer.firstIndex(of: "\n") {
            let line = String(outputBuffer[..<newline])
            outputBuffer.removeSubrange(...newline)
            if let port = ReadyHandshake.port(from: line) {
                ready = true
                guard let url = URL(string: "http://127.0.0.1:\(port)/")
                else {
                    continue
                }
                onReady(url)
            }
        }
    }

    private func reportExit(_ status: Int32, onExit: (Int32) -> Void) {
        guard !exitReported else { return }
        exitReported = true
        onExit(status)
    }
}
