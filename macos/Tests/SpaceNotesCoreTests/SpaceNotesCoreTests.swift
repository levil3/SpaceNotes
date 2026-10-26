import Foundation
import Darwin
import XCTest
@testable import SpaceNotesCore

final class SpaceNotesCoreTests: XCTestCase {
    func testReadyHandshakeRequiresLoopbackAndValidPort() {
        XCTAssertEqual(
            ReadyHandshake.port(
                from: #"{"type":"ready","host":"127.0.0.1","port":43123}"#
            ),
            43123
        )
        XCTAssertNil(
            ReadyHandshake.port(
                from: #"{"type":"ready","host":"0.0.0.0","port":43123}"#
            )
        )
        XCTAssertNil(
            ReadyHandshake.port(
                from: #"{"type":"ready","host":"127.0.0.1","port":70000}"#
            )
        )
    }

    func testRetryPolicyAllowsExactlyOneAutomaticRestart() {
        var policy = SidecarRetryPolicy()
        XCTAssertTrue(policy.consumeRestart())
        XCTAssertFalse(policy.consumeRestart())
        XCTAssertEqual(policy.automaticRestarts, 1)
    }

    func testSidecarClientReportsStatusAndRedactedServerReason() {
        let error = SidecarClient.serverError(
            statusCode: 403,
            data: Data("Host not allowed: secret-token".utf8),
            token: "secret-token"
        )

        XCTAssertEqual(
            error.localizedDescription,
            "sidecar 请求失败（HTTP 403）：Host not allowed: [redacted]"
        )
    }

    func testSidecarClientBuildsOneSlashEndpointForCiFoundation() {
        let endpoint = SidecarClient.endpointURL(
            baseURL: URL(string: "http://127.0.0.1:43123/")!,
            path: "/api/getVaultSnapshot"
        )

        XCTAssertEqual(
            endpoint?.absoluteString,
            "http://127.0.0.1:43123/api/getVaultSnapshot"
        )
    }

    func testExternalMainFrameNavigationOpensInTheSystemBrowser() {
        XCTAssertEqual(
            WebNavigationPolicy.decision(
                url: URL(string: "https://example.com/docs")!,
                isMainFrame: true,
                isTrustedOrigin: false,
                isTrustedDocument: false
            ),
            .openExternally
        )
        XCTAssertEqual(
            WebNavigationPolicy.decision(
                url: URL(string: "file:///tmp/outside.html")!,
                isMainFrame: true,
                isTrustedOrigin: false,
                isTrustedDocument: false
            ),
            .cancel
        )
    }

    func testSameOriginAssetNavigationIsCanceledInsteadOfOpenedInBrowser() {
        let policy = TrustedWebDocumentPolicy(
            trustedOrigins: [URL(string: "http://127.0.0.1:43123/")!]
        )
        let assetURL = URL(
            string: "http://127.0.0.1:43123/assets?target=evil.svg&note=welcome.md"
        )!

        XCTAssertTrue(policy.isTrustedOrigin(assetURL))
        XCTAssertFalse(policy.isTrustedDocument(assetURL))
        XCTAssertEqual(
            WebNavigationPolicy.decision(
                url: assetURL,
                isMainFrame: true,
                isTrustedOrigin: policy.isTrustedOrigin(assetURL),
                isTrustedDocument: policy.isTrustedDocument(assetURL)
            ),
            .cancel
        )
    }

    func testLaunchTokenPayloadUsesAStdInLineAndStableFingerprint() throws {
        let token = "0123456789abcdef0123456789abcdef"
        XCTAssertEqual(
            String(
                data: try LaunchTokenPayload.data(for: token),
                encoding: .utf8
            ),
            "SPACENOTES_TOKEN=\(token)\n"
        )
        XCTAssertEqual(
            LaunchTokenPayload.fingerprint(of: token),
            "3eb1bd439947eb762998e566ccc2e099c791118b2f40579cc4f7da"
                + "2b5061b7f9"
        )
        XCTAssertThrowsError(
            try LaunchTokenPayload.data(for: "token\ninjection")
        )
    }

    func testPathGuardAcceptsVaultPathsAndRejectsTraversal() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("notes"),
            withIntermediateDirectories: true
        )
        let note = root.appendingPathComponent("notes/today.md")
        FileManager.default.createFile(
            atPath: note.path,
            contents: Data("# Today".utf8)
        )

        XCTAssertEqual(
            try VaultPathGuard.resolve(
                relativePath: "notes/today.md",
                in: root
            ).path,
            note.standardizedFileURL.path
        )
        let link = root.appendingPathComponent("notes/link.md")
        try FileManager.default.createSymbolicLink(
            at: link,
            withDestinationURL: note
        )
        XCTAssertEqual(
            try VaultPathGuard.resolve(
                relativePath: "notes/link.md",
                in: root
            ).path,
            link.standardizedFileURL.path
        )
        XCTAssertThrowsError(
            try VaultPathGuard.resolve(
                relativePath: "../outside.md",
                in: root
            )
        )
        XCTAssertThrowsError(
            try VaultPathGuard.resolve(
                relativePath: "/tmp/outside.md",
                in: root
            )
        )
        let outsideRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: outsideRoot) }
        try FileManager.default.createDirectory(
            at: outsideRoot,
            withIntermediateDirectories: true
        )
        let outsideFile = outsideRoot.appendingPathComponent("outside.md")
        FileManager.default.createFile(
            atPath: outsideFile.path,
            contents: Data("# Outside".utf8)
        )
        let outsideLink = root.appendingPathComponent("outside-link.md")
        try FileManager.default.createSymbolicLink(
            at: outsideLink,
            withDestinationURL: outsideFile
        )
        XCTAssertThrowsError(
            try VaultPathGuard.resolve(
                relativePath: "outside-link.md",
                in: root
            )
        )
    }

    func testTrustedWebDocumentPolicyAllowsOnlyTheApplicationShell() {
        let policy = TrustedWebDocumentPolicy(
            trustedOrigins: [
                URL(string: "http://127.0.0.1:43123/")!,
                URL(string: "http://127.0.0.1:5173/")!,
            ]
        )

        XCTAssertTrue(
            policy.isTrustedDocument(
                URL(
                    string: "http://127.0.0.1:43123/?token=redacted"
                )!
            )
        )
        XCTAssertTrue(
            policy.isTrustedDocument(
                URL(string: "http://127.0.0.1:5173/index.html")!
            )
        )
        XCTAssertTrue(
            policy.isTrustedOrigin(
                scheme: "http",
                host: "127.0.0.1",
                port: 43123
            )
        )
        XCTAssertFalse(
            policy.isTrustedDocument(
                URL(string: "notes-asset://vault/evil.svg")!
            )
        )
        XCTAssertFalse(
            policy.isTrustedDocument(
                URL(
                    string: "http://127.0.0.1:43123/assets?target=evil.svg"
                )!
            )
        )
        XCTAssertFalse(
            policy.isTrustedDocument(
                URL(string: "http://127.0.0.1:43124/")!
            )
        )
        XCTAssertFalse(
            policy.isTrustedOrigin(
                scheme: "https",
                host: "127.0.0.1",
                port: 43123
            )
        )
    }

    func testMoveToTrashRejectsDirectorySymlinkOutsideVault() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let outsideRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let trashRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer {
            try? FileManager.default.removeItem(at: root)
            try? FileManager.default.removeItem(at: outsideRoot)
            try? FileManager.default.removeItem(at: trashRoot)
        }
        try FileManager.default.createDirectory(
            at: outsideRoot,
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: true
        )
        let outsideNote = outsideRoot.appendingPathComponent("note.md")
        FileManager.default.createFile(
            atPath: outsideNote.path,
            contents: Data("# Outside".utf8)
        )
        try FileManager.default.createSymbolicLink(
            at: root.appendingPathComponent("linked"),
            withDestinationURL: outsideRoot
        )

        XCTAssertThrowsError(
            try VaultPathGuard.moveToTrash(
                relativePath: "linked/note.md",
                in: root,
                trashRoot: trashRoot
            )
        )
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: outsideNote.path)
        )
    }

    func testMoveToTrashMovesRegularEntryIntoInjectedTrash() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let trashRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer {
            try? FileManager.default.removeItem(at: root)
            try? FileManager.default.removeItem(at: trashRoot)
        }
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: true
        )
        let note = root.appendingPathComponent("note.md")
        FileManager.default.createFile(
            atPath: note.path,
            contents: Data("# Trash me".utf8)
        )

        try VaultPathGuard.moveToTrash(
            relativePath: "note.md",
            in: root,
            trashRoot: trashRoot
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: note.path))
        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: trashRoot.appendingPathComponent("note.md").path
            )
        )
    }

    func testMoveToTrashUsesSystemTrashForCurrentVolume() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let fileName = "space-notes-\(UUID().uuidString).md"
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: true
        )
        let note = root.appendingPathComponent(fileName)
        XCTAssertTrue(
            FileManager.default.createFile(
                atPath: note.path,
                contents: Data("# System trash".utf8)
            )
        )

        let resultingURL = try VaultPathGuard.moveToTrash(
            relativePath: fileName,
            in: root
        )
        defer { try? FileManager.default.removeItem(at: resultingURL) }
        XCTAssertEqual(
            resultingURL.deletingLastPathComponent()
                .resolvingSymlinksInPath()
                .standardizedFileURL,
            FileManager.default.urls(
                for: .trashDirectory,
                in: .userDomainMask
            ).first?
                .resolvingSymlinksInPath()
                .standardizedFileURL
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: note.path))
    }

    func testMoveToTrashDoesNotOverwriteTrashCollision() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let trashRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer {
            try? FileManager.default.removeItem(at: root)
            try? FileManager.default.removeItem(at: trashRoot)
        }
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: trashRoot,
            withIntermediateDirectories: true
        )
        let note = root.appendingPathComponent("note.md")
        FileManager.default.createFile(
            atPath: note.path,
            contents: Data("# Move me".utf8)
        )
        let existing = trashRoot.appendingPathComponent("note.md")
        FileManager.default.createFile(
            atPath: existing.path,
            contents: Data("# Existing".utf8)
        )

        try VaultPathGuard.moveToTrash(
            relativePath: "note.md",
            in: root,
            trashRoot: trashRoot
        )

        XCTAssertEqual(
            try String(contentsOf: existing, encoding: .utf8),
            "# Existing"
        )
        XCTAssertEqual(
            try String(
                contentsOf: trashRoot.appendingPathComponent("note 2.md"),
                encoding: .utf8
            ),
            "# Move me"
        )
    }

    func testMoveExclusiveKeepsOpenedDestinationAfterPathSwap() throws {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let sourceDirectory = base.appendingPathComponent(
            "source",
            isDirectory: true
        )
        let destinationDirectory = base.appendingPathComponent(
            "destination",
            isDirectory: true
        )
        let retainedDirectory = base.appendingPathComponent(
            "destination-retained",
            isDirectory: true
        )
        let outsideDirectory = base.appendingPathComponent(
            "outside",
            isDirectory: true
        )
        defer { try? FileManager.default.removeItem(at: base) }
        for directory in [
            sourceDirectory,
            destinationDirectory,
            outsideDirectory
        ] {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
        }
        let note = sourceDirectory.appendingPathComponent("note.md")
        XCTAssertTrue(
            FileManager.default.createFile(
                atPath: note.path,
                contents: Data("# Race me".utf8)
            )
        )

        let sourceFD = try VaultPathGuard.openDirectoryExclusively(
            at: sourceDirectory
        )
        defer { Darwin.close(sourceFD) }
        let destinationFD = try VaultPathGuard.openDirectoryExclusively(
            at: destinationDirectory
        )
        defer { Darwin.close(destinationFD) }

        try FileManager.default.moveItem(
            at: destinationDirectory,
            to: retainedDirectory
        )
        try FileManager.default.createSymbolicLink(
            at: destinationDirectory,
            withDestinationURL: outsideDirectory
        )

        let movedName = try VaultPathGuard.moveExclusive(
            fileName: "note.md",
            sourceDirectoryFD: sourceFD,
            destinationDirectoryFD: destinationFD
        )

        XCTAssertEqual(movedName, "note.md")
        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: retainedDirectory
                    .appendingPathComponent(movedName)
                    .path
            )
        )
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: outsideDirectory
                    .appendingPathComponent("note.md")
                    .path
            )
        )
        XCTAssertFalse(FileManager.default.fileExists(atPath: note.path))
    }

    func testOpenDirectoryExclusivelyResolvesSystemTemporaryPath() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )

        let directoryFD = try VaultPathGuard.openDirectoryExclusively(
            at: directory
        )
        defer { Darwin.close(directoryFD) }
        var status = stat()

        XCTAssertEqual(Darwin.fstat(directoryFD, &status), 0)
        XCTAssertEqual(status.st_mode & S_IFMT, S_IFDIR)
    }

    func testDefaultTrashRootUsesUserTrashForCurrentVolume() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: true
        )

        let trashRoot = try VaultPathGuard.defaultTrashRoot(for: root)
        let expected = FileManager.default.urls(
            for: .trashDirectory,
            in: .userDomainMask
        ).first

        XCTAssertEqual(trashRoot.standardizedFileURL, expected?.standardizedFileURL)
    }

    func testMoveToTrashOnExplicitMountedVolume() throws {
        guard let mountedPath = ProcessInfo.processInfo.environment[
            "SPACENOTES_TEST_MOUNTED_VOLUME"
        ], !mountedPath.isEmpty else {
            throw XCTSkip("mounted-volume test volume was not provided")
        }
        let volumeRoot = URL(
            fileURLWithPath: mountedPath,
            isDirectory: true
        )
        let root = volumeRoot.appendingPathComponent(
            "vault-\(UUID().uuidString)",
            isDirectory: true
        )
        let note = root.appendingPathComponent("cross-volume.md")
        defer {
            try? FileManager.default.removeItem(at: root)
        }
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: true
        )
        FileManager.default.createFile(
            atPath: note.path,
            contents: Data("# Cross volume".utf8)
        )

        let trashRoot = try VaultPathGuard.defaultTrashRoot(for: root)
        XCTAssertTrue(
            trashRoot.path.hasPrefix(
                volumeRoot.standardizedFileURL.path + "/.Trashes/"
            )
        )
        try VaultPathGuard.moveToTrash(
            relativePath: "cross-volume.md",
            in: root
        )

        XCTAssertFalse(FileManager.default.fileExists(atPath: note.path))
        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: trashRoot.appendingPathComponent(
                    "cross-volume.md"
                ).path
            )
        )
    }

    func testAssetRequestSupportsQueryAndPathForms() {
        XCTAssertEqual(
            AssetRequest(
                url: URL(
                    string: "notes-asset://vault/?target=images%2Fa.png&note=notes%2Fa.md"
                )!
            ),
            AssetRequest(target: "images/a.png", notePath: "notes/a.md")
        )
        XCTAssertEqual(
            AssetRequest(
                url: URL(string: "notes-asset://vault/images/a.png")!
            ),
            AssetRequest(target: "images/a.png", notePath: "")
        )
        XCTAssertEqual(
            AssetRequest(
                url: URL(
                    string: "notes-asset://vault/?target=first.png&target=second.png"
                )!
            ),
            AssetRequest(target: "second.png", notePath: "")
        )
    }

    func testBridgeMessageAllowsNotificationAndRequest() {
        XCTAssertEqual(
            BridgeRequest(body: ["name": "beginWindowDrag", "args": []]),
            BridgeRequest(
                id: 0,
                name: "beginWindowDrag",
                arguments: []
            )
        )
        XCTAssertEqual(
            BridgeRequest(
                body: ["id": 7, "name": "trashNote", "args": ["a.md"]]
            ),
            BridgeRequest(id: 7, name: "trashNote", arguments: ["a.md"])
        )
        XCTAssertNil(BridgeRequest(body: ["id": 7, "args": []]))
    }

    func testJavaScriptLiteralEncoderSupportsHostActionResponses() {
        XCTAssertEqual(JavaScriptLiteralEncoder.encode(NSNull()), "null")
        XCTAssertEqual(JavaScriptLiteralEncoder.encode("失败"), #""失败""#)
        XCTAssertEqual(JavaScriptLiteralEncoder.encode(true), "true")
        XCTAssertEqual(JavaScriptLiteralEncoder.encode(42), "42")
        XCTAssertEqual(
            JavaScriptLiteralEncoder.encode(["status": "ok"]),
            #"{"status":"ok"}"#
        )
        XCTAssertNil(JavaScriptLiteralEncoder.encode(URL(fileURLWithPath: "/tmp")))
    }
}

private extension BridgeRequest {
    init(id: Int, name: String, arguments: [Any]) {
        var body: [String: Any] = ["name": name, "args": arguments]
        if id > 0 {
            body["id"] = id
        }
        self = BridgeRequest(body: body)!
    }
}
