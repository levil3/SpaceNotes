import Foundation
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
            note.resolvingSymlinksInPath().path
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
